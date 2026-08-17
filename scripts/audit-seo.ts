/** Audit every rendered locale page against the manifest-driven SEO contract. */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { docsPages } from '../website/docs.ts'
import {
  pageIsIndexable,
  resolveDocsSeo,
  SITEMAP_URL,
  SITE_ORIGIN,
} from '../website/seo.ts'

interface AuditEntry {
  route: string
  output: string
  content_locale: string
  indexable: boolean
  title: string
  description: string
  description_sha256: string
  canonical: string
  alternates: Record<string, string>
  status: 'passed'
}

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'website/.dist')
const manifest = JSON.parse(readFileSync(resolve(root, 'config/docs-manifest.json'), 'utf8')) as {
  upstream_commit: string
  canonical_page_count: number
  published_route_count: number
}
const localeConfig = JSON.parse(readFileSync(resolve(root, 'config/locales.json'), 'utf8')) as {
  locales: Array<{
    id: string
    vitepress_key: 'root' | 'en' | 'ja' | 'ko'
    path_prefix: string
    published: boolean
  }>
}
const publishedLocales = localeConfig.locales.filter(locale => locale.published)
const localeByKey = new Map(localeConfig.locales.map(locale => [locale.vitepress_key, locale]))
const hreflangByLocaleId = new Map([
  ['zh-CN', 'zh-CN'],
  ['en-US', 'en'],
  ['ja-JP', 'ja'],
  ['ko-KR', 'ko'],
])
const issues: string[] = []
const entries: AuditEntry[] = []
const indexableTitles = new Map<string, string>()
const indexableDescriptions = new Map<string, string>()

function fail(route: string, message: string): void {
  issues.push(`${route}: ${message}`)
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', quot: '"',
  }
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_match, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
    return named[entity.toLowerCase()] ?? `&${entity};`
  })
}

function attribute(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = tag.match(new RegExp(`(?:^|\\s)${escaped}=(?:"([^"]*)"|'([^']*)')`, 'i'))
  return match === null ? undefined : decodeEntities(match[1] ?? match[2] ?? '')
}

function tags(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map(match => match[0])
}

function matchingMeta(html: string, key: 'name' | 'property', value: string): string[] {
  return tags(html, 'meta').filter(tag => attribute(tag, key) === value)
}

function oneContent(route: string, html: string, key: 'name' | 'property', value: string): string {
  const matches = matchingMeta(html, key, value)
  if (matches.length !== 1) {
    fail(route, `expected one ${key}=${value} meta tag, found ${matches.length}`)
    return ''
  }
  const content = attribute(matches[0] ?? '', 'content')
  if (content === undefined || content.trim() === '') fail(route, `${key}=${value} has empty content`)
  return content ?? ''
}

function allContents(html: string, key: 'name' | 'property', value: string): string[] {
  return matchingMeta(html, key, value).map(tag => attribute(tag, 'content') ?? '')
}

function oneLink(route: string, html: string, rel: string): string {
  const matches = tags(html, 'link').filter(tag => attribute(tag, 'rel') === rel)
  if (matches.length !== 1) {
    fail(route, `expected one rel=${rel} link, found ${matches.length}`)
    return ''
  }
  return attribute(matches[0] ?? '', 'href') ?? ''
}

function pageTitle(html: string): string {
  return decodeEntities(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '')
}

function baseTitle(fullTitle: string): string {
  const suffix = ' | DeepSeek Harness'
  return fullTitle.endsWith(suffix) ? fullTitle.slice(0, -suffix.length) : fullTitle
}

function publicRoute(route: string): string {
  return `/${route.replace(/(?:index)?\.md$/, '')}`
}

function outputPath(route: string): string {
  return resolve(dist, route.replace(/\.md$/, '.html'))
}

function assertLocalizedDescription(route: string, contentLocale: string, description: string): void {
  if (contentLocale === 'ja-JP' && !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(description)) {
    fail(route, 'Japanese SEO description does not contain Japanese prose')
  }
  if (contentLocale === 'ko-KR' && !/\p{Script=Hangul}/u.test(description)) {
    fail(route, 'Korean SEO description does not contain Korean prose')
  }
}

const expectedRouteCount = manifest.canonical_page_count * publishedLocales.length
if (docsPages.length !== expectedRouteCount || manifest.published_route_count !== expectedRouteCount) {
  issues.push(
    `publication has ${docsPages.length} rendered routes and manifest count ${manifest.published_route_count}; `
    + `expected ${manifest.canonical_page_count} × ${publishedLocales.length} = ${expectedRouteCount}`,
  )
}

