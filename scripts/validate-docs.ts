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
  module_counts: Record<string, number>
  pages: Array<{
    id: string
    route: string
    module: string
    locales: Record<string, { source: string; source_kind: string }>
  }>
}

interface LocalesConfig {
  locales: Array<{ id: string; published: boolean; source: string }>
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
if (manifest.canonical_page_count * 2 !== manifest.published_route_count) {
  fail('first-version publication must contain exactly two official routes per canonical page')
}

const rootPages = docsPages.filter(page => page.locale === 'root')
const enPages = docsPages.filter(page => page.locale === 'en')
if (rootPages.length !== manifest.canonical_page_count || enPages.length !== manifest.canonical_page_count) {
  fail('official locale route counts are not isomorphic')
}

const routes = new Set(docsPages.map(page => routeLink(page.route)))
if (routes.size !== docsPages.length) fail('duplicate public route')
for (const page of docsPages) {
  if (page.locale !== 'root' && page.locale !== 'en') fail(`unpublished locale leaked into route ${page.route}`)
}

const expectedModules = { guide: 3, develop: 17, reference: 62 }
for (const [module, expected] of Object.entries(expectedModules)) {
  if (manifest.module_counts[module] !== expected) fail(`${module} canonical count must be ${expected}`)
}

const publishedLocales = locales.locales.filter(locale => locale.published).map(locale => locale.id)
if (JSON.stringify(publishedLocales) !== JSON.stringify(['zh-CN', 'en-US'])) {
  fail('first version must publish only zh-CN and en-US')
}
for (const id of ['ja-JP', 'ko-KR']) {
  const locale = locales.locales.find(item => item.id === id)
  if (locale === undefined || locale.published) fail(`${id} must remain configured but unpublished in the first version`)
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
  if (!publishedSourcePaths.has(page.source)) fail(`route ${page.route} has no locked source record`)
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
  `docs:check: ${manifest.canonical_page_count} canonical pages, ${docsPages.length} official routes, `
  + `${lock.published_sources.length} locked source files, ${lock.pairing_records.length} pairing records passed.`,
)

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
