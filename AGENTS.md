# DeepSeek Harness documentation mirror rules

This repository publishes an isomorphic mirror of the official DeepSeek Harness VitePress documentation. These instructions apply to the entire repository. `docs/AGENTS.md` is locked upstream content, not this mirror's maintenance guide.

## Product contract

- Preserve the official Guide, Development, and Reference information architecture, page order, navigation behavior, Markdown content, and VitePress visual system.
- Chinese is published at the root route and English at `/en/`. Japanese uses `/ja/` and Korean uses `/ko/` only when their entries in `config/locales.json` are published. The current locked publication contains 83 canonical pages and therefore 83 routes per published locale (332 routes when all four locales are enabled); derive inventories from `config/docs-manifest.json` instead of recreating them by hand.
- Japanese and Korean start unpublished and may be activated only as complete locale trees. Before activation, an unpublished locale emits no route, sitemap entry, hreflang alternate, language-menu entry, or fallback page. After activation, all 83 pages, localized navigation/search UI, independent SEO, and the browser matrix must remain complete; never regress a published locale to partial output.
- Node.js must satisfy `>=22.19.0`; use the pinned pnpm version from `package.json` and install with `pnpm install --frozen-lockfile`.

## Sources of truth

- `config/upstream-lock.json` pins the official `deepseek-ai/deepseek-harness` commit, Git tree, publication fingerprint, controls, Markdown, assets, and pairing records.
- `config/docs-manifest.json` owns canonical page identity, source files, route projection, labels, sections, order, and content locale. `config/locales.json` owns locale publication state and route prefixes.
- `config/translation-state/ja-JP.json` and `config/translation-state/ko-KR.json` bind every validated translation to its locked English Git blob, normalized source hash, target hash, navigation label, model fingerprint, validation status, and separate human-review status. The matching Markdown trees live under `docs-locales/ja/` and `docs-locales/ko/`; neither tree is an upstream source of truth.
- `website/docs.ts` is the executable official publication manifest. `scripts/project-doc-site.ts` projects locked sources into the ignored `website/.generated/` tree used by VitePress.
- `config/adapter-lock.json` records every intentional local adaptation of an upstream control. When an adapted control changes, review the upstream binding and update its local SHA-256 in the same change; never weaken `docs:check` to accept unexplained drift.
- `specs/0001.md` records the original planning and source investigation. The implemented site is the current VitePress stack described by code, manifests, locks, and this file when the historical plan differs.

## Official content and assets

- Do not hand-edit locked official Markdown, pairing records, brand assets, or unadapted upstream controls. Refresh them through `.agents/skills/diff-translation/SKILL.md` using a commit-pinned immutable run.
- Preserve official Chinese and English source bytes. Keep repository-only language switch lines in source; the projector may hide or adapt repository chrome without rewriting the locked file.
- Resolve repository-relative links and assets against the pinned upstream Git tree. A published target maps to its local route; a non-published upstream target maps to the pinned GitHub tree. Missing or repository-escaping targets fail closed.
- Keep official license and attribution files. Review license or publication-control changes before promotion.
- `docs/AGENTS.md` and other upstream documentation rules are themselves locked content. Do not rewrite them to describe this mirror.

## VitePress and visual fidelity

- The site uses the official VitePress configuration, default theme, Mermaid support, DeepSeek wordmark, navigation, sidebars, search, theme switcher, responsive drawers, outlines, and edit links. Prefer small adapter changes over a replacement theme.
- `website/.vitepress/config.ts` is an adapted upstream control. Preserve the official information architecture and visual behavior when adding local concerns such as SEO.
- Compare material UI changes against `.design-evidence/source/` and update `.design-evidence/implementation/` plus `design-qa.md` only after desktop/mobile and light/dark verification.
- The current Mermaid-heavy bundle may emit VitePress's chunk-size warning; it is non-fatal unless build output or runtime behavior regresses.

## Route and locale behavior

- Keep every published locale route tree isomorphic. A catalog change must update the manifest, executable route projection, locks, translation state for translated locales, validators, navigation, SEO expectations, and diff-translation evidence together.
- `/` and `/en/`, plus `/ja/` and `/ko/` when published, are navigation documents that immediately redirect to their locale Quickstart pages. They are `noindex, follow`, canonicalize to Quickstart, and stay out of the sitemap.
- `docs/cordis-api/inherited.md` is the sole current official Chinese-route English fallback. The static fallback remains a `noindex, follow` fail-safe with `en-US` content metadata and an English canonical.
- Vercel must issue a permanent redirect from `/reference/cordis-api/inherited` to `/en/reference/cordis-api/inherited`. Keep this redirect in `vercel.json` and its assertion in `scripts/verify-built-routes.ts`; do not rely on canonical metadata to navigate a browser.
- The English owner page remains indexable. The Chinese fallback must not claim `zh-CN` hreflang, enter the sitemap, or count as a completed Chinese translation.
- Japanese and Korean have no fallback exception. Missing, stale, English-copy, or unvalidated translated content blocks the entire locale from publication.

