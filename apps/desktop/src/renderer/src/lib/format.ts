import { createTranslator, type Locale } from '@autoinstall/shared'

/** バイト数を人が読める形にする。 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`
  return `${bytes} B`
}

/** 転送速度を人が読める形にする。 */
export function formatSpeed(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null || bytesPerSecond <= 0) return '—'
  return `${formatBytes(bytesPerSecond)}/s`
}

/** 残り秒数を「約 3 分 20 秒」の形にする。 */
export function formatEta(seconds: number | null, locale: Locale): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—'
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  const rest = s % 60
  // 単位の語順は言語で変わるので、数字だけを差し込んで訳文の側に単位を持たせる。
  const t = createTranslator(locale)
  return m > 0
    ? t('format.etaMinutesSeconds', { minutes: m, seconds: rest })
    : t('format.etaSeconds', { seconds: rest })
}

/** パスワードの強度をざっくり判定する（文字種と長さの組み合わせ）。 */
export function passwordStrength(password: string): 'weak' | 'fair' | 'strong' {
  if (password.length === 0) return 'weak'
  let classes = 0
  if (/[a-z]/.test(password)) classes++
  if (/[A-Z]/.test(password)) classes++
  if (/\d/.test(password)) classes++
  if (/[^A-Za-z0-9]/.test(password)) classes++
  if (password.length >= 16 && classes >= 2) return 'strong'
  if (password.length >= 12 && classes >= 3) return 'strong'
  if (password.length >= 8 && classes >= 2) return 'fair'
  return 'weak'
}

/** 覚えやすくて強いランダムパスワードを作る（曖昧な文字は除外）。 */
export function generatePassword(length = 20): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#%^&*-_=+'
  const bytes = new Uint32Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < length; i++) out += alphabet[bytes[i]! % alphabet.length]
  return out
}
