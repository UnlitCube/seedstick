// grub.cfg のカーネル行に autoinstall 用の引数を挿入する。
//
// 実測した Ubuntu live-server の grub.cfg は、バージョンによって書式が違う:
//   22.04 / 24.04 / 25.10 : "\tlinux\t/casper/vmlinuz  ---"
//   26.04                 : "    linux  /casper/vmlinuz  --- "  (タブではなくスペース、末尾に空白)
// したがって空白に依存しない解析が必須。
//
// `---` は「ここから先はインストール済みシステムのカーネルへ渡す」という区切り。
// autoinstall の引数はライブ環境（casper / subiquity）に効かせたいので `---` の *前* に入れる。

/** 追加する menuentry（ホストごとのプリセットなど）。 */
export interface ExtraMenuEntry {
  readonly title: string
  /** この項目だけに付けるカーネル引数（`args` に加えて付く） */
  readonly args: readonly string[]
}

export interface GrubPatchOptions {
  /** 追加するカーネル引数（例 `['autoinstall']`）。既にある引数は重複させない。 */
  readonly args: readonly string[]
  /** true なら menuentry のタイトルに印を付けて、自動インストール用と分かるようにする */
  readonly markTitle?: boolean
  /** メニューのタイムアウト秒。null なら変更しない。 */
  readonly timeout?: number | null
  /** ホストごとの menuentry を先頭に追加する */
  readonly extraEntries?: readonly ExtraMenuEntry[]
  /**
   * `set default=<n>` を挿して、放置したときに選ばれる項目を変える。
   *
   * **製品の書き込み経路では使わない（`undefined` のまま）。**
   * 既定を「元の項目」から動かすと、タイムアウトまで放置しただけで
   * 全台が同じホスト名・同じ IP を掴む（落とし穴 51 / 27）。
   * `buildIsoPatches` を呼ぶ側で意図的に渡したときだけ効く。
   *
   * **これは VM 検証のためにある**（`scripts/e2e-vm.mts` の `--ip` モード）。
   * 「起動メニューで選んだ値が subiquity に届くか」を、
   * 人が矢印キーを押さずに確かめるのに要る。
   *
   * > **メニューをシリアルから操作すること自体はできる。**
   * > grub.cfg に `terminal_output serial` は無いが、**OVMF が EFI の
   * > コンソールをシリアルに多重化する**ので、GRUB のメニューは
   * > ANSI の全画面描画としてシリアルに出る。矢印キーと Enter を流し込めば
   * > 別の項目を選んで起動させられる（実測。BIOS 起動では 1 バイトも出ない）。
   * > それでも `set default=` を使うのは、キー入力が
   * > **「メニューが出るまで何秒待つか」に依存する**からで、
   * > 負荷で描画が遅れると静かに別の項目を選ぶ。既定を書けば決定的になる。
   *
   * 番号ではなく `set default="<タイトル>"` も効く（実測）。
   * 番号はリリースによって Ubuntu 側の項目数が変わると意味が変わるが、
   * **追加した項目は必ず最初の menuentry の直後**に入るので、
   * 追加分を指すぶんには番号で安定する。
   */
  readonly defaultEntry?: number | null
}

export interface GrubPatchResult {
  readonly text: string
  /** 引数を挿入した linux 行の数 */
  readonly patchedLines: number
  /** タイトルを書き換えた menuentry の数 */
  readonly patchedTitles: number
  /** 追加した menuentry の数 */
  readonly addedEntries: number
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

/** GRUB のタイトルに使えるようエスケープする（" と \ のみ意味を持つ）。 */
function grubTitle(title: string): string {
  return title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * 既存の casper エントリを雛形に、ホストごとの menuentry を組み立てる。
 * カーネルと initrd の行はそのまま流用するので、バージョン差（HWE の有無など）に影響されない。
 */
/**
 * `menuentry` ブロックの終わり（閉じ `}` の次の行）を返す。
 * 中括弧の深さを数える。見つからなければ -1。
 */
function findEntryEnd(lines: readonly string[], start: number): number {
  let depth = 0
  let seenOpen = false
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!
    for (const ch of line) {
      if (ch === '{') {
        depth++
        seenOpen = true
      } else if (ch === '}') depth--
    }
    if (seenOpen && depth <= 0) return i + 1
  }
  return -1
}

function buildExtraMenuBlocks(
  original: string,
  entries: readonly ExtraMenuEntry[],
  baseArgs: readonly string[],
): string[] {
  const lines = original.split('\n')
  const kernelIndex = lines.findIndex((l) => {
    const m = KERNEL_LINE_RE.exec(l)
    return m !== null && m[4]!.includes('/casper/')
  })
  if (kernelIndex < 0) return []
  const kernelLine = lines[kernelIndex]!
  // 直後の initrd 行を探す（間に何も無いのが実測の形）
  const initrdLine = lines.slice(kernelIndex + 1, kernelIndex + 4).find((l) => /^\s*initrd\s/.test(l))
  if (!initrdLine) return []
  const gfx = lines
    .slice(Math.max(0, kernelIndex - 3), kernelIndex)
    .find((l) => /gfxpayload/.test(l))

  return entries.map((e) => {
    const patched = patchKernelLine(kernelLine, [...baseArgs, ...e.args])
    return [
      `menuentry "${grubTitle(e.title)}" {`,
      ...(gfx ? [gfx] : []),
      patched.changed ? patched.line : kernelLine,
      initrdLine,
      '}',
    ].join('\n')
  })
}

/**
 * casper のカーネルを起動する `menuentry` の行を集める。
 *
 * ブロックの中括弧を数え、その中に `/casper/` のカーネル行があるものだけを返す。
 * 同じタイトルの行が複数あることは無いので、行そのものを鍵にする。
 */
function casperMenuEntryLines(lines: readonly string[]): Set<string> {
  const found = new Set<string>()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!MENUENTRY_RE.test(line)) continue
    let depth = 0
    let seenOpen = false
    for (let j = i; j < lines.length; j++) {
      const cur = lines[j]!
      for (const ch of cur) {
        if (ch === '{') {
          depth++
          seenOpen = true
        } else if (ch === '}') depth--
      }
      const m = KERNEL_LINE_RE.exec(cur)
      if (m !== null && m[4]!.includes('/casper/')) found.add(line)
      if (seenOpen && depth <= 0) break
    }
  }
  return found
}

