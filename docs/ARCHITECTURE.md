# アーキテクチャ（設計書・草稿）

Ubuntu Server の自動インストール USB を、Windows / macOS / Linux 上の GUI（Electron）から作成するツール。
本書は実装前の設計。調査結果（`docs/research/`）で確定した事実に基づく。未確定の項目は「要確認」と明記する。

## 1. 採用方式（結論）

### 1.1 USB レイアウト: 「ISO raw 書き込み + インプレース grub 改変 + CIDATA パーティション追加」

```
LBA(512B)  0          1..63           64 .......................... ISO末尾   +1MiB境界 ............ ディスク末尾-63 .. 末尾
           ┌─────┬──────────────┬────────────────────────────────┬────────┬───────────────────────┬─────────┬─────┐
           │ MBR │ GPT(primary) │ ISO9660 (part1) │ ESP(part2) │Gap1│(旧GPT│ CIDATA FAT (part4)    │GPT entr.│GPT  │
           │0xEE │ 248 entries  │ ← ISO ファイルをそのまま raw 書き込み → │ 消去) │ user-data / meta-data │(backup) │hdr  │
           └─────┴──────────────┴────────────────────────────────┴────────┴───────────────────────┴─────────┴─────┘
```

1. ISO ファイルを先頭からそのまま書く（Rufus の DD モード / Etcher と同じ）。BIOS/UEFI 起動の互換性は Ubuntu 公式イメージと同一。
2. ISO9660 内の `/boot/grub/grub.cfg` を **同一セクタ内でインプレース改変**し、`linux` 行に `autoinstall`（＋任意の追加引数）を挿入する。ディレクトリレコード（ISO9660 側と Joliet 側）の Data Length を更新し、`md5sum.txt` の該当行の MD5 も差し替える。ISO の再構築（xorriso）は不要。
3. ISO の後ろ（1 MiB 境界）に **FAT パーティション（ラベル `CIDATA`）** を追加し、`user-data` / `meta-data`（＋ユーザーの追加ファイル・監査レコード）を置く。cloud-init の NoCloud データソースがラベルで自動検出する。
4. GPT をディスクサイズに合わせて再構成する（AlternateLBA / LastUsableLBA 更新、4 番目のエントリ追加、CRC32 再計算、バックアップをディスク末尾へ）。MBR は protective のまま、サイズだけ更新。ISO 末尾にあった旧バックアップ GPT はゼロ埋め。
5. パーティションテーブル（MBR / プライマリ GPT）は**最後に**書く。途中で抜かれた USB が「正常なブート USB」に見えないようにするため。

利点: (a) ISO の改変が数セクタで済み、書き込み時間 ≒ ISO サイズ、(b) `CIDATA` は Windows / macOS からも普通のドライブとして見えるため、作成後に user-data を手で微修正できる、(c) ISO は再配布せずユーザーが自分でダウンロードしたものを使う（ライセンス・改変責任の切り分け）。

### 1.2 autoinstall の配信: cloud-init NoCloud（CIDATA ラベル）
- `user-data`: `#cloud-config` ヘッダ + `autoinstall:` トップキー配下に autoinstall 設定。
- `meta-data`: `instance-id: autoinstall-<uuid>` を含む最小内容（空でも可だがファイル自体は必須）。
- カーネル引数 `autoinstall` により "Continue with autoinstall?" プロンプトをスキップ（要確認: R2 の結論で最終決定）。`ds=nocloud` は不要（ラベル検出）。

### 1.3 出力先の 3 モード
1. **USB デバイス**（本命）: OS 別の昇格ワーカーが raw 書き込み → ベリファイ。
2. **イメージファイル（.img）**: 同じレイアウトをファイルに出力。検証・CI・後で `dd` する用途。
3. **設定ファイルのみ**: `user-data` / `meta-data` / `autoinstall.yaml` / 手順 README を ZIP 出力（Rufus 等を使う人向け）。

## 2. モノレポ構成

