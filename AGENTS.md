# DeepSeek Harness structured documentation rules

This repository publishes a structured Astro documentation site derived from
the official DeepSeek Harness documentation. These instructions apply to the
entire repository. `docs/AGENTS.md` is locked upstream content and is not this
site's maintenance guide.

## Product contract

- The only runtime documentation stack is Astro with Starlight and static
  output. Do not add VitePress back to dependencies, controls, build output, or
  deployment.
- The only published locales are official Simplified Chinese at the root and
  official English under `/en/`. Do not add Japanese, Korean, target-locale
  trees, translation state, translation runners, or translation fallbacks.
- Local routes, menus, page boundaries, titles, and relations come from the
  tracked projection manifests, not the official Guide/Development/Reference
  layout.
- Official Chinese and English Markdown remains byte-identical to pinned Git
  blobs. Pages may project complete source segments but must not rewrite,
  summarize, expand, or invent body content.
- Source-derived metadata, indexes, relations, and version facts must be
  reproducible from locked inputs and must not introduce unsupported claims.
- Search indexing is external. A build, sitemap, IndexNow response, or request
  indexing action never proves crawling, indexing, canonical selection, or
  ranking.

## Sources of truth

- `config/upstream-lock.json` pins the official repository commit, Git tree,
  blobs, hashes, byte lengths, controls, assets, and pairing records.
- `config/docs-manifest.json` owns the 83 current upstream source-page
  identities and Chinese/English source pairing. It does not own local routes.
- `config/source-segments.json` is the deterministic Markdown AST segment
  inventory generated from locked sources.
- `config/content-map.json` owns target pages, neutral routes, segment
  ownership, page kinds, and source relationships.
- `config/navigation.json` owns the seven task-oriented menu groups and order.
- `config/seo-metadata.json` owns Chinese/English titles, descriptions, and
  indexability.
- `config/redirects.json` owns legacy route migration. `vercel.json` must carry
  the exact same one-hop redirects.
- `config/projection-lock.json` binds schemas, projector/framework versions,
  input hashes, and output contracts. `config/projection-state/*.json` binds
  locale target routes to their segment inventories.
- Upstream `website/docs.ts` and VitePress controls are discovery inputs only.
  They are not copied into or executed by the local runtime.

## Official content and segments

- Do not hand-edit locked official Markdown, `.i18n.yaml` pairing records,
  official brand assets, licenses, or upstream locks.
- Every source segment has exactly one primary target-page owner. Other pages
  link to that owner instead of copying the segment.
- Upstream source coverage is 100%. Missing, duplicated, ambiguous, orphaned,
  unowned, or source-hash-mismatched segments fail the build.
- Segment boundaries must retain complete lists, tables, code fences, Mermaid,
  images, controlled HTML, blockquotes, and H2 subtrees. An explicit anchor
  immediately before an H2 belongs to that section.
- The only allowed non-source text is reviewed navigation, SEO metadata,
  breadcrumbs, accessibility labels, 404 text, and other
  UI chrome. Do not generate summaries, advice, examples, FAQ,
  troubleshooting, or filler.
- Preserve licenses and the internal pinned-source bindings used by projection
  and audits. Do not render a global upstream-source attribution block in the
  public documentation UI.
- A target page must not reproduce the exact ordered segment inventory of an
  entire official page.

## Astro and generated output

- Use the exact Astro, Starlight, pnpm, and Node requirements pinned in
  `package.json` and the lockfile. Never use floating framework versions.
- `src/content/docs/`, `public/assets/docs/`, `.astro/`, and `dist/` are
  deterministic generated output. Regenerate them; do not hand-edit or commit
  them.
- Keep indexable content in static semantic HTML. Islands are only for needed
  interaction and may not hide or replace content for crawlers.
- Preserve Mermaid, syntax highlighting, images, anchors, accessible
  desktop/mobile navigation, dark mode, and Chinese/English search.
