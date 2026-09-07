import { basename, resolve } from 'node:path'
import { formatSize } from '@autoinstall/media'
import { localized, type LocalizedText } from '@autoinstall/shared'

// イメージファイル (.img) の保存先まわりの純粋な判定。
//
// ここに切り出してあるのは、**書き出す前に断る理由**をデバイスにも
// ファイルにも触らずに試せるようにするため（`write-supervisor` は実際に
// 数 GB を書くので、拒否条件だけを単体で確かめられる形にしておく）。
//
// 画面に出す文言は訳さずに `LocalizedText` で返す（main は利用者の言語を知らない）。

/** Windows では大文字小文字を区別しない。比較用に正規化する。 */
export function normalizePath(path: string): string {
  const abs = resolve(path)
  return process.platform === 'win32' ? abs.toLowerCase().replaceAll('/', '\\') : abs
}

/** 同じファイルを指しているか。**シンボリックリンクは追わない**（下の注意を参照）。 */
export function isSamePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b)
}

export interface DestinationCheck {
  /** 書き出し先（`chooseImagePath` が返したパス）。 */
  readonly imagePath: string
  /** ダイアログで選ばれた実績のある書き出し先の一覧。 */
  readonly allowedImagePaths: Iterable<string>
  /** これまでに開いた ISO のパス（今回の入力を含む）。 */
  readonly isoPaths: Iterable<string>
  /** 展開するファイルとして選ばれたパス。 */
  readonly payloadPaths: Iterable<string>
}

/**
 * 書き出してよい保存先か。断る理由があれば `LocalizedText` を、無ければ null を返す。
 *
 * 断るのは 3 つ:
 *   1. **ダイアログを通っていないパス**（落とし穴 55）。renderer から来た文字列を
 *      そのまま開かない。プロファイル JSON に書かれたパスを開く経路も作らない。
 *   2. **これまでに開いた ISO そのもの**。上書きすると、その場で入力が壊れる
 *      （書き出しは ISO を読みながら進むので、読んでいる最中のファイルを潰すことになる）。
 *      今回選ばれている 1 本だけでなく、開いた実績のある ISO をすべて守る
 *      ——ISO は作り直せない（再ダウンロードが要る）。
 *   3. **展開するファイル (payload)**。同じ理由で入力を壊す。
 *
 * シンボリックリンク／ハードリンクを経由した別名は見ていない（`realpath` は
 * ファイルが実在しないと解決できず、保存先はまだ無いことがある）。
 * これは取りこぼしであって誤検出ではない。
 */
export function checkImageDestination(input: DestinationCheck): LocalizedText | null {
  const target = normalizePath(input.imagePath)
  const allowed = [...input.allowedImagePaths].map(normalizePath)
  if (!allowed.includes(target)) return localized('image.pathNotChosen')

  for (const iso of input.isoPaths) {
    if (normalizePath(iso) === target) return localized('image.sameAsIso')
  }
  for (const payload of input.payloadPaths) {
    if (normalizePath(payload) === target) {
      // どのファイルとぶつかったかを出す。「別の名前にしてください」だけだと、
      // 何とぶつかっているのか分からない。
      return localized('image.overwritesPayload', { path: basename(payload) })
    }
  }
  return null
}

/**
 * 空き容量が足りているか。足りなければ `LocalizedText` を返す。
 *
 * **書き始める前に**見る。途中で ENOSPC になると中途半端な `.img` が残り、
 * 「焼いたのに起動しない」原因になる（このリポジトリは実際に %TEMP% を
 * 526 GB 埋めてテストを ENOSPC で落としている）。
 *
 * 空き容量が取れなかった環境 (`null`) では判定しない——**分からないことを
 * 「足りない」と言わない**。取れないだけで書けることは普通にある。
 */
export function checkFreeSpace(requiredBytes: number, freeBytes: number | null): LocalizedText | null {
  if (freeBytes === null || freeBytes >= requiredBytes) return null
  return localized('image.noSpace', {
    required: formatSize(requiredBytes),
    free: formatSize(freeBytes),
  })
}

/** Windows の予約名（拡張子を付けても使えない）。 */
const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
])

/**
 * 保存ダイアログの既定ファイル名を作る。
 *
 * 元にするのはプロファイル名とホスト名——どちらも**利用者の自由入力**なので、
 * パス区切り・`..`・制御文字・Windows で使えない文字をすべて落とす。
 * `defaultPath` に渡る値なので、ここを素通りさせると意図しないフォルダを既定にできる。
 */
export function suggestImageFileName(...candidates: readonly string[]): string {
  for (const raw of candidates) {
    const cleaned = raw
      // ソースを ASCII に保つため Unicode プロパティで書く（落とし穴 44）
      .replace(/[\p{Cc}\p{Cf}]/gu, '')
      // パス区切りと Windows で使えない文字
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\.img$/i, '')
      .trim()
      // 先頭・末尾のドットと空白は Windows が黙って落とすので、こちらで落とす
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 64)
    if (cleaned.length === 0) continue
    if (RESERVED.has(cleaned.toLowerCase())) continue
    return `${cleaned}.img`
  }
  return 'autoinstall.img'
}
