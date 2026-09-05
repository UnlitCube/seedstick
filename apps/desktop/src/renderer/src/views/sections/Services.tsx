import { useState } from 'react'
import { Cog, Trash2 } from 'lucide-react'
import {
  isValidServiceName,
  renderServiceUnit,
  type RestartPolicy,
  type ServiceType,
  type SystemdService,
} from '@autoinstall/shared'
import { useStore } from '../../store.js'
import { useT } from '../../lib/i18n.js'
import {
  Badge,
  Button,
  Callout,
  Card,
  CodeBlock,
  Field,
  Modal,
  Select,
  Switch,
  TextArea,
  TextInput,
  useListDraft,
} from '../../components/ui.js'

function newService(): SystemdService {
  return {
    id: crypto.randomUUID(),
    name: '',
    description: '',
    execStart: '',
    execStartPre: '',
    workingDirectory: '',
    user: '',
    group: '',
    environment: [],
    environmentFile: '',
    serviceType: 'simple',
    restart: 'on-failure',
    restartSec: 5,
    after: ['network-online.target'],
    wantedBy: 'multi-user.target',
    enabled: true,
  }
}

/** systemd サービスの一覧と編集。 */
export function ServicesSection(): React.JSX.Element {
  const t = useT()
  const services = useStore((s) => s.profile.postInstall.services)
  const users = useStore((s) => s.profile.postInstall.additionalUsers)
  const primaryUser = useStore((s) => s.profile.user.username)
  const update = useStore((s) => s.updateProfile)
  const [editing, setEditing] = useState<{ index: number; item: SystemdService } | null>(null)
  // カンマ区切りの欄は正規化した配列から value を作ると区切り文字が打てない
  // （useListDraft のコメント参照）。
  const afterDraft = useListDraft(editing?.item.after ?? [], ',')
  const environmentDraft = useListDraft(editing?.item.environment ?? [], '\n')

  const save = (): void => {
    if (!editing) return
    update((p) => {
      const list = [...p.postInstall.services]
      if (editing.index < 0) list.push(editing.item)
      else list[editing.index] = editing.item
      return { ...p, postInstall: { ...p.postInstall, services: list } }
    })
    setEditing(null)
  }

  const remove = (index: number): void => {
    update((p) => ({
      ...p,
      postInstall: { ...p.postInstall, services: p.postInstall.services.filter((_, i) => i !== index) },
    }))
  }

  const userOptions = [
    { value: '', label: t('service.userRootDefault') },
    { value: primaryUser, label: primaryUser },
    ...users.map((u) => ({ value: u.username, label: u.username })),
  ].filter((o, i, arr) => arr.findIndex((x) => x.value === o.value) === i)

  return (
    <Card title={t('service.title')} description={t('service.description')}>
      {services.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('service.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {services.map((s, i) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                  <Cog className="size-4 shrink-0 text-slate-500" aria-hidden />
                  <span className="font-mono">{s.name || t('service.unnamed')}.service</span>
                  {s.enabled ? (
                    <Badge tone="success">{t('service.badgeEnabled')}</Badge>
                  ) : (
                    <Badge>{t('service.badgeManual')}</Badge>
                  )}
                </p>
                <p className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                  {s.execStart || t('service.noCommand')}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" onClick={() => setEditing({ index: i, item: s })}>
                  {t('common.edit')}
                </Button>
                <Button variant="ghost" onClick={() => remove(i)} aria-label={t('common.delete')}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3">
        <Button onClick={() => setEditing({ index: -1, item: newService() })}>
          <Cog className="size-4" aria-hidden />
          {t('service.add')}
        </Button>
      </div>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing && editing.index < 0 ? t('service.add') : t('service.title')}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              disabled={
                !editing || !isValidServiceName(editing.item.name) || !editing.item.execStart.trim()
              }
              onClick={save}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t('service.name')}
                hint={t('service.nameHint')}
                required
                {...(editing.item.name && !isValidServiceName(editing.item.name)
                  ? { error: t('service.nameInvalid') }
                  : {})}
              >
                {(id) => (
                  <TextInput
                    id={id}
                    value={editing.item.name}
                    spellCheck={false}
                    placeholder="myapp"
                    onChange={(e) =>
                      setEditing({ ...editing, item: { ...editing.item, name: e.target.value } })
                    }
                  />
                )}
              </Field>
              <Field label={t('service.descriptionField')}>
                {(id) => (
                  <TextInput
                    id={id}
                    value={editing.item.description}
                    placeholder="My application"
                    onChange={(e) =>
                      setEditing({ ...editing, item: { ...editing.item, description: e.target.value } })
                    }
                  />
                )}
              </Field>
            </div>

            <Field label={t('service.execStart')} hint={t('service.execStartHint')} required>
              {(id) => (
                <TextInput
                  id={id}
                  value={editing.item.execStart}
                  spellCheck={false}
                  placeholder="/opt/myapp/bin/server --port 8080"
                  onChange={(e) =>
                    setEditing({ ...editing, item: { ...editing.item, execStart: e.target.value } })
                  }
                />
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('service.workingDirectory')}>
                {(id) => (
                  <TextInput
                    id={id}
                    value={editing.item.workingDirectory}
                    spellCheck={false}
                    placeholder="/opt/myapp"
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        item: { ...editing.item, workingDirectory: e.target.value },
                      })
                    }
                  />
                )}
              </Field>
              <Field label={t('service.user')}>
                {(id) => (
                  <Select
                    id={id}
                    value={editing.item.user}
                    onChange={(v) =>
                      setEditing({ ...editing, item: { ...editing.item, user: v, group: v } })
                    }
                    options={userOptions}
                  />
                )}
              </Field>
            </div>

            <Field label={t('service.environment')} hint={t('service.environmentHint')}>
              {(id) => (
                <TextArea
                  id={id}
                  rows={3}
                  spellCheck={false}
                  placeholder={'NODE_ENV=production\nPORT=8080'}
                  value={environmentDraft.text}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      item: {
                        ...editing.item,
                        environment: environmentDraft.change(e.target.value),
                      },
                    })
                  }
                />
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('service.type')}>
                {(id) => (
                  <Select
                    id={id}
                    value={editing.item.serviceType}
                    onChange={(v) =>
                      setEditing({ ...editing, item: { ...editing.item, serviceType: v as ServiceType } })
                    }
                    options={[
                      { value: 'simple', label: t('service.typeSimple') },
                      { value: 'exec', label: 'exec' },
                      { value: 'forking', label: t('service.typeForking') },
                      { value: 'oneshot', label: t('service.typeOneshot') },
                      { value: 'notify', label: 'notify' },
                    ]}
                  />
                )}
              </Field>
              <Field label={t('service.restart')}>
                {(id) => (
                  <Select
                    id={id}
                    value={editing.item.restart}
                    onChange={(v) =>
                      setEditing({ ...editing, item: { ...editing.item, restart: v as RestartPolicy } })
                    }
                    options={[
                      { value: 'on-failure', label: t('service.restartOnFailure') },
                      { value: 'always', label: t('service.restartAlways') },
                      { value: 'no', label: t('service.restartNo') },
                    ]}
                  />
                )}
              </Field>
              <Field label={t('service.restartSec')}>
                {(id) => (
                  <TextInput
                    id={id}
                    type="number"
                    min={1}
                    value={editing.item.restartSec}
                    disabled={editing.item.restart === 'no'}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        item: { ...editing.item, restartSec: Math.max(1, Number(e.target.value) || 1) },
                      })
                    }
                  />
                )}
              </Field>
            </div>

            <Field label={t('service.after')} hint={t('service.afterHint')}>
              {(id) => (
                <TextInput
                  id={id}
                  value={afterDraft.text}
                  spellCheck={false}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      item: { ...editing.item, after: afterDraft.change(e.target.value) },
                    })
                  }
                />
              )}
            </Field>

            <Switch
              checked={editing.item.enabled}
              onChange={(v) => setEditing({ ...editing, item: { ...editing.item, enabled: v } })}
              label={t('service.enabled')}
            />

            {editing.item.execStart.trim() && !editing.item.execStart.trim().startsWith('/') && (
              <Callout tone="warning">{t('service.execStartHint')}</Callout>
            )}

            <div>
              <p className="mb-1.5 text-sm font-medium text-slate-800 dark:text-slate-200">
                {t('service.preview')}
              </p>
              <CodeBlock code={renderServiceUnit(editing.item)} maxHeight="16rem" />
            </div>
          </div>
        )}
      </Modal>
    </Card>
  )
}
