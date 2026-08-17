# Validation gates

A material run is complete only when all gates below are bound to the same input
fingerprint.

## Static/source

- Upstream repository, branch, commit, and tree are full and pinned.
- Manifest contains 83 current canonical pages and derives route counts rather
  than relying on that number permanently.
- Guide/Development/Reference counts match the pinned publication.
- Official locale route sets are isomorphic.
- Every published source byte matches the lock and Git blob.
- Every applicable bilingual sidecar matches both current owner blobs.
- The official English fallback exception is explicit.
- Every promoted Japanese/Korean tree contains exactly one validated target and
  navigation label for every manifest page (currently 83 per locale).
- Every translated page state matches the current English Git blob, locked and
  normalized source hashes, target hash, upstream commit, and locale-wide model
  provenance.
- Japanese/Korean remain unpublished until complete; once published, partial or
  stale locale state is a hard failure.

## Translation

- Structured Codex output matches the translation bundle schema and exact unit
  inventory.
- Every protected token occurs exactly once. Structural token order, heading
  levels, Markdown AST shape, code/HTML, and immutable literals match the
  normalized English input.
- Japanese prose contains sufficient Japanese kana and no Korean or likely
  Chinese prose. Korean prose contains sufficient Hangul and no Japanese kana
  or likely Chinese prose. Protected technical English is allowed. A
  redirect-only page whose only visible text is an allowed product/protocol
  name is not required to invent target-language prose, but any surrounding
  natural-language sentence remains subject to the full language gate.
- The run-local batch gate checks every semantic heading, paragraph, table cell,
  image alt, and separately generated navigation label before creating
  immutable batch output; the locale-wide audit repeats these checks after
  promotion.
- Recovery runs copy frozen inputs. Any reused response has exact input/inventory
  equality plus source-file SHA-256 provenance.
- A batch may unlock its successor only with exit 0, the explicit
  `validate-translation-batch ... passed` output, a validated batch receipt,
  and a completed marker. Failed-run artifacts remain immutable evidence.
- `pnpm run docs:i18n` passes all 83 Japanese and all 83 Korean pages before
  either publication switch is enabled.

## Build/routes

- `pnpm exec tsc --noEmit`
- `pnpm run docs:check`
- `pnpm run docs:i18n`
- `pnpm run build`
- `pnpm run docs:routes`
- Every manifest route emits HTML.
- Each published locale emits the complete manifest route set; each unpublished
  locale emits no route, sitemap URL, hreflang, language-menu item, or fallback.
- When all four locales are published against the current 83-page manifest,
  route verification expects 332 content routes, plus locale-home redirect
  documents governed by the navigation contract.
- Search, Mermaid, local images, edit links, language switching, and clean URLs
  work in the production preview.
- Every indexable rendered page passes localized title/description, `html lang`,
  self-canonical, Open Graph, Twitter, JSON-LD, reciprocal hreflang,
  `x-default`, sitemap, robots, and `robots.txt` checks. Japanese and Korean SEO
  must be target-language owned; English metadata fallback is a failure.

## Browser evidence

Changed pages require source and local evidence at equal viewports where an
official rendered counterpart exists. Japanese/Korean pages have no official
rendered counterpart, so bind local screenshots to the locked English source
path/hash and translated route instead of inventing an upstream target-language
URL. Evidence must include local/official URL as applicable, locale, viewport,
theme, interactions, source path/hash, checked time, screenshot path, and
screenshot SHA-256.

Every changed route must be rendered and inspected. Across each locale, capture
desktop/mobile and light/dark coverage for Guide, Development, and Reference,
including navigation/sidebar, page outline, localized search, language
switching, heading order, visible prose/code, links, clean URLs, and responsive
drawers. Browser evidence supplements the all-page source/route/SEO audits; it
does not replace them.

## Immutable verification

Formal verification writes once. Each command receipt contains command,
timestamps, exit code, log path/hash, and the repository input fingerprint. A
failed or stale formal run is preserved; continue with a recovery run instead
of replacing evidence.
