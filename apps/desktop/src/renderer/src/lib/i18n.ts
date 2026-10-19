import { Fragment, createElement } from 'react'
import {
  createTranslator,
  isLocalizedText,
  resolvePlurals,
  type Locale,
  type LocalizedText,
  type MsgKey,
  type MsgParams,
} from '@autoinstall/shared'
import { useStore } from '../store.js'

/** 現在のロケールに応じた翻訳関数を返す。 */
export function useT(): (key: MsgKey, params?: MsgParams) => string {
  const locale = useStore((s) => s.locale)
  return createTranslator(locale)
}

/**
 * main / media から `LocalizedText` で運ばれてきた文言。
 *
 * `string` を含めているのは**退避路**であって、新しい設計の一部ではない。
 * 昇格ワーカーは別プロセスで、アプリの更新中に**古い実体が動き続けている**ことが
 * ありうる（インストーラが差し替えるのはファイルであって、走っているプロセスではない）。
 * そのとき NDJSON で届くのは以前どおりの日本語の `string` なので、
 * 受け取り側は「オブジェクトなら訳す・文字列ならそのまま出す」の両方を扱えなければ、
 * 進捗ラベルの位置に `[object Object]` が出るか、React が描画中に落ちる。
 */
export type MaybeLocalized = LocalizedText | string | null | undefined

/** `params` として安全に使える形か（`null` や配列を弾く）。 */
function asParams(value: unknown): MsgParams | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as MsgParams
}

/**
 * `LocalizedText` を訳す。**壊れた形が来ても例外を投げない**（落とし穴 60）。
 *
 * プロファイル JSON と同じで、ここに届く値は手元のコードだけが作るものではない
 * （IPC・NDJSON・古いワーカー）。`{key}` を持たないオブジェクトや `params: null` を
 * そのまま `interpolate` に渡すと、Error Boundary の中で**もう一度**落ちる。
 * 描くものが無いときは空文字を返し、文言が要る場所は呼び出し側で `|| t(...)` を書く。
 */
export function formatMaybeLocalized(locale: Locale, text: MaybeLocalized): string {
  if (text === null || text === undefined) return ''
  if (typeof text === 'string') return text
  // 形の判定は `@autoinstall/shared` の 1 つだけを使う（写しを作らない）。
  // ここは浅い判定でよい: `params` の中に壊れた値があっても `interpolate` が
  // プレースホルダを残すだけで、投げない。全体を歩くのは境界（ワーカー）の仕事。
  if (!isLocalizedText(text)) return ''
  return createTranslator(locale)(text.key, asParams((text as { params?: unknown }).params))
}

/**
 * `LocalizedText` を訳す関数を返す。
 *
 * main と `@autoinstall/media` は利用者の言語を知らないので、文言はキーのまま運ばれる。
 * 訳すのは renderer だけの仕事で、それがここ。
 */
export function useTl(): (text: MaybeLocalized) => string {
  const locale = useStore((s) => s.locale)
  return (text) => formatMaybeLocalized(locale, text)
}

/**
 * 訳文の `{name}` を **React の要素**で差し込む。
 *
 * 「新しいシステムは `/target` にマウントされています」のように、文の途中に
 * `<code>` が入る文はキーを 3 つに割ると訳しづらく、語順の違う言語で破綻する。
 * 1 文 1 キーのまま、差し込む場所だけ要素にする。
 */
export function useTx(): (key: MsgKey, nodes: Readonly<Record<string, React.ReactNode>>) => React.JSX.Element {
  const locale = useStore((s) => s.locale)
  const t = createTranslator(locale)
  return (key, nodes) => {
    // 複数形 `{n, plural, …}` は先に解く（数として渡された差し込みだけを使う）。
    const numbers = Object.fromEntries(Object.entries(nodes).filter(([, v]) => typeof v === 'number'))
    // 分割は「捕獲付き」なので、奇数番目が差し込み名になる。
    const parts = resolvePlurals(t(key), numbers, locale).split(/\{([A-Za-z][A-Za-z0-9_]*)\}/)
    const children: React.ReactNode[] = []
    for (let i = 0; i < parts.length; i++) {
      const piece = parts[i]!
      if (i % 2 === 0) {
        if (piece.length > 0) children.push(piece)
        continue
      }
      // 値が無い差し込みは、翻訳関数と同じくプレースホルダを残す（渡し忘れに気づける）
      children.push(piece in nodes ? nodes[piece] : `{${piece}}`)
    }
    return createElement(
      Fragment,
      null,
      ...children.map((child, i) => createElement(Fragment, { key: i }, child)),
    )
  }
}

// ここには以前 `useLocalized()`（`{ja, en}` の対から現在の言語を選ぶフック）があった。
// 選択肢のラベルが `labelJa` / `labelEn` を直接持っていた頃の道具で、いまは
// `presets.ts` / `provisioning.ts` / `advanced.ts` の選択肢が辞書のキー（`MsgKey`）を
// 持ち、`t(c.label)` で引く。**死んだ機構を残すと次の人がまたそれを使う**ので消した。
// 「ja / en を両方持つオブジェクト」を新たに作りたくなったら、それは i18n の機構を
// 2 つに戻す変更なので、まず `ja.ts` / `en.ts` にキーを足せないかを考えること。
