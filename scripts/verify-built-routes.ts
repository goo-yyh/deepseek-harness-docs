import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { LOCALES, localizedRoute, readJson, type ContentMap, type SeoMetadata } from './projection-model.ts'

interface Redirects { redirects: Array<{ source: string; destination: string; permanent: boolean }> }
const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const contentMap = readJson<ContentMap>(resolve(root, 'config/content-map.json'))
const seo = readJson<SeoMetadata>(resolve(root, 'config/seo-metadata.json'))
const redirects = readJson<Redirects>(resolve(root, 'config/redirects.json')).redirects
const vercel = readJson<Redirects>(resolve(root, 'vercel.json')).redirects
const errors: string[] = []
const astroRedirects = [
  { source: '/', destination: '/start', file: resolve(dist, 'index.html') },
  { source: '/en', destination: '/en/start', file: resolve(dist, 'en/index.html') },
  {
    source: '/api/cordis/inherited',
    destination: '/en/api/cordis/inherited',
    file: resolve(dist, 'api/cordis/inherited/index.html'),
  },
]
let expected = 0
for (const target of contentMap.target_pages) {
  for (const locale of LOCALES) {
    if (seo.pages[target.page_id]?.[locale] == null) continue
    expected += 1
    const route = localizedRoute(target.neutral_route, locale)
    if (!existsSync(resolve(dist, route.replace(/^\//, ''), 'index.html'))) errors.push(`missing ${route}`)
  }
}
function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}
if (files(dist).some(file => /\/(?:ja|ko)(?:\/|\.)/.test(file.slice(dist.length)))) errors.push('dist contains Japanese or Korean routes')
for (const redirect of astroRedirects) {
  if (!existsSync(redirect.file)) {
    errors.push(`missing Astro redirect ${redirect.source}`)
    continue
  }
  const html = readFileSync(redirect.file, 'utf8')
  if (!html.includes(`http-equiv="refresh" content="0;url=${redirect.destination}"`)) {
    errors.push(`${redirect.source} does not redirect to ${redirect.destination}`)
  }
  if (!html.includes('<meta name="robots" content="noindex">')) errors.push(`${redirect.source} redirect is indexable`)
  if (!html.includes(`rel="canonical" href="https://www.deepseek-harness-docs.com${redirect.destination}"`)) {
    errors.push(`${redirect.source} redirect has the wrong canonical`)
  }
}
if (JSON.stringify(redirects) !== JSON.stringify(vercel)) errors.push('vercel redirects differ from config/redirects.json')
const sources = new Set(redirects.map(item => item.source))
for (const redirect of redirects) {
  if (!redirect.permanent) errors.push(`${redirect.source} is not permanent`)
  if (redirect.source === redirect.destination) errors.push(`${redirect.source} redirects to itself`)
  if (sources.has(redirect.destination)) errors.push(`${redirect.source} creates a redirect chain through ${redirect.destination}`)
}
if (new Set(redirects.map(item => item.source)).size !== redirects.length) errors.push('redirect sources are duplicated')
if (errors.length > 0) throw new Error(`docs:routes failed:\n- ${errors.join('\n- ')}`)
console.log(`docs:routes: ${expected} Astro pages, ${astroRedirects.length} local entry redirects, and ${redirects.length} one-hop deployment redirects passed; no ja/ko output exists.`)
