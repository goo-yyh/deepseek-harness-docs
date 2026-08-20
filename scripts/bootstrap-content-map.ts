import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  LOCALES,
  SITE_ORIGIN,
  localizedRoute,
  readJson,
  sha256,
  stableJson,
  targetMenu,
  targetRoute,
  visibleText,
  type ContentMap,
  type DocsManifest,
  type LocaleId,
  type MenuId,
  type SegmentInventory,
  type SeoMetadata,
  type SourceSegment,
  type TargetPage,
} from './projection-model.ts'
import { validateNavigation, type NavigationConfig } from './navigation-model.ts'

const repoRoot = resolve(import.meta.dirname, '..')
const manifest = readJson<DocsManifest>(resolve(repoRoot, 'config/docs-manifest.json'))
const inventory = readJson<SegmentInventory>(resolve(repoRoot, 'config/source-segments.json'))
const existingMapPath = resolve(repoRoot, 'config/content-map.json')
if (!process.argv.includes('--force')) {
  try {
    readFileSync(existingMapPath)
    throw new Error('content:bootstrap refuses to overwrite config/content-map.json without --force.')
  } catch (error) {
    if (error instanceof Error && !('code' in error && error.code === 'ENOENT')) throw error
  }
}

const menuFacts: Array<{ id: MenuId; zh: string; en: string; order: number }> = [
  { id: 'start', zh: '开始使用', en: 'Start', order: 10 },
  { id: 'concepts', zh: '核心机制', en: 'Core concepts', order: 20 },
  { id: 'build', zh: '构建与扩展', en: 'Build & extend', order: 30 },
  { id: 'runtime', zh: '运行与编排', en: 'Runtime & orchestration', order: 40 },
  { id: 'api', zh: 'API 与类型', en: 'API & types', order: 50 },
  { id: 'examples', zh: '示例索引', en: 'Examples', order: 60 },
  { id: 'versions', zh: '版本变化', en: 'Version changes', order: 70 },
]

const englishByPage = new Map<string, SourceSegment[]>()
for (const segment of inventory.segments.filter(item => item.locale === 'en-US')) {
  const entries = englishByPage.get(segment.source_page_id) ?? []
  entries.push(segment)
  englishByPage.set(segment.source_page_id, entries)
}
const hubs = new Map<MenuId, TargetPage>(menuFacts.map(fact => [fact.id, {
  page_id: `menu.${fact.id}`,
  neutral_route: `/${fact.id}`,
  kind: fact.id === 'versions' ? 'version-diff' : fact.id === 'api' ? 'api' : fact.id === 'examples' ? 'example-index' : 'topic',
  menu_id: fact.id,
  order: fact.order,
  segments: [],
  source_page_ids: [],
  legacy_routes: [],
  indexing: fact.id === 'versions' ? 'noindex' : 'index',
}]))
const details: TargetPage[] = []
const targetBySource = new Map<string, TargetPage>()

for (const sourcePage of manifest.pages) {
  const segments = englishByPage.get(sourcePage.id) ?? []
  const menu = targetMenu(sourcePage)
  const hub = hubs.get(menu)
  if (hub === undefined) throw new Error(`content:bootstrap: missing ${menu} hub.`)
  const sections = segments.filter(segment => segment.kind === 'section')
  const intro = segments.filter(segment => segment.kind === 'intro')
  const title = segments.filter(segment => segment.kind === 'title')
  if (sourcePage.id === 'home' || sections.length === 0) {
    hub.segments.push(...segments.map(segment => segment.segment_id))
    hub.source_page_ids.push(sourcePage.id)
    targetBySource.set(sourcePage.id, hub)
    continue
  }
  hub.segments.push(...intro.map(segment => segment.segment_id))
  if (intro.length > 0) hub.source_page_ids.push(sourcePage.id)
  const target: TargetPage = {
    page_id: sourcePage.id.replace(/^(guide|develop|reference)\./, ''),
    neutral_route: targetRoute(sourcePage),
    kind: menu === 'api' ? 'api' : menu === 'examples' ? 'example-index' : sourcePage.id.startsWith('reference.subsystems.') ? 'entity' : 'topic',
    menu_id: menu,
    order: sourcePage.order,
    segments: [...title, ...sections].map(segment => segment.segment_id),
    source_page_ids: [sourcePage.id],
    legacy_routes: [sourcePage.route],
    indexing: 'index',
  }
  details.push(target)
  targetBySource.set(sourcePage.id, target)
}

for (const hub of hubs.values()) {
  hub.source_page_ids = [...new Set(hub.source_page_ids)]
  if (hub.segments.length === 0) hub.indexing = 'noindex'
}
const targetPages = [...hubs.values(), ...details]
const routeSet = new Set<string>()
for (const target of targetPages) {
  if (routeSet.has(target.neutral_route)) throw new Error(`content:bootstrap: duplicate route ${target.neutral_route}.`)
  routeSet.add(target.neutral_route)
}
const contentMap: ContentMap = {
  schema_version: 1,
  upstream_commit: manifest.upstream_commit,
  target_pages: targetPages,
}
const navigation = readJson<NavigationConfig>(resolve(repoRoot, 'config/navigation.json'))
const navigationErrors = validateNavigation(navigation, contentMap)
if (navigationErrors.length > 0) {
  throw new Error(`content:bootstrap requires reviewed navigation updates:\n- ${navigationErrors.join('\n- ')}`)
}

