/** Fail-closed validation for the pinned bilingual DeepSeek Harness publication. */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { docsPages, routeLink } from '../website/docs.ts'

interface LockedFile {
  path: string
  git_blob: string
  sha256: string
  bytes: number
}

interface UpstreamLock {
  commit: string
  tree: string
  publication_fingerprint: string
  controls: LockedFile[]
  published_sources: LockedFile[]
  pairing_records: LockedFile[]
}

interface PublicationManifest {
  upstream_commit: string
  canonical_page_count: number
  published_route_count: number
  official_locales: string[]
  module_counts: Record<string, number>
  pages: Array<{
    id: string
    route: string
    module: string
    locales: Record<string, { source: string; source_kind: string }>
  }>
}

interface LocalesConfig {
  locales: Array<{
    id: string
    vitepress_key: 'root' | 'en' | 'ja' | 'ko'
    path_prefix: string
    published: boolean
    source: 'official' | 'codex'
  }>
}

interface AdapterRecord {
  path: string
  upstream_sha256: string
  local_sha256: string
  reason: string
}

interface AdapterLock {
  upstream_commit: string
  adapters: AdapterRecord[]
}

const root = resolve(import.meta.dirname, '..')
const lock = readJson<UpstreamLock>('config/upstream-lock.json')
const manifest = readJson<PublicationManifest>('config/docs-manifest.json')
const locales = readJson<LocalesConfig>('config/locales.json')
const adapter = readJson<AdapterLock>('config/adapter-lock.json')

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8')) as T
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function gitBlob(bytes: Buffer): string {
  return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex')
}

function fail(message: string): never {
  throw new Error(`docs:check: ${message}`)
}

function validateLockedFile(file: LockedFile, requireOfficialBytes = true): void {
  const path = resolve(root, file.path)
  if (!existsSync(path) || !statSync(path).isFile()) fail(`missing locked file ${file.path}`)
  const bytes = readFileSync(path)
  if (bytes.byteLength !== file.bytes) fail(`byte length drift in ${file.path}`)
  if (sha256(bytes) !== file.sha256) fail(`SHA-256 drift in ${file.path}`)
  if (requireOfficialBytes && gitBlob(bytes) !== file.git_blob) fail(`Git blob drift in ${file.path}`)
}

if (!/^[0-9a-f]{40}$/.test(lock.commit)) fail('upstream commit is not a full SHA-1')
if (manifest.upstream_commit !== lock.commit) fail('manifest and upstream lock commit differ')
if (docsPages.length !== manifest.published_route_count) fail('publication route count differs from manifest')
if (manifest.pages.length !== manifest.canonical_page_count) fail('canonical page inventory differs from manifest')

const configuredLocaleKeys = new Set(locales.locales.map(locale => locale.vitepress_key))
if (configuredLocaleKeys.size !== locales.locales.length) fail('locale config contains duplicate VitePress keys')
const configuredLocaleIds = new Set(locales.locales.map(locale => locale.id))
if (configuredLocaleIds.size !== locales.locales.length) fail('locale config contains duplicate locale IDs')
const officialLocaleIds = locales.locales.filter(locale => locale.source === 'official').map(locale => locale.id)
if (JSON.stringify(officialLocaleIds) !== JSON.stringify(['zh-CN', 'en-US'])) {
  fail('official source locales must remain zh-CN and en-US')
}
if (JSON.stringify(manifest.official_locales) !== JSON.stringify(officialLocaleIds)) {
  fail('manifest official locales differ from locale config')
}
for (const required of [
  { id: 'zh-CN', key: 'root', prefix: '/', source: 'official' },
  { id: 'en-US', key: 'en', prefix: '/en/', source: 'official' },
  { id: 'ja-JP', key: 'ja', prefix: '/ja/', source: 'codex' },
  { id: 'ko-KR', key: 'ko', prefix: '/ko/', source: 'codex' },
] as const) {
  const locale = locales.locales.find(item => item.id === required.id)
  if (
    locale === undefined
    || locale.vitepress_key !== required.key
    || locale.path_prefix !== required.prefix
    || locale.source !== required.source
  ) {
    fail(`locale config contract changed for ${required.id}`)
  }
}
for (const id of ['zh-CN', 'en-US']) {
  if (!locales.locales.find(locale => locale.id === id)?.published) fail(`${id} official locale must be published`)
}

const publishedLocales = locales.locales.filter(locale => locale.published)
const publishedLocaleKeys = new Set(publishedLocales.map(locale => locale.vitepress_key))
const expectedPublishedRouteCount = manifest.canonical_page_count * publishedLocales.length
if (manifest.published_route_count !== expectedPublishedRouteCount) {
  fail(
    `published route count must be ${manifest.canonical_page_count} canonical pages × `
    + `${publishedLocales.length} published locales = ${expectedPublishedRouteCount}`,
  )
}

