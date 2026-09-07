import { Plus, Trash2 } from 'lucide-react'
import {
  BOND_ADDRESSING_CHOICES,
  BOND_LACP_RATE_CHOICES,
  BOND_MODE_CHOICES,
  BOND_MODES,
  bondNeedsSwitchConfig,
  bondUsesHashPolicy,
  bondUsesLacpRate,
  createDefaultBondNetwork,
  type BondAddressing,
  type BondLacpRate,
  type BondMember,
  type BondMode,
  type BondNetworkConfig,
  type BondParameters,
  type InterfaceSelector,
} from '@autoinstall/shared'
import { useT } from '../../lib/i18n.js'
import { Button, Callout, Card, Field, Select, Switch, TextInput, useDraft } from '../../components/ui.js'
import { InterfacePicker, StaticAddressFields } from './NetworkFields.js'

// NIC のボンディングの画面。型・生成・検証・移行は `@autoinstall/shared` の
// `bond.ts` / `generate-bond.ts` / `validate.ts` にあり、ここは**入力だけ**を持つ。
//
// この画面の通しの方針（3 か所で同じ規則を使う）:
//
//   **いまの設定で効かない項目は、値が空なら隠す。値が入っていたら出す。**
//
// 隠しっぱなしにすると、保存済みプロファイルに入っていた値を**消せなくなる**
// （検証は「効きません」と言い続けるのに、直す先が画面に無い。落とし穴 61 / 66）。
// かといって常に出すと、関係のない設定が並んで「どれが効くのか」が分からない。
// 対象は 3 つ: `lacp-rate` / `transmit-hash-policy` / 単一 NIC の `target`。
// 出したときは、その場に**なぜ効かないか**を出す（落とし穴 67。文言は検証と同じキーを使い、
// 画面と検証で言うことを 1 つにする）。
//
// **黙って既定に戻さない**（落とし穴 50）。読めない値（手で編集された JSON から届く）は
// 選択肢に**その値自身を足して**表示し、検証と同じ文言で「使えません」と伝える。
// 選び直せば直る。勝手に既定へ差し替えると、YAML が別のモードで組まれる。

const DEFAULT_PARAMETERS = createDefaultBondNetwork().parameters

/** `member-3` の形の内部 ID から番号を取る。判定用の正規表現に `/g` を付けない（落とし穴 63）。 */
const MEMBER_ID_RE = /^member-(\d+)$/

/**
 * 新しいメンバー行の内部 ID。
 *
 * `crypto.randomUUID()` を使わない。この ID はプロファイル JSON の中でしか
 * 意味を持たない（netplan に出るデバイス名は `bondMemberKeys()` が別に発番する）ので、
 * **その配列の中で一意**であれば十分で、既存の番号の続きにしたほうが読んで分かる。
 * 既存の ID と衝突しないことは、作ったあとに必ず確かめる。
 */
function nextMemberId(members: readonly (BondMember | null | undefined)[]): string {
  const used = new Set<string>()
  let next = 1
  for (const m of members) {
    const id = typeof m?.id === 'string' ? m.id : ''
    if (id) used.add(id)
    const match = MEMBER_ID_RE.exec(id)
    const n = match ? Number(match[1]) : Number.NaN
    if (Number.isSafeInteger(n) && n >= next) next = n + 1
  }
  while (used.has(`member-${next}`)) next += 1
  return `member-${next}`
}

/**
 * プロファイル JSON から来た `selector` を、画面が扱える形にする。
 *
 * 読めないときに `any`（すべての有線 LAN）へ落とさない。`any` は
 * 「どの NIC が束ねられるか分からない」指定で、管理用に残したい NIC まで
 * 巻き込む。空欄にして入力を促す（`migrate.ts` の `readBondNetwork` と同じ判断）。
 */