const segmentByLocaleAndId = new Map(inventory.segments.map(segment => [`${segment.locale}:${segment.segment_id}`, segment]))
function segmentRaw(segment: SourceSegment): string {
  return readFileSync(resolve(repoRoot, segment.source_path), 'utf8').slice(segment.start_offset, segment.end_offset).trim()
}
function shorten(value: string, maximum = 155): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maximum) return normalized
  const slice = normalized.slice(0, maximum - 1)
  const space = slice.lastIndexOf(' ')
  const boundary = space > maximum * 0.7 ? space : slice.length
  return `${slice.slice(0, boundary).replace(/[,:;，：；\s]+$/, '')}…`
}
function pageMetadata(target: TargetPage, locale: LocaleId): { title: string; description: string; indexability: 'index' | 'noindex' } | null {
  const localizedSegments = target.segments
    .map(id => segmentByLocaleAndId.get(`${locale}:${id}`))
    .filter((value): value is SourceSegment => value !== undefined)
  if (localizedSegments.length === 0 && target.menu_id !== 'versions') return null
  const menu = menuFacts.find(item => item.id === target.menu_id)
  if (menu === undefined) throw new Error(`content:bootstrap: missing menu metadata for ${target.menu_id}.`)
  const titleSegment = localizedSegments.find(segment => segment.kind === 'title')
  const title = target.page_id.startsWith('menu.')
    ? (locale === 'zh-CN' ? menu.zh : menu.en)
    : titleSegment?.heading ?? manifest.pages.find(page => page.id === target.source_page_ids[0])?.locales[locale].label
  if (title === undefined) return null
  const bodySegment = localizedSegments.find(segment => segment.kind !== 'title') ?? titleSegment
  const description = bodySegment === undefined
    ? (locale === 'zh-CN' ? 'DeepSeek Harness 上游版本与结构变化。' : 'Upstream DeepSeek Harness version and structure changes.')
    : shorten(visibleText(segmentRaw(bodySegment)).replace(bodySegment.heading, '').trim() || bodySegment.heading)
  return { title, description, indexability: target.indexing }
}
const seoPages: SeoMetadata['pages'] = {}
for (const target of targetPages) {
  seoPages[target.page_id] = {
    'zh-CN': pageMetadata(target, 'zh-CN'),
    'en-US': pageMetadata(target, 'en-US'),
  }
}
const seo: SeoMetadata = { schema_version: 1, origin: SITE_ORIGIN, pages: seoPages }

const redirects: Array<{ source: string; destination: string; permanent: true }> = []
for (const sourcePage of manifest.pages) {
  const target = targetBySource.get(sourcePage.id)
  if (target === undefined) continue
  for (const locale of LOCALES) {
    const oldRoute = locale === 'zh-CN' ? sourcePage.route : `/en${sourcePage.route === '/' ? '/' : sourcePage.route}`
    const hasNativeContent = sourcePage.locales[locale].content_locale === locale
    const destination = hasNativeContent
      ? localizedRoute(target.neutral_route, locale)
      : localizedRoute(target.neutral_route, 'en-US')
    if (oldRoute !== destination) redirects.push({ source: oldRoute, destination, permanent: true })
  }
}

function write(relativePath: string, value: unknown): void {
  const path = resolve(repoRoot, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, stableJson(value))
}
write('config/content-map.json', contentMap)
write('config/seo-metadata.json', seo)
write('config/redirects.json', { schema_version: 1, redirects })
for (const locale of LOCALES) {
  const pages = targetPages.flatMap((target) => {
    const metadata = seo.pages[target.page_id]?.[locale]
    return metadata === null || metadata === undefined ? [] : [{
      page_id: target.page_id,
      route: localizedRoute(target.neutral_route, locale),
      segment_ids: target.segments,
      projection_sha256: sha256(stableJson({ target, metadata, locale })),
    }]
  })
  write(`config/projection-state/${locale}.json`, {
    schema_version: 1,
    locale,
    upstream_commit: manifest.upstream_commit,
    pages,
  })
}
write('config/projection-lock.json', {
  schema_version: 1,
  upstream_commit: manifest.upstream_commit,
  projector_version: 1,
  astro: '7.2.4',
  starlight: '0.41.7',
  hashes: {
    source_segments: sha256(stableJson(inventory)),
    content_map: sha256(stableJson(contentMap)),
    navigation: sha256(stableJson(navigation)),
    seo_metadata: sha256(stableJson(seo)),
    redirects: sha256(stableJson({ schema_version: 1, redirects })),
  },
})
write('vercel.json', {
  $schema: 'https://openapi.vercel.sh/vercel.json',
  buildCommand: 'pnpm run build',
  installCommand: 'pnpm install --frozen-lockfile',
  outputDirectory: 'dist',
  cleanUrls: true,
  redirects,
  headers: [{
    source: '/assets/(.*)',
    headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
  }],
})
console.log(`content:bootstrap: wrote ${targetPages.length} target pages, ${redirects.length} redirects, and two locale projection states.`)
