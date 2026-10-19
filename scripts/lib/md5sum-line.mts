import { createHash } from 'node:crypto'

/**
 * 書き込んだ後の md5sum.txt の `./boot/grub/grub.cfg` 行を確かめる。
 *
 * **26.10 から md5sum.txt は grub.cfg を載せていない**（loopback.cfg だけ。
 * 2026-10-20 に実 ISO から直接読んで確認）。載っていない ISO では書き換える行が無いので、
 * 「行が更新されている」を要求すると正しい書き込みに偽の FAIL を出す（落とし穴 93 / 126 の形）。
 * そこで元の ISO を見て、載っていれば「新しい grub.cfg の MD5 になった」、
 * 載っていなければ「行を足していない（md5sum.txt が元のまま）」を見る。
 *
 * 返すのは検査の名前と結果だけ（各スクリプトの check / eq に渡す）。
 */
export function md5sumLineCheck(
  originalText: string,
  writtenText: string,
  newGrubCfg: string,
): { label: string; ok: boolean; detail: string } {
  const isGrub = (l: string): boolean => l.endsWith('  ./boot/grub/grub.cfg')
  const listed = originalText.split('\n').some(isGrub)
  const line = writtenText.split('\n').find(isGrub)
  if (!listed) {
    return {
      label: 'md5sum.txt は grub.cfg を載せていない ISO なので、元のまま',
      ok: line === undefined && writtenText === originalText,
      detail: line === undefined ? '' : `足されている: ${line}`,
    }
  }
  const expected = createHash('md5').update(Buffer.from(newGrubCfg, 'utf8')).digest('hex')
  return {
    label: 'md5sum.txt の grub.cfg 行が更新されている',
    ok: line?.slice(0, 32) === expected,
    detail: `実際 ${line?.slice(0, 32) ?? '(行が無い)'} / 期待 ${expected}`,
  }
}
