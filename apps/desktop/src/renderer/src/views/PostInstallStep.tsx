import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import {
  createDefaultProfile,
  POST_INSTALL_PRESETS,
  SERIES_FEATURES,
  type AutoinstallProfile,
  type PostInstallPresetId,
  type ProvisionFile,
  type ReportingTarget,
} from '@autoinstall/shared'
import { useStore } from '../store.js'
import { useT, useTx } from '../lib/i18n.js'
import {
  Badge,
  Button,
  Callout,
  Card,
  Disclosure,
  Field,
  Modal,
  Select,
  Switch,
  TextArea,
  TextInput,
  useListDraft,
} from '../components/ui.js'
import { DeploymentsSection } from './sections/Deployments.js'
import { ServicesSection } from './sections/Services.js'

// 「上級者向け」はタブから外し、タブ群の**下**の折りたたみへ移した。
// インストーラが決して聞かない設定（失敗時のコマンド・debconf・通知先・
// Active Directory・生の YAML）は、タブの並びに置くと「見なければならないもの」に
// 見える。折りたたむが、**開けば今までどおり全部触れる**
// （無効化して「切れない」状態を作らない。落とし穴 61 / 66）。
type Tab = 'presets' | 'deploy' | 'services' | 'files'

/**
 * インストール後の設定。項目が多いのでタブで分ける。
 * 「よく使う設定」だけで完結する人が大半なので、それを既定のタブにする。
 */
export function PostInstallStep(): React.JSX.Element {
  const t = useT()
  const [tab, setTab] = useState<Tab>('presets')
  const deployCount = useStore((s) => s.profile.postInstall.deployments.length)
  const serviceCount = useStore((s) => s.profile.postInstall.services.length)
  const fileCount = useStore((s) => s.profile.postInstall.files.length)
  const commandCount = useStore(
    (s) => s.profile.postInstall.lateCommands.length + s.profile.postInstall.firstBootCommands.length,
  )
  // セレクタが返すのは**数**なので、折りたたみの件数が変わったときだけ再描画される
  // （`s.profile` を購読すると 1 文字打つたびにこの画面全体が描き直される）。
  const advancedChanges = useStore((s) => countAdvancedChanges(s.profile))

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'presets', label: t('postinstall.tabPresets') },
    { id: 'deploy', label: t('postinstall.tabDeploy'), count: deployCount },
    { id: 'services', label: t('postinstall.tabServices'), count: serviceCount },
    { id: 'files', label: t('postinstall.tabFiles'), count: fileCount + commandCount },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900">
        {tabs.map((x) => (
          <button
            key={x.id}
            onClick={() => setTab(x.id)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition ${
              tab === x.id
                ? 'bg-white font-medium text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {x.label}
            {x.count !== undefined && x.count > 0 && <Badge>{x.count}</Badge>}
          </button>
        ))}
      </div>

      {tab === 'presets' && <PresetsTab />}
      {tab === 'deploy' && <DeploymentsSection />}
      {tab === 'services' && <ServicesSection />}
      {tab === 'files' && <FilesTab />}

      <Disclosure
        title={t('postinstall.tabAdvanced')}
        description={t('postinstall.advancedHint')}
        changedCount={advancedChanges}
      >
        <AdvancedTab />
      </Disclosure>
    </div>
  )
}

/** 判別可能ユニオンや壊れた JSON を触るときに使う。`typeof null === 'object'`（落とし穴 30）。 */
function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/**
 * 「上級者向け」の中で、**既定から変わっている設定の数**。
 *
 * 基準は `createDefaultProfile()` の値。既定値をここに書き写さない
 * （書き写すと既定を変えたときに片方だけ古くなり、変わっているのに
 * 「変更なし」と出る）。
 *
 * 判別可能ユニオン（`behavior.reporting`）は**まとめて比較しない**。
 * 判別子だけを見る（落とし穴 22 / 29）。オブジェクトの深い比較は
 * キーの順序や欠けたキーで簡単に嘘をつく。
 *
 * 手で編集された JSON は型が違う値も運んでくる（落とし穴 23）。
 * そういう値は**既定とは違う**ので「変更あり」に倒す。
 * 数えられないからと 0 にすると、変更が折りたたみの中に隠れたまま
 * 気づけなくなる（落とし穴 50）。
 */
