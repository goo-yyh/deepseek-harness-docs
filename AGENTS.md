# DeepSeek Harness documentation mirror rules

This repository publishes an isomorphic mirror of the official DeepSeek Harness VitePress documentation. These instructions apply to the entire repository. `docs/AGENTS.md` is locked upstream content, not this mirror's maintenance guide.

## Product contract

- Preserve the official Guide, Development, and Reference information architecture, page order, navigation behavior, Markdown content, and VitePress visual system.
- Chinese is published at the root route and English at `/en/`. The current locked publication contains 83 canonical pages and 83 routes per published locale; treat `config/docs-manifest.json` as the route identity rather than recreating inventories by hand.
- Japanese and Korean are registered in `config/locales.json` but remain unpublished until their complete route trees, translations, search behavior, SEO, and visual checks pass. An unpublished locale emits no route, sitemap entry, hreflang alternate, language-menu entry, or fallback page.
- Node.js must satisfy `>=22.19.0`; use the pinned pnpm version from `package.json` and install with `pnpm install --frozen-lockfile`.

## Sources of truth

- `config/upstream-lock.json` pins the official `deepseek-ai/deepseek-harness` commit, Git tree, publication fingerprint, controls, Markdown, assets, and pairing records.
- `config/docs-manifest.json` owns canonical page identity, source files, route projection, labels, sections, order, and content locale. `config/locales.json` owns locale publication state and route prefixes.
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

- Keep Chinese and English route trees isomorphic. A catalog change must update the manifest, executable route projection, locks, validators, navigation, SEO expectations, and diff-translation evidence together.
- `/` and `/en/` are navigation documents that immediately redirect to their locale Quickstart pages. They are `noindex, follow`, canonicalize to Quickstart, and stay out of the sitemap.
- `docs/cordis-api/inherited.md` is the sole current official Chinese-route English fallback. The static fallback remains a `noindex, follow` fail-safe with `en-US` content metadata and an English canonical.
- Vercel must issue a permanent redirect from `/reference/cordis-api/inherited` to `/en/reference/cordis-api/inherited`. Keep this redirect in `vercel.json` and its assertion in `scripts/verify-built-routes.ts`; do not rely on canonical metadata to navigate a browser.
- The English owner page remains indexable. The Chinese fallback must not claim `zh-CN` hreflang, enter the sitemap, or count as a completed Chinese translation.

## Multilingual SEO

- `website/seo.ts` is the single owner of per-page SEO projection. `website/public/robots.txt` owns crawler discovery, and `scripts/audit-seo.ts` owns the rendered-page audit. Do not add one-off page tags that bypass these owners.
- The production canonical origin is `https://www.deepseek-harness-docs.com`; the apex domain redirects to `www`. Keep sitemap locations, robots discovery, canonical, hreflang, Open Graph, and JSON-LD on this origin.
- Every indexable localized page requires a unique localized title and description, the correct `<html lang>`, an absolute self-canonical URL, matching Open Graph and Twitter metadata, JSON-LD language and URL, and a complete reciprocal hreflang set plus `x-default`.
- `x-default` resolves to Chinese when a real Chinese translation exists. A fallback route uses the native-language canonical and alternates only; it is never advertised as a translation.
- `DOCS_SITE_ORIGIN` may override the production origin only with an HTTPS origin that has no path, query, or fragment. Any intentional origin migration must update `website/public/robots.txt` in the same change so the SEO audit remains consistent.
- `pnpm run build` runs the SEO audit for every rendered locale page and writes deterministic evidence to `reports/seo-audit.json`. The audit must cover titles, descriptions, languages, canonical URLs, hreflang, robots, Open Graph, Twitter, JSON-LD, sitemap entries, and `robots.txt`.

## Synchronization and future translation

- Use `.agents/skills/diff-translation/SKILL.md` to check upstream drift, freeze the source commit, classify publication changes, update official content, capture evidence, verify, recover, and report results.
- Treat changes to `website/docs.ts`, VitePress configuration, projection controls, licenses, source pairing, or locale fallback as catalog/control changes that require human review before promotion.
- Japanese and Korean translations use the locked official English page as their only translation source and Codex as translator. Preserve Markdown structure, code, links, assets, terminology, and page identity.
- Never publish a partial locale or copy English into a translated route. Promote a locale only after complete structural, language, SEO, search, desktop, mobile, light, and dark validation.
- Generated run state under `.docs-source/` and user-facing run output under `diff/` are ignored local evidence unless the workflow explicitly promotes a tracked artifact.

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
pnpm run build
pnpm run docs:routes
```

- `docs:check` verifies locked official bytes, Git blobs, bilingual pairing records, route/locale boundaries, and adapted controls.
- `build` projects the sources, builds VitePress, generates the sitemap, and runs the all-page SEO audit.
- `docs:routes` verifies every official HTML route, unpublished-locale absence, locale-home redirects, and the Vercel fallback redirect contract.
- Before a Git release, also inspect the complete staged scope, run `git diff --cached --check`, and scan staged paths for credentials and ignored build output.

## Git and deployment

- `main` is the publication branch. Direct pushes require explicit user authorization plus branch, remote, staged-scope, secret, validation, and remote-ref checks.
- The user owns Vercel Project creation, Git connection, and first deployment. A request to commit and push does not authorize `vercel link`, Project creation, CLI deployment, alias changes, or Project deletion.
- Keep `vercel.json` portable and do not set `git.deploymentEnabled: false`; after the user connects a Project, Vercel Git automatic deployments remain available under that Project's settings.
- The repository is configured for a Vercel static build with `pnpm install --frozen-lockfile`, `pnpm run build`, and output directory `website/.dist`. Keep `cleanUrls` and immutable asset caching unless the routing contract changes.
- After pushing, verify local `HEAD`, `origin/main`, and the remote `refs/heads/main` are identical. Report validation and Git state separately from deployment state.
