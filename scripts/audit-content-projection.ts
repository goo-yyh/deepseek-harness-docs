import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  LOCALES,
  readJson,
  sha256,
  stableJson,
  type ContentMap,
  type DocsManifest,
  type LocaleId,
  type SegmentInventory,
  type SeoMetadata,
} from './projection-model.ts'
import { validateNavigation, type NavigationConfig } from './navigation-model.ts'

interface ProjectionOutput {
  upstream_commit: string
  generated_locale_pages: number
  pages: Array<{ page_id: string; locale: LocaleId; output: string; output_sha256: string; segment_ids: string[] }>
}

interface ProjectionLock {
  upstream_commit: string
  hashes: Record<'source_segments' | 'content_map' | 'navigation' | 'seo_metadata' | 'redirects', string>
}

const repoRoot = resolve(import.meta.dirname, '..')
const manifest = readJson<DocsManifest>(resolve(repoRoot, 'config/docs-manifest.json'))
const inventory = readJson<SegmentInventory>(resolve(repoRoot, 'config/source-segments.json'))
const contentMap = readJson<ContentMap>(resolve(repoRoot, 'config/content-map.json'))
const navigation = readJson<NavigationConfig>(resolve(repoRoot, 'config/navigation.json'))
const seo = readJson<SeoMetadata>(resolve(repoRoot, 'config/seo-metadata.json'))
const output = readJson<ProjectionOutput>(resolve(repoRoot, 'reports/projection-output.json'))
const projectionLock = readJson<ProjectionLock>(resolve(repoRoot, 'config/projection-lock.json'))
const errors: string[] = []

const lockedInputs = {
  source_segments: inventory,
  content_map: contentMap,
  navigation,
  seo_metadata: seo,
  redirects: readJson<unknown>(resolve(repoRoot, 'config/redirects.json')),
}
if (projectionLock.upstream_commit !== manifest.upstream_commit) {
  errors.push('projection lock and docs manifest commits differ.')
}
for (const [name, value] of Object.entries(lockedInputs)) {
  const actual = sha256(stableJson(value))
  if (projectionLock.hashes[name as keyof ProjectionLock['hashes']] !== actual) {
    errors.push(`projection lock drifted for ${name}.`)
  }
}
errors.push(...validateNavigation(navigation, contentMap))

const allSegmentIds = new Set(inventory.segments.filter(item => item.locale === 'en-US').map(item => item.segment_id))
const owners = new Map<string, string[]>()
for (const page of contentMap.target_pages) {
  if (page.segments.length === 0 && page.indexing === 'index') errors.push(`${page.page_id} is indexable but has no source segments.`)
  for (const id of page.segments) {
    const entries = owners.get(id) ?? []
    entries.push(page.page_id)
    owners.set(id, entries)
    if (!allSegmentIds.has(id)) errors.push(`${page.page_id} owns unknown segment ${id}.`)
  }
}
const missing = [...allSegmentIds].filter(id => !owners.has(id))
const duplicates = [...owners].filter(([, pageIds]) => pageIds.length !== 1)
if (missing.length > 0) errors.push(`${missing.length} source segments have no primary owner.`)
if (duplicates.length > 0) errors.push(`${duplicates.length} source segments have multiple primary owners.`)

const sourceInventories = new Map<string, string[]>()
for (const segment of inventory.segments.filter(item => item.locale === 'en-US')) {
  const entries = sourceInventories.get(segment.source_page_id) ?? []
  entries.push(segment.segment_id)
  sourceInventories.set(segment.source_page_id, entries)
}
const exactDuplicates: Array<{ target: string; source: string }> = []
for (const target of contentMap.target_pages) {
  for (const [sourceId, sourceSegments] of sourceInventories) {
    if (stableJson(target.segments) === stableJson(sourceSegments)) exactDuplicates.push({ target: target.page_id, source: sourceId })
  }
}
if (exactDuplicates.length > 0) errors.push(`${exactDuplicates.length} target pages reproduce a complete official page segment inventory.`)

const expectedOutputs = contentMap.target_pages.reduce((count, target) => count + LOCALES.filter(locale => seo.pages[target.page_id]?.[locale] != null).length, 0)
if (output.generated_locale_pages !== expectedOutputs || output.pages.length !== expectedOutputs) {
  errors.push(`projection output count ${output.pages.length} does not match expected ${expectedOutputs}.`)
}
for (const page of output.pages) {
  const bytes = readFileSync(resolve(repoRoot, page.output))
  if (sha256(bytes) !== page.output_sha256) errors.push(`${page.output} differs from its projection receipt.`)
  const markdown = bytes.toString('utf8')
  const forbiddenPublicTokens = [
    ['source', 'attribution'].join('-'),
    ['data', 'source', 'commit'].join('-'),
    'isBasedOn',
    '"citation"',
  ]
  if (forbiddenPublicTokens.some(token => markdown.includes(token))) {
    errors.push(`${page.output} exposes upstream attribution or source metadata.`)
  }
}

for (const locale of LOCALES) {
  const titleOwners = new Map<string, string[]>()
  for (const target of contentMap.target_pages) {
    const metadata = seo.pages[target.page_id]?.[locale]
    if (metadata === null || metadata === undefined || metadata.indexability !== 'index') continue
    const key = metadata.title.trim().toLocaleLowerCase(locale)
    const pages = titleOwners.get(key) ?? []
    pages.push(target.page_id)
    titleOwners.set(key, pages)
    if (metadata.description.trim().length < 20) errors.push(`${locale}:${target.page_id} has a thin SEO description.`)
  }
  for (const [title, pages] of titleOwners) {
    if (pages.length > 1) errors.push(`${locale} title ${JSON.stringify(title)} is shared by ${pages.join(', ')}.`)
  }
}

const report = {
  schema_version: 1,
  status: errors.length === 0 ? 'passed' : 'failed',
  upstream_commit: manifest.upstream_commit,
  source_page_count: manifest.pages.length,
  source_segment_count: allSegmentIds.size,
  target_page_count: contentMap.target_pages.length,
  generated_locale_pages: output.pages.length,
  coverage_percent: allSegmentIds.size === 0 ? 0 : Number((((allSegmentIds.size - missing.length) / allSegmentIds.size) * 100).toFixed(2)),
  missing_segments: missing,
  duplicate_owners: duplicates.map(([segment_id, page_ids]) => ({ segment_id, page_ids })),
  exact_full_page_duplicates: exactDuplicates,
  errors,
}
writeFileSync(resolve(repoRoot, 'reports/content-projection-audit.json'), stableJson(report))
if (errors.length > 0) throw new Error(`content:audit failed:\n- ${errors.join('\n- ')}`)
console.log(`content:audit: passed ${allSegmentIds.size} segments, ${contentMap.target_pages.length} target pages, and ${output.pages.length} locale outputs.`)
