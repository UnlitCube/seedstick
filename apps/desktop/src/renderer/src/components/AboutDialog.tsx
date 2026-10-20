import { useState } from 'react'
import { ExternalLink, FileText } from 'lucide-react'
import { APP_NAME, ISSUES_URL, REPO_URL, SITE_URL } from '@autoinstall/shared'
import { useT } from '../lib/i18n.js'
import { Button, Modal } from './ui.js'

/**
 * 「このアプリについて」。版・ライセンス・**Canonical とは無関係であること**・商標の表記と、
 * ライセンス全文 / 第三者のライセンスを開く入口を置く。
 *
 * 免責をここに置くのは、製品名に Ubuntu を含めず公式ツールに見えないようにする
 * （docs/LEGAL.md）だけでなく、アプリの中からも「誰が作った何か」を確かめられるようにするため。
 * README にしか書かないと、配布物だけを受け取った人には届かない。
 */
export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const t = useT()
  const [openFailed, setOpenFailed] = useState(false)

  const openDoc = async (kind: 'license' | 'notices'): Promise<void> => {
    setOpenFailed(!(await window.autoinstall.openLegalDocument(kind)))
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('about.title', { app: APP_NAME })}
      footer={<Button onClick={onClose}>{t('common.close')}</Button>}
    >
      <div className="space-y-4 text-sm text-slate-700 dark:text-slate-300">
        <div>
          <p className="font-semibold text-slate-900 dark:text-slate-100">{APP_NAME}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('about.version', { version: window.autoinstall.appVersion })} · {t('app.experimental')}
          </p>
          <p className="mt-1">{t('app.tagline')}</p>
        </div>

        <p>{t('about.license')}</p>
        <div className="space-y-2 rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <p>{t('about.experimental')}</p>
          <p>{t('about.noWarranty')}</p>
        </div>
        <p>{t('about.disclaimer')}</p>
        <p>{t('about.noImages')}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('about.trademarks')}</p>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void window.autoinstall.openExternal(SITE_URL)}>
            <ExternalLink className="size-4" aria-hidden />
            {t('about.website')}
          </Button>
          <Button variant="secondary" onClick={() => void window.autoinstall.openExternal(REPO_URL)}>
            <ExternalLink className="size-4" aria-hidden />
            {t('about.source')}
          </Button>
          <Button variant="secondary" onClick={() => void window.autoinstall.openExternal(ISSUES_URL)}>
            <ExternalLink className="size-4" aria-hidden />
            {t('about.issues')}
          </Button>
          <Button variant="secondary" onClick={() => void openDoc('license')}>
            <FileText className="size-4" aria-hidden />
            {t('about.licenseText')}
          </Button>
          <Button variant="secondary" onClick={() => void openDoc('notices')}>
            <FileText className="size-4" aria-hidden />
            {t('about.notices')}
          </Button>
        </div>
        {openFailed && <p className="text-xs text-rose-700 dark:text-rose-400">{t('about.openFailed')}</p>}
      </div>
    </Modal>
  )
}
