# セッションプロジェクション

セッションプロジェクションの抽象シームは、ドメインのホストプラグインが、ログから導出されたセッションごとの状態の現在値全体をクライアントキャリアへ提供するための[機能シーム](../capability-seams.md)です。これには、サービス定義とレジストリ（[dsh-session-projection](../../packages/session/session-projection)、`ctx.sessionProjections`）、ドメインコントリビューター（それぞれが 1 つの純粋なユニットを登録します）、およびキャリア（[dsh-host-apiproxy](../../packages/host/apiproxy) の履歴末尾ページと `session/projection` プッシュフレーム）が含まれます。これは任意の 1 つの機能であり、エージェントループの中核には含まれません。フレームワークが駆動し、ドメインが計算します。レジストリは `session/event` を一度だけ購読し、コミットされたすべてのイベントをすべてのユニットに適用して畳み込みます。ドメインは購読を保持せず、クライアントがドメインイベントを畳み込むこともありません。クライアントは完成した値を受け取ります。設計権限: [セッションプロジェクション RFC](../../.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md)。drive/cache/feed の契約: [パッケージ README](../../packages/session/session-projection/README.md)。

ソース： [`packages/session/session-projection/src/index.ts`](../../packages/session/session-projection/src/index.ts)

## ユニット

`SessionProjectionMap` は、チェーン全体（ホストユニット、ワイヤーブロック、クライアントフック）のマージ拡張可能な型テーブルです。値はワイヤー JSON の値全体であり、レンダリングはスロットシステムの責務で、このレイヤーの責務ではありません。ドメインはキーごとに 1 つの `ProjectionDefinition` を提供します。

```ts type-equiv
/**
 * One domain's state-driven computation unit: three pure synchronous
 * functions plus declarations — never an opaque getter. The framework drives
 * `apply` on every committed session event; the domain holds no
 * subscriptions and owns only the mathematics. All three functions MUST be
 * synchronous (an async unit would tear the carriers' consistency cut) and
 * `state` MUST be plain JSON (the persisted-cache precondition).
 */
interface ProjectionDefinition<K extends keyof SessionProjectionMap, S> {
  /** The projection key this unit owns (its `SessionProjectionMap` entry). */
  key: K
  /** Validates the wire payload (`view` output) before it leaves the host. */
  schema: ZodType<SessionProjectionMap[K]>
  /**
   * State for the empty log.
   * @returns the initial state.
   */
  init(): S
  /**
   * Pure transition: previous state + one committed event → next state. A
   * unit uninterested in an event MUST return the same state reference — an
   * unchanged reference (`Object.is`) produces zero downstream work.
   * @param state - the state covering all prior events.
   * @param event - the next committed session event.
   * @returns the next state (same reference when the event is not the unit's).
   */
  apply(state: S, event: SessionEvent): S
  /**
   * State → wire payload (the read-side projection).
   * @param state - the current state.
   * @returns the whole current value for this unit's key.
   */
  view(state: S): SessionProjectionMap[K]
  /**
   * Persisted-cache invalidation version: bump whenever the serialized state fields or the
   * fold semantics change, so persisted `(sessionId, key, ver, seq, val)`
   * rows from an older unit are discarded instead of being forward-applied
   * into garbage. Non-negative integer.
   */
  stateVersion: number
}
```

値全体を含むイベント規則は基盤となるものです。状態を運ぶログイベントは、単なる差分ではなく変更後の完全な状態を保持します。これにより、すべての遷移は単純に低コストとなり、提供される各値は自己記述的になります（コンシューマーでは最後の値が優先されます）。

## スナップショットと変更フィード

```ts type-equiv
/**
 * One consistent read cut over every registered unit for one session.
 * `asOfSeq` is the shared watermark — the seq of the last event every value
 * reflects (`-1` for an empty log, mirroring `session/subscribed.lastSeq`).
 */
interface ProjectionSnapshot {
  /** Seq of the last event the values reflect; -1 for an empty log. */
  asOfSeq: number
  /** Whole current value per registered key. */
  values: Partial<SessionProjectionMap>
}
```

