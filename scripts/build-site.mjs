// GitHub Pages のサイトを作る。出力は site-dist/（コミットしない）。
//
//   node scripts/build-site.mjs              （最新の Release を GitHub API から読む。読めなければ一覧へのリンク）
//   node scripts/build-site.mjs --offline    （API を読まない）
//
// **文言はアプリと同じ辞書から引く**（packages/shared/src/i18n と installer/shared/labels.ts）。
// サイトにしか無い文だけ docs-site/strings.mjs に置く。辞書は TypeScript のまま読む
// （Node の型除去で読める形にしてある。.e2e/drive.mjs と同じ）ので Node 22.18 以降が要る。
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOCALE_META, LOCALES } from '../packages/shared/src/i18n/locales.ts'
import { DICTIONARIES as INSTALLER } from '../apps/desktop/installer/shared/labels.ts'
import { SITE_STRINGS } from '../docs-site/strings.mjs'
import { ASSET_PATTERNS } from '../docs-site/assets.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'site-dist')
const REPO = 'UnlitCube/seedstick'
const REPO_URL = `https://github.com/${REPO}`
const SITE_URL = 'https://unlitcube.github.io/seedstick/'
const DEFAULT_LOCALE = 'en'

// --- 辞書 ---------------------------------------------------------------------

const APP = {}
for (const l of LOCALES) {
  const mod = await import(`../packages/shared/src/i18n/${l}.ts`)
  APP[l] = Object.values(mod).find((v) => typeof v === 'object' && v !== null)
}

const APP_KEYS = [
  'app.tagline',
  'app.experimental',
  'about.experimental',
  'common.language',
  'about.noWarranty',
  'about.license',
  'about.disclaimer',
  'about.trademarks',
  'about.source',
]
const INSTALLER_KEYS = [
  'welcome.f1.title',
  'welcome.f1.body',
  'welcome.f2.title',
  'welcome.f2.body',
  'welcome.f3.title',
  'welcome.f3.body',
]

// 1 つでも欠けていたら止める（英語で埋めて黙って出さない）
const missing = []
const siteKeys = Object.keys(SITE_STRINGS.en)
for (const l of LOCALES) {
  for (const k of siteKeys) if (!SITE_STRINGS[l]?.[k]) missing.push(`site ${l}/${k}`)
  for (const k of APP_KEYS) if (!APP[l]?.[k]) missing.push(`app ${l}/${k}`)
  for (const k of INSTALLER_KEYS) if (!INSTALLER[l]?.[k]) missing.push(`installer ${l}/${k}`)
}
for (const l of Object.keys(SITE_STRINGS)) if (!LOCALES.includes(l)) missing.push(`site: unknown locale ${l}`)
if (missing.length > 0) {
  console.error(`missing strings:\n  ${missing.join('\n  ')}`)
  process.exit(1)
}

// --- 最新の Release -----------------------------------------------------------

async function latestRelease() {
  if (process.argv.includes('--offline')) return null
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'seedstick-site' }
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    // **`/releases/latest` は使わない。** 実験的な間（0.x）は Release をプレリリースにしており、
    // `/releases/latest` はプレリリースを返さない（404 になってボタンが全部 Releases の一覧へ落ちる）。
    // 一覧は作成日時の新しい順なので、下書きでない最初のものを採る。
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, { headers })
    if (!res.ok) {
      console.log(`latest release: HTTP ${res.status} (links point to the releases page)`)
      return null
    }
    const rel = (await res.json()).find((r) => !r.draft)
    if (!rel) {
      console.log('latest release: none published yet (links point to the releases page)')
      return null
    }
    return {
      tag: rel.tag_name,
      url: rel.html_url,
      assets: rel.assets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
    }
  } catch (e) {
    console.log(`latest release: ${e.message} (links point to the releases page)`)
    return null
  }
}

const release = await latestRelease()
// `/releases/latest` はプレリリースしか無いと 404 になるので、一覧を指す
const RELEASES_PAGE = `${REPO_URL}/releases`

