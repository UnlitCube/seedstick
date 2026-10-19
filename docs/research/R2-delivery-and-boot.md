# autoinstall の配信方式と完全無人化の条件（一次資料で確定）

調査日: 2026-09-03。根拠はすべて Canonical の公式ドキュメントと subiquity / cloud-init のソースコード。
取得したソースの固定リンク（上流のコミット SHA つき）は `docs/research/SOURCES.md` にある。

## 結論（本ツールが採る方式）

| 項目 | 採用 | 根拠 |
|---|---|---|
| 設定の配信 | cloud-init NoCloud（`CIDATA` ラベルの FAT パーティション） | subiquity 公式が推奨する方式。ISO を再構築せずに済む |
| ファイル | `user-data`（`#cloud-config` + `autoinstall:`）と `meta-data`（空でも必須） | 公式 quickstart の `cloud-localds user-data meta-data` と同じ構成 |
| カーネル引数 | `autoinstall` を **必ず** 付与（grub.cfg を改変） | これが無いと確認プロンプトで永久に停止する（下記） |
| `ds=nocloud` | **不要** | ラベル検出で自動的に見つかる |

## 1. 設定の配信方法（公式ドキュメント）

`doc/tutorial/providing-autoinstall.rst` より。方法は 2 つ:

### (a) cloud-config 経由（推奨）

> The suggested way of providing autoinstall configuration to the Ubuntu installer is via cloud-init.
> This allows the configuration to be applied to the installer without having to modify the installation media.

`#cloud-config` ヘッダが必須で、autoinstall のディレクティブはトップレベルの `autoinstall:` キーの下に置く。

```yaml
#cloud-config
autoinstall:
    version: 1
    ....
```

> `#cloud-config` files must contain the `#cloud-config` header to be recognized as a valid cloud configuration data file.

### (b) インストールメディア上の `autoinstall.yaml`

> Another option ... is to place a file named `autoinstall.yaml` on the installation media itself.
> The autoinstall configuration provided in this way is passed to the Ubuntu installer directly and
> **does not require the top-level `autoinstall:` key**.
>
> Starting in **24.04 (Noble)**, to be consistent with the cloud-config based format,
> a single top-level `autoinstall:` keyword **is allowed**.

置き場所は 2 つ:
- インストールメディアのルート（`casper` ディレクトリがあるパーティション）＝ **ISO9660 パーティション**
- インストールシステムのルートファイルシステム（ISO の改変が必要で非推奨）

カーネル引数 `subiquity.autoinstallpath=path/to/autoinstall.yaml` でも指定できる。

### 探索順序（公式ドキュメントと subiquity ソースが一致）

`subiquity/server/server.py` の実装（コメントと `locations` タプル）:

```python
# 1. command line argument autoinstall
# 2. kernel command line argument subiquity.autoinstallpath
# 3. autoinstall at root of drive
# 4. autoinstall supplied by cloud config
# 5. autoinstall baked into the iso, found at /cdrom/autoinstall.yaml

iso_autoinstall_path   = "cdrom/autoinstall.yaml"
root_autoinstall_path  = "autoinstall.yaml"
cloud_autoinstall_path = "run/subiquity/cloud.autoinstall.yaml"

locations = (
    self.opts.autoinstall,
    kernel_install_path,                              # subiquity.autoinstallpath
    self.base_relative(root_autoinstall_path),        # /autoinstall.yaml
    self.base_relative(cloud_autoinstall_path),       # /run/subiquity/cloud.autoinstall.yaml
    self.base_relative(iso_autoinstall_path),         # /cdrom/autoinstall.yaml
)
for loc in locations:
    if loc is not None and os.path.exists(loc):
        break
```

**本ツールが使うのは 4 番目（cloud-config 由来）。** ISO9660 パーティションは読み取り専用なので 5 番目には書けない。

## 2. カーネル引数 `autoinstall` は必須（最重要）

公式 quickstart（「別ボリュームで autoinstall を渡す」節）:

> This command boots the system and runs the installation.
> **The installer prompts for a confirmation before modifying the disk.
> To skip the need for a confirmation, interrupt the booting process, and add the `autoinstall` parameter to the kernel command line.**

subiquity の `subiquity/client/client.py` の実装（プロンプト文言そのもの）:

```python
async def noninteractive_confirmation(self):
    await asyncio.sleep(1)
    yes = _("yes")
    no = _("no")
    answer = no
    print(_("Confirmation is required to continue."))
    print(_("Add 'autoinstall' to your kernel command line to avoid this"))
    print()
    prompt = "\n\n{} ({}|{})".format(_("Continue with autoinstall?"), yes, no)
    while answer != yes:
        print(prompt)
        answer = await run_in_thread(input)
    await self.confirm_install()
```

`while answer != yes` のループなので、**`autoinstall` が無いと入力があるまで永久に止まる**。
無人インストールを名乗るには grub.cfg の改変（またはブート時の手入力）が避けられない。

## 3. cloud-init NoCloud が seed を見つける仕組み（ソースで確定）

`cloudinit/sources/DataSourceNoCloud.py`:

```python
def _get_devices(self, label):
    fslist = util.find_devs_with("TYPE=vfat")
    fslist.extend(util.find_devs_with("TYPE=iso9660"))

    label_list = util.find_devs_with("LABEL=%s" % label.upper())
    label_list.extend(util.find_devs_with("LABEL=%s" % label.lower()))
    label_list.extend(util.find_devs_with("LABEL_FATBOOT=%s" % label))

    devlist = list(set(fslist) & set(label_list))
    devlist.sort(reverse=True)
    return devlist
```

呼び出し側:

