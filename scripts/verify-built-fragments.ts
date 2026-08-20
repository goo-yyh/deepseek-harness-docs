import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { SITE_ORIGIN } from './projection-model.ts'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
const auditOrigin = 'https://fragment-audit.invalid'
interface HtmlPage { file: string; pathname: string; ids: Set<string>; hrefs: string[] }
function htmlFiles(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory).flatMap((entry) => {
    const child = resolve(directory, entry)
    return statSync(child).isDirectory() ? htmlFiles(child) : entry.endsWith('.html') ? [child] : []
  })
}
function decode(value: string): string {
  return value.replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code))).replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16))).replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
}
function attributes(html: string, name: string): string[] {
  return (html.match(/<[a-zA-Z][^>]*>/g) ?? []).flatMap(tag => {
    const value = tag.match(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2]
    return value === undefined ? [] : [decode(value)]
  })
}
function publicPath(file: string): string {
  const path = relative(dist, file).split(sep).join('/')
  return path === 'index.html' ? '/' : `/${path.replace(/\/index\.html$/, '').replace(/\.html$/, '')}`
}
const pages = htmlFiles(dist).map((file): HtmlPage => {
  const html = readFileSync(file, 'utf8')
  return { file, pathname: publicPath(file), ids: new Set(attributes(html, 'id')), hrefs: attributes(html, 'href') }
})
const byPath = new Map(pages.map(page => [page.pathname, page]))
const failures: string[] = []
let checked = 0
for (const page of pages) {
  for (const href of page.hrefs) {
    if (!href.includes('#') || href === '#') continue
    let target: URL
    try { target = new URL(href, `${auditOrigin}${page.pathname}`) } catch { failures.push(`${page.pathname} malformed ${href}`); continue }
    if (!target.hash || target.hash.startsWith('#:~:text=') || (target.origin !== auditOrigin && target.origin !== SITE_ORIGIN)) continue
    const targetPage = byPath.get(target.pathname.replace(/\/$/, ''))
    if (targetPage === undefined) { failures.push(`${page.pathname} -> ${href}: target page not built`); continue }
    const fragment = decodeURIComponent(target.hash.slice(1))
    checked += 1
    if (!targetPage.ids.has(fragment)) failures.push(`${page.pathname} -> ${href}: missing id=${fragment}`)
  }
}
if (failures.length > 0) throw new Error(`docs:fragments: ${failures.length} failure(s):\n${failures.slice(0, 40).join('\n')}`)
console.log(`docs:fragments: ${checked} internal fragments across ${pages.length} HTML pages passed.`)