```ts type-equiv
/**
 * Change-feed listener: one unit's value changed for one session. `value` is
 * the schema-validated `view` output; `seq` is the unit's watermark at
 * emission (the seq of the event that caused the change).
 */
type ProjectionChangeListener = (
  session: Session,
  key: Extract<keyof SessionProjectionMap, string>,
  value: unknown,
  seq: number,
) => void
```

`snapshot(session)` は完全に同期的です。キャリアはページスライスと同じティックでこれを読み取るため、`asOfSeq` は両方の読み取りを同じシーケンス番号でカバーします。各値は返却前にそのユニットのスキーマを通過します。誤って非同期化された `view` は Promise を返し、スキーマ検証で拒否されます。変更フィードは、コミットされたイベントごとに状態の *参照* が変更された各ユニットに対して一度発火します。`apply` は、状態が変化していない場合に同じ参照を返す必要があります。

## レジストリ: `ctx.sessionProjections`

`SessionProjectionRegistry`（[シグネチャ](#ctxsessionprojections--sessionprojectionregistry)）が駆動を担います。1 つの `session/event` 購読、登録済みのすべてのユニットに対する即時の `apply`、およびセッションごと・ユニットごとのウォーターマークセルです。セルは遅延構築されます。イベントの流入後に登録されたユニット、またはレジストリより古いセッションは、初回アクセス時（イベントまたは読み取り時）にインメモリログ全体へ `init` を適用して畳み込みます。登録は呼び出し元のファイバーにディスポーザーが紐付くエフェクトです。アンロードされたドメインプラグインのキー（キャッシュ済みセルを含む）は、以後の駆動とスナップショットから消え、クライアントはこれを機能の不在として読み取ります。重複キーは例外を送出します。レジストリのないヘッドレス構成に影響しないよう、ドメインプラグインは `ctx.inject(['sessionProjections'], …)` の下で登録します。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts` によりソースから生成されます（doc-sync では `pnpm run verify-cordis-catalog` により最新性を検証し、`pnpm run gen-cordis-catalog` で再生成します）。このセクションはページの両言語版でバイト単位で同一です。シグネチャブロックは `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義され、フレームワークから継承される `ctx` API は [cordis-api/inherited.md](../cordis-api/inherited.md) にあります。

<a id="ctxsessionprojectioncache--sessionprojectioncache"></a>

### `ctx.sessionProjectionCache` — `SessionProjectionCache`

永続化されたプロジェクションキャッシュサービスです。初期化時に `session_projcache` ドメインを開き、Config の回数・間隔トリガーに基づくスロットル付きライトビハインドに加え、2 つの必須ポイント、すなわち `turn/end` とセッション破棄（ライブからコールドへの瞬間）でライブセッションをチェックポイントします。そして、キャッシュ行、永続層の `readFrom` 末尾、レジストリの `restore`、耐久性のあるライトバックというコールドリードの階段を提供します。すべての耐久性のある書き込みは失敗を許容します。失敗時は警告をログに記録し、次の書き込みまたはコールドリードでキャッシュが自己修復します。

```ts cordis-catalog
/**
 * The zero-I/O listing read: whole values viewed straight from the stored
 * rows (version-matching keys only), each cut carried with its watermark
 * so a client value store can seed under its higher-seq-wins rule — as
 * stale as the last durable checkpoint but never wrong, and never from an
 * unrelated log (the caller's header is the identity witness). Fresher
 * paths (the history tail baseline, {@link coldSnapshot}) supersede these
 * values whenever a session is actually opened.
 * @param meta - the listed session's header (identity witness; no log read).
 * @returns the cut (`asOfSeq` = lowest served-row watermark), or
 *   `undefined` when no usable row exists for this lifecycle.
 */
cachedSnapshot(meta: SessionHeader): ProjectionSnapshot | undefined

/**
 * Durably checkpoint one live session NOW (both mandatory points call
 * this; tests and carriers may too). The registry cut is snapshotted at
 * this boundary (states are live references), then the whole record is
 * replaced. NOT fail-soft — callers on the fail-soft paths contain it.
 * @param session - the live session to checkpoint.
 * @returns resolution after durability and event emission.
 */
async write(session: Session): Promise<void>

/**
 * Cold-read one persisted session's projections with zero full-log load:
 * cached rows + a persistence `readFrom` tail from the registry's restore
 * floor, refolded by the registry and written back (fail-soft) so the next
 * cold read starts closer. A cache row invalidated by a shrunk log
 * (crash-repair truncation) triggers one full re-read from seq 0 — the
 * ladder's slow rung, still no crash. Rejects when the session has no
 * persisted log (`not found` from the persistence seam).
 * @param id - the persisted session to read.
 * @param signal - optional cancellation for the persistence reads.
 * @returns the snapshot cut at the stored log end.
 */
async coldSnapshot(id: SessionId, signal?: AbortSignal): Promise<ProjectionSnapshot>
```

型: [Session](session.md) · [SessionHeader](persistence.md) · [SessionId](core.md)

ソース: [`packages/session/session-projection-cache/src/index.ts:71`](../../packages/session/session-projection-cache/src/index.ts)

<a id="ctxsessionprojections--sessionprojectionregistry"></a>

### `ctx.sessionProjections` — `SessionProjectionRegistry`

`ctx.sessionProjections`: プロジェクションユニットのテーブルとその駆動です。サービスは `session/event` を一度だけサブスクライブします。コミットされたすべてのイベントは、登録済みの各ユニットの `apply` を通過し（eager drive）、状態参照が変更されると、スキーマ検証済みビューで変更フィードに通知されます。セルは遅延構築されます。イベントの到着後に登録されたユニット、またはレジストリより古いセッションでは、最初のアクセス時（イベントまたは読み取り）に、インメモリログに対して `init` を畳み込みます。登録はエフェクトです（disposer は呼び出し側のファイバーに紐付きます）。アンロードされたドメインプラグインのキーはスナップショットから消え、クライアントはそれを機能が存在しないものとして読み取ります。ドメインプラグインは `ctx.inject(['sessionProjections'], …)` の下に登録するため、レジストリを持たないヘッドレスアセンブリには影響しません。キーを共有する登録者は1つのユニットを共有し、数え上げられます。同じツールパッケージが N 個のエージェントプリセットにマウントされると N 回登録され、最後の1つがアンロードされるまでキーは存続します。

```ts cordis-catalog
/**
 * Register one domain's unit. The registration is an effect on the calling
 * context's fiber: disposing the fiber (or calling the returned disposer)
 * removes the key — and the unit's cached cells — from subsequent drives
 * and snapshots.
 * @param definition - key, state schema, pure unit functions, and stateVersion.
 * @returns the exact disposer that unregisters this unit.
 */
register<K extends keyof SessionProjectionMap, S>(definition: ProjectionDefinition<K, S>): () => void

/**
 * Subscribe to the change feed. The registration is an effect on the
 * calling context's fiber.
 * @param listener - called once per unit whose state reference changed, per committed event.
 * @returns the exact disposer that unsubscribes.
 */
onChanged(listener: ProjectionChangeListener): () => void

/**
 * One consistent cut over every registered unit for one session, read from
 * the watermark cache (missing cells fold lazily over the in-memory log).
 * Fully synchronous — every value and `asOfSeq` reflect the same log
 * position. Each value passes its unit's schema before leaving.
 * @param session - the session whose projection values are read.
 * @returns the snapshot; `values` is empty when no unit is registered.
 */
snapshot(session: Session): ProjectionSnapshot

/**
 * State-level checkpoint of every registered unit for one session, read
 * from the watermark cache (missing cells fold lazily over the in-memory
 * log). This is the write side of the persisted projection cache: the
 * returned rows are the `(key → {ver, seq, val})` part of the durable
 * `(sessionId, key, ver, seq, val)`
 * rows. Every `val` is a DETACHED structured clone — never the live
 * cell reference: the watermark cache is this registry's authoritative
 * mutable state, and a caller reaching the live reference could corrupt
 * every subsequent snapshot and frame through it (plain JSON by the unit
 * contract, so the clone is total).
 * @param session - the session whose unit states are checkpointed.
 * @returns one row per registered key; empty when no unit is registered.
 */
checkpoint(session: Session): ProjectionCheckpoint

/**
 * The stored seq a {@link restore} tail read over `checkpoint` must start
 * at: one event BELOW the lowest usable watermark (a row is usable when
 * its `ver` matches the live unit's `stateVersion`; an absent or mismatched row
 * pulls the floor to `0` — that key must refold the full log). The
 * one-below anchor is load-bearing: the tail then proves how far the
 * stored log still extends, so {@link restore} can detect a log that
 * shrank below a row's watermark (crash-repair truncation) instead of
 * serving the stale row as current — an empty tail read from the anchor
 * yields an end below every watermark and the restore rejects for a full
 * re-read.
 * @param checkpoint - persisted rows for one session (possibly stale or empty).
 * @returns the seq to hand the persistence `readFrom`, or `undefined`
 *   when no unit is registered (no read needed — {@link restore} would
 *   serve empty values regardless).
 */
restoreFloor(checkpoint: ProjectionCheckpoint): number | undefined

/**
 * View a checkpoint's rows without any log read: for every registered
 * unit whose row's `ver` matches, serve the schema-validated
 * `view` of the stored state; mismatched or absent rows leave their key
 * absent (a cold or listing consumer treats it as not-yet-available and a
 * fuller read path refolds it). The zero-I/O rung of the read ladder —
 * values are as stale as their rows, never wrong.
 * @param checkpoint - persisted rows for one session (possibly stale or empty).
 * @returns whole values per key with a usable row; empty when none.
 */
viewCheckpoint(checkpoint: ProjectionCheckpoint): Partial<SessionProjectionMap>

/**
 * Cold read: fold every registered unit over a stored log suffix, seeding
 * each from its checkpoint row when usable — the one read recipe (cached
 * state + forward tail replay + `view`) applied without a live `Session`.
 * Call with the events returned by a persistence
 * `readFrom(id, restoreFloor(checkpoint))` and that same floor as
 * `baseSeq`; the floor's one-below anchor makes the supplied end honest,
 * so a shrunk log is detected here. A row is usable iff its
 * `ver` matches the live unit's `stateVersion`, it does not predate `baseSeq`
 * (`seq >= baseSeq - 1`), and it does not claim events past the
 * supplied end (`seq <= endSeq`); an unusable row is discarded
 * and its key refolds from `init` — which is only sound over the full
 * log, so a discarded row with `baseSeq > 0` throws (the caller re-reads
 * from seq 0, e.g. after a crash-repair truncation shrank the log below
 * a row's watermark).
 * @param checkpoint - persisted rows for one session (possibly stale or empty).
 * @param events - the stored events with `seq >= baseSeq`, in seq order.
 * @param baseSeq - the seq `events` starts at (its first event's seq when non-empty).
 * @returns the snapshot cut at the supplied log end (`asOfSeq` is the last
 *   supplied event's seq, `baseSeq - 1` for an empty tail) plus the
 *   refreshed checkpoint rows at that cut, ready for a durable write-back.
 */
restore(checkpoint: ProjectionCheckpoint, events: readonly SessionEvent[], baseSeq: number): { snapshot: ProjectionSnapshot; checkpoint: ProjectionCheckpoint }
```

型: [Session](session.md) · [SessionEvent](session.md)

ソース: [`packages/session/session-projection/src/index.ts:171`](../../packages/session/session-projection/src/index.ts)
<!-- END GENERATED cordis-surface -->
