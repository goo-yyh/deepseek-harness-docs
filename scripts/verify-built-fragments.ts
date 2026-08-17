/** Verify every built site-internal URL fragment resolves to a rendered element ID. */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { SITE_ORIGIN } from '../website/seo.ts'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'website/.dist')
const auditOrigin = 'https://fragment-audit.invalid'

interface HtmlPage {
  file: string
  pathname: string
  ids: Set<string>
  hrefs: string[]
}

function htmlFiles(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory).flatMap((entry) => {
    const child = resolve(directory, entry)
    return statSync(child).isDirectory()
      ? htmlFiles(child)
      : entry.endsWith('.html') ? [child] : []
  })
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function attributes(html: string, name: string): string[] {
  const values: string[] = []
  const tagPattern = /<[a-zA-Z][^>]*>/g
  const attributePattern = new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i')
  for (const tag of html.match(tagPattern) ?? []) {
    const value = tag.match(attributePattern)?.[2]
    if (value !== undefined) values.push(decodeHtmlAttribute(value))
  }
  return values
}

function publicPath(file: string): string {
  const path = relative(dist, file).split(sep).join('/')
  if (path === 'index.html') return '/'
  if (path.endsWith('/index.html')) return `/${path.slice(0, -'index.html'.length)}`
  return `/${path.replace(/\.html$/, '')}`
}

function candidateTargetFiles(pathname: string): string[] {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return []
  }
  const relativePath = decoded.replace(/^\/+/, '')
  if (relativePath === '') return [resolve(dist, 'index.html')]
  if (relativePath.endsWith('/')) return [resolve(dist, relativePath, 'index.html')]
  if (relativePath.endsWith('.html')) return [resolve(dist, relativePath)]
  return [resolve(dist, `${relativePath}.html`), resolve(dist, relativePath, 'index.html')]
}

const pages = htmlFiles(dist).map((file): HtmlPage => {
  const html = readFileSync(file, 'utf8')
  return {
    file,
    pathname: publicPath(file),
    ids: new Set(attributes(html, 'id')),
    hrefs: attributes(html, 'href'),
  }
})
const pageByFile = new Map(pages.map(page => [page.file, page]))
const failures: string[] = []
let checked = 0

for (const page of pages) {
  for (const href of page.hrefs) {
    if (!href.includes('#') || href === '#') continue
    let target: URL
    try {
      target = new URL(href, `${auditOrigin}${page.pathname}`)
    } catch {
      failures.push(`${page.pathname} has malformed href ${JSON.stringify(href)}`)
      continue
    }
    if (target.hash === '' || target.hash.startsWith('#:~:text=')) continue
    if (target.origin !== auditOrigin && target.origin !== SITE_ORIGIN) continue
    const targetPage = candidateTargetFiles(target.pathname)
      .map(file => pageByFile.get(file))
      .find((candidate): candidate is HtmlPage => candidate !== undefined)
    if (targetPage === undefined) {
      failures.push(`${page.pathname} -> ${href}: target page was not built`)
      continue
    }
    let fragment: string
    try {
      fragment = decodeURIComponent(target.hash.slice(1))
    } catch {
      failures.push(`${page.pathname} -> ${href}: malformed fragment escape`)
      continue
    }
    checked += 1
    if (!targetPage.ids.has(fragment)) {
      failures.push(`${page.pathname} -> ${href}: missing id=${JSON.stringify(fragment)} on ${targetPage.pathname}`)
    }
  }
}

if (failures.length > 0) {
  throw new Error(
    `docs:fragments: ${failures.length} broken internal fragment(s):\n${failures.slice(0, 30).join('\n')}`,
  )
}

console.log(`docs:fragments: ${checked} internal fragments across ${pages.length} HTML pages passed.`)
