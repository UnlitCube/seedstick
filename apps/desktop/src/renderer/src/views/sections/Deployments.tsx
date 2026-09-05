import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { FileArchive, FolderInput, Package, Trash2 } from 'lucide-react'
import {
  detectArchiveFormat,
  type ArchiveFormat,
  type Deployment,
  type DeploymentSource,
} from '@autoinstall/shared'
import { useStore } from '../../store.js'
import { useT, useTx } from '../../lib/i18n.js'
import { formatBytes } from '../../lib/format.js'
import {
  Badge,
  Button,
  Callout,
  Card,
  Field,
  Modal,
  Select,
  Switch,
  TextArea,
  TextInput,
} from '../../components/ui.js'

const ARCHIVE_FORMATS: readonly ArchiveFormat[] = ['tar.gz', 'tar.xz', 'tar.bz2', 'tar', 'zip']

function newDeployment(): Deployment {
  return {
    id: crypto.randomUUID(),
    kind: 'archive',
    name: '',
    source: { kind: 'host-file', path: '', sizeBytes: 0 },
    targetPath: '/opt/myapp',
    owner: 'root',
    group: 'root',
    mode: '0644',
    archiveFormat: 'tar.gz',
    postCommand: '',
    chownRecursive: false,
  }
}

/** USB 同梱 / URL 取得のペイロードを管理するセクション。 */
export function DeploymentsSection(): React.JSX.Element {
  const t = useT()
  const deployments = useStore((s) => s.profile.postInstall.deployments)
  const config = useStore((s) => s.config)
  const update = useStore((s) => s.updateProfile)
  const [editing, setEditing] = useState<{ index: number; item: Deployment } | null>(null)

  const save = (): void => {
    if (!editing) return
    update((p) => {
      const list = [...p.postInstall.deployments]
      if (editing.index < 0) list.push(editing.item)
      else list[editing.index] = editing.item
      return { ...p, postInstall: { ...p.postInstall, deployments: list } }
    })
    setEditing(null)
  }

  const remove = (index: number): void => {
    update((p) => ({
      ...p,
      postInstall: {
        ...p.postInstall,
        deployments: p.postInstall.deployments.filter((_, i) => i !== index),
      },
    }))
  }

  const missing = new Set(config?.missingSources ?? [])

  return (
    <Card title={t('deploy.title')} description={t('deploy.description')}>
      {deployments.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('deploy.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {deployments.map((d, i) => {
            const isMissing = d.source.kind === 'host-file' && missing.has(d.source.path)
            return (
              <li
                key={d.id}
                className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${
                  isMissing
                    ? 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                    {d.kind === 'archive' ? (
                      <FileArchive className="size-4 shrink-0 text-slate-500" aria-hidden />
                    ) : (
                      <Package className="size-4 shrink-0 text-slate-500" aria-hidden />
                    )}
                    <span className="font-mono">{d.name || t('deploy.unnamed')}</span>
                    <span className="text-slate-400">→</span>
                    <span className="font-mono">{d.targetPath}</span>
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {d.source.kind === 'url'
                      ? t('deploy.summaryUrl', { url: d.source.url })
                      : d.source.kind === 'inline'
                        ? t('deploy.summaryInline', {
                            size: formatBytes(new Blob([d.source.content]).size),
                          })
                        : t('deploy.summaryHostFile', { size: formatBytes(d.source.sizeBytes) })}
                    {d.kind === 'archive' && ` · ${d.archiveFormat}`}
                    {d.owner !== 'root' && ` · ${d.owner}:${d.group}`}
                  </p>
                  {isMissing && (
                    <p className="mt-1 text-xs font-medium text-rose-700 dark:text-rose-300">
                      {t('deploy.missingFile')}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" onClick={() => setEditing({ index: i, item: d })}>
                    {t('common.edit')}
                  </Button>
                  <Button variant="ghost" onClick={() => remove(i)} aria-label={t('common.delete')}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button onClick={() => setEditing({ index: -1, item: newDeployment() })}>
          <FolderInput className="size-4" aria-hidden />
          {t('deploy.add')}
        </Button>
        {config !== null && config.payloadBytes > 0 && (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t('deploy.sizeWarning')}: {formatBytes(config.payloadBytes)}
          </span>
        )}
      </div>

      <DeploymentEditor
        state={editing}
        onChange={setEditing}
        onClose={() => setEditing(null)}
        onSave={save}
      />
    </Card>
  )
}

function DeploymentEditor({
  state,
  onChange,
  onClose,
  onSave,
}: {
  state: { index: number; item: Deployment } | null
  // 更新関数も受け取れるようにする（非同期の結果を反映するとき、
  // effect 実行時点の古い state で丸ごと上書きしないため）。
  onChange: Dispatch<SetStateAction<{ index: number; item: Deployment } | null>>
  onClose: () => void
  onSave: () => void
}): React.JSX.Element {
  const t = useT()
  const tx = useTx()
  const [checking, setChecking] = useState(false)

  // 既存のペイロードを開き直したとき、元ファイルがまだあるか確かめる
  useEffect(() => {
    if (!state || state.item.source.kind !== 'host-file' || !state.item.source.path) return
    let cancelled = false
    setChecking(true)
    void window.autoinstall
      .checkPayloadFile(state.item.source.path)
      .then((info) => {
        if (cancelled || !info.exists) return
        // **effect 実行時点の state で丸ごと上書きしない。**
        // IPC の往復中に利用者が入力していると、その編集が古い値で消える。
        // 更新関数を使って、そのときの最新に対して sizeBytes だけを足す。
        onChange((cur) => {
          if (!cur || cur.item.source.kind !== 'host-file') return cur
          return {
            ...cur,
            item: {
              ...cur.item,
              source: { ...cur.item.source, sizeBytes: info.sizeBytes },
            },
          }
        })
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
    // 開いた瞬間だけ確認すればよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.item.id])

  if (!state) return <Modal open={false} onClose={onClose} title="" children={null} />
  const { item } = state
  const set = (patch: Partial<Deployment>): void => onChange({ ...state, item: { ...item, ...patch } })
  const setSource = (source: DeploymentSource): void => onChange({ ...state, item: { ...item, source } })

  const pickFile = async (): Promise<void> => {
    const picked = await window.autoinstall.pickPayloadFile()
    if (!picked) return
    const format = (picked.archiveFormat ?? detectArchiveFormat(picked.name)) as ArchiveFormat | null
    onChange({
      ...state,
      item: {
        ...item,
        name: picked.name,
        source: { kind: 'host-file', path: picked.path, sizeBytes: picked.sizeBytes },
        // アーカイブと判定できたら種類も自動で合わせる
        kind: format ? 'archive' : item.kind,
        archiveFormat: format ?? item.archiveFormat,
      },
    })
  }

  const valid =
    item.name.trim() !== '' &&
    item.targetPath.startsWith('/') &&
    (item.source.kind !== 'host-file' || item.source.path !== '') &&
    (item.source.kind !== 'url' || /^https?:\/\//.test(item.source.url))

  return (
    <Modal
      open
      onClose={onClose}
      title={state.index < 0 ? t('deploy.add') : t('deploy.title')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!valid} onClick={onSave}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('deploy.kind')}>
          {(id) => (
            <Select
              id={id}
              value={item.kind}
              onChange={(v) => set({ kind: v as 'file' | 'archive' })}
              options={[
                { value: 'archive', label: t('deploy.kindArchive') },
                { value: 'file', label: t('deploy.kindFile') },
              ]}
            />
          )}
        </Field>

        <Field label={t('deploy.sourceKind')}>
          {(id) => (
            <Select
              id={id}
              value={item.source.kind}
              onChange={(v) => {
                if (v === 'host-file') setSource({ kind: 'host-file', path: '', sizeBytes: 0 })
                else if (v === 'inline') setSource({ kind: 'inline', content: '' })
                else setSource({ kind: 'url', url: '', sha256: '' })
              }}
              options={[
                { value: 'host-file', label: t('deploy.sourceHostFile') },
                { value: 'url', label: t('deploy.sourceUrl') },
                { value: 'inline', label: t('deploy.sourceInline'), disabled: item.kind === 'archive' },
              ]}
            />
          )}
        </Field>

        {item.source.kind === 'host-file' && (
          <div className="space-y-2">
            <Button onClick={() => void pickFile()}>
              <FolderInput className="size-4" aria-hidden />
              {t('deploy.pickFile')}
            </Button>
            {item.source.path && (
              <p className="break-all text-xs text-slate-600 dark:text-slate-400">
                {t('deploy.selectedFile')}: <span className="font-mono">{item.source.path}</span>
                {' · '}
                {checking ? t('common.loading') : formatBytes(item.source.sizeBytes)}
              </p>
            )}
          </div>
        )}

        {item.source.kind === 'url' && (
          <div className="space-y-4">
            <Field label={t('deploy.url')} required>
              {(id) => (
                <TextInput
                  id={id}
                  value={item.source.kind === 'url' ? item.source.url : ''}
                  spellCheck={false}
                  placeholder="https://example.com/app.tar.gz"
                  onChange={(e) =>
                    setSource({
                      kind: 'url',
                      url: e.target.value,
                      sha256: item.source.kind === 'url' ? item.source.sha256 : '',
                    })
                  }
                />
              )}
            </Field>
            <Field label={t('deploy.sha256')} hint={t('deploy.sha256Hint')}>
              {(id) => (
                <TextInput
                  id={id}
                  value={item.source.kind === 'url' ? item.source.sha256 : ''}
                  spellCheck={false}
                  onChange={(e) =>
                    setSource({
                      kind: 'url',
                      url: item.source.kind === 'url' ? item.source.url : '',
                      sha256: e.target.value.trim().toLowerCase(),
                    })
                  }
                />
              )}
            </Field>
          </div>
        )}

        {item.source.kind === 'inline' && (
          <Field label={t('deploy.content')}>
            {(id) => (
              <TextArea
                id={id}
                rows={8}
                spellCheck={false}
                value={item.source.kind === 'inline' ? item.source.content : ''}
                onChange={(e) => setSource({ kind: 'inline', content: e.target.value })}
              />
            )}
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('deploy.fileNameOnUsb')} required>
            {(id) => (
              <TextInput
                id={id}
                value={item.name}
                spellCheck={false}
                placeholder="app.tar.gz"
                onChange={(e) => set({ name: e.target.value })}
              />
            )}
          </Field>
          {item.kind === 'archive' && (
            <Field label={t('deploy.archiveFormat')}>
              {(id) => (
                <Select
                  id={id}
                  value={item.archiveFormat}
                  onChange={(v) => set({ archiveFormat: v as ArchiveFormat })}
                  options={ARCHIVE_FORMATS.map((f) => ({ value: f, label: f }))}
                />
              )}
            </Field>
          )}
        </div>

        <Field
          label={item.kind === 'archive' ? t('deploy.targetDir') : t('deploy.targetFile')}
          required
        >
          {(id) => (
            <TextInput
              id={id}
              value={item.targetPath}
              spellCheck={false}
              placeholder={item.kind === 'archive' ? '/opt/myapp' : '/etc/myapp/app.conf'}
              onChange={(e) => set({ targetPath: e.target.value })}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('deploy.owner')}>
            {(id) => (
              <TextInput
                id={id}
                value={item.owner}
                spellCheck={false}
                onChange={(e) => set({ owner: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('deploy.group')}>
            {(id) => (
              <TextInput
                id={id}
                value={item.group}
                spellCheck={false}
                onChange={(e) => set({ group: e.target.value })}
              />
            )}
          </Field>
          {item.kind === 'file' && (
            <Field label={t('postinstall.fileMode')}>
              {(id) => (
                <TextInput
                  id={id}
                  value={item.mode}
                  spellCheck={false}
                  onChange={(e) => set({ mode: e.target.value })}
                />
              )}
            </Field>
          )}
        </div>

        {item.kind === 'archive' && (
          <>
            <Switch
              checked={item.chownRecursive}
              onChange={(v) => set({ chownRecursive: v })}
              label={t('deploy.chownRecursive')}
            />
            <Field label={t('deploy.postCommand')} hint={t('deploy.postCommandHint')}>
              {(id) => (
                <TextInput
                  id={id}
                  value={item.postCommand}
                  spellCheck={false}
                  placeholder="npm ci --omit=dev"
                  onChange={(e) => set({ postCommand: e.target.value })}
                />
              )}
            </Field>
          </>
        )}

        {item.source.kind === 'host-file' && item.source.sizeBytes > 512 * 1024 * 1024 && (
          <Callout tone="warning">
            {t('deploy.bundleSizeWarning', { size: formatBytes(item.source.sizeBytes) })}
          </Callout>
        )}
        {item.source.kind === 'url' && (
          <Callout tone="info">
            {tx('deploy.urlDownloadNote', { curl: <Badge tone="info">curl</Badge> })}
          </Callout>
        )}
      </div>
    </Modal>
  )
}
