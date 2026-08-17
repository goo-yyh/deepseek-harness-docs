# Japanese and Korean translation rules

Japanese and Korean are Codex-owned translations, not official upstream
content. `config/locales.json` is the publication switch; translated source and
state may be prepared while a locale remains unpublished, but partial routes
must never leak into the build.

## Source and identity

- Translate only the normalized, reviewed official English source bound to the
  current `config/upstream-lock.json` commit. Chinese and another target locale
  are never translation sources.
- The current manifest contains 83 canonical page IDs. A bootstrap requires all
  83 pages and all 83 localized navigation labels per locale; use explicit
  `--all-pages` and derive the count from the manifest.
- Persist, per page, the page ID, English source path/Git blob/SHA-256,
  normalized English SHA-256, exact `reviewed_source_sha256`, target path/hash,
  navigation label, and automated validation status. Persist the locale's
  upstream commit, Codex model, CLI fingerprint, reasoning effort, generation
  and validation times, and separate human-review status in the state header.

## Structured translation

- Feed Codex schema-bound units rather than granting it write access to the
  repository. Accept exactly one response per unit ID in the requested order.
- Pack navigation-label units separately from long page units and require them
  to contain natural target-language UI text unless the complete label is a
  protected product/protocol literal.
- Protect frontmatter, code blocks, comments, heading/list markers, strong
  delimiters, inline code, link/image destinations, controlled HTML, bare URLs,
  plain repository paths, table pipes, and line breaks. Each placeholder occurs exactly once; structural
  placeholders retain source order.
- Treat each table pipe as a cell-ownership boundary. Link, emphasis/strong,
  and other formatting groups retain source order, nesting, and AST ownership.
- Permit automatic recovery only for a missing protected table pipe when all
  remaining structural tokens form the exact ordered source subsequence and no
  extra token exists. Inline-code placeholders may move with target-language
  grammar but retain their exact multiset and AST association. Persist the
  repaired token and insertion boundary in the bundle receipt; every other
  structural mismatch remains a hard rejection.
- Separately permit exactly one ASCII separator after a `LINK_TARGET` followed
  by a closing `FORMAT_BOUNDARY` and before Japanese/Korean script. This narrow
  CommonMark repair preserves the source token stream and keeps the link owned
  by the strong span; record it in the receipt.
- Keep frontmatter, heading levels/order, code bytes, commands, identifiers,
  URLs, destinations, tables, lists, Mermaid, HTML, and Vue syntax structurally
  identical. The restored target must match the source Markdown AST and
  immutable-value fingerprint.
- Translate prose, natural-language headings, titles, captions, alt text, table
  prose, meaningful link labels, and navigation labels naturally. Never
  translate commands, API members, package names, configuration keys, file
  paths, protocol literals, or protected product terminology.
- Apply only the closed terminology map in `locale-style-guide.md` after schema
  validation, outside protected code tokens. Record source term, localized
  replacement, unit, and count in each affected bundle receipt. Preserve only
  code-shaped types/APIs and the documented source-declared technical lists;
  localize ordinary word headings, navigation, and mixed generic nouns.
- Compare visible content between protected newline boundaries and reject a
  bundle immediately when substantive source prose becomes empty or
  implausibly short. The final semantic audit remains mandatory.
- Restore and semantically audit every Markdown unit before accepting a bundle
  receipt. Retry generated failures; record reused failures as semantic reuse
  misses and generate them. Keep batch-level and locale-wide audits mandatory.
- Reject a batch before immutable output when any heading, paragraph, table
  cell, image alt text, or navigation label is copied, hollow, contains a long
  unallowlisted English run, or lacks the expected Japanese/Korean script.

## Immutable recovery and safe parallelism

- Never overwrite a prepared run, structured response, staging tree, or batch
  output. A failed or stale run is evidence; continue under a new recovery run
  ID copied from the original frozen inputs.
- Reuse a structured response only when page inventory plus all input, prompt,
  style, schema, and response hashes are identical. Revalidate unit IDs,
  placeholders, and structure, then record the copied file's source
  run/name/SHA-256 in `structured-reuse.json`. Record a valid but incompatible
  request as a reuse miss and generate it normally; corrupt receipts or
  responses remain hard failures.
- Parallel work is safe only for different locale/run/batch targets. One worker
  owns one batch. Wait for every worker to finish before promotion.
- Start a following batch only after exit 0, the explicit batch-validator pass
  message, a validated immutable batch receipt, and a completed marker. Preserve
  all running markers, attempts, semantic reports, reuse records, and staging
  output on failure; a historical running marker alone does not prove its PID
  is still active.

## Promotion and publication

- Promotion is all-or-nothing at locale scope: collect every batch into
  run-local staging, require all 83 pages and labels, then replace the target
  locale tree and write one complete translation-state file.
- Run the complete locale audit after promotion. Source hashes, target hashes,
  Markdown structure, language heuristics, navigation labels, and provenance
  all fail closed.
- Publication is separate from promotion. Enable a locale only after its full
  search, SEO, route, desktop, mobile, light, and dark checks pass. No English
  fallback page or English SEO fallback is allowed under `/ja/` or `/ko/`.
- A published Japanese or Korean page owns a unique localized title and
  description, correct language, self-canonical URL, Open Graph, Twitter,
  JSON-LD, reciprocal hreflang, and sitemap entry.
