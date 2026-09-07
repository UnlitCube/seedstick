import type { InterfaceSelector } from '@autoinstall/shared'
import { useT } from '../../lib/i18n.js'
import { Callout, Field, Select, TextInput, useListDraft } from '../../components/ui.js'

// ネットワークの画面で **2 か所以上から使う入力欄**だけを置く。
//
// もともと `NetworkStep.tsx` の中にあった `InterfacePicker` と固定 IP の 4 欄を
// ここへ出したのは、bond でも同じものが要るため。**写しを作らない**
// （検証側が「固定 IP の検査は単一 NIC と bond で同じ関数を通す」としたのと同じ理由で、
// 写しを持つと片方だけ直る）。移しただけで、入力欄の中身は変えていない
// —— placeholder も `192.168.1.10/24` のまま（`.e2e/` が完全一致で探している）。

/**
 * どの NIC かの指定（`InterfaceSelector`）。
 *
 * `label` を渡せるのは bond のため。bond のメンバー行では
 * 「ネットワークカード 1」「ネットワークカード 2」と番号で呼ぶので、
 * 行ごとに違う見出しが要る。省略すれば今までどおり「ネットワークカード」。
 */
export function InterfacePicker({
  value,
  onChange,
  label,
}: {
  value: InterfaceSelector
  onChange: (value: InterfaceSelector) => void
  label?: string
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="space-y-3">
      <Field label={label ?? t('network.interface')}>
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

/** 固定 IP の 4 欄が扱う値。単一 NIC の `static` と bond の `addressing: 'static'` で共有する。 */
export interface StaticAddressValue {
  readonly address: string
  readonly gateway: string
  readonly nameservers: readonly string[]
  readonly searchDomains: readonly string[]
}

/**
 * 固定 IP の入力（アドレス・ゲートウェイ・DNS・検索ドメイン）。
 *
 * カンマ区切りの欄は `useListDraft` を通す。正規化した配列から `value` を作ると
 * **区切り文字を打った瞬間に消える**（落とし穴 58）。
 * 下書きはこのコンポーネントが持つので、**モードを変えて描画されなくなると消える**が、
 * 確定した値は `change()` の時点でプロファイルに入っているので失われない。
 */
export function StaticAddressFields({
  value,
  onChange,
}: {
  value: StaticAddressValue
  onChange: (patch: Partial<StaticAddressValue>) => void
}): React.JSX.Element {
  const t = useT()
  const nameserversDraft = useListDraft(value.nameservers, ',')
  const searchDomainsDraft = useListDraft(value.searchDomains, ',')

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('network.address')} hint={t('network.addressHint')} required>
          {(id) => (
            <TextInput
              id={id}
              value={value.address}
              spellCheck={false}
              placeholder="192.168.1.10/24"
              onChange={(e) => onChange({ address: e.target.value })}
            />
          )}
        </Field>
        <Field label={t('network.gateway')} required>
          {(id) => (
            <TextInput
              id={id}
              value={value.gateway}
              spellCheck={false}
              placeholder="192.168.1.1"
              onChange={(e) => onChange({ gateway: e.target.value })}
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
              onChange={(e) => onChange({ nameservers: nameserversDraft.change(e.target.value) })}
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
                onChange({ searchDomains: searchDomainsDraft.change(e.target.value) })
              }
            />
          )}
        </Field>
      </div>
      <div className="mt-4">
        <Callout tone="warning">{t('network.staticCloudInitNote')}</Callout>
      </div>
    </>
  )
}
