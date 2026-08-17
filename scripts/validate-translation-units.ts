/** Validate restored schema-bundle units before accepting their immutable receipt. */

import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import {
  auditMarkdownContent,
  auditMarkdownPair,
  type TargetLocale,
} from './audit-translations.ts'

const args = process.argv.slice(2)
const value = (name: string): string | undefined => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const inputValue = value('--input')
if (!inputValue) throw new Error('validate-translation-units: missing --input')

const repoRoot = resolve(import.meta.dirname, '..')
const inputPath = resolve(inputValue)
const inputRelative = relative(repoRoot, inputPath)
if (inputRelative === '..' || inputRelative.startsWith(`..${sep}`) || isAbsolute(inputRelative)) {
  throw new Error('validate-translation-units: input path escapes the repository')
}

interface UnitInput {
  unit_id: string
  mode: 'page_markdown' | 'navigation_label'
  source: string
  target: string
}

const payload = JSON.parse(readFileSync(inputPath, 'utf8')) as {
  locale: TargetLocale
  bundle: number
  units: UnitInput[]
}
if (
  (payload.locale !== 'ja-JP' && payload.locale !== 'ko-KR')
  || !Number.isInteger(payload.bundle)
  || !Array.isArray(payload.units)
) {
  throw new Error('validate-translation-units: invalid input header')
}

const issues: string[] = []
for (const unit of payload.units) {
  if (
    typeof unit.unit_id !== 'string'
    || (unit.mode !== 'page_markdown' && unit.mode !== 'navigation_label')
    || typeof unit.source !== 'string'
    || typeof unit.target !== 'string'
  ) {
    issues.push('invalid semantic unit record')
    continue
  }
  if (unit.mode === 'page_markdown') {
    issues.push(...auditMarkdownContent(payload.locale, unit.unit_id, unit.source, unit.target))
  } else {
    issues.push(...auditMarkdownPair(
      payload.locale,
      unit.unit_id,
      `# ${unit.source}\n`,
      `# ${unit.target}\n`,
      unit.source,
      unit.target,
    ))
  }
}

if (issues.length > 0) {
  throw new Error(
    `validate-translation-units failed with ${issues.length} issue(s):\n${issues.slice(0, 100).join('\n')}`,
  )
}
console.log(`validate-translation-units: ${payload.units.length} ${payload.locale} unit(s) passed for bundle ${payload.bundle}.`)
