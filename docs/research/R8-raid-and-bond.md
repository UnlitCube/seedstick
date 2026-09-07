# RAID とボンディングの一次資料（2026-09-06 取得）

`storage:` の action-based 設定と netplan の `bonds:` を UI から作るための調査。
**autoinstall のスキーマは `storage: {type: object}` としか言っていない**ので
（`docs/research/schema/autoinstall-schema.*.json` で確認）、
実体は curtin と netplan の仕様が正になる。

出典:

- curtin storage — https://curtin.readthedocs.io/en/latest/topics/storage.html
- netplan v2 — https://netplan.readthedocs.io/en/stable/netplan-yaml/
- `docs/research/sources/autoinstall-reference.rst` の "Action-based configuration"
  （「curtin がサポートする構文の**上位集合**」と書かれている）

---

## 1. storage: layout と config は排他

いまのアプリが出しているのは **`storage.layout`**（`lvm` / `direct` / `zfs`）。
RAID を組むには **`storage.config`**（アクションの配列）を出す必要がある。
リファレンスの記述:

> The three supported layouts at the time of writing are `lvm`, `direct` and `zfs`.
> ...
> For full flexibility, the installer allows storage configuration to be done using
> a syntax that is a superset of that supported by curtin.

## 2. curtin のアクション（必須キーと参照関係）

| アクション | 必須 | 参照キー | 主な任意キー |
|---|---|---|---|
| `disk` | `id` `type` | — | `ptable`(msdos/gpt/vtoc) `serial` `path` `model` `wipe` `preserve` `name` `grub_device` |
| `partition` | `id` `type` `device` `size` | `device` → disk の id | `number` `flag` `wipe` `preserve` `name` |
| `raid` | `id` `type` `name` `raidlevel` `devices` | `devices` `spare_devices` → disk/partition の id | `ptable` `metadata` `preserve` `wipe` |
| `lvm_volgroup` | `id` `type` `name` `devices` | `devices` → partition/disk/**raid** の id | `preserve` |
| `lvm_partition` | `id` `type` `name` `volgroup` | `volgroup` → lvm_volgroup の id | `size` `preserve` `wipe` |
| `format` | `id` `type` `fstype` `volume` | `volume` → partition/raid/lvm の id | `label` `uuid`(ext3/4 のみ) `extra_options` |
| `mount` | `id` `type` `path` + (`device` か `spec`) | `device` → **format の id**（partition ではない） | `options` `freq` `passno` |

**`mount.device` が指すのは `format` の id** で、パーティションの id ではない。
ここを取り違えると「マウントされない」形になる。

## 3. RAID レベルと最小台数（curtin の記載）

| level | 最小デバイス数 |
|---|---|
| 0 | 2 |
| 1 | 2 |
| 5 | 3 |
| 6 | 4 |
| **10** | **4** |

**RAID10 は 4 台から**というのが curtin の記載。
（mdadm 自体は `--level=10 --raid-devices=2` を受け付けるが、
**curtin が保証しているのは 4 台以上**。2 台で組ませたいなら
`storage.raw`（curtin 直書き）に逃がすべきで、UI の既定にはしない。）

## 4. `grub_device` は 1 台

> If the `grub_device` key is present and set true, then when post installation hooks
> are run grub will be installed onto this disk.
> In most cases curtin auto-detects the boot device.

curtin のドキュメントは **「1 台に設定する」**という書き方をしている。
2 台構成で「どちらが壊れても起動する」ようにしたい場合、
**curtin だけでは両方に GRUB を入れる保証が無い**。
`late-commands` で 2 台目に `grub-install` する必要がある
（このアプリには late-commands があるので、そこで補える）。

## 5. ESP を RAID に置けるかは**明記が無い**

curtin のドキュメントは ESP と RAID の組み合わせについて何も言っていない。
一般論として **UEFI ファームウェアは md を組み立てられない**ので、
ESP は各ディスクに素の FAT で置くのが定石。
**「RAID1 の上に ESP」を既定にしてはいけない**（起動しない USB と同じ種類の事故）。

パーティションの `flag`:

- `boot` — GPT では **ESP になる**（msdos では bootable フラグ）
- `bios_grub` — GPT のみ。BIOS 起動用の 1 MB 領域（ファイルシステムを作らない）
- 他: `logical` `extended` `swap` `lvm` `raid` `home` `prep` `msftres`

## 6. wipe と preserve

- `wipe` を指定すると**中身は破壊される**。値: `superblock` `superblock-recursive`
  `pvremove` `zero` `random`
- `preserve: true` は既存デバイスの再利用。curtin が存在・サイズ・フラグを確認し、
  食い違えば `RuntimeError` を投げる。

---

## 7. netplan の bonds

```yaml
network:
  version: 2
  ethernets:
    eth0: {match: {name: eth0}}
    eth1: {match: {name: eth1}}
  bonds:
    bond0:
      interfaces: [eth0, eth1]
      parameters:
        mode: 802.3ad
        lacp-rate: fast
        mii-monitor-interval: 100
      addresses: [192.168.1.100/24]
      routes:
        - {to: default, via: 192.168.1.1}
      nameservers:
        addresses: [8.8.8.8]
```

- **メンバーは `ethernets:` にも宣言が要る**
  （「The interfaces listed in the `interfaces` key must also be defined」）。
  メンバー側にアドレスを付けない（bond 側に付ける）。
- `mode` の値: `balance-rr`（既定）/ `active-backup` / `balance-xor` /
  `broadcast` / `802.3ad` / `balance-tlb` / `balance-alb`
  （Open vSwitch では `balance-tcp` `balance-slb` も）
- `lacp-rate` は **802.3ad のときだけ**意味を持つ
- `mii-monitor-interval` の既定は `0`＝**監視しない**。
  監視を入れないとリンク断を検出できないので、実運用では `100` 程度を入れる
- `transmit-hash-policy` は負荷分散するモード（`balance-xor` / `802.3ad`）でのみ効く
- アドレス・経路・DNS は **bond 側**に付ける

## 8. このアプリに落とすときの注意

- **`interfaces` に書く名前は netplan の「デバイス ID」**であって、
  必ずしも実際の NIC 名ではない（`match` で選んだ ID を書ける）。
  このアプリは既に `InterfaceSelector`（name / mac / any）を持っているので、
  メンバーは ID を発番して `ethernets` に `match` を書く形にできる。
- bond を作ると `network.target`（単一 NIC の選択）は意味を失う。
  **落とし穴 67 に従い、効かない設定は検証で伝える**。
