# Ubuntu live-server ISO 実測データ（HTTP Range による直接解析）

調査日: 2026-09-03。`docs/research/iso-probe/iso-probe.mjs` で releases.ubuntu.com から必要セクタのみ取得して解析した。
生データは `docs/research/iso-probe/<version>/report.json`、テスト用 sparse フィクスチャは `docs/research/iso-probe/fixtures/*.json`。

## 対象 ISO

| バージョン | ファイル | サイズ (bytes) | 512B セクタ数 | ISO9660 Volume ID | .disk/info |
|---|---|---|---|---|---|
| 22.04.5 | ubuntu-22.04.5-live-server-amd64.iso | 2,136,926,208 | 4,173,684 | `Ubuntu-Server 22.04.5 LTS amd64` | `Ubuntu-Server 22.04.5 LTS "Jammy Jellyfish" - Release amd64 (20240911.4)` |
| 24.04.4 | ubuntu-24.04.4-live-server-amd64.iso | 3,405,469,696 | 6,651,308 | `Ubuntu-Server 24.04.4 LTS amd64` | `Ubuntu-Server 24.04.4 LTS "Noble Numbat" - Release amd64 (20260210)` |
| 25.10 | ubuntu-25.10-live-server-amd64.iso | 2,283,360,256 | 4,459,688 | `Ubuntu-Server 25.10 amd64` | `Ubuntu-Server 25.10 "Questing Quokka" - Release amd64 (20251007.1)` |
| 26.04.1 | ubuntu-26.04.1-live-server-amd64.iso | 2,927,861,760 | 5,718,480 | `Ubuntu-Server 26.04.1 LTS amd64` | `Ubuntu-Server 26.04.1 LTS "Resolute Raccoon" - Release amd64 (20260826)` |

Volume ID の正規表現: `^Ubuntu-Server (\d+\.\d+(?:\.\d+)?)(?: LTS)? (amd64|arm64)$`

## パーティションテーブル（全バージョン共通の構造）

### MBR (LBA 0)
- GRUB2 の MBR ブートコード入り（先頭 440 バイトが非ゼロ）、ディスク署名 0。
- エントリ 1: type `0xEE`（**protective MBR**）、開始 LBA 1、サイズ = 総セクタ数 - 1。CHS 開始 `00 02 00`、終了 `3f e0 ff`。
- エントリ 2: status `0x80`、type `0x00`、LBA 0、1 セクタ（xorriso `--mbr-force-bootable` のダミー。BIOS によっては "active" フラグが無いと起動しないための細工）。
- エントリ 3, 4: 空。
- → Windows は 0xEE を見て **GPT を採用**する。追加パーティションは GPT に入れればよい（MBR に hybrid エントリは不要・むしろ入れてはいけない）。

### GPT (LBA 1〜63、バックアップは末尾)
| フィールド | 値 |
|---|---|
| Revision | 0x00010000 |
| HeaderSize | 92 |
| MyLBA / AlternateLBA | 1 / 最終 LBA |
| FirstUsableLBA | 64 |
| LastUsableLBA | 最終 LBA - 63 |
| PartitionEntryLBA | 2 |
| NumberOfPartitionEntries | **248** |
| SizeOfPartitionEntry | 128 |

248 × 128 = 31,744 バイト = 62 セクタ（LBA 2〜63）。バックアップは最終 LBA にヘッダ、その直前 62 セクタにエントリ配列。ISO 全体の末尾 63 セクタは GPT バックアップ領域であり ISO9660 のファイルデータは無い。

パーティション（例: 24.04.4）:

| # | Name | Type GUID | Start | End | Attributes |
|---|---|---|---|---|---|
| 1 | `ISO9660` | EBD0A0A2-B9E5-4433-87C0-68B6B72699C7 (Microsoft Basic Data) | 64 | 6,640,483 | 0x1000000000000001（bit0 platform-required + bit60 read-only） |
| 2 | `Appended2` | C12A7328-F81F-11D2-BA4B-00A0C93EC93B (EFI System) | 6,640,484 | 6,650,643 | 0 |
| 3 | `Gap1` | Microsoft Basic Data | 6,650,644 | 6,651,243 | 0x1000000000000001 |

- パーティション 2 = El Torito EFI ブートイメージ (efi.img) そのもの。FAT12、ラベル `ESP`、中身は `/EFI/BOOT/{BOOTX64.EFI, GRUBX64.EFI, MMX64.EFI}` のみ（**grub.cfg は無い**）。
- パーティション 3 "Gap1" は 600 セクタのパディング。
- ISO を USB に raw 書き込みすると、バックアップ GPT が「ディスク末尾」ではなく「ISO 末尾」に来る。CIDATA パーティションを追加する際は、ディスク末尾に新しいバックアップ GPT を書き、プライマリの AlternateLBA / LastUsableLBA を更新し、CRC を再計算する。

