/** Fail-closed structural, language, and source-hash audit for Codex locale pages. */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import type { Nodes, Root } from 'mdast'

export type TargetLocale = 'ja-JP' | 'ko-KR'

export interface ManifestPage {
  id: string
  locales: Record<string, { source: string; label?: string }>
}

interface DocsManifest {
  upstream_commit: string
  canonical_page_count: number
  pages: ManifestPage[]
}

interface LockedSource { path: string; git_blob: string; sha256: string }
interface UpstreamLock { commit: string; published_sources: LockedSource[] }

export interface TranslationPageState {
  page_id: string
  source_path: string
  source_git_blob_sha: string
  source_sha256: string
  normalized_source_sha256: string
  reviewed_source_sha256: string
  target_path: string
  target_sha256: string
  navigation_label: string
  translation_review: 'generated' | 'validated' | string
}

export interface TranslationState {
  schema_version: number
  locale: TargetLocale
  source_locale: string
  upstream_commit: string
  model: string
  model_fingerprint: string
  reasoning_effort: string
  generated_at: string
  validated_at: string
  human_review: 'not_recorded' | 'approved' | string
  generation_provenance: Array<{
    model: string
    reasoning_effort: string
    codex: {
      version: string
      executable_sha256: string
      requested_model: string
      requested_reasoning_effort: string
    }
  }>
  generation_receipts_sha256: string
  pages: TranslationPageState[]
}

interface SemanticBlock {
  kind: 'heading' | 'paragraph' | 'tableCell' | 'imageAlt'
  text: string
  technicalHeading?: boolean
}
interface ContainerMarker { action: 'open' | 'close'; marker: string; indent: string; type?: string; depth: number }

const root = resolve(import.meta.dirname, '..')
const LANGUAGE_SWITCHER = /^(?:English \| \[中文\]\([^)]*\)|\[English\]\([^)]*\) \| 中文)$/
const REPOSITORY_BADGE = /^\[!\[[^\]]*\]\(https:\/\/img\.shields\.io\/[^)]*\)\]\([^)]*\)$/
const ENGLISH_WORD = /[A-Za-z][A-Za-z'’-]*/g

/** Product/ecosystem names and code-adjacent nouns that may remain Latin. */
const ENGLISH_RESIDUAL_ALLOWLIST = new Set([
  'agent-scope', 'api', 'apis', 'bash', 'cli', 'codex', 'cordis', 'css', 'deepseek', 'dsh', 'esm', 'git', 'github',
  'gpt', 'harness', 'hmr', 'html', 'http', 'https', 'javascript', 'json', 'jsonl', 'jsx', 'llm', 'llms',
  'lsp', 'markdown', 'mcp', 'mermaid', 'node', 'npm', 'openai', 'pnpm', 'python', 'react', 'rest', 'rpc',
  'runtime-design', 'sdk', 'sdks', 'shared-storage', 'sql', 'sse', 'ssh', 'toml', 'typescript', 'tsx', 'typert', 'ui', 'uri', 'url', 'urls',
  'vite', 'vitepress', 'websocket', 'yaml', 'yarn',
])
const ENGLISH_ALLOWED_PHRASES = [
  /\bAgent Client Protocol\b/gi,
  /\bDeepSeek Harness\b/gi,
  /\bNode\.js\b/gi,
  /\bVisual Studio Code\b/gi,
]

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8')) as T
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function jsonFingerprint(value: unknown): string {
  return sha256(`${JSON.stringify(value)}\n`)
}

export function normalizeTranslationSource(markdown: string): string {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  const switcher = lines.findIndex(line => LANGUAGE_SWITCHER.test(line))
  if (switcher !== -1) lines.splice(switcher, lines[switcher + 1] === '' ? 2 : 1)
  const badge = lines.findLastIndex(line => REPOSITORY_BADGE.test(line))
  if (badge !== -1) lines.splice(lines[badge - 1] === '' ? badge - 1 : badge, lines[badge - 1] === '' ? 2 : 1)
  return `${lines.join('\n').trimEnd()}\n`
}

function parseMarkdown(markdown: string): Root {
  return fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
}

function withoutFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---\n')) return markdown
  const end = markdown.indexOf('\n---\n', 4)
  return end === -1 ? markdown : markdown.slice(end + 5)
}

