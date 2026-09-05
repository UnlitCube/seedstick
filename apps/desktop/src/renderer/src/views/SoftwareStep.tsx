import {
  APT_FALLBACK_CHOICES,
  APT_MIRROR_PRESETS,
  COMMON_PACKAGES,
  KERNEL_FLAVORS,
  SERIES_FEATURES,
  isDebLineSource,
  isPpaSource,
  type AptFallback,
  type AptSource,
  type KernelChoice,
} from '@autoinstall/shared'
import { useStore } from '../store.js'
import { useT } from '../lib/i18n.js'
import { Badge, Callout, Card, Field, RadioGroup, Select, Switch, TextArea, TextInput } from '../components/ui.js'
import { Plus, Trash2 } from 'lucide-react'
import { GpuSection } from './sections/Gpu.js'

/** 既存と衝突しない `.list` 名を作る。curtin の apt.sources はマップなので名前が一意でないと消える。 */
function nextSourceName(existing: readonly AptSource[]): string {
  const used = new Set(existing.map((s) => s.name))
  for (let i = 1; ; i++) {
    const name = `extra-${i}.list`
    if (!used.has(name)) return name
  }
}

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

  const setSource = (index: number, patch: Partial<AptSource>): void =>
    update((p) => ({
      ...p,
      apt: { ...p.apt, sources: p.apt.sources.map((s, i) => (i === index ? { ...s, ...patch } : s)) },
    }))

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
        <div className="mt-4 space-y-3">
          <Switch
            checked={profile.software.installDrivers}
            onChange={(v) => update((p) => ({ ...p, software: { ...p.software, installDrivers: v } }))}
            label={t('software.drivers')}
            description="NVIDIA など、サードパーティのドライバを自動で検出してインストールします。"
          />
          {features.source && (
            // Switch だと「探索を止める」(false) が選べず null に戻ってしまうので 3 状態にする。
            // null は source.search_drivers を出さない＝インストーラの既定に任せる。
            <Field label={t('adv.searchDrivers')} hint={t('adv.searchDriversHint')}>
              {(id) => (
                <Select
                  id={id}
                  value={
                    profile.software.searchDrivers === null
                      ? 'default'
                      : profile.software.searchDrivers
                        ? 'on'
                        : 'off'
                  }
                  onChange={(v) =>
                    update((p) => ({
                      ...p,
                      software: {
                        ...p.software,
                        searchDrivers: v === 'default' ? null : v === 'on',
                      },
                    }))
                  }
                  options={[
                    { value: 'default', label: t('adv.searchDriversDefault') },
                    { value: 'on', label: t('adv.searchDriversOn') },
                    { value: 'off', label: t('adv.searchDriversOff') },
                  ]}
                />
              )}
            </Field>
          )}
          {features.codecsOemAd && (
            <Switch
              checked={profile.software.codecs}
              onChange={(codecs) => update((p) => ({ ...p, software: { ...p.software, codecs } }))}
              label={t('adv.codecs')}
              description={t('adv.codecsHint')}
            />
          )}
          {features.codecsOemAd && (
            <Switch
              checked={profile.software.oem === 'yes'}
              onChange={(on) =>
                update((p) => ({ ...p, software: { ...p.software, oem: on ? 'yes' : 'auto' } }))
              }
              label={t('adv.oem')}
              description={t('adv.oemHint')}
            />
          )}
        </div>

        <div className="mt-5">
          <Field label={t('adv.kernelTitle')}>
            {(id) => (
              <Select
                id={id}
                value={
                  profile.software.kernel.mode === 'default'
                    ? 'default'
                    : profile.software.kernel.mode === 'package'
                      ? 'package'
                      : profile.software.kernel.flavor
                }
                onChange={(v) => {
                  const kernel: KernelChoice =
                    v === 'default'
                      ? { mode: 'default' }
                      : v === 'package'
                        ? {
                            mode: 'package',
                            package:
                              profile.software.kernel.mode === 'package'
                                ? profile.software.kernel.package
                                : '',
                          }
                        : { mode: 'flavor', flavor: v }
                  update((p) => ({ ...p, software: { ...p.software, kernel } }))
                }}
                options={[
                  { value: 'default', label: t('adv.kernelDefault') },
                  ...KERNEL_FLAVORS.map((f) => ({ value: f.value, label: label(f) })),
                  { value: 'package', label: t('adv.kernelCustom') },
                ]}
              />
            )}
          </Field>
          {profile.software.kernel.mode === 'package' && (
            <div className="mt-3">
              <Field label={t('adv.kernelFlavor')} required>
                {(id) => (
                  <TextInput
                    id={id}
                    spellCheck={false}
                    placeholder="linux-generic-hwe-24.04"
                    value={profile.software.kernel.mode === 'package' ? profile.software.kernel.package : ''}
                    onChange={(e) =>
                      update((p) => ({
                        ...p,
                        software: { ...p.software, kernel: { mode: 'package', package: e.target.value } },
                      }))
                    }
                  />
                )}
              </Field>
            </div>
          )}
          {profile.software.kernel.mode === 'flavor' &&
            profile.software.kernel.flavor.includes('hwe') && (
              <div className="mt-3">
                <Callout tone="info">{t('adv.kernelHweHint')}</Callout>
              </div>
            )}
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

      <Card title={t('adv.aptTitle')}>
        <Field label={t('adv.aptSources')} hint={t('adv.aptSourcesHint')}>
          {() => (
            <div className="space-y-2">
              {profile.apt.sources.map((src, i) => (
                <div key={src.id} className="flex gap-2">
                  <TextInput
                    value={src.source}
                    spellCheck={false}
                    placeholder="ppa:ondrej/php"
                    invalid={src.source !== '' && !isPpaSource(src.source) && !isDebLineSource(src.source)}
                    onChange={(e) => setSource(i, { source: e.target.value })}
                  />
                  <button
                    type="button"
                    aria-label={t('common.delete')}
                    onClick={() =>
                      update((p) => ({
                        ...p,
                        apt: { ...p.apt, sources: p.apt.sources.filter((_, j) => j !== i) },
                      }))
                    }
                    className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  update((p) => ({
                    ...p,
                    apt: {
                      ...p.apt,
                      sources: [
                        ...p.apt.sources,
                        {
                          id: crypto.randomUUID(),
                          // 連番だと「2 件足して 1 件消してまた足す」で名前が衝突し、
                          // curtin の sources はマップなので片方が黙って消える。
                          name: nextSourceName(p.apt.sources),
                          source: '',
                          key: '',
                        } satisfies AptSource,
                      ],
                    },
                  }))
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 transition hover:border-slate-400 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                <Plus className="size-4" aria-hidden />
                {t('common.add')}
              </button>
            </div>
          )}
        </Field>

        {profile.apt.sources.some((s) => isDebLineSource(s.source)) && (
          <div className="mt-3">
            <Callout tone="warning">
              deb 行を直接書いた場合、署名鍵は自分で用意する必要があります（`signed-by=` を指定するか、
              上級者向けタブの生 YAML で <code className="font-mono">apt.sources</code> に鍵を書きます）。
            </Callout>
          </div>
        )}

        <div className="mt-4 space-y-3">
          <Field label={t('adv.aptFallback')}>
            {(id) => (
              <Select
                id={id}
                value={profile.apt.fallback}
                onChange={(v) => update((p) => ({ ...p, apt: { ...p.apt, fallback: v as AptFallback } }))}
                options={APT_FALLBACK_CHOICES.map((c) => ({ value: c.value, label: label(c) }))}
              />
            )}
          </Field>
          <Switch
            checked={profile.apt.preserveSourcesList}
            onChange={(preserveSourcesList) =>
              update((p) => ({ ...p, apt: { ...p.apt, preserveSourcesList } }))
            }
            label={t('adv.aptPreserve')}
            description={t('adv.aptPreserveHint')}
          />
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
