/** Verify that VitePress emitted exactly the route trees enabled by locale publication state. */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { docsPages } from '../website/docs.ts'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'website/.dist')
const missing: string[] = []
const fallbackRoute = '/reference/cordis-api/inherited'
const fallbackDestination = '/en/reference/cordis-api/inherited'
const manifest = JSON.parse(readFileSync(resolve(root, 'config/docs-manifest.json'), 'utf8')) as {
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

function localeOutputRoot(locale: (typeof localeConfig.locales)[number]): string {
  return locale.vitepress_key === 'root' ? dist : resolve(dist, locale.vitepress_key)
}

function htmlFileCount(path: string): number {
  if (!existsSync(path)) return 0
  return readdirSync(path).reduce((count, entry) => {
    const child = resolve(path, entry)
    if (statSync(child).isDirectory()) return count + htmlFileCount(child)
    return count + (entry.endsWith('.html') ? 1 : 0)
  }, 0)
}

const expectedRouteCount = manifest.canonical_page_count * publishedLocales.length
if (docsPages.length !== expectedRouteCount || manifest.published_route_count !== expectedRouteCount) {
  throw new Error(
    `docs:routes: route inventory differs from ${manifest.canonical_page_count} canonical pages × `
    + `${publishedLocales.length} published locales`,
  )
}

for (const page of docsPages) {
  const output = resolve(dist, page.route.replace(/\.md$/, '.html'))
  if (!existsSync(output)) missing.push(page.route)
}

if (missing.length > 0) {
  throw new Error(`docs:routes: missing ${missing.length} route(s): ${missing.slice(0, 10).join(', ')}`)
}

for (const locale of localeConfig.locales) {
  const localePages = docsPages.filter(page => page.locale === locale.vitepress_key)
  const outputRoot = localeOutputRoot(locale)
  if (!locale.published) {
    if (localePages.length !== 0 || existsSync(outputRoot)) {
      throw new Error(`docs:routes: unpublished ${locale.id} route tree was generated`)
    }
    continue
  }
  if (localePages.length !== manifest.canonical_page_count) {
    throw new Error(`docs:routes: ${locale.id} route tree is incomplete`)
  }
  const homePath = locale.vitepress_key === 'root'
    ? resolve(dist, 'index.html')
    : resolve(outputRoot, 'index.html')
  const home = readFileSync(homePath, 'utf8')
  if (!home.includes('url=./guide/quickstart')) {
    throw new Error(`docs:routes: ${locale.id} locale-home redirect changed`)
  }
  if (locale.vitepress_key !== 'root' && htmlFileCount(outputRoot) !== manifest.canonical_page_count) {
    throw new Error(`docs:routes: ${locale.id} output tree contains an unexpected number of HTML files`)
  }
}

const vercel = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8')) as {
  redirects?: Array<{ source?: string; destination?: string; permanent?: boolean }>
}
const fallbackRedirect = vercel.redirects?.filter(redirect => redirect.source === fallbackRoute) ?? []
if (
  fallbackRedirect.length !== 1
  || fallbackRedirect[0]?.destination !== fallbackDestination
  || fallbackRedirect[0]?.permanent !== true
) {
  throw new Error(`docs:routes: ${fallbackRoute} must permanently redirect to ${fallbackDestination} on Vercel`)
}

console.log(
  `docs:routes: ${docsPages.length} HTML routes across ${publishedLocales.length} published locales passed; `
  + 'the inherited fallback redirect passed.',
)