function frontmatter(markdown: string): string {
  if (!markdown.startsWith('---\n')) return ''
  const end = markdown.indexOf('\n---\n', 4)
  return end === -1 ? '__UNCLOSED__' : markdown.slice(0, end + 5)
}

function containerMarkers(markdown: string): { markers: ContainerMarker[]; error?: string } {
  const markers: ContainerMarker[] = []
  const stack: Array<{ marker: string; type: string }> = []
  let fence: { character: string; length: number } | undefined
  for (const [index, line] of markdown.replaceAll('\r\n', '\n').split('\n').entries()) {
    const fenceMarker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence !== undefined) {
      if (fenceMarker?.[0] === fence.character && fenceMarker.length >= fence.length) fence = undefined
      continue
    }
    if (fenceMarker !== undefined) {
      fence = { character: fenceMarker[0], length: fenceMarker.length }
      continue
    }
    const match = /^(\s*)(:{3,})(?:\s+([^\s]+)(?:\s+.*)?)?\s*$/.exec(line)
    if (match === null) continue
    const [, indent, marker, type] = match
    if (type === undefined) {
      const opened = stack.pop()
      markers.push({ action: 'close', marker, indent, depth: stack.length })
      if (opened === undefined) return { markers, error: `unmatched container close on line ${index + 1}` }
      if (opened.marker !== marker) return { markers, error: `container marker mismatch on line ${index + 1}` }
    } else {
      markers.push({ action: 'open', marker, indent, type, depth: stack.length })
      stack.push({ marker, type })
    }
  }
  if (stack.length > 0) return { markers, error: `${stack.length} unclosed VitePress container(s)` }
  return { markers }
}

export interface StructureInventory {
  ordered: string[]
  immutableMultiset: string[]
}

/** Ordered immutable values stay at their semantic AST positions. */
export function structureInventory(markdown: string): StructureInventory {
  const tree = parseMarkdown(markdown)
  const rawContainerMarkers = [...markdown.matchAll(/^(\s*:::(?:\s+[A-Za-z][\w-]*)?)(?=\s|$)/gm)]
    .map(match => match[1])
  const tokens: string[] = [
    `frontmatter:${sha256(frontmatter(markdown))}`,
    `vitepress-containers:${sha256(rawContainerMarkers.join('\n'))}`,
  ]
  const immutableTokens: string[] = []
  const visit = (node: Nodes): void => {
    if (node.type === 'text') return
    switch (node.type) {
      case 'root': tokens.push('root'); break
      case 'paragraph': tokens.push('paragraph'); break
      case 'heading': tokens.push(`heading:${node.depth}`); break
      case 'blockquote': tokens.push('blockquote'); break
      case 'list': tokens.push(`list:${node.ordered ? 'ordered' : 'unordered'}:${node.start ?? ''}:${node.spread ?? ''}`); break
      case 'listItem': tokens.push(`listItem:${node.checked ?? ''}:${node.spread ?? ''}`); break
      case 'code': tokens.push(`code:${node.lang ?? ''}:${node.meta ?? ''}:${sha256(node.value)}`); break
      case 'inlineCode': immutableTokens.push(`inlineCode:${node.value}`); return
      case 'link': tokens.push(`link:${node.url}:${node.title ?? ''}`); break
      case 'image': tokens.push(`image:${node.url}:${node.title ?? ''}`); return
      case 'definition': tokens.push(`definition:${node.identifier}:${node.url}:${node.title ?? ''}`); return
      case 'table': tokens.push(`table:${JSON.stringify(node.align)}`); break
      case 'tableRow': tokens.push(`tableRow:${node.children.length}`); break
      case 'tableCell': tokens.push('tableCell'); break
      case 'html': tokens.push(`html:${sha256(node.value)}`); break
      case 'thematicBreak': tokens.push('thematicBreak'); break
      case 'break': tokens.push('break'); break
      case 'emphasis': tokens.push('emphasis'); break
      case 'strong': tokens.push('strong'); break
      case 'delete': tokens.push('delete'); break
      case 'linkReference': tokens.push(`linkReference:${node.identifier}:${node.referenceType}`); break
      case 'imageReference': tokens.push(`imageReference:${node.identifier}:${node.referenceType}`); return
      default: tokens.push(node.type)
    }
    if ('children' in node) for (const child of node.children) visit(child)
    tokens.push(`/${node.type}`)
  }
  visit(tree)
  return { ordered: tokens, immutableMultiset: immutableTokens.sort() }
}

