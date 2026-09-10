// 2 台目の ESP に GRUB を入れる late-command を、**実際に `sh` で走らせて**確かめる。
//
// この手順には一次資料の裏付けが無い（`docs/HANDOFF.md` §3.1）。curtin も
// autoinstall リファレンスも「どちらが壊れても起動する」を作る方法を書いていないので、
// `raidEspMirrorCommand()` はこのアプリの組み立てである。だから**動かして確かめる**。
//
// VM を 1 本回すと 30〜40 分かかるうえ、VM は「ESP を持つ関係の無いディスク」を
// 用意できない（インストーラ USB が偶然その役をして**実バグが見つかった**）。
// ここでは `findmnt` / `lsblk` / `mount` を偽物に差し替え、
// **どのデバイスを対象に選び、どれを除外したか**だけを見る。
//
// **`/target` はサンドボックスに置き換えて走らせる。** 判定のロジックは 1 文字も変えない
// （置き換えるのはパスの接頭辞だけ）。そうしないとログの書き出し先が
// 本物の `/target/var/log/` になり、開発機では何も残らない。
//
// 走らせるには POSIX の `sh` が要る。Windows では Git Bash のものを使う。
// 見つからなければスキップして正常終了する（`smoke` が ISO 無しでそうするのと同じ）。

import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { raidEspMirrorCommand, RAID_ESP_MIRROR_LOG } from '../packages/shared/src/autoinstall/generate-raid.js'
import { printRevisionBanner } from './lib/git-revision.mjs'

let checks = 0
let failures = 0
const failed: string[] = []

function check(label: string, condition: boolean, detail = ''): void {
  checks++
  if (condition) {
    console.log(`  ok   ${label}`)
    return
  }
  failures++
  failed.push(label)
  console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
}

function findSh(): string | null {
  const candidates = [
    'sh',
    'C:/Program Files/Git/usr/bin/sh.exe',
    'C:/Program Files (x86)/Git/usr/bin/sh.exe',
    '/bin/sh',
  ]
  for (const c of candidates) {
    try {
      execFileSync(c, ['-c', 'exit 0'], { stdio: 'ignore' })
      return c
    } catch {
      // 次の候補へ
    }
  }
  return null
}

/**
 * 偽の `findmnt` / `lsblk` / `mount` を置いた PATH で late-command を走らせ、
 * 書き出されたログを返す。
 *
 * 想定する機械:
 * - `/dev/vda` `/dev/vdb` … インストール先（ESP はどちらにもある。1 台目が vda1）
 * - `/dev/sda` … **インストーラ USB**（ESP を持つが 5 MiB しかない）
 * - `/dev/nvme9n1` … **別の OS が入った既存ディスク**（ESP を持つ。触ってはいけない）
 */
