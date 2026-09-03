# Autoinstall USB Creator

Ubuntu Server の**自動インストール USB** を作る GUI ツール。Electron / Windows・macOS・Linux。
ISO を再構築せず、raw 書き込み + 数セクタのインプレース改変 + `CIDATA` パーティション追加で実現する。

## アーキテクチャ要点

```
autoinstall-ui/
├── packages/shared/   @autoinstall/shared  — 純 TS 契約（renderer からも import する）
│   ├── autoinstall/   プロファイル型・YAML 生成・検証・プリセット
│   ├── crypt/         validate.ts (ブラウザ可) / sha512crypt.ts (Node 専用・サブパス export)
│   ├── iso/           Volume ID → バージョン判定、リリースカタログ
│   ├── i18n/          ja.ts が原文、en.ts は satisfies でキー整合を強制
│   └── ipc/           window.autoinstall の型（main と renderer の唯一の契約）
├── packages/media/    @autoinstall/media   — Electron 非依存のイメージエンジン
│   ├── blockdev/      BlockDevice 抽象（File / Memory / SparseFixture / Raw）
│   ├── iso9660/       PVD・Joliet・RockRidge リーダ
│   ├── gpt/ fat/      GPT/MBR 読み書き、FAT12/16/32 生成（VFAT LFN 対応）
│   ├── grub/          grub.cfg のカーネル引数挿入
│   ├── isopatch/      インプレース改変のパッチ生成（ISO ファイル自体は変更しない）
│   ├── layout/        USB レイアウト計画（WriteScript）— 純粋な計算、デバイスに触れない
│   ├── writer/        WriteScript の実行・進捗・読み戻し検証
│   ├── platform/      デバイス列挙・アンマウント（win32 / darwin / linux）
│   └── worker/        昇格ワーカー本体と NDJSON プロトコル
└── apps/desktop/      @autoinstall/desktop — electron-vite + React 19 + Tailwind 4 + zustand
```

**データフロー**: GUI（プロファイル編集）→ `generateUserData()` → CIDATA の `user-data`。
ISO は `inspectIso()` で解析 → `buildIsoPatches()` で 4 か所のパッチ → `planUsbLayout()` で
書き込み指示書 → 昇格ワーカーが `executeWritePlan()` で実行。

**権限分離**: GUI 本体は通常権限。USB への書き込みだけを管理者/root の子プロセスに任せる
（`write-supervisor.ts` → `worker.ts`）。進捗は 127.0.0.1 の TCP に NDJSON、1 回限りのトークンで認証。

## 技術スタック

Electron 44 / electron-vite 5 / electron-builder 26 / Vite 7 / React 19 / Tailwind 4 /
zustand 5 / TypeScript 5.9 / vitest 4 / Node 22+（`node:zlib` の `crc32` を使うため）

## 必ず守る規約

- **renderer に Node の型を持ち込まない。** `@autoinstall/shared` のバレルは Node 非依存だけを
  export する。`node:crypto` を使う `sha512Crypt` は `@autoinstall/shared/crypt` サブパスから
  main だけが import する。`NodeJS.Platform` のような型も IPC 契約には書かない。
- **renderer から来た値は信用しない。** ISO パスは「ダイアログで選ばれた実績があるもの」、
  デバイス ID は「直近の列挙で selectable だったもの」だけを受け入れる（`ipc.ts` の
  `allowedIsoPaths` / `selectableDeviceIds`）。
- **平文パスワードを永続化しない。** GUI のフォーム状態にだけ置き、ハッシュ化は main で行う。
  プロファイル JSON・監査記録・ログには `$6$` ハッシュのみ。
- **危険な操作は列挙側でブロックする。** `classifyDevice()` を通っていないデバイスは UI に出さない。
  システムディスク・内蔵ディスク・2 TB 超は必ず `selectable: false`。
- **Switch には必ず明示的な boolean を渡す。** `undefined` を「既定」に使うと `JSON.stringify` が
  キーを落とし、二度と false に戻せなくなる。
- **モーダルは `createPortal` で `document.body` へ。** `transform` や `backdrop-filter` を持つ
  祖先があると `position: fixed` の基準がそこになり、画面中央に出ない。
- **大きな面に `backdrop-blur` を使わない。** 塗る面積に比例して GPU 負荷が上がり、全画面表示や
  進捗バー更新中に顕著に重くなる。ぼかしはモーダルの覆いだけ。
- i18n は `ja.ts` に足したら `en.ts` にも足す（`satisfies Record<MsgKey, string>` が強制する）。

## 落とし穴（経験済み・再発させない）

### ISO / メディア

1. **`autoinstall` カーネル引数が無いと無人インストールにならない。**
   subiquity の `client.py` は `while answer != yes` で入力を待ち続ける（「Continue with
   autoinstall? (yes|no)」）。grub.cfg の改変は「あると便利」ではなく**必須**。
2. **26.04 の grub.cfg はタブではなくスペース区切り。** 22.04〜25.10 は `\tlinux\t/casper/vmlinuz`、
   26.04 は `    linux  /casper/vmlinuz`。空白に依存した解析は 26.04 で壊れる。
   26.04 には memtest の menuentry も無い。
3. **Joliet のディレクトリレコードも更新しないと壊れる。** Linux の iso9660 ドライバは Joliet を
   優先して読む。ISO9660 側だけ Data Length を直すとサイズが食い違う。
   Joliet 名は UCS-2 **ビッグエンディアン**で、`Buffer.swap16()` は**破壊的**。
   `subarray` は元バッファを共有するので、必ず `Buffer.from()` でコピーしてから呼ぶ。
   `.` / `..` は 1 バイト（0x00 / 0x01）なので `swap16` が例外を投げる。個別に処理する。
