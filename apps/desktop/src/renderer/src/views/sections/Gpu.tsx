import { Cpu, ExternalLink } from 'lucide-react'
import {
  CUDA_REPO_DISTRO,
  CUDA_TOOLKIT_CHOICES,
  cudaKeyringUrl,
  cudaPackages,
  type CudaDriverChoice,
} from '@autoinstall/shared'
import { useStore } from '../../store.js'
import { useT, useTx } from '../../lib/i18n.js'
import { Badge, Callout, Card, Field, RadioGroup, Select, Switch } from '../../components/ui.js'

/** NVIDIA ドライバ / CUDA の設定。 */
export function GpuSection(): React.JSX.Element {
  const t = useT()
  const tx = useTx()
  const locale = useStore((s) => s.locale)
  const series = useStore((s) => s.profile.series)
  const gpu = useStore((s) => s.profile.software.gpu)
  const dockerEnabled = useStore((s) => s.profile.postInstall.presets.includes('docker-ce'))
  const update = useStore((s) => s.updateProfile)

  const setGpu = (patch: Partial<typeof gpu>): void =>
    update((p) => ({ ...p, software: { ...p.software, gpu: { ...p.software.gpu, ...patch } } }))

  // CUDA のリポジトリ URL は x86_64 固定（cudaKeyringUrl）。
  // arm64 の ISO でも設定できてしまうと、初回起動時に keyring の取得が
  // 404 で失敗する。ISO のアーキテクチャを見て、その場で伝える。
  const isoArch = useStore((s) => s.iso?.identity.arch ?? null)
  const archSupported = isoArch === null || isoArch === 'amd64'
  const repoAvailable = CUDA_REPO_DISTRO[series] !== null && archSupported
  const packages = cudaPackages(gpu)

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Cpu className="size-4 text-slate-500" aria-hidden />
          {t('gpu.title')}
        </span>
      }
      description={t('gpu.description')}
    >
      <Switch
        checked={gpu.enabled}
        onChange={(v) => setGpu({ enabled: v })}
        label={t('gpu.enable')}
        // 非対応バージョンでも「切る」ことはできなければならない。
        // enabled=true のプロファイルを 25.10 の ISO と組み合わせると、
        // 設定パネルも隠れるので、解除できない検証エラーで書き込めなくなっていた。
        disabled={!repoAvailable && !gpu.enabled}
        description={
          repoAvailable
            ? t('gpu.repoInUse', { repo: CUDA_REPO_DISTRO[series] ?? '' })
            : t('gpu.unsupportedSeries', { series })
        }
      />

      {!archSupported && (
        <div className="mt-3">
          <Callout tone="warning" title={t('gpu.unsupported')}>
            {t('gpu.archUnsupportedBody', { arch: isoArch ?? '' })}
          </Callout>
        </div>
      )}

      {archSupported && CUDA_REPO_DISTRO[series] === null && (
        <div className="mt-3">
          <Callout tone="warning" title={t('gpu.unsupported')}>
            {t('gpu.noRepoBody', { series })}
          </Callout>
        </div>
      )}

      {gpu.enabled && repoAvailable && (
        <div className="mt-5 space-y-5">
          <Field label={t('gpu.driver')}>
            {() => (
              <RadioGroup<CudaDriverChoice>
                value={gpu.driver}
                onChange={(driver) => setGpu({ driver })}
                options={[
                  {
                    value: 'open',
                    label: t('gpu.driverOpen'),
                    badge: <Badge tone="success">{t('common.recommended')}</Badge>,
                    description: t('gpu.driverOpenHint'),
                  },
                  {
                    value: 'proprietary',
                    label: t('gpu.driverProprietary'),
                    description: t('gpu.driverProprietaryHint'),
                  },
                  { value: 'none', label: t('gpu.driverNone') },
                ]}
              />
            )}
          </Field>

          <Field label={t('gpu.toolkit')}>
            {(id) => (
              <Select
                id={id}
                value={gpu.toolkit}
                onChange={(toolkit) => setGpu({ toolkit })}
                options={CUDA_TOOLKIT_CHOICES.map((c) => ({
                  value: c.value,
                  label: locale === 'ja' ? c.labelJa : c.labelEn,
                }))}
              />
            )}
          </Field>

          <div className="space-y-2">
            <Switch
              checked={gpu.setupPath}
              onChange={(setupPath) => setGpu({ setupPath })}
              label={t('gpu.setupPath')}
              description={t('gpu.setupPathHint')}
            />
            <Switch
              checked={gpu.containerToolkit}
              onChange={(containerToolkit) => setGpu({ containerToolkit })}
              label={t('gpu.containerToolkit')}
              description={t('gpu.containerToolkitHint')}
            />
          </div>

          {gpu.containerToolkit && !dockerEnabled && (
            <Callout tone="warning">{t('gpu.dockerMissing')}</Callout>
          )}

          <Callout tone="info" title={t('gpu.willInstall')}>
            <ul className="mt-1 space-y-0.5">
              {packages.map((p) => (
                <li key={p} className="font-mono text-xs">
                  {p}
                </li>
              ))}
              {packages.length === 0 && <li className="text-xs">{t('gpu.nothingSelected')}</li>}
            </ul>
            <p className="mt-2 text-xs">
              {tx('gpu.installNote', {
                keyring: <code className="font-mono">cuda-keyring</code>,
              })}
              {gpu.driver !== 'none' && ` ${t('gpu.rebootNote')}`}
            </p>
            {cudaKeyringUrl(series) !== null && (
              <button
                onClick={() =>
                  void window.autoinstall.openExternal(
                    'https://docs.nvidia.com/cuda/cuda-installation-guide-linux/',
                  )
                }
                className="mt-2 inline-flex items-center gap-1 text-xs text-sky-700 underline-offset-2 hover:underline dark:text-sky-400"
              >
                <ExternalLink className="size-3" aria-hidden />
                {t('gpu.officialGuide')}
              </button>
            )}
          </Callout>
        </div>
      )}
    </Card>
  )
}
