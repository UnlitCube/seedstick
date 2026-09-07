import type { DiskMatch } from './model.js'
import { shellQuote } from './presets.js'
import type { RaidArray, RaidDisk, RaidStorageConfig } from './raid.js'

// RAID + LVM を curtin の「アクション列」(`storage.config`) に落とす。
//
// 一次資料は `docs/research/R8-raid-and-bond.md`（curtin storage / autoinstall reference）。
// **ここに無い構文は書かない。**
//
// 依存関係の順に出す。curtin は前方参照できない
// （"The actions in the storage configuration are processed in the order they are in
//   the autoinstall file." — autoinstall リファレンス）。
//
//   1. disk            … 1 台目の boot ディスクだけ grub_device: true
//   2. ESP の partition … boot ディスクごと。flag: boot（GPT では ESP になる）
//   3. /boot の partition
//   4. データ用 partition（そのディスクの最後なので size: -1 = 残り全部）
//   5. raid
//   6. format（ESP / boot / root）
//   7. lvm_volgroup → lvm_partition
//   8. mount（**最後にまとめて、パスの浅い順**。理由は下のコメント）

/** `disk` アクションと `layout` の両方で使える match spec。 */
export function diskMatchSpec(match: DiskMatch): Record<string, unknown> {
  switch (match.kind) {
    case 'largest':
      return { size: 'largest' }
    case 'smallest':
      return { size: 'smallest' }
    case 'ssd':
      return { ssd: true }
    case 'path':
      return { path: match.path }
    case 'serial':
      return { serial: match.serial }
    case 'model':
      return { model: match.model }
    case 'any':
      // 空の match は「任意の 1 台」（autoinstall リファレンスに明記）。
      return {}
  }
}

// 手で編集された JSON がそのまま届く（落とし穴 23 / 30 / 31）。
// `typeof null === 'object'` なので、必ず形を確かめてから触る。
// 生成が例外で抜けると GUI は「理由の分からない空の確認画面」になる。
const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
const size = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.trim() ? v.trim() : fallback

/**
 * 読めない match を `{}`（＝任意の 1 台）に落とさない。
 *
 * `{}` は「どのディスクでもよい」で、複数ディスク機では**どれが消えるか分からない**
 * （このツールで最も破壊的な失敗・落とし穴 22 / 65）。
 * 代わりに一致しようのない指定を出し、curtin に「該当ディスク無し」で止めさせる。
 * 検証も `validate.raidDiskMatchEmpty` で先に止める。
 */
export const UNREADABLE_DISK_MATCH_SERIAL = '@@autoinstall-unreadable-disk-match@@'

export function isReadableDiskMatch(match: unknown): match is DiskMatch {
  if (match === null || typeof match !== 'object') return false
  const kind = (match as { kind?: unknown }).kind
  return (
    kind === 'largest' ||
    kind === 'smallest' ||
    kind === 'ssd' ||
    kind === 'path' ||
    kind === 'serial' ||
    kind === 'model' ||
    kind === 'any'
  )
}

function safeDiskMatchSpec(match: unknown): Record<string, unknown> {
  if (isReadableDiskMatch(match)) return diskMatchSpec(match)
  return { serial: UNREADABLE_DISK_MATCH_SERIAL }
}

/** 配列が参照するディスク（本体 + スペア）の内部 ID。 */
function memberIdsOf(array: RaidArray): string[] {
  return [...strings(array?.diskIds), ...strings(array?.spareDiskIds)]
}

/** ディスク 1 台と、`raid.disks` の中での位置。**添字で元配列を引き直さない**（落とし穴 48）。 */
interface DiskSlot {
  readonly disk: RaidDisk
  readonly index: number
}

/**
 * 生成の途中で分かる事実。検証と late-commands が同じ計算を 2 回書かないように返す。
 */
export interface RaidPlan {
  /** `storage.config` に入れるアクション列 */
  readonly config: Record<string, unknown>[]
  /** ESP を作るディスク（= `boot: true` のディスク）の台数 */
  readonly espCount: number
  /** 配列にもホストにも使われず、`disk` アクションを出さなかったディスクの位置（0 始まり） */
  readonly unusedDiskIndexes: readonly number[]
}

/**
 * 内部 ID → curtin の id を引くための索引。
 *
 * 同じ内部 ID が 2 行にあるときは**先に出てきたほうを採る**（後勝ちにすると
 * 配列の参照先が黙って別のディスクに変わる）。検証が重複を error にする。
 */
function indexDisks(disks: readonly RaidDisk[]): Map<string, DiskSlot> {
  const byId = new Map<string, DiskSlot>()
  disks.forEach((disk, index) => {
    const id = typeof disk?.id === 'string' ? disk.id : ''
    if (id && !byId.has(id)) byId.set(id, { disk, index })
  })
  return byId
}

