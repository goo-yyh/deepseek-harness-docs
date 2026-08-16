/** Verify that VitePress emitted every official first-version route and no ja/ko routes. */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { docsPages } from '../website/docs.ts'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'website/.dist')
const missing: string[] = []
const fallbackRoute = '/reference/cordis-api/inherited'
const fallbackDestination = '/en/reference/cordis-api/inherited'

for (const page of docsPages) {
  const output = resolve(dist, page.route.replace(/\.md$/, '.html'))
  if (!existsSync(output)) missing.push(page.route)
}

if (missing.length > 0) {
  throw new Error(`docs:routes: missing ${missing.length} route(s): ${missing.slice(0, 10).join(', ')}`)
}
for (const locale of ['ja', 'ko']) {
  if (existsSync(resolve(dist, locale))) throw new Error(`docs:routes: unpublished /${locale}/ tree was generated`)
}

const home = readFileSync(resolve(dist, 'index.html'), 'utf8')
const englishHome = readFileSync(resolve(dist, 'en/index.html'), 'utf8')
if (!home.includes('url=./guide/quickstart') || !englishHome.includes('url=./guide/quickstart')) {
  throw new Error('docs:routes: official locale home redirects changed')
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
  `docs:routes: ${docsPages.length} official HTML routes passed; ja/ko remain unpublished; `
  + 'the inherited fallback redirect passed.',
)
