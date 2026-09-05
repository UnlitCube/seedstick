import { useState, type DragEvent } from 'react'
import { CheckCircle2, Disc3, ExternalLink, FileWarning, Loader2, ShieldCheck } from 'lucide-react'
import { SERIES_CATALOG, isEndOfLife, monthsUntilEol, type ChecksumResult } from '@autoinstall/shared'
import { useStore } from '../store.js'
import { useT } from '../lib/i18n.js'
import { formatBytes } from '../lib/format.js'
import { Badge, Button, Callout, Card, CodeBlock, ProgressBar } from '../components/ui.js'

/** EOL 判定に使う日付。実行時の日付をそのまま使う（テストでは catalog 側を直接検証する）。 */
const TODAY = new Date().toISOString().slice(0, 10)

/** サポート終了（または終了間近）のバージョンを選んだときに出す警告。 */
function EolNotice({ series }: { series: keyof typeof SERIES_CATALOG }): React.JSX.Element | null {
  const t = useT()
  const entry = SERIES_CATALOG[series]
  const months = monthsUntilEol(entry, TODAY)
  if (isEndOfLife(entry, TODAY)) {
    return (
      <Callout tone="danger" title={t('iso.eol')}>
        <p>{t('iso.eolBody')}</p>
        <p className="mt-1 text-xs">
          Ubuntu {entry.series} ({entry.codename}) の標準サポートは {entry.eol} に終了しました。
        </p>
      </Callout>
    )
  }
  // 残り 6 か月を切ったら予告する
  if (months <= 6) {
    return (
      <Callout tone="warning" title={t('iso.eolSoon')}>
        Ubuntu {entry.series} の標準サポートは {entry.eol} に終了します（残り約 {months} か月）。
      </Callout>
    )
  }
  return null
}