export function structureFingerprint(markdown: string): string {
  const inventory = structureInventory(markdown)
  return sha256(`${inventory.ordered.join('\n')}\n-- immutable multiset --\n${inventory.immutableMultiset.join('\n')}`)
}

export function describeStructureMismatch(source: string, target: string): string | undefined {
  const sourceInventory = structureInventory(source)
  const targetInventory = structureInventory(target)
  const orderedIndex = sourceInventory.ordered.findIndex((token, index) => token !== targetInventory.ordered[index])
  if (orderedIndex !== -1 || sourceInventory.ordered.length !== targetInventory.ordered.length) {
    const index = orderedIndex === -1
      ? Math.min(sourceInventory.ordered.length, targetInventory.ordered.length)
      : orderedIndex
    return `ordered[${index}] source=${JSON.stringify(sourceInventory.ordered[index])} target=${JSON.stringify(targetInventory.ordered[index])}`
  }
  const immutableIndex = sourceInventory.immutableMultiset.findIndex(
    (token, index) => token !== targetInventory.immutableMultiset[index],
  )
  if (immutableIndex !== -1 || sourceInventory.immutableMultiset.length !== targetInventory.immutableMultiset.length) {
    const index = immutableIndex === -1
      ? Math.min(sourceInventory.immutableMultiset.length, targetInventory.immutableMultiset.length)
      : immutableIndex
    return `immutable[${index}] source=${JSON.stringify(sourceInventory.immutableMultiset[index])} target=${JSON.stringify(targetInventory.immutableMultiset[index])}`
  }
  return undefined
}

function nodeText(node: Nodes, includeInlineCode = false): string {
  if (node.type === 'text') return node.value
  if (node.type === 'image') return node.alt ?? ''
  if (node.type === 'inlineCode') return includeInlineCode ? node.value : ''
  if (node.type === 'code' || node.type === 'html') return ''
  if (!('children' in node)) return ''
  return node.children.map(child => nodeText(child, includeInlineCode)).join(' ')
}

function hasInlineCode(node: Nodes): boolean {
  if (node.type === 'inlineCode') return true
  return 'children' in node && node.children.some(child => hasInlineCode(child))
}

function semanticBlocks(markdown: string): SemanticBlock[] {
  const found: SemanticBlock[] = []
  const visit = (node: Nodes): void => {
    if (node.type === 'heading' || node.type === 'paragraph' || node.type === 'tableCell') {
      const text = nodeText(node, node.type === 'heading').replace(/\s+/g, ' ').trim()
      const plainHeadingText = node.type === 'heading'
        ? nodeText(node).replace(/\s+/g, ' ').trim()
        : ''
      found.push({
        kind: node.type,
        text,
        technicalHeading: node.type === 'heading'
          ? (hasInlineCode(node) && plainHeadingText === '') || isTechnicalHeading(text)
          : undefined,
      })
    }
    if (node.type === 'image') {
      found.push({ kind: 'imageAlt', text: (node.alt ?? '').trim() })
      return
    }
    if ('children' in node) for (const child of node.children) visit(child)
  }
  visit(parseMarkdown(withoutFrontmatter(markdown)))
  return found
}

