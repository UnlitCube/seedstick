import { ArrowDown, ArrowUp, HardDrive, Layers, Plus, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import {
  RAID_DISK_USAGES,
  RAID_DISK_USAGE_CHOICES,
  RAID_LEVEL_CHOICES,
  RAID_MIN_DEVICES,
  RAID_ROLES,
  RAID_ROLE_CHOICES,
  RAID_ROOT_FSTYPE_CHOICES,
  buildRaidPlan,
  createDefaultRaidStorage,
  createRaidArray,
  createRaidDisk,
  isValidSizeSpec,
  raidDiskMakesEsp,
  raidDiskUsageOf,
  validateProfile,
  type RaidArray,
  type RaidArrayRole,
  type RaidDisk,
  type RaidDiskUsage,
  type RaidLevel,
  type RaidRootFstype,
  type RaidStorageConfig,
  type ValidationIssue,
} from '@autoinstall/shared'
import { useStore } from '../../store.js'
import { useT, useTl } from '../../lib/i18n.js'
import { Badge, Button, Callout, Card, Field, Select, Switch, TextInput } from '../../components/ui.js'
import { DiskMatchPicker, describeDiskMatchShort, isEmptyDiskMatch } from './DiskMatchPicker.js'

// RAID + LVM のディスク構成を編集する画面。
//
// **表に出す**（折りたたみに入れない）。ここが「どのディスクが消えるか」を決める場所で、
// しかも RAID は台数のぶんだけ被害が大きい（落とし穴 65）。
// 折りたたみに入れると、要約がその中身を見ていない限り「既定のまま」に見える
// （6 巡目の high はまさにそれ）。
//
// **指摘は自分で計算しない。** 台数不足・重複・曖昧な指定・消える台数は
// `validateProfile()` が既に持っている。ここで同じ判定を書くと、
// 「画面は緑なのに確認画面で赤」（あるいはその逆）が必ず生まれる。
// 指摘の `field` はセクション・行の単位で振られている
// （`storage.raid.disks[2]` / `storage.raid.arrays[0].name`）ので、
// **その行の下にそのまま出す**。
// → この結び付きが切れると行の指摘が丸ごと消えるので、テストで固定してある。

const F = 'storage.raid'

/** `typeof null === 'object'`（落とし穴 30）。配列も弾く。 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 手で編集された JSON では配列ですらないことがある（落とし穴 23 / 31）。 */
function rowsOf<T>(value: unknown): readonly T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function idsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

const trimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * `<select>` から返る文字列を、**知っている値だけ**に絞って書き戻す。
 *
 * `v as RaidDiskUsage` のような素通しをすると、DOM をいじった値や
 * 手で編集された JSON の値がそのままプロファイルに入り、
 * 生成側 (`raidDiskUsageOf`) は既定に読むのに保存された値だけが別物、という
 * 「画面と保存が食い違う」状態になる（落とし穴 22 / 49 と同じ入口）。
 */
function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/**
 * 中身が消えるディスクの台数。
 *
 * 数え方は検証と**同じ関数から**導く（`buildRaidPlan` は「何にも使わないディスクには
 * `disk` アクションを出さない」を知っている唯一の場所）。
 * ここで独自に数えると、画面の「4 台消えます」と実際に消える台数がずれる。
 */
export function raidWipeCount(raid: RaidStorageConfig): number {
  const total = rowsOf<RaidDisk>(raid?.disks).length
  if (total === 0) return 0
  return total - buildRaidPlan(raid).unusedDiskIndexes.length
}

/** 使われていない内部 ID を 1 つ作る。**添字ではなく ID で参照する**ため（落とし穴 48）。 */
function freshDiskId(disks: readonly RaidDisk[]): string {
  const used = new Set(disks.map((d) => trimmed(d?.id)))
  for (let n = 1; ; n++) {
    const id = `d${n}`
    if (!used.has(id)) return id
  }
}

function freshArrayId(arrays: readonly RaidArray[]): string {
  const used = new Set(arrays.map((a) => trimmed(a?.id)))
  for (let n = 1; ; n++) {
    const id = `a${n}`
    if (!used.has(id)) return id
  }
}

function freshArrayName(arrays: readonly RaidArray[]): string {
  const used = new Set(arrays.map((a) => trimmed(a?.name)))
  for (let n = 0; ; n++) {
    const name = `md${n}`
    if (!used.has(name)) return name
  }
}

function moved<T>(list: readonly T[], index: number, delta: number): T[] {
  const next = [...list]
  const to = index + delta
  if (to < 0 || to >= next.length) return next
  const [item] = next.splice(index, 1)
  next.splice(to, 0, item as T)
  return next
}

/** 検証の指摘をその場に出す。重い順（error → warning → info）に並べる。 */
const SEVERITY_RANK: Record<string, number> = { error: 0, warning: 1, info: 2 }

function IssueList({ issues }: { issues: readonly ValidationIssue[] }): React.JSX.Element | null {
  const tl = useTl()
  if (issues.length === 0) return null
  const sorted = [...issues].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3),
  )
  return (
    <div className="space-y-2">
      {sorted.map((issue, i) => (
        <Callout
          key={`${issue.field}-${i}`}
          tone={issue.severity === 'error' ? 'danger' : issue.severity === 'warning' ? 'warning' : 'info'}
        >
          {tl(issue.text)}
        </Callout>
      ))}
    </div>
  )
}

