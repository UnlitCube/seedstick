import { ListPlus, Trash2 } from 'lucide-react'
import {
  KERNEL_ARG,
  RUNTIME_FIELDS,
  buildHostMenuEntries,
  isSafePresetLabel,
  isSafeRuntimeValue,
  usesKernelArgs,
  type HostPreset,
  type RuntimeField,
  type RuntimeValueMode,
  type RuntimeValuesConfig,
} from '@autoinstall/shared'
import { useStore } from '../store.js'
import { useT } from '../lib/i18n.js'
import type { MsgKey } from '@autoinstall/shared'
import {
  Badge,
  Button,
  Callout,
  Card,
  CodeBlock,
  Field,
  RadioGroup,
  Switch,
  TextInput,
} from '../components/ui.js'

const FIELD_LABEL: Record<RuntimeField, MsgKey> = {
  hostname: 'runtime.fieldHostname',
  network: 'runtime.fieldNetwork',
  disk: 'runtime.fieldDisk',
}

/** その項目を kernel-arg にしたときプリセット表で意味を持つ列。 */
const FIELD_COLUMNS: Record<RuntimeField, readonly (keyof HostPreset)[]> = {
  hostname: ['hostname'],
  network: ['ipv4', 'gateway', 'nameservers'],
  disk: ['disk'],
}

const COLUMN_LABEL: Record<string, MsgKey> = {
  hostname: 'runtime.presetHostname',
  ipv4: 'runtime.presetIpv4',
  gateway: 'runtime.presetGateway',
  nameservers: 'runtime.presetDns',
  disk: 'runtime.presetDisk',
}

const COLUMN_PLACEHOLDER: Record<string, string> = {
  hostname: 'web01',
  ipv4: '192.168.1.11/24',
  gateway: '192.168.1.1',
  nameservers: '1.1.1.1,8.8.8.8',
  disk: '/dev/sda',
}

function emptyPreset(): HostPreset {
  return {
    id: crypto.randomUUID(),
    label: '',
    hostname: '',
    ipv4: '',
    gateway: '',
    nameservers: '',
    disk: '',
  }
}

