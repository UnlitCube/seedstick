import { useState } from 'react'
import { Plus, Trash2, UserPlus, Wand2 } from 'lucide-react'
import { SHELL_CHOICES, type AdditionalUser, type SudoMode } from '@autoinstall/shared'
import { useStore } from '../../store.js'
import { useT } from '../../lib/i18n.js'
import { generatePassword } from '../../lib/format.js'
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
  useListDraft,
} from '../../components/ui.js'

/** 追加ユーザーの一覧と編集。 */
export function AdditionalUsersSection(): React.JSX.Element {
  const t = useT()
  const locale = useStore((s) => s.locale)
  const users = useStore((s) => s.profile.postInstall.additionalUsers)
  const update = useStore((s) => s.updateProfile)
  // カンマ区切りの欄は正規化した配列から value を作ると区切り文字が打てない
  // （useListDraft のコメント参照）。
  const [editing, setEditing] = useState<{ index: number; user: AdditionalUser; password: string } | null>(
    null,
  )

  const groupsDraft = useListDraft(editing?.user.groups ?? [], ',')

  const commit = async (): Promise<void> => {
    if (!editing) return
    // 平文はここで捨て、ハッシュだけをプロファイルに入れる
    const passwordHash = editing.password
      ? await window.autoinstall.hashPassword(editing.password)
      : editing.user.passwordHash
    const next: AdditionalUser = { ...editing.user, passwordHash }
    update((p) => {
      const list = [...p.postInstall.additionalUsers]
      if (editing.index < 0) list.push(next)
      else list[editing.index] = next
      return { ...p, postInstall: { ...p.postInstall, additionalUsers: list } }
    })
    setEditing(null)
  }

  const remove = (index: number): void => {
    update((p) => ({
      ...p,
      postInstall: {
        ...p.postInstall,
        additionalUsers: p.postInstall.additionalUsers.filter((_, i) => i !== index),
      },
    }))
  }

  return (
    <Card title={t('users.title')} description={t('users.description')}>
      {users.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('users.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {users.map((u, i) => (
            <li
              key={u.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
            >
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                  <span className="font-mono">{u.username}</span>
                  {u.sudo === 'nopasswd' && <Badge tone="warning">sudo (NOPASSWD)</Badge>}
                  {u.sudo === 'password' && <Badge>sudo</Badge>}
                  {u.systemAccount && <Badge>system</Badge>}
                  {!u.passwordHash && u.sshAuthorizedKeys.length === 0 && (
                    <Badge tone="danger">ログイン不可</Badge>
                  )}
                </p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {u.realname || '—'} · {u.shell}
                  {u.groups.length > 0 && ` · ${u.groups.join(', ')}`}
                  {u.sshAuthorizedKeys.length > 0 && ` · SSH 鍵 ${u.sshAuthorizedKeys.length}`}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  onClick={() => setEditing({ index: i, user: u, password: '' })}
                >
                  編集
                </Button>
                <Button variant="ghost" onClick={() => remove(i)} aria-label="削除">
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
              password: '',
              user: {
                id: crypto.randomUUID(),
                username: '',
                realname: '',
                passwordHash: '',
                sudo: 'none',
                groups: [],
                shell: '/bin/bash',
                sshAuthorizedKeys: [],
                createHome: true,
                systemAccount: false,
              },
            })
          }
        >
          <UserPlus className="size-4" aria-hidden />
          {t('users.add')}
        </Button>
      </div>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing && editing.index < 0 ? t('users.add') : t('users.title')}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              disabled={!editing?.user.username.trim()}
              onClick={() => void commit()}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('users.username')} required>
                {(id) => (
                  <TextInput
                    id={id}
                    value={editing.user.username}
                    spellCheck={false}
                    placeholder="deploy"
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        user: { ...editing.user, username: e.target.value.toLowerCase() },
                      })
                    }
                  />
                )}
              </Field>
              <Field label={t('users.realname')}>
                {(id) => (
                  <TextInput
                    id={id}
                    value={editing.user.realname}
                    placeholder="Deployment account"
                    onChange={(e) =>
                      setEditing({ ...editing, user: { ...editing.user, realname: e.target.value } })
                    }
                  />
                )}
              </Field>
            </div>

            <Field
              label={t('users.password')}
              hint={
                editing.user.passwordHash && !editing.password
                  ? 'パスワードは設定済みです。変更する場合だけ入力してください。'
                  : t('users.passwordHint')
              }
            >
              {(id) => (
                <div className="flex gap-2">
                  <TextInput
                    id={id}
                    type="text"
                    value={editing.password}
                    autoComplete="new-password"
                    spellCheck={false}
                    onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                  />
                  <Button
                    type="button"
                    onClick={() => setEditing({ ...editing, password: generatePassword() })}
                    title={t('user.generate')}
                  >
                    <Wand2 className="size-4" aria-hidden />
                  </Button>
                  {editing.user.passwordHash && (
                    <Button
                      type="button"
                      onClick={() =>
                        setEditing({
                          ...editing,
                          password: '',
                          user: { ...editing.user, passwordHash: '' },
                        })
                      }
                    >
                      消す
                    </Button>
                  )}
                </div>
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('users.sudo')}>
                {(id) => (
                  <Select
                    id={id}
                    value={editing.user.sudo}
                    onChange={(v) =>
                      setEditing({ ...editing, user: { ...editing.user, sudo: v as SudoMode } })
                    }
                    options={[
                      { value: 'none', label: t('users.sudoNone') },
                      { value: 'password', label: t('users.sudoPassword') },
                      { value: 'nopasswd', label: t('users.sudoNopasswd') },
                    ]}
                  />
                )}
              </Field>
              <Field label={t('users.shell')}>
                {(id) => (
                  <Select
                    id={id}
                    value={editing.user.shell}
                    onChange={(v) => setEditing({ ...editing, user: { ...editing.user, shell: v } })}
                    options={SHELL_CHOICES.map((c) => ({
                      value: c.value,
                      label: locale === 'ja' ? c.labelJa : c.labelEn,
                    }))}
                  />
                )}
              </Field>
            </div>

            <Field label={t('users.groups')} hint={t('users.groupsHint')}>
              {(id) => (
                <TextInput
                  id={id}
                  value={groupsDraft.text}
                  spellCheck={false}
                  placeholder="docker, adm"
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      user: {
                        ...editing.user,
                        groups: groupsDraft.change(e.target.value),
                      },
                    })
                  }
                />
              )}
            </Field>

            <Field label={t('users.sshKeys')} hint={t('ssh.authorizedKeysHint')}>
              {(id) => (
                <TextArea
                  id={id}
                  rows={3}
                  spellCheck={false}
                  value={editing.user.sshAuthorizedKeys.join('\n')}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      user: {
                        ...editing.user,
                        sshAuthorizedKeys: e.target.value
                          .split('\n')
                          .map((k) => k.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                />
              )}
            </Field>

            <div className="space-y-2">
              <Switch
                checked={editing.user.createHome}
                onChange={(v) =>
                  setEditing({ ...editing, user: { ...editing.user, createHome: v } })
                }
                label={t('users.createHome')}
              />
              <Switch
                checked={editing.user.systemAccount}
                onChange={(v) =>
                  setEditing({ ...editing, user: { ...editing.user, systemAccount: v } })
                }
                label={t('users.systemAccount')}
                description={t('users.systemAccountHint')}
              />
            </div>

            {editing.user.sudo === 'nopasswd' && (
              <Callout tone="warning">
                このユーザーはパスワード無しで root 権限を取得できます。サービス専用アカウントには
                通常「なし」を選んでください。
              </Callout>
            )}
          </div>
        )}
      </Modal>
    </Card>
  )
}

export { Plus }
