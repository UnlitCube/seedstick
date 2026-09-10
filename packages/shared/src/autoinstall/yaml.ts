import {
  Document,
  parseDocument,
  type DocumentOptions,
  type ParseOptions,
  type SchemaOptions,
  type Tags,
} from 'yaml'

/**
 * **この設定を読むのは PyYAML と libyaml、つまり YAML 1.1 である。**
 *
 * `yaml` パッケージの既定は YAML 1.2 で、1.2 には
 * **60 進数（sexagesimal）が無く、`yes` / `no` / `on` / `off` も真偽値ではない**。
 * だから 1.2 の規則では「クォートが要らない」と判断される値が、
 * subiquity（PyYAML）と netplan（libyaml）では**別の型として読まれる**。
 *
 * 実際に踏んだのはこれ（24.04.3 の VM）:
 *
 * ```yaml
 * match: {macaddress: 52:54:00:12:34:56}   # 1.2 では文字列。1.1 では 60 進数
 * ```
 *
 * `52·60⁵ + 54·60⁴ + 0 + 12·60² + 34·60 + 56 = 41135085296` になり、
 * netplan が `Invalid MAC address '41135085296'` で落ちて
 * `netplan apply` が exit 1、**ディスクに 1 バイトも書かないまま**
 * インストールが止まった。
 *
 * **`%YAML 1.1` のディレクティブ行は出さない**（`directives` の既定が false）。
 * 出すと cloud-config の `#cloud-config` ヘッダの後ろに `%YAML` が来て、
 * cloud-init 側の目印判定に余計な行が挟まる。
 */
export const AUTOINSTALL_YAML_VERSION = '1.1' as const

/**
 * **`yaml` パッケージの 1.1 は PyYAML の 1.1 と同じではない。**
 *
 * 18 個の値を消費者（PyYAML 6.0.1）と突き合わせたところ **7 個が食い違った**。
 * 原因は 60 進数と真偽値の正規表現:
 *
 * | 値 | `yaml` (1.1) | PyYAML (1.1) |
 * |---|---|---|
 * | `52:54:00:12:34:56` | 整数 | 整数 |
 * | `00:50:56:12:34:56` | **整数** | **文字列** |
 * | `08:00:27:12:34:56` | **整数** | **文字列** |
 * | `y` / `n` | **真偽値** | **文字列** |
 *
 * `yaml` の 60 進数は `^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$` で先頭 0 を許すが、
 * PyYAML は `[1-9]` 始まりだけを 60 進数とみなす。
 *
 * **出す側と読む側で扱いを変える。**
 *
 * - **出す（`createAutoinstallDocument`）**: 1.1 をそのまま使う。
 *   `yaml` のほうが**広くクォートする**ので、PyYAML が誤読する値は必ず覆われる。
 *   過剰にクォートされるぶんは無害（文字列は文字列のまま届く）。
 *
 * - **読む（`parseAutoinstallYaml`）**: **60 進数のタグを外す。**
 *   外さないと `00:50:56:12:34:56` がこちらだけ数 `660141296` になり、
 *   (a) 生の YAML を書き直すとき**利用者の MAC を数に書き換えて壊す**、
 *   (b) 検証が「数値として読まれます」と**誤って書き込みを止める**
 *   ——PyYAML はその値を文字列として問題なく受け取るのに。
 *   外すと `52:54:...` も文字列として読むが、**出力側が 1.1 でクォートする**ので
 *   最終的な YAML はどちらの方言でも文字列になる。曖昧さが消えるほうへ倒す。
 *
 * 真偽値の `y` / `n` の食い違いは残す（netplan にも curtin にも
 * `y` / `n` を取るキーが無く、外すと `yes` / `no` の解決まで巻き添えになる）。
 * **残した食い違いは `yaml.test.ts` が表として固定している**——
 * 知らないまま残すのと、知って残すのは違う（落とし穴 85）。
 */
/**
 * **解析側から外すタグの `format`。**
 *
 * どちらも `yaml` パッケージのほうが PyYAML より**広く数として解決してしまう**もの
 * （実測は `scripts/vm/pyyaml-compare.py`）:
 *
 * - `TIME`（60 進数）: `00:50:56:12:34:56` は PyYAML では文字列。
 *   `yaml` は先頭 0 でも数にするので、MAC を書き換えて壊す。
 * - `EXP`（指数形式の浮動小数）: PyYAML は**小数点と符号つき指数の両方**を要求するので
 *   `1e5` / `1E5` / `1e+5` / `1.5e3` は**すべて文字列**。
 *   `yaml` はどれも数にするため、生の YAML に書かれた値を書き換えてしまう。
 *
 * **文字列として読むほうへ倒すのは常に安全**——出力側が 1.1 でクォートするので、
 * 最終的な YAML では文字列として届く（利用者が書いたテキストのまま）。
 */
const DROPPED_TAG_FORMATS: ReadonlySet<string> = new Set(['TIME', 'EXP'])

/** 消費者より広く数にしてしまうタグだけを落とす。他の 1.1 の解決はそのまま。 */
const withoutOverEagerNumbers = (tags: Tags): Tags =>
  (tags as ReadonlyArray<{ format?: string }>).filter(
    (t) => !(t.format !== undefined && DROPPED_TAG_FORMATS.has(t.format)),
  ) as unknown as Tags

