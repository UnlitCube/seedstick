import { useEffect, useState } from 'react'
import { Eye, EyeOff, KeyRound, Upload, Wand2 } from 'lucide-react'
import { SERIES_FEATURES, stripLineTerminators, type PrimaryUserGroups } from '@autoinstall/shared'
import { useStore } from '../store.js'
import { useT } from '../lib/i18n.js'
import { generatePassword, passwordStrength } from '../lib/format.js'
import {
  Badge,
  Button,
  Callout,
  Card,
  Field,
  Select,
  Switch,
  TextArea,
  TextInput,
  useDraft,
  useListDraft,
} from '../components/ui.js'
import { AdditionalUsersSection } from './sections/AdditionalUsers.js'

const SSH_KEY_RE =
  /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\s+[A-Za-z0-9+/=]+(\s+\S+)?$/

export function UserStep(): React.JSX.Element {
  const t = useT()
  const profile = useStore((s) => s.profile)
  const update = useStore((s) => s.updateProfile)
  const passwordDraft = useStore((s) => s.passwordDraft)
  const passwordConfirmDraft = useStore((s) => s.passwordConfirmDraft)
  const setPasswordDraft = useStore((s) => s.setPasswordDraft)
  const applyPassword = useStore((s) => s.applyPassword)
  const [reveal, setReveal] = useState(false)
  const features = SERIES_FEATURES[profile.series]

  // 入力が落ち着いてからハッシュ化する。1 文字ごとに main を呼ぶと無駄が多い。
  useEffect(() => {
    if (!passwordDraft || passwordDraft !== passwordConfirmDraft) return
    const timer = setTimeout(() => void applyPassword(), 300)
    return () => clearTimeout(timer)
  }, [passwordDraft, passwordConfirmDraft, applyPassword])

  const usernameInvalid =
    profile.user.username.length > 0 && !/^[a-z_][a-z0-9_-]{0,31}$/.test(profile.user.username)
  const mismatch =
    passwordConfirmDraft.length > 0 && passwordDraft !== passwordConfirmDraft
  const strength = passwordStrength(passwordDraft)
  const keys = profile.ssh.authorizedKeys
  // 改行区切りの欄も同じ。正規化した配列から value を作ると
  // 改行を打った瞬間に消え、2 個目の鍵をキーボードで足せない。
  const keysDraft = useListDraft(keys, '\n')
  // 管理ユーザーのグループは空白／カンマ区切り。ここも同じ形なので下書きに寄せる。
  const userGroupsDraft = useDraft<string[]>(
    profile.user.groups.mode === 'default' ? [] : [...profile.user.groups.groups],
    (list) => list.join(' '),
    (text) => text.split(/[\s,]+/).filter(Boolean),
  )

  const setKeys = (text: string): void => {
    const list = keysDraft.change(text)
    update((p) => ({ ...p, ssh: { ...p.ssh, authorizedKeys: list } }))
  }

  const importKeyFile = async (): Promise<void> => {
    const file = await window.autoinstall.readTextFile()
    if (!file) return
    const merged = [...keys, ...file.content.split('\n').map((l) => l.trim()).filter(Boolean)]
    update((p) => ({ ...p, ssh: { ...p.ssh, authorizedKeys: [...new Set(merged)] } }))
  }

  const lockedOut =
    profile.ssh.installServer &&
    keys.length === 0 &&
    (!profile.ssh.allowPasswordAuth || profile.postInstall.presets.includes('ssh-harden'))

  return (
    <div className="space-y-5">
      <Card title={t('user.title')} description={t('user.description')}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('user.realname')}>
            {(id) => (
              <TextInput
                id={id}
                value={profile.user.realname}
                placeholder="Ubuntu User"
                onChange={(e) => update((p) => ({ ...p, user: { ...p.user, realname: e.target.value } }))}
              />
            )}
          </Field>

          <Field
            label={t('user.username')}
            hint={t('user.usernameHint')}
            required
            {...(usernameInvalid ? { error: '使えない文字が含まれています' } : {})}
          >
            {(id) => (
              <TextInput
                id={id}
                value={profile.user.username}
                invalid={usernameInvalid}
                spellCheck={false}
                autoComplete="off"
                placeholder="ubuntu"
                onChange={(e) =>
                  update((p) => ({ ...p, user: { ...p.user, username: e.target.value.toLowerCase() } }))
                }
              />
            )}
          </Field>

          <Field label={t('user.password')} required>
            {(id) => (
              <div className="flex gap-2">
                <TextInput
                  id={id}
                  type={reveal ? 'text' : 'password'}
                  value={passwordDraft}
                  autoComplete="new-password"
                  // 貼り付けで混入した改行を落とす。残すと YAML と crypt ハッシュが壊れる。
                  onChange={(e) =>
                    setPasswordDraft(stripLineTerminators(e.target.value), passwordConfirmDraft)
                  }
                />
                <Button
                  type="button"
                  onClick={() => setReveal(!reveal)}
                  aria-label={reveal ? t('common.hide') : t('common.show')}
                >
                  {reveal ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    const generated = generatePassword()
                    setPasswordDraft(generated, generated)
                    setReveal(true)
                  }}
                  title={t('user.generate')}
                >
                  <Wand2 className="size-4" aria-hidden />
                </Button>
              </div>
            )}
          </Field>

          <Field
            label={t('user.passwordConfirm')}
            required
            {...(mismatch ? { error: t('user.passwordMismatch') } : {})}
          >
            {(id) => (
              <TextInput
                id={id}
                type={reveal ? 'text' : 'password'}
                value={passwordConfirmDraft}
                invalid={mismatch}
                autoComplete="new-password"
                onChange={(e) =>
                  setPasswordDraft(passwordDraft, stripLineTerminators(e.target.value))
                }
              />
            )}
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {passwordDraft.length > 0 && (
            <span className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              {t('user.passwordStrength')}:
              <Badge tone={strength === 'strong' ? 'success' : strength === 'fair' ? 'warning' : 'danger'}>
                {strength === 'strong'
                  ? t('user.strengthStrong')
                  : strength === 'fair'
                    ? t('user.strengthFair')
                    : t('user.strengthWeak')}
              </Badge>
            </span>
          )}
          {profile.user.passwordHash && (
            <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <KeyRound className="size-3" aria-hidden />
              {t('user.passwordStored')}
            </span>
          )}
        </div>

        <div className="mt-5">
          <Switch
            checked={profile.user.sudoNoPassword}
            onChange={(v) => {
              // 明示的な boolean を渡す。undefined を使うと JSON 化で消えて再有効化できなくなる。
              update((p) => ({
                ...p,
                user: { ...p.user, sudoNoPassword: v },
                postInstall: {
                  ...p.postInstall,
                  presets: v
                    ? [...new Set([...p.postInstall.presets, 'sudo-nopasswd' as const])]
                    : p.postInstall.presets.filter((id) => id !== 'sudo-nopasswd'),
                },
              }))
            }}
            tone="warning"
            label={t('user.sudoNoPassword')}
            description="自動化には便利ですが、このユーザーのログインを奪われると即座に root 権限を取られます。"
          />
        </div>

        <div className="mt-5">
          <Field
            label={t('adv.identityGroups')}
            hint={
              features.identityGroups
                ? 'docker や libvirt など、追加で入れたいグループをスペース区切りで書きます。'
                : t('adv.identityGroupsUnsupported')
            }
          >
            {(id) => (
              <div className="space-y-2">
                <Select
                  value={profile.user.groups.mode}
                  disabled={!features.identityGroups}
                  onChange={(mode) => {
                    const current =
                      profile.user.groups.mode === 'default' ? [] : profile.user.groups.groups
                    const groups: PrimaryUserGroups =
                      mode === 'default'
                        ? { mode: 'default' }
                        : { mode: mode as 'append' | 'override', groups: current }
                    update((p) => ({ ...p, user: { ...p.user, groups } }))
                  }}
                  options={[
                    { value: 'default', label: 'インストーラの既定のまま (sudo, adm など)' },
                    { value: 'append', label: '既定に加えて追加する' },
                    { value: 'override', label: '指定したグループだけにする' },
                  ]}
                />
                {profile.user.groups.mode !== 'default' && (
                  <TextInput
                    id={id}
                    spellCheck={false}
                    placeholder="docker libvirt"
                    disabled={!features.identityGroups}
                    value={userGroupsDraft.text}
                    onChange={(e) => {
                      const list = userGroupsDraft.change(e.target.value)
                      update((p) => ({
                        ...p,
                        user: {
                          ...p.user,
                          groups:
                            p.user.groups.mode === 'default'
                              ? p.user.groups
                              : { mode: p.user.groups.mode, groups: list },
                        },
                      }))
                    }}
                  />
                )}
                {profile.user.groups.mode === 'override' && (
                  <Callout tone="warning">
                    sudo を外すと管理者権限が無くなり、インストール後に設定を変えられなくなります。
                  </Callout>
                )}
              </div>
            )}
          </Field>
        </div>
      </Card>

      <Card title={t('ssh.title')}>
        <div className="space-y-3">
          <Switch
            checked={profile.ssh.installServer}
            onChange={(v) => update((p) => ({ ...p, ssh: { ...p.ssh, installServer: v } }))}
            label={t('ssh.installServer')}
            description={t('ssh.installServerHint')}
          />
          <Switch
            checked={profile.ssh.allowPasswordAuth}
            disabled={!profile.ssh.installServer}
            onChange={(v) => update((p) => ({ ...p, ssh: { ...p.ssh, allowPasswordAuth: v } }))}
            label={t('ssh.allowPassword')}
            description="オフにすると公開鍵でしかログインできません。必ず先に公開鍵を登録してください。"
          />
        </div>

        <div className="mt-5">
          <Field label={t('ssh.authorizedKeys')} hint={t('ssh.authorizedKeysHint')}>
            {(id) => (
              <div className="space-y-2">
                <TextArea
                  id={id}
                  rows={4}
                  value={keysDraft.text}
                  spellCheck={false}
                  placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5... user@example"
                  onChange={(e) => setKeys(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <Button onClick={() => void importKeyFile()}>
                    <Upload className="size-4" aria-hidden />
                    {t('ssh.importFile')}
                  </Button>
                  {keys.length > 0 && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {keys.length} 個の鍵
                      {keys.some((k) => !SSH_KEY_RE.test(k)) && (
                        <span className="ml-2 text-rose-600 dark:text-rose-400">
                          形式が正しくない鍵があります
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </div>
            )}
          </Field>
        </div>

        {lockedOut && (
          <div className="mt-4">
            <Callout tone="danger" title="このままではログインできなくなります">
              SSH のパスワードログインを禁止しているのに公開鍵が登録されていません。公開鍵を追加するか、
              パスワードログインを許可してください。
            </Callout>
          </div>
        )}
      </Card>

      <AdditionalUsersSection />
    </div>
  )
}