for (const page of docsPages) {
  const route = publicRoute(page.route)
  const locale = localeByKey.get(page.locale)
  if (locale === undefined || !locale.published) {
    fail(route, `route belongs to unconfigured or unpublished locale ${page.locale}`)
  } else if ((page.locale === 'ja' || page.locale === 'ko') && page.contentLocale !== locale.id) {
    fail(route, `${locale.id} route is an SEO fallback instead of native localized content`)
  }
  const output = outputPath(page.route)
  if (!existsSync(output)) {
    fail(route, 'rendered HTML is missing')
    continue
  }
  const html = readFileSync(output, 'utf8')
  const title = pageTitle(html)
  const seo = resolveDocsSeo(page, baseTitle(title))
  const lang = attribute(html.match(/<html\b[^>]*>/i)?.[0] ?? '', 'lang')
  if (lang !== seo.htmlLang) fail(route, `html lang ${JSON.stringify(lang)} != ${JSON.stringify(seo.htmlLang)}`)
  if (title !== seo.fullTitle) fail(route, `title ${JSON.stringify(title)} != ${JSON.stringify(seo.fullTitle)}`)

  const description = oneContent(route, html, 'name', 'description')
  if (description !== seo.description) fail(route, 'meta description differs from the localized source-derived description')
  if (description.length < 24 || description.length > 160) {
    fail(route, `meta description length ${description.length} is outside 24..160`)
  }
  assertLocalizedDescription(route, page.contentLocale, description)

  const canonical = oneLink(route, html, 'canonical')
  if (canonical !== seo.canonical) fail(route, `canonical ${JSON.stringify(canonical)} != ${JSON.stringify(seo.canonical)}`)
  if (seo.indexable && canonical !== new URL(route, `${SITE_ORIGIN}/`).href) {
    fail(route, `indexable localized page is not self-canonical: ${canonical}`)
  }
  if (oneLink(route, html, 'sitemap') !== SITEMAP_URL) fail(route, 'sitemap discovery link is incorrect')

  const alternateTags = tags(html, 'link').filter(tag => attribute(tag, 'rel') === 'alternate')
  const actualAlternates = new Map<string, string>()
  for (const tag of alternateTags) {
    const hreflang = attribute(tag, 'hreflang')
    const href = attribute(tag, 'href')
    if (hreflang === undefined || href === undefined) {
      fail(route, 'alternate link is missing hreflang or href')
      continue
    }
    if (actualAlternates.has(hreflang)) fail(route, `duplicate hreflang ${hreflang}`)
    actualAlternates.set(hreflang, href)
  }
  const expectedAlternates = new Map(seo.alternates.map(item => [item.hreflang, item.href]))
  if (JSON.stringify([...actualAlternates]) !== JSON.stringify([...expectedAlternates])) {
    fail(route, `hreflang set differs: ${JSON.stringify([...actualAlternates])}`)
  }
  const nativeHreflang = hreflangByLocaleId.get(page.contentLocale)
  if (seo.indexable && (nativeHreflang === undefined || actualAlternates.get(nativeHreflang) !== canonical)) {
    fail(route, 'indexable localized page has no self-referencing hreflang')
  }

  const robots = oneContent(route, html, 'name', 'robots')
  if (robots !== seo.robots) fail(route, `robots ${JSON.stringify(robots)} != ${JSON.stringify(seo.robots)}`)
  if (oneContent(route, html, 'property', 'og:site_name') !== 'DeepSeek Harness') fail(route, 'og:site_name differs')
  if (oneContent(route, html, 'property', 'og:locale') !== seo.ogLocale) fail(route, 'og:locale differs')
  const expectedOgAlternates = [...new Set(seo.alternates
    .filter(item => item.hreflang !== 'x-default' && item.ogLocale !== seo.ogLocale)
    .map(item => item.ogLocale))]
  const actualOgAlternates = allContents(html, 'property', 'og:locale:alternate')
  if (JSON.stringify(actualOgAlternates) !== JSON.stringify(expectedOgAlternates)) {
    fail(route, `og:locale:alternate differs: ${JSON.stringify(actualOgAlternates)}`)
  }
  if (oneContent(route, html, 'property', 'og:type') !== (seo.indexable ? 'article' : 'website')) {
    fail(route, 'og:type differs from the indexability contract')
  }
  if (oneContent(route, html, 'property', 'og:title') !== title) fail(route, 'og:title does not equal document title')
  if (oneContent(route, html, 'property', 'og:description') !== description) fail(route, 'og:description does not equal meta description')
  if (oneContent(route, html, 'property', 'og:url') !== canonical) fail(route, 'og:url does not equal canonical')
  if (oneContent(route, html, 'name', 'twitter:card') !== 'summary') fail(route, 'twitter:card differs')
  if (oneContent(route, html, 'name', 'twitter:title') !== title) fail(route, 'twitter:title does not equal document title')
  if (oneContent(route, html, 'name', 'twitter:description') !== description) {
    fail(route, 'twitter:description does not equal meta description')
  }

  const jsonLdMatches = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
  if (jsonLdMatches.length !== 1) {
    fail(route, `expected one JSON-LD block, found ${jsonLdMatches.length}`)
  } else {
    try {
      const data = JSON.parse(decodeEntities(jsonLdMatches[0]?.[1] ?? '')) as Record<string, unknown>
      if (data.name !== title) fail(route, 'JSON-LD name does not equal document title')
      if (data.headline !== baseTitle(title)) fail(route, 'JSON-LD headline does not equal the page title')
      if (data.url !== canonical) fail(route, 'JSON-LD url does not equal canonical')
      if (data.inLanguage !== seo.htmlLang) fail(route, 'JSON-LD inLanguage differs')
      if (data.description !== description) fail(route, 'JSON-LD description differs')
    } catch (error) {
      fail(route, `invalid JSON-LD: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (pageIsIndexable(page)) {
    const titleKey = `${seo.htmlLang}\0${title.toLocaleLowerCase(seo.htmlLang)}`
    const priorTitle = indexableTitles.get(titleKey)
    if (priorTitle !== undefined) fail(route, `duplicate indexable title also used by ${priorTitle}`)
    indexableTitles.set(titleKey, route)
    const descriptionKey = `${seo.htmlLang}\0${description.toLocaleLowerCase(seo.htmlLang)}`
    const priorDescription = indexableDescriptions.get(descriptionKey)
    if (priorDescription !== undefined) fail(route, `duplicate indexable description also used by ${priorDescription}`)
    indexableDescriptions.set(descriptionKey, route)
  }

  entries.push({
    route,
    output: output.slice(root.length + 1),
    content_locale: page.contentLocale,
    indexable: pageIsIndexable(page),
    title,
    description,
    description_sha256: createHash('sha256').update(description).digest('hex'),
    canonical,
    alternates: Object.fromEntries(actualAlternates),
    status: 'passed',
  })
}

for (const locale of localeConfig.locales) {
  const count = docsPages.filter(page => page.locale === locale.vitepress_key).length
  const expected = locale.published ? manifest.canonical_page_count : 0
  if (count !== expected) {
    issues.push(`${locale.id} has ${count} rendered routes; expected ${expected} for published=${locale.published}`)
  }
}

const sitemapPath = resolve(dist, 'sitemap.xml')
if (!existsSync(sitemapPath)) {
  issues.push('sitemap.xml is missing')
} else {
  const sitemap = readFileSync(sitemapPath, 'utf8')
  const blocks = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(match => match[1] ?? '')
  const expectedPages = docsPages.filter(pageIsIndexable)
  if (blocks.length !== expectedPages.length) {
    issues.push(`sitemap.xml has ${blocks.length} URLs; expected ${expectedPages.length}`)
  }
  const blockByLocation = new Map(blocks.map((block) => {
    const location = decodeEntities(block.match(/<loc>([\s\S]*?)<\/loc>/)?.[1] ?? '')
    return [location, block]
  }))
  if (blockByLocation.size !== blocks.length) issues.push('sitemap.xml contains duplicate URL locations')
  for (const page of expectedPages) {
    const seo = resolveDocsSeo(page)
    const block = blockByLocation.get(seo.canonical)
    if (block === undefined) {
      issues.push(`sitemap.xml is missing ${seo.canonical}`)
      continue
    }
    const links = tags(block, 'xhtml:link')
    const actual = new Map(links.map(tag => [attribute(tag, 'hreflang') ?? '', attribute(tag, 'href') ?? '']))
    const expected = new Map(seo.alternates.map(item => [item.hreflang, item.href]))
    if (JSON.stringify([...actual]) !== JSON.stringify([...expected])) {
      issues.push(`${seo.route}: sitemap hreflang set differs`)
    }
  }
  for (const locale of localeConfig.locales.filter(item => !item.published && item.vitepress_key !== 'root')) {
    const prefix = new URL(locale.path_prefix, `${SITE_ORIGIN}/`).href
    if ([...blockByLocation].some(([url]) => url.startsWith(prefix))) {
      issues.push(`sitemap.xml contains unpublished ${locale.id} URLs`)
    }
  }
}

const robotsPath = resolve(dist, 'robots.txt')
const expectedRobots = `User-agent: *\nAllow: /\n\nSitemap: ${SITEMAP_URL}\n`
if (!existsSync(robotsPath) || readFileSync(robotsPath, 'utf8') !== expectedRobots) {
  issues.push('robots.txt differs from the production crawl contract')
}

if (issues.length > 0) {
  throw new Error(`seo:audit failed with ${issues.length} issue(s):\n${issues.slice(0, 80).join('\n')}`)
}

const reportPath = resolve(root, 'reports/seo-audit.json')
mkdirSync(dirname(reportPath), { recursive: true })
writeFileSync(reportPath, `${JSON.stringify({
  schema_version: 1,
  site_origin: SITE_ORIGIN,
  upstream_commit: manifest.upstream_commit,
  pages_checked: entries.length,
  indexable_pages: entries.filter(entry => entry.indexable).length,
  noindex_pages: entries.filter(entry => !entry.indexable).length,
  sitemap_entries: docsPages.filter(pageIsIndexable).length,
  status: 'passed',
  pages: entries,
}, null, 2)}\n`)

console.log(
  `seo:audit: ${entries.length} HTML pages, ${entries.filter(entry => entry.indexable).length} indexable URLs, `
  + `${entries.filter(entry => !entry.indexable).length} noindex routes, and sitemap/robots passed.`,
)
