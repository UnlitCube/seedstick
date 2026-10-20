# Seedstick

**Ubuntu Server の自動インストール USB を、GUI で作るツール。**
公式 ISO を選び、ウィザードに答えて、USB に書き込むだけ。
サーバーに挿して電源を入れれば、ホスト名・ユーザー・ネットワーク・ディスク構成・
ソフトウェア・インストール後の設定まで、人手を介さずに最後まで進みます。

Windows · macOS · Linux（Electron）· MIT ライセンス ·
[Web サイト](https://unlitcube.github.io/seedstick/ja/) · [English README](README.md)

```
┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐
│ ISO を選ぶ    │ → │ 設定を GUI で作る  │ → │ USB に書き込む     │
│ (公式 ISO)    │   │ (YAML を自動生成)  │   │ (安全確認つき)     │
└──────────────┘   └──────────────────┘   └──────────────────┘
```

> [!CAUTION]
> **このツールは 2 回消します。**
> 1. 書き込むと、選んだ **USB メモリの中身がすべて消えます**。
> 2. その USB から起動した機械は、**確認なしでインストール先のディスクを消去します**。
>    「無人インストール」とはそういう意味です。誰にも確認を求めません。
>
> 再インストールするつもりのない機械に挿さないよう USB に目印を付け、
> ディスクが複数ある機械では「いちばん大きいディスク」ではなく**シリアル番号**で
> インストール先を指定してください。本ツールは**無保証**です（[LICENSE](LICENSE)）。

## 特徴

- **10 ステップのウィザード。** すべての項目に説明が付き、生成される `autoinstall` の
  YAML をその場で確認できます（コメントも表示言語で付きます）。
- **危険な設定を書き込み前に止める。** 「SSH のパスワード認証を切ったのに公開鍵が無い」
  （サーバーに入れなくなる）や、Ubuntu 26.10 のインストーラが最後の段階で拒む
  形の崩れたパスワードハッシュなどをエラーとして検出します。
- **システムディスクは選べない。** 内蔵ディスク・OS の入ったディスク・2 TB 超のドライブは
  一覧に出ません。書き込み前に確認の語句の入力を求めます。
- **書き込み後に読み戻して検証。** 安価な USB メモリの不良を検出します。
- **ISO を再構築しない。** USB 上で数セクタを書き換え、小さな `CIDATA` パーティションを
  足すだけなので、書き込み時間は ISO のコピーとほぼ同じです。ISO ファイル自体は変更しません。
- **1 本の USB を何台にも使い回せる。** ホスト名・IP・インストール先ディスクは、
  固定 / 起動メニューから選ぶ（`web01` `web02` …）/ インストーラで入力、を項目ごとに選べます。
- **インストール後まで自動化。** 追加ユーザー、ファイルやアーカイブの展開（USB に同梱、
  または初回起動時にダウンロード）、systemd サービス、`apt full-upgrade`、
  NVIDIA ドライバと CUDA、RAID + LVM、NIC のボンディング。
- **上級者向けの逃げ道。** netplan / curtin の YAML を直接書けます。生成結果に任意の
  YAML を重ねることもできます。
- **設定を保存して使い回せる**（JSON）。
- **9 言語:** 日本語・English・简体中文・繁體中文・한국어・Español・Français・
  Deutsch・Português (Brasil)。[翻訳について](#翻訳)

## 対応する Ubuntu

| リリース | 状態 |
|---|---|
| 22.04 LTS (Jammy) | 対応 |
| 24.04 LTS (Noble) | 対応。VM で完走を確認（単一ディスク・RAID + LVM・ボンディング） |
| 25.10 (Questing) | 使えるが **2026 年 7 月にサポート終了**（画面で警告します） |
| 26.04 LTS (Resolute) | 対応 |
| 26.10 (Stonking) | 対応。VM で完走を確認（単一ディスク） |

**live-server** の ISO（amd64 / arm64）を使います。NVIDIA ドライバ / CUDA の導入は
amd64 の ISO かつ LTS のときだけ使えます（25.10 / 26.10 向けの CUDA リポジトリは
NVIDIA が公開していません）。

## ダウンロード

[Releases ページ](https://github.com/UnlitCube/seedstick/releases/latest)から最新版を
入手してください。各リリースに `SHA256SUMS.txt` が付きます。

| | インストーラ | ポータブル |
|---|---|---|
| Windows (x64) | `Seedstick-<v>-win-x64-Setup.exe` | `Seedstick-<v>-win-x64-portable.exe` |
| macOS (Intel / Apple Silicon) | `Seedstick-<v>-mac-{x64,arm64}.dmg` | `Seedstick-<v>-mac-{x64,arm64}.zip` |
| Linux (x64・試験的) | `Seedstick-<v>-linux-x64.deb` | `Seedstick-<v>-linux-x64.AppImage` |

Windows のインストーラは**今のユーザーにだけ**入れます（管理者権限は要りません）。
削除は「設定 → アプリ」から。USB への書き込みのときだけ管理者 / root の権限を求め、
アプリ本体は通常の権限で動きます。

### コード署名はまだしていません

- **Windows:** 初回起動で SmartScreen の「Windows によって PC が保護されました」が出ます。
  「詳細情報」→「実行」で進めてください。
- **macOS:** Gatekeeper に止められます。Apple Silicon で起動できるよう ad-hoc 署名は
  当ててありますが、隔離属性は自分で外す必要があります:

  ```bash
  xattr -dr com.apple.quarantine "/Applications/Seedstick.app"
  ```

  （macOS 15 Sequoia 以降は Control-クリック →「開く」での回避が廃止されたので、
  上のコマンドか「システム設定 → プライバシーとセキュリティ」から許可してください。）
- **Linux:** デバイスの列挙と `pkexec` による昇格は、まだ実機で確かめていません。
  報告を歓迎します。

## 使い方

1. [Ubuntu 公式サイト](https://ubuntu.com/download/server)から **live-server** の ISO を
   ダウンロードします（本ツールは Ubuntu のイメージを同梱・再配布しません）。
2. Seedstick を起動し、ISO を選びます。
3. ウィザードに従って設定します。「確認」ステップで生成される YAML と、見つかった問題を
   確認できます。使い回すなら設定を保存しておきます。
4. USB メモリを選び、確認の語句を入力して書き込みます。
   USB の代わりに `.img` ファイルとして保存し、あとで好きな道具で書くこともできます。

> [!NOTE]
> Seedstick で作った USB や `.img` には**改変した Ubuntu のイメージ**が入っています。
> 自分や組織の中で使うのは構いませんが、他の人へ配布しないでください。
> Canonical の[知的財産権ポリシー](https://ubuntu.com/legal/intellectual-property-policy)は、
> 改変したイメージを Ubuntu の商標のもとで再配布することを認めていません。

## 動作の仕組み

```
 LBA0    1..63          64 ────────── ISO 末尾   1MiB境界 ──────── ディスク末尾
┌─────┬──────────────┬────────────────────────┬──┬──────────────┬──────────┐
│ MBR │ GPT (primary)│ ISO9660 │ ESP │ Gap1   │  │ CIDATA (FAT) │ GPT backup│
│0xEE │              │ ← 公式 ISO をそのまま →   │  │ user-data    │           │
└─────┴──────────────┴────────────────────────┴──┴──────────────┴──────────┘
```

1. 公式 ISO をそのまま raw 書き込みします（BIOS / UEFI の起動互換性は公式イメージと同一）。
2. ISO 内の `/boot/grub/grub.cfg` だけをインプレースで書き換え、カーネル引数に
   `autoinstall` を足します（**無いと「Continue with autoinstall? (yes|no)」で止まります**）。
   `md5sum.txt` の該当行と Joliet のディレクトリレコードも合わせて直します。
3. ISO の後ろに `CIDATA` ラベルの FAT パーティションを足し、`user-data` / `meta-data` を
   置きます。cloud-init の NoCloud データソースがこのラベルを自動で見つけます。
4. GPT をディスクのサイズに合わせて作り直します。パーティションテーブルは最後に書くので、
   途中で抜かれた USB が「起動できそうに見える」状態にはなりません。

起動メニューで選んだ値はカーネル引数（`ai.hostname=web01` など）で渡り、
`early-commands` がインストール開始の直前に `/autoinstall.yaml` を **YAML として**
読み書きして差し替えます。生成する設定には最初から有効な既定値が入っているので、
既定のエントリで起動してもそのまま完走します。

設計の根拠（一次資料からの引用と、実 ISO の実測）は [docs/research/](docs/research/) にあります。

## ソースからビルドする

Node.js 22 以降。

```bash
npm install
npm run dev              # 開発起動（Windows なら start-dev.bat をダブルクリックでも可）
npm test                 # 型検査 + 単体テスト + 実 ISO のスモークテスト（ISO が無ければ飛ばす）
npm run dist:win         # Windows のポータブル版（他は dist:mac / dist:linux）
npm run dist:installer   # Windows のインストーラ（Setup.exe）
```

実 ISO の網羅試験、WSL2 上の QEMU での無人インストール、実 USB への書き込みなどの
検査は [CLAUDE.md](CLAUDE.md#開発コマンド)（開発者向けの記録）にまとめてあります。

## 翻訳

UI は日本語と英語で書いています。他の 7 言語は**英語から機械の助けを借りて訳した**もので、
差し込み・複数形・文字体系・全画面のはみ出しは機械で検査していますが、
**母語話者による確認はまだです**。直しを歓迎します
（[CONTRIBUTING.md](CONTRIBUTING.md#translations)）。

## 貢献とセキュリティ

- 不具合や要望: [Issues](https://github.com/UnlitCube/seedstick/issues)。
  [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。
- セキュリティの問題は非公開で報告してください: [SECURITY.md](SECURITY.md)
- 参加する人は [行動規範](CODE_OF_CONDUCT.md) に従ってください。

## ライセンスと商標

本ツールは [MIT ライセンス](LICENSE)です。第三者のライセンスは、各パッケージに
`THIRD_PARTY_NOTICES.txt` として同梱しています。

Seedstick は独立したオープンソースプロジェクトであり、Canonical Ltd. との提携・承認・
後援の関係はありません。Ubuntu および Canonical は Canonical Ltd. の登録商標です。
その他の名称は各所有者の商標です。詳しくは [docs/LEGAL.md](docs/LEGAL.md)。
