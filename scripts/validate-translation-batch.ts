/** Validate one run-local translation batch before it becomes immutable output. */

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import {
  auditLanguage,
  auditMarkdownPair,
  normalizeTranslationSource,
  type TargetLocale,
} from './audit-translations.ts'

const args = process.argv.slice(2)
const value = (name: string): string | undefined => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

function required(name: string): string {
  const found = value(name)
  if (found === undefined || found === '') throw new Error(`validate-translation-batch: missing ${name}`)
  return found
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

const repoRoot = resolve(required('--repo-root'))
const batchRoot = resolve(required('--batch-root'))
const outputRoot = resolve(required('--output-root'))
const locale = required('--locale') as TargetLocale
if (locale !== 'ja-JP' && locale !== 'ko-KR') throw new Error(`validate-translation-batch: unsupported locale ${locale}`)
if (!inside(repoRoot, batchRoot) || !inside(batchRoot, outputRoot)) {
  throw new Error('validate-translation-batch: batch/output path escapes its run root')
}

const batch = JSON.parse(readFileSync(resolve(batchRoot, 'batch.json'), 'utf8')) as {
  locale: TargetLocale
  pages: Array<{
    page_id: string
    source_path: string
    navigation_label: string
  }>
}
if (batch.locale !== locale || !Array.isArray(batch.pages)) {
  throw new Error('validate-translation-batch: batch metadata does not match the requested locale')
}
const labels = JSON.parse(readFileSync(resolve(outputRoot, 'navigation-labels.json'), 'utf8')) as Record<string, unknown>
const issues: string[] = []
for (const page of batch.pages) {
  const sourcePath = resolve(repoRoot, page.source_path)
  const targetPath = resolve(outputRoot, page.source_path)
  if (!inside(repoRoot, sourcePath) || !inside(outputRoot, targetPath) || !existsSync(targetPath)) {
    issues.push(`${locale}:${page.page_id}: source or translated target path is invalid`)
    continue
  }
  const label = labels[page.page_id]
  if (typeof label !== 'string' || label.trim() === '') {
    issues.push(`${locale}:${page.page_id}: translated navigation label is missing`)
    continue
  }
  const source = normalizeTranslationSource(readFileSync(sourcePath, 'utf8'))
  const target = readFileSync(targetPath, 'utf8')
  issues.push(...auditMarkdownPair(
    locale,
    page.page_id,
    source,
    target,
    page.navigation_label,
    label,
  ))
  issues.push(...auditLanguage(locale, page.page_id, target, label))
}

if (issues.length > 0) {
  throw new Error(`validate-translation-batch failed with ${issues.length} issue(s):\n${issues.slice(0, 100).join('\n')}`)
}
console.log(`validate-translation-batch: ${batch.pages.length} ${locale} page(s) passed semantic and language checks.`)
