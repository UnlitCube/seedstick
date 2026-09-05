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

## 実 USB への書き込み

管理者権限が必要。次のどちらかで実行する。

- `.e2e\run-elevated.ps1` を右クリック →「PowerShell で実行」
- 管理者の PowerShell で `npm run e2e:usb`

これらは `scripts/e2e-write-usb.mts` を呼ぶ。書いたあと同じデバイスを読み戻して、
MBR / GPT / ISO9660 / grub.cfg / CIDATA の中身まで検証する。

**GUI と同じ経路（昇格ワーカー + NDJSON）を通したいときは worker モードを使う。**

- `.e2e\run-elevated.ps1 worker` （右クリック実行なら引数を渡せないので、
  管理者の PowerShell から `powershell -File .e2e\run-elevated.ps1 worker`）
- 管理者の PowerShell で `npm run e2e:usb-worker`

こちらは `scripts/e2e-worker-usb.mts` を呼び、ジョブ JSON をワーカーへ渡して
進捗を 127.0.0.1 の TCP に NDJSON で受け取る。書き込み結果の検証に加えて、
hello / progress / done の疎通とワーカー側のデバイス再検証まで確かめる。

デバイスは省略すると「選択できる USB の先頭」を自動で選ぶ。
明示するなら 2 つ目の引数に `\\.\PhysicalDrive1` のように渡す
（バックスラッシュは 2 個ずつ必要）。
