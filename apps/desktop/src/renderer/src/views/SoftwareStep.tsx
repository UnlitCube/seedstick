import { APT_MIRROR_PRESETS, COMMON_PACKAGES, SERIES_FEATURES } from '@autoinstall/shared'
import { useStore } from '../store.js'
import { useT } from '../lib/i18n.js'
import { Badge, Callout, Card, Field, RadioGroup, Select, Switch, TextArea, TextInput } from '../components/ui.js'
import { GpuSection } from './sections/Gpu.js'

export function SoftwareStep(): React.JSX.Element {
  const t = useT()
  const locale = useStore((s) => s.locale)
  const profile = useStore((s) => s.profile)
  const update = useStore((s) => s.updateProfile)
  const features = SERIES_FEATURES[profile.series]
  const label = (c: { labelJa: string; labelEn: string }): string =>
    locale === 'ja' ? c.labelJa : c.labelEn

  const selected = new Set(profile.software.packages)
  const commonValues = new Set(COMMON_PACKAGES.map((p) => p.value))
  const customPackages = profile.software.packages.filter((p) => !commonValues.has(p))

  const togglePackage = (value: string, on: boolean): void => {
    update((p) => {
      const next = new Set(p.software.packages)
      if (on) next.add(value)
      else next.delete(value)
      return { ...p, software: { ...p.software, packages: [...next] } }
    })
  }

  const setCustomPackages = (text: string): void => {
    const custom = text.split(/[\s,]+/).filter(Boolean)
    update((p) => ({
      ...p,
      software: {
        ...p.software,
        packages: [...p.software.packages.filter((x) => commonValues.has(x)), ...custom],
      },
    }))
  }

  return (
    <div className="space-y-5">
      {features.source && (
        <Card title={t('software.source')}>
          <RadioGroup
            value={profile.software.sourceId}
            onChange={(sourceId) =>
              update((p) => ({ ...p, software: { ...p.software, sourceId } }))
            }
            options={[
              {
                value: 'ubuntu-server' as const,
                label: t('software.sourceFull'),
                badge: <Badge tone="success">{t('common.recommended')}</Badge>,
                description: '通常のサーバー構成。よく使うツールが最初から入っています。',
              },
              {
                value: 'ubuntu-server-minimal' as const,
                label: t('software.sourceMinimal'),
                description:
                  'パッケージ数を最小限にします。コンテナホストなど用途が決まっている場合に。',
              },
            ]}
          />
        </Card>
      )}

      <Card title={t('software.packages')} description={t('software.packagesHint')}>
        <div className="grid gap-2 sm:grid-cols-2">
          {COMMON_PACKAGES.map((pkg) => (
            <Switch
              key={pkg.value}
              checked={selected.has(pkg.value)}
              onChange={(v) => togglePackage(pkg.value, v)}
              label={label(pkg)}
              description={<code className="font-mono text-[11px]">{pkg.value}</code>}
            />
          ))}
        </div>
        <div className="mt-4">
          <Field
            label={t('software.customPackages')}
            hint="apt でインストールできるパッケージ名をスペース区切りで書きます"
          >
            {(id) => (
              <TextInput
                id={id}
                value={customPackages.join(' ')}
                spellCheck={false}
                placeholder="nginx postgresql-client jq"
                onChange={(e) => setCustomPackages(e.target.value)}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card title={t('software.snaps')}>
        <Field label="snap 名（1 行に 1 つ。channel を指定する場合は `名前 channel`）">
          {(id) => (
            <TextArea
              id={id}
              rows={3}
              spellCheck={false}
              placeholder={'microk8s --classic\nlxd 5.21/stable'}
              value={profile.software.snaps
                .map((s) => [s.name, s.channel, s.classic ? '--classic' : ''].filter(Boolean).join(' '))
                .join('\n')}
              onChange={(e) => {
                const snaps = e.target.value
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean)
                  .map((line) => {
                    const parts = line.split(/\s+/)
                    const name = parts[0]!
                    const classic = parts.includes('--classic')
                    const channel = parts.slice(1).find((p) => !p.startsWith('--'))
                    return {
                      name,
                      ...(channel ? { channel } : {}),
                      ...(classic ? { classic: true } : {}),
                    }
                  })
                update((p) => ({ ...p, software: { ...p.software, snaps } }))
              }}
            />
          )}
        </Field>
      </Card>

      <Card title="更新とドライバ">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('software.updates')}>
            {(id) => (
              <Select
                id={id}
                value={profile.software.updates}
                onChange={(v) =>
                  update((p) => ({
                    ...p,
                    software: { ...p.software, updates: v as 'security' | 'all' },
                  }))
                }
                options={[
                  { value: 'security', label: t('software.updatesSecurity') },
                  { value: 'all', label: t('software.updatesAll') },
                ]}
              />
            )}
          </Field>
          {features.kernelCrashDumps && (
            <Field label={t('software.kernelCrashDumps')}>
              {(id) => (
                <Select
                  id={id}
                  value={
                    profile.software.kernelCrashDumps === null
                      ? 'default'
                      : profile.software.kernelCrashDumps
                        ? 'on'
                        : 'off'
                  }
                  onChange={(v) =>
                    update((p) => ({
                      ...p,
                      software: {
                        ...p.software,
                        kernelCrashDumps: v === 'default' ? null : v === 'on',
                      },
                    }))
                  }
                  options={[
                    { value: 'default', label: 'インストーラの既定にまかせる' },
                    { value: 'on', label: '有効にする' },
                    { value: 'off', label: '無効にする' },
                  ]}
                />
              )}
            </Field>
          )}
        </div>
        <div className="mt-4">
          <Switch
            checked={profile.software.installDrivers}
            onChange={(v) => update((p) => ({ ...p, software: { ...p.software, installDrivers: v } }))}
            label={t('software.drivers')}
            description="NVIDIA など、サードパーティのドライバを自動で検出してインストールします。"
          />
        </div>
      </Card>

      <GpuSection />

      <Card title={t('software.aptMirror')}>
        <RadioGroup
          value={profile.apt.mode}
          onChange={(mode) => update((p) => ({ ...p, apt: { ...p.apt, mode } }))}
          options={[
            {
              value: 'default' as const,
              label: t('software.aptMirrorDefault'),
              description: 'archive.ubuntu.com を使います。',
            },
            {
              value: 'country-mirror' as const,
              label: t('software.aptMirrorCountry'),
              badge: <Badge tone="success">{t('common.recommended')}</Badge>,
              description: 'インストーラが接続元の国から最寄りのミラーを選びます。ダウンロードが速くなります。',
            },
            {
              value: 'custom' as const,
              label: t('software.aptMirrorCustom'),
              description: '社内ミラーなどを指定します。',
            },
          ]}
        />
        {profile.apt.mode === 'custom' && (
          <div className="mt-4 space-y-3">
            <Field label="ミラーの URL">
              {(id) => (
                <TextInput
                  id={id}
                  value={profile.apt.primaryUri}
                  spellCheck={false}
                  placeholder="http://jp.archive.ubuntu.com/ubuntu"
                  onChange={(e) => update((p) => ({ ...p, apt: { ...p.apt, primaryUri: e.target.value } }))}
                />
              )}
            </Field>
            <div className="flex flex-wrap gap-2">
              {APT_MIRROR_PRESETS.map((m) => (
                <button
                  key={m.value}
                  onClick={() => update((p) => ({ ...p, apt: { ...p.apt, primaryUri: m.value } }))}
                  className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {label(m)}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="mt-4">
          <Field label={t('software.aptProxy')} hint="社内プロキシ経由でパッケージを取得する場合（任意）">
            {(id) => (
              <TextInput
                id={id}
                value={profile.apt.proxy}
                spellCheck={false}
                placeholder="http://proxy.example.local:3142"
                onChange={(e) => update((p) => ({ ...p, apt: { ...p.apt, proxy: e.target.value } }))}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card title={t('software.ubuntuPro')}>
        <Field
          label="トークン"
          hint="C で始まる 24〜30 文字。設定すると ESM などのサービスが有効になります（任意）。"
        >
          {(id) => (
            <TextInput
              id={id}
              value={profile.software.ubuntuProToken}
              spellCheck={false}
              placeholder="C1a2b3..."
              onChange={(e) =>
                update((p) => ({ ...p, software: { ...p.software, ubuntuProToken: e.target.value.trim() } }))
              }
            />
          )}
        </Field>
        {!features.ubuntuPro && profile.software.ubuntuProToken && (
          <div className="mt-3">
            <Callout tone="info">
              Ubuntu {profile.series} では <code className="font-mono">ubuntu-advantage</code> キーとして
              出力されます（<code className="font-mono">ubuntu-pro</code> は 24.04 以降）。
            </Callout>
          </div>
        )}
      </Card>
    </div>
  )
}