function runMirror(
  sh: string,
  opts: { readonly mounts: Readonly<Record<string, string>>; readonly esps?: readonly string[] },
): string {
  const root = mkdtempSync(join(tmpdir(), 'esp-mirror-'))
  try {
    const bin = join(root, 'bin')
    mkdirSync(bin, { recursive: true })
    mkdirSync(join(root, 'target/boot/efi'), { recursive: true })
    mkdirSync(join(root, 'target/var/log'), { recursive: true })

    const shRoot = root.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`)

    // `findmnt --target <path>` は「そのパスを含むいちばん近いマウント」を返す。
    // **`--target` は前方一致ではなく最長一致**なので、深いパスから順に判定する。
    //
    // **`-R <path>`（配下のマウントを全部）にも答える。** 実機の `findmnt` がそうだから、
    // というだけでなく、**`-R` に戻す変異が「本来の理由」で落ちるようにするため**
    // ——スタブが `-R` に無言だと、変異が「対象 0 台」に潰れて
    // 「USB を数えてしまう」という本当の症状を見せない（落とし穴 110）。
    writeFileSync(
      join(bin, 'findmnt'),
      [
        '#!/bin/sh',
        'case "$*" in',
        `  *"-R ${shRoot}/target"*) printf '${Object.values(opts.mounts).join('\\n')}${
          Object.keys(opts.mounts).length > 0 ? '\\n' : ''
        }' ;;`,
        ...Object.entries(opts.mounts)
          .sort((a, b) => b[0].length - a[0].length)
          .map(([path, source]) => `  *"--target ${shRoot}${path}"*) echo ${source} ;;`),
        'esac',
        '',
      ].join('\n'),
    )
    writeFileSync(
      join(bin, 'lsblk'),
      [
        '#!/bin/sh',
        'ESP=c12a7328-f81f-11d2-ba4b-00a0c93ec93b',
        'case "$*" in',
        '  *"NAME,PARTTYPE"*)',
        // 見えている ESP は 4 つ。うち触ってよいのは vdb1 だけ。
        `    printf '${(opts.esps ?? ['/dev/vda1', '/dev/vdb1', '/dev/sda2', '/dev/nvme9n1p1'])
          .map((d) => `${d} '$ESP'`)
          .join('\n')}\n'`,
        '    ;;',
        // `lsblk -s` は依存を下へ辿る。LVM も md も物理ディスクまで展開される。
        "  *\"-s /dev/dm-0\"*) printf '/dev/dm-0 lvm\\n/dev/md1 raid1\\n/dev/vda3 part\\n/dev/vda disk\\n/dev/vdb3 part\\n/dev/vdb disk\\n' ;;",
        "  *\"-s /dev/md0\"*) printf '/dev/md0 raid1\\n/dev/vda2 part\\n/dev/vda disk\\n/dev/vdb2 part\\n/dev/vdb disk\\n' ;;",
        "  *\"-s /dev/vda1\"*) printf '/dev/vda1 part\\n/dev/vda disk\\n' ;;",
        // **インストーラ USB**。`/target/cdrom` に bind されているとここへ来る。
        "  *\"-s /dev/sda1\"*) printf '/dev/sda1 part\\n/dev/sda disk\\n' ;;",
        '  *"PKNAME /dev/vdb1"*) echo vdb ;;',
        '  *"PKNAME /dev/sda2"*) echo sda ;;',
        '  *"PKNAME /dev/nvme9n1p1"*) echo nvme9n1 ;;',
        'esac',
        '',
      ].join('\n'),
    )
    // 実際にマウントはしない。成功したことにして先へ進める。
    for (const name of ['mount', 'umount', 'curtin']) {
      writeFileSync(join(bin, name), '#!/bin/sh\nexit 0\n')
    }
    // **`[ -b ... ]` のような組み込みは PATH から差し替えられない。**
    // だから late-command 側もブロックデバイス判定を組み込みに頼らず、
    // `lsblk` が失敗することで弾く形にしてある（`generate-raid.ts` のコメント参照）。
    //
    // **実行ビットは Node で立てる。`chmod` を呼ばない。**
    // 以前は `sh -c "chmod +x ..."` としていたが、**PowerShell / cmd から起動すると
    // Git の `sh.exe` は見つかるのに `chmod` は PATH に無い**ので
    // `chmod: command not found` で落ちていた（`npm test` は PowerShell から回る）。
    // Git Bash は shebang があれば実行ビット無しでも走らせるが、
    // Linux では要るので `chmodSync` で立てておく（Windows では実質 no-op）。
    for (const name of ['findmnt', 'lsblk', 'mount', 'umount', 'curtin']) {
      chmodSync(join(bin, name), 0o755)
    }

    // `/target` をサンドボックスへ。**判定のロジックには触らない。**
    const command = raidEspMirrorCommand().split('/target').join(`${shRoot}/target`)
    // **見つけた `sh` のディレクトリも PATH に入れる。**
    // late-command 自身が `sh -c '…'` の形をしており、その中でも
    // `awk` / `sort` / `tr` / `cp` / `date` を呼ぶ。PowerShell や cmd から
    // 起動すると Git の `usr/bin` は PATH に無いので、
    // `sh: command not found` で落ちる（`npm test` は PowerShell から回る）。
    // **PATH に入れる前に POSIX 形式へ直す。**
    // `C:/Program Files/Git/usr/bin` をそのまま入れると、MSYS の `sh` は
    // PATH を `:` で分けるので **`C` と `/Program Files/...` に割れて**効かない
    // （症状は同じ `sh: command not found` なので、直したつもりで直っていない）。
    const shDir = sh.includes('/')
      ? sh.slice(0, sh.lastIndexOf('/')).replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`)
      : ''
    const prefix = shDir ? `PATH='${shRoot}/bin':'${shDir}':$PATH` : `PATH='${shRoot}/bin':$PATH`
    execFileSync(sh, ['-c', `${prefix}; ${command}`], { stdio: 'pipe' })

    const logPath = join(root, `target${RAID_ESP_MIRROR_LOG}`)
    return existsSync(logPath) ? readFileSync(logPath, 'utf8') : '(ログが書かれなかった)'
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------

printRevisionBanner('scripts/e2e-esp-mirror.mts')

const sh = findSh()
if (!sh) {
  console.log('POSIX の sh が見つかりません。スキップします。')
  process.exit(0)
}
console.log(`sh: ${sh}`)

console.log('\n■ インストール先のディスクだけをミラーする')
// 起動チェーン: `/` は LVM、`/boot` は md、`/boot/efi` は 1 台目の ESP。
// **`/target/cdrom` にはインストーラ USB が bind されている**
// ——curtin が ISO のパッケージプールを使うために実際にそうする（VM で実測）。
// ここを「インストール先のディスク」に数えると USB の ESP を壊しに行く。
const TARGET_MOUNTS = {
  '/target': '/dev/dm-0',
  '/target/boot': '/dev/md0',
  '/target/boot/efi': '/dev/vda1',
  '/target/cdrom': '/dev/sda1',
} as const
const log = runMirror(sh, { mounts: TARGET_MOUNTS })
console.log(
  log
    .split('\n')
    .map((l) => `    | ${l}`)
    .join('\n'),
)

check('インストール先のディスクを認識した', log.includes('target disks: /dev/vda /dev/vdb'))
check('2 台目の ESP に GRUB を入れた', log.includes('grub-install ok: /dev/vdb1'))
check(
  '**インストーラ USB の ESP には触らない**',
  log.includes('/dev/sda2 (skipped: /dev/sda is not a disk this install uses)'),
  '触ると 5 MiB の ESP を壊し、結果が incomplete になる（VM で 2 回起きた）',
)
check(
  '**`/target/cdrom` に bind された USB を「インストール先」に数えない**',
  // 「除外した」という行にも `/dev/sda` は出るので、**`target disks:` の行だけ**を見る。
  /^target disks: \/dev\/vda \/dev\/vdb\s*$/m.test(log),
  `curtin は ISO のパッケージプールのために USB を /target/cdrom へ bind する / 実際 "${
    /^target disks: (.*)$/m.exec(log)?.[1] ?? ''
  }"`,
)
check(
  '**別の OS が入ったディスクの ESP には触らない**',
  log.includes('/dev/nvme9n1p1 (skipped: /dev/nvme9n1 is not a disk this install uses)'),
  '触ると他の OS のブートローダを黙って上書きする',
)
check('1 台目（マウント済みの ESP）は対象外', !log.includes('--- /dev/vda1'))
check('数が合っている', log.includes('mirrored: 1, failures: 0, skipped: 2'))
check('結果は ok', log.includes('RESULT: ok'))

