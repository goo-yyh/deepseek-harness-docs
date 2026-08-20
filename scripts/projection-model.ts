import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { posix, resolve } from 'node:path'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import type { Nodes, Root, RootContent } from 'mdast'

export const REPOSITORY_URL = 'https://github.com/deepseek-ai/deepseek-harness'
export const SITE_ORIGIN = 'https://www.deepseek-harness-docs.com'
export const LOCALES = ['zh-CN', 'en-US'] as const
export type LocaleId = typeof LOCALES[number]
export type MenuId = 'start' | 'concepts' | 'build' | 'runtime' | 'api' | 'examples' | 'versions'

export interface ManifestLocale {
  source: string
  label: string
  content_locale: string
  source_kind: string
}

export interface ManifestPage {
  id: string
  route: string
  module: string
  section: Record<LocaleId, string>
  order: number
  locales: Record<LocaleId, ManifestLocale>
}

export interface DocsManifest {
  schema_version: number
  upstream_commit: string
  canonical_page_count: number
  published_route_count: number
  official_locales: LocaleId[]
  pages: ManifestPage[]
}

export interface LockedSource {
  path: string
  git_blob: string
  sha256: string
  bytes: number
}

export interface UpstreamLock {
  commit: string
  tree: string
  published_sources: LockedSource[]
}

export type SegmentKind = 'title' | 'intro' | 'section'

export interface SourceSegment {
  segment_id: string
  source_page_id: string
  locale: LocaleId
  content_locale: LocaleId
  source_path: string
  source_blob: string
  source_sha256: string
  kind: SegmentKind
  ordinal: number
  heading: string
  heading_path: string[]
  start_offset: number
  end_offset: number
  raw_sha256: string
  visible_text_sha256: string
  visible_characters: number
}

export interface SegmentInventory {
  schema_version: number
  upstream_commit: string
  source_page_count: number
  locale_page_counts: Record<LocaleId, number>
  segment_counts: Record<LocaleId, number>
  segments: SourceSegment[]
}

export interface TargetPage {
  page_id: string
  neutral_route: string
  kind: 'topic' | 'entity' | 'api' | 'example-index' | 'version-diff'
  menu_id: MenuId
  order: number
  segments: string[]
  source_page_ids: string[]
  legacy_routes: string[]
  indexing: 'index' | 'noindex'
}

export interface ContentMap {
  schema_version: number
  upstream_commit: string
  target_pages: TargetPage[]
}

export interface LocaleMetadata {
  title: string
  description: string
  indexability: 'index' | 'noindex'
}

export interface SeoMetadata {
  schema_version: number
  origin: string
  pages: Record<string, Record<LocaleId, LocaleMetadata | null>>
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function nodeText(node: Nodes): string {
  if ('value' in node && typeof node.value === 'string') return node.value
  if (node.type === 'image') return node.alt ?? ''
  if ('children' in node && Array.isArray(node.children)) {
    return node.children.map(child => nodeText(child as Nodes)).join(' ')
  }
  return ''
}

export function visibleText(markdown: string): string {
  const tree = parseMarkdown(markdown)
  return nodeText(tree).replace(/\s+/g, ' ').trim()
}

export function parseMarkdown(markdown: string): Root {
  return fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })
}

function frontmatterBoundary(raw: string): number {
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) return 0
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)
  return match?.[0].length ?? 0
}

function offsets(node: RootContent, baseOffset: number): { start: number; end: number } {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) {
    throw new Error(`projection-model: ${node.type} node has no source offsets.`)
  }
  return { start: baseOffset + start, end: baseOffset + end }
}

function isLanguageSwitcher(raw: string): boolean {
  return /^English\s*\|\s*中文$/.test(visibleText(raw))
}

