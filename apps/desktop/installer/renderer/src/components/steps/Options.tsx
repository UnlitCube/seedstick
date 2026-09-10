// インストール先とショートカットを決める段。
//
// **入力するたびに main へ検証を投げる。** 空き容量も書き込み可否も
// renderer では分からないし、分かるふりをすると「インストールを押してから
// 初めて弾かれる」ことになる。
//
// 入力中の生テキストは下書きとして持つ（正規化した値を `value` に戻すと、
// 区切り文字が打てなくなる類の事故が起きる。落とし穴 58 と同じ理由）。

import { useEffect, useRef, useState } from 'react'
import type { DirCheck, InstallerInfo } from '../../../../shared/protocol.js'
import { useT } from '../../i18n.js'
import { formatBytes } from '../../format.js'
import { ArrowRight, Button, Checkbox } from '../ui.js'

export interface OptionsValue {
  readonly installDir: string
  readonly desktopShortcut: boolean
  readonly startMenuShortcut: boolean
  readonly launchAfter: boolean
}

interface Props {
  readonly info: InstallerInfo
  readonly value: OptionsValue
  readonly onChange: (next: OptionsValue) => void
  readonly onBack: () => void
  readonly onStart: () => void
}

export function OptionsStep({
  info,
  value,
  onChange,
  onBack,
  onStart,
}: Props): React.JSX.Element {
  const t = useT()
  const [check, setCheck] = useState<DirCheck | null>(null)
  // 打っている途中の値で検査を走らせ続けないための世代番号。
  // 遅れて返ってきた古い結果で画面を上書きしない。
  const generation = useRef(0)

  useEffect(() => {
    const mine = ++generation.current
    const timer = setTimeout(() => {
      void window.installer.checkDir(value.installDir).then((r) => {
        if (generation.current === mine) setCheck(r)
      })
    }, 180)
    return () => {
      clearTimeout(timer)
    }
  }, [value.installDir])

  const browse = (): void => {
    void window.installer.chooseDir(value.installDir).then((picked) => {
      if (picked !== null) onChange({ ...value, installDir: picked })
    })
  }

  const problem = check?.reason ?? null
  const canStart = check !== null && check.ok

  return (
    <div className="step flex h-full flex-col">
      <h2 className="text-2xl font-semibold tracking-tight">{t('options.title')}</h2>
      <p className="mt-1.5 text-sm text-white/55">{t('options.lead')}</p>

      <div className="stagger mt-8 flex flex-col gap-5">
        {/* インストール先 */}
        <div>
          <label className="mb-2 block text-xs font-semibold tracking-wide text-white/45 uppercase">
            {t('options.dir')}
          </label>
          <div className="flex gap-2">
            <input
              className="field"
              value={value.installDir}
              spellCheck={false}
              data-invalid={problem !== null ? 'true' : 'false'}
              onChange={(e) => onChange({ ...value, installDir: e.target.value })}
            />
            <Button tone="ghost" onClick={browse} className="!px-4">
              {t('options.browse')}
            </Button>
          </div>

          <div className="mt-2 flex min-h-[18px] items-center gap-3 text-[12px]">
            {problem !== null ? (
              <span className="text-rose-300">{t(`dir.${problem}`)}</span>
            ) : (
              <>
                <span className="text-white/40">
                  {t('options.need', { size: formatBytes(info.needBytes) })}
                </span>
                <span className="text-white/25">·</span>
                <span className="text-white/40">
                  {check === null
                    ? ''
                    : check.freeBytes === null
                      ? t('options.freeUnknown')
                      : t('options.free', { size: formatBytes(check.freeBytes) })}
                </span>
              </>
            )}
          </div>

          {check?.existing === true && problem === null ? (
            <p className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/8 px-3 py-2 text-[12px] text-amber-200/90">
              {t('options.existing')}
            </p>
          ) : null}
        </div>

        <div className="hairline" />

        {/* ショートカット */}
        <div>
          <div className="mb-3 text-xs font-semibold tracking-wide text-white/45 uppercase">
            {t('options.shortcuts')}
          </div>
          <div className="flex flex-col gap-3">
            <Checkbox
              checked={value.desktopShortcut}
              onChange={(next) => onChange({ ...value, desktopShortcut: next })}
              label={t('options.desktop')}
            />
            <Checkbox
              checked={value.startMenuShortcut}
              onChange={(next) => onChange({ ...value, startMenuShortcut: next })}
              label={t('options.startMenu')}
            />
            <Checkbox
              checked={value.launchAfter}
              onChange={(next) => onChange({ ...value, launchAfter: next })}
              label={t('options.launchAfter')}
            />
          </div>
        </div>

        <p className="text-[12px] leading-relaxed text-white/35">
          {t('options.perUser', { user: info.userName })}
        </p>
      </div>

      <div className="mt-auto flex items-center justify-between pt-6">
        <Button tone="ghost" onClick={onBack}>
          {t('common.back')}
        </Button>
        <Button tone="primary" onClick={onStart} disabled={!canStart}>
          {info.installedAt === null ? t('options.install') : t('options.update')}
          <ArrowRight />
        </Button>
      </div>
    </div>
  )
}