## Multilingual SEO

- `website/seo.ts` is the single owner of per-page SEO projection. `website/public/robots.txt` owns crawler discovery, and `scripts/audit-seo.ts` owns the rendered-page audit. Do not add one-off page tags that bypass these owners.
- The production canonical origin is `https://www.deepseek-harness-docs.com`; the apex domain redirects to `www`. Keep sitemap locations, robots discovery, canonical, hreflang, Open Graph, and JSON-LD on this origin.
- Every indexable localized page requires a unique localized title and description, the correct `<html lang>`, an absolute self-canonical URL, matching Open Graph and Twitter metadata, JSON-LD language and URL, and a complete reciprocal hreflang set plus `x-default`.
- Japanese and Korean SEO is independently localized from each page's validated target-language H1 and prose. Do not reuse English titles or descriptions as a fallback, even when technical literals remain English.
- `x-default` resolves to Chinese when a real Chinese translation exists. A fallback route uses the native-language canonical and alternates only; it is never advertised as a translation.
- `DOCS_SITE_ORIGIN` may override the production origin only with an HTTPS origin that has no path, query, or fragment. Any intentional origin migration must update `website/public/robots.txt` in the same change so the SEO audit remains consistent.
- `pnpm run build` runs the SEO audit for every rendered locale page and writes deterministic evidence to `reports/seo-audit.json`. The audit must cover titles, descriptions, languages, canonical URLs, hreflang, robots, Open Graph, Twitter, JSON-LD, sitemap entries, and `robots.txt`.

## Synchronization and future translation

- Use `.agents/skills/diff-translation/SKILL.md` to check upstream drift, freeze the source commit, classify publication changes, update official content, capture evidence, verify, recover, and report results.
- Treat changes to `website/docs.ts`, VitePress configuration, projection controls, licenses, source pairing, or locale fallback as catalog/control changes that require human review before promotion.
- Japanese and Korean translations use the normalized, locked official English page as their only translation source and Codex as translator. Every bootstrap must explicitly select all pages; the current catalog requires 83 validated pages per locale. Preserve Markdown structure, code, links, assets, terminology, and page identity. `translation_review: validated` records automated structural/language validation; it must never be presented as human approval. Human review is tracked separately.
- Run translation through `.agents/skills/diff-translation/scripts/translate_locale_with_codex.mjs`. Codex responses are schema-bound bundles with protected Markdown tokens, including plain repository paths so the model cannot turn them into new code spans; completed pages must also pass AST structure, immutable-literal, heading, target-language, source-hash, and target-hash checks.
- A protected table pipe is a table-cell ownership boundary. Link, strong/emphasis, and formatting groups must keep source order, nesting, and Markdown AST ownership. The runner may reinsert a missing table pipe only when the returned structural stream is otherwise the exact ordered source subsequence with no extra token. It may also insert exactly one ASCII space after a `LINK_TARGET` plus closing `FORMAT_BOUNDARY` before Japanese/Korean script so CommonMark keeps the link inside the strong span. Record either repair and its boundary in the immutable receipt; every other missing, extra, or reordered structural token rejects the response. Inline-code placeholders may follow target-language grammar only when their exact multiset and final AST association remain unchanged.
- Normalize only the closed, hash-bound locale map in `.agents/skills/diff-translation/references/locale-style-guide.md`; never use open-ended substitutions. The map covers required architecture nouns, UI phrases, natural-language headings/navigation, and known mixed product-plus-noun terms. Code-shaped types and APIs remain protected, but ordinary headings such as `Core`, `Effect`, `Disposable`, and `Fiber` must be localized. Exact packages, filenames, URLs, events, API symbols, and source-declared identifier/keyword/operation/provider/tool/family/example lists may remain Latin; surrounding prose must not. Record every normalized source term, localized replacement, unit, and count in the bundle receipt.
- Reject a structured bundle immediately when a source line with substantive visible prose becomes empty or implausibly short between the same protected newline boundaries. This early coverage gate complements, but does not replace, the final per-block semantic audit.
- Before accepting any generated or reused bundle receipt, restore each Markdown chunk and run the shared per-block structure, heading, residual-English, target-script, and hollow-content audit. A generated failure retries the bundle; a reused failure is recorded as a semantic reuse miss and regenerated. Locale-wide batch and final audits remain mandatory defense in depth.
- Translation work may run in parallel only at disjoint locale/run/batch boundaries. Never let two workers write the same batch, rerun a batch that already has output, or promote while any batch is running. Advance to the next batch only after the command exits 0, prints the explicit `validate-translation-batch ... passed` line, writes an `output/batch-receipt.json` with `validation_status: validated`, and replaces the running marker with a completed marker. A failed batch is immutable evidence: preserve its running marker, attempts, semantic reports, reuse records, and staging tree, then prepare a recovery run from its frozen input. A historical running marker records an attempted writer; confirm the OS process separately before treating it as active. Structured output may be reused only when batch inventory, prompt, style, schema, and input hashes match exactly, and the copied response plus its SHA-256 provenance is recorded. A valid but incompatible old receipt is recorded as a reuse miss and regenerated; a corrupt receipt or response remains a hard failure.
- Promotion is locale-wide and fail-closed: assemble all batches in run-local staging, require every page and navigation label, then replace the locale tree and write its complete translation state. Publication in `config/locales.json` is a separate reviewed step after both complete locale trees and all validation gates pass.
- Never publish a partial locale or copy English into a translated route. Promote and publish a locale only after complete structural, language, SEO, search, route, desktop, mobile, light, and dark validation. Each published Japanese/Korean page owns its localized title, description, canonical, Open Graph, Twitter, JSON-LD, hreflang, and sitemap record.
- Generated run state under `.docs-source/` and user-facing run output under `diff/` are ignored local evidence unless the workflow explicitly promotes a tracked artifact.

