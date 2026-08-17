---
name: diff-translation
description: Synchronize this mirror with the official deepseek-ai/deepseek-harness GitHub documentation publication. Use when checking upstream drift, refreshing official Chinese and English Markdown, reconciling Guide/Development/Reference routes, preparing immutable evidence, or translating Japanese and Korean from locked English with Codex. The workflow is commit-pinned, manifest-driven, schema-bound, transactionally promoted, and fail-closed.
---

# DeepSeek Harness Diff Translation

This skill is intentionally specific to this repository. It borrows the safe
parts of `codex_doc_cn`'s workflow—immutable runs, catalog blocking,
transactional promotion, source hashes, recovery lineage, browser evidence, and
an evidence-backed result—but uses the DeepSeek Harness GitHub repository as the
source of truth.

## Invariants

- The only upstream is `https://github.com/deepseek-ai/deepseek-harness`.
- Resolve `master` to a full commit before reading files. Never synchronize from
  a moving raw URL.
- Treat `website/docs.ts` as the publication catalog and
  `website/.vitepress/config.ts` as the navigation/visual contract.
- Treat official Markdown Git blobs as the Chinese and English content truth.
  The live VitePress site is evidence for rendered behavior, not a replacement
  content source.
- Preserve official `zh-CN` and `en-US` bytes exactly. `ja-JP` and `ko-KR` use
  the locked, normalized English page as their only translation input. Keep a
  translated locale unpublished until its full manifest-sized tree and
  translation state pass every gate; never expose English fallback pages under
  `/ja/` or `/ko/`.
- Preserve the official `docs/cordis-api/inherited.md` exception: both official
  locale routes intentionally render its English source.
- Store every run under `.docs-source/runs/<run-id>/`. Never reuse or overwrite
  a run directory, discovery report, verification, or immutable result.
- A changed publication manifest, VitePress config, projector, brand asset, or
  license is blocking review evidence. Do not silently absorb it as a prose
  update.
- Promote only a frozen checkout and only after discovery reports no catalog,
  visual, adapter, license, source-pair, or missing-file blocker.
- Back up the complete current `docs/` tree and controlled files before
  promotion. Roll back automatically if capture or validation fails.
- Changed official source bytes must match their Git blob IDs and SHA-256 values.
- A successful content-changing run requires browser evidence for the changed
  pages after the final build. Source/build checks cannot substitute for visual
  evidence.
- Recovery uses `prepare --recovery-run-id <run-id>` and copies the earlier
  frozen checkout and baseline. It must not refetch different bytes.
- Translation recovery uses the same rule: copy frozen translation inputs into
  a new run ID, never overwrite batch output, and record any structured-response
  reuse with source run, source file, and SHA-256 provenance.
- Codex translation output is accepted only through the structured bundle
  schema. Protected Markdown tokens must be preserved exactly, structural token
  order must remain stable, and the restored page must match the English AST
  structure and immutable-literal fingerprint.
- Promotion is whole-locale. The current manifest has 83 canonical pages, so a
  Japanese or Korean promotion requires 83 translated pages and 83 navigation
  labels bound to the same upstream commit. Do not change locale publication
  state inside a partial translation run.
- Publication, Git branches, commits, pushes, PRs, and deployment are separate
  actions. Perform them only when the user authorizes them; this skill does not
  hard-code `main`, `staging`, or a PR target.

Read [catalog-and-source.md](references/catalog-and-source.md) before discovery
or promotion. Read [validation-gates.md](references/validation-gates.md) before
verification or result generation. Read
[multi-language.md](references/multi-language.md) before enabling Japanese or
Korean, and read [locale-style-guide.md](references/locale-style-guide.md)
before preparing or reviewing a translation batch. Use
[diff-triage-rules.md](references/diff-triage-rules.md) for every material page
assessment.

## Stable workflow

### 0. Trigger gate

```bash
python3 .agents/skills/diff-translation/scripts/snapshot_manager.py check \
  --repo-root . --require-update
```

- Exit `0`: `sync_required`; continue.
- Exit `20`: `no_update`; report a successful no-op and stop.
- Any other nonzero exit: blocked; do not create a run.