function makeSegment(
  page: ManifestPage,
  locale: LocaleId,
  locked: LockedSource,
  raw: string,
  kind: SegmentKind,
  ordinal: number,
  heading: string,
  start: number,
  end: number,
  pageTitle: string,
): SourceSegment {
  const source = raw.slice(start, end).trim()
  const text = visibleText(source)
  const suffix = kind === 'section' ? `section-${String(ordinal).padStart(3, '0')}` : kind
  return {
    segment_id: `${page.id}#${suffix}`,
    source_page_id: page.id,
    locale,
    content_locale: locale,
    source_path: locked.path,
    source_blob: locked.git_blob,
    source_sha256: locked.sha256,
    kind,
    ordinal,
    heading,
    heading_path: kind === 'section' ? [pageTitle, heading] : [pageTitle],
    start_offset: start,
    end_offset: end,
    raw_sha256: sha256(source),
    visible_text_sha256: sha256(text),
    visible_characters: text.length,
  }
}

export function extractPageSegments(
  repoRoot: string,
  page: ManifestPage,
  locale: LocaleId,
  lockByPath: Map<string, LockedSource>,
): SourceSegment[] {
  const localeEntry = page.locales[locale]
  if (localeEntry.content_locale !== locale) return []
  const locked = lockByPath.get(localeEntry.source)
  if (locked === undefined) throw new Error(`projection-model: ${localeEntry.source} is absent from upstream lock.`)
  const raw = readFileSync(resolve(repoRoot, localeEntry.source), 'utf8')
  if (sha256(raw) !== locked.sha256 || Buffer.byteLength(raw) !== locked.bytes) {
    throw new Error(`projection-model: ${localeEntry.source} does not match its locked bytes.`)
  }

  const baseOffset = frontmatterBoundary(raw)
  const body = raw.slice(baseOffset)
  const tree = parseMarkdown(body)
  const titleIndex = tree.children.findIndex(node => node.type === 'heading' && node.depth === 1)
  if (titleIndex === -1) throw new Error(`projection-model: ${localeEntry.source} has no H1.`)
  const titleNode = tree.children[titleIndex]
  if (titleNode?.type !== 'heading') throw new Error('projection-model: impossible title node state.')
  const title = nodeText(titleNode).replace(/\s+/g, ' ').trim()
  const titleOffsets = offsets(titleNode, baseOffset)
  const segments = [makeSegment(page, locale, locked, raw, 'title', 0, title, titleOffsets.start, titleOffsets.end, title)]

  const sectionIndexes = tree.children
    .map((node, index) => node.type === 'heading' && node.depth === 2 ? index : -1)
    .filter(index => index >= 0)
  const sectionStartIndexes = sectionIndexes.map((headingIndex) => {
    let index = headingIndex
    while (index > titleIndex + 1) {
      const previous = tree.children[index - 1]
      if (previous === undefined) break
      const previousRange = offsets(previous, baseOffset)
      if (!/^\s*<a\s+id=["'][^"']+["']\s*><\/a>\s*$/i.test(raw.slice(previousRange.start, previousRange.end))) break
      index -= 1
    }
    return index
  })
  const firstSectionIndex = sectionStartIndexes[0] ?? tree.children.length
  const introNodes = tree.children.slice(titleIndex + 1, firstSectionIndex)
    .filter((node) => {
      const range = offsets(node, baseOffset)
      return !isLanguageSwitcher(raw.slice(range.start, range.end))
    })
  if (introNodes.length > 0) {
    const start = offsets(introNodes[0] as RootContent, baseOffset).start
    const end = offsets(introNodes[introNodes.length - 1] as RootContent, baseOffset).end
    const candidate = raw.slice(start, end).trim()
    if (visibleText(candidate) !== '') {
      segments.push(makeSegment(page, locale, locked, raw, 'intro', 0, title, start, end, title))
    }
  }

  sectionIndexes.forEach((childIndex, sectionIndex) => {
    const node = tree.children[childIndex]
    if (node?.type !== 'heading') throw new Error('projection-model: impossible section node state.')
    const start = offsets(tree.children[sectionStartIndexes[sectionIndex] as number] as RootContent, baseOffset).start
    const nextIndex = sectionStartIndexes[sectionIndex + 1]
    const end = nextIndex === undefined
      ? raw.length
      : offsets(tree.children[nextIndex] as RootContent, baseOffset).start
    const heading = nodeText(node).replace(/\s+/g, ' ').trim()
    segments.push(makeSegment(page, locale, locked, raw, 'section', sectionIndex + 1, heading, start, end, title))
  })
  return segments
}

