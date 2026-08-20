import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { LOCALES, SITE_ORIGIN, localizedRoute, readJson, stableJson, type ContentMap, type SeoMetadata } from './projection-model.ts'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const contentMap = readJson<ContentMap>(resolve(root, 'config/content-map.json'))
const seo = readJson<SeoMetadata>(resolve(root, 'config/seo-metadata.json'))
const sitemap = readFileSync(resolve(dist, 'sitemap.xml'), 'utf8')
const sitemapUrls = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]?.replaceAll('&amp;', '&') ?? ''))
const errors: string[] = []
let indexable = 0
let noindex = 0

function htmlPath(route: string): string {
  return resolve(dist, route.replace(/^\//, ''), 'index.html')
}
function attr(html: string, tagPattern: string, name: string): string | undefined {
  const tag = html.match(new RegExp(tagPattern, 'i'))?.[0]
  return tag?.match(new RegExp(`${name}=(["'])(.*?)\\1`, 'i'))?.[2]
    ?.replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
}
function hasMeta(html: string, key: 'name' | 'property', value: string, content: string): boolean {
  const tags = html.match(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []
  return tags.some(tag => attr(tag, '<meta\\b(?:[^>"\']|"[^"]*"|\'[^\']*\')*>', key) === value && attr(tag, '<meta\\b(?:[^>"\']|"[^"]*"|\'[^\']*\')*>', 'content') === content)
}

for (const target of contentMap.target_pages) {
  for (const locale of LOCALES) {
    const metadata = seo.pages[target.page_id]?.[locale]
    if (metadata === null || metadata === undefined) continue
    const route = localizedRoute(target.neutral_route, locale)
    const file = htmlPath(route)
    if (!existsSync(file)) {
      errors.push(`${route} was not built`)
      continue
    }
    const html = readFileSync(file, 'utf8')
    const canonical = `${SITE_ORIGIN}${route}`
    if (!new RegExp(`<html[^>]+lang=["']${locale === 'zh-CN' ? 'zh-CN' : 'en-US'}["']`, 'i').test(html)) errors.push(`${route} has wrong html lang`)
    if (!html.includes(`<title>${metadata.title} | DeepSeek Harness Docs</title>`)) errors.push(`${route} has wrong title`)
    if (!hasMeta(html, 'name', 'description', metadata.description)) errors.push(`${route} has wrong description`)
    const linkTags = html.match(/<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []
    const canonicalTag = linkTags.find(tag => attr(tag, '<link\\b(?:[^>"\']|"[^"]*"|\'[^\']*\')*>', 'rel') === 'canonical')
    if (canonicalTag === undefined || attr(canonicalTag, '<link\\s+[^>]*>', 'href') !== canonical) errors.push(`${route} has wrong canonical`)
    const shouldIndex = metadata.indexability === 'index'
    if (!hasMeta(html, 'name', 'robots', shouldIndex ? 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1' : 'noindex, follow')) errors.push(`${route} has wrong robots`)
    if (!hasMeta(html, 'property', 'og:url', canonical)) errors.push(`${route} has wrong og:url`)
    if (!hasMeta(html, 'name', 'twitter:description', metadata.description)) errors.push(`${route} has wrong Twitter description`)
    if (!html.includes('application/ld+json') || !html.includes(`"url":"${canonical}"`)) errors.push(`${route} has incomplete JSON-LD`)
    if (shouldIndex) {
      indexable += 1
      if (!sitemapUrls.has(canonical)) errors.push(`${route} is missing from sitemap`)
    } else {
      noindex += 1
      if (sitemapUrls.has(canonical)) errors.push(`${route} is noindex but appears in sitemap`)
    }
  }
}
for (const url of sitemapUrls) {
  if (!url.startsWith(`${SITE_ORIGIN}/`) || /\/(?:ja|ko)(?:\/|$)/.test(new URL(url).pathname)) errors.push(`invalid sitemap URL ${url}`)
}
const report = { schema_version: 2, status: errors.length === 0 ? 'passed' : 'failed', indexable, noindex, sitemap_urls: sitemapUrls.size, locales: LOCALES, errors }
writeFileSync(resolve(root, 'reports/seo-audit.json'), stableJson(report))
if (errors.length > 0) throw new Error(`seo:audit failed with ${errors.length} issue(s):\n${errors.slice(0, 40).join('\n')}`)
console.log(`seo:audit: ${indexable} indexable and ${noindex} noindex zh/en pages passed.`)