```
autoinstall-ui/
├── packages/shared/   @autoinstall/shared  — 純 TS 契約（Node 非依存。renderer からも import）
│   └── src/
│       ├── autoinstall/  model.ts(プロファイル型) generate.ts(→YAML) validate.ts(JSON Schema) presets.ts schema/*.json
│       ├── crypt/        sha512crypt.ts（WebCrypto ベース、$6$ ハッシュ）
│       ├── iso/          catalog.ts（Volume ID → バージョン/機能フラグ）
│       ├── i18n/         ja.ts en.ts index.ts（satisfies キー整合）
│       └── ipc/          types.ts（IPC リクエスト/レスポンス/進捗イベントの型）
├── packages/media/    @autoinstall/media   — 純 Node（Electron 非依存）のイメージエンジン
│   └── src/
│       ├── blockdev/     BlockDevice 抽象（File / Memory / SparseFixture / RawDevice）
│       ├── iso9660/      PVD/Joliet/RockRidge リーダ、ファイル位置特定
│       ├── grub/         grub.cfg 改変（引数挿入・検証）
│       ├── isopatch/     インプレース改変（レコード更新、md5sum.txt）
│       ├── gpt/          GPT/MBR パース・生成・CRC32
│       ├── fat/          FAT12/16/32 イメージ生成（VFAT LFN 対応）
│       ├── layout/       USB レイアウト計画（オフセット計算）→ WriteScript
│       ├── writer/       WriteScript 実行（進捗・ハッシュ・ベリファイ・キャンセル）
│       ├── platform/     デバイス列挙 / アンマウント / 昇格起動 / 後処理（win32, darwin, linux）
│       ├── worker/       昇格ワーカー本体 + NDJSON/TCP プロトコル
│       └── hash/         ストリーミング SHA-256、SHA256SUMS 照合
└── apps/desktop/      @autoinstall/desktop — Electron（electron-vite + React 19 + Tailwind 4 + zustand）
    └── src/ main/（ipc.ts, write-supervisor.ts, iso-service.ts, profiles.ts, worker-entry）
             preload/（contextBridge: window.autoinstall）
             renderer/（ウィザード UI, store, YAML プレビュー, 進捗）
```

`@autoinstall/shared` と `@autoinstall/media` は TS ソースのまま取り込む（electron-vite の externalize から除外）。

## 3. メディアエンジン詳細

### 3.1 BlockDevice
```ts
interface BlockDevice {
  readonly size: number            // bytes（不明なら -1: 例 ファイル新規作成時）
  read(offset: number, length: number): Promise<Buffer>
  write(offset: number, data: Buffer): Promise<void>   // 512B アライン必須（RawDevice）
  flush(): Promise<void>
  close(): Promise<void>
}
```
- `RawDevice`（`\\.\PhysicalDriveN`, `/dev/rdiskN`, `/dev/sdX`）: 書き込みは 512B 境界・512B 倍数に正規化するラッパを介す（`AlignedWriter`: 部分セクタは read-modify-write）。
- `MemoryBlockDevice`: テスト用 sparse。`SparseFixtureDevice`: `docs/research/iso-probe/fixtures/*.json` を読み、実 ISO の必要セクタだけを再現する（3 GB をダウンロードせずに実データでテストできる）。

### 3.2 WriteScript（すべての書き込みを宣言的に）
```ts
type WriteOp =
  | { kind: 'copy-file'; offset: number; path: string; length: number; patches: Patch[] }  // ISO 本体（パッチはストリーム中に適用）
  | { kind: 'bytes'; offset: number; data: Buffer; label: string }                          // GPT/MBR/FAT メタ等
  | { kind: 'file-data'; offset: number; path: string; length: number }                     // CIDATA 内のユーザーファイル
  | { kind: 'zero'; offset: number; length: number; label: string }
interface WriteScript { ops: WriteOp[]; totalBytes: number; finalOps: WriteOp[] /* パーティションテーブル: 最後 */ }
```
`patches: [{offset, data}]` は ISO ファイルの内容に対する差分（grub.cfg セクタ、ディレクトリレコード、md5sum.txt 行）。コピー中に該当チャンクを差し替えるので ISO ファイル自体は一切変更しない。
実行器は各 op の SHA-256 を計算し、ベリファイ段階で同じ範囲を読み戻して比較する。

### 3.3 ISO 解析と grub.cfg 改変
- `inspectIso(path)`: PVD Volume ID / `.disk/info` / grub.cfg 原文 / `casper/` 一覧 / GPT / サイズ → `IsoInfo`。サポート外（Desktop ISO、非 Ubuntu、Volume ID 不一致）は拒否し理由を返す。
- `patchGrubCfg(original, {args})`: 各 `linux`/`linuxefi` 行の ` ---` の直前に引数を挿入。既に `autoinstall` があれば二重挿入しない。結果 ≤ 2048B を検証（現状最大 573B + 引数）。
- `buildIsoPatches(isoInfo, newGrub)`: (1) grub.cfg extent セクタ（新内容 + ゼロ埋め）、(2) `boot/grub/` レコードの Data Length LE/BE、(3) Joliet 側レコード、(4) `md5sum.txt` の MD5。

### 3.4 GPT / MBR
- 実測: protective MBR（0xEE）、GPT 248 エントリ × 128B、FirstUsable 64。
- `rebuildGpt(isoGpt, diskSectors, cidata)`: エントリ配列を複製し、index 3 に CIDATA（Microsoft Basic Data、ユニーク GUID はランダム）を追加。パーティション 1（ISO9660）の属性に bit63（no drive letter）を立てるオプション（Windows の「フォーマットしますか」抑止）。
- CRC32: IEEE 802.3 反転多項式 0xEDB88320、初期値/最終 XOR 0xFFFFFFFF（zlib と同一 → `node:zlib` の `crc32`（Node 22+）を使う）。

