# Design QA

## Comparison target

- Source visual truth:
  - `.design-evidence/source/official-quickstart-desktop-full.png`
  - `.design-evidence/source/official-quickstart-mobile-full.png`
  - `.design-evidence/source/official-quickstart-desktop-dark.png`
  - `.design-evidence/source/official-mobile-navigation-open.png`
  - `.design-evidence/source/official-search-open-mobile.png`
- Rendered implementation:
  - `.design-evidence/implementation/local-quickstart-desktop-full.png`
  - `.design-evidence/implementation/local-quickstart-mobile-full.png`
  - `.design-evidence/implementation/local-quickstart-desktop-dark.png`
  - `.design-evidence/implementation/local-mobile-navigation-open.png`
  - `.design-evidence/implementation/local-search-open-mobile.png`
- Source URL: `https://deepseek-harness.github.io/deepseek-harness/en/guide/quickstart`
- Implementation URL: `http://127.0.0.1:4173/en/guide/quickstart`
- Browser: Codex in-app Browser
- State: English Quickstart, light/dark theme and documented interaction states

## Viewport and normalization

| Surface | CSS viewport | Source pixels | Implementation pixels | deviceScaleFactor |
| --- | ---: | ---: | ---: | ---: |
| Desktop top | 1440 × 900 | 1440 × 900 | 1440 × 900 | 1 |
| Desktop full page | 1440 × 900 | 1440 × 1543 | 1440 × 1543 | 1 |
| Mobile top | 390 × 844 | 390 × 844 | 390 × 844 | 1 |
| Mobile full page | 390 × 844 | 390 × 1891 | 390 × 1891 | 1 |

The captures use equal browser, viewport, density, route, locale, theme, and
scroll state. Browser chrome is excluded.

## Full-view comparison evidence

- Desktop full-page source and implementation PNGs are byte-identical:
  `9b72a04299d6472e361c31f842fcf13fb56bc0b080c021811ca57473f58e957c`.
- Mobile full-page source and implementation PNGs are byte-identical:
  `dc424666a88fb9e88e7942cefa0c713e3b782f8b320ace5304f28a2c1c001eaa`.
- Mobile top source and implementation PNGs are byte-identical:
  `5bae16d32819d669191618b26939caa776e53a9a516fb9dff7c79b4cc447eea3`.
- Desktop dark-theme source and implementation PNGs are byte-identical:
  `6064edff03d2ce56f33e71905cc1e63029b28e6e495d0e331663c626974eb9f1`.
- The Reference landing page was also compared at 1440 × 900; its visible
  composition, sidebar density, headings, outline, and navigation match. Its
  capture timing included a different transient sidebar-scrollbar state, which
  is not design drift.

## Focused comparison evidence

- Mobile navigation-open source and implementation PNGs are byte-identical:
  `604221b4c724532e72b10768042e5791ddf23cccadbfb9beebd2843fa01d56da`.
- Mobile search-open source and implementation PNGs are byte-identical:
  `4bb7d29d15959298cdfc37a8009831bca72a67c8b621f689866c61907a306ec7`.
- Mobile sidebar and “On this page” states were compared in the same Browser
  comparison input. Visible geometry, overlay opacity, typography, item order,
  borders, and shadows match; non-identical PNG hashes come from transition and
  focus timing only.
- Desktop language menu, mobile sidebar, mobile page outline, English search
  results, Chinese search results, light/dark theme, Guide/Development/Reference
  navigation, and Chinese/English route switching were exercised.

## Required fidelity surfaces

### Fonts and typography

Passed. Both sites compute the body font as
`Inter, ui-sans-serif, system-ui, sans-serif, ...`; hierarchy, weights, sizes,
line heights, wrapping, code typography, and antialiasing match in equal-state
captures.

### Spacing and layout rhythm

Passed. Desktop measurements match exactly: fixed navigation height `64px`,
sidebar width `272px`, content container `688px` wide at `x=384`, and document
height `1543px`. Mobile document height matches at `1891px`. Section gaps,
rules, padding, radii, overlay geometry, and responsive collapse behavior match.

### Colors and visual tokens

Passed. Light body background/text are `rgb(255, 255, 255)` /
`rgb(60, 60, 67)` on both sites. Dark body background/text are
`rgb(27, 27, 31)` / `rgb(223, 223, 214)` on both sites. Brand, border,
sidebar, code, overlay, and focus tokens come from the same official VitePress
configuration.

### Image quality and asset fidelity

Passed. The real official wordmark and favicon are local assets; no handmade
replacement is used. Provider screenshots load from local hashed assets at
their full intrinsic sizes (`1600×866` and `1128×864`). Mermaid renders a real
SVG. No source image is hotlinked.

### Copy and content

Passed. The 83 canonical pages map to 166 official Chinese/English routes. All
165 published source files match their pinned upstream Git blobs and SHA-256
values, and all 82 bilingual pairing records validate. The official
`inherited.md` English fallback is preserved intentionally.

## Primary interactions and browser health

- English search returned 16 visible results for `workspace`.
- Chinese search returned 16 visible results for `工作区`.
- Language switching navigated between `/en/guide/quickstart` and
  `/guide/quickstart` with the correct title/H1.
- Development and Reference tabs navigated to their official landing routes.
- Mobile top navigation, sidebar drawer, page-outline dropdown, and search
  overlay opened and closed correctly.
- Provider images loaded completely from local assets.
- Mermaid rendered an SVG.
- Browser console warnings/errors checked: none.

## Production deployment verification

- Vercel production alias: `https://deepseek-harness-docs.vercel.app`.
- Vercel reported the production deployment as `Ready`.
- `/` resolved to `/guide/quickstart`; Chinese and English Quickstart routes
  returned `200`, while unpublished Japanese and Korean routes returned `404`.
- The deployed Chinese page, English page, three top-level tabs, pinned GitHub
  links, local search results, and official visual composition were rechecked in
  the Codex in-app Browser.

## Findings

No actionable P0, P1, or P2 visual mismatch was found.

The only intentional non-visual divergence is that repository-relative links to
non-published source paths use the pinned upstream commit instead of moving
`master`; the visible link labels and layout remain official, while the target
is more reproducible.

## Comparison history

Pass 1 found no P0/P1/P2 issues. No visual fix was required, so no second
comparison iteration was necessary.

## Implementation checklist

- [x] Desktop light parity
- [x] Desktop dark parity
- [x] Mobile responsive parity
- [x] Search parity and real results
- [x] Navigation/sidebar/outline parity
- [x] Chinese/English content and language switching
- [x] Real official assets and Mermaid
- [x] Zero browser console warnings/errors

## Follow-up polish

No P3 follow-up is required for the first-version visual target.

final result: passed