export function countAdvancedChanges(profile: AutoinstallProfile): number {
  const base = createDefaultProfile(profile.series)
  const raw = asObject(profile)
  const post = asObject(raw['postInstall'])
  const behavior = asObject(raw['behavior'])
  const ad = asObject(raw['activeDirectory'])
  const advanced = asObject(raw['advanced'])

  // 「上級者向け」の中で操作できる設定を 1 つずつ。ここに並べたものと
  // 折りたたみの中身が食い違わないよう、Card の順に並べる。
  const changed: boolean[] = [
    post['collectLogsOnError'] !== base.postInstall.collectLogsOnError,
    !Array.isArray(post['errorCommands']) ||
      post['errorCommands'].length !== base.postInstall.errorCommands.length,
    post['debconfSelections'] !== base.postInstall.debconfSelections,
    asObject(behavior['reporting'])['kind'] !== base.behavior.reporting.kind,
    ad['enabled'] !== base.activeDirectory.enabled,
    // 無効のときのドメイン名／管理者名は生成物に出ないので数えない。
    // 数えると「開いても入力欄が無いのに 1 件変更」になる（手で編集された JSON で起きる）。
    ad['enabled'] === true && ad['domainName'] !== base.activeDirectory.domainName,
    ad['enabled'] === true && ad['adminName'] !== base.activeDirectory.adminName,
    behavior['refreshInstaller'] !== base.behavior.refreshInstaller,
    // channel の欄は `refreshInstaller` が true のときしか描画されない。
    // 無効のときも数えると「開いても入力欄が無いのに 1 件変更」になる
    // （手で編集された JSON と古いプロファイルで起きる）。
    // 数えないぶんは `validate.refreshChannelIgnored` が伝える（落とし穴 50 / 67）。
    behavior['refreshInstaller'] === true &&
      behavior['refreshInstallerChannel'] !== base.behavior.refreshInstallerChannel,
    behavior['interactiveAll'] !== base.behavior.interactiveAll,
    advanced['rawOverlayYaml'] !== base.advanced.rawOverlayYaml,
    advanced['extraKernelArgs'] !== base.advanced.extraKernelArgs,
  ]
  return changed.filter(Boolean).length
}

function PresetsTab(): React.JSX.Element {
  const t = useT()
  const tx = useTx()
  const presets = useStore((s) => s.profile.postInstall.presets)
  const aptFullUpgrade = useStore((s) => s.profile.postInstall.aptFullUpgrade)
  const update = useStore((s) => s.updateProfile)
  const selected = new Set(presets)

  const togglePreset = (id: PostInstallPresetId, on: boolean): void => {
    update((p) => {
      const next = new Set(p.postInstall.presets)
      if (on) next.add(id)
      else next.delete(id)
      return {
        ...p,
        postInstall: { ...p.postInstall, presets: [...next] },
        // sudo 無しパスワードは「ユーザー」画面のスイッチとも連動させる
        ...(id === 'sudo-nopasswd' ? { user: { ...p.user, sudoNoPassword: on } } : {}),
      }
    })
  }

  return (
    <>
      <Card title={t('postinstall.presets')} description={t('postinstall.presetsHint')}>
        <div className="grid gap-2 lg:grid-cols-2">
          {POST_INSTALL_PRESETS.map((preset) => (
            <Switch
              key={preset.id}
              checked={selected.has(preset.id)}
              onChange={(v) => togglePreset(preset.id, v)}
              tone={preset.risk === 'caution' ? 'warning' : 'default'}
              label={
                <span className="flex flex-wrap items-center gap-2">
                  {t(preset.title)}
                  {preset.needsNetwork && <Badge tone="info">{t('postinstall.needsNetwork')}</Badge>}
                </span>
              }
              description={t(preset.description)}
            />
          ))}
        </div>
      </Card>

      <Card title={t('postinstall.systemUpdate')}>
        <Switch
          checked={aptFullUpgrade}
          onChange={(v) =>
            update((p) => ({ ...p, postInstall: { ...p.postInstall, aptFullUpgrade: v } }))
          }
          label={t('postinstall.aptFullUpgrade')}
          description={t('postinstall.aptFullUpgradeHint')}
        />
        <div className="mt-3">
          <Callout tone="info">
            {tx('postinstall.fullUpgradeExplain', {
              command: <code className="font-mono">apt full-upgrade</code>,
            })}
          </Callout>
        </div>
      </Card>
    </>
  )
}

