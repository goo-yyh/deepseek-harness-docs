/** Focused regression checks for canonical translated heading IDs. */

import assert from 'node:assert/strict'
import { createMarkdownRenderer } from 'vitepress'
import {
  stableHeadingSlug,
  stableTranslatedHeadingSlugs,
  vitePressSlugify,
} from '../website/heading-anchors.ts'

assert.equal(vitePressSlugify('ctx.extend(meta?)'), 'ctx-extend-meta')
assert.equal(vitePressSlugify('1. Your first plugin'), '_1-your-first-plugin')
assert.equal(vitePressSlugify('Crème — API'), 'creme-—-api')

const canonical = `# Setup

## API & Tokens

## Repeat

## Repeat
`
const translated = `# セットアップ

## API とトークン

## 繰り返し

## 繰り返し
`

assert.deepEqual(
  stableTranslatedHeadingSlugs(canonical, translated),
  ['setup', 'api-tokens', 'repeat', 'repeat-1'],
)

const renderer = await createMarkdownRenderer(process.cwd(), {
  anchor: { slugifyWithState: stableHeadingSlug },
})
const rendered = renderer.render(`---
canonicalHeadingSlugs: [setup, api-tokens]
---

# セットアップ

## API とトークン
`)
assert.match(rendered, /<h1 id="setup"[^>]*>セットアップ/)
assert.match(rendered, /<h2 id="api-tokens"[^>]*>API とトークン/)
assert.doesNotMatch(rendered, /id="セットアップ"/)

assert.throws(
  () => stableTranslatedHeadingSlugs(canonical, translated.replace('## API', '### API')),
  /heading 2 has depth 3; canonical English has depth 2/,
)
assert.throws(
  () => stableTranslatedHeadingSlugs(canonical, translated.replace(/\n## 繰り返し\n$/, '\n')),
  /translated page has 3 headings; canonical English has 4/,
)

console.log('heading-anchors: slug compatibility, duplicate IDs, and fail-closed structure checks passed.')