The trigger compares the full remote `master` commit with
`config/upstream-lock.json`. A newer commit is only permission to inspect; it is
not proof that published documentation changed.

### 1. Prepare immutable input

```bash
python3 .agents/skills/diff-translation/scripts/snapshot_manager.py prepare \
  --repo-root . --run-id <YYYY-MM-DD-description>
```

`prepare` freezes a checkout, the prior lock, the publication manifest, the
upstream commit/tree, and input hashes. For recovery:

```bash
python3 .agents/skills/diff-translation/scripts/snapshot_manager.py prepare \
  --repo-root . --run-id <recovery-run-id> \
  --recovery-run-id <source-run-id>
```

### 2. Discover catalog, visual, and content changes

```bash
python3 .agents/skills/diff-translation/scripts/snapshot_manager.py discover \
  --repo-root . --run-id <run-id>
```

Discovery outcomes:

- `no_update`: commit and publication bytes are unchanged.
- `no_content_update`: upstream commit moved, but this publication did not.
- `ready`: only locked official content/pair records changed.
- `blocked`: catalog, visual configuration, adapter, license, pair, or path
  review is required.

When blocked, reconcile the repository's publication manifest and acceptance
tests deliberately, then start a new immutable run. Never patch the frozen
discovery report.

### 3. Review and classify

Inspect every changed English/Chinese pair together. Confirm the official
`.i18n.yaml` record points at both current Git blobs. Record page risk with the
rules in `diff-triage-rules.md`.

Never send official Chinese or English through Codex. Those bytes are copied
exactly. Japanese and Korean are a separate, explicitly authorized translation
phase; activating that phase does not relax official-content locks.

### 4. Transactional promotion

```bash
python3 .agents/skills/diff-translation/scripts/snapshot_manager.py apply \
  --repo-root . --run-id <run-id>
```

This writes a backup into the run, promotes the frozen `docs/` and exact
official controls, regenerates the upstream lock/tree/manifest, and rolls back
on failure. The locally adapted projector is never overwritten automatically.

### 5. Build and browser evidence

Start the final production preview:

```bash
pnpm run build
pnpm run preview
```

Capture the changed routes at desktop and mobile, in both official locales when
the pair changed. Include search/sidebar/navigation states when catalog or
presentation behavior is affected. Save a JSON record with concrete local and
official URLs, viewport, theme, interactions, screenshot path, screenshot
SHA-256, source path, and checked time, then import it:

```bash
python3 .agents/skills/diff-translation/scripts/snapshot_manager.py evidence \
  --repo-root . --run-id <run-id> --type browser \
  --from-file <browser-evidence.json>
```

### 6. Formal verification

```bash
python3 .agents/skills/diff-translation/scripts/snapshot_manager.py verify \
  --repo-root . --run-id <run-id>
```

Formal verification is single-use and append-only. It binds the current input
fingerprint to real command logs and requires browser evidence for a material
run. If it fails, preserve the run and create a recovery run.

### 7. Result

```bash
python3 .agents/skills/diff-translation/scripts/snapshot_manager.py result \
  --repo-root . --run-id <run-id>
```

The command writes the immutable result under the run and atomically publishes
the latest projection to `diff/result.md`. Do not hand-edit the generated
result.

## Japanese and Korean activation

Do not enable these locales as a side effect of a normal Chinese/English sync.
The user must explicitly authorize the translation phase. The current bootstrap
is full-catalog only and therefore requires `--all-pages` for every command.

### 1. Prepare immutable locale runs

Use one run ID for both locales or distinct run IDs. Locale subtrees are
isolated under `.docs-source/runs/<run-id>/translation/<locale>/`.

```bash
node .agents/skills/diff-translation/scripts/translate_locale_with_codex.mjs prepare \
  --repo-root . --run-id <run-id> --locale ja-JP --all-pages \
  --bundle-chars 4000 --model gpt-5.6-terra --reasoning-effort low

node .agents/skills/diff-translation/scripts/translate_locale_with_codex.mjs prepare \
  --repo-root . --run-id <run-id> --locale ko-KR --all-pages \
  --bundle-chars 4000 --model gpt-5.6-terra --reasoning-effort low
```