export function targetMenu(page: ManifestPage): MenuId {
  if (page.id.startsWith('reference.cookbook.')) return 'examples'
  if (page.id.startsWith('reference.cordis-api.') || /catalog/.test(page.id)) return 'api'
  if (page.id.startsWith('reference.subsystems.')) return 'runtime'
  if (page.id.startsWith('develop.basic') || page.id.startsWith('develop.practice')) return 'build'
  if (page.id.startsWith('develop.cordis-tutorial') || page.id.startsWith('develop.framework') || page.id === 'reference.cordis-primer') return 'concepts'
  if (page.id.startsWith('reference.')) return 'concepts'
  return 'start'
}

function leaf(value: string): string {
  return value.split('.').at(-1)?.replace(/^\d+-/, '') ?? value
}

export function targetRoute(page: ManifestPage): string {
  if (page.id === 'guide.quickstart') return '/start/web-ui'
  if (page.id === 'guide.providers') return '/start/models'
  if (page.id === 'guide.python-sdk') return '/start/python-sdk'
  if (page.id === 'develop.basic') return '/build/first-plugin'
  if (page.id.startsWith('develop.basic.')) return `/build/${leaf(page.id)}`
  if (page.id === 'develop.practice') return '/build/capability-layering'
  if (page.id.startsWith('develop.practice.')) return `/build/${leaf(page.id)}`
  if (page.id === 'develop.framework') return '/concepts/plugin-lifecycle'
  if (page.id.startsWith('develop.framework.')) return `/concepts/${leaf(page.id)}`
  if (page.id === 'develop.cordis-tutorial') return '/concepts/cordis/tutorial'
  if (page.id.startsWith('develop.cordis-tutorial.')) return `/concepts/cordis/tutorial/${leaf(page.id)}`
  if (page.id === 'reference.cordis-primer') return '/concepts/cordis/primer'
  if (page.id.startsWith('reference.subsystems.')) return `/runtime/${leaf(page.id)}`
  if (page.id.startsWith('reference.cordis-api.')) return `/api/cordis/${leaf(page.id)}`
  if (/catalog/.test(page.id)) return `/api/catalogs/${leaf(page.id)}`
  if (page.id.startsWith('reference.cookbook.')) return `/examples/${leaf(page.id)}`
  return `/concepts/${leaf(page.id)}`
}

export function localizedRoute(neutralRoute: string, locale: LocaleId): string {
  return locale === 'zh-CN' ? neutralRoute : `/en${neutralRoute}`
}

export function outputMarkdownPath(repoRoot: string, neutralRoute: string, locale: LocaleId): string {
  const path = neutralRoute.replace(/^\//, '')
  return resolve(repoRoot, 'src/content/docs', locale === 'zh-CN' ? path : posix.join('en', path)) + '.md'
}

export function sourceTargetMap(manifest: DocsManifest, contentMap: ContentMap): Map<string, TargetPage> {
  const byPageId = new Map<string, TargetPage>()
  for (const target of contentMap.target_pages) {
    for (const sourcePageId of target.source_page_ids) {
      if (target.kind === 'version-diff') continue
      const existing = byPageId.get(sourcePageId)
      if (existing === undefined || target.neutral_route !== `/${target.menu_id}`) byPageId.set(sourcePageId, target)
    }
  }
  for (const page of manifest.pages) {
    if (page.id !== 'home' && !byPageId.has(page.id)) {
      const fallback = contentMap.target_pages.find(target => target.menu_id === targetMenu(page) && target.neutral_route === `/${target.menu_id}`)
      if (fallback !== undefined) byPageId.set(page.id, fallback)
    }
  }
  return byPageId
}

export function resolveRepoTarget(sourcePath: string, rawTarget: string): string {
  const withoutSuffix = rawTarget.split(/[?#]/, 1)[0] ?? ''
  let candidate = posix.normalize(posix.join(posix.dirname(sourcePath), withoutSuffix))
  if (!posix.extname(candidate)) candidate = `${candidate}.md`
  return candidate
}
