import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  auditLanguage,
  auditMarkdownPair,
  auditStateInventory,
  auditStateProvenance,
  type ManifestPage,
  type TranslationPageState,
  type TranslationState,
} from '../audit-translations.ts'

const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/translation-pair.json'), 'utf8')) as {
  source: string
  ja: string
  ko: string
}

function pairIssues(target: string, label = 'プラグイン設定'): string[] {
  return auditMarkdownPair('ja-JP', 'fixture', fixture.source, target, 'Configure the plugin', label)
}

test('accepts complete Japanese and Korean semantic translations', () => {
  assert.deepEqual(pairIssues(fixture.ja), [])
  assert.deepEqual(auditMarkdownPair('ko-KR', 'fixture', fixture.source, fixture.ko, 'Configure the plugin', '플러그인 설정'), [])
})

test('rejects copied English headings, paragraphs, table cells, and navigation labels', () => {
  const target = fixture.ja
    .replace('# プラグインを設定する', '# Configure the plugin')
    .replace(
      '[設定ガイド](https://example.com/config)を使用してプラグインを作成します。',
      'Use the [configuration guide](https://example.com/config) to create the plugin.',
    )
    .replace('| タイムアウト | 最大待機時間 |', '| Timeout | Maximum waiting time |')
  const issues = pairIssues(target, 'Configure the plugin')
  assert.ok(issues.some(issue => issue.includes('heading') && issue.includes('copied unchanged')))
  assert.ok(issues.some(issue => issue.includes('paragraph') && issue.includes('target-language text is missing')))
  assert.ok(issues.some(issue => issue.includes('tableCell') && issue.includes('copied unchanged')))
  assert.ok(issues.some(issue => issue.includes('navigation_label') && issue.includes('copied unchanged')))
})

test('allows protected product and protocol names without treating them as English prose', () => {
  const source = '# DeepSeek Harness API\n\nDeepSeek Harness API\n'
  assert.deepEqual(auditMarkdownPair('ja-JP', 'allowed', source, source, 'DeepSeek Harness', 'DeepSeek Harness'), [])
})

test('allows product-only redirect pages without weakening prose language checks', () => {
  const redirect = '---\nlayout: false\nhead:\n  - - meta\n    - http-equiv: refresh\n      content: 0; url=./guide/quickstart\n---\n\n# DeepSeek Harness\n'
  assert.deepEqual(auditLanguage('ja-JP', 'home', redirect, 'DeepSeek Harness'), [])
  assert.deepEqual(auditLanguage('ko-KR', 'home', redirect, 'DeepSeek Harness'), [])
  assert.ok(auditLanguage(
    'ja-JP',
    'english-prose',
    '# DeepSeek Harness\n\nThis page contains a complete explanatory sentence that was not translated into the target language.\n',
    'DeepSeek Harness',
  ).some(issue => issue.includes('insufficient Japanese prose')))
})

test('allows API-signature headings and protected repository note labels', () => {
  const source = '# ctx.inject(deps, callback)\n\nRead the [agent-scope runtime-design Agent Note](/note).\n'
  const target = '# ctx.inject(deps, callback)\n\n[agent-scope runtime-design Agent Note](/note)を参照してください。\n'
  assert.deepEqual(auditMarkdownPair('ja-JP', 'technical', source, target, 'API', 'API'), [])

  const memberSource = '# ctx.toolResultPruner — ToolResultPruner\n'
  assert.deepEqual(auditMarkdownPair('ja-JP', 'member', memberSource, memberSource, 'API', 'API'), [])

  const seamSource = '# ctx.settings — SettingsProvider (abstract seam)\n'
  const seamTarget = '# ctx.settings — SettingsProvider（抽象境界）\n'
  assert.deepEqual(auditMarkdownPair('ja-JP', 'seam', seamSource, seamTarget, 'API', 'API'), [])
  assert.ok(auditMarkdownPair('ja-JP', 'seam', seamSource, seamSource, 'API', 'API')
    .some(issue => issue.includes('target-language text is missing')))

  const eventSource = '# `workflow/agent-end` — emit\n'
  assert.deepEqual(auditMarkdownPair('ja-JP', 'event', eventSource, eventSource, 'Events', 'イベント'), [])

  const typeSource = '# `CompactionResult`\n'
  assert.deepEqual(auditMarkdownPair('ja-JP', 'type', typeSource, typeSource, 'Result', '結果'), [])

  const mixedSource = '# The `compaction/*` session events\n'
  const mixedTarget = '# `compaction/*` セッションイベント\n'
  assert.deepEqual(auditMarkdownPair('ja-JP', 'mixed-heading', mixedSource, mixedTarget, 'Events', 'イベント'), [])
  assert.ok(auditMarkdownPair('ja-JP', 'mixed-heading', mixedSource, mixedSource, 'Events', 'イベント')
    .some(issue => issue.includes('heading') && issue.includes('copied unchanged')))

  const identifierSource = '# SessionTelemetryBackend\n\nBackend details.\n'
  const identifierTarget = '# SessionTelemetryBackend\n\nバックエンドの詳細です。\n'
  assert.deepEqual(auditMarkdownPair(
    'ja-JP', 'identifier-heading', identifierSource, identifierTarget, 'Backend', 'バックエンド',
  ), [])

  const coreSource = '# Core\n\nCore contracts.\n'
  const coreTarget = '# コア\n\nコア契約です。\n'
  assert.deepEqual(auditMarkdownPair('ja-JP', 'core-heading', coreSource, coreTarget, 'Core', 'コア'), [])
  assert.ok(auditMarkdownPair('ja-JP', 'core-heading', coreSource, coreSource, 'Core', 'Core')
    .some(issue => issue.includes('heading') && issue.includes('copied unchanged')))
})