function asset(kind) {
  const hit = release?.assets.find((a) => ASSET_PATTERNS[kind].test(a.name))
  return hit ? { url: hit.url, name: hit.name, size: hit.size } : { url: RELEASES_PAGE, name: null, size: 0 }
}
if (release) {
  const found = Object.keys(ASSET_PATTERNS).filter((k) => asset(k).name !== null)
  console.log(`latest release: ${release.tag} (${found.length}/${Object.keys(ASSET_PATTERNS).length} files matched)`)
}

// --- HTML ----------------------------------------------------------------------

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const fill = (s, params) => s.replace(/\{(\w+)\}/g, (w, k) => (k in params ? params[k] : w))
const mb = (bytes) => (bytes > 0 ? ` <span class="size">${(bytes / 1024 / 1024).toFixed(0)} MB</span>` : '')

/** その言語のページから見た、別の言語のページへの相対パス。 */
function hrefTo(from, to) {
  const up = from === DEFAULT_LOCALE ? './' : '../'
  return to === DEFAULT_LOCALE ? up : `${up}${to}/`
}

const RELEASE_ROWS = [
  ['22.04 LTS', 'Jammy Jellyfish'],
  ['24.04 LTS', 'Noble Numbat'],
  ['25.10', 'Questing Quokka', 'eol'],
  ['26.04 LTS', 'Resolute Raccoon'],
  ['26.10', 'Stonking Stingray'],
]

