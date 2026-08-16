---
name: diff-translation
description: Synchronize this mirror with the official deepseek-ai/deepseek-harness GitHub documentation publication. Use when checking upstream drift, refreshing official Chinese and English Markdown, reconciling Guide/Development/Reference routes, preparing immutable evidence, or later translating changed pages into Japanese and Korean with Codex. The workflow is commit-pinned, manifest-driven, transactionally promoted, and fail-closed.
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
- Publish only `zh-CN` and `en-US` in the first version. Keep `ja-JP` and
  `ko-KR` configured with `published: false`; do not expose English fallback
  pages under `/ja/` or `/ko/`.
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
- Publication, Git branches, commits, pushes, PRs, and deployment are separate
  actions. Perform them only when the user authorizes them; this skill does not
  hard-code `main`, `staging`, or a PR target.

Read [catalog-and-source.md](references/catalog-and-source.md) before discovery
or promotion. Read [validation-gates.md](references/validation-gates.md) before
verification or result generation. Read
[multi-language.md](references/multi-language.md) before enabling Japanese or
Korean. Use [diff-triage-rules.md](references/diff-triage-rules.md) for every
material page assessment.

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

The first version never sends official Chinese or English through Codex. Those
bytes are copied exactly. Japanese and Korean remain out of scope until the
user asks to enable them.

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

Do not enable these locales as part of a normal Chinese/English sync. When the
user explicitly asks for the next phase:

1. Freeze the reviewed English source hash for every selected page.
2. Bootstrap only with explicit `--all-pages`; later runs translate only exact
   changed/new page IDs.
3. Translate Japanese and Korean independently from English with Codex.
4. Preserve headings, code, inline code, link/image destinations, HTML/Vue
   syntax, Mermaid, tables, lists, and frontmatter keys.
5. Record `reviewed_source_sha256` for every locale page.
6. Publish a locale only after its complete structure/language audit and browser
   matrix pass. Never publish an English fallback under a locale prefix.

## Completion response

Report the run ID, upstream before/after commits, discovery outcome, changed
page/source inventory, promotion/rollback paths, exact validation commands,
browser routes/viewports, result path, unpublished ja/ko status, and any manual
review blocker. Do not claim completion from a build alone.