console.log('\n■ インストール先が分からないときは 1 台も触らない')
// `findmnt -R /target` が何も返さない（/target が無い等）。
// **判断材料が無いまま他人のディスクへ書きに行くほうが危ない。**
const blind = runMirror(sh, { mounts: {} })
console.log(
  blind
    .split('\n')
    .map((l) => `    | ${l}`)
    .join('\n'),
)
// `/boot/efi` のマウントも分からないので 1 台目 (`/dev/vda1`) も候補に残る。
// それでも**全部 skip される**のが正しい（4 つ見えて 4 つとも触らない）。
check('1 台もミラーしない', blind.includes('mirrored: 0, failures: 0, skipped: 4'))
// **「見つからなかった」と「見つけたが対象外だった」を区別する。**
// 一緒くたにすると、絞り込みが効きすぎて正当な 2 台目を落としたときに
// 「そもそも 2 台目が無かった」と読めてしまい、原因にたどり着けない。
check(
  '「ESP はあったが対象外だった」と言う（「見つからなかった」ではない）',
  blind.includes('RESULT: skipped - EFI system partitions exist'),
  `実際 "${/^RESULT: .*$/m.exec(blind)?.[0] ?? ''}"`,
)

console.log('\n■ 2 台目の ESP が本当に無いときだけ「対象なし」と言う')
// ESP が 1 台目にしか無い機械（利用者の実機構成がこれ）。
const only = runMirror(sh, { mounts: TARGET_MOUNTS, esps: ['/dev/vda1'] })
console.log(
  only
    .split('\n')
    .map((l) => `    | ${l}`)
    .join('\n'),
)
check('候補が 1 つも無い', only.includes('mirrored: 0, failures: 0, skipped: 0'))
check('「対象なし」として終わる', only.includes('RESULT: nothing to do'))

// ---------------------------------------------------------------------------

console.log(`\n${checks} 件中 ${checks - failures} 件成功、${failures} 件失敗`)
if (failures > 0) {
  console.error('\n失敗:')
  for (const f of failed) console.error(`  - ${f}`)
  process.exit(1)
}