test('allows source-bound technical identifier enumerations but not natural prose lists', () => {
  const source = '# Tool contracts\n\nQuery Service, Event, Builtin, Slot before use. operation is one of goToDefinition, findReferences, goToImplementation, hover.\n'
  const target = '# ツール契約\n\n使用前に Service, Event, Builtin, Slot を確認します。operation は goToDefinition, findReferences, goToImplementation, hover のいずれかです。\n'
  assert.deepEqual(auditMarkdownPair('ja-JP', 'identifiers', source, target, 'Tool contracts', 'ツール契約'), [])

  const packagesSource = '# Providers\n\nUse [dsh-web-search-exa](/exa), [dsh-web-search-perplexity](/perplexity), [dsh-web-search-deepseek](/deepseek), and [dsh-web-fetch-http](/http).\n'
  const packagesTarget = '# プロバイダー\n\n[dsh-web-search-exa](/exa)、[dsh-web-search-perplexity](/perplexity)、[dsh-web-search-deepseek](/deepseek)、[dsh-web-fetch-http](/http)を使用します。\n'
  assert.deepEqual(auditMarkdownPair(
    'ja-JP', 'package-identifiers', packagesSource, packagesTarget, 'Providers', 'プロバイダー',
  ), [])

  const protocolSource = '# Protocol\n\nUse Agent Client Protocol JSON-RPC for this transport.\n'
  const protocolTarget = '# プロトコル\n\nこのトランスポートには Agent Client Protocol JSON-RPC を使用します。\n'
  assert.deepEqual(auditMarkdownPair(
    'ja-JP', 'protocol-name', protocolSource, protocolTarget, 'Protocol', 'プロトコル',
  ), [])

  const keywordSource = '# Keywords\n\nProvider keywords (bash, fs, web, subagent, todo) select the implementation.\n'
  const keywordTarget = '# キーワード\n\nProvider キーワード（bash, fs, web, subagent, todo）は実装を選択します。\n'
  assert.deepEqual(auditMarkdownPair(
    'ja-JP', 'technical-keywords', keywordSource, keywordTarget, 'Keywords', 'キーワード',
  ), [])

  const familySource = '# Built-in tools\n\nThe tool families (bash, fs, web, subagent, todo) are the shipped examples.\n'
  const familyTarget = '# 組み込みツール\n\nツールファミリー（bash, fs, web, subagent, todo）は同梱されている例です。\n'
  assert.deepEqual(auditMarkdownPair(
    'ja-JP', 'technical-families', familySource, familyTarget, 'Built-in tools', '組み込みツール',
  ), [])

  const naturalSource = '# Colors\n\nChoose red, green, blue, yellow for the visible theme.\n'
  const naturalTarget = '# 色\n\n表示テーマには red, green, blue, yellow を選択します。\n'
  assert.ok(auditMarkdownPair('ja-JP', 'natural-list', naturalSource, naturalTarget, 'Colors', '色')
    .some(issue => issue.includes('unallowlisted English prose')))
})

test('allows unchanged filename link labels while requiring surrounding prose translation', () => {
  const source = '# Pages\n\n| Page |\n| --- |\n| [session.md](session.md) |\n'
  const target = '# ページ\n\n| ページ |\n| --- |\n| [session.md](session.md) |\n'
  assert.deepEqual(auditMarkdownPair('ja-JP', 'filename-label', source, target, 'Pages', 'ページ'), [])
})

