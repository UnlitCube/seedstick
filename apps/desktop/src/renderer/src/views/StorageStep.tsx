import { useMemo, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import {
  SERIES_FEATURES,
  createDefaultProfile,
  isValidSizeSpec,
  type DiskMatch,
  type StorageConfig,
  type SwapMode,
} from '@autoinstall/shared'
import { useStore } from '../store.js'
import { useT } from '../lib/i18n.js'
import {
  Badge,
  Button,
  Callout,
  Card,
  Disclosure,
  Field,
  RadioGroup,
  Select,
  Switch,
  TextArea,
  TextInput,
} from '../components/ui.js'

type Mode = StorageConfig['mode']

// 先頭のコメント行だけは訳す（テキストエリアに出るので利用者の目に触れる）。
const RAW_TEMPLATE_BODY = `config:
  - {type: disk, id: disk0, ptable: gpt, match: {size: largest}, wipe: superblock-recursive, grub_device: false, preserve: false}
  - {type: partition, id: p-esp, device: disk0, size: 1G, flag: boot, grub_device: true, preserve: false}
  - {type: format, id: f-esp, volume: p-esp, fstype: fat32, preserve: false}
  - {type: partition, id: p-boot, device: disk0, size: 2G, preserve: false}
  - {type: format, id: f-boot, volume: p-boot, fstype: ext4, preserve: false}
  - {type: partition, id: p-lvm, device: disk0, size: -1, preserve: false}
  - {type: lvm_volgroup, id: vg0, name: ubuntu-vg, devices: [p-lvm], preserve: false}
  - {type: lvm_partition, id: lv-root, name: ubuntu-lv, volgroup: vg0, size: -1, preserve: false}
  - {type: format, id: f-root, volume: lv-root, fstype: ext4, preserve: false}
  - {type: mount, id: m-root, device: f-root, path: /}
  - {type: mount, id: m-boot, device: f-boot, path: /boot}
  - {type: mount, id: m-esp, device: f-esp, path: /boot/efi}
`

/** `typeof null === 'object'`（落とし穴 30）。配列も弾く。 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 「詳しい設定」の中で、既定から変わっている**設定の個数**。
 *
 * 数えるのは折りたたみの**中にあるものだけ**（swap・暗号化・復旧用パーティション・
 * ディスク全体を使うか・パーティション形式、そして生の curtin）。
 * ディスクの指定 (`match`) と構成方法 (`mode`) は表に出しているので数えない
 * ——閉じたまま気づけないことが無いものを数えると、開いても何も見つからない。
 *
 * **読めない形なら `undefined` を返す**（嘘の 0 を出さない。落とし穴 50）。
 * プロファイル JSON は手で編集できるので「型は合っているが中身が違う」値は実際に届く
 * （落とし穴 23）。`0` を返すと「既定のまま」に見えてしまい、
 * 設定が失われていることに気づけない。呼び出し側は `undefined` のとき
 * **折りたたみを開いた状態**にして、中を見せる。
 *
 * 判別可能ユニオン（`raw` とそれ以外）は判別子ごとに読む（落とし穴 22 / 29）。
 * 暗号化は「入っているかどうか」で数える（パスフレーズを打ち直しても件数は増えない）。
 * 復旧用パーティションは**そのリリースで UI に出ないときも数える**。
 * 出さないと、22.04 で有効なまま残った設定が画面から完全に消える。
 * 「効かない」ことは検証が `validate.resetPartitionUnsupported` で伝える（落とし穴 67）。
 */
export function countStorageDetailChanges(
  storage: StorageConfig,
  defaults: StorageConfig,
): number | undefined {
  const s: unknown = storage
  if (!isObject(s)) return undefined
  if (s['mode'] === 'raw') {
    const yaml = s['yaml']
    if (typeof yaml !== 'string') return undefined
    return yaml.trim().length > 0 ? 1 : 0
  }
  if (s['mode'] !== 'lvm' && s['mode'] !== 'direct' && s['mode'] !== 'zfs') return undefined
  // 既定が raw になることはないが、比較の相手も同じ疑いで見る。
  if (defaults.mode === 'raw') return undefined

  const whole = s['useWholeDisk']
  const passphrase = s['encryptionPassphrase']
  const swap = s['swap']
  const table = s['partitionTable']
  const reset = s['resetPartition']
  if (typeof whole !== 'boolean') return undefined
  if (typeof passphrase !== 'string') return undefined
  if (!isObject(swap) || typeof swap['mode'] !== 'string') return undefined
  if (typeof table !== 'string') return undefined
  if (!isObject(reset) || typeof reset['enabled'] !== 'boolean') return undefined

  let n = 0
  // **その構成方法で実際に描画される設定だけ数える。**
  // 描画されないものを数えると「Badge は 1 件変更なのに、開いても何も無い」
  // になる（このファイルのテストが match / mode で同じことを禁じている）。
  const isLvm = s['mode'] === 'lvm'
  if (isLvm && whole !== defaults.useWholeDisk) n += 1
  if (isLvm && passphrase.length > 0 !== defaults.encryptionPassphrase.length > 0) n += 1
  if (swap['mode'] !== defaults.swap.mode) n += 1
  if (table !== defaults.partitionTable) n += 1
  if (reset['enabled'] !== defaults.resetPartition.enabled) n += 1
  return n
}

export function StorageStep(): React.JSX.Element {
  const t = useT()
  const storage = useStore((s) => s.profile.storage)
  const series = useStore((s) => s.profile.series)
  const features = SERIES_FEATURES[series]
  const update = useStore((s) => s.updateProfile)
  const [revealPassphrase, setRevealPassphrase] = useState(false)

  // 「既定」は `createDefaultProfile()` が唯一の出どころ。ここで書き写すと、
  // 既定値が変わったときに件数だけが古いままになる。
  const defaults = useMemo(() => createDefaultProfile(series).storage, [series])
  const changedCount = countStorageDetailChanges(storage, defaults)

  const setStorage = (next: StorageConfig): void => update((p) => ({ ...p, storage: next }))

  const changeMode = (mode: Mode): void => {
    if (mode === storage.mode) return
    if (mode === 'raw') {
      setStorage({ mode: 'raw', yaml: `# ${t('storage.rawTemplateComment')}\n${RAW_TEMPLATE_BODY}` })
      return
    }
    // 構造化モード同士の切り替えは既存の設定を保つ
    if (storage.mode === 'raw') {
      setStorage({
        mode,
        match: { kind: 'largest' },
        useWholeDisk: false,
        encryptionPassphrase: '',
        swap: { mode: 'installer-default', size: '4G' },
        partitionTable: 'default',
        resetPartition: { enabled: false, size: '' },
      })
    } else {
      // 暗号化のパスフレーズは LVM レイアウトにしか無い設定なので、
      // 他のモードへ移るときは一緒に消す。
      // 残したままにすると「LVM でのみ使えます」という error が出るのに、
      // スイッチもパスフレーズ欄も LVM のときしか描画されないので、
      // 画面からは二度と解除できなくなる（書き込みボタンが沈黙する）。
      // `useWholeDisk` も同じ。スイッチは LVM のときしか描画されず、
      // `sizing-policy` は lvm レイアウトにしか出ない（`generate.ts`）。
      // 残すと direct / zfs で「1 件変更」の Badge だけが出て、
      // 開いても変えた覚えのある設定が 1 つも見つからない。
      setStorage({
        ...storage,
        mode,
        encryptionPassphrase: mode === 'lvm' ? storage.encryptionPassphrase : '',
        useWholeDisk: mode === 'lvm' ? storage.useWholeDisk : false,
      })
    }
  }

  return (
    <div className="space-y-5">
      <Callout tone="danger" title={t('storage.warning')}>
        {t('storage.warningBody')}
      </Callout>

      {/*
        構成方法（LVM / そのまま / ZFS / 生の curtin）とディスクの指定は**必ず表に出す**。
        「どのディスクが消えるか」を決めるのはこの 2 つで、たたんだまま気づけないと
        取り返しがつかない（落とし穴 65）。
        生の curtin を選ぶと swap や暗号化は使われなくなるが、その関係が折りたたみで
        分断されないよう、**選択そのものはここに残す**（折りたたみの中は編集欄だけ）。
      */}
      <Card title={t('storage.title')}>
        <RadioGroup<Mode>
          value={storage.mode}
          onChange={changeMode}
          options={[
            {
              value: 'lvm',
              label: t('storage.layoutLvm'),
              badge: <Badge tone="success">{t('common.recommended')}</Badge>,
              description: t('storage.layoutLvmHint'),
            },
            {
              value: 'direct',
              label: t('storage.layoutDirect'),
              description: t('storage.layoutDirectHint'),
            },
            {
              value: 'zfs',
              label: t('storage.layoutZfs'),
              description: t('storage.layoutZfsHint'),
            },
            {
              value: 'raw',
              label: t('storage.layoutRaw'),
              badge: <Badge>{t('common.advanced')}</Badge>,
              description: t('storage.layoutRawHint'),
            },
          ]}
        />
      </Card>

      {storage.mode !== 'raw' && (
        <Card title={t('storage.match')} description={t('storage.matchHint')}>
          <DiskMatchPicker value={storage.match} onChange={(match) => setStorage({ ...storage, match })} />
        </Card>
      )}

      {/*
        `key` を mode（raw かどうか）で切り替えて作り直す。
        「curtin の設定を直接書く」を選んだのに編集欄が折りたたみの中で閉じたまま、
        という状態を作らないため（`defaultOpen` は初期値なので、閉じたあとの
        モード変更では効かない）。構造化モード同士の切り替えでは作り直さない。
      */}
      <Disclosure
        key={storage.mode === 'raw' ? 'raw' : 'structured'}
        title={t('storage.detailsTitle')}
        description={t('storage.detailsDescription')}
        changedCount={changedCount}
        // 生の curtin を書いているときと、件数を数えられなかったとき（＝手で編集された
        // プロファイルが読めない形をしている）は開く。中を見せないと直せない。
        defaultOpen={storage.mode === 'raw' || changedCount === undefined ? true : undefined}
      >
        {storage.mode === 'raw' ? (
          <div className="space-y-3">
            <Callout tone="info">{t('storage.detailsRawActive')}</Callout>
            <Field label={t('storage.rawTitle')} hint={t('storage.rawHint')}>
              {(id) => (
                <TextArea
                  id={id}
                  rows={18}
                  value={storage.yaml}
                  spellCheck={false}
                  onChange={(e) => setStorage({ mode: 'raw', yaml: e.target.value })}
                />
              )}
            </Field>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {storage.mode === 'lvm' && (
                <Switch
                  checked={storage.useWholeDisk}
                  onChange={(useWholeDisk) => setStorage({ ...storage, useWholeDisk })}
                  label={t('storage.wholeDisk')}
                  description={t('storage.wholeDiskHint')}
                />
              )}
              <Field label={t('adv.swapTitle')}>
                {(id) => (
                  <Select
                    id={id}
                    value={storage.swap.mode}
                    onChange={(mode) =>
                      setStorage({ ...storage, swap: { ...storage.swap, mode: mode as SwapMode } })
                    }
                    options={[
                      { value: 'installer-default', label: t('adv.swapAuto') },
                      { value: 'none', label: t('adv.swapNone') },
                      { value: 'size', label: t('adv.swapSize') },
                    ]}
                  />
                )}
              </Field>
              {storage.swap.mode === 'size' && (
                <Field
                  label={t('adv.swapSizeValue')}
                  hint={t('adv.swapSizeHint')}
                  error={
                    isValidSizeSpec(storage.swap.size) ? undefined : t('adv.swapSizeHint')
                  }
                >
                  {(id) => (
                    <TextInput
                      id={id}
                      value={storage.swap.size}
                      spellCheck={false}
                      placeholder="4G"
                      invalid={!isValidSizeSpec(storage.swap.size)}
                      onChange={(e) =>
                        setStorage({ ...storage, swap: { ...storage.swap, size: e.target.value } })
                      }
                    />
                  )}
                </Field>
              )}
              {features.resetPartition && (
                <Switch
                  checked={storage.resetPartition.enabled}
                  onChange={(enabled) =>
                    setStorage({ ...storage, resetPartition: { ...storage.resetPartition, enabled } })
                  }
                  label={t('adv.resetPartition')}
                  description={t('adv.resetPartitionHint')}
                />
              )}
              {features.resetPartition && storage.resetPartition.enabled && (
                <Field
                  label={t('adv.resetPartitionSize')}
                  hint={t('adv.swapSizeHint')}
                  error={
                    storage.resetPartition.size === '' || isValidSizeSpec(storage.resetPartition.size)
                      ? undefined
                      : t('adv.swapSizeHint')
                  }
                >
                  {(id) => (
                    <TextInput
                      id={id}
                      value={storage.resetPartition.size}
                      spellCheck={false}
                      placeholder="12G"
                      invalid={
                        storage.resetPartition.size !== '' &&
                        !isValidSizeSpec(storage.resetPartition.size)
                      }
                      onChange={(e) =>
                        setStorage({
                          ...storage,
                          resetPartition: { ...storage.resetPartition, size: e.target.value },
                        })
                      }
                    />
                  )}
                </Field>
              )}
              {storage.mode === 'lvm' && (
                <Switch
                  checked={storage.encryptionPassphrase.length > 0}
                  tone="warning"
                  onChange={(on) =>
                    setStorage({ ...storage, encryptionPassphrase: on ? 'change-me-please' : '' })
                  }
                  label={t('storage.encrypt')}
                  description={t('storage.encryptHint')}
                />
              )}
            </div>

            {storage.mode === 'lvm' && storage.encryptionPassphrase.length > 0 && (
              <div className="mt-4 space-y-3">
                <Field label={t('storage.encryptPassphrase')} required>
                  {(id) => (
                    <div className="flex gap-2">
                      <TextInput
                        id={id}
                        type={revealPassphrase ? 'text' : 'password'}
                        value={storage.encryptionPassphrase}
                        onChange={(e) => setStorage({ ...storage, encryptionPassphrase: e.target.value })}
                      />
                      <Button type="button" onClick={() => setRevealPassphrase(!revealPassphrase)}>
                        {revealPassphrase ? (
                          <EyeOff className="size-4" aria-hidden />
                        ) : (
                          <Eye className="size-4" aria-hidden />
                        )}
                      </Button>
                    </div>
                  )}
                </Field>
                <Callout tone="warning">{t('storage.encryptWarning')}</Callout>
              </div>
            )}

            <div className="mt-4">
              <Field label={t('storage.partitionTable')}>
                {(id) => (
                  <Select
                    id={id}
                    value={storage.partitionTable}
                    onChange={(v) =>
                      setStorage({ ...storage, partitionTable: v as 'default' | 'gpt' | 'msdos' })
                    }
                    options={[
                      { value: 'default', label: t('storage.ptableDefault') },
                      { value: 'gpt', label: t('storage.ptableGpt') },
                      { value: 'msdos', label: t('storage.ptableMsdos') },
                    ]}
                  />
                )}
              </Field>
            </div>

            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              {t('storage.detailsRawInactive')}
            </p>
          </>
        )}
      </Disclosure>
    </div>
  )
}

function DiskMatchPicker({
  value,
  onChange,
}: {
  value: DiskMatch
  onChange: (value: DiskMatch) => void
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="space-y-3">
      <Select
        value={value.kind}
        onChange={(kind) => {
          switch (kind) {
            case 'largest':
            case 'smallest':
            case 'ssd':
            case 'any':
              onChange({ kind })
              break
            case 'path':
              onChange({ kind: 'path', path: '' })
              break
            case 'serial':
              onChange({ kind: 'serial', serial: '' })
              break
            default:
              onChange({ kind: 'model', model: '' })
          }
        }}
        options={[
          { value: 'largest', label: t('storage.matchLargest') },
          { value: 'smallest', label: t('storage.matchSmallest') },
          { value: 'ssd', label: t('storage.matchSsd') },
          { value: 'any', label: t('storage.matchAny') },
          { value: 'path', label: t('storage.matchPath') },
          { value: 'serial', label: t('storage.matchSerial') },
          { value: 'model', label: t('storage.matchModel') },
        ]}
      />
      {value.kind === 'path' && (
        <Field label={t('storage.pathLabel')} hint={t('storage.pathHint')}>
          {(id) => (
            <TextInput
              id={id}
              value={value.path}
              spellCheck={false}
              placeholder="/dev/nvme0n1"
              onChange={(e) => onChange({ kind: 'path', path: e.target.value })}
            />
          )}
        </Field>
      )}
      {value.kind === 'serial' && (
        <Field
          label={t('storage.serialLabel')}
          hint={t('storage.serialHint')}
        >
          {(id) => (
            <TextInput
              id={id}
              value={value.serial}
              spellCheck={false}
              placeholder="CT500MX*"
              onChange={(e) => onChange({ kind: 'serial', serial: e.target.value })}
            />
          )}
        </Field>
      )}
      {value.kind === 'model' && (
        <Field label={t('storage.modelLabel')} hint={t('storage.modelHint')}>
          {(id) => (
            <TextInput
              id={id}
              value={value.model}
              spellCheck={false}
              placeholder="Samsung SSD*"
              onChange={(e) => onChange({ kind: 'model', model: e.target.value })}
            />
          )}
        </Field>
      )}
      {value.kind === 'any' && (
        // **危険な設定ほど強い助言を出す**（落とし穴 65）。
        // `match: {}` は「どのディスクでもよい」＝複数ディスク機で
        // どれが消えるか分からない、この画面で最も危険な指定。
        // より安全な largest / smallest / ssd にだけ注意書きがあり、
        // ここだけ無言だった（検証は出るが、それは確認画面まで見えないうえ、
        // 実行時にディスクを決める設定では出ない）。
        <Callout tone="warning">{t('validate.diskMatchAny')}</Callout>
      )}
      {(value.kind === 'largest' || value.kind === 'smallest' || value.kind === 'ssd') && (
        <Callout tone="info">{t('storage.usbExcluded')}</Callout>
      )}
    </div>
  )
}
