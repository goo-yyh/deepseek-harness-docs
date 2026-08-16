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
- Japanese/Korean remain unpublished until complete.

## Build/routes

- `pnpm exec tsc --noEmit`
- `pnpm run docs:check`
- `pnpm run build`
- `pnpm run docs:routes`
- Every manifest route emits HTML.
- No `/ja/` or `/ko/` output exists in the first version.
- Search, Mermaid, local images, edit links, language switching, and clean URLs
  work in the production preview.

## Browser evidence

Changed pages require source and local screenshots at equal desktop/mobile
viewports. Evidence must include local and official URLs, locale, viewport,
theme, interactions, source path, checked time, screenshot path, and screenshot
SHA-256. Check at least navigation/sidebar, page outline, search, language
switching, dark mode, heading order, visible prose/code, links, and responsive
layout where relevant.

## Immutable verification

Formal verification writes once. Each command receipt contains command,
timestamps, exit code, log path/hash, and the repository input fingerprint. A
failed or stale formal run is preserved; continue with a recovery run instead
of replacing evidence.