### 3.5 FAT（CIDATA）
- 既定 64 MiB（追加ファイル合計 + 余裕から自動拡大、上限はディスク残量）。≤ 2 GiB は FAT16、超えると FAT32。
- VFAT LFN を実装（`user-data`, `meta-data` は 8.3 に収まらない）。短縮名は `USER-D~1` 形式、チェックサム算法は Microsoft FAT 仕様。
- ボリュームラベル `CIDATA`（BPB VolLab とルートディレクトリのラベルエントリ両方）。
- `.disk/info` は絶対に置かない（UEFI grub の `search --file /.disk/info` が誤ヒットする）。

### 3.6 プラットフォーム層（要確認: R5 の結論で最終決定）
| | Windows | macOS | Linux |
|---|---|---|---|
| 列挙 | `Get-Disk` + `Get-PhysicalDisk`（BusType=USB / SD, IsSystem, IsBoot, Size, FriendlyName, SerialNumber）。PowerShell を `-NoProfile` で spawn | `diskutil list -plist external physical` + `diskutil info -plist` | `lsblk -J -b -o NAME,PATH,SIZE,TYPE,TRAN,RM,HOTPLUG,MODEL,SERIAL,MOUNTPOINTS,VENDOR` |
| 事前処理 | `diskpart`: select disk N / clean（ボリュームのロック回避） | `diskutil unmountDisk force /dev/diskN` | `umount` 各マウントポイント（udisksctl があれば優先） |
| 書き込み先 | `\\.\PhysicalDriveN`（512B アライン） | `/dev/rdiskN`（raw、高速） | `/dev/sdX` / `/dev/nvmeXnY`（O_DIRECT は使わず、書き込み後 fsync） |
| 昇格 | `Start-Process -Verb RunAs`（自アプリ exe を `--usb-worker` 付きで起動） | `osascript 'do shell script ... with administrator privileges'`（`ELECTRON_RUN_AS_NODE=1` で worker.js 実行） | `pkexec env ELECTRON_RUN_AS_NODE=1 <app> worker.js ...`（無ければ `sudo -A`） |
| 事後 | `diskpart rescan` 不要（ハンドル close で再認識） | `diskutil eject`（任意） | `sync` + `udevadm settle` |
| 安全策 | IsSystem/IsBoot/BusType≠USB,SD は非表示 | internal / システムボリューム含むディスクは非表示 | `rm=0` かつ `tran≠usb` は非表示、`/` を含むディスクは非表示 |

昇格ワーカーは同じアプリバイナリ（Windows: `--usb-worker` モードで GUI なし起動 / macOS・Linux: `ELECTRON_RUN_AS_NODE` で `out/main/worker.js` を Node として実行）。ジョブは JSON ファイル、進捗は `127.0.0.1:<port>` の TCP へ NDJSON（トークン認証）。キャンセルは逆方向メッセージ。既に管理者/root ならプロセス内で実行。

## 4. autoinstall 生成モデル（GUI ↔ YAML）

GUI は「プロファイル」（`AutoinstallProfile`、JSON 保存可）を編集し、`generateAutoinstall(profile)` が決定的に YAML を生成する。YAML には各セクションの説明コメントを付けて、初心者が読んでも意味が分かるようにする。上級者向けに「生 YAML 上書き（マージ）」欄を用意し、最終出力は JSON Schema（subiquity 公式 `autoinstall-schema.json`、バージョン別に同梱）で検証する。

ウィザード（Raspberry Pi Imager 流）:
1. ISO 選択（自動判定・SHA256 照合）
2. 基本（言語・キーボード・タイムゾーン）
3. ユーザー（ホスト名・ユーザー名・パスワード→$6$ ハッシュ・SSH 鍵・SSH サーバ）
4. ネットワーク（DHCP / 固定 IP / 上級: netplan 直接）
5. ストレージ（対象ディスクの選び方・LVM/直接/ZFS・暗号化）
6. ソフトウェア（パッケージ・snap・更新方針・Ubuntu Pro）
7. インストール後（late-commands プリセット + 自由入力 / 初回起動 cloud-init / 追加ファイル）
8. 確認（YAML プレビュー・検証結果・警告・エクスポート）
9. 書き込み（デバイス選択・安全確認・進捗・ベリファイ・完了）

## 5. セキュリティ・商用要件
- パスワードは即座に SHA-512 crypt 化し、平文はメモリ上のフォーム状態にのみ保持。プロファイル JSON にはハッシュのみ保存。ログに出さない。
- renderer は `contextIsolation` + `sandbox`、CSP `connect-src 'self'`。ネットワーク（SHA256SUMS 取得、GitHub 鍵取得）は main 経由。
- 書き込み先は main 側の列挙結果に含まれるデバイス ID のみ受理（renderer からの任意パスは拒否）。
- 監査: CIDATA に `autoinstall-usb.json`（ツール版・ISO 名と SHA-256・プロファイルのハッシュ・作成日時）を残す。
- オフラインで完結（チェックサム照合はオンライン時のみ。無ければ警告つきで続行可）。
