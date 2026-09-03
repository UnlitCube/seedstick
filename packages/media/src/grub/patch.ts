// grub.cfg のカーネル行に autoinstall 用の引数を挿入する。
//
// 実測した Ubuntu live-server の grub.cfg は、バージョンによって書式が違う:
//   22.04 / 24.04 / 25.10 : "\tlinux\t/casper/vmlinuz  ---"
//   26.04                 : "    linux  /casper/vmlinuz  --- "  (タブではなくスペース、末尾に空白)
// したがって空白に依存しない解析が必須。
//
// `---` は「ここから先はインストール済みシステムのカーネルへ渡す」という区切り。
// autoinstall の引数はライブ環境（casper / subiquity）に効かせたいので `---` の *前* に入れる。

export interface GrubPatchOptions {
  /** 追加するカーネル引数（例 `['autoinstall']`）。既にある引数は重複させない。 */
  readonly args: readonly string[]
  /** true なら menuentry のタイトルに印を付けて、自動インストール用と分かるようにする */
  readonly markTitle?: boolean
  /** メニューのタイムアウト秒。null なら変更しない。 */
  readonly timeout?: number | null
}

export interface GrubPatchResult {
  readonly text: string
  /** 引数を挿入した linux 行の数 */
  readonly patchedLines: number
  /** タイトルを書き換えた menuentry の数 */
  readonly patchedTitles: number
}

/** `linux` / `linuxefi` / `linux16` で始まるカーネル行にマッチする。 */
const KERNEL_LINE_RE = /^(\s*)(linux|linuxefi|linux16)(\s+)(\S+)(.*)$/

/** 引数列を空白で分割する（クォートは Ubuntu の grub.cfg では使われていない）。 */
function splitArgs(s: string): string[] {
  return s.split(/\s+/).filter(Boolean)
}

/** `key=value` の key 部分を取り出す（重複判定に使う）。 */
function argKey(arg: string): string {
  const i = arg.indexOf('=')
  return i < 0 ? arg : arg.slice(0, i)
}

/**
 * カーネル行に引数を追加する。
 * `---` があればその直前に、無ければ行末に追加する。
 */
function patchKernelLine(line: string, args: readonly string[]): { line: string; changed: boolean } {
  const m = KERNEL_LINE_RE.exec(line)
  if (!m) return { line, changed: false }
  const [, indent, keyword, gap, kernelPath, rest] = m as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
  ]

  // memtest など casper 以外のカーネルは対象外（autoinstall を渡しても意味がない）
  if (!kernelPath.includes('/casper/')) return { line, changed: false }

  const sepIndex = rest.indexOf('---')
  const before = sepIndex >= 0 ? rest.slice(0, sepIndex) : rest
  const after = sepIndex >= 0 ? rest.slice(sepIndex) : ''

  const existing = splitArgs(before)
  const existingKeys = new Set(existing.map(argKey))
  const toAdd = args.filter((a) => !existingKeys.has(argKey(a)))
  if (toAdd.length === 0) return { line, changed: false }

  const merged = [...existing, ...toAdd].join(' ')
  const rebuilt =
    sepIndex >= 0
      ? `${indent}${keyword}${gap}${kernelPath} ${merged} ${after.trimEnd()}`
      : `${indent}${keyword}${gap}${kernelPath} ${merged}`
  return { line: rebuilt, changed: true }
}

const MENUENTRY_RE = /^(\s*menuentry\s+)(["'])(.*?)\2(.*)$/

/** grub.cfg にカーネル引数を挿入する。 */
export function patchGrubCfg(original: string, options: GrubPatchOptions): GrubPatchResult {
  const lines = original.split('\n')
  let patchedLines = 0
  let patchedTitles = 0
  const out = lines.map((line) => {
    if (options.timeout !== null && options.timeout !== undefined) {
      const t = /^(\s*set\s+timeout=)(\d+)(\s*)$/.exec(line)
      if (t) return `${t[1]}${options.timeout}${t[3]}`
    }
    const k = patchKernelLine(line, options.args)
    if (k.changed) {
      patchedLines++
      return k.line
    }
    if (options.markTitle) {
      const t = MENUENTRY_RE.exec(line)
      if (t && !t[3]!.includes('[Autoinstall]')) {
        patchedTitles++
        return `${t[1]}${t[2]}${t[3]} [Autoinstall]${t[2]}${t[4]}`
      }
    }
    return line
  })
  return { text: out.join('\n'), patchedLines, patchedTitles }
}

/** 何行が対象になるか（事前検証用）。0 なら ISO の構造が想定と違う。 */
export function countPatchableKernelLines(original: string): number {
  return original
    .split('\n')
    .filter((line) => {
      const m = KERNEL_LINE_RE.exec(line)
      return m !== null && m[4]!.includes('/casper/')
    }).length
}

/**
 * NoCloud で読ませる seed の指定をカーネル引数にする。
 *
 * GRUB の設定ファイルでは `;` がコマンド区切りとして解釈されるため、
 * `ds=nocloud;s=/cdrom/` はそのままだと壊れる。`\;` とエスケープする必要がある。
 * （grub.cfg の中に書く場合のみ。ブートプロンプトで手入力する場合は不要。）
 */
export function nocloudSeedArg(source: string): string {
  return `ds=nocloud\\;s=${source}`
}