function page(locale) {
  const s = SITE_STRINGS[locale]
  const a = APP[locale]
  const inst = INSTALLER[locale]
  const meta = LOCALE_META[locale]
  const base = locale === DEFAULT_LOCALE ? './' : '../'
  const img = (name) => `${base}img/${locale}-${name}.webp`
  const dl = (kind, label) => {
    const x = asset(kind)
    return `<a class="file" href="${esc(x.url)}">${esc(label)}${mb(x.size)}</a>`
  }
  const version = release ? fill(s.latest, { version: release.tag }) : ''
  const langLinks = LOCALES.map(
    (l) =>
      `<li><a href="${hrefTo(locale, l)}" lang="${LOCALE_META[l].htmlLang}" hreflang="${LOCALE_META[l].htmlLang}" data-locale="${l}"${
        l === locale ? ' aria-current="page"' : ''
      }>${esc(LOCALE_META[l].endonym)}</a></li>`,
  ).join('')
  const alternates = LOCALES.map(
    (l) =>
      `<link rel="alternate" hreflang="${LOCALE_META[l].htmlLang}" href="${SITE_URL}${l === DEFAULT_LOCALE ? '' : `${l}/`}">`,
  ).join('\n    ')
  const canonical = `${SITE_URL}${locale === DEFAULT_LOCALE ? '' : `${locale}/`}`
  const features = [
    [inst['welcome.f1.title'], inst['welcome.f1.body']],
    [inst['welcome.f2.title'], inst['welcome.f2.body']],
    [inst['welcome.f3.title'], inst['welcome.f3.body']],
    [s.fManyTitle, s.fManyBody],
    [s.fChecksTitle, s.fChecksBody],
    [s.fAfterTitle, s.fAfterBody],
  ]
    .map(([t, b]) => `<article class="card"><h3>${esc(t)}</h3><p>${esc(b)}</p></article>`)
    .join('\n          ')

  return `<!doctype html>
<html lang="${meta.htmlLang}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Seedstick — ${esc(a['app.tagline'])}</title>
    <meta name="description" content="${esc(s.metaDescription)}">
    <link rel="canonical" href="${canonical}">
    ${alternates}
    <link rel="alternate" hreflang="x-default" href="${SITE_URL}">
    <meta property="og:title" content="Seedstick">
    <meta property="og:description" content="${esc(s.metaDescription)}">
    <meta property="og:image" content="${SITE_URL}img/${locale}-review.webp">
    <meta property="og:type" content="website">
    <link rel="icon" href="${base}icon.png">
    <link rel="stylesheet" href="${base}style.css">
  </head>
  <body>
    <header class="top">
      <div class="wrap top-row">
        <a class="brand" href="${base}${locale === DEFAULT_LOCALE ? '' : `${locale}/`}"><img src="${base}icon.png" alt="" width="28" height="28"> Seedstick</a>
        <nav aria-label="Seedstick">
          <a href="#features">${esc(s.navFeatures)}</a>
          <a href="#how">${esc(s.navHow)}</a>
          <a href="#download">${esc(s.navDownload)}</a>
          <a href="${REPO_URL}">GitHub</a>
        </nav>
        <details class="lang">
          <summary aria-label="${esc(a['common.language'])}">${esc(meta.endonym)}</summary>
          <ul>${langLinks}</ul>
        </details>
      </div>
    </header>

    <main>
      <section class="hero">
        <div class="wrap">
          <h1>Seedstick <span class="badge">${esc(a['app.experimental'])}</span></h1>
          <p class="tagline">${esc(a['app.tagline'])}</p>
          <p class="lead">${esc(s.metaDescription)}</p>
          <p class="actions">
            <a class="button primary" href="#download">${esc(s.heroDownload)}</a>
            <a class="button" href="${REPO_URL}">${esc(a['about.source'])}</a>
          </p>
          ${version ? `<p class="version">${esc(version)}</p>` : ''}
          <img class="shot" src="${img('review')}" alt="${esc(s.shotReviewAlt)}" width="1200" height="806" fetchpriority="high">
        </div>
      </section>

      <section class="safety" aria-labelledby="safety-title">
        <div class="wrap">
          <div class="callout">
            <h2 id="safety-title">${esc(s.safetyTitle)}</h2>
            <p><strong>${esc(a['about.experimental'])}</strong></p>
            <p><strong>${esc(a['about.noWarranty'])}</strong></p>
            <p>${esc(s.safetyAdvice)}</p>
          </div>
        </div>
      </section>

      <section id="features" aria-labelledby="features-title">
        <div class="wrap">
          <h2 id="features-title">${esc(s.featuresTitle)}</h2>
          <div class="grid">
          ${features}
          </div>
          <figure>
            <img class="shot" src="${img('runtime')}" alt="${esc(s.shotRuntimeAlt)}" width="1200" height="806" loading="lazy">
            <figcaption>${esc(s.shotRuntimeAlt)}</figcaption>
          </figure>
        </div>
      </section>

      <section aria-labelledby="releases-title">
        <div class="wrap">
          <h2 id="releases-title">${esc(s.releasesTitle)}</h2>
          <p>${esc(s.releasesBody)}</p>
          <ul class="releases">
            ${RELEASE_ROWS.map(
              ([v, name, eol]) =>
                `<li${eol ? ' class="eol"' : ''}><strong>Ubuntu ${esc(v)}</strong> <span>${esc(name)}</span></li>`,
            ).join('\n            ')}
          </ul>
          <p class="note">${esc(s.releaseEol)}</p>
          <p class="note">${esc(s.limitsNote)}</p>
        </div>
      </section>

      <section id="how" aria-labelledby="how-title">
        <div class="wrap">
          <h2 id="how-title">${esc(s.howTitle)}</h2>
          <ol class="steps">
            <li>${esc(s.howStep1)}</li>
            <li>${esc(s.howStep2)}</li>
            <li>${esc(s.howStep3)}</li>
          </ol>
          <p>${esc(s.howBody)}</p>
          <p>${esc(s.noImages)}</p>
        </div>
      </section>

      <section id="download" aria-labelledby="download-title">
        <div class="wrap">
          <h2 id="download-title">${esc(s.downloadTitle)}</h2>
          ${version ? `<p class="version">${esc(version)}</p>` : ''}
          <div class="downloads">
            <div class="platform">
              <h3>Windows <span>x64</span></h3>
              ${dl('winSetup', s.installer)}
              ${dl('winPortable', s.portable)}
            </div>
            <div class="platform">
              <h3>macOS <span>Apple Silicon</span></h3>
              ${dl('macArmDmg', `${s.installer} (.dmg)`)}
              ${dl('macArmZip', `${s.portable} (.zip)`)}
            </div>
            <div class="platform">
              <h3>macOS <span>Intel</span></h3>
              ${dl('macX64Dmg', `${s.installer} (.dmg)`)}
              ${dl('macX64Zip', `${s.portable} (.zip)`)}
            </div>
            <div class="platform">
              <h3>Linux <span>x64</span></h3>
              ${dl('linuxDeb', `${s.installer} (.deb)`)}
            </div>
          </div>
          <p class="links"><a href="${esc(asset('sums').url)}">${esc(s.checksums)} (SHA256SUMS.txt)</a> · <a href="${REPO_URL}/releases">${esc(s.allReleases)}</a></p>
          <div class="unsigned">
            <h3>${esc(s.unsignedTitle)}</h3>
            <p>${esc(s.unsignedWindows)}</p>
            <p>${esc(s.unsignedMac)}</p>
            <pre><code>xattr -dr com.apple.quarantine "/Applications/Seedstick.app"</code></pre>
          </div>
          <p class="note">${esc(s.imageNotice)}</p>
        </div>
      </section>

      <section aria-label="${esc(s.translationsLabel)}">
        <div class="wrap">
          <p class="note">${esc(s.translationNote)} <a href="${REPO_URL}/blob/main/CONTRIBUTING.md#translations">${esc(s.translationHelp)}</a></p>
        </div>
      </section>
    </main>

    <footer>
      <div class="wrap">
        <p>${esc(a['about.license'])} · <a href="${REPO_URL}/blob/main/LICENSE">LICENSE</a> · <a href="${REPO_URL}/blob/main/docs/LEGAL.md">LEGAL</a> · <a href="${REPO_URL}">GitHub</a></p>
        <p>${esc(a['about.disclaimer'])}</p>
        <p>${esc(a['about.trademarks'])}</p>
      </div>
    </footer>
    <script>
      // 言語を選んだら覚える（次に来たときの自動選択より優先する）
      for (const el of document.querySelectorAll('.lang a[data-locale]')) {
        el.addEventListener('click', () => {
          try { localStorage.setItem('seedstick-locale', el.dataset.locale) } catch {}
        })
      }
    </script>${locale === DEFAULT_LOCALE ? `\n    <script>${NEGOTIATE}</script>` : ''}
  </body>
</html>
`
}