function FilesTab(): React.JSX.Element {
  const t = useT()
  const tx = useTx()
  const profile = useStore((s) => s.profile)
  const update = useStore((s) => s.updateProfile)
  // 正規化した配列から value を作ると、改行を打った瞬間に消える（落とし穴 58）
  const lateCommandsDraft = useListDraft(profile.postInstall.lateCommands, '\n')
  const firstBootCommandsDraft = useListDraft(profile.postInstall.firstBootCommands, '\n')
  const [editing, setEditing] = useState<{ index: number; file: ProvisionFile } | null>(null)

  const saveFile = (): void => {
    if (!editing) return
    update((p) => {
      const files = [...p.postInstall.files]
      if (editing.index < 0) files.push(editing.file)
      else files[editing.index] = editing.file
      return { ...p, postInstall: { ...p.postInstall, files } }
    })
    setEditing(null)
  }

  const removeFile = (index: number): void => {
    update((p) => ({
      ...p,
      postInstall: { ...p.postInstall, files: p.postInstall.files.filter((_, i) => i !== index) },
    }))
  }

  return (
    <>
      <Card
        title={t('postinstall.files')}
        description={t('postinstall.filesHint')}
      >
        {profile.postInstall.files.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('postinstall.filesEmpty')}</p>
        ) : (
          <ul className="space-y-2">
            {profile.postInstall.files.map((f, i) => (
              <li
                key={`${f.name}-${i}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-slate-800 dark:text-slate-200">
                    {f.targetPath}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {f.name} · {f.mode} · {f.owner} ·{' '}
                    {t('postinstall.fileChars', { n: f.content.length })}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" onClick={() => setEditing({ index: i, file: f })}>
                    {t('postinstall.edit')}
                  </Button>
                  <Button variant="ghost" onClick={() => removeFile(i)} aria-label={t('common.delete')}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <Button
            onClick={() =>
              setEditing({
                index: -1,
                file: { name: 'example.conf', targetPath: '/etc/example.conf', mode: '0644', owner: 'root', content: '' },
              })
            }
          >
            <Plus className="size-4" aria-hidden />
            {t('postinstall.addFile')}
          </Button>
        </div>
      </Card>

      <Card
        title={t('postinstall.lateCommands')}
        description={t('postinstall.lateCommandsDesc')}
      >
        <TextArea
          rows={5}
          spellCheck={false}
          placeholder={'curtin in-target -- apt-get install -y nginx\ncurtin in-target -- systemctl enable nginx'}
          value={lateCommandsDraft.text}
          onChange={(e) => {
            // 下書きを持っているのに change() を通さないと setDraft が一度も走らず、
            // 行末で改行を打った瞬間に消える（落とし穴 58）。値は必ず下書き経由で作る。
            const list = lateCommandsDraft.change(e.target.value)
            update((p) => ({ ...p, postInstall: { ...p.postInstall, lateCommands: list } }))
          }}
        />
        <div className="mt-3">
          <Callout tone="info" title={t('postinstall.lateCommandsWhere')}>
            {tx('postinstall.lateCommandsWhereBody', {
              installerEnv: <strong>{t('postinstall.installerEnv')}</strong>,
              target: <code className="font-mono">/target</code>,
              inTarget: <code className="font-mono">curtin in-target -- </code>,
            })}
          </Callout>
        </div>
      </Card>

      <Card
        title={t('postinstall.firstBoot')}
        description={t('postinstall.firstBootDesc')}
      >
        <TextArea
          rows={4}
          spellCheck={false}
          placeholder={'curl -fsSL https://example.com/setup.sh | bash'}
          value={firstBootCommandsDraft.text}
          onChange={(e) => {
            const list = firstBootCommandsDraft.change(e.target.value)
            update((p) => ({ ...p, postInstall: { ...p.postInstall, firstBootCommands: list } }))
          }}
        />
      </Card>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={
          editing && editing.index < 0 ? t('postinstall.addFile') : t('postinstall.editFile')
        }
        footer={
          <>
            <Button onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={saveFile}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <Field
              label={t('postinstall.fileTarget')}
              hint={t('postinstall.fileTargetHint')}
              required
            >
              {(id) => (
                <TextInput
                  id={id}
                  value={editing.file.targetPath}
                  spellCheck={false}
                  onChange={(e) =>
                    setEditing({ ...editing, file: { ...editing.file, targetPath: e.target.value } })
                  }
                />
              )}
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label={t('postinstall.fileName')} hint={t('postinstall.fileNameHint')}>
                {(id) => (
                  <TextInput
                    id={id}
                    value={editing.file.name}
                    spellCheck={false}
                    onChange={(e) =>
                      setEditing({ ...editing, file: { ...editing.file, name: e.target.value } })
                    }
                  />
                )}
              </Field>
              <Field label={t('postinstall.fileMode')} hint={t('postinstall.fileModeHint')}>
                {(id) => (
                  <TextInput
                    id={id}
                    value={editing.file.mode}
                    spellCheck={false}
                    onChange={(e) =>
                      setEditing({ ...editing, file: { ...editing.file, mode: e.target.value } })
                    }
                  />
                )}
              </Field>
              <Field label={t('postinstall.fileOwner')} hint={t('postinstall.fileOwnerHint')}>
                {(id) => (
                  <TextInput
                    id={id}
                    value={editing.file.owner}
                    spellCheck={false}
                    onChange={(e) =>
                      setEditing({ ...editing, file: { ...editing.file, owner: e.target.value } })
                    }
                  />
                )}
              </Field>
            </div>
            <Field label={t('postinstall.fileContent')}>
              {(id) => (
                <TextArea
                  id={id}
                  rows={8}
                  value={editing.file.content}
                  spellCheck={false}
                  onChange={(e) =>
                    setEditing({ ...editing, file: { ...editing.file, content: e.target.value } })
                  }
                />
              )}
            </Field>
          </div>
        )}
      </Modal>
    </>
  )
}

function AdvancedTab(): React.JSX.Element {
  const t = useT()
  const tx = useTx()
  const profile = useStore((s) => s.profile)
  const update = useStore((s) => s.updateProfile)
  const errorCommandsDraft = useListDraft(profile.postInstall.errorCommands, '\n')
  const features = SERIES_FEATURES[profile.series]
  const reporting = profile.behavior.reporting

  const setReportingKind = (kind: ReportingTarget['kind']): void =>
    update((p) => {
      const next: ReportingTarget =
        kind === 'rsyslog'
          ? { kind, destination: '' }
          : kind === 'webhook'
            ? { kind, endpoint: '' }
            : { kind }
      return { ...p, behavior: { ...p.behavior, reporting: next } }
    })

  const lines = (text: string): string[] =>
    text.split('\n').map((l) => l.trim()).filter(Boolean)

  return (
    <div className="space-y-5">
      <Card title={t('adv.errorCommands')} description={t('adv.errorCommandsHint')}>
        <Switch
          checked={profile.postInstall.collectLogsOnError}
          onChange={(collectLogsOnError) =>
            update((p) => ({ ...p, postInstall: { ...p.postInstall, collectLogsOnError } }))
          }
          label={t('adv.collectLogs')}
          description={t('adv.collectLogsHint')}
        />
        <div className="mt-4">
          <TextArea
            rows={3}
            spellCheck={false}
            placeholder={'curl -X POST https://hooks.example.com/install-failed'}
            value={errorCommandsDraft.text}
            onChange={(e) =>
              update((p) => ({
                ...p,
                postInstall: { ...p.postInstall, errorCommands: errorCommandsDraft.change(e.target.value) },
              }))
            }
          />
        </div>
      </Card>

      <Card title={t('adv.debconf')} description={t('adv.debconfHint')}>
        <TextArea
          rows={3}
          spellCheck={false}
          placeholder={'postfix postfix/main_mailer_type select No configuration'}
          value={profile.postInstall.debconfSelections}
          onChange={(e) =>
            update((p) => ({
              ...p,
              postInstall: { ...p.postInstall, debconfSelections: e.target.value },
            }))
          }
        />
      </Card>

      <Card title={t('adv.reporting')}>
        <Field label={t('adv.reporting')}>
          {(id) => (
            <Select
              id={id}
              value={reporting.kind}
              onChange={(v) => setReportingKind(v as ReportingTarget['kind'])}
              options={[
                { value: 'console', label: t('adv.reportingConsole') },
                { value: 'none', label: t('adv.reportingNone') },
                { value: 'webhook', label: t('adv.reportingWebhook') },
                { value: 'rsyslog', label: t('adv.reportingRsyslog') },
              ]}
            />
          )}
        </Field>
        {(reporting.kind === 'webhook' || reporting.kind === 'rsyslog') && (
          <div className="mt-3">
            <Field label={t('adv.reportingUrl')} hint={t('adv.reportingUrlHint')} required>
              {(id) => (
                <TextInput
                  id={id}
                  spellCheck={false}
                  placeholder={
                    reporting.kind === 'webhook'
                      ? 'https://hooks.example.com/install'
                      : '@@192.168.1.1:514'
                  }
                  value={reporting.kind === 'webhook' ? reporting.endpoint : reporting.destination}
                  onChange={(e) =>
                    update((p) => ({
                      ...p,
                      behavior: {
                        ...p.behavior,
                        reporting:
                          reporting.kind === 'webhook'
                            ? { kind: 'webhook', endpoint: e.target.value }
                            : { kind: 'rsyslog', destination: e.target.value },
                      },
                    }))
                  }
                />
              )}
            </Field>
          </div>
        )}
        {profile.behavior.interactiveAll && (
          <div className="mt-3">
            <Callout tone="warning">{t('postinstall.reportingIgnored')}</Callout>
          </div>
        )}
      </Card>

      <Card title={t('adv.adTitle')} description={t('adv.adHint')}>
        <Switch
          checked={profile.activeDirectory.enabled}
          tone="warning"
          onChange={(enabled) =>
            // 無効に戻すときは値も消す（落とし穴 66。暗号化パスフレーズと同じ扱い）。
            // 残すと入力欄は隠れているのに「1 件変更」が消えず、開いても
            // 直す先が無い。保存される JSON にもドメイン名が残り続ける。
            update((p) => ({
              ...p,
              activeDirectory: enabled
                ? { ...p.activeDirectory, enabled }
                : { ...p.activeDirectory, enabled, domainName: '', adminName: '' },
            }))
          }
          label={t('adv.adTitle')}
          description={t('adv.adWarning')}
        />
        {profile.activeDirectory.enabled && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label={t('adv.adDomain')} required>
              {(id) => (
                <TextInput
                  id={id}
                  spellCheck={false}
                  placeholder="corp.example.com"
                  value={profile.activeDirectory.domainName}
                  onChange={(e) =>
                    update((p) => ({
                      ...p,
                      activeDirectory: { ...p.activeDirectory, domainName: e.target.value },
                    }))
                  }
                />
              )}
            </Field>
            <Field label={t('adv.adAdmin')} required>
              {(id) => (
                <TextInput
                  id={id}
                  spellCheck={false}
                  placeholder="Administrator"
                  value={profile.activeDirectory.adminName}
                  onChange={(e) =>
                    update((p) => ({
                      ...p,
                      activeDirectory: { ...p.activeDirectory, adminName: e.target.value },
                    }))
                  }
                />
              )}
            </Field>
          </div>
        )}
        {!features.codecsOemAd && profile.activeDirectory.enabled && (
          <div className="mt-3">
            <Callout tone="warning">
              {tx('postinstall.adKeyMissing', {
                series: profile.series,
                key: <code className="font-mono">active-directory</code>,
              })}
            </Callout>
          </div>
        )}
      </Card>

      <Card title={t('common.advanced')}>
        <div className="space-y-3">
          <Switch
            checked={profile.behavior.refreshInstaller}
            onChange={(refreshInstaller) =>
              // 無効に戻すときは channel も消す（落とし穴 66。Active Directory と
              // 暗号化パスフレーズと同じ扱い）。channel の欄は `refreshInstaller`
              // が true のときしか描画されないので、残すと「1 件変更」の Badge が
              // 消えないのに、開いても直す先が画面に無い。しかも channel は
              // `update: false` でも YAML に出る（`generate.ts`）ので、
              // 保存した JSON にも生成物にも残り続ける。
              update((p) => ({
                ...p,
                behavior: refreshInstaller
                  ? { ...p.behavior, refreshInstaller }
                  : { ...p.behavior, refreshInstaller, refreshInstallerChannel: '' },
              }))
            }
            label={t('adv.refreshInstaller')}
            description={t('adv.refreshInstallerHint')}
          />
          {profile.behavior.refreshInstaller && (
            <Field label="channel" hint={t('postinstall.refreshChannelHint')}>
              {(id) => (
                <TextInput
                  id={id}
                  spellCheck={false}
                  placeholder="stable/ubuntu-24.04"
                  value={profile.behavior.refreshInstallerChannel}
                  onChange={(e) =>
                    update((p) => ({
                      ...p,
                      behavior: { ...p.behavior, refreshInstallerChannel: e.target.value },
                    }))
                  }
                />
              )}
            </Field>
          )}
          {features.interactiveAll && (
            <Switch
              checked={profile.behavior.interactiveAll}
              tone="warning"
              onChange={(interactiveAll) =>
                update((p) => ({ ...p, behavior: { ...p.behavior, interactiveAll } }))
              }
              label={t('adv.interactiveAll')}
              description={t('adv.interactiveAllHint')}
            />
          )}
        </div>
      </Card>

      <Card
        title={t('postinstall.rawYaml')}
        description={t('postinstall.rawYamlHint')}
      >
        <TextArea
          rows={8}
          spellCheck={false}
          placeholder={'kernel:\n  flavor: hwe\nzdevs:\n  - id: 0.0.1507\n    enabled: true'}
          value={profile.advanced.rawOverlayYaml}
          onChange={(e) =>
            update((p) => ({ ...p, advanced: { ...p.advanced, rawOverlayYaml: e.target.value } }))
          }
        />
        <div className="mt-4">
          <Field
            label={t('postinstall.extraKernelArgs')}
            hint={t('postinstall.extraKernelArgsHint')}
          >
            {(id) => (
              <TextInput
                id={id}
                value={profile.advanced.extraKernelArgs}
                spellCheck={false}
                placeholder="net.ifnames=0 fsck.mode=skip"
                onChange={(e) =>
                  update((p) => ({ ...p, advanced: { ...p.advanced, extraKernelArgs: e.target.value } }))
                }
              />
            )}
          </Field>
        </div>
      </Card>
    </div>
  )
}