function readSelector(value: unknown): InterfaceSelector {
  if (typeof value === 'object' && value !== null) {
    const v = value as { kind?: unknown; name?: unknown; macaddress?: unknown }
    if (v.kind === 'any') return { kind: 'any' }
    if (v.kind === 'name') return { kind: 'name', name: typeof v.name === 'string' ? v.name : '' }
    if (v.kind === 'mac') {
      return { kind: 'mac', macaddress: typeof v.macaddress === 'string' ? v.macaddress : '' }
    }
  }
  return { kind: 'name', name: '' }
}

/** 選択肢に無い値が入っていたら、その値自身を選択肢の先頭に足す（表示が嘘にならないように）。 */
function withUnknown(
  options: { value: string; label: string }[],
  current: string,
): { value: string; label: string }[] {
  return options.some((o) => o.value === current)
    ? options
    : [{ value: current, label: current }, ...options]
}

export function BondNetworkSection({
  value,
  onChange,
}: {
  value: BondNetworkConfig
  onChange: (next: BondNetworkConfig) => void
}): React.JSX.Element {
  const t = useT()

  // 手で編集されたプロファイルは実際に届く（落とし穴 23 / 30）。
  // `typeof null === 'object'` なので、触る前に必ず形を確かめる。
  const params = (typeof value.parameters === 'object' && value.parameters !== null
    ? value.parameters
    : {}) as Partial<BondParameters>
  const rawMode = typeof params.mode === 'string' ? params.mode : DEFAULT_PARAMETERS.mode
  const knownMode = (BOND_MODES as readonly string[]).includes(rawMode)
  // 効く／効かないの判定は「読めるモードのとき」だけ。読めない値のときは
  // どちらとも言えないので、値が入っている欄は出したままにする。
  const mode = rawMode as BondMode
  const lacpRate = typeof params.lacpRate === 'string' ? params.lacpRate : ''
  const hashPolicy =
    typeof params.transmitHashPolicy === 'string' ? params.transmitHashPolicy : ''
  const mii =
    typeof params.miiMonitorInterval === 'number'
      ? params.miiMonitorInterval
      : DEFAULT_PARAMETERS.miiMonitorInterval
  const members = Array.isArray(value.members) ? value.members : []
  const addressing = typeof value.addressing === 'string' ? value.addressing : 'dhcp'
  const target = readSelector(value.target)

  // 数値の欄も下書きを通す（落とし穴 58 の数値版）。`value={String(n)}` にすると
  // 全部消した瞬間に `0` が書き戻され、「100 を 200 に直す」ができない。
  // `type="number"` にしないのは、下書きに残る途中の文字列（空文字や `1e`）を
  // ブラウザが勝手に捨てるため。数字キーパッドは `inputMode` で出す。
  const miiDraft = useDraft<number>(
    mii,
    (n) => (Number.isFinite(n) ? String(n) : ''),
    (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return 0
      const n = Number(trimmed)
      return Number.isFinite(n) ? n : 0
    },
  )

  const setParameters = (patch: Partial<BondParameters>): void => {
    onChange({
      ...value,
      // 欠けているキーだけを補う。**読めないモードはそのまま残す**
      // （既定へ差し替えると、利用者の知らないモードで黙って組まれる）。
      parameters: {
        mode,
        lacpRate: lacpRate as BondLacpRate,
        miiMonitorInterval: mii,
        transmitHashPolicy: hashPolicy,
        ...patch,
      },
    })
  }

  const setMember = (index: number, selector: InterfaceSelector): void => {
    onChange({
      ...value,
      members: members.map((m, i) =>
        i === index ? { id: memberKey(m, i, members), selector } : m,
      ),
    })
  }

  const removeMember = (index: number): void => {
    // 添字で消す。`filter` した配列の添字で元の配列を引かない（落とし穴 48）が、
    // ここは**描いているのと同じ配列**を同じ添字で扱うのでずれない。
    onChange({ ...value, members: members.filter((_, i) => i !== index) })
  }

  const addMember = (): void => {
    onChange({
      ...value,
      members: [...members, { id: nextMemberId(members), selector: { kind: 'name', name: '' } }],
    })
  }

  return (
    <>
      <Card title={t('network.bondTitle')}>
        <Field label={t('network.bondName')} hint={t('network.bondNameHint')} required>
          {(id) => (
            <TextInput
              id={id}
              value={typeof value.name === 'string' ? value.name : ''}
              spellCheck={false}
              placeholder="bond0"
              onChange={(e) => onChange({ ...value, name: e.target.value })}
            />
          )}
        </Field>
        <div className="mt-4">
          <Switch
            checked={value.optional === true}
            onChange={(optional) => onChange({ ...value, optional })}
            label={t('network.bondOptional')}
            description={t('network.optionalHint')}
          />
        </div>
        {/*
          bond にすると、上の「対象のネットワークカード」（単一 NIC の選択）は使われない。
          そのことは**必ず画面に出す**。出さないと、その欄を設定したまま bond にした人が
          「1 枚だけを bond にした」と誤解する。
        */}
        <div className="mt-4">
          <Callout tone="info">{t('network.bondTargetInactive')}</Callout>
        </div>
        {target.kind !== 'any' && (
          // 値が残っているときだけ出す。検証は「使われません」と warning を出すので、
          // 直す先が画面に無いと消せない警告になる（落とし穴 66）。
          <div className="mt-4 space-y-3">
            <InterfacePicker
              value={target}
              onChange={(next) => onChange({ ...value, target: next })}
            />
            <Callout tone="warning">{t('validate.bondTargetIgnored')}</Callout>
          </div>
        )}
      </Card>

      <Card title={t('network.bondMembers')} description={t('network.bondMembersHint')}>
        <ul className="space-y-3">
          {members.map((m, i) => {
            const selector = readSelector(m?.selector)
            return (
              <li
                key={memberKey(m, i, members)}
                className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <InterfacePicker
                      label={t('network.bondMember', { n: i + 1 })}
                      value={selector}
                      onChange={(next) => setMember(i, next)}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    aria-label={t('network.bondRemoveMember')}
                    onClick={() => removeMember(i)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
                {selector.kind === 'any' && (
                  <div className="mt-3">
                    <Callout tone="warning">{t('validate.bondMemberAny', { n: i + 1 })}</Callout>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        <div className="mt-3">
          <Button onClick={addMember}>
            <Plus className="size-4" aria-hidden />
            {t('network.bondAddMember')}
          </Button>
        </div>
        {members.length < 2 && (
          <div className="mt-3">
            <Callout tone="warning">
              {t('validate.bondNeedsTwoMembers', { count: members.length })}
            </Callout>
          </div>
        )}
      </Card>

      <Card title={t('network.bondParameters')}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('network.bondMode')} hint={t('network.bondModeHint')}>
            {(id) => (
              <Select
                id={id}
                value={rawMode}
                onChange={(next) => setParameters({ mode: next as BondMode })}
                options={withUnknown(
                  BOND_MODE_CHOICES.map((c) => ({ value: c.value as string, label: t(c.label) })),
                  rawMode,
                )}
              />
            )}
          </Field>
          <Field label={t('network.bondMiiMonitor')} hint={t('network.bondMiiMonitorHint')}>
            {(id) => (
              <TextInput
                id={id}
                value={miiDraft.text}
                inputMode="numeric"
                spellCheck={false}
                placeholder="100"
                onChange={(e) =>
                  setParameters({ miiMonitorInterval: miiDraft.change(e.target.value) })
                }
              />
            )}
          </Field>
        </div>

        {!knownMode && (
          <div className="mt-4">
            <Callout tone="danger">{t('validate.bondModeInvalid', { value: rawMode })}</Callout>
          </div>
        )}
        {knownMode && bondNeedsSwitchConfig(mode) && (
          // 「冗長化のつもりで選んだらリンクが上がらない」を防ぐ。
          // 802.3ad はスイッチ側で LACP を設定しておかないと通信できない。
          <div className="mt-4">
            <Callout tone="info">{t('validate.bondModeNeedsSwitchConfig', { mode })}</Callout>
          </div>
        )}
        {mii === 0 && (
          <div className="mt-4">
            <Callout tone="warning">{t('validate.bondMiiMonitorDisabled')}</Callout>
          </div>
        )}

        {(!knownMode || bondUsesLacpRate(mode) || lacpRate !== '') && (
          <div className="mt-4 space-y-3">
            <Field label={t('network.bondLacpRate')} hint={t('network.bondLacpRateHint')}>
              {(id) => (
                <Select
                  id={id}
                  value={lacpRate}
                  onChange={(next) => setParameters({ lacpRate: next as BondLacpRate })}
                  options={withUnknown(
                    BOND_LACP_RATE_CHOICES.map((c) => ({
                      value: c.value as string,
                      label: t(c.label),
                    })),
                    lacpRate,
                  )}
                />
              )}
            </Field>
            {knownMode && lacpRate !== '' && !bondUsesLacpRate(mode) && (
              <Callout tone="warning">{t('validate.bondLacpRateIgnored', { mode })}</Callout>
            )}
          </div>
        )}

        {(!knownMode || bondUsesHashPolicy(mode) || hashPolicy !== '') && (
          <div className="mt-4 space-y-3">
            <Field label={t('network.bondHashPolicy')} hint={t('network.bondHashPolicyHint')}>
              {(id) => (
                <TextInput
                  id={id}
                  value={hashPolicy}
                  spellCheck={false}
                  placeholder="layer3+4"
                  onChange={(e) => setParameters({ transmitHashPolicy: e.target.value })}
                />
              )}
            </Field>
            {knownMode && hashPolicy !== '' && !bondUsesHashPolicy(mode) && (
              <Callout tone="warning">{t('validate.bondHashPolicyIgnored', { mode })}</Callout>
            )}
          </div>
        )}
      </Card>

      <Card title={t('network.bondAddressing')} description={t('network.bondAddressingHint')}>
        <Field label={t('network.bondAddressing')}>
          {(id) => (
            <Select
              id={id}
              value={addressing}
              onChange={(next) => onChange({ ...value, addressing: next as BondAddressing })}
              options={withUnknown(
                BOND_ADDRESSING_CHOICES.map((c) => ({
                  value: c.value as string,
                  label: t(c.label),
                })),
                addressing,
              )}
            />
          )}
        </Field>
        {!(BOND_ADDRESSING_CHOICES as readonly { value: string }[]).some(
          (c) => c.value === addressing,
        ) && (
          <div className="mt-4">
            <Callout tone="danger">
              {t('validate.bondAddressingInvalid', { value: addressing })}
            </Callout>
          </div>
        )}
        {addressing === 'static' && (
          <div className="mt-4">
            {/*
              固定 IP の入力は単一 NIC と**同じ部品**を使う（写しを作らない）。
              アドレスは bond 側に付く。メンバーの NIC には付けない。
            */}
            <StaticAddressFields
              value={{
                address: typeof value.address === 'string' ? value.address : '',
                gateway: typeof value.gateway === 'string' ? value.gateway : '',
                nameservers: Array.isArray(value.nameservers) ? value.nameservers : [],
                searchDomains: Array.isArray(value.searchDomains) ? value.searchDomains : [],
              }}
              onChange={(patch) => onChange({ ...value, ...patch })}
            />
          </div>
        )}
      </Card>
    </>
  )
}

/**
 * React の key と、書き戻すときの内部 ID。
 *
 * ID が読めない行（手で編集された JSON）でも描けるようにする。
 * その行を編集したときは、**そこで一意な ID を発番して直す**。
 */
function memberKey(
  member: BondMember | null | undefined,
  index: number,
  members: readonly (BondMember | null | undefined)[],
): string {
  const id = typeof member?.id === 'string' ? member.id : ''
  if (id) return id
  return `${nextMemberId(members)}-${index}`
}
