import type { InterfaceSelector, NetworkConfig } from '@autoinstall/shared'
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
  useListDraft,
} from '../components/ui.js'

type Mode = NetworkConfig['mode']

/**
 * 「詳しい設定」の中が既定から変わっている件数。
 *
 * ここに入っているのは**生の netplan 上書きだけ**なので 0 か 1 になる。
 * `createDefaultProfile()` の network は `{mode:'installer-default'}` で、
 * 生の YAML は raw モードのときにしか存在しない。だから「raw であること」が
 * そのまま「既定から変わっている」になる。
 *
 * 判別可能ユニオンを丸ごと比較しない（落とし穴 22 / 29）。**判別子だけを見る**。
 * 深い比較にすると、`static` の nameservers を並べ替えただけで、
 * ここに入っていない設定の変更まで数えてしまう。
 */
export function countNetworkAdvancedChanges(network: NetworkConfig): number {
  return network.mode === 'raw' ? 1 : 0
}

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
  const tx = useTx()
  const network = useStore((s) => s.profile.network)
  const update = useStore((s) => s.updateProfile)

  const setNetwork = (next: NetworkConfig): void => update((p) => ({ ...p, network: next }))

  // カンマ区切りの欄は、正規化した配列から value を作ると区切り文字が打てない。
  // 入力中の生テキストを保持する（useListDraft のコメント参照）。
  const nameserversDraft = useListDraft(
    network.mode === 'static' ? network.nameservers : [],
    ',',
  )
  const searchDomainsDraft = useListDraft(
    network.mode === 'static' ? network.searchDomains : [],
    ',',
  )

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

  const rawChangedCount = countNetworkAdvancedChanges(network)

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
              description: t('network.modeDhcpHint'),
            },
            {
              value: 'static',
              label: t('network.modeStatic'),
              description: t('network.modeStaticHint'),
            },
            {
              value: 'raw',
              label: t('network.modeRaw'),
              badge: <Badge>{t('common.advanced')}</Badge>,
              description: t('network.modeRawHint'),
            },
          ]}
        />
      </Card>

      {network.mode === 'installer-default' && (
        <Callout tone="info">
          {tx('network.installerDefaultBody', {
            ethGlob: <code className="font-mono">eth*</code>,
            enGlob: <code className="font-mono">en*</code>,
          })}
        </Callout>
      )}

      {(network.mode === 'dhcp' || network.mode === 'static') && (
        <Card title={t('network.interface')}>
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
        <Card title={t('network.staticTitle')}>
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
            <Field label={t('network.nameservers')} hint={t('network.nameserversHint')}>
              {(id) => (
                <TextInput
                  id={id}
                  value={nameserversDraft.text}
                  spellCheck={false}
                  placeholder="1.1.1.1, 8.8.8.8"
                  onChange={(e) =>
                    setNetwork({ ...network, nameservers: nameserversDraft.change(e.target.value) })
                  }
                />
              )}
            </Field>
            <Field label={t('network.searchDomains')} hint={t('network.searchDomainsHint')}>
              {(id) => (
                <TextInput
                  id={id}
                  value={searchDomainsDraft.text}
                  spellCheck={false}
                  placeholder="example.local"
                  onChange={(e) =>
                    setNetwork({
                      ...network,
                      searchDomains: searchDomainsDraft.change(e.target.value),
                    })
                  }
                />
              )}
            </Field>
          </div>
          <div className="mt-4">
            <Callout tone="warning">{t('network.staticCloudInitNote')}</Callout>
          </div>
        </Card>
      )}

      {/*
        「詳しい設定」— インストーラが決して聞かないもの。ここは生の netplan 上書きだけ。
        netplan を直接書いているときは `changedCount` が 1 になるので **必ず開いた状態**で出る
        （閉じていると「固定 IP を設定したのに効かない」に見える。上のモード選択と
        ここの中身が食い違って見えるのが、この画面でいちばん危ない誤解）。
      */}
      <Disclosure
        title={t('network.detailsTitle')}
        description={t('network.detailsDescription')}
        changedCount={rawChangedCount}
      >
        {network.mode === 'raw' ? (
          <div>
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t('network.rawTitle')}
            </h4>
            <p className="mt-1 mb-3 text-sm text-slate-600 dark:text-slate-400">
              {t('network.rawDescription')}
            </p>
            <TextArea
              rows={14}
              value={network.yaml}
              spellCheck={false}
              onChange={(e) => setNetwork({ mode: 'raw', yaml: e.target.value })}
            />
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {tx('network.rawExample', {
                link: (
                  <button
                    onClick={() =>
                      void window.autoinstall.openExternal('https://netplan.io/reference')
                    }
                    className="ml-1 text-sky-700 underline-offset-2 hover:underline dark:text-sky-400"
                  >
                    {t('network.netplanReference')}
                  </button>
                ),
              })}
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('network.detailsInactive')}
          </p>
        )}
      </Disclosure>
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
        <Field label={t('network.interfaceName')} hint={t('network.interfaceNameHint')}>
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
        <Field label={t('network.macAddress')} hint={t('network.macAddressHint')}>
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
