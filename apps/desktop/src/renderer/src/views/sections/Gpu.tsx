import { Cpu, ExternalLink } from 'lucide-react'
import {
  CUDA_REPO_DISTRO,
  CUDA_TOOLKIT_CHOICES,
  cudaKeyringUrl,
  cudaPackages,
  type CudaDriverChoice,
} from '@autoinstall/shared'
import { useStore } from '../../store.js'
import { useT } from '../../lib/i18n.js'
import { Badge, Callout, Card, Field, RadioGroup, Select, Switch } from '../../components/ui.js'

/** NVIDIA ドライバ / CUDA の設定。 */
export function GpuSection(): React.JSX.Element {
  const t = useT()
  const locale = useStore((s) => s.locale)
  const series = useStore((s) => s.profile.series)
  const gpu = useStore((s) => s.profile.software.gpu)
  const dockerEnabled = useStore((s) => s.profile.postInstall.presets.includes('docker-ce'))
  const update = useStore((s) => s.updateProfile)

  const setGpu = (patch: Partial<typeof gpu>): void =>
    update((p) => ({ ...p, software: { ...p.software, gpu: { ...p.software.gpu, ...patch } } }))

  const repoAvailable = CUDA_REPO_DISTRO[series] !== null
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
        disabled={!repoAvailable}
        description={
          repoAvailable
            ? `NVIDIA の ${CUDA_REPO_DISTRO[series]} リポジトリを使います。`
            : `${t('gpu.unsupported')}（Ubuntu ${series}）`
        }
      />

      {!repoAvailable && (
        <div className="mt-3">
          <Callout tone="warning" title={t('gpu.unsupported')}>
            NVIDIA は Ubuntu {series} 向けの CUDA リポジトリを公開していません。
            LTS 版（22.04 / 24.04 / 26.04）の ISO を使ってください。
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
            <Callout tone="warning">
              コンテナから GPU を使う設定ですが、Docker がインストールされません。
              「インストール後」の「よく使う設定」で Docker を有効にしてください。
            </Callout>
          )}

          <Callout tone="info" title="インストールされるもの">
            <ul className="mt-1 space-y-0.5">
              {packages.map((p) => (
                <li key={p} className="font-mono text-xs">
                  {p}
                </li>
              ))}
              {packages.length === 0 && <li className="text-xs">（ドライバもツールキットも選ばれていません）</li>}
            </ul>
            <p className="mt-2 text-xs">
              初回起動時に <code className="font-mono">cuda-keyring</code> を導入してから apt で
              インストールします。
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
                NVIDIA の公式手順
              </button>
            )}
          </Callout>
        </div>
      )}
    </Card>
  )
}
