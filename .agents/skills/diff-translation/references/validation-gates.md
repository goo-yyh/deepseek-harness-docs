# Validation gates

A material source run is complete only when all gates bind the same immutable
input fingerprint.

## Source

- Official repository, branch, commit, and tree are fully pinned.
- The manifest source count, Guide/Development/Reference inventory, and only
  the official zh-CN/en-US pairs match reviewed upstream publication.
- Every source and pairing record matches locked blobs, hashes, and bytes.
- The English-only inherited Cordis source is explicit.
- No Japanese/Korean directory, translation state, runner, route, sitemap URL,
  alternate, search entry, or dependency exists.

## Segment and projection

- Every locked source parses deterministically into title, introduction, and
  complete H2 subtrees; explicit pre-heading anchors stay with their H2.
- Segment selectors and raw/visible hashes match exactly.
- Coverage is 100%, every segment has one primary owner, and no target page
  reproduces one complete official-page segment inventory.
- Every generated locale page and source attribution is receipt-bound.
- New/deleted/ambiguous/orphan segments, empty indexable pages, route collisions,
  and unsupported body text fail closed.

## Build and SEO

- `pnpm test`
- `pnpm exec tsc --noEmit`
- `pnpm run docs:check`
- `pnpm run content:segments`
- `pnpm run content:project`
- `pnpm run content:audit`
- `pnpm run check`
- `pnpm run build`
- `pnpm run seo:audit`
- `pnpm run docs:routes`
- Every expected static zh/en route exists; ja/ko output is absent.
- Search, Mermaid, code, images, source attribution, locale switching, and
  clean URLs work in production preview.
- Every indexable page passes unique title/description, lang, self-canonical,
  reciprocal native hreflang, x-default, robots, Open Graph, Twitter, JSON-LD,
  sitemap, robots.txt, redirect, and fragment checks.
- Vercel Analytics is injected once. IndexNow dry-run reads the fresh sitemap
  and key without sending a notification.

## Browser and immutable verification

Changed routes require local and official evidence at comparable viewports
where an official counterpart exists. Cover both locales where native,
desktop/mobile, light/dark, navigation, search, outline, content, diagrams,
links, source attribution, and accessibility. Formal verification writes once;
failed or stale evidence continues only through recovery.