Preparation verifies every English path against the upstream lock, removes only
repository chrome defined by the normalizer, records the upstream commit/model/
reasoning configuration, and partitions all 83 pages into immutable batches.
`input/`, `batch.json`, `STYLE.md`, and `PROMPT.md` are evidence; do not edit
them.

Validate the entire frozen source/chunk/protection round trip before starting a
writer. Use the same explicit bundle size and model configuration as prepare:

```bash
node .agents/skills/diff-translation/scripts/translate_locale_with_codex.mjs validate-inputs \
  --repo-root . --run-id <run-id> --locale <ja-JP|ko-KR> --all-pages \
  --bundle-chars 4000 --model gpt-5.6-terra --reasoning-effort low
```

### 2. Translate schema-bound batches

```bash
node .agents/skills/diff-translation/scripts/translate_locale_with_codex.mjs run-batch \
  --repo-root . --run-id <run-id> --locale ja-JP --all-pages --batch <N> \
  --bundle-chars 4000 --model gpt-5.6-terra --reasoning-effort low
```

Run the equivalent command for every Japanese and Korean batch. Work may be
parallelized only across distinct `<run-id>/<locale>/<batch>` targets. Never run
two writers for the same batch, and never promote while batch writers are
active.

Each page is split into schema-bound units. The translator protects
frontmatter, fenced code, comments, heading/list markers, strong delimiters,
inline code, destinations, HTML, URLs, plain repository paths, table pipes, and newlines. A response is
rejected unless all unit IDs and placeholders match, structural placeholders
retain order, restored heading levels match, the Markdown AST/immutable-value
fingerprint is unchanged, and natural-language headings are localized. A batch
is promoted from `output-staging/` to immutable `output/` only after every page
and navigation label passes.

Protected table pipes are cell-ownership boundaries. Link, emphasis/strong, and
other formatting groups keep source order, nesting, and Markdown AST ownership.
One deterministic structural repair is deliberately narrower than the
rejection rule: the runner may reinsert a missing protected table-pipe token
only when the target structural-token stream is otherwise an exact ordered
subsequence of the source and contains no extra token. A separate CommonMark
repair may insert exactly one ASCII space after a `LINK_TARGET` plus closing
`FORMAT_BOUNDARY` before Japanese/Korean script; it changes no token order and
keeps the link inside the strong span. Inline-code placeholders may move with
target-language grammar but must retain their exact multiset and final AST
association. The immutable bundle receipt records every repair and insertion
boundary. Missing or reordered non-table structural tokens, extra tokens, or
an ambiguous table-pipe position still reject the response.

The CLI fallback structured-bundle limit is 20,000 characters, but it is not a
production recommendation. The validated bootstrap profile uses an explicit
`--bundle-chars 4000`. Keep the exact same explicit value on prepare,
`validate-inputs`, every batch, recovery, and promotion; changing it is a new
immutable workflow and requires a recovery run.
Navigation-label units are packed separately from page Markdown so a short UI
label cannot be copied at the tail of a long response. Before a batch becomes
immutable `output/`, `scripts/validate-translation-batch.ts` applies the same
per-block semantic, residual-English, target-script, container, structure, and
language checks used by the final locale-wide audit.

After schema validation, the runner applies only the closed, hash-bound map in
`references/locale-style-guide.md`. It covers required generic architecture
prose, UI phrases, ordinary natural-language headings/navigation, and known
mixed product-plus-noun terms. Code-shaped types/APIs and inline-code tokens
remain protected; ordinary word headings such as `Core`, `Effect`,
`Disposable`, and `Fiber` are localized. Exact packages, filenames, URLs,
events, API symbols, and source-declared identifier/keyword/operation/provider/
tool/family/example lists may remain Latin, but surrounding prose must be
translated. Each source term, target replacement, unit, and count is stored in
`terminology_repairs`; open-ended substitutions are not allowed.

The structured validator also compares visible content between identical
protected newline boundaries. If a substantive source line becomes empty or
implausibly short, reject and retry that bundle immediately; do not wait for the
locale-wide semantic audit to discover the omission.

