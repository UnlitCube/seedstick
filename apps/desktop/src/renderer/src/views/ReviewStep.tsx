import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Copy, Download, FolderOpen, Info, Save, Upload } from 'lucide-react'
import type { ValidationIssue } from '@autoinstall/shared'
import { useStore } from '../store.js'
import { formatBytes } from '../lib/format.js'
import { useT } from '../lib/i18n.js'
import { Badge, Button, Callout, Card, CodeBlock } from '../components/ui.js'

type Tab = 'user-data' | 'autoinstall' | 'grub'

export function ReviewStep(): React.JSX.Element {
  const t = useT()
  const locale = useStore((s) => s.locale)
  const { config, configBusy, profile, iso } = useStore()
  const loadProfileFromDisk = useStore((s) => s.loadProfileFromDisk)
  const [tab, setTab] = useState<Tab>('user-data')
  const [copied, setCopied] = useState(false)

  const errors = config?.issues.filter((i) => i.severity === 'error') ?? []
  const warnings = config?.issues.filter((i) => i.severity === 'warning') ?? []
  const infos = config?.issues.filter((i) => i.severity === 'info') ?? []

  const currentCode =
    tab === 'user-data'
      ? (config?.userData ?? '')
      : tab === 'autoinstall'
        ? (config?.autoinstallYaml ?? '')
        : (config?.patchedGrubCfg ?? iso?.patchedGrubCfg ?? '')

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(currentCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="space-y-5">
      {config && (
        <Callout
          tone={errors.length > 0 ? 'danger' : warnings.length > 0 ? 'warning' : 'success'}
          title={
            errors.length > 0
              ? t('review.errorsFound')
              : warnings.length > 0
                ? t('review.warningsFound')
                : t('review.noIssues')
          }
        >
          {errors.length === 0 && (
            <p>{config.unattended ? t('review.unattended') : t('review.interactive')}</p>
          )}
          {errors.length > 0 && <p>先に進む前に、下のエラーを修正してください。</p>}
        </Callout>
      )}

      {config && config.issues.length > 0 && (
        <Card title={t('review.issues')}>
          <ul className="space-y-2">
            {[...errors, ...warnings, ...infos].map((issue, i) => (
              <IssueRow key={`${issue.field}-${i}`} issue={issue} locale={locale} />
            ))}
          </ul>
        </Card>
      )}

      <Card title={t('review.yaml')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900">
            <TabButton active={tab === 'user-data'} onClick={() => setTab('user-data')}>
              user-data
            </TabButton>
            <TabButton active={tab === 'autoinstall'} onClick={() => setTab('autoinstall')}>
              autoinstall.yaml
            </TabButton>
            <TabButton active={tab === 'grub'} onClick={() => setTab('grub')} disabled={!iso}>
              grub.cfg
            </TabButton>
          </div>
          <Button onClick={() => void copy()} disabled={!currentCode}>
            <Copy className="size-4" aria-hidden />
            {copied ? t('common.copied') : t('common.copy')}
          </Button>
        </div>

        <div className="mt-3">
          {configBusy && !config ? (
            <p className="text-sm text-slate-500">{t('common.loading')}</p>
          ) : (
            <CodeBlock code={currentCode} maxHeight="30rem" />
          )}
        </div>

        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          {tab === 'user-data' &&
            'この内容が USB の設定用パーティション (CIDATA) に user-data として書き込まれます。先頭の #cloud-config は cloud-init が必須とする目印です。'}
          {tab === 'autoinstall' &&
            'cloud-config でラップしない形式です。人が読む用の控えとして USB にも同梱されます。'}
          {tab === 'grub' &&
            'ISO 内の /boot/grub/grub.cfg をこの内容に書き換えます。autoinstall が無いと確認プロンプトで止まります。'}
        </p>
      </Card>

      <Card title="サマリー">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Summary label="Ubuntu">
            {iso ? `Server ${iso.identity.version} ${iso.identity.arch}` : '未選択'}
          </Summary>
          <Summary label="ホスト名">{profile.basics.hostname}</Summary>
          <Summary label="ユーザー">{profile.user.username}</Summary>
          <Summary label="ロケール / キーボード">
            {profile.basics.locale} / {profile.basics.keyboard.layout}
          </Summary>
          <Summary label="タイムゾーン">{profile.basics.timezone}</Summary>
          <Summary label="ネットワーク">
            {profile.network.mode === 'installer-default'
              ? '自動 (DHCP)'
              : profile.network.mode === 'static'
                ? `固定 ${profile.network.address}`
                : profile.network.mode === 'dhcp'
                  ? 'DHCP (明示)'
                  : 'カスタム YAML'}
          </Summary>
          <Summary label="ディスク">
            {profile.storage.mode === 'raw'
              ? 'カスタム (curtin)'
              : `${profile.storage.mode} / ${profile.storage.match.kind}`}
          </Summary>
          <Summary label="SSH">
            {profile.ssh.installServer
              ? `有効（鍵 ${profile.ssh.authorizedKeys.length} 個 / パスワード ${profile.ssh.allowPasswordAuth ? '許可' : '禁止'}）`
              : '無効'}
          </Summary>
          <Summary label="追加ユーザー">
            {profile.postInstall.additionalUsers.length === 0
              ? 'なし'
              : profile.postInstall.additionalUsers.map((u) => u.username).join(', ')}
          </Summary>
          <Summary label="アプリの展開">
            {profile.postInstall.deployments.length === 0
              ? 'なし'
              : `${profile.postInstall.deployments.length} 件${
                  config !== null && config.payloadBytes > 0
                    ? `（${formatBytes(config.payloadBytes)}）`
                    : ''
                }`}
          </Summary>
          <Summary label="サービス">
            {profile.postInstall.services.length === 0
              ? 'なし'
              : profile.postInstall.services.map((s) => `${s.name}.service`).join(', ')}
          </Summary>
          <Summary label="GPU / CUDA">
            {profile.software.gpu.enabled ? (
              <Badge tone="info">
                {profile.software.gpu.driver === 'open'
                  ? 'nvidia-open'
                  : profile.software.gpu.driver === 'proprietary'
                    ? 'cuda-drivers'
                    : 'ドライバなし'}
                {profile.software.gpu.toolkit !== 'none' && ' + CUDA'}
              </Badge>
            ) : (
              'なし'
            )}
          </Summary>
          <Summary label="apt full-upgrade">
            {profile.postInstall.aptFullUpgrade ? '実行する' : 'しない'}
          </Summary>
          <Summary label="実行時に決める値">
            {(() => {
              const rv = profile.runtimeValues
              const parts = (['hostname', 'network', 'disk'] as const)
                .filter((f) => rv[f] !== 'fixed')
                .map((f) => {
                  const name = f === 'hostname' ? 'ホスト名' : f === 'network' ? 'ネットワーク' : 'ディスク'
                  return `${name}: ${rv[f] === 'kernel-arg' ? '起動メニュー' : '手入力'}`
                })
              if (parts.length === 0) return 'なし（すべて固定）'
              const menu = rv.presets.length > 0 ? `／メニュー ${rv.presets.length} 件` : ''
              return parts.join(' / ') + menu
            })()}
          </Summary>
          <Summary label="インストール後の動作">
            {profile.behavior.shutdown === 'reboot' ? '再起動' : '電源オフ'}
          </Summary>
          <Summary label="完全無人">
            {config?.unattended ? (
              <Badge tone="success">はい</Badge>
            ) : (
              <Badge tone="warning">一部対話あり</Badge>
            )}
          </Summary>
        </dl>
      </Card>

      <Card title={t('review.export')} description="USB を作らずに設定だけ持ち出すこともできます。">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void window.autoinstall.saveProfile(profile)}>
            <Save className="size-4" aria-hidden />
            {t('review.exportProfile')}
          </Button>
          <Button onClick={() => void loadProfileFromDisk()}>
            <Upload className="size-4" aria-hidden />
            {t('review.importProfile')}
          </Button>
          <Button onClick={() => void window.autoinstall.exportBundle(profile)}>
            <FolderOpen className="size-4" aria-hidden />
            設定一式をフォルダに書き出す
          </Button>
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          <Download className="mr-1 inline size-3" aria-hidden />
          プロファイル JSON にはパスワードのハッシュだけが入り、平文は含まれません。
          同じ設定で何台も作るときに使えます。
        </p>
      </Card>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-3 py-1.5 font-mono text-xs transition disabled:opacity-40 ${
        active
          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

function Summary({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-1 dark:border-slate-700/50">
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-right font-medium text-slate-800 dark:text-slate-200">{children}</dd>
    </div>
  )
}

function IssueRow({ issue, locale }: { issue: ValidationIssue; locale: 'ja' | 'en' }): React.JSX.Element {
  const Icon = issue.severity === 'error' ? AlertTriangle : issue.severity === 'warning' ? AlertTriangle : Info
  const color =
    issue.severity === 'error'
      ? 'text-rose-600 dark:text-rose-400'
      : issue.severity === 'warning'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-sky-600 dark:text-sky-400'
  return (
    <li className="flex gap-2.5 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      {issue.severity === 'info' ? (
        <Icon className={`mt-0.5 size-4 shrink-0 ${color}`} aria-hidden />
      ) : (
        <Icon className={`mt-0.5 size-4 shrink-0 ${color}`} aria-hidden />
      )}
      <div className="min-w-0">
        <p className="text-sm text-slate-800 dark:text-slate-200">
          {locale === 'ja' ? issue.messageJa : issue.messageEn}
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">{issue.field}</p>
      </div>
    </li>
  )
}

export { CheckCircle2 }
