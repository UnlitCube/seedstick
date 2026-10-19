// インストール先の検証。
//
// **renderer から来た値は信用しない**（このリポジトリの規約）。
// インストール先は自由入力の文字列で、この先には `mkdir` と
// 「中身を消してから展開」と、失敗時の `rm -r` が待っている。
// ドライブのルートを渡されたら**ドライブ全体を消す**ことになるので、
// 危ない形はここで断る。
//
// もう 1 つ、`checkDir()` は入力のたびに呼ばれる**見せるための検査**で、
// `validateInstallDir()` は書き込み直前の**止めるための検査**。
// 前者は理由を判別子で返し（画面が 1 対 1 で文言を引く。落とし穴 77）、
// 後者は投げる。**どちらも同じ関数から導く**ので食い違わない。

import { promises as fs, statfsSync, statSync } from 'node:fs'
import { isAbsolute, join, normalize, parse } from 'node:path'
import type { DirCheck, DirProblem } from '../shared/protocol.js'

// 必要な容量は `paths.ts` の `resolveAssets().needBytes` が持つ
// （ビルド時に実測して `payload-meta.json` へ書いたもの）。
// ここでは受け取るだけにして、**同じ数字を 2 か所に置かない**。

export class InstallDirError extends Error {
  readonly problem: DirProblem
  constructor(problem: DirProblem) {
    super(problem)
    this.name = 'InstallDirError'
    this.problem = problem
  }
}

/**
 * 形だけを見る。ファイルシステムには触らない（テストしやすさのため）。
 * 通れば正規化した絶対パスを返す。
 */
export function normalizeInstallDir(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new InstallDirError('empty')
  }
  const trimmed = raw.trim()
  // 引用符はここで断る。PowerShell へは `psSingleQuote` で安全に渡せるが、
  // 引用符入りのパスは利用者が貼り付けを失敗した形であることがほとんどで、
  // そのまま作ると「意図しない名前のフォルダ」ができる。
  if (/["']/.test(trimmed)) {
    throw new InstallDirError('has-quote')
  }
  const dir = normalize(trimmed)
  if (!isAbsolute(dir)) {
    throw new InstallDirError('not-absolute')
  }
  // UNC (\\server\share) は「ルートかどうか」の判定が効かないうえ、
  // 展開先としてまともに使えることがない。
  if (dir.startsWith('\\\\')) {
    throw new InstallDirError('not-absolute')
  }
  const stripTrailer = (p: string): string => p.replace(/[\\/]+$/, '')
  const { root } = parse(dir)
  if (stripTrailer(dir).toLowerCase() === stripTrailer(root).toLowerCase()) {
    // ドライブのルート。ここを許すと rollback の `rm -r` がドライブを消す。
    throw new InstallDirError('not-absolute')
  }
  const lower = dir.toLowerCase()
  const winDir = (process.env['WINDIR'] ?? 'C:\\Windows').toLowerCase()
  if (lower === winDir || lower.startsWith(winDir + '\\')) {
    throw new InstallDirError('not-writable')
  }
  return dir
}

/** 実在する最も近い親をたどる。空き容量と書き込み可否はここで見る。 */
function nearestExistingAncestor(dir: string): string | null {
  let current = dir
  for (let i = 0; i < 64; i++) {
    try {
      if (statSync(current).isDirectory()) return current
    } catch {
      /* 無ければ親へ */
    }
    const { dir: parent, root } = parse(current)
    if (parent === current || parent === '') return null
    current = parent
    if (current === root) {
      try {
        return statSync(current).isDirectory() ? current : null
      } catch {
        return null
      }
    }
  }
  return null
}

function freeBytesOf(dir: string): number | null {
  try {
    const s = statfsSync(dir)
    // `bavail` は「非特権プロセスが使えるブロック数」。予約分を除いた実際の空き。
    return Number(s.bsize) * Number(s.bavail)
  } catch {
    return null
  }
}

async function isWritable(dir: string): Promise<boolean> {
  // `fs.access(W_OK)` は Windows では読み取り専用属性しか見ないので当てにならない。
  // 実際に書いて消す。**必ず消す**（落とし穴 86: テストが作った一時ファイルが積み上がった）。
  const probe = join(dir, `.seedstick-probe-${process.pid}`)
  try {
    await fs.writeFile(probe, '')
    return true
  } catch {
    return false
  } finally {
    await fs.rm(probe, { force: true }).catch(() => {})
  }
}

/**
 * 画面に見せるための検査。**投げない。**
 * 理由は判別子で返し、訳すのは renderer（落とし穴 78）。
 */
export async function checkInstallDir(raw: unknown, needBytes: number): Promise<DirCheck> {
  const base = { existing: false, freeBytes: null as number | null, needBytes }

  let dir: string
  try {
    dir = normalizeInstallDir(raw)
  } catch (e) {
    const problem = e instanceof InstallDirError ? e.problem : 'empty'
    return { ok: false, reason: problem, ...base }
  }

  // そこにファイルがある（フォルダではない）。
  try {
    if (!statSync(dir).isDirectory()) {
      return { ok: false, reason: 'is-file', ...base }
    }
  } catch {
    /* 無いのは正常。これから作る。 */
  }

  const ancestor = nearestExistingAncestor(dir)
  if (ancestor === null) {
    return { ok: false, reason: 'not-writable', ...base }
  }

  const freeBytes = freeBytesOf(ancestor)
  const existing = existsAsInstall(dir)

  if (!(await isWritable(ancestor))) {
    return { ok: false, reason: 'not-writable', existing, freeBytes, needBytes }
  }
  // 上書きになる場合、いま置かれている分は消えるので空き容量には足せる。
  // だが数え上げるほどの精度は要らないので、安全側（足さない）で見る。
  if (freeBytes !== null && freeBytes < needBytes) {
    return { ok: false, reason: 'no-space', existing, freeBytes, needBytes }
  }

  return { ok: true, reason: null, existing, freeBytes, needBytes }
}

/** そこに「このアプリが」入っているか。空フォルダを「既存」と言わないため。 */
function existsAsInstall(dir: string): boolean {
  try {
    return statSync(join(dir, 'resources')).isDirectory()
  } catch {
    return false
  }
}
