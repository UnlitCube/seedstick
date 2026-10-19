import { useState } from 'react'
import {
  CheckCircle2,
  FileDown,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Usb,
  XCircle,
} from 'lucide-react'
// @autoinstall/media は Node に依存するので renderer から import しない。
// 安全判定の純粋な部分は @autoinstall/shared 側にある。
import { needsExtraCaution, type DeviceInfo } from '@autoinstall/shared'
import { useStore } from '../store.js'
import { useT, useTl, useTx } from '../lib/i18n.js'
import { formatBytes, formatEta, formatSpeed } from '../lib/format.js'
import { Badge, Button, Callout, Card, Modal, ProgressBar, Switch, TextInput } from '../components/ui.js'

export function WriteStep(): React.JSX.Element {
  const t = useT()
  const tl = useTl()
  const { devices, devicesBusy, selectedDeviceId, writeStatus, iso, config, settings, imageTarget } =
    useStore()
  const refreshDevices = useStore((s) => s.refreshDevices)
  const selectDevice = useStore((s) => s.selectDevice)
  const startWrite = useStore((s) => s.startWrite)
  const cancelWrite = useStore((s) => s.cancelWrite)
  const saveSettings = useStore((s) => s.saveSettings)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  const selected = devices.find((d) => d.id === selectedDeviceId) ?? null
  const usable = devices.filter((d) => d.selectable)
  const blocked = devices.filter((d) => !d.selectable)
  const tooSmall = selected !== null && iso !== null && selected.sizeBytes < iso.minimumDeviceBytes
  const canWrite =
    iso !== null && config?.ok === true && selected !== null && !tooSmall && writeStatus.state !== 'writing'

  const busy = writeStatus.state === 'preparing' || writeStatus.state === 'writing'
  // 64 GB 超や USB 以外の接続は外付けドライブの可能性が高いので、確認をより強くする
  const extraCaution = selected !== null && needsExtraCaution(selected)

  if (writeStatus.state === 'done') {
    return <DoneView />
  }

  return (
    <div className="space-y-5">
      {iso === null && (
        <Callout tone="warning" title={t('write.isoMissing')}>
          {t('write.isoMissingBody')}
        </Callout>
      )}
      {config?.ok === false && (
        <Callout tone="danger" title={t('write.configInvalid')}>
          {t('write.configInvalidBody')}
        </Callout>
      )}

      <Card
        title={t('write.selectDevice')}
        description={
          iso ? t('write.minimumSize', { size: formatBytes(iso.minimumDeviceBytes) }) : undefined
        }
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('write.systemDiskHidden')}</p>
          <Button onClick={() => void refreshDevices()} disabled={devicesBusy || busy}>
            {devicesBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-4" aria-hidden />
            )}
            {t('write.refreshDevices')}
          </Button>
        </div>

        {usable.length === 0 && !devicesBusy ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center dark:border-slate-600">
            <Usb className="mx-auto size-8 text-slate-400" aria-hidden />
            <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('write.noDevices')}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('write.noDevicesHint')}</p>
            {/*
              USB メモリを持っていない人にとっては、イメージファイルが唯一の出口。
              「デバイスがありません」で行き止まりに見えないよう、ここから下の
              カードへ案内する（ボタンを二重に置くと、どちらを押すのか迷わせる）。
            */}
            <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">
              {t('write.noDevicesImage')}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {usable.map((d) => (
              <DeviceRow
                key={d.id}
                device={d}
                selected={d.id === selectedDeviceId}
                disabled={busy}
                tooSmall={iso !== null && d.sizeBytes < iso.minimumDeviceBytes}
                onSelect={() => selectDevice(d.id)}
              />
            ))}
          </ul>
        )}

        {blocked.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400">
              {t('write.showBlocked', { n: blocked.length })}
            </summary>
            <ul className="mt-2 space-y-1.5">
              {blocked.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                >
                  <HardDrive className="size-4 shrink-0 text-slate-400" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-400">
                    {d.description} · {formatBytes(d.sizeBytes)}
                  </span>
                  <BlockedBadge reason={tl(d.blockedReason)} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      {tooSmall && selected !== null && iso !== null && (
        <Callout tone="danger" title={t('error.isoTooBig')}>
          {t('write.tooSmallBody', {
            size: formatBytes(selected.sizeBytes),
            required: formatBytes(iso.minimumDeviceBytes),
          })}
        </Callout>
      )}

      {settings && (
        <Card title={t('write.optionsTitle')}>
          <div className="space-y-2">
            <Switch
              checked={settings.verifyAfterWrite}
              disabled={busy}
              onChange={(v) => void saveSettings((s) => ({ ...s, verifyAfterWrite: v }))}
              label={t('write.verifyOption')}
              description={t('write.verifyOptionHint')}
            />
            <Switch
              checked={settings.auditRecord}
              disabled={busy}
              onChange={(v) => void saveSettings((s) => ({ ...s, auditRecord: v }))}
              label={t('write.auditRecord')}
              description={t('write.auditRecordHint')}
            />
          </div>
        </Card>
      )}

      {busy && <WriteProgress />}

      {writeStatus.state === 'error' && (
        <Callout tone="danger" title={t('write.failed')}>
          <p>{tl(writeStatus.message) || t('error.unknown')}</p>
          {writeStatus.detail !== null && (
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-900/10 p-2 text-[11px] dark:bg-slate-950/40">
              {writeStatus.detail}
            </pre>
          )}
        </Callout>
      )}
      {writeStatus.state === 'cancelled' && (
        <Callout tone="warning" title={t('write.cancelled')}>
          {/*
            イメージファイルは main が消してから 'cancelled' にする。
            USB 向けの「内容は壊れています」をそのまま出すと、存在しないファイルの
            心配をさせることになる（`cancelled` は state しか持たないので、
            どちらを止めたのかは store の `imageTarget` でしか分からない）。
          */}
          {imageTarget !== null ? t('image.cancelledBody') : t('write.cancelledBody')}
        </Callout>
      )}

      <div className="flex justify-end gap-2">
        {busy ? (
          <Button variant="danger" onClick={() => void cancelWrite()}>
            {t('common.cancel')}
          </Button>
        ) : (
          <Button
            variant="danger"
            disabled={!canWrite}
            onClick={() => {
              setConfirmText('')
              setConfirmOpen(true)
            }}
          >
            <ShieldAlert className="size-4" aria-hidden />
            {t('write.start')}
          </Button>
        )}
      </div>

      {/*
        **主導線の下に置く。** このツールの主用途は USB メモリを作ることで、
        イメージファイルは副次的な出口なので、デバイスの選択・書き込みオプション・
        「書き込みを開始」の並びに割り込ませない。
        見た目も分ける: こちらは secondary（枠だけ）で、消去の確認も要らない
        （ファイルを作るだけで、どのディスクも消さない）。
      */}
      <ImageCard busy={busy} />

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('write.confirmTitle')}
        footer={
          <>
            <Button onClick={() => setConfirmOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              disabled={confirmText.trim() !== t('write.confirmWord')}
              onClick={() => {
                setConfirmOpen(false)
                void startWrite()
              }}
            >
              {t('write.start')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {extraCaution && (
            <Callout tone="warning" title={t('write.extraCaution')}>
              {t('write.extraCautionBody')}
            </Callout>
          )}
          <Callout tone="danger" title={t('write.confirmBody')}>
            {selected && (
              <p className="mt-1 font-medium">
                {selected.description} · {formatBytes(selected.sizeBytes)} ·{' '}
                <span className="font-mono">{selected.id}</span>
              </p>
            )}
            {selected && selected.mountpoints.length > 0 && (
              <p className="mt-1 text-xs">
                {t('write.currentlyMounted', { mountpoints: selected.mountpoints.join(', ') })}
              </p>
            )}
          </Callout>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-800 dark:text-slate-200">
              {t('write.confirmTypeHint')}
            </label>
            <TextInput
              value={confirmText}
              autoFocus
              spellCheck={false}
              placeholder={t('write.confirmWord')}
              onChange={(e) => setConfirmText(e.target.value)}
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('write.doNotRemove')}</p>
        </div>
      </Modal>
    </div>
  )
}

/**
 * 「イメージファイル (.img) として保存」の導線。
 *
 * デバイスを 1 台も選ばずに使えるのが要点で、**権限昇格も起きない**
 * （ファイルに書くだけ）。押し間違いで USB を消す心配が無いので
 * 「消去」と打たせる確認は出さないが、その代わり**実デバイスのボタンと
 * 見た目を必ず分ける**（あちらは danger の赤、こちらは secondary の枠）。
 *
 * 使えないときは隠さずに理由を出す（落とし穴 61）。押せないボタンだけを
 * 置くと、なぜ押せないのかを画面から知る方法が無くなる。
 */
function ImageCard({ busy }: { busy: boolean }): React.JSX.Element {
  const t = useT()
  const iso = useStore((s) => s.iso)
  const config = useStore((s) => s.config)
  const settings = useStore((s) => s.settings)
  const imageTarget = useStore((s) => s.imageTarget)
  const saveAsImage = useStore((s) => s.saveAsImage)

  // 断る理由は 1 つだけ出す（ISO が無ければ設定の話をしても直せない）。
  const reason =
    iso === null ? t('image.needIso') : config?.ok === false ? t('image.needConfig') : null
  const canSave = reason === null && iso !== null && settings !== null && !busy

  return (
    <Card title={t('image.cardTitle')} description={t('image.cardHint')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Badge tone="success">{t('image.noElevation')}</Badge>
          {iso !== null && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('image.approxSize', { size: formatBytes(iso.minimumDeviceBytes) })}
            </p>
          )}
          {reason !== null && (
            <p className="text-xs text-amber-700 dark:text-amber-400">{reason}</p>
          )}
        </div>
        <Button variant="secondary" disabled={!canSave} onClick={() => void saveAsImage()}>
          <FileDown className="size-4" aria-hidden />
          {t('image.saveButton')}
        </Button>
      </div>
      {imageTarget !== null && (
        <p className="mt-3 truncate text-xs text-slate-600 dark:text-slate-300">
          {t('image.destination', { path: imageTarget.path })}
        </p>
      )}
      {/* 作ったイメージは「設定を書き加えた Ubuntu」。第三者に配らないよう伝える（docs/LEGAL.md） */}
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{t('image.redistributionNotice')}</p>
    </Card>
  )
}

