import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const runner = readFileSync(resolve(
  import.meta.dirname,
  '../../.agents/skills/diff-translation/scripts/translate_locale_with_codex.mjs',
), 'utf8')

test('promotion receipt binds the collected generation receipts', () => {
  assert.match(runner, /generation_receipts:\s*generationReceipts/)
  assert.doesNotMatch(runner, /\n\s*generation_receipts,\s*\n/)
})
