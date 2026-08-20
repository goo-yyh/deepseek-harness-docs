import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { rewriteMarkdown } from '../markdown-projector.ts'
import {
  collectNavigationPageIds,
  findNavigationPath,
  validateNavigation,
  type NavigationConfig,
} from '../navigation-model.ts'
import { readJson, stableJson, type ContentMap, type SegmentInventory } from '../projection-model.ts'

const root = resolve(import.meta.dirname, '../..')
const inventory = readJson<SegmentInventory>(resolve(root, 'config/source-segments.json'))
const contentMap = readJson<ContentMap>(resolve(root, 'config/content-map.json'))
const navigation = readJson<NavigationConfig>(resolve(root, 'config/navigation.json'))

test('publishes only official Chinese and English locales', () => {
  const locales = readJson<{ locales: Array<{ id: string }> }>(resolve(root, 'config/locales.json'))
  assert.deepEqual(locales.locales.map(locale => locale.id), ['zh-CN', 'en-US'])
  assert.doesNotMatch(stableJson(locales), /ja-JP|ko-KR/)
})

test('owns every neutral source segment exactly once', () => {
  const sourceIds = new Set(inventory.segments.filter(segment => segment.locale === 'en-US').map(segment => segment.segment_id))
  const owners = new Map<string, number>()
  for (const page of contentMap.target_pages) {
    for (const id of page.segments) owners.set(id, (owners.get(id) ?? 0) + 1)
  }
  assert.equal(owners.size, sourceIds.size)
  for (const id of sourceIds) assert.equal(owners.get(id), 1, id)
})

test('places every target page exactly once in the reviewed navigation tree', () => {
  assert.deepEqual(validateNavigation(navigation, contentMap), [])
  assert.equal(collectNavigationPageIds(navigation).length, contentMap.target_pages.length)
})

test('keeps the audited second-level menu taxonomy stable', () => {
  assert.deepEqual(findNavigationPath(navigation, 'cordis-tutorial.04-events'), ['concepts', 'concepts-cordis'])
  assert.deepEqual(findNavigationPath(navigation, 'subsystems.session-query'), ['runtime', 'runtime-sessions'])
  assert.deepEqual(findNavigationPath(navigation, 'subsystems.shell'), ['runtime', 'runtime-tools-execution'])
  assert.deepEqual(findNavigationPath(navigation, 'cordis-api.fiber'), ['api', 'api-cordis'])
  assert.deepEqual(findNavigationPath(navigation, 'menu.versions'), [])
  assert.equal(navigation.menus.at(-1)?.type, 'page')
})

test('keeps explicit pre-heading anchors with the owned section', () => {
  for (const segmentId of [
    'develop.cordis-tutorial#section-003',
    'reference.subsystems.llm-streaming#section-001',
    'reference.subsystems.session#section-012',
  ]) {
    const segment = inventory.segments.find(candidate => candidate.locale === 'en-US' && candidate.segment_id === segmentId)
    assert.ok(segment, segmentId)
    const raw = readFileSync(resolve(root, segment.source_path), 'utf8').slice(segment.start_offset, segment.end_offset).trim()
    assert.match(raw, /^<a id="[^"]+"><\/a>\s+## /)
  }
})

test('does not reproduce an entire official page inventory', () => {
  const source = new Map<string, string[]>()
  for (const segment of inventory.segments.filter(item => item.locale === 'en-US')) {
    const ids = source.get(segment.source_page_id) ?? []
    ids.push(segment.segment_id)
    source.set(segment.source_page_id, ids)
  }
  for (const target of contentMap.target_pages) {
    for (const ids of source.values()) assert.notDeepEqual(target.segments, ids, target.page_id)
  }
})

test('rewrites a moved same-source fragment to its target owner', () => {
  const result = rewriteMarkdown('[TypeScript notes](#typescript-notes)', {
    repoRoot: root,
    sourcePath: 'docs/cordis-tutorial/index.md',
    locale: 'en-US',
    upstreamCommit: '0'.repeat(40),
    sourceToRoute: new Map(),
    fragmentToRoute: new Map([[
      'en-US:docs/cordis-tutorial/index.md#typescript-notes',
      { route: '/concepts/cordis/tutorial', nativeLocales: new Set(['zh-CN', 'en-US'] as const) },
    ]]),
  })
  assert.equal(result, '[TypeScript notes](/en/concepts/cordis/tutorial#typescript-notes)')
})