export function RuntimeStep(): React.JSX.Element {
  const t = useT()
  const runtime = useStore((s) => s.profile.runtimeValues)
  const network = useStore((s) => s.profile.network)
  const storage = useStore((s) => s.profile.storage)
  const config = useStore((s) => s.config)
  const iso = useStore((s) => s.iso)
  const update = useStore((s) => s.updateProfile)

  const setRuntime = (patch: Partial<RuntimeValuesConfig>): void =>
    update((p) => ({ ...p, runtimeValues: { ...p.runtimeValues, ...patch } }))

  const setPreset = (index: number, patch: Partial<HostPreset>): void =>
    update((p) => {
      const presets = p.runtimeValues.presets.map((preset, i) =>
        i === index ? { ...preset, ...patch } : preset,
      )
      return { ...p, runtimeValues: { ...p.runtimeValues, presets } }
    })

  const menuMode = usesKernelArgs(runtime)
  // kernel-arg にした項目に対応する列だけを表に出す。関係ない列を並べても迷うだけ。
  const columns = RUNTIME_FIELDS.filter((f) => runtime[f] === 'kernel-arg').flatMap(
    (f) => FIELD_COLUMNS[f],
  )
  const entries = buildHostMenuEntries(runtime)

  // 「起動メニューから選ぶ」には前提がある。確認ステップまで進まないと
  // 分からないのは遅いので、選んだその場で出す。
  const prerequisites: string[] = []
  if (runtime.network === 'kernel-arg' && network.mode !== 'static') {
    prerequisites.push(t('runtime.prereqNetwork', { mode: network.mode }))
  }
  if (runtime.disk === 'kernel-arg' && storage.mode !== 'raw' && storage.match.kind !== 'serial') {
    prerequisites.push(t('runtime.prereqDisk'))
  }

  return (
    <div className="space-y-5">
      {prerequisites.length > 0 && (
        <Callout tone="warning" title={t('runtime.prereqTitle')}>
          <ul className="list-disc space-y-1 pl-5">
            {prerequisites.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Callout>
      )}

      <Card title={t('runtime.title')} description={t('runtime.intro')}>
        <div className="space-y-5">
          {RUNTIME_FIELDS.map((field) => (
            <Field key={field} label={t(FIELD_LABEL[field])}>
              {() => (
                <RadioGroup<RuntimeValueMode>
                  value={runtime[field]}
                  onChange={(mode) => setRuntime({ [field]: mode } as Partial<RuntimeValuesConfig>)}
                  options={[
                    {
                      value: 'fixed',
                      label: t('runtime.modeFixed'),
                      badge: <Badge tone="success">{t('common.recommended')}</Badge>,
                      description: t('runtime.modeFixedHint'),
                    },
                    {
                      value: 'kernel-arg',
                      label: t('runtime.modeKernelArg'),
                      description: t('runtime.modeKernelArgHint'),
                    },
                    {
                      value: 'interactive',
                      label: t('runtime.modeInteractive'),
                      description: t('runtime.modeInteractiveHint'),
                    },
                  ]}
                />
              )}
            </Field>
          ))}
        </div>
      </Card>

      {menuMode && (
        <Card title={t('runtime.presetsTitle')} description={t('runtime.presetsIntro')}>
          {runtime.presets.length === 0 ? (
            <Callout tone="warning">{t('runtime.noPresets')}</Callout>
          ) : (
            <div className="overflow-x-auto">
              {/* 列を潰さない。入る幅が無ければ親の overflow-x-auto で横スクロールさせる */}
              <table className="w-full min-w-[56rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    <th className="min-w-32 px-2 py-2 font-medium">{t('runtime.presetLabel')}</th>
                    {columns.map((c) => (
                      <th key={c} className="min-w-36 px-2 py-2 font-medium">
                        {t(COLUMN_LABEL[c]!)}
                      </th>
                    ))}
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {runtime.presets.map((preset, i) => (
                    <tr key={preset.id} className="border-b border-slate-100 dark:border-slate-700/60">
                      <td className="px-2 py-1.5">
                        <TextInput
                          value={preset.label}
                          spellCheck={false}
                          placeholder={`host${i + 1}`}
                          invalid={preset.label !== '' && !isSafePresetLabel(preset.label)}
                          onChange={(e) => setPreset(i, { label: e.target.value })}
                        />
                      </td>
                      {columns.map((c) => (
                        <td key={c} className="px-2 py-1.5">
                          <TextInput
                            value={preset[c]}
                            spellCheck={false}
                            placeholder={COLUMN_PLACEHOLDER[c]}
                            invalid={preset[c] !== '' && !isSafeRuntimeValue(preset[c])}
                            onChange={(e) => setPreset(i, { [c]: e.target.value } as Partial<HostPreset>)}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          aria-label={t('runtime.removePreset')}
                          title={t('runtime.removePreset')}
                          onClick={() =>
                            update((p) => ({
                              ...p,
                              runtimeValues: {
                                ...p.runtimeValues,
                                presets: p.runtimeValues.presets.filter((_, j) => j !== i),
                              },
                            }))
                          }
                          className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              onClick={() =>
                update((p) => ({
                  ...p,
                  runtimeValues: {
                    ...p.runtimeValues,
                    presets: [...p.runtimeValues.presets, emptyPreset()],
                  },
                }))
              }
            >
              <ListPlus className="size-4" aria-hidden />
              {t('runtime.addPreset')}
            </Button>
          </div>

          <div className="mt-4">
            <Switch
              checked={runtime.offerInteractiveEntry}
              onChange={(v) => setRuntime({ offerInteractiveEntry: v })}
              label={t('runtime.offerInteractiveEntry')}
              description={t('runtime.offerInteractiveEntryHint')}
            />
          </div>
        </Card>
      )}

      {menuMode && (
        <Card title={t('runtime.previewTitle')}>
          {entries.length > 0 ? (
            <ul className="space-y-1.5">
              {/* タイトルはラベルから作るので重複しうる。key には添字を使う。 */}
              {entries.map((e, i) => (
                <li
                  key={`${i}-${e.title}`}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
                >
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{e.title}</p>
                  {e.args.length > 0 && (
                    <p className="mt-0.5 break-all font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {e.args.join(' ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <Callout tone="info">{t('runtime.noPresets')}</Callout>
          )}

          <div className="mt-4">
            {iso === null ? (
              <Callout tone="info">{t('runtime.needIso')}</Callout>
            ) : config?.grubTooLarge ? (
              <Callout tone="danger">{t('runtime.grubTooLarge')}</Callout>
            ) : config !== null ? (
              <Callout tone={config.grubFreeBytes < 200 ? 'warning' : 'success'}>
                {t('runtime.grubFree')}: {t('runtime.grubFreeBytes', { bytes: config.grubFreeBytes })}
                <span className="mt-0.5 block text-xs opacity-80">{t('runtime.grubFreeHint')}</span>
              </Callout>
            ) : null}
          </div>

          {config?.patchedGrubCfg != null && (
            <div className="mt-4">
              <CodeBlock code={config.patchedGrubCfg} maxHeight="18rem" />
            </div>
          )}
        </Card>
      )}

      <Card title={t('runtime.howItWorks')}>
        <p className="text-sm text-slate-700 dark:text-slate-300">{t('runtime.howItWorksBody')}</p>
        <div className="mt-3">
          <CodeBlock
            code={Object.values(KERNEL_ARG)
              .map((a) => `${a}=...`)
              .join('\n')}
            maxHeight="10rem"
          />
        </div>
      </Card>
    </div>
  )
}
