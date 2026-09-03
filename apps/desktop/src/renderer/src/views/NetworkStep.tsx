import type { InterfaceSelector, NetworkConfig } from '@autoinstall/shared'
import { useStore } from '../store.js'
import { useT } from '../lib/i18n.js'
import { Badge, Callout, Card, Field, RadioGroup, Select, Switch, TextArea, TextInput } from '../components/ui.js'

type Mode = NetworkConfig['mode']

const DEFAULT_STATIC = {
  mode: 'static' as const,
  target: { kind: 'any' as const },
  address: '',
  gateway: '',
  nameservers: ['1.1.1.1', '8.8.8.8'],
  searchDomains: [] as string[],
  optional: false,
}

export function NetworkStep(): React.JSX.Element {
  const t = useT()
  const network = useStore((s) => s.profile.network)
  const update = useStore((s) => s.updateProfile)

  const setNetwork = (next: NetworkConfig): void => update((p) => ({ ...p, network: next }))

  const changeMode = (mode: Mode): void => {
    if (mode === network.mode) return
    switch (mode) {
      case 'installer-default':
        setNetwork({ mode: 'installer-default' })
        break
      case 'dhcp':
        setNetwork({ mode: 'dhcp', target: { kind: 'any' }, optional: true })
        break
      case 'static':
        setNetwork(DEFAULT_STATIC)
        break
      case 'raw':
        setNetwork({
          mode: 'raw',
          yaml: 'version: 2\nethernets:\n  enp0s3:\n    dhcp4: true\n',
        })
        break
    }
  }

  return (
    <div className="space-y-5">
      <Card title={t('network.title')}>
        <RadioGroup<Mode>
          value={network.mode}
          onChange={changeMode}
          options={[
            {
              value: 'installer-default',
              label: t('network.modeDefault'),
              badge: <Badge tone="success">{t('common.recommended')}</Badge>,
              description: t('network.modeDefaultHint'),
            },
            {
              value: 'dhcp',
              label: t('network.modeDhcp'),
              description: '特定のネットワークカードだけを DHCP にしたい場合に選びます。',
            },
            {
              value: 'static',
              label: t('network.modeStatic'),
              description: 'サーバー用途で IP アドレスを固定したい場合に選びます。',
            },
            {
              value: 'raw',
              label: t('network.modeRaw'),
              badge: <Badge>{t('common.advanced')}</Badge>,
              description: 'bond / VLAN / 複数 NIC など、複雑な構成を自分で書く場合に選びます。',
            },
          ]}
        />
      </Card>

      {network.mode === 'installer-default' && (
        <Callout tone="info">
          インストーラが <code className="font-mono">eth*</code> と{' '}
          <code className="font-mono">en*</code> に一致するすべての有線 NIC で DHCPv4 を試し、
          アドレスを取得できなかった NIC は自動的に無効化します。手で設定を書くより確実です。
        </Callout>
      )}

      {(network.mode === 'dhcp' || network.mode === 'static') && (
        <Card title="対象のネットワークカード">
          <InterfacePicker
            value={network.target}
            onChange={(target) => setNetwork({ ...network, target })}
          />
          <div className="mt-4">
            <Switch
              checked={network.optional}
              onChange={(optional) => setNetwork({ ...network, optional })}
              label={t('network.optional')}
              description={t('network.optionalHint')}
            />
          </div>
        </Card>
      )}

      {network.mode === 'static' && (
        <Card title="固定 IP の設定">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t('network.address')} hint={t('network.addressHint')} required>
              {(id) => (
                <TextInput
                  id={id}
                  value={network.address}
                  spellCheck={false}
                  placeholder="192.168.1.10/24"
                  onChange={(e) => setNetwork({ ...network, address: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('network.gateway')} required>
              {(id) => (
                <TextInput
                  id={id}
                  value={network.gateway}
                  spellCheck={false}
                  placeholder="192.168.1.1"
                  onChange={(e) => setNetwork({ ...network, gateway: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('network.nameservers')} hint="カンマ区切りで複数指定できます">
              {(id) => (
                <TextInput
                  id={id}
                  value={network.nameservers.join(', ')}
                  spellCheck={false}
                  placeholder="1.1.1.1, 8.8.8.8"
                  onChange={(e) =>
                    setNetwork({
                      ...network,
                      nameservers: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    })
                  }
                />
              )}
            </Field>
            <Field label={t('network.searchDomains')} hint="社内ドメインなど（任意）">
              {(id) => (
                <TextInput
                  id={id}
                  value={network.searchDomains.join(', ')}
                  spellCheck={false}
                  placeholder="example.local"
                  onChange={(e) =>
                    setNetwork({
                      ...network,
                      searchDomains: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                    })
                  }
                />
              )}
            </Field>
          </div>
          <div className="mt-4">
            <Callout tone="warning">
              固定 IP を設定した物理サーバーでは、「インストール後は cloud-init にネットワークを触らせない」
              （インストール後の設定）も合わせて有効にすることをおすすめします。再起動のたびに設定が
              書き戻されるのを防げます。
            </Callout>
          </div>
        </Card>
      )}

      {network.mode === 'raw' && (
        <Card
          title="netplan の設定を直接書く"
          description="autoinstall の network キーにそのまま入ります。netplan v2 の形式です。"
        >
          <TextArea
            rows={14}
            value={network.yaml}
            spellCheck={false}
            onChange={(e) => setNetwork({ mode: 'raw', yaml: e.target.value })}
          />
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            例: bond、VLAN、複数 NIC の静的設定など。
            <button
              onClick={() => void window.autoinstall.openExternal('https://netplan.io/reference')}
              className="ml-1 text-sky-700 underline-offset-2 hover:underline dark:text-sky-400"
            >
              netplan のリファレンス
            </button>
          </p>
        </Card>
      )}
    </div>
  )
}

function InterfacePicker({
  value,
  onChange,
}: {
  value: InterfaceSelector
  onChange: (value: InterfaceSelector) => void
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="space-y-3">
      <Field label={t('network.interface')}>
        {(id) => (
          <Select
            id={id}
            value={value.kind}
            onChange={(kind) => {
              if (kind === 'any') onChange({ kind: 'any' })
              else if (kind === 'name') onChange({ kind: 'name', name: '' })
              else onChange({ kind: 'mac', macaddress: '' })
            }}
            options={[
              { value: 'any', label: t('network.interfaceAny') },
              { value: 'name', label: t('network.interfaceByName') },
              { value: 'mac', label: t('network.interfaceByMac') },
            ]}
          />
        )}
      </Field>
      {value.kind === 'name' && (
        <Field
          label="ネットワークカードの名前"
          hint="例: enp0s3, eno1, ens18。事前に確認しておく必要があります。"
        >
          {(id) => (
            <TextInput
              id={id}
              value={value.name}
              spellCheck={false}
              placeholder="enp0s3"
              onChange={(e) => onChange({ kind: 'name', name: e.target.value })}
            />
          )}
        </Field>
      )}
      {value.kind === 'mac' && (
        <Field label="MAC アドレス" hint="例: 52:54:00:12:34:56。機器を入れ替えても確実に一致します。">
          {(id) => (
            <TextInput
              id={id}
              value={value.macaddress}
              spellCheck={false}
              placeholder="52:54:00:12:34:56"
              onChange={(e) => onChange({ kind: 'mac', macaddress: e.target.value.toLowerCase() })}
            />
          )}
        </Field>
      )}
    </div>
  )
}
