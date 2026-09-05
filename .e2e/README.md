# GUI の E2E ヘルパ

本物の Electron アプリを、CDP の Input ドメイン経由で**実際のクリックとキー入力**で
操作するための道具。React の state を直接いじらないので、本番と同じ経路を通る。

## 使い方

アプリをデバッグポート付きで起動する:

```
npm run build
cd apps/desktop && npx electron out/main/index.js --remote-debugging-port=9333
```

別のシェルから:

| ファイル | 内容 |
|---|---|
| `full-run.mjs` | ISO 選択 → 基本設定 → ユーザーまでを埋める |
| `full-run2.mjs` | ネットワーク → ディスク → 実行時に決める → 上級者向け → 確認まで検証 |
| `start-write.mjs` | 書き込みステップまで進めて「書き込みを開始」を押す（UAC が出る） |
| `watch.mjs <秒>` | 書き込みの進捗を監視して状態変化だけを出す |
| `shot.mjs <path>` | 画面を PNG で保存する |
| `run-elevated.ps1 [write|worker]` | **実 USB への書き込み**を管理者権限で走らせる（UAC の承認が要る） |

`drive.mjs` が操作のヘルパ、`cdp.mjs` が最小の CDP クライアント。

### 各ステップの「詳しい設定」は折りたたまれている

ディスク・ネットワーク・ユーザー・ソフトウェア・インストール後の各ステップは、
細かい設定を `<Disclosure>`（「詳しい設定」「上級者向け」）の中に入れてある。
**既定は閉じていて、閉じている間は中身が DOM に存在しない**
（`{open && children}`）。したがって:

- 中の入力欄に触る前に `await d.openDisclosure()` を呼ぶ。
  呼ばずに `fillByPlaceholder` すると「入力欄が見つかりません」で落ちる。
- **表示文言で見出しを探さない。** 「詳しい設定」で探すと訳文を変えた瞬間に壊れ、
  しかも既に開いている折りたたみをクリックすると**閉じてしまう**。
  `openDisclosure` は `components/ui.tsx` が出す `data-disclosure` の目印で探し、
  `aria-expanded` を見て「閉じているものだけ」開く。
- 引数を省くと画面上の折りたたみを全部開く。何番目かを指定するなら
  `await d.openDisclosure(0)`。開けなかったら例外にするので、
  「開いたつもりで空振り」にはならない。

折りたたみの外にあるもの（ディスクの構成方法とディスクの指定、
ネットワークのモードと固定 IP、ユーザー名とパスワード）は、開かなくても触れる。

## 実 USB への書き込み

> **USB メモリの中身は消えます。** 書き込み先は「選択できる USB の先頭」を
> 自動で選ぶので、**消えて困る USB は先に抜いておくこと。**
> システムディスクと内蔵ディスクは `classifyDevice` が候補から外すため選ばれない。

管理者権限が必要。次のどちらかで実行する。

- `.e2e\run-elevated.ps1` を右クリック →「PowerShell で実行」
- 管理者の PowerShell で `npm run e2e:usb`

これらは `scripts/e2e-write-usb.mts` を呼ぶ。書いたあと同じデバイスを読み戻して、
MBR / GPT / ISO9660 / grub.cfg / CIDATA の中身まで検証する。

**GUI と同じ経路（昇格ワーカー + NDJSON）を通したいときは worker モードを使う。**

> worker モードは**ビルド成果物**（`apps/desktop/out/main/worker.js`）を使う。
> 先に `npm run build` を通しておくこと（無ければその旨を出して止まる）。

- `.e2e\run-elevated.ps1 worker` （右クリック実行なら引数を渡せないので、
  管理者の PowerShell から `powershell -File .e2e\run-elevated.ps1 worker`）
- 管理者の PowerShell で `npm run e2e:usb-worker`

こちらは `scripts/e2e-worker-usb.mts` を呼び、ジョブ JSON をワーカーへ渡して
進捗を 127.0.0.1 の TCP に NDJSON で受け取る。書き込み結果の検証に加えて、
hello / progress / done の疎通とワーカー側のデバイス再検証まで確かめる。

### ログの先頭を必ず見る

どちらのスクリプトも、実行開始時に次の 2 行を出す（`scripts/lib/git-revision.mts`）。
`run-elevated.ps1` のログでは 1〜2 行目になる。

```
実行  : scripts/e2e-worker-usb.mts  2026-09-05T07:06:27.431Z
HEAD  : 5ab2e7819e13c400310d9f79384e1982b3930c9d (uncommitted changes: 3 files)
```

**どのコードに対する結果なのかはここで確かめる。** 作業ツリーが汚れていれば
`(uncommitted changes: N files)` と付くので、その SHA を見に行っても
同じものは再現しない。git が使えない環境では `unknown` と出して続行する。
この情報を出すのはスクリプト側の 1 か所だけで、`run-elevated.ps1` は
ログへ流すだけ（二重に出さない）。

デバイスは省略すると「選択できる USB の先頭」を自動で選ぶ。
明示するなら 2 つ目の引数に `\\.\PhysicalDrive1` のように渡す
（バックスラッシュは 2 個ずつ必要）。

### 画面の文言をここに書き写さない

`full-run2.mjs` は長らく `/起動メニューの残り容量: (\d+) bytes/` を探していた。
i18n の作業で表示が `t('runtime.grubFreeBytes')` を通るようになり、
日本語では「610 バイト」になったため、**画面には出ているのにテストだけが落ちた**。

文言は辞書 (`packages/shared/src/i18n/ja.ts`) が正なので、
`import { ja as DICT } from '../packages/shared/src/i18n/ja.ts'` で引く。
書式や単位を訳文の周りに足した正規表現は、**訳文を変えた瞬間に静かに壊れる**。

**この壊れ方は機械では見張っていない。** 番人 (`e2e-placeholder-drift.test.ts`) が
見るのは placeholder の実在と `.catch(() => {})` の握り潰しだけで、
「訳文を包み込んだ正規表現」は見ていない
（ラベル用のリテラルと区別できず、誤検出だらけの番人になったので入れなかった）。
**ここを守るのは、このスクリプトを実際に走らせること。**

### 走らせ方（UAC は要らない）

書き込み以外は昇格が不要なので、`full-run.mjs` / `full-run2.mjs` は誰でも通せる。

```
npm run build
cd apps/desktop && npx electron out/main/index.js --remote-debugging-port=9333
# 別のシェルから、リポジトリのルートで:
node .e2e/full-run.mjs
node .e2e/full-run2.mjs
```

**リポジトリのルートから実行する**（`.e2e/` の中から走らせるとスクリーンショットの
保存先が `.e2e/.e2e/` になって落ちる）。

折りたたみが閉じている状態から確かめたいときは、先にアプリの状態を消す:

```
rm -f "$APPDATA/@autoinstall/desktop/settings.json"
rm -rf "$APPDATA/@autoinstall/desktop/profiles"
```
