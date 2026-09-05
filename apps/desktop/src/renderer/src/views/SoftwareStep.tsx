import {
  APT_FALLBACK_CHOICES,
  APT_MIRROR_PRESETS,
  COMMON_PACKAGES,
  KERNEL_FLAVORS,
  SERIES_FEATURES,
  createDefaultProfile,
  isDebLineSource,
  isPpaSource,
  type AptFallback,
  type AptSource,
  type AutoinstallProfile,
  type KernelChoice,
} from '@autoinstall/shared'
import { useStore } from '../store.js'
import { useT, useTx } from '../lib/i18n.js'
import {
  Badge,
  Callout,
  Card,
  Disclosure,
  Field,
  RadioGroup,
  Select,
  Switch,
  TextArea,
  TextInput,
  useDraft,
} from '../components/ui.js'
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

/** `typeof null === 'object'`（落とし穴 30）。配列も弾く。 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 読めない形なら空のオブジェクトとして扱う。ここで投げると画面全体が落ちる。 */
function section(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {}
}

/**
 * 「詳しい設定」の中で、既定から変わっているものの数。
 *
 * 折りたたみの Badge と「最初から開くか」の判断に使う。
 * **数えるのは折りたたみに入っているものだけ**（カーネル・追加リポジトリ・
 * apt の fallback / preserve・Ubuntu Pro のトークン）。表に出ている設定は
 * 見れば分かるので数えない。
 *
 * 数え方は「その設定が `createDefaultProfile()` の値と違えば 1」。
 * リストは**要素数ではなく「既定（空）と違うか」で 1 件**と数える
 * （リポジトリを 3 件足したのは「1 か所を変えた」であって「3 か所」ではない）。
 *
 * **判別可能ユニオンを素朴に比較しない**（落とし穴 22 / 29）。
 * `kernel` は `{mode:'default'}` / `{mode:'flavor',flavor}` / `{mode:'package',package}` の
 * ユニオンなので、判別子 `mode` だけを見る。
 *
 * 手で編集されたプロファイルは実際に届く（落とし穴 23）ので、読めない値は
 * **「変わっている」側に倒す**。0 と数えて折りたたんだままにすると、
 * 壊れた設定が見えないまま書き込みまで進む。
 */
export function countSoftwareAdvancedChanges(profile: AutoinstallProfile): number {
  const defaults = createDefaultProfile(profile.series)
  const software = section(profile.software)
  const apt = section(profile.apt)
  let n = 0

  const kernel = software['kernel']
  if (!isObject(kernel) || kernel['mode'] !== defaults.software.kernel.mode) n++
  if (software['ubuntuProToken'] !== defaults.software.ubuntuProToken) n++

  const sources = apt['sources']
  if (!Array.isArray(sources) || sources.length !== defaults.apt.sources.length) n++
  if (apt['fallback'] !== defaults.apt.fallback) n++
  if (apt['preserveSourcesList'] !== defaults.apt.preserveSourcesList) n++

  return n
}

