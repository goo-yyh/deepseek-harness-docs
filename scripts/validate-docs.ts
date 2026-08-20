import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { LOCALES, readJson, sha256, type DocsManifest, type UpstreamLock } from './projection-model.ts'

interface LocaleConfig {
  schema_version: number
  locales: Array<{ id: string; astro_key: string; path_prefix: string; source: string; published: boolean }>
}
interface AdapterLock {
  upstream_commit: string
  upstream_bindings: Array<{ path: string; sha256: string }>
  local_controls: Array<{ path: string; sha256: string }>
}

const root = resolve(import.meta.dirname, '..')
const manifest = readJson<DocsManifest>(resolve(root, 'config/docs-manifest.json'))
const lock = readJson<UpstreamLock>(resolve(root, 'config/upstream-lock.json'))
const locales = readJson<LocaleConfig>(resolve(root, 'config/locales.json'))
const adapters = readJson<AdapterLock>(resolve(root, 'config/adapter-lock.json'))
const errors: string[] = []
if (manifest.upstream_commit !== lock.commit) errors.push('docs manifest and upstream lock commits differ')
if (manifest.canonical_page_count !== manifest.pages.length) errors.push('canonical_page_count does not match pages')
if (manifest.published_route_count !== manifest.pages.length * LOCALES.length) errors.push('published_route_count is not the two-locale source route count')
if (JSON.stringify(manifest.official_locales) !== JSON.stringify(LOCALES)) errors.push('official_locales must contain only zh-CN and en-US')
if (JSON.stringify(locales.locales.map(locale => locale.id)) !== JSON.stringify(LOCALES)) errors.push('config/locales.json must publish only zh-CN and en-US')
if (locales.locales.some(locale => !locale.published || locale.source !== 'official')) errors.push('both configured locales must be published upstream-backed sources')
if (adapters.upstream_commit !== lock.commit) errors.push('adapter lock and upstream lock commits differ')
const upstreamControls = new Map((lock as UpstreamLock & { controls?: Array<{ path: string; sha256: string }> }).controls?.map(file => [file.path, file.sha256]) ?? [])
for (const binding of adapters.upstream_bindings) {
  if (upstreamControls.get(binding.path) !== binding.sha256) errors.push(`adapter upstream binding drifted: ${binding.path}`)
}
for (const control of adapters.local_controls) {
  const path = resolve(root, control.path)
  if (!existsSync(path) || sha256(readFileSync(path)) !== control.sha256) errors.push(`adapted local control drifted: ${control.path}`)
}

const pageIds = new Set<string>()
const routes = new Set<string>()
for (const page of manifest.pages) {
  if (pageIds.has(page.id)) errors.push(`duplicate page id ${page.id}`)
  if (routes.has(page.route)) errors.push(`duplicate source route ${page.route}`)
  pageIds.add(page.id)
  routes.add(page.route)
  for (const locale of LOCALES) {
    const entry = page.locales[locale]
    if (entry === undefined) errors.push(`${page.id} has no ${locale} source`)
  }
}

for (const file of [...lock.published_sources, ...((lock as UpstreamLock & { pairing_records?: UpstreamLock['published_sources'] }).pairing_records ?? [])]) {
  const path = resolve(root, file.path)
  if (!existsSync(path)) {
    errors.push(`missing locked file ${file.path}`)
    continue
  }
  const bytes = readFileSync(path)
  if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) errors.push(`locked bytes differ for ${file.path}`)
}

if (existsSync(resolve(root, 'docs-locales')) || existsSync(resolve(root, 'config/translation-state'))) {
  errors.push('Japanese/Korean locale or translation-state directories must not exist')
}
if (errors.length > 0) throw new Error(`docs:check failed:\n- ${errors.join('\n- ')}`)
console.log(`docs:check: ${manifest.pages.length} locked source pages and ${lock.published_sources.length} official files passed for zh-CN/en-US only.`)