```python
label = self.ds_cfg.get("fs_label", "cidata")
if label is not None:
    for dev in self._get_devices(label):
        ...
        seeded = util.mount_cb(dev, _pp2d_callback, pp2d_kwargs)
        ...
        found.append(dev)
        break
```

ここから確定できること:

1. **既定ラベルは `cidata`。** 大文字 `CIDATA` と小文字 `cidata` の両方を blkid に問い合わせるので、
   FAT のボリュームラベル（BPB 上は大文字で保持される）に `CIDATA` と書けば必ず一致する。
2. **走査対象は `TYPE=vfat` または `TYPE=iso9660` の全ブロックデバイス。**
   デバイス単位でもパーティション単位でもなく、blkid が列挙するすべてが対象。
   → **ISO を raw 書き込みした USB の後ろに足した FAT パーティションも当然ヒットする。**
   これが「同一 USB 1 本で完結する」設計が成り立つ根拠。
3. **判定は「(vfat か iso9660) かつ (ラベル一致)」の積集合。** ISO9660 パーティション（ラベル
   `Ubuntu-Server ...`）は条件を満たさないので競合しない。
4. **`meta-data` は必須。** 公式 quickstart も `touch meta-data` としている。
   ファイルが無いと `util.mount_cb` の `pathprefix2dict` が `ValueError` を投げ、
   「not a valid seed」として無視される。中身は空でよい。
5. 複数見つかった場合は `sort(reverse=True)` の先頭 1 つだけを使い、`break` する。

公式 quickstart の「Using another volume to provide the autoinstall configuration」節は、
`cloud-localds ~/seed.iso user-data meta-data` で **ラベル `cidata` の ISO9660 ボリューム**を作り、
2 台目のドライブとして接続する手順。本ツールの FAT パーティション方式は同じ仕組みを
「同一 USB 内の別パーティション」で実現するもので、cloud-init 側の扱いは完全に同じ。

## 4. cloud-init と autoinstall の役割分担

`doc/explanation/cloudinit-autoinstall-interaction.rst`:

> While cloud-init may provide the autoinstall configuration to the Ubuntu installer,
> **it does not process the autoinstall directives itself.**
>
> Cloud-init runs in both the ephemeral system (during installation) and in the target system
> during first boot. Cloud-init then becomes inert for every subsequent reboot.

3 層の構造:

```yaml
#cloud-config
# ここの cloud-init ディレクティブ → インストール中の一時システムに効く
autoinstall:
    # ここ → Ubuntu インストーラが処理する（インストール先の構成）
    user-data:
        # ここの cloud-init ディレクティブ → インストール先の初回起動時に効く
```

## 5. `ds=nocloud` / `ds=nocloud-net` の書式

`DataSourceNoCloud.py` の `parse_cmdline_data`:

```python
pairs = (("ds=nocloud", sources.DSMODE_LOCAL), ("ds=nocloud-net", sources.DSMODE_NETWORK))
...
s2l = {"h": "local-hostname", "i": "instance-id", "s": "seedfrom"}
```

`seedfrom` のプロトコルで dsmode が上書きされる:

```python
if seedfrom.startswith(("http://", "https://", ...)):
    fill["dsmode"] = sources.DSMODE_NETWORK
elif seedfrom.startswith(("file://", "/")):
    fill["dsmode"] = sources.DSMODE_LOCAL
```

公式 quickstart のネットワーク版は `-append 'autoinstall ds=nocloud-net;s=http://_gateway:3003/'`。
**シェルの `-append` 引数としては `;` をそのまま書けるが、grub.cfg の中に書く場合は
GRUB が `;` をコマンド区切りとして解釈するため `\;` にエスケープする必要がある。**
本ツールは NoCloud のラベル自動検出を使うので `ds=` 自体を付けない（付ける場合はエスケープ関数
`nocloudSeedArg()` を通す）。

## 6. 完全無人になる条件（まとめ）

| バージョン | USB 構成 | カーネル引数 | 結果 |
|---|---|---|---|
| 22.04 / 24.04 / 25.10 / 26.04 | ISO raw + `CIDATA` FAT パーティション（`user-data` + `meta-data`） | `autoinstall` あり | **完全無人** |
| 同上 | 同上 | `autoinstall` なし | 「Continue with autoinstall? (yes\|no)」で永久停止 |
| 24.04 以降 | ISO を再構築して `/autoinstall.yaml` を同梱 | `autoinstall` あり | 完全無人（ただし ISO 再構築が必要なので本ツールでは採らない） |

`interactive-sections` を指定した場合は、指定したセクションで対話待ちになる（意図的な半自動）。

## 7. インストーラが残す記録

`subiquity/server/controllers/install.py`:

```python
autoinstall_path = os.path.join(self.app.root, "var/log/installer/autoinstall-user-data")
autoinstall_config = ("# ...\n" + yaml.dump({"autoinstall": self.app.make_autoinstall()}))
# As autoinstall-user-data contains a password hash, we want this file
write_file(autoinstall_path, autoinstall_config, mode=0o400, group="root")
```

インストール先の `/var/log/installer/autoinstall-user-data` に、実際に適用された設定が
**パーミッション 0400 で**残る。トラブル時はここを見る。パスワードハッシュを含む点に注意。

## 未解決（実機検証が必要）

- Windows が `CIDATA` パーティションにドライブレターを割り当てるか（GPT 属性 bit63 で抑止できるか）。
- `CIDATA` パーティションを追加した USB で、casper の「Checking disc integrity」が失敗しないか
  （md5sum.txt は ISO9660 パーティション内のみを対象とするので影響しないはずだが、実機確認が必要）。
- UEFI Secure Boot 有効時に grub.cfg 改変が問題にならないか（grub.cfg は署名対象ではないので
  理論上は問題ないが、実機確認が必要）。