/**
 * 選べない理由のバッジ。
 *
 * 理由は `LocalizedText` で運ばれてくるので、訳せない形（古いワーカー由来の
 * 未知のキー等）だと空文字になる。空のバッジは「赤い四角が付いているのに
 * 何も書いていない」だけで、読み手には何の情報にもならないので出さない。
 */
function BlockedBadge({ reason }: { reason: string }): React.JSX.Element | null {
  if (reason.length === 0) return null
  return <Badge tone="danger">{reason}</Badge>
}

function DeviceRow({
  device,
  selected,
  disabled,
  tooSmall,
  onSelect,
}: {
  device: DeviceInfo
  selected: boolean
  disabled: boolean
  tooSmall: boolean
  onSelect: () => void
}): React.JSX.Element {
  const t = useT()
  return (
    <li>
      <label
        className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition ${
          disabled
            ? 'cursor-not-allowed opacity-60'
            : selected
              ? 'border-sky-400 bg-sky-50 dark:border-sky-700 dark:bg-sky-950/40'
              : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800'
        }`}
      >
        <input
          type="radio"
          name="device"
          checked={selected}
          disabled={disabled}
          onChange={onSelect}
          className="size-4 shrink-0 accent-sky-600"
        />
        <Usb className="size-5 shrink-0 text-slate-500" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
            {device.description}
          </p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono">{device.id}</span>
            {device.serial !== null && <> · S/N {device.serial}</>}
            {device.mountpoints.length > 0 && <> · {device.mountpoints.join(', ')}</>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {tooSmall && <Badge tone="danger">{t('write.badgeTooSmall')}</Badge>}
          {!tooSmall && needsExtraCaution(device) && (
            <Badge tone="warning">{t('write.badgeCaution')}</Badge>
          )}
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {formatBytes(device.sizeBytes)}
          </span>
        </div>
      </label>
    </li>
  )
}

function WriteProgress(): React.JSX.Element {
  const t = useT()
  const tl = useTl()
  const locale = useStore((s) => s.locale)
  const status = useStore((s) => s.writeStatus)
  const imageTarget = useStore((s) => s.imageTarget)

  if (status.state === 'preparing') {
    return (
      <Card>
        <div className="flex items-center gap-3">
          <Loader2 className="size-5 animate-spin text-sky-600" aria-hidden />
          <p className="text-sm text-slate-700 dark:text-slate-300">{tl(status.message)}</p>
        </div>
        {/*
          **イメージファイルでは昇格しない。** ここで権限の話を出すと、
          出ないはずの UAC ダイアログを待たせることになる。
        */}
        {imageTarget === null ? (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {t('write.elevationNeeded')} — {t('write.elevationAllow')}
          </p>
        ) : (
          <p className="mt-2 truncate text-xs text-slate-500 dark:text-slate-400">
            {t('image.destination', { path: imageTarget.path })}
          </p>
        )}
      </Card>
    )
  }
  if (status.state !== 'writing') return <></>

  const phaseLabel =
    status.phase === 'verifying'
      ? t('write.verifying')
      : status.phase === 'flushing'
        ? t('write.flushing')
        : t('write.writing')

  return (
    <Card>
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{phaseLabel}</p>
          <p className="text-sm tabular-nums text-slate-600 dark:text-slate-400">
            {((status.bytesDone / Math.max(1, status.bytesTotal)) * 100).toFixed(1)}%
          </p>
        </div>
        <ProgressBar
          value={status.bytesDone}
          max={status.bytesTotal}
          tone={status.phase === 'verifying' ? 'success' : 'default'}
        />
        <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
          <span className="tabular-nums">
            {formatBytes(status.bytesDone)} / {formatBytes(status.bytesTotal)}
          </span>
          <span className="tabular-nums">
            {t('write.speed')}: {formatSpeed(status.bytesPerSecond)}
          </span>
          <span className="tabular-nums">
            {t('write.remaining')}: {formatEta(status.etaSeconds, locale)}
          </span>
        </div>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{tl(status.label)}</p>
      </div>
    </Card>
  )
}

function DoneView(): React.JSX.Element {
  const t = useT()
  const tx = useTx()
  const status = useStore((s) => s.writeStatus)
  const profile = useStore((s) => s.profile)
  const config = useStore((s) => s.config)
  const resetWrite = useStore((s) => s.resetWrite)
  if (status.state !== 'done') return <></>
  const seconds = Math.round(status.elapsedMs / 1000)
  // `outputPath` はイメージファイルへ書き出したときだけ載る（デバイスへの
  // 書き込みでは今までどおり無い）。**どこに保存したか分からない**を作らないため、
  // 完了画面ではパスをそのまま出す。
  const outputPath = status.outputPath ?? null

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 className="size-14 text-emerald-500" aria-hidden />
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            {outputPath === null ? t('write.done') : t('image.doneTitle')}
          </h2>
          <p className="max-w-md text-sm text-slate-600 dark:text-slate-400">
            {outputPath === null ? t('write.doneBody') : t('image.doneBody')}
          </p>
          {outputPath !== null && (
            <p className="max-w-full break-all rounded bg-slate-100 px-3 py-2 font-mono text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {t('image.doneSaved', { path: outputPath })}
            </p>
          )}
          {outputPath !== null && (
            <p className="max-w-md text-xs text-slate-500 dark:text-slate-400">{t('image.redistributionNotice')}</p>
          )}
          <div className="mt-2 flex flex-wrap justify-center gap-2 text-xs">
            <Badge tone="success">
              {t('write.badgeWritten', { size: formatBytes(status.bytesWritten) })}
            </Badge>
            <Badge>
              {t('write.badgeElapsed', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 })}
            </Badge>
            {status.verified ? (
              <Badge tone="success">{t('write.badgeVerified')}</Badge>
            ) : (
              <Badge tone="warning">{t('write.badgeNotVerified')}</Badge>
            )}
          </div>
          {/*
            同じ設定で続けて何本も作るのがこのツールの主な使われ方なので、
            完了画面から戻れないと「アプリを再起動しないと 2 本目が作れない」ことになる。
          */}
          <Button variant="secondary" onClick={resetWrite}>
            {t('write.another')}
          </Button>
        </div>
      </Card>

      <Card title={t('write.nextTitle')}>
        <ol className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
          {/*
            1 番目だけが経路で変わる。イメージファイルは「取り外して挿す」ではなく
            「焼いてから挿す」で、ここを USB のままにすると
            「安全な取り外し」をどこですればいいのか分からない案内になる。
          */}
          <Step n={1}>{outputPath === null ? t('write.next1') : t('image.next1')}</Step>
          <Step n={2}>{t('write.next2')}</Step>
          <Step n={3}>
            {tx('write.next3', {
              entry: <strong>Try or Install Ubuntu Server [Autoinstall]</strong>,
            })}
          </Step>
          <Step n={4}>
            {config?.unattended === true ? t('write.next4Unattended') : t('write.next4Interactive')}{' '}
            {profile.behavior.shutdown === 'reboot'
              ? t('write.next4Reboot')
              : t('write.next4Shutdown')}
          </Step>
          <Step n={5}>
            {tx('write.next5Login', {
              user: <code className="font-mono">{profile.user.username}</code>,
            })}
            {profile.ssh.installServer && (
              <>
                {' '}
                {tx('write.next5Ssh', {
                  command: (
                    <code className="font-mono">{`ssh ${profile.user.username}@${profile.basics.hostname}`}</code>
                  ),
                })}
              </>
            )}
          </Step>
        </ol>
        <div className="mt-4">
          <Callout tone="info" title={t('write.troubleTitle')}>
            {tx('write.troubleLogs', {
              path: <code className="font-mono">/var/log/installer/</code>,
            })}{' '}
            {tx('write.troubleApplied', {
              path: <code className="font-mono">/var/log/installer/autoinstall-user-data</code>,
            })}
          </Callout>
        </div>
      </Card>
    </div>
  )
}

function Step({ n, children }: { n: number; children: React.ReactNode }): React.JSX.Element {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-sky-100 text-xs font-semibold text-sky-700 dark:bg-sky-900 dark:text-sky-300">
        {n}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  )
}

export { XCircle }