export function RaidStorageSection({
  raid: given,
  onChange,
}: {
  raid: RaidStorageConfig
  onChange: (next: RaidStorageConfig) => void
}): React.JSX.Element {
  const t = useT()
  const profile = useStore((s) => s.profile)
  // 手で編集された JSON では `raid` ごと欠けていることがある（落とし穴 23 / 30）。
  // 型は `RaidStorageConfig` でも、届く値がそうだとは限らない。
  const raid: RaidStorageConfig = useMemo(
    () => (isObject(given) ? given : createDefaultRaidStorage()),
    [given],
  )

  // **画面が見せている構成をそのまま検証する。**
  // `storage.raid` が欠けたプロファイルでは、上のとおり画面は既定を見せる。
  // その状態で素のプロファイルを渡すと、指摘は「見せていない構成」に対するものになり、
  // しかも `validateProfile` は `raid.disks` を直接見るのでそこで落ちる
  // （＝検証は壊れた設定でも投げない、という契約から外れている。
  //   `validate.ts` 側も直すべき ——担当へ申し送り済み）。
  //
  // try/catch では包まない。契約が破れたときに指摘が黙って全部消えるほうが危ない
  // （落とし穴 50）。落ちるならステップの Error Boundary に出したほうが気づける。
  const issues = useMemo(() => {
    const s = profile.storage
    const target =
      s.mode === 'raid' && s.raid !== raid ? { ...profile, storage: { ...s, raid } } : profile
    return validateProfile(target).issues
  }, [profile, raid])
  const at = (field: string): ValidationIssue[] => issues.filter((i) => i.field === field)
  const under = (prefix: string): ValidationIssue[] =>
    issues.filter((i) => i.field === prefix || i.field.startsWith(`${prefix}.`))

  const disks = rowsOf<RaidDisk>(raid.disks)
  const arrays = rowsOf<RaidArray>(raid.arrays)
  // 配列が指せるディスク（ID が読めた行だけ）。同じ ID が 2 行にあるときは
  // 生成側と同じく**先に出てきたほう**を採る（後勝ちにすると参照先が黙って変わる）。
  const knownIds = new Set<string>()
  for (const d of disks) {
    const id = trimmed(isObject(d) ? d.id : undefined)
    if (id) knownIds.add(id)
  }

  // 欠けているキーはここで埋める（`espSize` が無いまま保存すると、生成側の既定に
  // 頼ることになり、画面に出ている値と保存された値が食い違う）。
  const patch = (over: Partial<RaidStorageConfig>): void =>
    onChange({ ...createDefaultRaidStorage(), ...raid, ...over })

  // --- ディスク -------------------------------------------------------------
  const addDisk = (): void => patch({ disks: [...disks, createRaidDisk(freshDiskId(disks))] })

  /**
   * 行の編集は**添字**で行う（ID は空や重複がありうるので、行を一意に指せない）。
   * 配列からの参照だけを ID で行う。この 2 つを取り違えると、
   * ID が重複したプロファイルで別の行が書き換わる。
   */
  const patchDisk = (index: number, over: Partial<RaidDisk>): void => {
    const next = disks.map((d, i) => (i === index ? { ...(d as RaidDisk), ...over } : d))
    patch({ disks: next })
  }

  const removeDisk = (index: number): void => {
    const nextDisks = disks.filter((_, i) => i !== index)
    // 消えた ID を指したままにすると、配列の側は
    // 「存在しないディスクを指しています」の error になり、
    // しかもチェックボックスは現存する行しか出さないので**画面から直せない**。
    // 残った行に同じ ID があるなら参照は生かす（重複 ID のプロファイル対策）。
    const remaining = new Set(nextDisks.map((d) => trimmed(isObject(d) ? d.id : undefined)))
    const nextArrays = arrays.map((a) =>
      isObject(a)
        ? {
            ...(a as RaidArray),
            diskIds: idsOf((a as RaidArray).diskIds).filter((id) => remaining.has(id)),
            spareDiskIds: idsOf((a as RaidArray).spareDiskIds).filter((id) => remaining.has(id)),
          }
        : a,
    )
    patch({ disks: nextDisks, arrays: nextArrays })
  }

  // 並べ替えても配列の参照は ID なので壊れない。順序は
  // 「1 台目の起動ディスク」（その ESP に `grub_device` が付く）を決めるので意味がある。
  const moveDisk = (index: number, delta: number): void => patch({ disks: moved(disks, index, delta) })

  // --- 配列 -----------------------------------------------------------------
  const addArray = (): void => {
    // root を置く場所（LVM の PV）が無い構成は成立しないので、1 つ目はそちらにする。
    const role = arrays.some((a) => isObject(a) && a.role === 'lvm-pv') ? 'boot' : 'lvm-pv'
    patch({ arrays: [...arrays, createRaidArray(freshArrayId(arrays), freshArrayName(arrays), role)] })
  }

  const patchArray = (index: number, over: Partial<RaidArray>): void => {
    const next = arrays.map((a, i) => (i === index ? { ...(a as RaidArray), ...over } : a))
    patch({ arrays: next })
  }

  const removeArray = (index: number): void => patch({ arrays: arrays.filter((_, i) => i !== index) })
  const moveArray = (index: number, delta: number): void =>
    patch({ arrays: moved(arrays, index, delta) })

  const rootFixed = trimmed(raid.rootSize).length > 0
  const espCount = disks.filter((d) => raidDiskMakesEsp(d)).length

  return (
    <div className="space-y-5">
      {/* --- ディスク --- */}
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <HardDrive className="size-4" aria-hidden />
            {t('storage.raidDisksTitle')}
          </span>
        }
        description={t('storage.raidDisksHint')}
        tone="danger"
      >
        <div className="space-y-3">
          <IssueList issues={at(`${F}.disks`)} />
          {disks.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('storage.raidDisksEmpty')}</p>
          ) : (
            <ul className="space-y-3">
              {disks.map((disk, i) => (
                // key は添字。ID は空や重複がありうるので一意にできず、
                // この行の中に自前の状態（下書き）を持つ部品も無い。
                <li
                  key={i}
                  // 行を機械から引くための目印。表示文言で探すと、訳文を変えるたびに
                  // テストと `.e2e` が壊れる（`Disclosure` の `data-disclosure` と同じ理由）。
                  data-raid-disk={i}
                  className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                >
                  {!isObject(disk) ? (
                    <div className="space-y-2">
                      <Callout tone="danger">{t('storage.raidRowUnreadable')}</Callout>
                      <Button variant="ghost" onClick={() => removeDisk(i)}>
                        <Trash2 className="size-4" aria-hidden />
                        {t('common.delete')}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                          {t('storage.raidDiskHeading', { n: i + 1 })}
                          <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                            {describeDiskMatchShort(t, (disk as RaidDisk).match)}
                          </span>
                          {isEmptyDiskMatch((disk as RaidDisk).match) && (
                            <Badge tone="danger">{t('storage.raidDiskIncomplete')}</Badge>
                          )}
                          {/*
                            「丸ごと」はパーティションテーブルごと消える指定なので、
                            一覧を眺めただけで分かるようにする（落とし穴 65）。
                          */}
                          {raidDiskUsageOf(disk) === 'whole' && (
                            <Badge tone="warning">{t('storage.raidDiskWholeBadge')}</Badge>
                          )}
                          {/*
                            バッジは**実際に ESP が作られるか**で出す（`esp === true` では出さない）。
                            丸ごとのディスクには作られないので、スイッチが入っていても
                            「起動用」と出すのは嘘になる。判定は生成側と同じ関数から採る。
                          */}
                          {raidDiskMakesEsp(disk) && (
                            <Badge tone="info">{t('storage.raidDiskBootBadge')}</Badge>
                          )}
                        </p>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            variant="ghost"
                            aria-label={t('common.moveUp')}
                            disabled={i === 0}
                            onClick={() => moveDisk(i, -1)}
                          >
                            <ArrowUp className="size-4" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            aria-label={t('common.moveDown')}
                            disabled={i === disks.length - 1}
                            onClick={() => moveDisk(i, 1)}
                          >
                            <ArrowDown className="size-4" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            aria-label={t('common.delete')}
                            onClick={() => removeDisk(i)}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </div>
                      </div>
                      {/*
                        指定方法の注意書きはこの部品に出させない。
                        RAID では「選んだディスクが全部消える」ので文面が違い、
                        検証（`validate.raidMemberMatchNotSpecific`）が
                        その行の下に出る（下の IssueList）。
                      */}
                      <DiskMatchPicker
                        value={(disk as RaidDisk).match}
                        onChange={(match) => patchDisk(i, { match })}
                        showKindNotes={false}
                      />
                      {/*
                        使い方（パーティションを切る / 丸ごと 1 メンバー）。
                        **ディスク指定の下に置く**——上に置くと、この行の最初の
                        `<select>` が指定方法ではなくこちらになる。
                      */}
                      <Field label={t('storage.raidDiskUsage')} hint={t('storage.raidDiskUsageHint')}>
                        {(id) => (
                          <Select
                            id={id}
                            value={raidDiskUsageOf(disk)}
                            onChange={(v) => {
                              const usage = oneOf<RaidDiskUsage>(v, RAID_DISK_USAGES, 'partitions')
                              // 丸ごとに変えたら ESP も落とす。**黙ってではなく、
                              // 目の前でスイッチが切れる**（「起動用」のバッジも消える）ので
                              // 落とし穴 50 の「黙って既定に戻す」には当たらない。
                              // 残すと、NVMe を 2 本足しただけで解除の当てのない error が
                              // 2 件出る（新しい行の既定は `esp: true`）。
                              // スイッチ自体は**丸ごとでも押せるまま**にしてある。
                              // 手で編集した `{usage:'whole', esp:true}` の error を
                              // 画面から解除できなくしないため（落とし穴 66）。
                              patchDisk(i, usage === 'whole' ? { usage, esp: false } : { usage })
                            }}
                            options={RAID_DISK_USAGE_CHOICES.map((c) => ({
                              value: c.value,
                              label: t(c.label),
                            }))}
                          />
                        )}
                      </Field>
                      {/*
                        **丸ごとでも ESP のスイッチを隠さない・無効にしない**（落とし穴 66）。
                        `esp: true` のまま保存されたプロファイルを開いたときに、
                        隠すと `validate.raidWholeDiskEsp` の error を解除する操作が
                        画面から消え、書き込みボタンが理由も分からず沈黙する。
                        代わりに「置き場所が無い」ことを説明に出す。
                      */}
                      <Switch
                        checked={(disk as RaidDisk).esp === true}
                        onChange={(esp) => patchDisk(i, { esp })}
                        label={t('storage.raidDiskBoot')}
                        description={
                          raidDiskUsageOf(disk) === 'whole'
                            ? t('storage.raidDiskEspOnWhole')
                            : t('storage.raidDiskBootHint')
                        }
                      />
                      <IssueList issues={under(`${F}.disks[${i}]`)} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {/*
            **ESP が何台に作られるか**をその場に出す。0 台だとインストールは
            通るのに起動しない、という一番気づきにくい失敗なので、
            確認画面まで待たせない（error 自体は上の IssueList に出る）。
            数え方は生成側と同じ `raidDiskMakesEsp` から採る
            ——ここで `d.esp` を数えると、丸ごとのディスクを 1 台と数えてしまう。
          */}
          {disks.length > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('storage.raidEspCount', { count: espCount })}
            </p>
          )}
          <div>
            <Button onClick={addDisk}>
              <Plus className="size-4" aria-hidden />
              {t('storage.raidAddDisk')}
            </Button>
          </div>
        </div>
      </Card>

      {/* --- 配列 --- */}
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <Layers className="size-4" aria-hidden />
            {t('storage.raidArraysTitle')}
          </span>
        }
        description={t('storage.raidArraysHint')}
      >
        <div className="space-y-3">
          <IssueList issues={at(`${F}.arrays`)} />
          {arrays.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('storage.raidArraysEmpty')}</p>
          ) : (
            <ul className="space-y-3">
              {arrays.map((array, j) => (
                <li
                  key={j}
                  data-raid-array={j}
                  className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                >
                  {!isObject(array) ? (
                    <div className="space-y-2">
                      <Callout tone="danger">{t('storage.raidRowUnreadable')}</Callout>
                      <Button variant="ghost" onClick={() => removeArray(j)}>
                        <Trash2 className="size-4" aria-hidden />
                        {t('common.delete')}
                      </Button>
                    </div>
                  ) : (
                    <ArrayRow
                      array={array as RaidArray}
                      index={j}
                      count={arrays.length}
                      disks={disks}
                      knownIds={knownIds}
                      issues={under(`${F}.arrays[${j}]`)}
                      onPatch={(over) => patchArray(j, over)}
                      onRemove={() => removeArray(j)}
                      onMove={(delta) => moveArray(j, delta)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          <div>
            <Button onClick={addArray}>
              <Plus className="size-4" aria-hidden />
              {t('storage.raidAddArray')}
            </Button>
          </div>
        </div>
      </Card>

      {/* --- LVM と root --- */}
      <Card title={t('storage.raidLvmTitle')} description={t('storage.raidLvmHint')}>
        <div className="space-y-3">
          <Field label={t('storage.raidVolumeGroup')}>
            {(id) => (
              <TextInput
                id={id}
                value={typeof raid.volumeGroup === 'string' ? raid.volumeGroup : ''}
                spellCheck={false}
                placeholder="vg0"
                onChange={(e) => patch({ volumeGroup: e.target.value })}
              />
            )}
          </Field>
          <IssueList issues={at(`${F}.volumeGroup`)} />
          <Field label={t('storage.raidRootName')}>
            {(id) => (
              <TextInput
                id={id}
                value={typeof raid.rootName === 'string' ? raid.rootName : ''}
                spellCheck={false}
                placeholder="root"
                onChange={(e) => patch({ rootName: e.target.value })}
              />
            )}
          </Field>
          <IssueList issues={at(`${F}.rootName`)} />
          <Field label={t('storage.raidRootSize')}>
            {(id) => (
              <Select
                id={id}
                value={rootFixed ? 'fixed' : 'rest'}
                onChange={(v) =>
                  // 「残り全部」へ戻すときは値も消す。残すと画面には出ないのに
                  // 大きさだけが残り、検証だけが「不正な大きさ」と言う状態になる（落とし穴 66）。
                  // 「指定する」を選んだときは空のままにしない
                  //  ——空は「残り全部」と同じ意味なので、選んだ結果が黙って無視される。
                  patch({ rootSize: v === 'fixed' ? trimmed(raid.rootSize) || '100G' : '' })
                }
                options={[
                  { value: 'rest', label: t('storage.raidRootSizeRest') },
                  { value: 'fixed', label: t('storage.raidRootSizeFixed') },
                ]}
              />
            )}
          </Field>
          {rootFixed && (
            <Field
              label={t('storage.raidRootSizeValue')}
              hint={t('storage.raidRootSizeHint')}
              error={isValidSizeSpec(trimmed(raid.rootSize)) ? undefined : t('adv.swapSizeHint')}
            >
              {(id) => (
                <TextInput
                  id={id}
                  value={typeof raid.rootSize === 'string' ? raid.rootSize : ''}
                  spellCheck={false}
                  placeholder="100G"
                  invalid={!isValidSizeSpec(trimmed(raid.rootSize))}
                  onChange={(e) => patch({ rootSize: e.target.value })}
                />
              )}
            </Field>
          )}
          <Field label={t('storage.raidRootFstype')}>
            {(id) => (
              <Select
                id={id}
                value={typeof raid.rootFstype === 'string' ? raid.rootFstype : 'ext4'}
                onChange={(v) => patch({ rootFstype: v as RaidRootFstype })}
                options={RAID_ROOT_FSTYPE_CHOICES.map((c) => ({
                  value: c.value,
                  label: t(c.label),
                }))}
              />
            )}
          </Field>
        </div>
      </Card>

      {/* --- 起動まわり --- */}
      <Card title={t('storage.raidBootTitle')} description={t('storage.raidBootHint')}>
        <div className="space-y-3">
          <Field
            label={t('storage.raidEspSize')}
            hint={t('storage.raidEspSizeHint')}
            error={isValidSizeSpec(trimmed(raid.espSize)) ? undefined : t('adv.swapSizeHint')}
          >
            {(id) => (
              <TextInput
                id={id}
                value={typeof raid.espSize === 'string' ? raid.espSize : ''}
                spellCheck={false}
                placeholder="512M"
                invalid={!isValidSizeSpec(trimmed(raid.espSize))}
                onChange={(e) => patch({ espSize: e.target.value })}
              />
            )}
          </Field>
          <Field
            label={t('storage.raidBootSize')}
            hint={t('storage.raidBootSizeHint')}
            error={isValidSizeSpec(trimmed(raid.bootSize)) ? undefined : t('adv.swapSizeHint')}
          >
            {(id) => (
              <TextInput
                id={id}
                value={typeof raid.bootSize === 'string' ? raid.bootSize : ''}
                spellCheck={false}
                placeholder="2G"
                invalid={!isValidSizeSpec(trimmed(raid.bootSize))}
                onChange={(e) => patch({ bootSize: e.target.value })}
              />
            )}
          </Field>
          <Switch
            checked={raid.mirrorBootloader === true}
            onChange={(mirrorBootloader) => patch({ mirrorBootloader })}
            label={t('storage.raidMirrorBootloader')}
            description={t('storage.raidMirrorBootloaderHint')}
          />
          <IssueList issues={at(`${F}.mirrorBootloader`)} />
        </div>
      </Card>
    </div>
  )
}

/** 配列 1 つぶんの行。 */
function ArrayRow({
  array,
  index,
  count,
  disks,
  knownIds,
  issues,
  onPatch,
  onRemove,
  onMove,
}: {
  array: RaidArray
  index: number
  count: number
  disks: readonly RaidDisk[]
  knownIds: ReadonlySet<string>
  issues: readonly ValidationIssue[]
  onPatch: (over: Partial<RaidArray>) => void
  onRemove: () => void
  onMove: (delta: number) => void
}): React.JSX.Element {
  const t = useT()
  const members = idsOf(array.diskIds)
  const spares = idsOf(array.spareDiskIds)
  // 読めない用途は既定 (`lvm-pv`) として**見せる**が、書き戻すのは操作したときだけ。
  const role: RaidArrayRole =
    typeof array.role === 'string' ? oneOf<RaidArrayRole>(array.role, RAID_ROLES, 'lvm-pv') : 'lvm-pv'
  const level: RaidLevel | undefined =
    typeof array.level === 'string' && array.level in RAID_MIN_DEVICES
      ? (array.level as RaidLevel)
      : undefined
  // 台数は検証と同じ数え方にする（**存在するディスクだけ**。スペアは数えない）。
  const have = members.filter((id) => knownIds.has(id)).length
  const need = level ? RAID_MIN_DEVICES[level] : 0
  const short = level !== undefined && have < need
  const minLine = level ? t('storage.raidLevelMin', { need, have }) : undefined

  /** 本体 → スペア → 使わない、の 3 状態。同じディスクを両方に入れさせない。 */
  const setMembership = (id: string, next: 'none' | 'device' | 'spare'): void => {
    onPatch({
      diskIds: next === 'device' ? [...members.filter((x) => x !== id), id] : members.filter((x) => x !== id),
      spareDiskIds:
        next === 'spare' ? [...spares.filter((x) => x !== id), id] : spares.filter((x) => x !== id),
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
          {t('storage.raidArrayHeading', { n: index + 1 })}
          <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
            {trimmed(array.name)}
          </span>
        </p>
        <div className="flex shrink-0 gap-1">
          <Button
            variant="ghost"
            aria-label={t('common.moveUp')}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="size-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            aria-label={t('common.moveDown')}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="size-4" aria-hidden />
          </Button>
          <Button variant="ghost" aria-label={t('common.delete')} onClick={onRemove}>
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      <Field label={t('storage.raidArrayName')} hint={t('storage.raidArrayNameHint')}>
        {(id) => (
          <TextInput
            id={id}
            value={typeof array.name === 'string' ? array.name : ''}
            spellCheck={false}
            placeholder="md0"
            onChange={(e) => onPatch({ name: e.target.value })}
          />
        )}
      </Field>

      {/*
        用途は 3 つ（`/boot` / LVM の PV / 作るだけ）。
        **選択肢の一覧と書き戻しの両方を `RAID_ROLES` から導く。**
        書き戻しを `v === 'boot' ? 'boot' : 'lvm-pv'` のように手で書くと、
        選択肢を足したときにここだけ古いまま残り、選んだ「作るだけ」が
        黙って `lvm-pv` に化ける（＝マウントしないつもりの配列に root が載る）。
        「作るだけ」はフォーマットもマウントもされないので、選んだその場で言う
        （検証の info は配列カードの先頭に出るだけで、どの行の話か分からない）。
      */}
      <Field
        label={t('storage.raidArrayRole')}
        hint={role === 'data' ? t('storage.raidRoleDataNote') : undefined}
      >
        {(id) => (
          <Select
            id={id}
            value={role}
            onChange={(v) => onPatch({ role: oneOf<RaidArrayRole>(v, RAID_ROLES, 'lvm-pv') })}
            options={RAID_ROLE_CHOICES.map((c) => ({ value: c.value, label: t(c.label) }))}
          />
        )}
      </Field>

      {/*
        **レベルごとの最小台数を画面に出す**（RAID10 は 4 台から）。
        足りないときは赤で出し、理由の文（検証の指摘）はこの行の下に出る。
        確認画面まで進まないと分からない、という状態にしない。
      */}
      <Field label={t('storage.raidArrayLevel')} hint={minLine} error={short ? minLine : undefined}>
        {(id) => (
          <Select
            id={id}
            value={typeof array.level === 'string' ? array.level : 'raid1'}
            onChange={(v) => onPatch({ level: v as RaidLevel })}
            options={RAID_LEVEL_CHOICES.map((c) => ({ value: c.value, label: t(c.label) }))}
          />
        )}
      </Field>

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
          {t('storage.raidArrayMembers')}
        </p>
        {disks.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('storage.raidDisksEmpty')}</p>
        ) : (
          <ul className="space-y-1">
            {disks.map((disk, i) => {
              const id = trimmed(isObject(disk) ? disk.id : undefined)
              if (!id) return null
              const isMember = members.includes(id)
              const isSpare = spares.includes(id)
              const label = `${t('storage.raidDiskHeading', { n: i + 1 })} ${describeDiskMatchShort(t, (disk as RaidDisk).match)}`
              return (
                <li key={id} className="flex flex-wrap items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
                    <input
                      type="checkbox"
                      className="size-4 accent-sky-600"
                      checked={isMember || isSpare}
                      onChange={(e) => setMembership(id, e.target.checked ? 'device' : 'none')}
                    />
                    <span>{label}</span>
                    {/*
                      丸ごとのディスクは `/boot` 用の配列には入れられない
                      （`validate.raidWholeDiskInBootArray`）。どれが丸ごとかを
                      **選ぶ場所で**見せないと、error を読んでから一覧へ戻ることになる。
                    */}
                    {raidDiskUsageOf(disk) === 'whole' && (
                      <Badge tone="warning">{t('storage.raidDiskWholeBadge')}</Badge>
                    )}
                  </label>
                  {(isMember || isSpare) && (
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                      <input
                        type="checkbox"
                        className="size-3.5 accent-amber-600"
                        checked={isSpare}
                        onChange={(e) => setMembership(id, e.target.checked ? 'spare' : 'device')}
                      />
                      <span>{t('storage.raidMemberSpare')}</span>
                    </label>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('storage.raidArrayMembersHint')}</p>
      </div>

      <IssueList issues={issues} />
    </div>
  )
}
