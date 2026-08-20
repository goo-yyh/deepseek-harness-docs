import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  extractPageSegments,
  LOCALES,
  readJson,
  stableJson,
  type DocsManifest,
  type LockedSource,
  type SegmentInventory,
  type UpstreamLock,
} from './projection-model.ts'

const repoRoot = resolve(import.meta.dirname, '..')
const manifest = readJson<DocsManifest>(resolve(repoRoot, 'config/docs-manifest.json'))
const upstream = readJson<UpstreamLock>(resolve(repoRoot, 'config/upstream-lock.json'))
if (manifest.upstream_commit !== upstream.commit) throw new Error('content:segments: manifest and upstream lock commits differ.')
const lockByPath = new Map<string, LockedSource>(upstream.published_sources.map(source => [source.path, source]))
const segments = manifest.pages.flatMap(page => LOCALES.flatMap(locale => extractPageSegments(repoRoot, page, locale, lockByPath)))
const inventory: SegmentInventory = {
  schema_version: 1,
  upstream_commit: upstream.commit,
  source_page_count: manifest.pages.length,
  locale_page_counts: {
    'zh-CN': new Set(segments.filter(item => item.locale === 'zh-CN').map(item => item.source_page_id)).size,
    'en-US': new Set(segments.filter(item => item.locale === 'en-US').map(item => item.source_page_id)).size,
  },
  segment_counts: {
    'zh-CN': segments.filter(item => item.locale === 'zh-CN').length,
    'en-US': segments.filter(item => item.locale === 'en-US').length,
  },
  segments,
}
const output = resolve(repoRoot, 'config/source-segments.json')
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, stableJson(inventory))
console.log(`content:segments: wrote ${segments.length} locale segments from ${manifest.pages.length} source pages.`)
