# Catalog and source rules

## Authority order

1. Pinned official Git blobs are Chinese/English content truth.
2. `config/docs-manifest.json` is source-page identity and pairing truth.
3. `config/source-segments.json` is locked-AST segment truth.
4. `config/content-map.json`, `navigation.json`, and `seo-metadata.json` are the
   local Astro publication truth.
5. Upstream publication controls and the live official site are discovery and
   rendered-behavior evidence only.

## Catalog blockers

Changes to upstream `website/docs.ts`, VitePress configuration, projector,
brand assets, or license block automatic promotion. Review source additions,
removals, pairing, fallback, official module identity, and licensing. Do not
copy upstream VitePress controls into the local runtime.

Local changes to segment schema, content map, navigation, SEO metadata,
redirects, Astro/Starlight controls, projector, or provenance audit are also
high-risk reviewed controls.

## Content contract

- Every published source path is bound to a Git blob, SHA-256, and byte length.
- Ordinary bilingual pages retain the official `.md`, `.zh.md`, and
  `.i18n.yaml` triplet.
- `docs/cordis-api/inherited.md` remains the sole English-only source owner; it
  must not appear as native Chinese content.
- Non-published repository links resolve to the pinned GitHub tree. Published
  targets resolve to the local segment owner; images are copied locally.
- Japanese/Korean sources, translations, state, routes, and fallbacks are not
  part of the catalog.

## Promotion boundary

Promote only from the frozen checkout. Copy the complete official `docs/` tree,
license, favicon, and wordmark. Re-capture locks, regenerate segments, and stop
for projection reconciliation before publication. Local Astro controls and
manifests are never replaced automatically.