## IndexNow

- `website/public/3ad568e2babd4212b27130365f0c7a16.txt` is the root ownership file for `www.deepseek-harness-docs.com`. Its filename and UTF-8 content must remain identical unless the IndexNow key is intentionally rotated.
- `scripts/submit-indexnow.ts` reads only the freshly built `website/.dist/sitemap.xml`, rejects duplicate or off-origin URLs, verifies the built key, and checks that the deployed key and sitemap match before notifying IndexNow.
- `pnpm run build` includes the offline `indexnow:check` gate. Run `pnpm run indexnow:submit` manually only after the matching commit is deployed; do not submit on every CI build or notify URLs that are not live.
- An IndexNow HTTP `200` or `202` confirms receipt or pending key validation only. It does not prove crawling, indexing, or ranking; verify received URLs separately in Bing Webmaster Tools.

## Generated and local-only files

- Do not commit `node_modules/`, `website/.generated/`, `website/.cache/`, `website/.dist/`, `.docs-source/`, `diff/`, `.vercel/`, `.chat/`, `.DS_Store`, or logs.
- Commit `reports/seo-audit.json` only as deterministic verification evidence; rerunning an unchanged build must not introduce timestamps or nondeterministic ordering.
- Keep real credentials, Vercel tokens, environment files, cookies, browser profiles, and private session data out of Git. Examples and configuration may contain placeholders only.

## Required verification

Run these gates before committing or publishing a material change:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm run docs:check
pnpm run docs:i18n
pnpm run build
pnpm run docs:routes
```

- `docs:check` verifies locked official bytes, Git blobs, bilingual pairing records, route/locale boundaries, and adapted controls.
- `docs:i18n` verifies all 83 Japanese and all 83 Korean pages against the current English lock, translation-state provenance, target hashes, Markdown structure, navigation labels, and target-language heuristics. It is mandatory once either translated locale is part of a material change, including while publication remains disabled.
- `build` projects the sources, builds VitePress, generates the sitemap, and runs the all-page SEO audit.
- `build` also validates the IndexNow key file and production sitemap without sending a notification.
- `docs:routes` verifies every expected HTML route, published-locale presence, unpublished-locale absence, locale-home redirects, and the Vercel fallback redirect contract.
- Before a Git release, also inspect the complete staged scope, run `git diff --cached --check`, and scan staged paths for credentials and ignored build output.

## Git and deployment

- `main` is the publication branch. Direct pushes require explicit user authorization plus branch, remote, staged-scope, secret, validation, and remote-ref checks.
- The user owns Vercel Project creation, Git connection, and first deployment. A request to commit and push does not authorize `vercel link`, Project creation, CLI deployment, alias changes, or Project deletion.
- Keep `vercel.json` portable and do not set `git.deploymentEnabled: false`; after the user connects a Project, Vercel Git automatic deployments remain available under that Project's settings.
- The repository is configured for a Vercel static build with `pnpm install --frozen-lockfile`, `pnpm run build`, and output directory `website/.dist`. Keep `cleanUrls` and immutable asset caching unless the routing contract changes.
- After pushing, verify local `HEAD`, `origin/main`, and the remote `refs/heads/main` are identical. Report validation and Git state separately from deployment state.
