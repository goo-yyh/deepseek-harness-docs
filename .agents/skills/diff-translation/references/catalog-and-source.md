# Catalog and source rules

## Authority order

1. Pinned Git blobs from `deepseek-ai/deepseek-harness` are content truth.
2. Pinned `website/docs.ts` is the page/route/sidebar publication truth.
3. Pinned VitePress config and assets are the visual/navigation truth.
4. The live GitHub Pages site verifies deployed rendering and interactions.

HTML scraping is never the normal content path. Do not execute upstream package
scripts, MDX, HTML, event handlers, or expressions while synchronizing.

## Catalog blockers

Any change to these paths blocks automatic content promotion:

- `website/docs.ts`
- `website/.vitepress/config.ts`
- `scripts/project-doc-site.ts`
- `website/public/wordmark.svg`
- `website/public/favicon.svg`
- `LICENSE`

Review additions/removals, module membership, section labels/order, route
aliases, locale fallback, edit links, responsive behavior, and licensing. After
reconciliation, regenerate the lock and start a new run.

## Content contract

- Every published source path is listed in `config/upstream-lock.json` with its
  Git blob, SHA-256, and byte length.
- Every ordinary bilingual page keeps the official sibling `.md`, `.zh.md`, and
  `.i18n.yaml` triplet.
- The hashes inside `.i18n.yaml` must equal the current Git blob hashes.
- `docs/cordis-api/inherited.md` is the sole current published English fallback
  on the Chinese route.
- Non-published repository-relative targets resolve to the pinned GitHub tree.
  Images rendered by the site must be present locally and must not be hotlinked.

## Promotion boundary

Promote from the run's frozen checkout, never a new network fetch. Copy the
complete official `docs/` tree so link targets and assets remain coherent. Copy
exact official publication controls except the reviewed local projector
adapter. Update the lock only after all copied bytes validate.
