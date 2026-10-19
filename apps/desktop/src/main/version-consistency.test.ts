import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// **バージョンの出どころが 1 つでないことを、機械で見張る。**
//
// リリースをタグで回すようにした以上、`0.1.0` → `0.2.0` に上げる作業が定期的に来る。
// ところが**この版番号はソースの 5 か所に直書きされていて**、
// そのうち 2 つは**作った USB の中身に焼き込まれる**:
//
//   profile.meta.toolVersion  →  generate.ts が user-data の先頭コメントに出す
//                                （`# 生成: seedstick/0.1.0`）
//
// 一方 `seed-builder.ts` の監査記録は `app.getVersion()`（＝package.json）を使う。
// つまり上げ忘れると、**同じ USB の中で監査記録が 0.2.0、user-data のコメントが 0.1.0**
// という矛盾した成果物が出る。しかも**どのテストも落ちない**。
//
// タグと `package.json` を突き合わせるだけの CI ゲートでは、ここは 1 つも見えない
// （どちらも package.json しか見ないため）。だから**ここで数える**。
//
// **本来は直書きをやめて 1 か所から配るべき**（`docs/HANDOFF.md` の残作業に書いた）。
// それまでの繋ぎとして、上げ忘れをユニットテストで赤くする。
//
// **素の `\d+\.\d+\.\d+` で走査しない。** 最初そう書いたら
// `samples/ip-only.json` の IP アドレス（`10.0.2.100`）を 20 件拾って落ちた。
// 版番号が**実際に現れる形**だけを指定する（落とし穴 63 と同じ用心で、
// 判定のたびに正規表現を作り直して `lastIndex` を持ち越さない）。
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..')

const APP_VERSION: string = (
  JSON.parse(readFileSync(join(REPO_ROOT, 'apps/desktop/package.json'), 'utf8')) as {
    version: string
  }
).version

interface Site {
  readonly file: string
  /** 版番号を 1 つ目の捕獲群に取る正規表現。**文字列で持つ**（毎回作り直すため）。 */
  readonly pattern: string
  readonly reason: string
}

/**
 * 版番号を直書きしている場所。**追加も削除もここに書く。**
 * `reason` は「なぜここに在るのか」。消せるようになったら行ごと消す。
 */
const SITES: readonly Site[] = [
  {
    file: 'packages/shared/src/autoinstall/defaults.ts',
    pattern: "seedstick/(\\d+\\.\\d+\\.\\d+)",
    reason: 'createDefaultProfile の toolVersion の既定引数。user-data のコメントに出る',
  },
  {
    file: 'packages/media/src/index.ts',
    pattern: "MEDIA_ENGINE_VERSION\\s*=\\s*'(\\d+\\.\\d+\\.\\d+)'",
    reason: 'MEDIA_ENGINE_VERSION（現在の参照は 0 件だが、公開している以上ずれてはいけない）',
  },
  {
    file: 'apps/desktop/src/preload/index.ts',
    pattern: "\\?\\?\\s*'(\\d+\\.\\d+\\.\\d+)'",
    reason:
      'appVersion のフォールバック。npm_package_version は npm script 経由でしか入らないので、' +
      'パッケージ版では必ずこのリテラル側に落ちる',
  },
  {
    file: 'apps/desktop/src/renderer/src/store.ts',
    pattern: "seedstick/(\\d+\\.\\d+\\.\\d+)",
    reason: '新規プロファイルと読み込み直しのときの toolVersion',
  },
  {
    file: 'samples/ip-only.json',
    pattern: "seedstick/(\\d+\\.\\d+\\.\\d+)",
    reason: '配布サンプルの meta.toolVersion。samples.test.ts が読む実物',
  },
]

/** その場で作った正規表現で全部拾う（行番号つき）。 */
function hits(site: Site): { line: number; version: string }[] {
  const source = readFileSync(join(REPO_ROOT, site.file), 'utf8')
  const out: { line: number; version: string }[] = []
  source.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(new RegExp(site.pattern, 'g'))) {
      out.push({ line: i + 1, version: m[1] ?? '' })
    }
  })
  return out
}

describe('版番号の直書きが package.json と一致する', () => {
  it('root と apps/desktop の package.json が同じ版番号', () => {
    const root = (
      JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { version: string }
    ).version
    expect(root, 'root と apps/desktop の version がずれている').toBe(APP_VERSION)
  })

  it('走査対象を実際に踏めている（空の検査になっていない）', () => {
    // パスや正規表現を間違えた瞬間に「0 件を検査して緑」になるのを防ぐ（落とし穴 123）。
    for (const site of SITES) {
      expect(hits(site).length, `${site.file} で ${site.pattern} が 1 件も当たらない`).toBeGreaterThan(0)
    }
  })

  it('直書きされている版番号がすべて package.json と一致する', () => {
    const mismatched = SITES.flatMap((site) =>
      hits(site)
        .filter((h) => h.version !== APP_VERSION)
        .map((h) => `${site.file}:${h.line}: ${h.version}（期待 ${APP_VERSION}）— ${site.reason}`),
    )
    expect(
      mismatched,
      mismatched.length === 0
        ? ''
        : '版番号を上げるときは、package.json だけでなく次も一緒に直すこと。\n' +
            mismatched.join('\n'),
    ).toEqual([])
  })
})
