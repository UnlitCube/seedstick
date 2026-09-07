import { createDefaultBondNetwork, type NetworkConfig } from '@autoinstall/shared'
import { useStore } from '../store.js'
import { useT, useTx } from '../lib/i18n.js'
import { Badge, Callout, Card, Disclosure, RadioGroup, Switch, TextArea } from '../components/ui.js'
import { InterfacePicker, StaticAddressFields } from './sections/NetworkFields.js'
import { BondNetworkSection } from './sections/BondNetwork.js'

type Mode = NetworkConfig['mode']

/**
 * 「詳しい設定」の中が既定から変わっている件数。
 *
 * ここに入っているのは**生の netplan 上書きだけ**なので 0 か 1 になる。
 * `createDefaultProfile()` の network は `{mode:'installer-default'}` で、
 * 生の YAML は raw モードのときにしか存在しない。だから「raw であること」が
 * そのまま「既定から変わっている」になる。
 *
 * bond もここでは数えない。**bond の設定は折りたたみの外に全部出ている**ので、
 * ここで数えると件数と中身が食い違う（固定 IP と同じ扱い）。
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
      case 'bond':
        // 既定の `target` は `any`（＝単一 NIC の選択なし）。ここで直前のモードの
        // 選択を持ち込むと、**利用者が何もしていないのに**「この指定は使われません」の
        // 警告が出る状態になる。持ち込まないので警告も出ない。
        // 保存済みプロファイルに残っていた `target` は、bond の画面から消せる。
        setNetwork(createDefaultBondNetwork())
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
              value: 'bond',
              label: t('network.modeBond'),
              description: t('network.modeBondHint'),
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
          <StaticAddressFields
            value={network}
            onChange={(patch) => setNetwork({ ...network, ...patch })}
          />
        </Card>
      )}

      {/*
        bond。束ねる NIC・束ね方・アドレスはすべてここ（折りたたみの外）に出す。
        「どの NIC が束ねられるか」は畳んだまま気づけないと困る設定なので、
        固定 IP と同じく表に置く。
      */}
      {network.mode === 'bond' && (
        <BondNetworkSection value={network} onChange={(next) => setNetwork(next)} />
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
