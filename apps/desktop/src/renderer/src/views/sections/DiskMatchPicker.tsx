import type { DiskMatch, MsgKey, MsgParams } from '@autoinstall/shared'
import { useT } from '../../lib/i18n.js'
import { Callout, Field, Select, TextInput } from '../../components/ui.js'

// ディスクの指定方法を選ぶ部品。
//
// **`StorageStep.tsx` から移してきたもので、中身は変えていない。**
// RAID + LVM ではディスクを何台でも並べ、その 1 行 1 行が同じ指定方法を使うので、
// 1 か所にしか無いままだと「RAID 側だけ指定方法が増えない / 警告が出ない」が起きる。
// 写しを作らず、同じ部品を両方から使う（落とし穴 73 の、部品に対する版）。

/** 指定方法の表示名。ここが選択肢の順序と表示の唯一の出どころ。 */
const KIND_LABELS: Record<DiskMatch['kind'], MsgKey> = {
  largest: 'storage.matchLargest',
  smallest: 'storage.matchSmallest',
  ssd: 'storage.matchSsd',
  any: 'storage.matchAny',
  path: 'storage.matchPath',
  serial: 'storage.matchSerial',
  model: 'storage.matchModel',
}

const KIND_ORDER: readonly DiskMatch['kind'][] = [
  'largest',
  'smallest',
  'ssd',
  'any',
  'path',
  'serial',
  'model',
]

/**
 * 「どのディスクか」を 1 行で言い表す。RAID の配列がメンバーを並べるときに使う。
 *
 * **手で編集された JSON がそのまま届く**（落とし穴 23）。知らない `kind` でも
 * 例外を投げず、読めたものをそのまま出す（黙って既定に読み替えない。落とし穴 50）。
 */
export function describeDiskMatchShort(
  t: (key: MsgKey, params?: MsgParams) => string,
  match: unknown,
): string {
  if (typeof match !== 'object' || match === null) return ''
  const m = match as { kind?: unknown; serial?: unknown; path?: unknown; model?: unknown }
  const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  switch (m.kind) {
    case 'serial':
      return text(m.serial) || t('storage.serialLabel')
    case 'path':
      return text(m.path) || t('storage.pathLabel')
    case 'model':
      return text(m.model) || t('storage.modelLabel')
    case 'largest':
    case 'smallest':
    case 'ssd':
    case 'any':
      return t(KIND_LABELS[m.kind])
    default:
      return text(m.kind)
  }
}

/** 指定方法を選んだのに中身が空（一致するディスクが 1 台も無くなる）。 */
export function isEmptyDiskMatch(match: unknown): boolean {
  if (typeof match !== 'object' || match === null) return true
  const m = match as { kind?: unknown; serial?: unknown; path?: unknown; model?: unknown }
  const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  if (m.kind === 'serial') return !text(m.serial)
  if (m.kind === 'path') return !text(m.path)
  if (m.kind === 'model') return !text(m.model)
  return false
}

export function DiskMatchPicker({
  value,
  onChange,
  /**
   * `any` / `largest` / `smallest` / `ssd` の注意書きを出すか。
   *
   * RAID では**選んだディスクが全部消える**ので、注意書きの文面が違う
   * （呼び出し側が自分で出す）。既定は今までどおりこの部品が出す。
   */
  showKindNotes = true,
}: {
  value: DiskMatch
  onChange: (value: DiskMatch) => void
  showKindNotes?: boolean
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
        options={KIND_ORDER.map((kind) => ({ value: kind, label: t(KIND_LABELS[kind]) }))}
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
        <Field label={t('storage.serialLabel')} hint={t('storage.serialHint')}>
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
      {showKindNotes && value.kind === 'any' && (
        // **危険な設定ほど強い助言を出す**（落とし穴 65）。
        // `match: {}` は「どのディスクでもよい」＝複数ディスク機で
        // どれが消えるか分からない、この画面で最も危険な指定。
        // より安全な largest / smallest / ssd にだけ注意書きがあり、
        // ここだけ無言だった（検証は出るが、それは確認画面まで見えないうえ、
        // 実行時にディスクを決める設定では出ない）。
        <Callout tone="warning">{t('validate.diskMatchAny')}</Callout>
      )}
      {showKindNotes &&
        (value.kind === 'largest' || value.kind === 'smallest' || value.kind === 'ssd') && (
          <Callout tone="info">{t('storage.usbExcluded')}</Callout>
        )}
    </div>
  )
}
