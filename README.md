# Seedstick

Ubuntu Server の**自動インストール USB** を、GUI で作るツール。
Windows / macOS / Linux で動きます（Electron）。

USB を挿してサーバーの電源を入れるだけで、ホスト名・ユーザー・ネットワーク・ディスク構成・
インストールするソフトウェア・インストール後の設定まで、すべて自動でセットアップされます。

```
┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐
│ ISO を選ぶ    │ → │ 設定を GUI で作る  │ → │ USB に書き込む     │
│ (公式 ISO)    │   │ (YAML を自動生成)  │   │ (安全確認つき)     │
└──────────────┘   └──────────────────┘   └──────────────────┘
```

## 特徴

- **初心者でも迷わない** — 10 ステップのウィザード。すべての項目に日本語の説明が付き、
  生成される YAML をその場で確認できます。
- **危険な設定を書き込み前に止める** — 「SSH のパスワード認証を切ったのに公開鍵が無い」など、
  サーバーに触れなくなる設定をエラーとして検出します。
- **システムディスクは選べない** — 内蔵ディスク・OS の入ったディスク・2 TB 超のドライブは
  一覧に出ません。書き込み前に「消去」の入力を求めます。
- **書き込み後に読み戻して検証** — 安価な USB メモリの不良を検出します。
- **ISO を再構築しない** — 数セクタのインプレース改変だけなので、書き込み時間は ISO のコピーと
  ほぼ同じです。ISO ファイル自体は一切変更しません。
- **設定を保存して使い回せる** — 名前を付けて保存し、あとから開いて修正できます。
  同じ構成のサーバーを何台も作るときに便利です。
- **インストール後まで自動化** — 追加ユーザーの作成、アプリの展開、systemd サービスの登録、
  apt full-upgrade、NVIDIA ドライバと CUDA の導入まで、GUI から設定できます。
- **1 本の USB を何台にも使い回せる** — ホスト名・IP・インストール先ディスクは、
  起動メニューから選ぶか、インストーラの画面で入力するかを項目ごとに選べます。
  `web01` `web02` … と並べておけば、挿して選ぶだけで機械ごとに違う値が入ります。
- **上級者向けの逃げ道** — netplan / curtin の YAML を直接書けます。生成結果に任意の YAML を
  マージすることもできます。
- **日本語 / 英語** — UI も、生成される YAML のコメントも切り替えられます。

## 動作の仕組み

USB は次のレイアウトになります。

```
 LBA0    1..63          64 ────────── ISO 末尾   1MiB境界 ──────── ディスク末尾
┌─────┬──────────────┬────────────────────────┬──┬──────────────┬──────────┐
│ MBR │ GPT (primary)│ ISO9660 │ ESP │ Gap1   │  │ CIDATA (FAT) │ GPT backup│
│0xEE │              │ ← 公式 ISO をそのまま →   │  │ user-data    │           │
└─────┴──────────────┴────────────────────────┴──┴──────────────┴──────────┘
```

1. 公式 ISO をそのまま raw 書き込みします（BIOS / UEFI の起動互換性は公式イメージと同一）。
2. ISO 内の `/boot/grub/grub.cfg` だけをインプレースで書き換え、カーネル引数に `autoinstall`
   を追加します。**これが無いと「Continue with autoinstall? (yes|no)」で止まります。**
3. ISO の後ろに `CIDATA` ラベルの FAT パーティションを足し、`user-data` / `meta-data` を置きます。

「起動メニューから選ぶ」を使うと、`grub.cfg` にホストごとの menuentry を足し、
`ai.hostname=web01` のようなカーネル引数を渡します。インストール開始直前に走る
`early-commands` がそれを読み、`/autoinstall.yaml` を **YAML として読み書きして**
該当箇所だけを差し替えます（autoinstall の設定は early-commands の後に読み直される、と
公式リファレンスに明記されています）。生成される YAML には最初から既定値が入っているので、
引数が無い既定のエントリで起動してもそのまま完走します。
`grub.cfg` は 1 セクタ (2048 バイト) に収める必要があるため、残り容量を画面に表示します。
   cloud-init の NoCloud データソースがこのラベルを自動で見つけます。
4. GPT をディスクサイズに合わせて作り直します。

`CIDATA` パーティションは Windows / macOS からも普通のドライブとして見えるので、
作成後に `user-data` を手で微修正することもできます。アプリのアーカイブを同梱した場合も
ここに入り、インストール時に `mount -L CIDATA` して展開します。

### インストール後にできること

| 項目 | いつ実行されるか |
|---|---|
| 追加ユーザーの作成（sudo・グループ・SSH 鍵） | インストール直後（再起動前） |
| ファイル / アーカイブの展開（USB 同梱） | インストール直後（再起動前） |
| systemd サービスの登録と有効化 | インストール直後（再起動前） |
| apt full-upgrade | インストール直後（再起動前） |
| URL からのダウンロードと展開 | 初回起動時（ネットワーク接続後） |
| NVIDIA ドライバ / CUDA の導入 | 初回起動時（完了後に自動再起動） |

