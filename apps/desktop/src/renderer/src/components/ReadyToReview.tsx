import { ArrowRight } from 'lucide-react'
import { useStore } from '../store.js'
import { useT } from '../lib/i18n.js'
import { Button, Callout } from './ui.js'

/**
 * 「必ず設定する」を通り終えた人が、残りを飛ばして確認へ行くための導線。
 *
 * サイドバーの残り 5 ステップ（ネットワーク・ディスク・ソフトウェア・
 * インストール後・実行時に決める）は**どれも既定のまま通せる**。
 * それを知らないと、意味の分からない画面を 5 つ順に踏まされることになる。
 *
 * 「スキップ」という語は使わない。何かを諦めた感じになるが、
 * 実際には既定でちゃんと動く道であって、諦めではない。
 *
 * **設定にエラーがあるときは出さない。** 出すと「押せないボタン」になり、
 * なぜ押せないのかがこの場所からは分からない
 * （エラーの中身は確認画面と各ステップにある）。
 * 書き込み中も出さない（`App.tsx` がステップ移動を禁じているのに、
 * ここだけ移動できると規則が 2 つになる）。
 */
export function ReadyToReview(): React.JSX.Element | null {
  const t = useT()
  const config = useStore((s) => s.config)
  const setStep = useStore((s) => s.setStep)
  const writeStatus = useStore((s) => s.writeStatus)

  const writing = writeStatus.state === 'preparing' || writeStatus.state === 'writing'
  if (config?.ok !== true || writing) return null

  return (
    <Callout tone="success" title={t('nav.readyTitle')}>
      <p>{t('nav.readyBody')}</p>
      <div className="mt-3">
        <Button variant="primary" onClick={() => setStep('review')}>
          {t('nav.readyButton')}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </Callout>
  )
}