export function buildRaidPlan(raid: RaidStorageConfig): RaidPlan {
  const rawDisks = list<RaidDisk>(raid?.disks)
  const rawArrays = list<RaidArray>(raid?.arrays).filter(
    (a): a is RaidArray => a !== null && typeof a === 'object',
  )
  const byId = indexDisks(rawDisks)
  const config: Record<string, unknown>[] = []
  const mounts: { path: string; entry: Record<string, unknown> }[] = []

  // どのディスクにどのパーティションが要るか。
  // スペアにも本体と同じ大きさのパーティションが要る（入れ替わったときに使えないと意味がない）。
  const needsBoot = new Set<string>()
  const needsData = new Set<string>()
  for (const array of rawArrays) {
    const target = array.role === 'boot' ? needsBoot : needsData
    for (const id of memberIdsOf(array)) if (byId.has(id)) target.add(id)
  }

  // **どの配列でも使わず、起動にも使わないディスクには `disk` アクションを出さない。**
  // 出すと `wipe: superblock-recursive` が効いて、何にも使わないディスクを消すだけになる。
  // 黙って落とすのではなく、検証が「使われていません」と伝える（落とし穴 50 / 67）。
  const slots: DiskSlot[] = []
  const unusedDiskIndexes: number[] = []
  rawDisks.forEach((disk, index) => {
    const id = typeof disk?.id === 'string' ? disk.id : ''
    // 同じ id が 2 行にあるとき、curtin の id を重複させない（検証が error にする）。
    // id が読めない行も出さない（配列から指しようがないので、消すだけになる）。
    if (!id || byId.get(id)?.index !== index) {
      unusedDiskIndexes.push(index)
      return
    }
    if (disk.boot === true || needsBoot.has(id) || needsData.has(id)) {
      slots.push({ disk, index })
    } else {
      unusedDiskIndexes.push(index)
    }
  })

  const diskId = (index: number): string => `disk-${index}`
  const espId = (index: number): string => `${diskId(index)}-esp`
  const bootPartId = (index: number): string => `${diskId(index)}-boot`
  const dataPartId = (index: number): string => `${diskId(index)}-data`

  // --- 1. disk ---
  let grubAssigned = false
  for (const { disk, index } of slots) {
    const action: Record<string, unknown> = {
      type: 'disk',
      id: diskId(index),
      ptable: 'gpt',
      // 既存の md / LVM / パーティションテーブルの痕跡を消す。
      // これを付けないと、前に RAID を組んでいたディスクで組み立てに失敗する。
      wipe: 'superblock-recursive',
      match: safeDiskMatchSpec(disk.match),
    }
    // curtin の `grub_device` は 1 台にしか設定できない（curtin のドキュメント）。
    // 2 台目以降は late-commands で補う（`raidEspMirrorCommand()`）。
    if (disk.boot === true && !grubAssigned) {
      action['grub_device'] = true
      grubAssigned = true
    }
    config.push(action)
  }

  // --- 2〜4. partition ---
  // 種類ごとにまとめて出す。1 台の中の相対順序（ESP → /boot → データ）は保たれるので、
  // `number` と `size: -1`（そのディスクの最後）の意味は変わらない。
  const partNumber = new Map<number, number>()
  const nextNumber = (index: number): number => {
    const n = (partNumber.get(index) ?? 0) + 1
    partNumber.set(index, n)
    return n
  }
  const espSize = size(raid?.espSize, '512M')
  const bootSize = size(raid?.bootSize, '2G')

  const espSlots = slots.filter((s) => s.disk.boot === true)
  for (const { index } of espSlots) {
    config.push({
      type: 'partition',
      id: espId(index),
      device: diskId(index),
      size: espSize,
      // GPT では `flag: boot` が ESP になる（msdos では bootable フラグ）。
      // **ESP は RAID に置けない**（UEFI ファームウェアは md を組み立てられない）ので
      // 各ディスクに素の FAT で作る。
      flag: 'boot',
      number: nextNumber(index),
      wipe: 'superblock',
    })
  }
  for (const { disk, index } of slots) {
    if (!needsBoot.has(disk.id as string)) continue
    config.push({
      type: 'partition',
      id: bootPartId(index),
      device: diskId(index),
      size: bootSize,
      flag: 'raid',
      number: nextNumber(index),
      wipe: 'superblock',
    })
  }
  for (const { disk, index } of slots) {
    if (!needsData.has(disk.id as string)) continue
    config.push({
      type: 'partition',
      id: dataPartId(index),
      device: diskId(index),
      // そのディスクの最後のパーティションなので `-1`（残り全部）。
      // autoinstall リファレンスの "Partition/logical volume extensions" に明記。
      size: -1,
      flag: 'raid',
      number: nextNumber(index),
      wipe: 'superblock',
    })
  }

  // --- 5. raid ---
  const pvArrayIds: string[] = []
  let bootArrayId: string | null = null
  rawArrays.forEach((array, j) => {
    const partOf = (internalId: string): string | null => {
      const slot = byId.get(internalId)
      if (!slot) return null
      return array.role === 'boot' ? bootPartId(slot.index) : dataPartId(slot.index)
    }
    const devices = strings(array.diskIds).map(partOf).filter((v): v is string => v !== null)
    const spares = strings(array.spareDiskIds).map(partOf).filter((v): v is string => v !== null)
    const id = `md-${j}`
    const action: Record<string, unknown> = {
      type: 'raid',
      id,
      name: size(array.name, `md${j}`),
      raidlevel: array.level,
      devices,
      wipe: 'superblock',
    }
    if (spares.length > 0) action['spare_devices'] = spares
    config.push(action)
    if (array.role === 'boot') {
      // /boot は 1 か所にしかマウントできない。2 つ目以降は検証が error にする。
      if (bootArrayId === null) bootArrayId = id
    } else {
      pvArrayIds.push(id)
    }
  })

  // --- 6. format / mount（ESP） ---
  // **マウントするのは 1 つだけ。** 同じパス (`/boot/efi`) に 2 つはマウントできない。
  // 2 台目以降は format だけして、中身は late-commands で複製する。
  espSlots.forEach(({ index }, i) => {
    const fsId = `${espId(index)}-fs`
    config.push({ type: 'format', id: fsId, fstype: 'fat32', volume: espId(index) })
    if (i === 0) {
      mounts.push({
        path: '/boot/efi',
        entry: { type: 'mount', id: `${espId(index)}-mnt`, path: '/boot/efi', device: fsId },
      })
    }
  })

  // --- 7. format / mount（/boot） ---
  if (bootArrayId !== null) {
    const fsId = `${bootArrayId}-fs`
    config.push({ type: 'format', id: fsId, fstype: 'ext4', volume: bootArrayId })
    mounts.push({
      path: '/boot',
      entry: { type: 'mount', id: `${bootArrayId}-mnt`, path: '/boot', device: fsId },
    })
  }

  // --- 8. LVM ---
  if (pvArrayIds.length > 0) {
    const vgId = 'vg-0'
    const lvId = 'lv-root'
    config.push({
      type: 'lvm_volgroup',
      id: vgId,
      name: size(raid?.volumeGroup, 'vg0'),
      devices: pvArrayIds,
    })
    const lv: Record<string, unknown> = {
      type: 'lvm_partition',
      id: lvId,
      name: size(raid?.rootName, 'root'),
      volgroup: vgId,
      // 空なら残り全部。`-1` は論理ボリュームにも使える
      // （autoinstall リファレンスの "Partition/logical volume extensions"）。
      size: typeof raid?.rootSize === 'string' && raid.rootSize.trim() ? raid.rootSize.trim() : -1,
    }
    config.push(lv)
    const fsId = `${lvId}-fs`
    config.push({
      type: 'format',
      id: fsId,
      fstype: raid?.rootFstype === 'xfs' ? 'xfs' : 'ext4',
      volume: lvId,
    })
    mounts.push({ path: '/', entry: { type: 'mount', id: `${lvId}-mnt`, path: '/', device: fsId } })
  }

  // --- 9. mount ---
  // **`mount.device` が指すのは `format` の id**（パーティションの id ではない）。
  // 取り違えると黙ってマウントされない。
  //
  // マウントは最後にまとめ、**パスの浅い順**に並べる。curtin はアクションを
  // 書かれた順に処理するので、`/` より先に `/boot/efi` をマウントすると
  // 「まだ何も無い /target の下」に置くことになる。
  mounts.sort((a, b) => {
    const depth = (p: string): number => p.split('/').filter(Boolean).length
    return depth(a.path) - depth(b.path) || a.path.localeCompare(b.path)
  })
  for (const m of mounts) config.push(m.entry)

  return { config, espCount: espSlots.length, unusedDiskIndexes }
}