/**
 * 既定（英語）のページに来た人を、ブラウザの言語に合わせて振り分ける。
 * 規則はアプリと同じ（中国語は文字体系で分け、pt は pt-BR、他は第 1 サブタグ）。
 * 一度でも言語を選んだ人は振り分けない。
 */
const NEGOTIATE = `
(() => {
  const locales = ${JSON.stringify(LOCALES)}
  let chosen = null
  try { chosen = localStorage.getItem('seedstick-locale') } catch {}
  if (chosen) return
  const match = (tag) => {
    const lower = String(tag).trim().replace(/_/g, '-').toLowerCase()
    if (!lower) return null
    for (const id of locales) if (id.toLowerCase() === lower) return id
    const primary = lower.split('-')[0]
    if (primary === 'zh') return /-(hant|tw|hk|mo)(-|$)/.test(lower) ? 'zh-Hant' : 'zh-Hans'
    if (primary === 'pt') return 'pt-BR'
    for (const id of locales) if (id.toLowerCase().split('-')[0] === primary) return id
    return null
  }
  for (const tag of navigator.languages || [navigator.language]) {
    const hit = match(tag)
    if (hit) {
      if (hit !== '${DEFAULT_LOCALE}') location.replace('./' + hit + '/' + location.hash)
      return
    }
  }
})()`

// --- 書き出し -------------------------------------------------------------------

// フォルダそのものではなく中身を消す（Windows では、確認用のサーバーが
// そのフォルダを開いているとフォルダごとは消せない）
mkdirSync(OUT, { recursive: true })
for (const entry of readdirSync(OUT)) rmSync(join(OUT, entry), { recursive: true, force: true })
mkdirSync(join(OUT, 'img'), { recursive: true })
for (const l of LOCALES) {
  const dir = l === DEFAULT_LOCALE ? OUT : join(OUT, l)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'index.html'), page(l))
}
copyFileSync(join(ROOT, 'docs-site', 'style.css'), join(OUT, 'style.css'))
copyFileSync(join(ROOT, 'apps', 'desktop', 'build', 'icon.png'), join(OUT, 'icon.png'))
for (const f of readdirSync(join(ROOT, 'docs-site', 'img'))) {
  copyFileSync(join(ROOT, 'docs-site', 'img', f), join(OUT, 'img', f))
}
console.log(`site-dist: ${LOCALES.length} languages`)