詳しい根拠（一次資料からの引用と実測データ）は [docs/research/](docs/research/) にあります。

## 使い方

1. [Ubuntu 公式サイト](https://ubuntu.com/download/server)から **live-server** の ISO を
   ダウンロードします（このツールは ISO を同梱・再配布しません）。
2. アプリを起動し、ISO を選びます。
3. ウィザードに従って設定します。「確認」ステップで生成される YAML を確認できます。
   設定は「保存」しておけば、あとから開いて修正できます。
4. USB メモリを選び、「消去」と入力して書き込みます。

対応バージョン: Ubuntu Server **22.04 LTS / 24.04 LTS / 25.10 / 26.04 LTS**（amd64・arm64）
ただし NVIDIA ドライバ / CUDA の導入は amd64 (x86_64) の ISO のみ。

## 開発

```bash
npm install
npm run dev        # 開発起動（Windows なら start-dev.bat をダブルクリックでも可）
npm test           # typecheck + 単体テスト + 実 ISO スモークテスト
npm run dist:win   # パッケージ（macOS は dist:mac、Linux は dist:linux）
npm run dist:installer  # Windows 向けの Electron 製インストーラを 1 本の exe に
```

## 配布

出力物は **インストーラ**と**ポータブル版**の 2 つを、Windows と macOS の両方で作る。

| | インストーラ | ポータブル |
|---|---|---|
| Windows | `Seedstick-<v>-win-x64-Setup.exe` | `Seedstick-<v>-win-x64-portable.exe` |
| macOS | `Seedstick-<v>-mac-{x64,arm64}.dmg` | `Seedstick-<v>-mac-{x64,arm64}.zip` |

Windows のインストーラは**このユーザーにだけ**入れる（`%LOCALAPPDATA%\Programs`）ので
管理者権限が要らない。削除は Windows の「アプリと機能」から。
macOS の dmg は `/Applications` へドラッグする従来どおりの形。

### リリースのしかた

`CHANGELOG.md` の `## vNext` を `## v0.2.0` に直し、版番号を上げてタグを押す:

```bash
# 版番号は package.json だけでなくソースにも直書きされている。
# 上げ忘れは npm run test:unit が赤くして教える（version-consistency.test.ts）
npm run test:unit
git tag v0.2.0 && git push origin v0.2.0
```

`.github/workflows/release.yml` が Windows と macOS でビルドし、
6 つの成果物と `SHA256SUMS.txt` を GitHub Release に載せる。
**手動実行 (`workflow_dispatch`) はビルドが通るかを見るだけで、Release は作らない。**

### 署名していないことの影響

コード署名は保留している。そのため:

- **Windows**: 初回起動で SmartScreen の「WindowsによってPCが保護されました」が出る。
  「詳細情報」→「実行」で進める。
- **macOS**: Gatekeeper は通らない。Apple Silicon で起動できるように
  **ad-hoc 署名**だけは当ててある（`apps/desktop/scripts/after-pack.cjs`）が、
  隔離属性は自分で外す必要がある:

  ```bash
  xattr -dr com.apple.quarantine "/Applications/Seedstick.app"
  ```

  macOS Sequoia (15) 以降は **Control-クリック →「開く」での回避が廃止**されたので、
  システム設定 →「プライバシーとセキュリティ」から許可するか、上のコマンドを使う。

### 受け取り方（このリポジトリは Private）

**Private リポジトリの Release アセットは、ログインしていない第三者からは 404 になる**
（ブラウザでも `curl -LO` でも同じ）。受け取る人には次のどれかが要る:

- このリポジトリへの read 権限を持つ GitHub アカウント（`gh release download` が使える）
- または、配布専用の Public リポジトリに Release だけを置く（ソースは Private のまま）

`SHA256SUMS.txt` も同じ認証経路で配る以上、**改ざん検出ではなく破損検出**として読むこと。

| ドキュメント | 内容 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | アーキテクチャ、規約、落とし穴の台帳 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 設計の詳細 |
| [docs/research/R2-delivery-and-boot.md](docs/research/R2-delivery-and-boot.md) | autoinstall の配信方式（一次資料での裏取り） |
| [docs/research/ISO-FACTS.md](docs/research/ISO-FACTS.md) | 実 ISO の物理構造の実測データ |

## ライセンスと商標

本ツールは MIT ライセンスです。Ubuntu は Canonical Ltd. の登録商標であり、本ツールは
Canonical とは無関係です。Ubuntu の ISO イメージは同梱・再配布せず、利用者が公式サイトから
入手したものを使う設計にしています。
