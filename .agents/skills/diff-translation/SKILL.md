---
name: diff-translation
description: Synchronize this structured Astro mirror with the official deepseek-ai/deepseek-harness Chinese and English documentation. Use for upstream drift, immutable source refreshes, projection reconciliation, evidence, recovery, and result generation. Japanese and Korean are outside this repository's product and workflow.
---

# DeepSeek Harness source synchronization

This repository no longer translates documentation. The historical skill name
is retained so existing automation can find the workflow, but every active step
is limited to locked official Simplified Chinese and English sources.

## Invariants

- The only upstream is `https://github.com/deepseek-ai/deepseek-harness`.
- Resolve `master` to a full commit before reading files. Never synchronize a
  moving raw URL.
- Official Chinese and English Git blobs are source truth. Preserve their bytes
  exactly; do not send them through a model or edit them by hand.
- `config/docs-manifest.json` owns official source identities and pairings.
  Upstream `website/docs.ts` and VitePress controls are frozen discovery inputs,
  not local runtime code.
- `config/content-map.json` owns local Astro page identity. An upstream refresh
  may never assign a new segment or route automatically.
- Every run under `.docs-source/runs/<run-id>/` is immutable. Do not overwrite
  discovery, apply, evidence, verification, or result records.
- Catalog/control, license, brand asset, pairing, fallback, schema, projector,
  navigation, SEO, or redirect drift requires human review.
- Promotion copies only the frozen official `docs/`, license, and brand assets,
  then captures their lock. It never copies upstream VitePress runtime files.
- A source-changing run is incomplete until segment extraction, projection,
  content audit, Astro build, SEO/routes, and changed-route browser evidence
  pass against the same input fingerprint.
- Recovery uses `prepare --recovery-run-id`; it reuses the frozen checkout and
  baseline, never refetches different bytes.
- Publication, Git, deployment, IndexNow, and search-engine requests remain
  separate actions and require their normal authorization.

Read [catalog-and-source.md](references/catalog-and-source.md) before discovery
or apply, [validation-gates.md](references/validation-gates.md) before formal
verification, and [diff-triage-rules.md](references/diff-triage-rules.md) for
every material source or projection change.

## Workflow

### 0. Trigger gate

```bash
python3 .agents/skills/diff-translation/scripts/snapshot_manager.py check \
  --repo-root . --require-update
```

- Exit `0`: upstream commit differs; continue to immutable discovery.
- Exit `20`: no update; report a successful no-op.
- Any other nonzero exit: stop and preserve the blocker.

### 1. Freeze input

```bash
python3 .agents/skills/diff-translation/scripts/snapshot_manager.py prepare \
  --repo-root . --run-id <YYYY-MM-DD-description>
```

Recovery must reuse frozen input:

```bash
python3 .agents/skills/diff-translation/scripts/snapshot_manager.py prepare \
  --repo-root . --run-id <recovery-run-id> \
  --recovery-run-id <source-run-id>
```

### 2. Discover

```bash
python3 .agents/skills/diff-translation/scripts/snapshot_manager.py discover \
  --repo-root . --run-id <run-id>
```

Outcomes are `no_update`, `no_content_update`, `ready`, or `blocked`. A changed
upstream publication control is a catalog review signal; it is never copied
into the local Astro runtime.

### 3. Pair review and triage

Review every changed English/Chinese pair together. Confirm each `.i18n.yaml`
record binds both current Git blobs. Record source risk and every affected local
target page obtained from `content-map.json`. Do not translate or rewrite either
locale.

### 4. Transactional source promotion

```bash
python3 .agents/skills/diff-translation/scripts/snapshot_manager.py apply \
  --repo-root . --run-id <run-id>
```

Apply backs up the controlled local files, copies frozen official source bytes,
license, favicon, and wordmark, runs the manifest capture, and rolls back on
failure. Local Astro/projector/config files are not overwritten.

### 5. Projection reconciliation

Run:

```bash
pnpm run content:segments
pnpm run content:project
pnpm run content:audit
```

Compare the regenerated segment inventory to `content-map.json`. Zero/multiple
selector matches, new/deleted segments, source hash changes, lost one-owner
coverage, exact full-page reproduction, or empty indexable targets block the
run. Update the map only through explicit human review and continue under a
recovery run; never mutate frozen evidence.

### 6. Build and browser evidence

```bash
pnpm run build
pnpm run preview
```

Inspect every affected target route in Chinese and English when both native
pages exist. Cover desktop/mobile, light/dark, navigation, outline, search,
Mermaid, code, tables, images, source attribution, canonical/hreflang, and
responsive overflow. Bind screenshot paths and hashes to source paths and
target routes, then import the evidence:

```bash
python3 .agents/skills/diff-translation/scripts/snapshot_manager.py evidence \
  --repo-root . --run-id <run-id> --type browser \
  --from-file <browser-evidence.json>
```

### 7. Formal verification and result

```bash
python3 .agents/skills/diff-translation/scripts/snapshot_manager.py verify \
  --repo-root . --run-id <run-id>

python3 .agents/skills/diff-translation/scripts/snapshot_manager.py result \
  --repo-root . --run-id <run-id>
```

Formal verification and result generation are single-use and append-only. A
failure stays immutable and continues only through a recovery run.

## Completion response

Report run ID, before/after commits, discovery outcome, changed Chinese/English
source inventory, affected target routes, projection blockers/resolution,
backup/rollback paths, exact validation commands, page/segment/route counts,
SEO and fragment results, browser routes/viewports, result path, and any manual
review blocker. Never report Japanese/Korean status, and never equate build or
IndexNow receipt with search indexing.