Before writing a generated or reused bundle receipt, restore each Markdown
chunk and run the shared per-block structure, heading, residual-English,
target-script, and hollow-content audit. A generated failure retries that
bundle. A reused failure is recorded as a semantic reuse miss and regenerated.
The batch-level and final locale-wide audits still run as defense in depth.

Do not infer batch success from generated receipts alone. Start the next batch
only when the command exits 0, prints the explicit
`validate-translation-batch ... passed` line, writes
`output/batch-receipt.json` with `validation_status: validated`, and replaces
the running marker with a completed marker. On failure, preserve the running
marker, attempts, semantic reports, reuse records, and staging tree. A
historical running marker is evidence of an attempted writer, not proof that
its PID still exists; check the OS process before declaring a live conflict.

### 3. Recover or reuse without mutating evidence

If a prepared or executed run needs a fix, preserve it and prepare a new run
from its frozen inputs:

```bash
node .agents/skills/diff-translation/scripts/translate_locale_with_codex.mjs prepare \
  --repo-root . --run-id <recovery-run-id> --locale <ja-JP|ko-KR> --all-pages \
  --recovery-run-id <source-run-id> \
  --bundle-chars 4000 --model gpt-5.6-terra --reasoning-effort low
```

Run `validate-inputs` for the recovery run with the same explicit
`--bundle-chars 4000`, model, and effort before any recovery batch.

An already accepted structured response may be reused only when the source
batch page inventory and every frozen input hash are identical:

```bash
node .agents/skills/diff-translation/scripts/translate_locale_with_codex.mjs run-batch \
  --repo-root . --run-id <recovery-run-id> --locale <ja-JP|ko-KR> --all-pages \
  --batch <N> --reuse-structured-run-id <source-run-id> \
  --bundle-chars 4000 --model gpt-5.6-terra --reasoning-effort low
```

Reused JSON is revalidated through the current schema/token rules and copied
into the new run. `structured-reuse.json` records its source run/file and
SHA-256. A receipt and response that are internally valid but have an
incompatible inventory, prompt, style, or schema are recorded as a reuse miss,
and Codex generates that bundle normally. A corrupt receipt, response hash, or
generation-provenance record remains a hard failure and never becomes a reuse
miss.

### 4. Promote complete locale trees

After every batch for a locale has immutable output:

```bash
node .agents/skills/diff-translation/scripts/translate_locale_with_codex.mjs promote \
  --repo-root . --run-id <run-id> --locale ja-JP --all-pages \
  --bundle-chars 4000 --model gpt-5.6-terra --reasoning-effort low

node .agents/skills/diff-translation/scripts/translate_locale_with_codex.mjs promote \
  --repo-root . --run-id <run-id> --locale ko-KR --all-pages \
  --bundle-chars 4000 --model gpt-5.6-terra --reasoning-effort low
```

Promotion first assembles the complete tree under run-local staging. It then
replaces `docs-locales/ja/` or `docs-locales/ko/` and writes the matching
`config/translation-state/<locale>.json`. Each of the 83 state entries binds
page ID, locked English Git blob/SHA-256, normalized source SHA-256,
`reviewed_source_sha256`, target SHA-256, localized navigation label, and
automated validation status. The state header binds upstream commit, model, CLI
fingerprint, reasoning effort, generation/validation time, and a separate
human-review status. `translation_review: validated` must never be described as
human approval.

Do not set `published: true` until both intended locale promotions are complete
and `pnpm run docs:i18n` passes. Publication is a reviewed catalog/config change,
followed by the complete static, route, search, independent SEO, and browser
gates in `validation-gates.md`. Japanese and Korean pages must never borrow
English SEO text or content fallback.

## Completion response

Report the run ID, upstream before/after commits, discovery outcome, changed
page/source inventory, translation batch/recovery/reuse provenance, model and
CLI fingerprint, promotion/rollback paths, exact validation commands, per-locale
page and route counts, independent SEO results, browser routes/viewports, result
path, locale publication status, and any manual review blocker. Do not claim
completion from a build alone.