// ---------------------------------------------------------------------------
// 2 台目以降の ESP に GRUB を入れる late-command
// ---------------------------------------------------------------------------

/** 複製の結果を残すログ（インストール後の新システムから読める）。 */
export const RAID_ESP_MIRROR_LOG = '/var/log/autoinstall-raid-esp.log'

/**
 * 2 台目以降の boot ディスクにも GRUB を入れる late-command（1 エントリ）。
 *
 * **実機では未検証。** 一次資料 (R8) が保証しているのは
 * 「curtin の `grub_device` は 1 台」「ESP は RAID に置けない」までで、
 * 「どちらが壊れても起動する」を作る手順そのものは curtin にも
 * autoinstall リファレンスにも書かれていない。ここは
 * `grub-install --efi-directory=<2 台目の ESP> --no-nvram` を試し、
 * 失敗したら 1 台目の ESP の中身を複製する、という組み立てで、
 * **実機でも VM でも走らせていない**（落とし穴 72: 「〜済み」と書く前に数えるか実行する）。
 * `x86_64-efi` 決め打ちなので arm64 では効かない。
 *
 * 失敗してもインストール全体は止めない。ただし **`|| true` で握り潰さない**:
 * 何が起きたかを {@link RAID_ESP_MIRROR_LOG} に残し、最後に成否を 1 行で書く。
 * 全体を 1 エントリの `sh -c` にまとめているのは、late-commands の各エントリが
 * 別々に実行される（`set -e` も `&&` も付かない）ため（落とし穴 28）。
 */
