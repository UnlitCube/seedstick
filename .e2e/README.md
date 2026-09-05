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
| `run-elevated.ps1` | **実 USB への書き込み**を管理者権限で走らせる（UAC の承認が要る） |

`drive.mjs` が操作のヘルパ、`cdp.mjs` が最小の CDP クライアント。

## 実 USB への書き込み

管理者権限が必要。次のどちらかで実行する。

- `.e2e\run-elevated.ps1` を右クリック →「PowerShell で実行」
- 管理者の PowerShell で `npm run e2e:usb`

どちらも `scripts/e2e-write-usb.mts` を呼ぶ。書いたあと同じデバイスを読み戻して、
MBR / GPT / ISO9660 / grub.cfg / CIDATA の中身まで検証する。
