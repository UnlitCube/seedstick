import { useMemo, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import {
  SERIES_FEATURES,
  createDefaultProfile,
  createDefaultRaidStorage,
  isValidSizeSpec,
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
import { DiskMatchPicker } from './sections/DiskMatchPicker.js'
import { RaidStorageSection, raidWipeCount } from './sections/RaidStorage.js'

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
 * RAID + LVM (`mode: 'raid'`) では、折りたたみの中に**描画されるもの**が
 * swap・パーティション形式・復旧用パーティションの 3 つになる（`useWholeDisk` と
 * 暗号化は LVM レイアウトにしか無いので描画されない）。数えるのはそこだけ。
 * RAID の構成そのもの（ディスクと配列）は**表に出している**ので数えない。
 * `undefined`（＝読めない）に落とさないこと: 折りたたみが常に開いたままになり、
 * 「読めない設定がある」という嘘を毎回出すことになる。
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
  if (
    s['mode'] !== 'lvm' &&
    s['mode'] !== 'direct' &&
    s['mode'] !== 'zfs' &&
    s['mode'] !== 'raid'
  ) {
    return undefined
  }
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
        // RAID の構成は「生の curtin」から戻ってきた時点では何も無い。
        // ここで既定を入れておかないと `mode: 'raid'` へ移った瞬間に
        // 参照するものが無くなる。
        raid: createDefaultRaidStorage(),
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
      //
      // **RAID の構成 (`storage.raid`) は逆に残す**（`...storage` でそのまま写る）。
      // 消す理由がこの 2 つにはあって RAID には無いから:
      //   - 暗号化と `useWholeDisk` は、他のモードでは**検証が指摘を出す**のに
      //     解除する操作が画面から消える（＝書き込めないまま直せない）
      //   - RAID の構成は `mode !== 'raid'` のとき検証に一切かからない
      //     （`validate.ts` は `mode === 'raid'` のときだけ `validateRaidStorage` を呼ぶ）。
      //     出力にも出ない。残しても壊れない値なので、消すと
      //     「4 台ぶんのシリアルを打ち直す」だけの損になる。
      //     RAID を選び直せばそのまま戻ってくる（落とし穴 61 / 66）。
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
      {/*
        **RAID では消えるディスクが 1 台ではない。**「選んだディスクの中身はすべて
        消去されます」のままだと、4 台構成でも 1 台の話に読める（落とし穴 65）。
        台数は `buildRaidPlan` から導く（＝実際に書き込む台数。使わないディスクには
        `disk` アクションを出さないので、その分は数えない）。
      */}
      <Callout
        tone="danger"
        title={
          storage.mode === 'raid'
            ? t('storage.warningRaid', { count: raidWipeCount(storage.raid) })
            : t('storage.warning')
        }
      >
        {t('storage.warningBody')}
      </Callout>

      {/*
        構成方法（LVM / そのまま / ZFS / RAID + LVM / 生の curtin）とディスクの指定は
        **必ず表に出す**。
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
              value: 'raid',
              label: t('storage.layoutRaid'),
              badge: <Badge>{t('common.advanced')}</Badge>,
              description: t('storage.layoutRaidHint'),
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

      {/*
        RAID + LVM では「どのディスクにインストールするか」は 1 バイトも使われない
        （出力するのは `storage.config` で、そこには配列ごとのディスク指定が入る）。
        ここに残すと**ディスクを決める場所が 2 つある**画面になり、
        どちらが効くのか分からないまま「使われないほう」を直しかねない。
        値そのものは消さずに残す（他のモードへ戻せばそのまま編集できる。落とし穴 61 / 66）。
        効かないことは検証が `validate.raidMatchIgnored` で伝える（落とし穴 67）。
      */}
      {storage.mode !== 'raw' && storage.mode !== 'raid' && (
        <Card title={t('storage.match')} description={t('storage.matchHint')}>
          <DiskMatchPicker value={storage.match} onChange={(match) => setStorage({ ...storage, match })} />
        </Card>
      )}

      {/*
        RAID の構成は**折りたたみの外**に置く。ここが「どのディスクが何台消えるか」を
        決める場所で、隠したものを要約が見ていない限り「既定のまま」に見えてしまう。
      */}
      {storage.mode === 'raid' && (
        <RaidStorageSection
          raid={storage.raid}
          onChange={(raid) => setStorage({ ...storage, raid })}
        />
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
              {/*
                RAID + LVM で効かない設定は、**隠さずに「効かない」と書く**（落とし穴 67）。
                隠すと、有効なまま保存されたプロファイルを開いたときに解除できなくなる
                （落とし穴 61 / 66）。復旧用パーティションは検証も
                `validate.raidResetPartitionIgnored` で伝えるが、それが見えるのは
                確認画面まで進んだあと。
              */}
              {features.resetPartition && storage.mode === 'raid' && (
                <Callout tone="info">{t('validate.raidResetPartitionIgnored')}</Callout>
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

            <div className="mt-4 space-y-3">
              {/*
                RAID + LVM は `disk` アクションに `ptable: gpt` を直接書く
                （`generate-raid.ts`）。この選択は 1 バイトも出力に出ない。
                **検証はここを何も言わない**ので、画面で言う（落とし穴 67）。
                → 検証にも足すべき。担当（StorageCore）へ申し送り済み。
              */}
              {storage.mode === 'raid' && (
                <Callout tone="info">{t('storage.raidPtableIgnored')}</Callout>
              )}
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