/** grub.cfg にカーネル引数を挿入し、必要ならホストごとの menuentry を足す。 */
export function patchGrubCfg(original: string, options: GrubPatchOptions): GrubPatchResult {
  const lines = original.split('\n')
  let patchedLines = 0
  let patchedTitles = 0
  // [Autoinstall] と改名してよいのは、casper のカーネルを起動する menuentry だけ。
  // 全部に付けると「次のボリュームから起動」「UEFI 設定」「メモリテスト」まで
  // 自動インストールの項目に見え、起動メニューで取り違える。
  const casperEntryLines = casperMenuEntryLines(lines)
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
      if (t && casperEntryLines.has(line) && !t[3]!.includes('[Autoinstall]')) {
        patchedTitles++
        return `${t[1]}${t[2]}${t[3]} [Autoinstall]${t[2]}${t[4]}`
      }
    }
    return line
  })

  // `set default=` は**元の grub.cfg に無い**（実 ISO 4 リリースとも）。
  // 足すときは `set timeout=` の直後に置く。GRUB は上から順に評価するので、
  // menuentry より前でありさえすればよい。
  if (options.defaultEntry !== null && options.defaultEntry !== undefined) {
    const n = options.defaultEntry
    // **冪等にする。** 2 回当てると `set default=` が 2 行になり、
    // GRUB は後勝ちなので挙動は同じでも 2048 バイトの予算を毎回食う。
    // 既にあるなら書き換え、無ければ `set timeout=` の直後に挿す。
    const existing = out.findIndex((l) => /^\s*set\s+default=/.test(l))
    if (existing >= 0) {
      out[existing] = `set default=${n}`
    } else {
      const at = out.findIndex((l) => /^\s*set\s+timeout=/.test(l))
      if (at >= 0) {
        out.splice(at + 1, 0, `set default=${n}`)
      } else {
        out.unshift(`set default=${n}`)
      }
    }
  }

  const extras = options.extraEntries ?? []
  if (extras.length === 0) {
    return { text: out.join('\n'), patchedLines, patchedTitles, addedEntries: 0 }
  }

  // ホストごとの項目は**最初の menuentry の直後**に置く。
  //
  // 直前に置くと、それが GRUB のエントリ 0 になる。実 ISO の grub.cfg には
  // 4 リリースとも `set default=` が無いので、既定は必ずエントリ 0 になり、
  // タイムアウトまで放置しただけで「ホスト #1」が選ばれる。
  // 起動メニューを使うのは複数台をまとめて構築するときなので、
  // 触らなかった全台が同じホスト名・同じ IP を掴むことになる（落とし穴 27）。
  // 既定はプロファイルどおりに入れる元の項目のままにし、
  // ホストを選ぶのは「人が明示的に選んだとき」だけにする。
  const blocks = buildExtraMenuBlocks(original, extras, options.args)
  const firstEntry = out.findIndex((l) => /^\s*menuentry\s/.test(l))
  const insertAt = firstEntry < 0 ? -1 : findEntryEnd(out, firstEntry)
  const text =
    insertAt < 0
      ? [...out, ...blocks].join('\n')
      : [...out.slice(0, insertAt), ...blocks, ...out.slice(insertAt)].join('\n')
  return { text, patchedLines, patchedTitles, addedEntries: blocks.length }
}

/**
 * grub.cfg は 1 セクタ (2048 バイト) に収める必要がある（インプレース改変の制約）。
 * 追加できる menuentry の数を見積もる。
 */
export function remainingGrubBytes(text: string, sectorSize = 2048): number {
  return sectorSize - Buffer.byteLength(text, 'utf8')
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