const EMIT_OPTIONS: DocumentOptions = { version: AUTOINSTALL_YAML_VERSION }
const PARSE_OPTIONS: DocumentOptions & ParseOptions & SchemaOptions = {
  version: AUTOINSTALL_YAML_VERSION,
  customTags: withoutOverEagerNumbers,
}

/**
 * 消費者（PyYAML / libyaml）に合わせて読む。
 *
 * **`yaml` から `parseDocument` を直に import しない。** 既定の 1.2 で読むと、
 * 生の YAML に書かれた `dhcp4: yes` がこちらでは文字列 `'yes'`、
 * subiquity では真偽値 `true` になる。検証と生成が別々に import すると
 * 片方だけが取り残される（落とし穴 74 と同じ形）。
 */
export function parseAutoinstallYaml(text: string): ReturnType<typeof parseDocument> {
  return parseDocument(text, PARSE_OPTIONS)
}

/**
 * 消費者と同じ方言で読んで、JS の値として返す。
 *
 * **検査から使うためのもの。** 生成物を読み直すテストが `yaml` の `parse`（既定 1.2）を
 * 使っていると、クォート漏れが文字列に見えて素通りする（落とし穴 109）。
 * `toJS()` は壊れた YAML で投げうるので、**製品コードでは使わない**
 * （`validate.ts` / `generate.ts` は try/catch 付きの経路を持っている。落とし穴 118）。
 */
export function parseAutoinstallYamlToJs(text: string): unknown {
  return parseAutoinstallYaml(text).toJS()
}

/** 消費者と同じ方言で書く。1.1 で誤読される値は自動でクォートされる。 */
export function createAutoinstallDocument(value: unknown): Document {
  return new Document(value, EMIT_OPTIONS)
}

// ---------------------------------------------------------------------------
// 方言の番人（検査から使う）
// ---------------------------------------------------------------------------

/**
 * 出力されたテキストが **YAML 1.1 と 1.2 の両方で同じ意味になるか**。
 * 差があった場所を返す（空なら曖昧さが無い）。
 *
 * 値を列挙しないので、MAC の 60 進数も `yes` / `no` / `on` / `off` も
 * 先頭 0 の八進数も、**将来 UI に増える自由入力**も 1 本で捕まる。
 *
 * **両方の版をここで固定する。片方を `AUTOINSTALL_YAML_VERSION` に連動させない。**
 * 連動させると、その設定を 1.2 に戻す変異で**比較が 1.2 対 1.2 になって緑のまま**になる
 * （実際にそうなった。落とし穴 110）。見たいのは「出力されたテキストが
 * 両方の方言で同じ意味か」であって、こちらの設定値ではない。
 *
 * また **60 進数のタグは外さない**（`parseAutoinstallYaml` は外している）。
 * ここで外すと「1.1 では数になる」ことを検出できなくなり、番人が空振りする。
 *
 * 以前は `yaml.test.ts` / `e2e-raid-bond.mts` / `e2e-matrix.mts` の 3 か所に
 * 写しがあり、既に挙動が食い違っていた（打ち切り件数が 5 と 3）。
 * **写しを持つと、契約が動いたとき写しだけが取り残される**（落とし穴 74）。
 */
export function yamlDialectDiffs(text: string, maxDiffs = 5): string[] {
  const a: unknown = parseDocument(text, { version: '1.1' }).toJS()
  const b: unknown = parseDocument(text, { version: '1.2' }).toJS()
  const diffs: string[] = []
  const walk = (x: unknown, y: unknown, path: string): void => {
    if (diffs.length >= maxDiffs) return
    if (Array.isArray(x) || Array.isArray(y)) {
      // **片方だけが配列**なら、それ自体が差（`typeof [] === 'object'` で見落とさない）。
      if (!Array.isArray(x) || !Array.isArray(y)) {
        diffs.push(`${path}: 片方だけが配列`)
        return
      }
      if (x.length !== y.length) {
        diffs.push(`${path}: 長さ ${x.length} vs ${y.length}`)
        return
      }
      x.forEach((v, i) => walk(v, y[i], `${path}[${i}]`))
      return
    }
    // `typeof null === 'object'`（落とし穴 30）。null は下の値比較へ落とす。
    if (x !== null && y !== null && typeof x === 'object' && typeof y === 'object') {
      const kx = Object.keys(x as object)
      const ky = Object.keys(y as object)
      const only = [...kx.filter((k) => !ky.includes(k)), ...ky.filter((k) => !kx.includes(k))]
      if (only.length > 0) {
        diffs.push(`${path}: キーが違う (${only.join(', ')})`)
        return
      }
      for (const k of kx) {
        walk((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], `${path}.${k}`)
      }
      return
    }
    if (x !== y) {
      diffs.push(
        `${path}: 1.1 では ${typeof x} ${JSON.stringify(x)} / 1.2 では ${typeof y} ${JSON.stringify(y)}`,
      )
    }
  }
  walk(a, b, '')
  return diffs
}