## ISO9660 構造
- PVD: セクタ 16。Volume Space Size は 2048B 単位（例 24.04.4: 1,662,827 = 6,651,308 × 512 / 2048）。
- セクタ 17: El Torito Boot Record（boot catalog LBA: 22.04.5=646, 24.04.4=998, 25.10=800）。
- セクタ 18: Joliet SVD（エスケープ `%/E`、UCS-2 **ビッグエンディアン**）。
- セクタ 19: 終端。
- ルートディレクトリ extent = **35**（全バージョン）、`boot/` = 38、`boot/grub/` = 39。ディレクトリレコードには Rock Ridge (SUSP) の `PX`, `TF`, `NM` がある。ISO9660 側の名前は `GRUB.CFG;1`、NM は `grub.cfg`。
- `boot/grub/grub.cfg` のレコードは `boot/grub` ディレクトリセクタ内オフセット 302（全バージョン）。Data Length は LE/BE 両エンディアンで格納（オフセット +10 / +14）。
- `boot/grub/x86_64-efi/`, `boot/grub/i386-pc/` には `.mod` と `.lst` のみで **grub.cfg は無い**。
- ISO9660 側にも `/EFI/boot/{bootx64.efi, grubx64.efi, mmx64.efi}` がある。
- `md5sum.txt`（ルート直下、22.04.5: 14,220B / 24.04.4: 30,133B / 26.04.1: さらに大）に `./boot/grub/grub.cfg` と `./boot/grub/loopback.cfg` の MD5 が含まれる。**grub.cfg を改変したら md5sum.txt の該当行（32 桁 hex、同じ長さ）も書き換える**。
- `casper/`: `vmlinuz`, `initrd`, （22.04/24.04 は `hwe-vmlinuz`, `hwe-initrd` も）、`ubuntu-server-minimal*.squashfs`、`install-sources.yaml`。

## El Torito boot catalog
- Validation entry (platform 0x00 = 80x86)、Initial entry: bootable, no-emulation, 4 セクタ, load RBA = catalog LBA + 1（`boot/grub/i386-pc/eltorito.img`）。
- Section header: platform 0xEF (EFI)、1 エントリ: no-emulation、sector count ≒ efi.img サイズ/512、load RBA = GPT パーティション 2 の開始 (512B LBA) / 4。

## grub.cfg 原文
- サイズ: 22.04.5 = 570B、24.04.4 = 573B、25.10 = 443B、26.04.1 = 394B。いずれも 2048B セクタ内に 1,400B 以上の空き（ファイル末尾以降はゼロ埋め）。
- 24.04.4:

```
set timeout=30

loadfont unicode

set menu_color_normal=white/black
set menu_color_highlight=black/light-gray

menuentry "Try or Install Ubuntu Server" {
	set gfxpayload=keep
	linux	/casper/vmlinuz  ---
	initrd	/casper/initrd
}
menuentry "Ubuntu Server with the HWE kernel" {
	set gfxpayload=keep
	linux	/casper/hwe-vmlinuz  ---
	initrd	/casper/hwe-initrd
}
grub_platform
if [ "$grub_platform" = "efi" ]; then
menuentry 'Boot from next volume' {
	exit 1
}
menuentry 'UEFI Firmware Settings' {
	fwsetup
}
else
menuentry 'Test memory' {
	linux16 /boot/memtest86+x64.bin
}
fi
```

- 25.10 / 26.04.1 は HWE エントリが無い（1 エントリのみ）。26.04.1 は 394B（`docs/research/iso-probe/26.04.1/grub.cfg`）。
- カーネル引数は `linux	/casper/vmlinuz  ---` の形式。`---` の前に `autoinstall` 等を挿入する。

## UEFI 起動経路と grub.cfg の探索
efi.img に grub.cfg が無い。Ubuntu の署名版 `grubx64.efi` は組み込み設定（grub2 の `debian/build-efi-images`）で
`$prefix` が存在しなければ `search --file --set=root /.disk/info` でボリュームを探し、`prefix=($root)/boot/grub` とし、
`$prefix/x86_64-efi/grub.cfg` → `$prefix/grub.cfg` の順に source する。したがって **BIOS / UEFI とも最終的に ISO9660 上の `/boot/grub/grub.cfg` を読む**。
追加する CIDATA パーティションに `.disk/info` を置いてはならない（search が誤ヒットする）。

## インプレース改変方式の成立条件（実装方針）
1. `boot/grub/grub.cfg` の extent セクタ（2048B）を新しい内容で書き換える（≤ 2048B。余りはゼロ）。
2. `boot/grub/` ディレクトリセクタ（extent 39）内のレコード（オフセット 302）の Data Length（LE @+10, BE @+14）を新サイズに更新。
3. Joliet ツリー側の同レコードも更新（Linux の iso9660 ドライバは Joliet を優先して使うため、`/cdrom/boot/grub/grub.cfg` を読むプロセスがあれば Joliet 経由になる）。
4. `md5sum.txt` の `./boot/grub/grub.cfg` 行の MD5 を新しい値に置換（同じ長さなのでレコード更新不要）。
5. これ以外のセクタは一切変更しない。GPG 署名 (`casper/SHA256SUMS.gpg`) は squashfs 等が対象で grub.cfg / md5sum.txt は含まれない。
