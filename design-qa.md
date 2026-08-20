# Astro migration design QA

## Scope

This report validates the local Astro 7.2.4 and Starlight 0.41.7 implementation
introduced by `specs/0002.md`. It does not claim pixel parity with the retired
VitePress mirror: the task-oriented navigation, routes, page composition, and
visual shell are intentional local adaptations.

The older `local-*` screenshots in `.design-evidence/implementation/` document
the previous VitePress implementation and are retained as historical evidence.
The current implementation is represented only by the `astro-*` files listed
below.

## Environment

- URL: `http://127.0.0.1:4173`
- Browser: Chromium driven through Playwright CLI
- Desktop viewport: `1440 x 900`
- Mobile viewport: `390 x 844`
- Build input: the current local `dist/` produced by `pnpm run build`
- Locales: Simplified Chinese at root and English under `/en/`

## Current visual-refresh evidence

- Chinese Start page, desktop light:
  `.design-evidence/implementation/astro-refresh-start-zh-desktop-light.png`
- English Start page, desktop dark:
  `.design-evidence/implementation/astro-refresh-start-en-desktop-dark.png`
- Chinese code-heavy page, desktop light:
  `.design-evidence/implementation/astro-refresh-first-plugin-zh-desktop-light.png`
- Chinese Mermaid page, desktop light:
  `.design-evidence/implementation/astro-refresh-concepts-mermaid-zh-desktop-light.png`
- Chinese Start page, mobile light:
  `.design-evidence/implementation/astro-refresh-start-zh-mobile-light.png`
- Chinese mobile navigation:
  `.design-evidence/implementation/astro-refresh-start-zh-mobile-navigation-light.png`
- Chinese Cordis tutorial hierarchy, desktop light:
  `.design-evidence/implementation/astro-navigation-cordis-zh-desktop-light.png`
- Chinese Runtime hierarchy, desktop light:
  `.design-evidence/implementation/astro-navigation-runtime-zh-desktop-light.png`
- English Cordis API hierarchy, desktop light:
  `.design-evidence/implementation/astro-navigation-api-en-desktop-light.png`
- Chinese Cordis tutorial hierarchy, mobile menu open:
  `.design-evidence/implementation/astro-navigation-cordis-zh-mobile-open.png`
- Chinese Cordis page end without an attribution footer, desktop light:
  `.design-evidence/implementation/astro-source-removal-cordis-zh-desktop-bottom.png`
- English Cordis page end without an attribution footer, desktop light:
  `.design-evidence/implementation/astro-source-removal-cordis-en-desktop-bottom.png`
- Chinese Web UI page end without an attribution footer, mobile light:
  `.design-evidence/implementation/astro-source-removal-web-ui-zh-mobile-bottom.png`

The previous `astro-*` evidence remains as the pre-refresh implementation
record. The `astro-refresh-*` set above was captured from the current built
`dist/` through `astro preview`, not from the development server.

## Findings

### Structured information architecture

Passed. `/start` and `/en/start` render the new task-oriented Start hub rather
than reproducing the old official Quickstart page. The sidebar is grouped into
Start, Core concepts, Build and extend, Runtime and orchestration, API and
types, Examples, and Version changes. Internal source provenance remains bound
to each projected page without adding a visible upstream-attribution footer.

The reviewed navigation now places every one of the 85 neutral page identities
exactly once. Cordis tutorial pages are nested under Core concepts → Cordis;
the 42 Runtime subsystem pages are split into eight responsibility groups;
catalogs and Cordis API have separate branches; and examples are separated into
extension basics and advanced integrations. Chinese and English use concise,
independently reviewed labels while page titles, content, and routes remain
unchanged. Version changes is a direct entry instead of a redundant one-item
accordion.

### Visual system

Passed. The refresh adapts the restrained documentation language used by the
local `codex_doc_cn` project without copying its application code. The reading
column is capped at `50rem`; system typography uses smaller, tighter heading
steps; surfaces use neutral zinc values; blue is reserved for actionable text;
and borders replace decorative shadows. Light and dark modes share the same
hierarchy and spacing contract.

The sidebar now starts with every catalog group collapsed. Starlight opens only
the group containing the current page, preserving context while preventing all
169 pages from competing for attention. The active item uses a soft neutral
surface and a two-pixel edge marker instead of a saturated blue block.

Nested groups use a quieter secondary label and a vertical ownership guide for
their children. The current top-level and second-level ancestors open together;
unrelated branches remain closed. Both levels retain full-row summary targets,
native disclosure semantics, and visible chevrons.

### Locale behavior

Passed after one browser-found correction. The first browser pass showed
Chinese sidebar labels on English pages because Starlight looks up translation
labels by the configured `en-US` language tag, not the locale directory key
`en`. The configuration now uses `en-US`; a second pass confirmed English
group labels, page labels, previous/next navigation, title, H1, outline, and
language controls. Switching from `/start` to `/en/start` preserves the neutral
page identity.

### Source attribution display

Passed. The generated Chinese and English documentation pages no longer render
the former attribution footer, its source paths, or its upstream commit.
Public JSON-LD also omits `isBasedOn` and `citation`. Repository locks, segment
ownership, projection receipts, audit reports, and the license remain intact as
non-visual maintenance and compliance controls. Desktop page ends now flow
directly into pagination, and mobile pages retain normal bottom spacing without
an empty attribution surface.

### Search

Passed. English search for `workspace` returned 19 results, including the new
`/en/runtime/workspace`, `/en/examples/adding-a-package`, and
`/en/start/python-sdk` routes. The overlay, result fragments, highlights, and
load-more control were visible and interactive.

### Mermaid

Passed. `/concepts` contained three Mermaid source blocks; all three were
marked processed and rendered as SVG in the browser. The renderer follows the
active Starlight light/dark theme.

### Responsive layout and interactions

Passed. At `390 x 844`, the document collapses to a mobile header, compact
on-page outline, and menu button. Opening the menu displays the localized
task-oriented navigation without horizontal clipping. The content width,
heading scale, code surfaces, right outline, and pagination
were also checked at `1440 x 900` and `1920 x 1080`. Desktop light and dark
theme controls worked.

The Cordis mobile branch was checked with Core concepts and Cordis open, the
active tutorial step visible, and Plugin foundations toggled independently.
The Chinese-only Cordis API fallback entry also navigated through the built
local redirect to its English owner at `/en/api/cordis/inherited`.

### Browser health

No application runtime warning was observed. Local preview logs one expected
404 for `/_vercel/insights/script.js`: Vercel serves that endpoint only after
Web Analytics is enabled for and deployed through the connected Vercel
project. The component injection is present locally; production collection is
not asserted by this report.

## Automated checks represented by the same build

- 169 projected Chinese/English documentation pages
- 717 neutral source segments with 100% single-owner coverage
- 167 indexable sitemap URLs and 2 intentional `noindex` pages
- 166 permanent one-hop legacy redirects
- 6,131 internal fragment references across 173 HTML files
- 169 projected pages with no upstream attribution or source metadata
- no `/ja/` or `/ko/` output

## Production boundary

Production deployment, Vercel Analytics ingestion, Search Console processing,
Bing receipt, and live IndexNow submission were not performed. Those checks
must use the exact deployed commit and are outside this local implementation
report.

## Result

No remaining actionable P0, P1, or P2 visual or interaction issue was found in
the tested Astro/Starlight surfaces.

Final result: passed locally.
