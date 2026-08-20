import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { rewriteMarkdown } from './markdown-projector.ts'
import {
  LOCALES,
  SITE_ORIGIN,
  localizedRoute,
  outputMarkdownPath,
  readJson,
  sha256,
  sourceTargetMap,
  stableJson,
  type ContentMap,
  type DocsManifest,
  type LocaleId,
  type SegmentInventory,
  type SeoMetadata,
  type SourceSegment,
  type TargetPage,
} from './projection-model.ts'

const repoRoot = resolve(import.meta.dirname, '..')
const manifest = readJson<DocsManifest>(resolve(repoRoot, 'config/docs-manifest.json'))
const inventory = readJson<SegmentInventory>(resolve(repoRoot, 'config/source-segments.json'))
const contentMap = readJson<ContentMap>(resolve(repoRoot, 'config/content-map.json'))
const seo = readJson<SeoMetadata>(resolve(repoRoot, 'config/seo-metadata.json'))
if (new Set([manifest.upstream_commit, inventory.upstream_commit, contentMap.upstream_commit]).size !== 1) {
  throw new Error('content:project: manifest, segments, and content map commits differ.')
}
const generatedRoot = resolve(repoRoot, 'src/content/docs')
rmSync(generatedRoot, { recursive: true, force: true })
rmSync(resolve(repoRoot, 'public/assets/docs'), { recursive: true, force: true })

const sourcePageById = new Map(manifest.pages.map(page => [page.id, page]))
const targetBySource = sourceTargetMap(manifest, contentMap)
const segmentByLocaleAndId = new Map(inventory.segments.map(segment => [`${segment.locale}:${segment.segment_id}`, segment]))
const sourceToRoute = new Map<string, { route: string; nativeLocales: Set<LocaleId> }>()
const fragmentToRoute = new Map<string, { route: string; nativeLocales: Set<LocaleId> }>()
const ownerBySegment = new Map(contentMap.target_pages.flatMap(target => target.segments.map(id => [id, target] as const)))
for (const sourcePage of manifest.pages) {
  const target = targetBySource.get(sourcePage.id)
  if (target === undefined) continue
  const nativeLocales = new Set(LOCALES.filter(locale => sourcePage.locales[locale].content_locale === locale))
  for (const locale of LOCALES) {
    const source = sourcePage.locales[locale].source
    sourceToRoute.set(source, { route: target.neutral_route, nativeLocales })
    if (source.endsWith('/index.md')) sourceToRoute.set(source.slice(0, -'/index.md'.length), { route: target.neutral_route, nativeLocales })
  }
}
for (const segment of inventory.segments) {
  const target = ownerBySegment.get(segment.segment_id)
  if (target === undefined) continue
  const sourcePage = sourcePageById.get(segment.source_page_id)
  if (sourcePage === undefined) continue
  const nativeLocales = new Set(LOCALES.filter(locale => sourcePage.locales[locale].content_locale === locale))
  const raw = readFileSync(resolve(repoRoot, segment.source_path), 'utf8').slice(segment.start_offset, segment.end_offset)
  for (const match of raw.matchAll(/<a\s+id=["']([^"']+)["']\s*><\/a>/gi)) {
    const fragment = match[1]
    if (fragment !== undefined) fragmentToRoute.set(`${segment.locale}:${segment.source_path}#${fragment}`, { route: target.neutral_route, nativeLocales })
  }
}