export function raidEspMirrorCommand(): string {
  const script = [
    // 生成時に決まる値はここ 2 つだけ。どちらも定数（利用者の入力は 1 文字も入らない）。
    `LOG=${shellQuote(`/target${RAID_ESP_MIRROR_LOG}`)}`,
    // GPT の EFI System Partition のパーティションタイプ GUID。
    'ESP_TYPE=c12a7328-f81f-11d2-ba4b-00a0c93ec93b',
    'mkdir -p "$(dirname "$LOG")" 2>/dev/null',
    '{',
    'echo "=== autoinstall: mirror the bootloader to the other boot disks ==="',
    'date || true',
    'primary=$(findmnt -n -o SOURCE --target /target/boot/efi 2>/dev/null || true)',
    'echo "primary ESP: ${primary:-unknown}"',
    'found=0',
    'failed=0',
    'for dev in $(lsblk -rnpo NAME,PARTTYPE 2>/dev/null | awk -v t="$ESP_TYPE" \'tolower($2) == t { print $1 }\'); do',
    '  if [ "$dev" = "$primary" ]; then continue; fi',
    '  found=$((found + 1))',
    '  echo "--- $dev"',
    '  mkdir -p /target/boot/efi-mirror',
    '  if ! mount "$dev" /target/boot/efi-mirror; then',
    '    echo "FAILED: could not mount $dev"',
    '    failed=$((failed + 1))',
    '    continue',
    '  fi',
    '  if curtin in-target -- grub-install --target=x86_64-efi --efi-directory=/boot/efi-mirror --bootloader-id=ubuntu --no-nvram --recheck; then',
    '    echo "grub-install ok: $dev"',
    '  elif cp -a /target/boot/efi/. /target/boot/efi-mirror/; then',
    '    echo "grub-install failed; copied the primary ESP instead: $dev"',
    '  else',
    '    echo "FAILED: neither grub-install nor copying worked for $dev"',
    '    failed=$((failed + 1))',
    '  fi',
    // NVRAM に項目が無いファームウェアでも拾えるよう、取り外し可能メディア用の
    // 既定パス (EFI/BOOT/BOOTX64.EFI) を用意する。1 台目が壊れて外されると
    // NVRAM の項目は残っていても指す先が消えるため、ここが最後の綱になる。
    '  if [ ! -f /target/boot/efi-mirror/EFI/BOOT/BOOTX64.EFI ]; then',
    '    mkdir -p /target/boot/efi-mirror/EFI/BOOT',
    '    for f in shimx64.efi grubx64.efi; do',
    '      if [ -f "/target/boot/efi-mirror/EFI/ubuntu/$f" ]; then',
    '        cp "/target/boot/efi-mirror/EFI/ubuntu/$f" /target/boot/efi-mirror/EFI/BOOT/BOOTX64.EFI && break',
    '      fi',
    '    done',
    '  fi',
    '  umount /target/boot/efi-mirror || echo "WARNING: could not unmount $dev"',
    '  rmdir /target/boot/efi-mirror 2>/dev/null || true',
    'done',
    'echo "mirrored: $found, failures: $failed"',
    'if [ "$failed" -ne 0 ]; then',
    '  echo "RESULT: incomplete - the first disk boots, the others may not"',
    'elif [ "$found" -eq 0 ]; then',
    '  echo "RESULT: nothing to do - no second EFI system partition was found"',
    'else',
    '  echo "RESULT: ok"',
    'fi',
    `} >> "$LOG" 2>&1`,
    // **必ず 0 で終わる。** late-commands が非ゼロで終わるとインストール全体が中止になる。
    // 何が起きたかはログに残るので、握り潰しではなく「記録して続ける」。
    'exit 0',
  ].join('\n')
  return `sh -c ${shellQuote(script)}`
}
