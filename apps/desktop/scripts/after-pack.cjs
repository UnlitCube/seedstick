// electron-builder の `afterPack` フック。本体とインストーラの両方の設定から呼ばれる。
//
// やることは 2 つ:
//
//   1. **FFmpeg をコーデック抜きの公式版に差し替える**（全 OS）
//   2. **macOS を ad-hoc 署名する**（darwin のみ。1 の後でなければならない）
//
// 1. FFmpeg の差し替え
// --------------------
// Electron が同梱する ffmpeg（Windows は ffmpeg.dll、macOS は libffmpeg.dylib、
// Linux は libffmpeg.so）は proprietary codecs 入りで、**H.264 と AAC のデコーダを含む**。
// H.264 は特許が存続している（調査は docs/LEGAL.md）。このアプリは動画も音声も扱わないので、
// Electron が同じリリースで配っている**コーデック抜きの ffmpeg**
// (`ffmpeg-v<version>-<platform>-<arch>.zip`) に置き換える。
// ファイル名も ABI も同じ差し替え用の部品として公式に配られているもの。
//
// 置き換えたら**ハッシュで確かめる**（落とし穴 137: 作れたことと入っていることは別）。
// 置き換え後のハッシュが公式 zip の中身と一致しなければ止める。
//
// 2. macOS の ad-hoc 署名
// -----------------------
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
// **署名は FFmpeg を差し替えた後に当てる。** フレームワークの中の dylib を
// 署名の後で変えると、署名が一致しなくなり Apple Silicon で起動しない。
//
// **本物の署名を有効にするときは 2 を外す**（`mac.identity` に Developer ID を書く）。
// ad-hoc 署名は本物の署名に上書きされるのではなく**競合する**ので、両立させない。
// 1 はそのまま残す（electron-builder の署名は afterPack の後に走るので、差し替えた
// dylib ごと正しく署名される）。

const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { inflateRawSync } = require('node:zlib')

/** electron-builder の Arch 列挙（builder-util）の値 → Electron の配布物の名前 */
const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * zip から 1 ファイルを取り出す。依存を増やさないため node:zlib だけで読む。
 * Electron の ffmpeg zip は「1 ファイル・deflate か無圧縮」なので、中央ディレクトリを
 * 読んで名前で引くだけで足りる。それ以外の形なら止める（黙って壊れた物を入れない）。
 */
function readZipEntry(zipPath, wanted) {
  const zip = readFileSync(zipPath)
  // End of central directory: 末尾 65557 バイト以内にある
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error(`zip の終端が見つからない: ${zipPath}`)
  const count = zip.readUInt16LE(eocd + 10)
  let p = zip.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error(`zip の中央ディレクトリが壊れている: ${zipPath}`)
    const method = zip.readUInt16LE(p + 10)
    const compSize = zip.readUInt32LE(p + 20)
    const size = zip.readUInt32LE(p + 24)
    const nameLen = zip.readUInt16LE(p + 28)
    const extraLen = zip.readUInt16LE(p + 30)
    const commentLen = zip.readUInt16LE(p + 32)
    const localOffset = zip.readUInt32LE(p + 42)
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    if (name === wanted) {
      const lNameLen = zip.readUInt16LE(localOffset + 26)
      const lExtraLen = zip.readUInt16LE(localOffset + 28)
      const start = localOffset + 30 + lNameLen + lExtraLen
      const raw = zip.subarray(start, start + compSize)
      const data = method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : null
      if (data === null) throw new Error(`zip の圧縮方式 ${method} には対応していない: ${name}`)
      if (data.length !== size) throw new Error(`展開したサイズが合わない: ${name} (${data.length} != ${size})`)
      return data
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  throw new Error(`zip に ${wanted} が無い: ${zipPath}`)
}

function ffmpegTarget(context) {
  const out = context.appOutDir
  switch (context.electronPlatformName) {
    case 'win32':
      return { file: join(out, 'ffmpeg.dll'), entry: 'ffmpeg.dll' }
    case 'linux':
      return { file: join(out, 'libffmpeg.so'), entry: 'libffmpeg.so' }
    case 'darwin':
      return {
        file: join(
          out,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Frameworks',
          'Electron Framework.framework',
          'Versions',
          'A',
          'Libraries',
          'libffmpeg.dylib',
        ),
        entry: 'libffmpeg.dylib',
      }
    default:
      throw new Error(`知らないプラットフォーム: ${context.electronPlatformName}`)
  }
}

async function replaceFfmpeg(context) {
  const version = context.packager.config.electronVersion ?? require('electron/package.json').version
  const arch = ARCH[context.arch]
  if (!arch) throw new Error(`知らないアーキテクチャ: ${context.arch}`)
  const target = ffmpegTarget(context)
  if (!existsSync(target.file)) throw new Error(`差し替え先の ffmpeg が無い: ${target.file}`)

  // Electron 本体の zip と同じキャッシュに入る（CI ではそのディレクトリを保存している）
  const { downloadArtifact } = require('@electron/get')
  const zipPath = await downloadArtifact({
    version,
    artifactName: 'ffmpeg',
    platform: context.electronPlatformName,
    arch,
  })
  const replacement = readZipEntry(zipPath, target.entry)
  const before = sha256(readFileSync(target.file))
  const want = sha256(replacement)
  writeFileSync(target.file, replacement)
  const after = sha256(readFileSync(target.file))
  if (after !== want) throw new Error(`ffmpeg の差し替えを確かめられない: ${target.file}`)
  process.stdout.write(
    `[after-pack] ffmpeg (no proprietary codecs) v${version} ${context.electronPlatformName}-${arch}\n` +
      `  ${target.file}\n  before ${before}\n  after  ${after}${before === after ? '  (same as before)' : ''}\n`,
  )
}

function adHocSign(context) {
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

/** @param {{electronPlatformName: string, appOutDir: string, arch: number, packager: {config: {electronVersion?: string}, appInfo: {productFilename: string}}}} context */
exports.default = async function afterPack(context) {
  await replaceFfmpeg(context)
  if (context.electronPlatformName === 'darwin') adHocSign(context)
}

// テストから zip の読み取りだけを使う
exports.readZipEntry = readZipEntry