4. **`md5sum.txt` の該当行も更新する。** grub.cfg を変えたら `./boot/grub/grub.cfg` の MD5 を
   差し替える。32 桁 hex なので長さは変わらず、レコードの更新は不要。
5. **ISO 末尾の古いバックアップ GPT を消す。** ISO を raw 書き込みすると「ディスク末尾ではない
   場所」に GPT のバックアップが残り、OS が壊れていると判断する。ゼロで潰し、ディスク末尾に
   書き直す。
6. **パーティションテーブルは最後に書く。** 先頭で LBA 0 をゼロにし、本体を全部書いてから
   MBR/GPT を書く。途中で抜かれた USB が「起動可能に見えるが壊れている」状態にならない。

### FAT / CIDATA

7. **FAT の種類を先に決めてからクラスタサイズを選ぶ。** 逆にすると 64 MiB が FAT32 になる
   （クラスタ 1 セクタで 131072 個 → FAT32 レンジ）。目標種別のクラスタ数レンジに収まる
   最小のクラスタサイズを選ぶのが正しい順序。
8. **`user-data` / `meta-data` は 8.3 名に収まらないので VFAT LFN が必須。**
   短縮名は `USER-D~1`。LFN エントリはディスク上「逆順」に置く。
9. **cloud-init は `TYPE=vfat` または `iso9660` の全ブロックデバイスからラベル `cidata` を探す**
   （`DataSourceNoCloud._get_devices`）。だから同一 USB 内の別パーティションでも見つかる。
   `meta-data` が無いと「not a valid seed」として無視される（空でよい）。
10. **CIDATA に `.disk/info` を置かない。** UEFI の署名版 grubx64.efi は
    `search --file /.disk/info` でボリュームを探すため、誤ヒットする。

### プラットフォーム

11. **Windows の `\\.\PhysicalDriveN` はセクタ境界・セクタ長でしか読み書きできない。**
    違反すると EINVAL になり原因が分かりにくい。部分セクタは read-modify-write する。
12. **Windows 8 以降、マウント済みボリュームがあるディスクには書けない。** `diskpart` の
    `clean` でボリュームを外してから書く。
13. **昇格した子プロセスの標準出力は親から読めない。** `Start-Process -Verb RunAs` がその代表。
    進捗は 127.0.0.1 の TCP に NDJSON で流す（それがこの設計の理由）。
14. **`ELECTRON_RUN_AS_NODE=1` を付けないと GUI がもう一つ開く。** ワーカーは Electron バイナリを
    素の Node として実行する。
15. **Windows では `child.kill()` が孫プロセスを取り残す。** 昇格した実体は孫になるので
    `taskkill /pid <pid> /T /F` でツリーごと落とす。

### ビルド / テスト

16. **electron-vite の renderer `build.outDir` は相対パスの解決先が直感と食い違う。**
    `resolve(import.meta.dirname, 'out/renderer')` と絶対パスで書かないとリポジトリルートに逃げる。
17. **npm workspaces + electron-builder は「Cannot compute electron version」で落ちる。**
    `require('electron/package.json').version` を `-c.electronVersion=` で明示的に渡す
    （`apps/desktop/scripts/dist.mjs`）。
18. **`expect(promise).rejects` に巨大なオブジェクトを渡すと vitest が OOM する。**
    解決してしまった場合に pretty-format が 64 MiB の Buffer を含むオブジェクトを整形しようとして
    ヒープを使い切る。自前で try/catch して小さい値だけを assert する。
19. **統合テストは 3 GB 級のイメージを扱うので `maxWorkers: 2` / `fileParallelism: false`。**
    並列度を上げるとワーカーがメモリ不足で落ちる。
20. **Git Bash から Windows ネイティブ実行ファイルに渡す引数は ANSI コードページに変換される。**
    `openssl passwd -6 "パスワード漢字"` の結果が UTF-8 前提の実装と食い違った。
    テストベクタは UTF-8 バイトを明示できる経路で作る。

## 検証していないこと（実機確認が必要）

- 実際の USB メモリへの書き込み（`.img` ファイルへの書き出しまでは実 ISO で検証済み）
- 実機／VM からの起動と、完全無人インストールの完走
- Windows が `CIDATA` にドライブレターを割り当てるか（GPT bit63 で ISO9660 側は隠している）
- macOS / Linux でのデバイス列挙と権限昇格（コードは書いたが実機未確認）

## 開発コマンド

| コマンド | 内容 |
|---|---|
| `start-dev.bat` | ダブルクリックで開発起動（初回は npm install も実行） |
| `npm run dev` | electron-vite dev（renderer は HMR。main を触ったら再起動が必要） |
| `npm run build` | electron-vite build → `apps/desktop/out/` |
| `npm run typecheck` | 4 つの tsconfig をすべて検査 |
| `npm run test:unit` | vitest（実 ISO から抜いた疎なフィクスチャを使う） |
| `npm run smoke` | **実 ISO ファイル**を読んで `.img` に書き出し、読み戻して検証 |
| `npm test` | typecheck + unit + smoke |
| `npm run dist:win` / `dist:mac` / `dist:linux` | electron-builder でパッケージ |

`npm run smoke` は `~/images`・`~/Downloads`・`C:/iso`・`/var/lib/iso` から ISO を探す。
明示するなら `npm run smoke -- <iso のパス>`。ISO が無ければスキップして正常終了する。

## ポート

このアプリは固定ポートを使わない。書き込み進捗の受信に 127.0.0.1 の**動的ポート**（`listen(0)`）を
1 回の書き込みごとに開き、終了時に閉じる。