function rawSegment(segment: SourceSegment): string {
  const raw = readFileSync(resolve(repoRoot, segment.source_path), 'utf8')
  const projected = raw.slice(segment.start_offset, segment.end_offset).trim()
  if (sha256(projected) !== segment.raw_sha256) {
    throw new Error(`content:project: source drift for ${segment.locale}:${segment.segment_id}.`)
  }
  return rewriteMarkdown(projected, {
    repoRoot,
    sourcePath: segment.source_path,
    locale: segment.locale,
    upstreamCommit: manifest.upstream_commit,
    sourceToRoute,
    fragmentToRoute,
  })
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

function canonical(target: TargetPage, locale: LocaleId): string {
  return `${SITE_ORIGIN}${localizedRoute(target.neutral_route, locale)}`
}

function pageHead(target: TargetPage, locale: LocaleId, title: string, description: string, indexable: boolean): string {
  const entries: Array<{ tag: string; attrs?: Record<string, string>; content?: string }> = [
    { tag: 'meta', attrs: { name: 'robots', content: indexable ? 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1' : 'noindex, follow' } },
    { tag: 'meta', attrs: { property: 'og:type', content: indexable ? 'article' : 'website' } },
    { tag: 'meta', attrs: { property: 'og:site_name', content: 'DeepSeek Harness Docs' } },
    { tag: 'meta', attrs: { property: 'og:title', content: `${title} | DeepSeek Harness Docs` } },
    { tag: 'meta', attrs: { property: 'og:description', content: description } },
    { tag: 'meta', attrs: { property: 'og:url', content: canonical(target, locale) } },
    { tag: 'meta', attrs: { property: 'og:locale', content: locale === 'zh-CN' ? 'zh_CN' : 'en_US' } },
    { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary' } },
    { tag: 'meta', attrs: { name: 'twitter:title', content: `${title} | DeepSeek Harness Docs` } },
    { tag: 'meta', attrs: { name: 'twitter:description', content: description } },
    {
      tag: 'script',
      attrs: { type: 'application/ld+json' },
      content: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': indexable ? 'TechArticle' : 'WebPage',
        name: title,
        description,
        url: canonical(target, locale),
        inLanguage: locale,
        license: 'https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE',
        isPartOf: { '@type': 'WebSite', name: 'DeepSeek Harness Docs', url: `${SITE_ORIGIN}/` },
      }),
    },
  ]
  return entries.map((entry) => {
    const lines = [`  - tag: ${entry.tag}`]
    if (entry.attrs !== undefined) {
      lines.push('    attrs:')
      for (const [key, value] of Object.entries(entry.attrs)) lines.push(`      ${key}: ${yamlString(value)}`)
    }
    if (entry.content !== undefined) lines.push(`    content: ${yamlString(entry.content)}`)
    return lines.join('\n')
  }).join('\n')
}

function renderBody(target: TargetPage, locale: LocaleId): string {
  const segments = target.segments.map(id => segmentByLocaleAndId.get(`${locale}:${id}`)).filter((item): item is SourceSegment => item !== undefined)
  const chunks: string[] = []
  let lastSourcePage = ''
  for (const segment of segments) {
    let markdown = rawSegment(segment)
    if (segment.kind === 'title') {
      if (!target.page_id.startsWith('menu.')) continue
      markdown = markdown.replace(/^#\s+/, '## ')
    } else if (target.page_id.startsWith('menu.') && segment.source_page_id !== lastSourcePage) {
      const owner = targetBySource.get(segment.source_page_id)
      const sourcePage = sourcePageById.get(segment.source_page_id)
      if (owner !== undefined && sourcePage !== undefined) {
        chunks.push(`## [${sourcePage.locales[locale].label}](${localizedRoute(owner.neutral_route, locale)})`)
      }
    }
    chunks.push(markdown)
    lastSourcePage = segment.source_page_id
  }
  return chunks.join('\n\n').trim()
}

let written = 0
const outputPages: Array<{ page_id: string; locale: LocaleId; route: string; output: string; output_sha256: string; segment_ids: string[] }> = []
for (const target of contentMap.target_pages) {
  for (const locale of LOCALES) {
    const metadata = seo.pages[target.page_id]?.[locale]
    if (metadata === null || metadata === undefined) continue
    const indexable = metadata.indexability === 'index'
    const body = renderBody(target, locale)
    const frontmatter = [
      '---',
      `title: ${yamlString(metadata.title)}`,
      `description: ${yamlString(metadata.description)}`,
      'editUrl: false',
      `pagefind: ${indexable ? 'true' : 'false'}`,
      'lastUpdated: false',
      'head:',
      pageHead(target, locale, metadata.title, metadata.description, indexable),
      '---',
      '',
    ].join('\n')
    const output = outputMarkdownPath(repoRoot, target.neutral_route, locale)
    mkdirSync(dirname(output), { recursive: true })
    const projected = `${frontmatter}${body}\n`
    writeFileSync(output, projected)
    outputPages.push({
      page_id: target.page_id,
      locale,
      route: localizedRoute(target.neutral_route, locale),
      output: output.slice(repoRoot.length + 1),
      output_sha256: sha256(projected),
      segment_ids: target.segments,
    })
    written += 1
  }
}

writeFileSync(resolve(repoRoot, 'reports/projection-output.json'), stableJson({
  schema_version: 1,
  upstream_commit: manifest.upstream_commit,
  target_page_count: contentMap.target_pages.length,
  generated_locale_pages: written,
  generated_tree_sha256: sha256(stableJson(contentMap.target_pages.map(page => ({ page_id: page.page_id, route: page.neutral_route, segments: page.segments })))),
  pages: outputPages,
}))
console.log(`content:project: generated ${written} Astro/Starlight locale pages from ${contentMap.target_pages.length} target identities.`)