function prose(markdown: string): string {
  return semanticBlocks(markdown).map(block => block.text).join(' ')
}

function normalizedWords(text: string): string[] {
  let cleaned = text
  for (const phrase of ENGLISH_ALLOWED_PHRASES) cleaned = cleaned.replace(phrase, ' ')
  cleaned = cleaned
    .replace(/\b(?:@deepseek-ai\/)?dsh(?:-[a-z0-9]+)+\b/gi, ' ')
    .replace(/\bAgent Note\b/g, ' ')
    .replace(/\bREADME\b/g, ' ')
  return (cleaned.match(ENGLISH_WORD) ?? []).map(word => word.toLowerCase())
}

function isTechnicalLiteralText(text: string): boolean {
  const candidate = text.trim()
  return (
    /^(?:\.{0,2}\/|~\/|@)?[^\s]+\.(?:md|mdx|json|jsonl|ya?ml|toml|tsx?|jsx?|mjs|cjs|py|rs|go|sh|zsh|bash|css|html?)$/i.test(candidate)
    || /^(?:https?:\/\/|[a-z]+:)[^\s]+$/i.test(candidate)
  )
}

function ordinaryEnglishWords(text: string): string[] {
  if (isTechnicalLiteralText(text)) return []
  return normalizedWords(text).filter(word => !ENGLISH_RESIDUAL_ALLOWLIST.has(word))
}

function targetScriptCount(locale: TargetLocale, text: string): number {
  const expression = locale === 'ja-JP'
    ? /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu
    : /\p{Script=Hangul}/gu
  return text.match(expression)?.length ?? 0
}

function visibleLength(text: string): number {
  return text.replace(/[\s\p{P}\p{S}]/gu, '').length
}

function isSourceTechnicalEnumeration(run: string, sourceText: string): boolean {
  const candidate = run.trim().replace(/^[([{]\s*/, '').replace(/[)\]};:.]+$/, '').trim()
  if (!candidate.includes(',') || !sourceText.includes(candidate)) return false
  const items = candidate.split(',').map(item => item.trim()).filter(Boolean)
  if (items.length < 4 || items.some(item => !/^[A-Za-z_$][\w$]*$/.test(item))) return false
  const codeShaped = items.filter(item => /[a-z][A-Z]|^[A-Z][A-Za-z0-9_$]*$/.test(item))
  if (codeShaped.length >= Math.ceil(items.length / 2)) return true
  const sourceDeclaresTechnicalList = /\b(?:identifiers?|keywords?|operations?|providers?|famil(?:y|ies)|examples?)\b/i.test(sourceText)
  const protectedItems = items.filter(item => ENGLISH_RESIDUAL_ALLOWLIST.has(item.toLowerCase()))
  return sourceDeclaresTechnicalList && protectedItems.length > 0
}