- Vercel Analytics is injected exactly once through
  `src/components/Head.astro`.

## Routes, SEO, and search

- Chinese uses root routes and English uses the matching `/en/` routes. No
  `/ja/` or `/ko/` output, sitemap entry, alternate, search entry, or switcher
  item may exist.
- Neutral route identity comes from `content-map.json`; language changes do not
  change slugs.
- The official English-only inherited Cordis page has no Chinese fallback
  target. Its legacy Chinese URL redirects to the English owner.
- Redirects are explicit, permanent, one-hop, loop-free, and never point every
  old page to one generic destination.
- One projection path owns descriptions, canonical, hreflang, robots, Open
  Graph, Twitter, JSON-LD, sitemap, and robots.txt behavior.
- Every indexable page has a unique localized title/description, correct
  language, absolute self-canonical, reciprocal zh/en hreflang where both
  exist, `x-default`, and exactly one sitemap entry.
- Empty hubs, search/filter pages, fallbacks, redirects, and 404 are noindex and
  absent from the sitemap and Pagefind index.
- Metadata describes projected source segments and may identify the applicable
  license, but public pages must not emit upstream source paths, `isBasedOn`,
  `citation`, or global upstream-source attribution. Do not claim local
  authorship of official prose.
- Do not use hidden text, cloaking, keyword stuffing, artificial similarity
  thresholds, repeated IndexNow submissions, or framework changes as indexing
  tactics.

## Synchronization

- Use `.agents/skills/diff-translation/SKILL.md` for every upstream check,
  Chinese/English source refresh, immutable evidence run, recovery, and result.
- Resolve upstream `master` to a full commit and freeze it before discovery.
- Catalog, upstream control, license, asset, schema, projector, navigation,
  SEO, redirect, or fallback changes are blocking review evidence.
- After source promotion, regenerate segments and reconcile projection drift.
  A selector matching zero/multiple subtrees, changed source hash, lost
  ownership, incomplete coverage, or empty target blocks publication.
- Never auto-assign a new upstream segment, write connecting prose, or change a
  target route during an ordinary source refresh.
- Material target-route changes require desktop/mobile browser evidence in the
  affected Chinese/English routes and formal immutable verification.

## IndexNow and deployment

- Keep `public/3ad568e2babd4212b27130365f0c7a16.txt` filename and UTF-8 content
  identical unless intentionally rotating the key.
- `indexnow:check` reads only fresh `dist/sitemap.xml`, rejects duplicates,
  off-origin URLs, and any ja/ko path, and validates the built key.
- Submit only after the exact commit succeeds in Vercel Production and the live
  key, sitemap, and representative canonical routes match the local build.
- IndexNow HTTP 200/202 is receipt or pending key validation only.
- `main` is the publication branch. Commit, push, deploy, alias, and provider
  changes require explicit authorization and their normal ref/deployment
  checks.

## Generated and local-only files

- Do not commit `node_modules/`, `src/content/docs/`, `public/assets/docs/`,
  `.astro/`, `dist/`, `.docs-source/`, `diff/`, `.vercel/`, `.chat/`, logs,
  browser profiles, cookies, tokens, or environment files.
- Deterministic reports may be committed only as required evidence and must not
  contain unstable timestamps or ordering.

## Required verification

Run before committing or publishing a material change:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm run docs:check
pnpm run content:segments
pnpm run content:project
pnpm run content:audit
pnpm run check
pnpm run build
pnpm run seo:audit
pnpm run docs:routes
```

- Source checks bind official bytes and Chinese/English pairing.
- Segment/project/audit checks prove complete one-owner coverage, provenance,
  deterministic output, and no exact full-page reproduction.
- Build/SEO/route checks verify Astro output, search, metadata, sitemap,
  redirects, fragments, Analytics injection, and absence of ja/ko output.
- Before Git publication inspect the complete staged scope, run
  `git diff --cached --check`, and scan staged files for secrets and forbidden
  generated output.
