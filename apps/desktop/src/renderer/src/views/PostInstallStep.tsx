import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { POST_INSTALL_PRESETS, type PostInstallPresetId, type ProvisionFile } from '@autoinstall/shared'
import { useStore } from '../store.js'
import { useT } from '../lib/i18n.js'
import { Badge, Button, Callout, Card, Field, Modal, Switch, TextArea, TextInput } from '../components/ui.js'
import { DeploymentsSection } from './sections/Deployments.js'
import { ServicesSection } from './sections/Services.js'

type Tab = 'presets' | 'deploy' | 'services' | 'files' | 'advanced'

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

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'presets', label: t('postinstall.tabPresets') },
    { id: 'deploy', label: t('postinstall.tabDeploy'), count: deployCount },
    { id: 'services', label: t('postinstall.tabServices'), count: serviceCount },
    { id: 'files', label: t('postinstall.tabFiles'), count: fileCount + commandCount },
    { id: 'advanced', label: t('postinstall.tabAdvanced') },
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
      {tab === 'advanced' && <AdvancedTab />}
    </div>
  )
}

function PresetsTab(): React.JSX.Element {
  const t = useT()
  const locale = useStore((s) => s.locale)
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
      <Card title={t('postinstall.presets')} description="よくある設定をチェックするだけで追加できます。">
        <div className="grid gap-2 lg:grid-cols-2">
          {POST_INSTALL_PRESETS.map((preset) => (
            <Switch
              key={preset.id}
              checked={selected.has(preset.id)}
              onChange={(v) => togglePreset(preset.id, v)}
              tone={preset.risk === 'caution' ? 'warning' : 'default'}
              label={
                <span className="flex flex-wrap items-center gap-2">
                  {locale === 'ja' ? preset.titleJa : preset.titleEn}
                  {preset.needsNetwork && <Badge tone="info">ネット必須</Badge>}
                </span>
              }
              description={locale === 'ja' ? preset.descriptionJa : preset.descriptionEn}
            />
          ))}
        </div>
      </Card>

      <Card title="システムの更新">
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
            「ソフトウェア」の「インストール時の更新」がセキュリティ更新のみ適用するのに対し、こちらは
            インストール完了後に <code className="font-mono">apt full-upgrade</code> を実行して
            すべてのパッケージを最新にします。カーネルが更新されることもあります。
          </Callout>
        </div>
      </Card>
    </>
  )
}

function FilesTab(): React.JSX.Element {
  const t = useT()
  const profile = useStore((s) => s.profile)
  const update = useStore((s) => s.updateProfile)
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
        description="小さな設定ファイルをここに直接書けます。大きなファイルやアーカイブは「アプリの展開」を使ってください。"
      >
        {profile.postInstall.files.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">まだファイルはありません。</p>
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
                    {f.name} · {f.mode} · {f.owner} · {f.content.length} 文字
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" onClick={() => setEditing({ index: i, file: f })}>
                    編集
                  </Button>
                  <Button variant="ghost" onClick={() => removeFile(i)} aria-label="削除">
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
        description="インストール完了後、再起動する直前に実行されます。1 行に 1 コマンド。"
      >
        <TextArea
          rows={5}
          spellCheck={false}
          placeholder={'curtin in-target -- apt-get install -y nginx\ncurtin in-target -- systemctl enable nginx'}
          value={profile.postInstall.lateCommands.join('\n')}
          onChange={(e) =>
            update((p) => ({
              ...p,
              postInstall: {
                ...p.postInstall,
                lateCommands: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean),
              },
            }))
          }
        />
        <div className="mt-3">
          <Callout tone="info" title="実行される場所に注意">
            コマンドは<strong>インストーラ環境</strong>で実行され、新しいシステムは{' '}
            <code className="font-mono">/target</code> にマウントされています。
            新しいシステムの中で実行したい場合は{' '}
            <code className="font-mono">curtin in-target -- </code> を先頭に付けてください。
          </Callout>
        </div>
      </Card>

      <Card
        title={t('postinstall.firstBoot')}
        description="インストール後の初回起動時に cloud-init が実行します。ネットワークが上がった後に走るので、外部との通信が必要な処理に向いています。"
      >
        <TextArea
          rows={4}
          spellCheck={false}
          placeholder={'curl -fsSL https://example.com/setup.sh | bash'}
          value={profile.postInstall.firstBootCommands.join('\n')}
          onChange={(e) =>
            update((p) => ({
              ...p,
              postInstall: {
                ...p.postInstall,
                firstBootCommands: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean),
              },
            }))
          }
        />
      </Card>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing && editing.index < 0 ? 'ファイルを追加' : 'ファイルを編集'}
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
            <Field label={t('postinstall.fileTarget')} hint="インストール先での絶対パス" required>
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
              <Field label={t('postinstall.fileName')} hint="USB 上での名前">
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
              <Field label={t('postinstall.fileMode')} hint="例 0644">
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
              <Field label={t('postinstall.fileOwner')} hint="例 root">
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
  const profile = useStore((s) => s.profile)
  const update = useStore((s) => s.updateProfile)

  return (
    <Card
      title="生の YAML で上書きする"
      description="ここに書いた内容が、生成された autoinstall にマージされます（同じキーは上書き、配列は置き換え）。"
    >
      <TextArea
        rows={8}
        spellCheck={false}
        placeholder={'kernel:\n  flavor: hwe\ndebconf-selections: |\n  postfix postfix/main_mailer_type select No configuration'}
        value={profile.advanced.rawOverlayYaml}
        onChange={(e) =>
          update((p) => ({ ...p, advanced: { ...p.advanced, rawOverlayYaml: e.target.value } }))
        }
      />
      <div className="mt-4">
        <Field
          label="追加のカーネル引数"
          hint="GRUB のカーネル行に追加されます。autoinstall は自動で付くので不要です。; & | は使えません。"
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
  )
}