function residualEnglishRun(text: string, sourceText: string): string | undefined {
  const runs = text.match(/(?:[A-Za-z][A-Za-z'’-]*(?:[\s,;:()]+|$)){4,}/g) ?? []
  return runs.find(run => (
    ordinaryEnglishWords(run).length >= 4
    && !isSourceTechnicalEnumeration(run, sourceText)
  ))?.trim()
}

function isTechnicalHeading(text: string): boolean {
  const heading = text.trim()
  return (
    // A single CamelCase/snake_case identifier is an API symbol, not prose.
    // Ordinary title words such as `Core`, `Settings`, and `Consumers` remain
    // outside this exemption and must still be localized.
    (/^[A-Za-z_$][\w$]*$/.test(heading)
      && (/[a-z][A-Z]/.test(heading) || /[_$]/.test(heading.slice(1)) || /\d/.test(heading)))
    || /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\([^\n)]*\)$/.test(heading)
    || /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(heading)
    || /^[A-Za-z_$][\w$]*(?::[A-Za-z_$][\w$]*)+$/.test(heading)
    || /^[A-Za-z_$][\w$]*<[^\n<>]+>$/.test(heading)
    || /^--[\w-]+(?:[ =][A-Z_<[{].*)?$/.test(heading)
    || /^(?:\.{0,2}\/|~\/|@)[^\s]+$/.test(heading)
    || /^[\w$./*:@-]+(?:\s+[—-]\s+[\w$./*:@-]+)$/.test(heading)
  )
}

function auditSemanticText(locale: TargetLocale, descriptor: string, sourceText: string, targetText: string): string[] {
  const issues: string[] = []
  const sourceWords = ordinaryEnglishWords(sourceText)
  if (sourceWords.length === 0) return issues
  if (targetText.trim() === '') return [`${descriptor}: translated text is empty`]
  const exactCopy = sourceText.replace(/\s+/g, ' ').trim() === targetText.replace(/\s+/g, ' ').trim()
  if (exactCopy && sourceWords.length >= 2) issues.push(`${descriptor}: English source text was copied unchanged`)
  if (sourceWords.length >= 2 && targetScriptCount(locale, targetText) === 0) {
    issues.push(`${descriptor}: target-language text is missing`)
  }
  const sourceLength = visibleLength(sourceText)
  const targetLength = visibleLength(targetText)
  if (sourceLength >= 20 && targetLength / sourceLength < 0.12) issues.push(`${descriptor}: translation is implausibly short`)
  if (sourceLength >= 20 && targetLength / sourceLength > 4.5) issues.push(`${descriptor}: translation is implausibly long`)
  const residue = residualEnglishRun(targetText, sourceText)
  if (residue !== undefined) issues.push(`${descriptor}: unallowlisted English prose remains: ${JSON.stringify(residue.slice(0, 100))}`)
  return issues
}

export function auditMarkdownContent(
  locale: TargetLocale,
  pageId: string,
  source: string,
  target: string,
): string[] {
  const issues: string[] = []
  if (structureFingerprint(source) !== structureFingerprint(target)) {
    const detail = describeStructureMismatch(source, target)
    issues.push(`${locale}:${pageId}: Markdown structure or immutable-value association differs from normalized English${detail ? ` (${detail})` : ''}`)
  }
  const sourceContainers = containerMarkers(source)
  const targetContainers = containerMarkers(target)
  if (sourceContainers.error !== undefined) issues.push(`${locale}:${pageId}: invalid source containers: ${sourceContainers.error}`)
  if (targetContainers.error !== undefined) issues.push(`${locale}:${pageId}: invalid target containers: ${targetContainers.error}`)
  if (JSON.stringify(sourceContainers.markers) !== JSON.stringify(targetContainers.markers)) {
    issues.push(`${locale}:${pageId}: VitePress container markers, types, indentation, or nesting changed`)
  }
  const sourceBlocks = semanticBlocks(source)
  const targetBlocks = semanticBlocks(target)
  if (sourceBlocks.length === targetBlocks.length) {
    for (let index = 0; index < sourceBlocks.length; index += 1) {
      const sourceBlock = sourceBlocks[index]
      const targetBlock = targetBlocks[index]
      if (sourceBlock.kind !== targetBlock.kind) continue
      if (sourceBlock.kind === 'heading' && sourceBlock.technicalHeading === true) continue
      const descriptor = `${locale}:${pageId}:${sourceBlock.kind}[${index + 1}]`
      const blockIssues = auditSemanticText(locale, descriptor, sourceBlock.text, targetBlock.text)
      if (sourceBlock.kind === 'heading' && ordinaryEnglishWords(sourceBlock.text).length >= 1) {
        const exactCopy = sourceBlock.text.replace(/\s+/g, ' ').trim() === targetBlock.text.replace(/\s+/g, ' ').trim()
        if (exactCopy) blockIssues.push(`${descriptor}: English source text was copied unchanged`)
        if (targetScriptCount(locale, targetBlock.text) === 0) blockIssues.push(`${descriptor}: target-language text is missing`)
      }
      issues.push(...new Set(blockIssues))
    }
  }
  const sourceProse = prose(source)
  const targetProse = prose(target)
  const sourceLength = visibleLength(sourceProse)
  const targetLength = visibleLength(targetProse)
  if (sourceLength >= 100 && targetLength / sourceLength < 0.15) issues.push(`${locale}:${pageId}: page translation is hollow or implausibly short`)
  if (sourceLength >= 100 && targetLength / sourceLength > 4) issues.push(`${locale}:${pageId}: page translation is implausibly long`)
  const sourceWordCount = ordinaryEnglishWords(sourceProse).length
  if (sourceWordCount >= 20 && targetScriptCount(locale, targetProse) < Math.max(3, Math.floor(sourceWordCount * 0.12))) {
    issues.push(`${locale}:${pageId}: page has insufficient target-language prose for its English source`)
  }
  return issues
}

export function auditMarkdownPair(
  locale: TargetLocale,
  pageId: string,
  source: string,
  target: string,
  sourceNavigationLabel: string,
  targetNavigationLabel: string,
): string[] {
  return [
    ...auditMarkdownContent(locale, pageId, source, target),
    ...auditSemanticText(
      locale,
      `${locale}:${pageId}:navigation_label`,
      sourceNavigationLabel,
      targetNavigationLabel,
    ),
  ]
}

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

export function auditStateInventory(
  locale: TargetLocale,
  state: TranslationState,
  manifestPages: ManifestPage[],
  canonicalPageCount: number,
  repoRoot = root,
): string[] {
  const issues: string[] = []
  const expectedIds = new Set(manifestPages.map(page => page.id))
  if (manifestPages.length !== canonicalPageCount || expectedIds.size !== canonicalPageCount) {
    issues.push(`${locale}: manifest canonical page inventory is internally inconsistent`)
  }
  if (state.pages.length !== canonicalPageCount) issues.push(`${locale}: expected ${canonicalPageCount} state pages, found ${state.pages.length}`)
  const counts = new Map<string, number>()
  for (const page of state.pages) counts.set(page.page_id, (counts.get(page.page_id) ?? 0) + 1)
  for (const [pageId, count] of counts) {
    if (count > 1) issues.push(`${locale}:${pageId}: duplicate page_id in translation state`)
    if (!expectedIds.has(pageId)) issues.push(`${locale}:${pageId}: extra page_id in translation state`)
  }
  for (const pageId of expectedIds) if (!counts.has(pageId)) issues.push(`${locale}:${pageId}: missing page_id in translation state`)
  const localeKey = locale === 'ja-JP' ? 'ja' : 'ko'
  const localeRoot = resolve(repoRoot, 'docs-locales', localeKey)
  for (const page of state.pages) {
    const manifestPage = manifestPages.find(candidate => candidate.id === page.page_id)
    const sourcePath = manifestPage?.locales['en-US']?.source
    if (sourcePath === undefined) continue
    const expectedTargetPath = `docs-locales/${localeKey}/${sourcePath}`
    const resolvedTarget = resolve(repoRoot, page.target_path)
    if (
      page.target_path !== expectedTargetPath
      || page.target_path.includes('\\')
      || isAbsolute(page.target_path)
      || !isWithin(localeRoot, resolvedTarget)
    ) {
      issues.push(`${locale}:${page.page_id}: target_path must equal ${expectedTargetPath} and stay inside the locale tree`)
    }
    if (page.translation_review !== 'validated') {
      issues.push(`${locale}:${page.page_id}: generated translation has not reached the validated state`)
    }
  }
  return issues
}

export function auditStateProvenance(
  locale: TargetLocale,
  state: TranslationState,
  lockedCommit: string,
  manifestCommit: string,
): string[] {
  const issues: string[] = []
  if (state.schema_version !== 2 || state.locale !== locale || state.source_locale !== 'en-US') {
    issues.push(`${locale}: invalid translation state header`)
  }
  if (state.upstream_commit !== lockedCommit || manifestCommit !== lockedCommit) {
    issues.push(`${locale}: translation state is not bound to the current upstream commit`)
  }
  const generatedAt = Date.parse(state.generated_at)
  const validatedAt = Date.parse(state.validated_at)
  if (
    !state.model
    || !state.model_fingerprint
    || !state.reasoning_effort
    || !Number.isFinite(generatedAt)
    || !Number.isFinite(validatedAt)
    || new Date(generatedAt).toISOString() !== state.generated_at
    || new Date(validatedAt).toISOString() !== state.validated_at
    || generatedAt > validatedAt
    || !/^[a-f0-9]{64}$/.test(state.generation_receipts_sha256)
  ) {
    issues.push(`${locale}: translation generation/validation provenance is incomplete or invalid`)
  }
  if (state.human_review !== 'not_recorded' && state.human_review !== 'approved') {
    issues.push(`${locale}: human_review must explicitly be not_recorded or approved`)
  }
  const generators = state.generation_provenance
  const validGenerators = Array.isArray(generators) && generators.length > 0 && generators.every(generation => (
    typeof generation?.model === 'string'
    && generation.model.length > 0
    && typeof generation.reasoning_effort === 'string'
    && generation.reasoning_effort.length > 0
    && typeof generation.codex?.version === 'string'
    && generation.codex.version.length > 0
    && /^[a-f0-9]{64}$/.test(generation.codex.executable_sha256)
    && generation.codex.requested_model === generation.model
    && generation.codex.requested_reasoning_effort === generation.reasoning_effort
  ))
  if (!validGenerators) {
    issues.push(`${locale}: generation_provenance is incomplete or invalid`)
  } else {
    const generatorFingerprints = generators.map(generator => jsonFingerprint(generator))
    if (new Set(generatorFingerprints).size !== generators.length) {
      issues.push(`${locale}: generation_provenance contains duplicate generators`)
    }
    const expectedModel = generators.length === 1 ? generators[0].model : 'mixed'
    const expectedReasoning = generators.length === 1 ? generators[0].reasoning_effort : 'mixed'
    const expectedFingerprint = generators.length === 1
      ? `${generators[0].model}@${generators[0].codex.version}#${generators[0].codex.executable_sha256}`
      : `mixed#${jsonFingerprint(generators)}`
    if (
      state.model !== expectedModel
      || state.reasoning_effort !== expectedReasoning
      || state.model_fingerprint !== expectedFingerprint
    ) {
      issues.push(`${locale}: model summary does not match generation_provenance`)
    }
  }
  return issues
}

export function auditLanguage(locale: TargetLocale, pageId: string, markdown: string, label: string): string[] {
  const issues: string[] = []
  const text = `${label} ${prose(markdown)}`
  // A redirect-only/product-only page can legitimately contain no target
  // script. Remove the same explicitly allowed ecosystem phrases used by the
  // semantic audit before deciding whether there is enough prose to measure.
  // This does not exempt surrounding English sentences: they remain in the
  // signal and are rejected by the per-block residual-English checks.
  const languageSignal = ENGLISH_ALLOWED_PHRASES.reduce(
    (value, phrase) => value.replace(phrase, ''),
    text,
  )
  const substantive = languageSignal.replace(/[\s\p{P}\p{S}\d]/gu, '')
  if (/\p{Script=Hangul}/u.test(text) && locale === 'ja-JP') issues.push(`${locale}:${pageId}: Japanese translation contains Hangul`)
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) && locale === 'ko-KR') issues.push(`${locale}:${pageId}: Korean translation contains Japanese kana`)
  if (substantive.length < 24) return issues
  if (locale === 'ja-JP') {
    const kana = languageSignal.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0
    if (kana < Math.max(3, Math.floor(substantive.length * 0.005))) issues.push(`${locale}:${pageId}: Japanese translation has insufficient Japanese prose`)
    if (/可以|如果|默认|页面|用户|通过|创建|选择|执行|点击/.test(text)) {
      issues.push(`${locale}:${pageId}: Japanese translation contains likely Chinese prose`)
    }
  } else {
    const hangul = languageSignal.match(/\p{Script=Hangul}/gu)?.length ?? 0
    if (hangul < Math.max(3, Math.floor(substantive.length * 0.01))) issues.push(`${locale}:${pageId}: Korean translation has insufficient Korean prose`)
    if (/\p{Script=Han}{2,}/u.test(text)) issues.push(`${locale}:${pageId}: Korean translation contains likely Chinese prose`)
  }
  return issues
}

function auditLocale(locale: TargetLocale, manifest: DocsManifest, lock: UpstreamLock, lockedSources: Map<string, LockedSource>, problems: string[]): number {
  const state = readJson<TranslationState>(`config/translation-state/${locale}.json`)
  problems.push(...auditStateProvenance(locale, state, lock.commit, manifest.upstream_commit))
  problems.push(...auditStateInventory(locale, state, manifest.pages, manifest.canonical_page_count))
  const entries = new Map<string, TranslationPageState>()
  for (const page of state.pages) if (!entries.has(page.page_id)) entries.set(page.page_id, page)
  for (const manifestPage of manifest.pages) {
    const page = entries.get(manifestPage.id)
    const sourceLocale = manifestPage.locales['en-US']
    const sourcePath = sourceLocale?.source
    if (page === undefined || sourcePath === undefined) continue
    const locked = lockedSources.get(sourcePath)
    const sourceAbs = resolve(root, sourcePath)
    const localeKey = locale === 'ja-JP' ? 'ja' : 'ko'
    const expectedTargetPath = `docs-locales/${localeKey}/${sourcePath}`
    if (page.source_path !== sourcePath || locked === undefined || !existsSync(sourceAbs)) {
      problems.push(`${locale}:${manifestPage.id}: source binding is invalid`)
      continue
    }
    const source = readFileSync(sourceAbs, 'utf8')
    const normalized = normalizeTranslationSource(source)
    if (page.source_git_blob_sha !== locked.git_blob || page.source_sha256 !== locked.sha256 || page.reviewed_source_sha256 !== locked.sha256 || page.normalized_source_sha256 !== sha256(normalized)) {
      problems.push(`${locale}:${manifestPage.id}: reviewed English hashes are stale`)
    }
    if (page.target_path !== expectedTargetPath) continue
    const targetAbs = resolve(root, expectedTargetPath)
    if (!existsSync(targetAbs)) {
      problems.push(`${locale}:${manifestPage.id}: missing target ${expectedTargetPath}`)
      continue
    }
    const target = readFileSync(targetAbs, 'utf8')
    if (page.target_sha256 !== sha256(target)) problems.push(`${locale}:${manifestPage.id}: generated target hash does not match validated state`)
    problems.push(...auditMarkdownPair(locale, manifestPage.id, normalized, target, sourceLocale.label ?? '', page.navigation_label))
    problems.push(...auditLanguage(locale, manifestPage.id, target, page.navigation_label))
  }
  return state.pages.length
}

export function runTranslationAudit(): void {
  const manifest = readJson<DocsManifest>('config/docs-manifest.json')
  const lock = readJson<UpstreamLock>('config/upstream-lock.json')
  const lockedSources = new Map(lock.published_sources.map(source => [source.path, source]))
  const problems: string[] = []
  const jaPages = auditLocale('ja-JP', manifest, lock, lockedSources, problems)
  const koPages = auditLocale('ko-KR', manifest, lock, lockedSources, problems)
  if (problems.length > 0) throw new Error(`docs:i18n failed with ${problems.length} issue(s):\n${problems.slice(0, 100).join('\n')}`)
  console.log(`docs:i18n: ${jaPages} Japanese and ${koPages} Korean pages passed source, structure, semantic, and language audits.`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runTranslationAudit()