test('does not exempt natural-language headings with punctuation or hyphenated prose', () => {
  const source = '# Example: logging plugin\n\nThis is user-facing documentation that remains entirely in English.\n'
  const issues = auditMarkdownPair('ja-JP', 'natural', source, source, 'Logging example', 'Logging example')
  assert.ok(issues.some(issue => issue.includes('heading') && issue.includes('copied unchanged')))
  assert.ok(issues.some(issue => issue.includes('unallowlisted English prose')))
})

test('rejects natural-language headings with one ordinary English word after allowlisting', () => {
  const source = '# Bash Executor\n\nRun commands through the configured shell executor.\n'
  const target = '# Bash Executor\n\n設定済みのシェル実行機能を通じてコマンドを実行します。\n'
  const issues = auditMarkdownPair('ja-JP', 'single-heading-word', source, target, 'Bash Executor', 'Bash 実行機能')
  assert.ok(issues.some(issue => issue.includes('heading') && issue.includes('copied unchanged')))
  assert.ok(issues.some(issue => issue.includes('heading') && issue.includes('target-language text is missing')))
})

test('rejects VitePress container type changes', () => {
  const issues = pairIssues(fixture.ja.replace('::: warning 続行する前に確認', '::: tip 続行する前に確認'))
  assert.ok(issues.some(issue => issue.includes('VitePress container markers')))
})

test('rejects changed link association and changed code association', () => {
  assert.ok(pairIssues(fixture.ja.replace('https://example.com/config', 'https://example.com/other')).some(issue => issue.includes('immutable-value association')))
  assert.ok(pairIssues(fixture.ja.replace('const timeout = 30', 'const timeout = 60')).some(issue => issue.includes('immutable-value association')))

  const linkedSource = '# Links\n\nRead [one](/one) and [two](/two).\n'
  const linkedTarget = '# リンク\n\n[一](/two)と[二](/one)を参照します。\n'
  assert.ok(auditMarkdownPair('ja-JP', 'links', linkedSource, linkedTarget, 'Links', 'リンク').some(issue => issue.includes('immutable-value association')))

  const strongLinkSource = '# Links\n\nSee **[session.md](session.md)**.\n'
  const unspacedStrongLinkTarget = '# リンク\n\n詳細は **[session.md](session.md)**にあります。\n'
  const spacedStrongLinkTarget = '# リンク\n\n詳細は **[session.md](session.md)** にあります。\n'
  assert.ok(auditMarkdownPair(
    'ja-JP', 'strong-link-spacing', strongLinkSource, unspacedStrongLinkTarget, 'Links', 'リンク',
  ).some(issue => issue.includes('immutable-value association')))
  assert.deepEqual(auditMarkdownPair(
    'ja-JP', 'strong-link-spacing', strongLinkSource, spacedStrongLinkTarget, 'Links', 'リンク',
  ), [])

  const codeSource = '# First\n\n```ts\none()\n```\n\n## Second\n\n```ts\ntwo()\n```\n'
  const codeTarget = '# 最初\n\n```ts\ntwo()\n```\n\n## 次\n\n```ts\none()\n```\n'
  assert.ok(auditMarkdownPair('ja-JP', 'code', codeSource, codeTarget, 'Code', 'コード').some(issue => issue.includes('immutable-value association')))
})

test('rejects hollow and unallowlisted English prose', () => {
  const english = fixture.ja.replace(
    '[設定ガイド](https://example.com/config)を使用してプラグインを作成します。',
    '[設定ガイド](https://example.com/config) This paragraph was left entirely in English prose.',
  )
  assert.ok(pairIssues(english).some(issue => issue.includes('unallowlisted English prose')))
  assert.ok(pairIssues(fixture.ja, '').some(issue => issue.includes('translated text is empty')))

  const longSource = '# Detailed setup instructions\n\nThis documentation paragraph explains every required configuration step and provides enough information to complete the setup safely and correctly.\n'
  const hollowTarget = '# 設定\n\nあ\n'
  assert.ok(auditMarkdownPair('ja-JP', 'hollow', longSource, hollowTarget, 'Detailed setup', '設定').some(issue => issue.includes('implausibly short')))
})

test('does not mistake ordinary Japanese configuration prose for Simplified Chinese', () => {
  assert.deepEqual(auditLanguage('ja-JP', 'configuration', '# 設定\n\n同一配置のデプロイメントを使用します。', '設定'), [])
  assert.ok(auditLanguage(
    'ja-JP',
    'chinese',
    '# 设置\n\n用户可以通过页面执行配置，并且可以创建文件、选择默认选项，然后点击返回。',
    '设置',
  )
    .some(issue => issue.includes('likely Chinese prose')))
})

