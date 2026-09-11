// electron-builder の `afterPack` フック。**macOS を ad-hoc 署名するためだけに在る。**
//
// なぜ要るか
// ----------
// Apple Silicon は **署名の無い実行ファイルを起動しない**（x86_64 は起動する）。
// 正式な署名は保留しているので、証明書の要らない **ad-hoc 署名** (`codesign --sign -`)
// を当てて「起動はできる」状態にする。Gatekeeper は通らないので、
// 利用者は初回だけ隔離属性を外す必要がある（README に手順がある）。
//
// **electron-builder 任せにしない理由。**
// 26.15.3 は証明書が見つからないとき署名を丸ごと飛ばす（自動 ad-hoc の
// フォールバックは 26 系で廃止された）。`mac.identity: null` はその「飛ばす」を
// 明示する設定で、`hardenedRuntime` も entitlements も読まれなくなる。
// つまり **何も署名されない .app** が出来る。ここで自分で当てる。
//
// **署名を有効にするときはこのフックを外す**（`electron-builder.json` の
// `afterPack` を消し、`mac.identity` に本物の Developer ID を書く）。
// ad-hoc 署名は本物の署名に上書きされるのではなく**競合する**ので、両立させない。
//
// Windows / Linux では何もしない（`return` するだけ）。

const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

/** @param {{electronPlatformName: string, appOutDir: string, packager: {appInfo: {productFilename: string}}}} context */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)

  // `--deep` は Apple が非推奨にしているが、**ad-hoc で入れ子のフレームワークまで
  // まとめて署名する手段は他に無い**（本物の署名では 1 つずつ署名する）。
  // `--force` は Electron が最初から持っている署名を置き換えるために要る
  // （app.asar を足して Info.plist を書き換えた時点で、元の署名はもう一致しない）。
  const sign = spawnSync('codesign', ['--force', '--deep', '--sign', '-', app], {
    stdio: 'inherit',
  })
  if (sign.status !== 0) {
    throw new Error(`ad-hoc 署名に失敗しました (exit ${sign.status}): ${app}`)
  }

  // **付いたことを確かめる。** ログに残すのは「やった」ではなく「こうなった」。
  // 文言を決め打ちで判定しない（落とし穴 126）。出力をそのまま残して、
  // 判定は `--verify` の終了コードで行う。
  const shown = spawnSync('codesign', ['-dv', '--verbose=4', app], { encoding: 'utf8' })
  process.stdout.write(`[after-pack] codesign -dv:\n${shown.stderr ?? ''}${shown.stdout ?? ''}\n`)

  const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', app], {
    encoding: 'utf8',
  })
  if (verify.status !== 0) {
    throw new Error(
      `ad-hoc 署名を当てたのに検証が通りません (exit ${verify.status}): ` +
        `${verify.stderr ?? ''}${verify.stdout ?? ''}`,
    )
  }
  process.stdout.write(`[after-pack] codesign --verify: ok  ${app}\n`)
}