export function IsoStep(): React.JSX.Element {
  const t = useT()
  const { iso, isoError, isoBusy, checksum, checksumProgress } = useStore()
  const chooseIso = useStore((s) => s.chooseIso)
  const openIsoPath = useStore((s) => s.openIsoPath)
  const clearIso = useStore((s) => s.clearIso)
  const verifyChecksum = useStore((s) => s.verifyChecksum)
  const [dragOver, setDragOver] = useState(false)
  const [showGrub, setShowGrub] = useState(false)

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    // `File.path` は Electron 32 で削除された（44 では常に undefined）。
    // preload の webUtils.getPathForFile 経由でしか実体パスは取れない。
    const path = window.autoinstall.pathForDroppedFile(file)
    if (path) void openIsoPath(path)
  }

  return (
    <div className="space-y-5">
      <Card title={t('iso.title')} description={t('iso.description')}>
        {!iso ? (
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition ${
              dragOver
                ? 'border-sky-400 bg-sky-50 dark:bg-sky-950/40'
                : 'border-slate-300 dark:border-slate-600'
            }`}
          >
            <Disc3 className="size-10 text-slate-400" aria-hidden />
            <Button variant="primary" onClick={() => void chooseIso()} disabled={isoBusy}>
              {isoBusy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('iso.choose')}
            </Button>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('iso.dropHint')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/40">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900 dark:text-slate-100">{t('iso.detected')}</p>
                <p className="mt-1 truncate font-mono text-sm text-slate-700 dark:text-slate-300">
                  {iso.fileName}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
                  <Detail label={t('iso.version')}>
                    Ubuntu Server {iso.identity.version}
                    {iso.identity.isLts && (
                      <Badge tone="info">
                        <span>LTS</span>
                      </Badge>
                    )}
                  </Detail>
                  <Detail label={t('iso.arch')}>{iso.identity.arch}</Detail>
                  <Detail label={t('iso.size')}>{formatBytes(iso.sizeBytes)}</Detail>
                  {iso.identity.codename !== undefined && (
                    <Detail label="コードネーム">{iso.identity.codename}</Detail>
                  )}
                  {iso.identity.buildId !== undefined && (
                    <Detail label="ビルド">{iso.identity.buildId}</Detail>
                  )}
                  <Detail label="必要な USB 容量">{formatBytes(iso.minimumDeviceBytes)} 以上</Detail>
                </dl>
              </div>
              <Button variant="ghost" onClick={clearIso}>
                選び直す
              </Button>
            </div>

            <EolNotice series={iso.identity.series} />

            <ChecksumPanel
              onVerify={() => void verifyChecksum()}
              checksum={checksum}
              progress={checksumProgress}
              totalBytes={iso.sizeBytes}
            />

            <div>
              <button
                onClick={() => setShowGrub(!showGrub)}
                className="text-sm text-sky-700 underline-offset-2 hover:underline dark:text-sky-400"
              >
                {showGrub ? '起動メニューの変更内容を隠す' : '起動メニューにどんな変更を加えるか見る'}
              </button>
              {showGrub && (
                <div className="mt-3 space-y-3">
                  <Callout tone="info">
                    ISO の中の <code className="font-mono">/boot/grub/grub.cfg</code> だけを書き換え、
                    カーネル引数に <code className="font-mono">autoinstall</code> を追加します。
                    これが無いと「Continue with autoinstall? (yes|no)」で止まってしまうため必須です。
                    ISO ファイル自体は変更しません。
                  </Callout>
                  <CodeBlock code={iso.patchedGrubCfg} maxHeight="18rem" />
                </div>
              )}
            </div>
          </div>
        )}

        {isoError !== null && (
          <div className="mt-4">
            <Callout tone="danger" title={t('iso.unsupported')}>
              <p>{isoError}</p>
              <p className="mt-2 text-xs">
                対応しているのは Ubuntu Server の <strong>live-server</strong> 版 ISO です。
                Desktop 版や他のフレーバー、他のディストリビューションには対応していません。
              </p>
            </Callout>
          </div>
        )}
      </Card>

      <Card
        title="ISO を持っていない場合"
        description="このツールは ISO を同梱しません。Ubuntu の公式サイトからダウンロードしてください。"
      >
        <ul className="space-y-2">
          {Object.values(SERIES_CATALOG).map((c) => (
            <li
              key={c.series}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  Ubuntu Server {c.knownLatestVersion} {c.isLts && <Badge tone="info">LTS</Badge>}
                </p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {c.codename} · 約 {formatBytes(c.knownIsoSize)} · {t('iso.supportUntil')} {c.eol}
                  {isEndOfLife(c, TODAY) && (
                    <>
                      {' '}
                      <Badge tone="danger">サポート終了</Badge>
                    </>
                  )}
                </p>
              </div>
              <Button onClick={() => void window.autoinstall.openExternal(c.releaseDir)}>
                <ExternalLink className="size-4" aria-hidden />
                {t('iso.download')}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200">
        {children}
      </dd>
    </div>
  )
}

function ChecksumPanel({
  onVerify,
  checksum,
  progress,
  totalBytes,
}: {
  onVerify: () => void
  checksum: ChecksumResult | null
  progress: { bytesDone: number; bytesTotal: number } | null
  totalBytes: number
}): React.JSX.Element {
  const t = useT()
  if (progress) {
    return (
      <div className="space-y-2 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
        <p className="text-sm text-slate-700 dark:text-slate-300">
          チェックサムを計算しています… {formatBytes(progress.bytesDone)} / {formatBytes(totalBytes)}
        </p>
        <ProgressBar value={progress.bytesDone} max={progress.bytesTotal} />
      </div>
    )
  }
  if (!checksum) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
        <div>
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
            {t('iso.checksumVerify')}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            ダウンロードが壊れていないか、公式のチェックサムと照合します（数分かかります）
          </p>
        </div>
        <Button onClick={onVerify}>
          <ShieldCheck className="size-4" aria-hidden />
          確認する
        </Button>
      </div>
    )
  }
  const tone = checksum.official === 'match' ? 'success' : checksum.official === 'mismatch' ? 'danger' : 'warning'
  const title =
    checksum.official === 'match'
      ? t('iso.checksumOk')
      : checksum.official === 'mismatch'
        ? t('iso.checksumMismatch')
        : t('iso.checksumOffline')
  return (
    <Callout tone={tone} title={title}>
      <p className="break-all font-mono text-xs">{checksum.sha256}</p>
      {checksum.official === 'mismatch' && (
        <p className="mt-2 font-medium">
          この ISO は使わないでください。もう一度ダウンロードし直すことを強く推奨します。
        </p>
      )}
      {checksum.official === 'unknown' && (
        <p className="mt-2 flex items-start gap-1 text-xs">
          <FileWarning className="mt-0.5 size-3 shrink-0" aria-hidden />
          公式の一覧を取得できませんでした。ハッシュ値は Ubuntu 公式サイトの SHA256SUMS と手動で
          見比べてください。
        </p>
      )}
    </Callout>
  )
}
