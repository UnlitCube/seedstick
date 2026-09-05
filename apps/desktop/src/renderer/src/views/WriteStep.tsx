import { useState } from 'react'
import {
  CheckCircle2,
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
import { useT } from '../lib/i18n.js'
import { formatBytes, formatEta, formatSpeed } from '../lib/format.js'
import { Badge, Button, Callout, Card, Modal, ProgressBar, Switch, TextInput } from '../components/ui.js'

export function WriteStep(): React.JSX.Element {
  const t = useT()
  const locale = useStore((s) => s.locale)
  const { devices, devicesBusy, selectedDeviceId, writeStatus, iso, config, settings } = useStore()
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
        <Callout tone="warning" title="ISO が選ばれていません">
          最初のステップに戻って ISO ファイルを選んでください。
        </Callout>
      )}
      {config?.ok === false && (
        <Callout tone="danger" title="設定にエラーがあります">
          「確認」のステップでエラーを修正してから書き込んでください。
        </Callout>
      )}

      <Card
        title={t('write.selectDevice')}
        description={iso ? `この ISO には ${formatBytes(iso.minimumDeviceBytes)} 以上の USB メモリが必要です。` : undefined}
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
              書き込めないデバイス ({blocked.length} 台) を表示
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
                  <Badge tone="danger">{d.blockedReason}</Badge>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      {tooSmall && selected !== null && iso !== null && (
        <Callout tone="danger" title={t('error.isoTooBig')}>
          このデバイスは {formatBytes(selected.sizeBytes)} ですが、{formatBytes(iso.minimumDeviceBytes)}{' '}
          以上が必要です。
        </Callout>
      )}

      {settings && (
        <Card title="書き込みオプション">
          <div className="space-y-2">
            <Switch
              checked={settings.verifyAfterWrite}
              disabled={busy}
              onChange={(v) => void saveSettings((s) => ({ ...s, verifyAfterWrite: v }))}
              label={t('write.verifyOption')}
              description="書き込んだ内容を読み戻してハッシュを照合します。安価な USB メモリの不良を検出できます。"
            />
            <Switch
              checked={settings.auditRecord}
              disabled={busy}
              onChange={(v) => void saveSettings((s) => ({ ...s, auditRecord: v }))}
              label={t('write.auditRecord')}
              description="作成日時・ISO 名・設定のハッシュを autoinstall-usb.json として残します。パスワードは含みません。"
            />
          </div>
        </Card>
      )}

      {busy && <WriteProgress />}

      {writeStatus.state === 'error' && (
        <Callout tone="danger" title={t('write.failed')}>
          <p>{writeStatus.message}</p>
          {writeStatus.detail !== null && (
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-900/10 p-2 text-[11px] dark:bg-slate-950/40">
              {writeStatus.detail}
            </pre>
          )}
        </Callout>
      )}
      {writeStatus.state === 'cancelled' && (
        <Callout tone="warning" title={t('write.cancelled')}>
          {t('write.cancelledBody')}
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
                現在マウントされています: {selected.mountpoints.join(', ')}
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
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {locale === 'ja'
              ? '書き込み中に USB メモリを抜かないでください。'
              : 'Do not remove the USB drive while writing.'}
          </p>
        </div>
      </Modal>
    </div>
  )
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
          {tooSmall && <Badge tone="danger">容量不足</Badge>}
          {!tooSmall && needsExtraCaution(device) && (
            <Badge tone="warning">要確認</Badge>
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
  const locale = useStore((s) => s.locale)
  const status = useStore((s) => s.writeStatus)

  if (status.state === 'preparing') {
    return (
      <Card>
        <div className="flex items-center gap-3">
          <Loader2 className="size-5 animate-spin text-sky-600" aria-hidden />
          <p className="text-sm text-slate-700 dark:text-slate-300">{status.message}</p>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {t('write.elevationNeeded')} — 権限の確認ダイアログが出たら許可してください。
        </p>
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
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{status.label}</p>
      </div>
    </Card>
  )
}

function DoneView(): React.JSX.Element {
  const t = useT()
  const status = useStore((s) => s.writeStatus)
  const profile = useStore((s) => s.profile)
  const config = useStore((s) => s.config)
  const resetWrite = useStore((s) => s.resetWrite)
  if (status.state !== 'done') return <></>
  const seconds = Math.round(status.elapsedMs / 1000)

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <CheckCircle2 className="size-14 text-emerald-500" aria-hidden />
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t('write.done')}</h2>
          <p className="max-w-md text-sm text-slate-600 dark:text-slate-400">{t('write.doneBody')}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2 text-xs">
            <Badge tone="success">{formatBytes(status.bytesWritten)} 書き込み</Badge>
            <Badge>{Math.floor(seconds / 60)} 分 {seconds % 60} 秒</Badge>
            {status.verified ? (
              <Badge tone="success">読み戻し確認 OK</Badge>
            ) : (
              <Badge tone="warning">読み戻し確認なし</Badge>
            )}
          </div>
          {/*
            同じ設定で続けて何本も作るのがこのツールの主な使われ方なので、
            完了画面から戻れないと「アプリを再起動しないと 2 本目が作れない」ことになる。
          */}
          <Button variant="secondary" onClick={resetWrite}>
            もう一本作る
          </Button>
        </div>
      </Card>

      <Card title="次にすること">
        <ol className="space-y-3 text-sm text-slate-700 dark:text-slate-300">
          <Step n={1}>USB メモリを安全に取り外し、インストールしたいサーバーに挿します。</Step>
          <Step n={2}>
            サーバーの電源を入れ、起動デバイスとして USB を選びます（多くの機種で F12 / F11 / Esc）。
          </Step>
          <Step n={3}>
            GRUB のメニューで <strong>Try or Install Ubuntu Server [Autoinstall]</strong> を選びます
            （30 秒で自動的に始まります）。
          </Step>
          <Step n={4}>
            {config?.unattended === true
              ? 'あとは何も操作せずに待つだけです。完了すると自動的に'
              : '一部の項目で入力を求められます。完了すると'}
            {profile.behavior.shutdown === 'reboot' ? '再起動します。' : '電源が切れます。'}
          </Step>
          <Step n={5}>
            再起動後、<code className="font-mono">{profile.user.username}</code> でログインできます。
            {profile.ssh.installServer && (
              <>
                {' '}SSH は <code className="font-mono">ssh {profile.user.username}@{profile.basics.hostname}</code>{' '}
                です。
              </>
            )}
          </Step>
        </ol>
        <div className="mt-4">
          <Callout tone="info" title="うまくいかないときは">
            インストール先の <code className="font-mono">/var/log/installer/</code> にログが残ります。
            実際に適用された設定は{' '}
            <code className="font-mono">/var/log/installer/autoinstall-user-data</code>{' '}
            で確認できます（root のみ読めます）。
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