export function SoftwareStep(): React.JSX.Element {
  const t = useT()
  const tx = useTx()
  const profile = useStore((s) => s.profile)
  const update = useStore((s) => s.updateProfile)
  const features = SERIES_FEATURES[profile.series]
  // 折りたたみの中で既定から変わっている数。Badge と「最初から開くか」に使う。
  const advancedChanges = countSoftwareAdvancedChanges(profile)

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

  // 正規化した値から value を作ると、区切り（空白・改行）を打った瞬間に消える。
  // snaps は行を構造へ解釈するので、その往復も下書きに寄せる（落とし穴 58）。
  const customPackagesDraft = useDraft<string[]>(
    [...customPackages],
    (list) => list.join(' '),
    (text) => text.split(/[\s,]+/).filter(Boolean),
  )
  const snapsDraft = useDraft<AutoinstallProfile['software']['snaps']>(
    profile.software.snaps,
    (list) =>
      list
        .map((sp) => [sp.name, sp.channel, sp.classic ? '--classic' : ''].filter(Boolean).join(' '))
        .join('\n'),
    (text) =>
      text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(/\s+/)
          const name = parts[0]!
          const classic = parts.includes('--classic')
          const channel = parts.slice(1).find((x) => !x.startsWith('--'))
          return {
            name,
            ...(channel ? { channel } : {}),
            ...(classic ? { classic: true } : {}),
          }
        }),
  )

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
                description: t('software.sourceFullHint'),
              },
              {
                value: 'ubuntu-server-minimal' as const,
                label: t('software.sourceMinimal'),
                description: t('software.sourceMinimalHint'),
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
              label={t(pkg.label)}
              description={<code className="font-mono text-[11px]">{pkg.value}</code>}
            />
          ))}
        </div>
        <div className="mt-4">
          <Field
            label={t('software.customPackages')}
            hint={t('software.customPackagesHint')}
          >
            {(id) => (
              <TextInput
                id={id}
                value={customPackagesDraft.text}
                spellCheck={false}
                placeholder="nginx postgresql-client jq"
                onChange={(e) => {
                  customPackagesDraft.change(e.target.value)
                  setCustomPackages(e.target.value)
                }}
              />
            )}
          </Field>
        </div>
      </Card>

      <Card title={t('software.snaps')}>
        <Field label={t('software.snapsLabel')}>
          {(id) => (
            <TextArea
              id={id}
              rows={3}
              spellCheck={false}
              placeholder={'microk8s --classic\nlxd 5.21/stable'}
              value={snapsDraft.text}
              onChange={(e) => {
                const snaps = snapsDraft.change(e.target.value)
                update((p) => ({ ...p, software: { ...p.software, snaps } }))
              }}
            />
          )}
        </Field>
      </Card>

      <Card title={t('software.updatesDriversTitle')}>
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
                    { value: 'default', label: t('software.crashDumpsDefault') },
                    { value: 'on', label: t('software.crashDumpsOn') },
                    { value: 'off', label: t('software.crashDumpsOff') },
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
            description={t('software.driversHint')}
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
              description: t('software.aptMirrorDefaultHint'),
            },
            {
              value: 'country-mirror' as const,
              label: t('software.aptMirrorCountry'),
              badge: <Badge tone="success">{t('common.recommended')}</Badge>,
              description: t('software.aptMirrorCountryHint'),
            },
            {
              value: 'custom' as const,
              label: t('software.aptMirrorCustom'),
              description: t('software.aptMirrorCustomHint'),
            },
          ]}
        />
        {profile.apt.mode === 'custom' && (
          <div className="mt-4 space-y-3">
            <Field label={t('software.aptMirrorUrl')}>
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
                  {t(m.label)}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="mt-4">
          <Field label={t('software.aptProxy')} hint={t('software.aptProxyHint')}>
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

      <Disclosure
        title={t('software.advancedTitle')}
        description={t('software.advancedHint')}
        changedCount={advancedChanges}
      >
        <div className="space-y-5">
          <Card>
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
                    ...KERNEL_FLAVORS.map((f) => ({ value: f.value, label: t(f.label) })),
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
                  {tx('software.aptDebLineKeyNote', {
                    sources: <code className="font-mono">apt.sources</code>,
                  })}
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
                    options={APT_FALLBACK_CHOICES.map((c) => ({ value: c.value, label: t(c.label) }))}
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
              label={t('software.ubuntuProTokenLabel')}
              hint={t('software.ubuntuProTokenHint')}
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
                  {tx('software.ubuntuProKeyNote', {
                    series: profile.series,
                    advantage: <code className="font-mono">ubuntu-advantage</code>,
                    pro: <code className="font-mono">ubuntu-pro</code>,
                  })}
                </Callout>
              </div>
            )}
          </Card>
        </div>
      </Disclosure>
    </div>
  )
}