const pages: ManifestPage[] = [
  { id: 'one', locales: { 'en-US': { source: 'docs/one.md', label: 'One page' } } },
  { id: 'two', locales: { 'en-US': { source: 'docs/two.md', label: 'Two page' } } },
]

function statePage(id: string): TranslationPageState {
  return {
    page_id: id,
    source_path: `docs/${id}.md`,
    source_git_blob_sha: 'blob',
    source_sha256: 'source',
    normalized_source_sha256: 'normalized',
    reviewed_source_sha256: 'source',
    target_path: `docs-locales/ja/docs/${id}.md`,
    target_sha256: 'target',
    navigation_label: 'ページ',
    translation_review: 'validated',
  }
}

function state(statePages: TranslationPageState[]): TranslationState {
  const executableSha = 'b'.repeat(64)
  return {
    schema_version: 2,
    locale: 'ja-JP',
    source_locale: 'en-US',
    upstream_commit: 'commit',
    model: 'model',
    model_fingerprint: `model@codex-cli 0.147.0#${executableSha}`,
    reasoning_effort: 'low',
    generated_at: '2026-08-17T00:00:00.000Z',
    validated_at: '2026-08-17T00:01:00.000Z',
    human_review: 'not_recorded',
    generation_provenance: [{
      model: 'model',
      reasoning_effort: 'low',
      codex: {
        version: 'codex-cli 0.147.0',
        executable_sha256: executableSha,
        requested_model: 'model',
        requested_reasoning_effort: 'low',
      },
    }],
    generation_receipts_sha256: 'a'.repeat(64),
    pages: statePages,
  }
}

test('requires an exact state page set without missing, duplicate, or extra ids', () => {
  const issues = auditStateInventory('ja-JP', state([statePage('one'), statePage('one'), statePage('extra')]), pages, 2, '/repo')
  assert.ok(issues.some(issue => issue.includes('duplicate page_id')))
  assert.ok(issues.some(issue => issue.includes('extra page_id')))
  assert.ok(issues.some(issue => issue.includes('two: missing page_id')))
})

test('requires the canonical locale target path and validated state', () => {
  const escaped = statePage('one')
  escaped.target_path = 'docs-locales/ja/../ko/docs/one.md'
  escaped.translation_review = 'generated'
  const issues = auditStateInventory('ja-JP', state([escaped, statePage('two')]), pages, 2, '/repo')
  assert.ok(issues.some(issue => issue.includes('target_path must equal')))
  assert.ok(issues.some(issue => issue.includes('has not reached the validated state')))
})

test('requires generated_at to precede validated_at with complete model provenance', () => {
  const invalid = state([statePage('one'), statePage('two')])
  invalid.generated_at = '2026-08-17T00:02:00.000Z'
  invalid.validated_at = '2026-08-17T00:01:00.000Z'
  assert.ok(auditStateProvenance('ja-JP', invalid, 'commit', 'commit').some(issue => issue.includes('provenance is incomplete or invalid')))

  const valid = state([statePage('one'), statePage('two')])
  assert.deepEqual(auditStateProvenance('ja-JP', valid, 'commit', 'commit'), [])
})

test('requires schema v2 receipt binding and separate human-review semantics', () => {
  const invalid = state([statePage('one'), statePage('two')])
  invalid.schema_version = 1
  invalid.generation_receipts_sha256 = 'not-a-sha256'
  invalid.human_review = 'validated'
  const issues = auditStateProvenance('ja-JP', invalid, 'commit', 'commit')
  assert.ok(issues.some(issue => issue.includes('invalid translation state header')))
  assert.ok(issues.some(issue => issue.includes('provenance is incomplete or invalid')))
  assert.ok(issues.some(issue => issue.includes('human_review must explicitly')))
})

test('binds model summary to non-empty Codex generation provenance', () => {
  const invalid = state([statePage('one'), statePage('two')])
  invalid.generation_provenance[0].codex.requested_model = 'different-model'
  invalid.model_fingerprint = 'forged'
  const issues = auditStateProvenance('ja-JP', invalid, 'commit', 'commit')
  assert.ok(issues.some(issue => issue.includes('generation_provenance is incomplete or invalid')))

  const mismatched = state([statePage('one'), statePage('two')])
  mismatched.model = 'different-model'
  assert.ok(auditStateProvenance('ja-JP', mismatched, 'commit', 'commit').some(issue => issue.includes('model summary does not match')))
})
