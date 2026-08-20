import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { LOCALES, SITE_ORIGIN, localizedRoute, readJson, type ContentMap, type SeoMetadata, type UpstreamLock } from './projection-model.ts'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const contentMap = readJson<ContentMap>(resolve(root, 'config/content-map.json'))
const seo = readJson<SeoMetadata>(resolve(root, 'config/seo-metadata.json'))
const upstream = readJson<UpstreamLock & { commit_time?: string }>(resolve(root, 'config/upstream-lock.json'))
if (!existsSync(dist)) throw new Error('sitemap:build: dist is missing; run astro build first.')
for (const file of readdirSync(dist).filter(name => /^sitemap(?:-|\.|_)/.test(name))) rmSync(resolve(dist, file), { force: true })

const escape = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const lastmod = upstream.commit_time?.slice(0, 10)
const urls: string[] = []
for (const target of contentMap.target_pages) {
  for (const locale of LOCALES) {
    const metadata = seo.pages[target.page_id]?.[locale]
    if (metadata === null || metadata === undefined || metadata.indexability !== 'index') continue
    const alternates = LOCALES.flatMap((alternateLocale) => {
      const alternateMetadata = seo.pages[target.page_id]?.[alternateLocale]
      return alternateMetadata === null || alternateMetadata === undefined || alternateMetadata.indexability !== 'index'
        ? []
        : [{ locale: alternateLocale, url: `${SITE_ORIGIN}${localizedRoute(target.neutral_route, alternateLocale)}` }]
    })
    const defaultAlternate = alternates.find(item => item.locale === 'zh-CN') ?? alternates[0]
    const loc = `${SITE_ORIGIN}${localizedRoute(target.neutral_route, locale)}`
    urls.push([
      '  <url>',
      `    <loc>${escape(loc)}</loc>`,
      ...alternates.map(item => `    <xhtml:link rel="alternate" hreflang="${item.locale === 'zh-CN' ? 'zh-CN' : 'en'}" href="${escape(item.url)}" />`),
      ...(defaultAlternate === undefined ? [] : [`    <xhtml:link rel="alternate" hreflang="x-default" href="${escape(defaultAlternate.url)}" />`]),
      ...(lastmod === undefined ? [] : [`    <lastmod>${lastmod}</lastmod>`]),
      '  </url>',
    ].join('\n'))
  }
}
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`
writeFileSync(resolve(dist, 'sitemap.xml'), xml)
console.log(`sitemap:build: wrote ${urls.length} canonical URLs to dist/sitemap.xml.`)