const manifestRoutes = new Set(manifest.pages.map(page => page.route))
if (manifestRoutes.size !== manifest.canonical_page_count) fail('manifest contains duplicate canonical routes')
const manifestIds = new Set(manifest.pages.map(page => page.id))
if (manifestIds.size !== manifest.canonical_page_count) fail('manifest contains duplicate canonical page IDs')
for (const locale of locales.locales) {
  const localePages = docsPages.filter(page => page.locale === locale.vitepress_key)
  if (!locale.published) {
    if (localePages.length !== 0) fail(`unpublished ${locale.id} locale leaked ${localePages.length} route(s)`)
    continue
  }
  if (localePages.length !== manifest.canonical_page_count) {
    fail(`${locale.id} publishes ${localePages.length} routes; expected ${manifest.canonical_page_count}`)
  }
  const neutralRoutes = new Set(localePages.map((page) => {
    const route = routeLink(page.route)
    return route.replace(/^\/(?:en|ja|ko)(?=\/)/, '')
  }))
  if (neutralRoutes.size !== manifestRoutes.size || [...manifestRoutes].some(route => !neutralRoutes.has(route))) {
    fail(`${locale.id} route tree is not isomorphic with the canonical manifest`)
  }
  if (
    locale.source === 'codex'
    && localePages.some(page => page.contentLocale !== locale.id || page.canonicalSource === undefined)
  ) {
    fail(`${locale.id} must publish only native translations bound to canonical English sources`)
  }
}

const routes = new Set(docsPages.map(page => routeLink(page.route)))
if (routes.size !== docsPages.length) fail('duplicate public route')
for (const page of docsPages) {
  if (!publishedLocaleKeys.has(page.locale)) fail(`unpublished locale leaked into route ${page.route}`)
}

const expectedModules = { guide: 3, develop: 17, reference: 62 }
for (const [module, expected] of Object.entries(expectedModules)) {
  if (manifest.module_counts[module] !== expected) fail(`${module} canonical count must be ${expected}`)
}

const adaptedControls = new Set(adapter.adapters.map(record => record.path))
for (const file of lock.controls) {
  if (!adaptedControls.has(file.path)) validateLockedFile(file)
}
for (const file of lock.published_sources) validateLockedFile(file)
for (const file of lock.pairing_records) validateLockedFile(file)

if (adapter.upstream_commit !== lock.commit) fail('adapter lock is not bound to the current upstream commit')
if (adaptedControls.size !== adapter.adapters.length) fail('adapter lock contains duplicate control paths')
for (const record of adapter.adapters) {
  const upstreamAdapter = lock.controls.find(file => file.path === record.path)
  if (upstreamAdapter === undefined) fail(`adapter lock has no upstream control record for ${record.path}`)
  if (record.upstream_sha256 !== upstreamAdapter.sha256) {
    fail(`adapter lock is not bound to the current upstream bytes for ${record.path}`)
  }
  if (sha256(readFileSync(resolve(root, record.path))) !== record.local_sha256) {
    fail(`local adapted control changed without review: ${record.path}`)
  }
}

const publishedSourcePaths = new Set(lock.published_sources.map(file => file.path))
for (const page of docsPages) {
  if (page.locale === 'root' || page.locale === 'en') {
    if (!publishedSourcePaths.has(page.source)) fail(`official route ${page.route} has no locked source record`)
  } else if (page.canonicalSource === undefined || !publishedSourcePaths.has(page.canonicalSource)) {
    fail(`translated route ${page.route} has no locked English source record`)
  }
}

for (const record of lock.pairing_records) {
  const text = readFileSync(resolve(root, record.path), 'utf8')
  const base = record.path.replace(/\.i18n\.yaml$/, '')
  const enPath = `${base}.md`
  const zhPath = `${base}.zh.md`
  const enHash = text.match(new RegExp(`^${escapeRegExp(enPath.split('/').at(-1) ?? '')}: ([0-9a-f]{40})$`, 'm'))?.[1]
  const zhHash = text.match(new RegExp(`^${escapeRegExp(zhPath.split('/').at(-1) ?? '')}: ([0-9a-f]{40})$`, 'm'))?.[1]
  if (enHash === undefined || zhHash === undefined) fail(`invalid pairing record ${record.path}`)
  if (gitBlob(readFileSync(resolve(root, enPath))) !== enHash) fail(`English pair hash mismatch for ${enPath}`)
  if (gitBlob(readFileSync(resolve(root, zhPath))) !== zhHash) fail(`Chinese pair hash mismatch for ${zhPath}`)
}

const fallbackPages = manifest.pages.filter(page => page.locales['zh-CN']?.source_kind === 'upstream_english_fallback')
if (fallbackPages.length !== 1 || fallbackPages[0]?.locales['zh-CN']?.source !== 'docs/cordis-api/inherited.md') {
  fail('the official inherited.md Chinese-route fallback contract changed')
}

console.log(
  `docs:check: ${manifest.canonical_page_count} canonical pages, ${docsPages.length} routes across `
  + `${publishedLocales.length} published locales, `
  + `${lock.published_sources.length} locked source files, ${lock.pairing_records.length} pairing records passed.`,
)

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
