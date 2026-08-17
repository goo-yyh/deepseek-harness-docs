/** Locale-aware SEO projection for every published DeepSeek Harness page. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PageData } from 'vitepress'
import { docsPages, routeLink, type DocsLocale, type DocsPage } from './docs.ts'

export const SITE_NAME = 'DeepSeek Harness'
export const SITE_ORIGIN = normalizeOrigin(
  process.env.DOCS_SITE_ORIGIN ?? 'https://www.deepseek-harness-docs.com',
)
export const SITEMAP_URL = `${SITE_ORIGIN}/sitemap.xml`

export type SeoHeadEntry = [string, Record<string, string>, string?]

interface LocaleRecord {
  id: string
  vitepress_key: DocsLocale
  path_prefix: string
  published: boolean
}

interface LocalesFile {
  locales: LocaleRecord[]
}

export interface SeoAlternate {
  hreflang: string
  href: string
  ogLocale: string
}

export interface ResolvedDocsSeo {
  route: string
  canonical: string
  description: string
  fullTitle: string
  htmlLang: string
  indexable: boolean
  ogLocale: string
  alternates: SeoAlternate[]
  robots: string
  structuredData: Record<string, unknown>
}

const root = resolve(import.meta.dirname, '..')
const localeFile = JSON.parse(readFileSync(resolve(root, 'config/locales.json'), 'utf8')) as LocalesFile
const publishedLocales = localeFile.locales.filter(locale => locale.published)
const localeByKey = new Map(publishedLocales.map(locale => [locale.vitepress_key, locale]))
const localeById = new Map(publishedLocales.map(locale => [locale.id, locale]))
const pageByRoute = new Map(docsPages.map(page => [page.route, page]))

const localeMetadata: Record<string, { hreflang: string; htmlLang: string; ogLocale: string }> = {
  'zh-CN': { hreflang: 'zh-CN', htmlLang: 'zh-CN', ogLocale: 'zh_CN' },
  'en-US': { hreflang: 'en', htmlLang: 'en-US', ogLocale: 'en_US' },
  'ja-JP': { hreflang: 'ja', htmlLang: 'ja-JP', ogLocale: 'ja_JP' },
  'ko-KR': { hreflang: 'ko', htmlLang: 'ko-KR', ogLocale: 'ko_KR' },
}

const defaultDescriptions: Record<string, string> = {
  'zh-CN': 'DeepSeek Harness 中文文档：构建、扩展和运行插件化 Agent Harness。',
  'en-US': 'DeepSeek Harness documentation for building, extending, and running a plugin-based agent harness.',
  'ja-JP': 'DeepSeek Harness 日本語ドキュメント：プラグインベースの Agent Harness の構築、拡張、実行方法を説明します。',
  'ko-KR': 'DeepSeek Harness 한국어 문서: 플러그인 기반 Agent Harness를 구축하고 확장하며 실행하는 방법을 설명합니다.',
}

function defaultDescription(contentLocale: string, title: string): string {
  const siteDescription = defaultDescriptions[contentLocale] ?? `${SITE_NAME} documentation.`
  if (title === SITE_NAME) return siteDescription
  if (contentLocale === 'zh-CN') {
    return `${title}：DeepSeek Harness 中文参考文档，涵盖相关概念、接口、行为与扩展方式。`
  }
  if (contentLocale === 'ja-JP') {
    return `${title}：関連する概念、インターフェース、動作、拡張方法を説明する DeepSeek Harness 日本語リファレンスです。`
  }
  if (contentLocale === 'ko-KR') {
    return `${title}: 관련 개념, 인터페이스, 동작 및 확장 방법을 설명하는 DeepSeek Harness 한국어 레퍼런스입니다.`
  }
  return `${title}. DeepSeek Harness reference documentation covering the related concepts, interfaces, behavior, and extension points.`
}

function normalizeOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error('DOCS_SITE_ORIGIN must use HTTPS.')
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('DOCS_SITE_ORIGIN must be an origin without a path, query, or fragment.')
  }
  return url.origin
}

function metadataFor(contentLocale: string): { hreflang: string; htmlLang: string; ogLocale: string } {
  const metadata = localeMetadata[contentLocale]
  if (metadata === undefined) throw new Error(`Missing SEO metadata for content locale ${contentLocale}.`)
  return metadata
}

function neutralRoute(page: DocsPage): string {
  return page.route.replace(/^(?:en|ja|ko)\//, '')
}

function pageIsNativeTranslation(page: DocsPage): boolean {
  return localeByKey.get(page.locale)?.id === page.contentLocale
}

export function pageIsIndexable(page: DocsPage): boolean {
  return page.sidebar !== null && pageIsNativeTranslation(page)
}

function pageForContentLocale(route: string, contentLocale: string): DocsPage | undefined {
  return docsPages.find(page => neutralRoute(page) === route && page.contentLocale === contentLocale && pageIsNativeTranslation(page))
}

function quickstartFor(locale: DocsLocale): DocsPage {
  const page = docsPages.find(candidate => candidate.locale === locale && neutralRoute(candidate) === 'guide/quickstart.md')
  if (page === undefined) throw new Error(`Missing ${locale} Quickstart page for locale-home canonicalization.`)
  return page
}

function canonicalOwner(page: DocsPage): DocsPage {
  if (page.sidebar === null) return quickstartFor(page.locale)
  if (pageIsNativeTranslation(page)) return page
  const owner = pageForContentLocale(neutralRoute(page), page.contentLocale)
  if (owner === undefined) {
    throw new Error(`No canonical locale owns ${page.contentLocale} content at ${page.route}.`)
  }
  return owner
}

function absoluteRoute(page: DocsPage): string {
  return new URL(routeLink(page.route), `${SITE_ORIGIN}/`).href
}

function localizedAlternates(owner: DocsPage): SeoAlternate[] {
  const route = neutralRoute(owner)
  const pages = docsPages.filter(page => neutralRoute(page) === route && pageIsIndexable(page))
  const alternates = pages.map((page) => {
    const metadata = metadataFor(page.contentLocale)
    return {
      hreflang: metadata.hreflang,
      href: absoluteRoute(page),
      ogLocale: metadata.ogLocale,
    }
  })
  const defaultPage = pages.find(page => page.locale === 'root') ?? pages[0]
  if (defaultPage === undefined) throw new Error(`No indexable locale exists for ${owner.route}.`)
  alternates.push({
    hreflang: 'x-default',
    href: absoluteRoute(defaultPage),
    ogLocale: metadataFor(defaultPage.contentLocale).ogLocale,
  })
  return alternates
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[>*_~]/g, '')
    .replace(/\\([\\`*{}\[\]()#+.!_-])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function shortenDescription(value: string, maximum = 160): string {
  if (value.length <= maximum) return value
  const slice = value.slice(0, maximum - 1)
  const lastSpace = slice.lastIndexOf(' ')
  const boundary = lastSpace >= maximum * 0.72 ? lastSpace : slice.length
  return `${slice.slice(0, boundary).replace(/[,:;，：；\s]+$/, '')}…`
}

/** Extract the first substantive localized prose paragraph without editing official Markdown. */
export function extractSeoDescription(markdown: string, contentLocale: string, title: string): string {
  const withoutComments = markdown.replace(/<!--[\s\S]*?-->/g, '')
  const withoutFrontmatter = withoutComments.startsWith('---\n')
    ? withoutComments.replace(/^---\n[\s\S]*?\n---\n/, '')
    : withoutComments
  const lines = withoutFrontmatter.split('\n')
  const candidates: string[] = []
  let paragraph: string[] = []
  let inFence = false

  const flush = (): void => {
    if (paragraph.length === 0) return
    const text = stripInlineMarkdown(paragraph.join(' '))
    if (text.length >= 24) candidates.push(text)
    paragraph = []
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (/^```|^~~~/.test(line)) {
      flush()
      inFence = !inFence
      continue
    }
    if (inFence) continue
    if (line === '') {
      flush()
      continue
    }
    if (
      /^#{1,6}\s/.test(line)
      || /^(?:[-+*]|\d+\.)\s/.test(line)
      || /^(?:>|\||<!--|<script|<style|import\s|export\s)/.test(line)
      || /^(?:English\s*\||\[English\]|源码[:：]|Source:)/i.test(line)
      || /^\[!\[[^\]]*\]\(/.test(line)
    ) {
      flush()
      continue
    }
    paragraph.push(line)
  }
  flush()

  const fallback = defaultDescription(contentLocale, title)
  return shortenDescription(candidates[0] ?? fallback)
}

function descriptionFor(page: DocsPage, title: string): string {
  return extractSeoDescription(readFileSync(resolve(root, page.source), 'utf8'), page.contentLocale, title)
}

export function resolveDocsSeo(page: DocsPage, pageTitle?: string): ResolvedDocsSeo {
  const owner = canonicalOwner(page)
  const title = pageTitle?.trim() || page.label || SITE_NAME
  const fullTitle = title === SITE_NAME ? SITE_NAME : `${title} | ${SITE_NAME}`
  const metadata = metadataFor(page.contentLocale)
  const canonical = absoluteRoute(owner)
  const description = descriptionFor(page, title)
  const indexable = pageIsIndexable(page)
  const alternates = localizedAlternates(owner)
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': indexable ? 'TechArticle' : 'WebPage',
    name: fullTitle,
    headline: title,
    description,
    url: canonical,
    inLanguage: metadata.htmlLang,
    isPartOf: {
      '@type': 'WebSite',
      name: SITE_NAME,
      url: `${SITE_ORIGIN}/`,
    },
  }
  return {
    route: routeLink(page.route),
    canonical,
    description,
    fullTitle,
    htmlLang: metadata.htmlLang,
    indexable,
    ogLocale: metadata.ogLocale,
    alternates,
    robots: indexable
      ? 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
      : 'noindex, follow',
    structuredData,
  }
}

export function resolveDocsSeoFromPageData(pageData: Pick<PageData, 'relativePath' | 'title'>): ResolvedDocsSeo | undefined {
  const page = pageByRoute.get(pageData.relativePath)
  return page === undefined ? undefined : resolveDocsSeo(page, pageData.title)
}

export function seoHead(seo: ResolvedDocsSeo): SeoHeadEntry[] {
  const ogAlternates = [...new Set(seo.alternates
    .filter(item => item.hreflang !== 'x-default' && item.ogLocale !== seo.ogLocale)
    .map(item => item.ogLocale))]
  return [
    ['link', { rel: 'canonical', href: seo.canonical }],
    ...seo.alternates.map(item => ['link', { rel: 'alternate', hreflang: item.hreflang, href: item.href }] as SeoHeadEntry),
    ['meta', { name: 'robots', content: seo.robots }],
    ['meta', { property: 'og:site_name', content: SITE_NAME }],
    ['meta', { property: 'og:locale', content: seo.ogLocale }],
    ...ogAlternates.map(locale => ['meta', { property: 'og:locale:alternate', content: locale }] as SeoHeadEntry),
    ['meta', { property: 'og:type', content: seo.indexable ? 'article' : 'website' }],
    ['meta', { property: 'og:title', content: seo.fullTitle }],
    ['meta', { property: 'og:description', content: seo.description }],
    ['meta', { property: 'og:url', content: seo.canonical }],
    ['meta', { name: 'twitter:card', content: 'summary' }],
    ['meta', { name: 'twitter:title', content: seo.fullTitle }],
    ['meta', { name: 'twitter:description', content: seo.description }],
    ['script', { type: 'application/ld+json' }, JSON.stringify(seo.structuredData)],
  ]
}

export function applySeoToPageData(pageData: PageData): void {
  const seo = resolveDocsSeoFromPageData(pageData)
  if (seo === undefined) return
  pageData.description = seo.description
  const currentHead = Array.isArray(pageData.frontmatter.head)
    ? pageData.frontmatter.head as SeoHeadEntry[]
    : []
  pageData.frontmatter.head = [...currentHead, ...seoHead(seo)]
}

export function applyContentLanguageToHtml(code: string, pageData: Pick<PageData, 'relativePath' | 'title'>): string {
  const seo = resolveDocsSeoFromPageData(pageData)
  if (seo === undefined) return code
  return code.replace(/<html lang="[^"]+"/, `<html lang="${seo.htmlLang}"`)
}

export interface SeoSitemapItem {
  url: string
  links?: Array<{ lang: string; hreflang?: string; url: string }>
}

export function transformSitemapItems<T extends SeoSitemapItem>(items: T[]): T[] {
  const byPath = new Map(docsPages.map(page => [routeLink(page.route), page]))
  return items.flatMap((item) => {
    const pathname = new URL(item.url, `${SITE_ORIGIN}/`).pathname
    const page = byPath.get(pathname)
    if (page === undefined) throw new Error(`Sitemap contains an unknown route: ${pathname}`)
    if (!pageIsIndexable(page)) return []
    const seo = resolveDocsSeo(page)
    return [{
      ...item,
      links: seo.alternates.map(alternate => ({
        lang: alternate.hreflang,
        hreflang: alternate.hreflang,
        url: alternate.href,
      })),
    }]
  })
}

export function docsPageForRoute(route: string): DocsPage | undefined {
  return docsPages.find(page => routeLink(page.route) === route)
}

export function publishedSeoLocales(): readonly LocaleRecord[] {
  return publishedLocales
}

export function validateSeoLocaleCoverage(): void {
  for (const page of docsPages) {
    if (!localeByKey.has(page.locale)) throw new Error(`Route ${page.route} has no published locale SEO record.`)
    if (!localeById.has(page.contentLocale)) {
      throw new Error(`Route ${page.route} uses unpublished content locale ${page.contentLocale}.`)
    }
  }
}

validateSeoLocaleCoverage()
