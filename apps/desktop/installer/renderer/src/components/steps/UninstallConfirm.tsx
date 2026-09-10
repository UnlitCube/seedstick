// アンインストールの確認。
//
// **消さないものを明示する。** 「作った USB と保存したプロファイルは残る」と
// 書いておかないと、利用者は先に自分でバックアップを取ることになる。

import type { InstallerInfo } from '../../../../shared/protocol.js'
import { useT } from '../../i18n.js'
import { Mark } from '../Mark.js'
import { Button } from '../ui.js'

interface Props {
  readonly info: InstallerInfo
  readonly installDir: string
  readonly onRun: () => void
  readonly onClose: () => void
}

export function UninstallConfirmStep({
  info,
  installDir,
  onRun,
  onClose,
}: Props): React.JSX.Element {
  const t = useT()
  return (
    <div className="step flex h-full flex-col">
      <div className="stagger flex flex-col">
        <div className="flex items-center gap-4">
          <Mark size={48} />
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{t('uninstall.title')}</h2>
            <p className="mt-1 text-sm text-white/55">
              {t('uninstall.lead', { product: info.productName })}
            </p>
          </div>
        </div>

        <div className="hairline mt-6" />

        <div className="card mt-6 px-4 py-3">
          <div className="text-[11px] font-semibold tracking-wide text-white/40 uppercase">
            {t('uninstall.where')}
          </div>
          <div className="mt-1 font-mono text-[12px] break-all text-white/70 select-text">
            {installDir}
          </div>
        </div>

        <p className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/8 px-3 py-2.5 text-[12px] leading-relaxed text-emerald-100/85">
          {t('uninstall.keeps')}
        </p>
      </div>

      <div className="mt-auto flex items-center justify-between pt-6">
        <Button tone="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button tone="danger" onClick={onRun}>
          {t('uninstall.run')}
        </Button>
      </div>
    </div>
  )
}
