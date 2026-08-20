import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, posix, resolve } from 'node:path'
import type { Nodes } from 'mdast'
import { parseMarkdown, REPOSITORY_URL, resolveRepoTarget, type LocaleId } from './projection-model.ts'

interface Replacement { start: number; end: number; value: string }
type RewritableNode = Extract<Nodes, { type: 'link' | 'image' | 'definition' }>

function splitTarget(url: string): { path: string; suffix: string } {
  const boundary = url.search(/[?#]/)
  return boundary === -1 ? { path: url, suffix: '' } : { path: url.slice(0, boundary), suffix: url.slice(boundary) }
}

function isExternal(url: string): boolean {
  return url.startsWith('//') || url.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(url)
}

function labelEnd(source: string): number {
  const first = source.indexOf('[')
  if (first === -1) return -1
  let depth = 0
  for (let index = first; index < source.length; index += 1) {
    if (source[index] === '\\') index += 1
    else if (source[index] === '[') depth += 1
    else if (source[index] === ']' && --depth === 0) return index
  }
  return -1
}

function destinationRange(rawNode: string, type: RewritableNode['type']): { start: number; end: number } {
  const endOfLabel = labelEnd(rawNode)
  if (endOfLabel === -1) throw new Error(`markdown-projector: cannot locate label in ${JSON.stringify(rawNode)}.`)
  let start = endOfLabel + 2
  if (type === 'definition') {
    const colon = rawNode.indexOf(':', endOfLabel + 1)
    if (colon === -1) throw new Error(`markdown-projector: cannot locate definition separator.`)
    start = colon + 1
  }
  while (/\s/.test(rawNode[start] ?? '')) start += 1
  if (rawNode[start] === '<') {
    const end = rawNode.indexOf('>', start + 1)
    if (end === -1) throw new Error('markdown-projector: unclosed angle destination.')
    return { start: start + 1, end }
  }
  let depth = 0
  for (let index = start; index < rawNode.length; index += 1) {
    const char = rawNode[index]
    if (char === '\\') index += 1
    else if (char === '(') depth += 1
    else if (char === ')' && depth-- === 0) return { start, end: index }
    else if (/\s/.test(char ?? '') && depth === 0) return { start, end: index }
  }
  return { start, end: rawNode.length }
}

function walk(node: Nodes, visit: (node: RewritableNode) => void): void {
  if (node.type === 'link' || node.type === 'image' || node.type === 'definition') visit(node)
  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) walk(child as Nodes, visit)
  }
}

export interface RewriteOptions {
  repoRoot: string
  sourcePath: string
  locale: LocaleId
  upstreamCommit: string
  sourceToRoute: Map<string, { route: string; nativeLocales: Set<LocaleId> }>
  fragmentToRoute: Map<string, { route: string; nativeLocales: Set<LocaleId> }>
}

function publishedSourceCandidate(path: string, sourceToRoute: RewriteOptions['sourceToRoute']): string | undefined {
  const candidates = [path]
  if (!posix.extname(path)) candidates.push(`${path}.md`, posix.join(path, 'index.md'))
  if (path.endsWith('/')) candidates.push(posix.join(path, 'index.md'))
  return candidates.find(candidate => sourceToRoute.has(candidate))
}

export function rewriteMarkdown(markdown: string, options: RewriteOptions): string {
  const tree = parseMarkdown(markdown)
  const replacements: Replacement[] = []
  walk(tree, (node) => {
    if (isExternal(node.url)) return
    const position = node.position
    if (position?.start.offset === undefined || position.end.offset === undefined) {
      throw new Error('markdown-projector: link node has no offsets.')
    }
    const rawNode = markdown.slice(position.start.offset, position.end.offset)
    const destination = destinationRange(rawNode, node.type)
    const { path, suffix } = splitTarget(node.url)
    if (path === '') {
      const owner = options.fragmentToRoute.get(`${options.locale}:${options.sourcePath}${suffix}`)
      if (owner === undefined) return
      const locale = owner.nativeLocales.has(options.locale) ? options.locale : 'en-US'
      replacements.push({
        start: position.start.offset + destination.start,
        end: position.start.offset + destination.end,
        value: `${locale === 'zh-CN' ? '' : '/en'}${owner.route}${suffix}`,
      })
      return
    }
    const resolved = resolveRepoTarget(options.sourcePath, path)
    const publishedPath = publishedSourceCandidate(resolved, options.sourceToRoute)
    let target: string
    if (publishedPath !== undefined) {
      const owner = options.sourceToRoute.get(publishedPath)
      if (owner === undefined) throw new Error('markdown-projector: impossible published route state.')
      const locale = owner.nativeLocales.has(options.locale) ? options.locale : 'en-US'
      target = `${locale === 'zh-CN' ? '' : '/en'}${owner.route}${suffix}`
    } else if (node.type === 'image') {
      const source = resolve(options.repoRoot, resolved)
      if (!existsSync(source)) throw new Error(`markdown-projector: missing image ${resolved}.`)
      const output = resolve(options.repoRoot, 'public/assets', resolved)
      mkdirSync(dirname(output), { recursive: true })
      copyFileSync(source, output)
      target = `/assets/${resolved}${suffix}`
    } else {
      target = `${REPOSITORY_URL}/blob/${options.upstreamCommit}/${resolved}${suffix}`
    }
    replacements.push({
      start: position.start.offset + destination.start,
      end: position.start.offset + destination.end,
      value: target,
    })
  })
  let result = markdown
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    result = `${result.slice(0, replacement.start)}${replacement.value}${result.slice(replacement.end)}`
  }
  return result
}
