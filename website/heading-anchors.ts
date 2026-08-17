/** Stable heading identities shared by the projector and VitePress renderer. */

import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import type { Nodes } from 'mdast'

type HeadingNode = Extract<Nodes, { type: 'heading' }>

interface MarkdownAnchorState {
  env: { frontmatter?: Record<string, unknown> }
}

const headingIndexByRender = new WeakMap<object, number>()

/** Keep this byte-for-byte equivalent to VitePress 1.6's default slugifier. */
export function vitePressSlugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase()
}

/** Use projection-owned English heading IDs when a translated page supplies them. */
export function stableHeadingSlug(title: string, state: MarkdownAnchorState): string {
  const index = headingIndexByRender.get(state) ?? 0
  headingIndexByRender.set(state, index + 1)
  const slugs = state.env.frontmatter?.canonicalHeadingSlugs
  if (slugs === undefined) return vitePressSlugify(title)
  if (!Array.isArray(slugs) || slugs.some(slug => typeof slug !== 'string')) {
    throw new Error('Projected canonicalHeadingSlugs frontmatter must be an array of strings.')
  }
  const slug: unknown = slugs[index]
  if (typeof slug !== 'string') {
    throw new Error(`Projected canonicalHeadingSlugs is missing heading ${index + 1}.`)
  }
  return slug
}

function headings(markdown: string): HeadingNode[] {
  const tree = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  const found: HeadingNode[] = []
  const visit = (node: Nodes): void => {
    if (node.type === 'heading') found.push(node)
    if ('children' in node) {
      for (const child of node.children) visit(child)
    }
  }
  visit(tree)
  return found
}

/** Text consumed by markdown-it-anchor: ordinary text plus inline-code bytes. */
function headingText(node: Nodes): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value
  if (!('children' in node)) return ''
  return node.children.map(child => headingText(child)).join('')
}

function uniqueSlugs(sourceHeadings: HeadingNode[]): string[] {
  const used = new Set<string>()
  return sourceHeadings.map((heading) => {
    const base = vitePressSlugify(headingText(heading))
    let slug = base
    let duplicate = 1
    while (used.has(slug)) {
      slug = `${base}-${duplicate}`
      duplicate += 1
    }
    used.add(slug)
    return slug
  })
}

/**
 * Bind translated headings to the same-position English heading identities.
 *
 * Translation validation owns full AST equality. The projector repeats the
 * heading count/depth check because it is the last boundary before rendering:
 * stale or malformed locale content must not silently receive the wrong IDs.
 */
export function stableTranslatedHeadingSlugs(canonicalEnglish: string, translated: string): string[] {
  const canonicalHeadings = headings(canonicalEnglish)
  const translatedHeadings = headings(translated)
  if (translatedHeadings.length !== canonicalHeadings.length) {
    throw new Error(
      `heading-anchors: translated page has ${translatedHeadings.length} headings; `
      + `canonical English has ${canonicalHeadings.length}.`,
    )
  }
  for (const [index, canonical] of canonicalHeadings.entries()) {
    const target = translatedHeadings[index]
    if (target?.depth !== canonical.depth) {
      throw new Error(
        `heading-anchors: translated heading ${index + 1} has depth ${target?.depth ?? 'missing'}; `
        + `canonical English has depth ${canonical.depth}.`,
      )
    }
  }
  return uniqueSlugs(canonicalHeadings)
}
