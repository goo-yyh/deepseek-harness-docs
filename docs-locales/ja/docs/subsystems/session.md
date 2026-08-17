# セッション

[dsh-session](../../packages/core/session)のインメモリでイベントソース型のモデルです。`Session` は、型付き`SessionEvent`の**追記専用ログ** であり、エージェントの全対話履歴における唯一の信頼できる情報源です。LLM のメッセージ履歴はログから*導出され* 、別途保存されることはありません。リプレイは同じイベントからの再導出です。ログを**永続化する** 方法（永続化の境界、バックエンド、クラッシュリカバリ）は、[persistence.md](persistence.md)で扱う関連する関心事です。

ソース： [`packages/core/session/src/types.ts`](../../packages/core/session/src/types.ts)

## `SessionEventMap` — イベントの語彙

追記専用イベントの型です。マージによる拡張が可能です。プラグインは宣言マージによって追加のイベント型を宣言します。たとえば、[コンパクションの境界](compaction.md)は `compaction/start` / `compaction/summary` / `compaction/end` を追加し、`@deepseek-ai/dsh-hook-protocol` はフックブリッジ用にログ専用の `hook/invoked` / `hook/result` レコードを追加します。`compaction/*` と同様に、これらは `SurfaceEventType` ではありません（`surfaceOp` はありません）。生成される[永続化ログイベントカタログ](../persistence-catalog.md)には、コアおよびマージされたすべてのメンバーが、そのペイロード、サーフェスバッジ、宣言箇所とともに列挙されます。

```ts type-equiv
/** A user-role specialization of the one shared message representation. */
interface UserMessage extends Message {
  readonly role: 'user'
}
```

```ts type-equiv
/**
 * The merge-extensible, append-only source of truth for an agent interaction.
 * Message history is derived from this log. Every event is lossless JSON and
 * sequence numbers stay contiguous, including raw chunks, so persistence can
 * store the canonical log verbatim.
 */
interface SessionEventMap {
  /**
   * Opens turn `turn` before the loop claims queued input or runs pre-step.
   * Rejection, empty input, cancellation, or failure may close it with no
   * step; otherwise the following identified `user/message` event or batch
   * records the messages entering the step.
   */
  'turn/start': { turn: number }
  /**
   * Closes turn `turn` with the {@link TurnEndReason} that ended it. A turn
   * with no entered step has no `step/start` or `step/end`. The loop does not await a
   * flush at turn boundaries: `dsh-session-checkpoint-policy` owns the
   * per-request durability checkpoint, and consumers that read storage after
   * `whenIdle()` flush themselves. Success commits the turn; rejection is
   * reported live and does not prevent later work.
   */
  'turn/end': { turn: number; reason: TurnEndReason }
  /** Opens step `step` of turn `turn` — one model call plus the tool executions it requested. */
  'step/start': { turn: number; step: number }
  /** Closes step `step` of turn `turn`. */
  'step/end': { turn: number; step: number }
  /**
   * A user-role message on the model-visible surface: a direct human prompt
   * (the queued message claimed for this turn), a synthetic `agent.inject()`
   * context (file-change notices, subdir AGENTS.md, skill content, cron
   * notifications, …), or an entered goal continuation round. All three
   * project their `content` verbatim; `source` tells them apart.
   */
  'user/message': UserMessage
  /** Raw stream chunk — token-level replay fidelity. */
  'assistant/chunk': { turn: number; step: number; chunk: StreamChunk }
  /**
   * Assembled assistant message for one step (derived history uses this).
   * Carries the step's `usage` when the adapter reported token accounting, so
   * the model output and its accounting travel together (there is no separate
   * usage record). `usage` is absent when the adapter reported none.
   */
  'assistant/message': { turn: number; step: number; message: AssistantMessage; usage?: TokenUsage }
  /**
   * The model requested one tool invocation: `name` with the raw `arguments`
   * JSON string exactly as the model produced it (unparsed). `callId` pairs the
   * call with its `tool/result`.
   */
  'tool/call': { turn: number; step: number; callId: CallId; name: string; arguments: string }
  /**
   * A completed tool call's model-facing result, optional internal failure
   * identity, and optional tool-private `meta` presentation payload. `meta` is
   * opaque to the core (the producing tool owns its shape and reads it back in
   * `presentResult`) but MUST be JSON-serializable: `Session.append`
   * runtime-validates all event data with `isJsonValue`, so a non-serializable
   * `meta` is rejected at the source, and the durable log reproduces the
   * identical card on replay. Absent
   * unless the tool attaches one (e.g. `dsh-tool-fs` carries its result-time
   * contextual diff here).
   */
  'tool/result': {
    turn: number
    step: number
    message: ToolResultMessage
    error?: { name: string; code: string }
    meta?: JsonValue
  }
  /** Whole-list snapshot; latest write wins on replay. Log-only UI state; never derived history. */
  'todo/write': { todos: TodoItem[] }
  /**
   * Full header for the next request, appended inside its step before dispatch.
   * It is log-only; the latest snapshot reconstructs the request header.
   */
  'request/header': { header: EpochHeader; reason: RequestHeaderReason }
  /**
   * Route metadata for the next request, logged only when the route or capacity
   * changes. It does not participate in request reconstruction or header equality.
   */
  'request/context': RequestContext
  /**
   * Marks the end of a constructor seed. Events before it have smaller seq
   * values and came from the seed (resume, fork, or replay); this lifecycle
   * produced none of them. This log-only event is the durable projection of
   * {@link Session.firstLiveSeq}. Its payload is empty — position and `time`
   * carry the meaning.
   *
   * Locate the LAST one in stored history. A seed already ending in one is not
   * re-marked, so reopening an untouched session does not grow its log per
   * pickup and the event need not be at the current `firstLiveSeq`.
   *
   * `Session`'s constructor is the only legitimate writer. The invariant
   * companion deliberately constrains nothing here, so a plugin appending one
   * would silently classify every live bracket before it as seed history.
   *
   * An owner of a standalone open/close bracket (`compaction/start` …
   * `compaction/end`) reads it because seed history and live work are otherwise
   * byte-identical: an unmatched opening marker before this event belongs to
   * an ended lifecycle, whatever ended it. NOT a liveness signal about other
   * writers — a concurrently live session holds its own boundary elsewhere,
   * so tolerating concurrent writers needs a signal beyond the log.
   */
  'session/end-seed': Record<string, never>
}
```

`UserMessage` は、通常のプロンプト、注入コンテキスト、ステアリング、ライブ受信トレイイベントで共有される、識別済みかつ固定されたユーザーロール値です。イベントラッパーはイベント固有の位置または結果の事実のみを追加し、アイテムが保留中である間、ループはドライバー所有のルーティング状態のみを追加します。

### `TodoItem` — todo リストの1項目

`todo/write` イベントのリスト全体スナップショットを構成する単位です。意図的に最小限で、`content` 行と3状態の `status`（id、優先度、`activeForm` はなし）のみです。リストは書き込みごとに完全に置き換えられるため、エントリに安定した識別子は必要ありません。[todo_write Agent Note](../../.agents/notes/implemented/feature/2026-06-29-todo-write-tool.md)を参照してください。

```ts type-equiv
/**
 * One entry in an agent's todo list — the unit of the `todo/write`
 * {@link SessionEventMap} event's whole-list snapshot.
 *
 * Deliberately minimal: a human-readable `content` line and a three-state
 * `status`. No id, priority, or `activeForm` — the list is replaced wholesale
 * on every write (last-write-wins), so entries need no stable identity. The
 * three statuses describe the complete portable lifecycle needed by model and
 * UI consumers.
 */
interface TodoItem {
  /** What this task is — a short imperative line shown in the UI. */
  content: string
  /** Lifecycle state. `in_progress` marks a task being worked now; parallel work may mark several. */
  status: 'pending' | 'in_progress' | 'completed'
}
```

<a id="the-request-header-event-requestheader"></a>

### リクエストヘッダーイベント: `request/header`

リクエストエンベロープ、すなわち `EpochHeader`（呼び出し設定、アダプター提供のデフォルト値を示すマーカー、レンダリングされたシステムプロンプト、組み立てられたツールスキーマ）は、記録されたセッション状態です。そのため、すべての会話リクエストはログの純粋関数になります（再構築可能性に関する Agent Note）。理由が `'initial'` または `'resume'` の完全な `request/header` スナップショットは、各ループインスタンス境界を記録します。その後に変更されたリクエストでは、理由 `'change'` により別の完全スナップショットが記録されます。`foldRequestHeader(events)` は最新のスナップショットを選択してヘッダーを再構築します。このイベントは `SurfaceEventType` ではありません。LLM メッセージは生成しません。

```ts type-equiv
/**
 * Logged request state outside derived history: call config, system prompt, and
 * tools. The latest full `request/header` snapshot reconstructs it; canonical
 * empty optional fields are absent.
 */
interface EpochHeader {
  /** The conversation's call configuration (provider, model, reasoning effort, and sampling scalars). */
  config: LlmCallConfig
  /** Effective config fields materialized from the exact adapter rather than proposed by a caller. */
  adapterDefaults?: LlmCallConfigAdapterDefaults
  /** Rendered system prompt text; absent for a system-less request. */
  system?: string
  /** Assembled tool schemas; absent for a tool-less request. */
  tools?: ToolSchema[]
}
```

正規形式では、空のシステムプロンプトまたはツールリストを、リクエストの構築方法に合わせて存在しないフィールドとして表現します。レガシー `request/header-delta` イベント、またはその完全スナップショットの `fallback` 理由を含むレガシー v0 ログは、不完全に再生するのではなく、シード、追記、永続化読み込みの境界で拒否されます。

### ルート容量イベント: `request/context`

リクエストが解決したルートのコンテキストメタデータは、独立した記録済み状態です。同じステップ内で `request/header` と並んで追記され、プロバイダー、モデル、または容量が前のレコードと異なる場合にのみ追加されます。これは `EpochHeader` の外に置かれます。なぜなら、この型は `headerEquals` がフィールド単位で比較する再構築契約だからです。容量はリクエスト入力ではなくルートを表すため、これを取り込むと容量変更がリクエストエンベロープの `change` として記録され、アダプターメタデータがループの再構築不変条件に入り込んでしまいます。`request/header` と同様に、これは `SurfaceEventType` ではなく、LLM メッセージを生成しません。`session.requestContext()` は最新レコードを増分的に畳み込みます。アダプターが容量を通知しないルートは、`contextWindow` を存在しない状態で記録するため、新しいレコードによって古いルートの容量がクリアされます。

```ts type-equiv
/** Registration-bound metadata for one resolved model route. */
interface RequestContext {
  /** Registered provider route the metadata belongs to. */
  provider: string
  /** Provider-owned model id the metadata belongs to. */
  model: string
  /** Maximum combined request and response context in tokens, when advertised. */
  contextWindow?: number
}
```

## `SessionEvent<T>` — 1 つのログエントリー

`type` による適切な判別共用体です（独立した `type`/`data` 共用体ではありません）。そのため、`switch (event.type)` はキャストなしで `event.data` を絞り込めます。`seq` はログ内の単調増加位置（`seq = log.length`）であり、`time` はエポックミリ秒です。

```ts type-equiv
/**
 * One immutable entry in the session log.
 *
 * A proper discriminated union over `type` (not independent `type`/`data`
 * unions), so `switch (event.type)` narrows `event.data` without casts.
 *
 * The {@link sourceEventSeqs} and {@link surfaceOp} fields are conditional:
 * they only exist on {@link SurfaceEventType} variants (`user/message`,
 * `assistant/message`, `tool/result`).
 * Non-surface events (boundary markers, chunks, usage, errors) never carry
 * surface metadata — the compiler enforces this at `Session.append()`
 * call sites.
 */
type SessionEvent<T extends SessionEventType = SessionEventType> = {
  [K in SessionEventType]: {
    type: K
    /** Monotonic sequence number within the session. */
    seq: number
    /** Unix epoch milliseconds. */
    time: number
    data: SessionEventMap[K]
    /**
     * Marks an event a reader may safely skip when it does not recognize
     * `type`. Absent means required: a reader meeting an unrecognized type
     * without this marker MUST refuse to reconstruct the session instead of
     * silently dropping the event, because an unrecognized required event may
     * change how the rest of the log is interpreted. A writer sets `true` only
     * on purely informational records whose loss cannot affect reconstruction;
     * defaulting to required means a forgotten marker over-refuses (an
     * inconvenience) rather than silently resuming a gutted session.
     */
    ignorable?: true
  } & (K extends SurfaceEventType ? {
    /**
     * Seq numbers of earlier events that this event cites as sources
     * (e.g. the `assistant/chunk` seqs that built an `assistant/message`,
     * or the surface nodes shadowed by a compaction replace node). An
     * `assistant/message` may carry a present empty array for a known empty
     * provider stream; when the field is absent, the event does not record which
     * earlier events produced the message.
     */
    sourceEventSeqs?: number[]
    /** How this event entered the surface; absent for non-surface events. */
    surfaceOp?: SurfaceOp
  } : object)
}[T]
```

`SessionEventType = keyof SessionEventMap`。`SessionEventMap` はマージ拡張可能であるため、`SessionEvent` に対する switch で `assertNever` を使用してはなりません。プラグインが追加したバリアントは有効な未知の値です。既知のケースを処理し、`default` へフォールスルーしてください。

`assistant/message` では、存在する `sourceEventSeqs: []` は完全な既知の空のプロバイダーストリームを意味します。一方、フィールドのないレガシーまたは外部イベントでは、どの以前のイベントがメッセージを生成したかは記録されません。ループは成功したすべてのモデル呼び出しにこのフィールドを書き込みます。他のすべてのサーフェスイベントでは、フィールドが存在する場合、空でないリストが必要です。

## サーフェス型

メッセージを生成する 3 つの型（`SurfaceEventType` — `user/message`、`assistant/message`、`tool/result`）には、順序付けられた派生サーフェスへの結合方法を宣言するサーフェスメタデータが含まれます。[セッションサーフェスに関する Agent Note](../../.agents/notes/implemented/architecture/2026-06-18-session-surface.md) を参照してください。

### `SurfaceEventType` — イベント型のうちメッセージを生成するサブセット

```ts type-equiv
/**
 * The subset of {@link SessionEventType} values whose events produce LLM
 * messages and are eligible to appear on the ordered surface. Only these
 * event types may carry {@link SurfaceOp} and {@link SessionEvent.sourceEventSeqs}.
 */
type SurfaceEventType =
  | 'user/message'
  | 'assistant/message'
  | 'tool/result'
```

### `SurfaceOp` — イベントがサーフェスに加わった方法

```ts type-equiv
/**
 * How a session event entered the ordered surface. Only valid on
 * {@link SurfaceEventType} events.
 *
 * - `'append'`: added to the tail — normal path for user/assistant/tool
 *   messages.
 * - `{ op: 'replace', start, end }`: replaces surface nodes from `start`
 *   (inclusive) through `end` (inclusive) with this node. Both must exist as
 *   surface nodes in the current surface. `start === end` replaces a single
 *   node. The node's {@link SessionEvent.sourceEventSeqs} must include every
 *   shadowed surface node. Used by compaction; any surface-replacing producer
 *   may use it.
 */
type SurfaceOp =
  | 'append'
  | { op: 'replace'; start: number; end: number }
```

`'append'` は通常の末尾追加パスです。`replace` は、`start` から `end` までを含む surface エントリを隠します（両方とも有効な surface seq である必要があります。`start === end` は単一のエントリを置き換えます）。その位置に新しいイベントを挿入します。

### `SurfaceIntent` — `session.append()` のパラメーター

```ts type-equiv
/**
 * Surface placement and cited source-event seqs for {@link Session.append}. Required on
 * message-producing events and forbidden on log-only events.
 */
interface SurfaceIntent {
  surfaceOp: SurfaceOp
  /**
   * Complete set of known source-event seqs. `assistant/message` may use a
   * present empty array for a known empty provider stream; when the field is
   * absent, the event does not record which earlier events produced the message.
   * Other surface events require a non-empty set when this field is present.
   */
  sourceEventSeqs?: number[]
}
```

`SurfaceEventType` イベントでは必須です。メッセージを生成するすべてのイベントは、派生モデル履歴の唯一のソースである surface にどのように結合するかを宣言する必要があります。人間向けのトランスクリプトはもう一方の投影であり、代わりにログの append-origin イベントを読み取ります。これは、surface が置換によって要約される範囲を意図的に隠すためです（[dsh-session](../../packages/core/session/README.md) の `isAppendSurfaceEvent`）。surface 以外の型では、コンパイル時に拒否されます。

現在空の `sourceEventSeqs` を持てるのは `assistant/message` だけです。フィールドが存在しない場合、イベントはどの以前のイベントがメッセージを生成したかを記録しません。プロバイダーはそれでもチャンクを出力している可能性があります。

### `SessionSurface` — ライブ読み取り専用 surface 投影

`Session.surface` は、セッションの安定した `SessionSurface` ビューを返します。同じ増分マネージャーはコミット前に追加候補を検証し、コミット済みイベントからこの投影を更新します。呼び出し元はメンバーシップと置換世代を確認できますが、検証を呼び出すことはできません。

代わりに、`SurfaceManager(log, baseSeq?)` は、最初のイベントが絶対シーケンス `baseSeq` を持つ連続した読み込み済みウィンドウを畳み込めます。すべてのイベントはこの絶対シーケンス空間で連続しており、宣言された範囲が存在しないため、ウィンドウ先頭をまたぐ置換は失敗します。

```ts type-equiv
/** Readonly live projection of the message-producing session events. */
interface SessionSurface {
  /** Current surface event sequences in model-visible order. */
  readonly nodes: readonly number[]
  /** Monotonic count of committed positional replacements. */
  readonly replaceGeneration: number
}
```

### `SurfaceFoldReplacement` と `SurfaceFoldResult` — 完全な surface リプレイ

`foldSurface(events)` は、分離された現在のイベントシーケンスと、宣言された各置換範囲によって実際に隠されたシーケンスを返します。ライブマネージャーは、置換履歴を保持せずに同じ遷移を使用します。コミット済みの置換ごとにその `replaceGeneration` が増加するため、増分コンシューマーは純粋な末尾の増加と書き換えを区別できます。

```ts type-equiv
/** One replacement operation observed while folding a session surface. */
interface SurfaceFoldReplacement {
  /** Seq of the event that replaced the prior surface range. */
  seq: number
  /** Declared inclusive start seq of the replaced surface range. */
  start: number
  /** Declared inclusive end seq of the replaced surface range. */
  end: number
  /** Actual surface entries removed by the operation, in surface order. */
  shadowedSeqs: number[]
}
```

```ts type-equiv
/** Complete result of replaying the surface operations in a session log. */
interface SurfaceFoldResult {
  /** Current surface event sequences in model-visible order. */
  nodes: number[]
  /** Replacement operations in event order. */
  replacements: SurfaceFoldReplacement[]
}
```

## `Session` パブリック API

本体を除去した宣言では、プレーンなクラスの分離ファクトリー、状態アクセサー、追加メソッド、履歴投影をソースと同期させています。ストア操作は、生成された [`ctx.sessions` セクション](#ctxsessions--sessionstore)に残ります。

```ts public-api
/**
 * An event-sourced session: an append-only log of {@link SessionEvent}s.
 *
 * Plain class (not a Service) — create live instances via
 * `ctx.sessions.create()` and detached instances via {@link create}.
 * Seeding with an existing event log replays/forks a session.
 * @typert object
 */
declare class Session {
  /** The ordered surface over this session's event log. */
  get surface(): SessionSurface;
  /**
   * Detached, deep-frozen creation metadata (format version, cwd, lineage,
   * seed boundary). Supplied by the store via `ctx.sessions.create()`. When a
   * `Session` is created without a store-owned header, a minimal header is
   * synthesized (stamped with the current {@link SESSION_FORMAT_VERSION}) so
   * `session.header` is always present. Kept out of the event log — it is a
   * storage concern, not replayable conversation state.
   */
  readonly header: SessionHeader;
  /** The session identity, derived from its durable header's single copy. */
  get id(): SessionId;
  /**
   * The first seq appended IN THIS PROCESS: the length of the constructor
   * seed (0 without one). Events with smaller seq values entered through
   * construction — replay, fork, or resume — and were never published on the
   * `session/event` firehose (constructor seeds do not emit), so consumers
   * that replay the log as a publication substitute (telemetry adoption)
   * start here. Distinct from `header.seedLength`, the DURABLE fork-lineage
   * boundary: a resumed session's constructor seed is its full stored log,
   * while its header keeps the original fork value — this field is the
   * in-process construction fact.
   *
   * Not persisted itself: a seeded session projects it into the log as the
   * `session/end-seed` event, which is what a consumer reading STORED history
   * reads. Locate the LAST such event, not necessarily one at this seq — a
   * seed already ending in one is not re-marked, so reopening an untouched
   * session leaves that event at a smaller seq than `firstLiveSeq`. Prefer
   * this field in-process: it is exact before the marker reaches storage.
   *
   * When this lifecycle appends the marker, it occupies this seq before the
   * store attaches and therefore does not publish either. Otherwise this seq
   * holds an ordinary published write.
   */
  readonly firstLiveSeq: number;
  /**
   * Create a detached session by validating and snapshotting borrowed seed
   * events and storage metadata.
   * @param id - session identity.
   * @param seed - optional borrowed replay or fork events.
   * @param header - optional borrowed storage metadata.
   * @returns a detached session.
   */
  static create(id: SessionId, seed?: readonly SessionEvent[], header?: SessionHeader): Session;
  /**
   * Restore a detached session by taking ownership of fresh persistence values.
   * The storage format, event envelopes, sequence continuity, surface transitions,
   * and header fields are validated before the restored objects are frozen.
   * @param id - restored session identity.
   * @param seed - fresh detached events whose ownership is transferred.
   * @param header - fresh detached metadata whose ownership is transferred.
   * @returns a restored detached session.
   */
  static fromRestore(id: SessionId, seed: readonly SessionEvent[], header: SessionHeader): Session;
  /**
   * An immutable snapshot of the append-only event log. The snapshot is reused
   * until the next append; a previously returned array does not grow later.
   * Events and their nested data are deep-frozen at acceptance, so neither a
   * cast nor ordinary JavaScript can rewrite durable history.
   */
  get events(): readonly SessionEvent[];
  /** The next event's sequence number — always the log length (the `seq = log.length` contiguity contract). */
  get seq(): number;
  /**
   * Append one typed event to the log and synchronously notify observers via
   * the store-owned, module-private publication hooks. The hot path never blocks
   * on I/O — persistence plugins buffer asynchronously. Once the event enters
   * the log, the append is committed: observer failures are logged and
   * contained per listener, so they do not change the return value or prevent
   * later listeners from observing the same accepted event.
   *
   * @param type - The event type (key of {@link SessionEventMap}).
   * @param data - The event payload; must be JSON-serializable.
   * @param opts - Surface metadata: `surfaceOp` controls how the event enters
   *   the ordered surface; `sourceEventSeqs` lists the seq numbers of earlier
   *   events this one derives from. REQUIRED for
   *   {@link SurfaceEventType} events (every message-producing event must
   *   declare how it joins the surface, the sole source of derived model
   *   history) and
   *   rejected by the compiler for non-surface types like `turn/start` or
   *   `assistant/chunk`.
   * @returns the logged event — its assigned `seq`/`time` plus the SNAPSHOT of
   *   `data` that entered the log, so reading `event.data` back sees the logged
   *   value, never the caller's still-mutable input.
   * @throws if `data` or surface metadata is not losslessly JSON-serializable
   *   (BigInt, function, symbol, undefined, negative zero, non-finite number,
   *   circular reference, sparse array, or an exotic object such as
   *   Map/Set/Date/class instance), or when the candidate violates the
   *   canonical surface contract (marker shape and eligibility, unique
   *   earlier source-event references, positional replacement validity, and complete
   *   shadowed-node coverage). One recursive pass reads, validates, and
   *   copies each nested value once, so a stateful getter cannot supply one value
   *   to validation and another to storage. The event log is the durable source
   *   of truth, so a bad event fails at the append site rather than later during
   *   a backend flush. A synchronous internal dispatch validation failure or an
   *   append reentered while this acceptance/publication boundary is open also
   *   rejects before the log changes.
   */
  append<T extends SessionEventType>(
    type: T,
    data: SessionEventMap[T],
    ...opts: T extends SurfaceEventType ? [opts: SurfaceIntent] : []
  ): SessionEvent<T>;
  /**
   * The {@link EpochHeader} in force after the log's last header event — the
   * header the NEXT request will be compared against — or undefined before
   * the first `request/header` snapshot. The live, incrementally-maintained
   * form of `foldRequestHeader(session.events)`: each header event is folded
   * once, when first seen, so a per-step read costs O(new events).
   * @returns the folded header, or undefined when no header event exists yet.
   */
  requestHeader(): EpochHeader | undefined;
  /**
   * Return the latest resolved route metadata, or `undefined` before the first
   * `request/context` event. Each event is folded once.
   * @returns the latest immutable route metadata.
   */
  requestContext(): RequestContext | undefined;
  /**
   * Derive the LLM message history by walking the ordered sequences of
   * message-producing events maintained by `surfaceOp` markers. The
   * surface is the single source of derived history: every message-producing
   * append records its `surfaceOp`, so a raw event with no marker (a chunk, a
   * turn boundary) is correctly absent, and a compaction `replace` deletes the
   * shadowed nodes from the derivation. The projection rules are
   * {@link deriveEventMessage}, folded per node.
   *
   * CACHED: each surface node is projected exactly once, when first seen — a
   * call costs O(new nodes), and a surface rewrite (a `replace`;
   * {@link SessionSurface.replaceGeneration}) rebuilds. The returned array is
   * a fresh snapshot per call (later appends never grow an array a caller
   * already holds); the `Message` objects in it are SHARED and **deep-frozen**.
   * Their content reuses the already frozen durable event data, so the cache
   * needs no second deep clone and consumers still cannot mutate the log.
   * @returns a fresh array of the shared, frozen derived history.
   */
  deriveMessages(): Message[];
  /**
   * Instance face of the pure per-node `deriveEventMessage` export from
   * `surface.ts`.
   * @param event - the event to project.
   * @returns the derived message, or null when the event produces none.
   */
  deriveEventMessage(event: SessionEvent): Message | null;
}
```

## 導出履歴: `deriveMessages()` と `deriveEventMessage()`

`Session.deriveMessages()` はイベントログを、モデルが参照する `Message[]` へ投影します。これはキャッシュされ（各サーフェスノードは最初に参照されたときに一度だけ投影され、サーフェスの書き換え時に再構築されます）、凍結されています（呼び出しごとに、共有されたディープフリーズ済みメッセージを含む新しい配列を作成するため、投影経由で記録済み履歴を変更することは表現できません）。`deriveEventMessage(event)` は、この畳み込みで適用されるノード単位の純粋関数です。外部の再構築機構と開発時の不変条件が、まったく同じルールでログプレフィックスを投影し、キャッシュと不一致にならないよう公開されています。投影ルールは次のとおりです。

- `user/message` → 正確な `content` を保持するユーザーメッセージ。任意のエンベロープはログ専用の表示メタデータとして残ります。
- `assistant/message` → 生成元のプロバイダーとモデル、および任意のアダプター専用リプレイ状態を含むアシスタントメッセージ。生の `assistant/chunk` イベントはリプレイ/UI データであり、導出時には**スキップされます** （組み立て済みメッセージが正です）。**コンテンツが空の** `assistant/message` もスキップされます。max-tokens ステップがコンテンツなしで中断された場合も、その使用量、プロバイダー、モデルを保持するために `assistant/message` は記録されますが、コンテンツのないアシスタントターンをプロバイダートランスクリプトに含めてはいけません。
- `tool/result` → `tool-result` ブロックを保持するユーザーメッセージ。
- `user/message`（注入されたコンテキスト、つまり非 `user` ソース）→ 時系列上の位置にその `content` をそのまま保持する user ロールメッセージ。型付きソースは生成元を示し、生成元固有のデータを保持します。

それ以外（`turn/*`、`step/*`、プラグイン所有の `llm/retry`）は構造的なものであり、メッセージには投影されません。トークン計算はステップごとの `assistant/chunk { type: 'usage' }` レコードを読み取り、使用量チャンクがない場合は `assistant/message.usage` をコミット済みステップのフォールバックとして扱います。失敗したモデルリクエスト試行にはアシスタントメッセージがないため、その使用量チャンクが永続的な計算記録になります。この未リリース形式には意図的に互換性の保証がないため、シード/ロード検証では、履歴データのルートを推測せず、プロバイダー/モデルを省略したリクエストヘッダーとアシスタントメッセージを拒否します。

## ライブセッションのフォーク API

`ctx.sessions.create(id, { seed, meta })` は低レベルのリプレイ/フォークプリミティブです。通常のライブセッションフォークでは、`SessionStore` が 1 つのポリシー API を公開します。

- `fork(source, boundary?, childSessionId?)` はライブの `Session` オブジェクトまたはライブの `SessionId` を受け取り、デフォルトで現在の最後のイベントとなる、包括的な `boundary` seq までのソースイベントを選択します。選択したプレフィックスがオープンターンの外側で終わることを要求したうえで、ディープクローンされたシードイベントと子メタデータ（`parentSession`、`seedLength`、継承された `cwd`）を持つライブ子セッションを作成します。

明示的な `boundary` により、呼び出し元は、ソースに新しいイベントまたはオープン中の現在ターンがある場合でも、以前の `turn/end` や後続のスタンドアロンなログ専用イベントを含む、任意の安定したターン間位置からフォークできます。API は、暗黙に切り詰めるのではなく、オープンターン内で終わるプレフィックスを拒否します。より広範な実行関係の健全性は、`fork()` に重複実装せず、既存の `dsh-invariants` プラグインと永続化修復パスで扱われます。`dsh-subagent-fork-in-process` は、ツール実行中の委譲が通常親ターンのオープン中に始まるため、完了済みプレフィックスの切り詰めを維持します。通常のセッション分岐では、要求する境界を明示する必要があります。

## ターンが終了した理由: `TurnEndReasonMap`

`turn/start` にはトリガーフィールドがありません。開始された `user/message` バッチは各ステップに入ったものを記録し、`llm/retry` はリクエストの復旧を記録します。アイドル注入は、起動する配信が後続の pre-step に到達するまで保留されたままです。ライブターンでは、ドライバーを停止した型付き [`AgentCancelCause`](core.md#the-agent-handle) を保持します。永続化では、呼び出し元を保存していないサポート対象の粗いキャンセルレコードをインポートする場合にのみ、追加の `{ kind: 'legacy' }` 原因を使用します。

```ts type-equiv
/** Durable cancellation cause, including imports whose original coarse record carried no cause. */
type TurnEndCancelCause = AgentCancelCause | { readonly kind: 'legacy' }
```

```ts type-equiv
/**
 * Why a turn ended. Merge-extensible sum type.
 */
interface TurnEndReasonMap {
  completed: { kind: 'completed' }
  /** A cancellation request interrupted the live turn. */
  aborted: { kind: 'aborted'; reason: TurnEndCancelCause }

  blocked: { kind: 'blocked' }
  /**
   * The turn failed. `error` is always a structured failure: the `LlmError`
   * facts verbatim, or `{ message: errorChain(error), code: 'UNKNOWN' }`
   * flattened from any other error.
   */
  error: { kind: 'error'; error: LlmFailure }
  /** At least one step reached its output-token ceiling, even if a plugin continued the turn. */
  'max-tokens': { kind: 'max-tokens' }
  /**
   * A persistence backend closed a crash-orphaned turn on reload. The loop never
   * emits this marker, and the events recorded before the crash remain intact.
   */
  interrupted: { kind: 'interrupted' }
}
```

`max-tokens` は、同名のモデル呼び出し `FinishReason` を反映します。ターン内に `max-tokens` ステップが 1 つでもあると、ターン全体は `completed` ではなく `max-tokens` で終了します（途中で打ち切られたという事実が後続の継続より優先されます）。これにより、コンシューマーは正常終了と切り詰められた終了を区別できます。キャンセルとエラーは引き続き別個の結果です。`interrupted` はループが発行しない唯一の理由であり、クラッシュ復旧によって合成されます（[persistence.md](persistence.md) を参照）。このマップはマージで拡張できます。

## 実行エンクロージャーとスタンドアロンイベント

ターンは、セッションログ全体ではなく、1 回のモデルループ実行を囲みます。AgentLoop は、ターン内で pre-step バッチに入る際にのみ、注入された `user/message` イベントを記録します。プラグイン所有のログ専用イベントは、`turn/end` と次の `turn/start` の間にも現れ、ターン番号を増やさずにイベント seq を消費することがあります。永続化は、連続して受理されたすべてのイベントを境界付きの永続バッチへ受け入れ、クラッシュ修復では本当にオープンな末尾ターンだけを閉じます。即時の永続化バリアが必要な生成元は、明示的に `ctx.sessions.flush(session)` を await します。

任意の `dsh-session/invariant` コンパニオンは、コアが所有する関係、すなわちターンとステップの番号付け、実行イベントのエンクロージャー、同一ステップにおけるツール呼び出し/結果のペアリングを強制します。マージで拡張可能なイベント関係は、それを宣言するプラグインに属するため、コアはターンがオープンしていないというだけで未知のイベントを拒否しません。[スタンドアロンイベントに関する決定](../../.agents/notes/implemented/simplification/2026-07-28-remove-synthetic-log-only-turns.md) を参照してください。

## 終了シード境界: `session/end-seed`

シード済みセッション（再開、フォーク、またはリプレイ）は、コンストラクターシードの直後に、このログ専用イベントを最初のライブ書き込みとして追加します。それより前のイベントはより小さい seq 値を持ち、シードに由来します。これは `firstLiveSeq` の永続的な投影です。このフィールドはオブジェクトを保持するコンシューマーに対して、このライフサイクルの書き込み開始位置を示します。一方、イベントは保存済みバイトだけを保持するコンシューマーに同じ問いへの答えを提供します。ペイロードは空であるため、位置と `time` が意味全体を担い、メッセージを生成しません。`Session` のコンストラクターだけが正当な書き込み元です。

明示的に指定された空のシードは、seq 0 に `session/end-seed` を書き込みます。これにより、空の再開済みセッションと新規セッションを区別できます。すでに `session/end-seed` で終わるシードには再度マークしないため、手を加えていないセッションを再オープンしても、取得のたびにログが増えることはありません。保存済み履歴では、`firstLiveSeq` に存在すると仮定せず、最後の `session/end-seed` を特定してください。作業なしの取得後、このイベントの seq は次のライフサイクルの `firstLiveSeq` より小さくなります。

これは、シード履歴とライブ作業がそうでなければバイト単位で同一になり、単独の開く/閉じるブラケットを所有するプラグインが機能しなくなるためです。つまり、対応しない `compaction/start` は、書き込み側がコンパクションの途中でクラッシュした場合でも、まさに現在コンパクション中の場合でも同じように見えます。`session/end-seed` より前の開始マーカーはコンストラクターのシードに由来し、それを終了させたものが何であっても（クラッシュ、後続プロセス、または実行中の親からのフォーク）、終了したライフサイクルに属します。そのため、所有者はこれを死んだものとして扱えます。これは、このセッションが継承したブラケットのみを対象とします *この* 。同じ履歴に対して開いたブラケットを保持する同時実行中のライブセッションには別の場所に独自の境界があるため、同時書き込みを許容するにはログ以外の生存シグナルが必要です。Core は境界を書き込みますが、そこからは何も読み取りません。ブラケットの語彙は所有プラグインに属するため、クラッシュ修復では turn/step/tool の境界を閉じ、`compaction/*` を閉じることはありません。

人間の活動に基づいて Session を並べるコンシューマーは、この境界を除外します。Session を取得することは作業ではないため、ログ末尾で並べると、開かれたすべての Session が先頭に浮上してしまいます。

## プラグイン提供のログ専用イベント

プラグインは追加の `SessionEventMap` 型を宣言マージできます。これらは **ログ専用**です。`SurfaceEventType` ではありません（`surfaceOp` を持たず、導出履歴にも何も寄与しません）。所有者が、それらが開いた実行ターンに属するか、ターン間に置けるかを決定し、関係性は自身の不変条件コンパニオンで強制します。生成された [永続化ログイベントカタログ](../persistence-catalog.md)には、すべての Core およびプラグイン提供イベントがペイロード、サーフェスバッジ、宣言場所とともに列挙されています。コンパクション境界の `compaction/*` セマンティクスについては、[compaction.md](compaction.md)で説明しています。

1 つのプラグイン所有ファミリー内の複数イベントが 1 つの Web Client Conversation Node を構成する場合、そのファミリー内のすべての開始、更新、結果、リソース、または中断イベントは、同じ安定したビジネス ID を持つか、そこから独立して導出されます。この要件は相関する Node ファミリーに適用され、すべての Session イベントに適用されるわけではありません。これにより、クライアントは隣接性から推測したり履歴を走査したりせずに、各イベントをグループ化できます。[Conversation Node クックブック](../cookbook/adding-a-conversation-node.md)を参照してください。

フックブリッジの `hook/invoked` / `hook/result` ペア（`@deepseek-ai/dsh-hook-protocol` からのもの）は、`handlerId` によって相関付けられます。`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、および `Stop` はループの開いたターン内で発火するため、それらの `hook/*` レコードは構造上ターンで囲まれます。`SessionStart` はターン 1 より前に実行されるため、`hook/*` レコードを取得しません。そのコンテキストは、起動する配信によってターンが開かれるまで inbox で保留されたままです（[フックブリッジの Agent Note](../../.agents/notes/implemented/feature/2026-06-30-hook-bridges.md)を参照してください）。

## 永続性の契約

永続化バックエンドが依存する内容は次のとおりです。永続ログは、**`assistant/chunk` を含めて** 、すべてのイベントを損失なく永続化します。`seq` は連続していなければならないため、チャンクを正規ログから除外することはできません。`load` が追加された正確なイベントを返す限り、バックエンドはイベントバッチに独自のストレージエンコーディングを選択できます（JSONL バックエンドのデフォルトのパック済みチャンク行もそのようなエンコーディングです。[persistence.md](persistence.md)を参照してください）。すべての `event.data` は JSON シリアライズ可能でなければなりません。`Session.append` はソースでこれを強制し（シリアライズ不可能なデータではスローします）、不正なイベントがログに入らないようにするため、`session.events` は常にバックエンドが永続化できる内容と一致します。シリアライズ不可能なデータを持つイベント型の追加、Core 実行のネスト破損、または所有者が宣言した関係の違反は、オンディスク形式に対する破壊的変更です。

この契約を利用するバックエンドは、[persistence.md](persistence.md)にあります。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts` によりソースから生成されます（doc-sync で `pnpm run verify-cordis-catalog` による最新性を検証し、`pnpm run gen-cordis-catalog` で再生成します）。このセクションはページの両言語版でバイト単位で同一です。シグネチャブロックには `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義されており、フレームワークから継承した `ctx` API は[cordis-api/inherited.md](../cordis-api/inherited.md)にあります。

<a id="ctxsessions--sessionstore"></a>

### `ctx.sessions` — `SessionStore`

インメモリ Session ストア（`ctx.sessions`）。

ここでは永続化を意図的に実装していません。永続化プラグインは `session/event` をサブスクライブし、`session/flush` / dispose でフラッシュします。

```ts cordis-catalog
/**
 * Create a session owned by the calling fiber: disposing that fiber stops
 * event notification and removes the session from the store. `options.seed`
 * populates the session with a copy of those events (replay/fork);
 * `options.meta` attaches creation metadata (validated absolute `cwd`, seed
 * and parent lineage, and delegation depth) as the immutable
 * {@link SessionHeader} (the store fills `version`/`id`/`createdAt`).
 *
 * For an agent whose session must be torn down IN ORDER with its loop (so the
 * loop's final events are published before the store attachment ends), do NOT use this
 * — fold the session lifecycle into the agent's own effect via
 * {@link prepare} + {@link enter} + {@link announce} (see
 * `dsh-agent-loop`'s creation transaction).
 *
 * @param id - the session id; omitted, the store mints `session-<n>`.
 * @param options - seed events and/or creation metadata for the header.
 * @returns the live session, already entered and announced.
 * @throws if a session with `id` already exists, metadata is not a plain
 *   lossless-JSON record with valid scalar fields, or `meta.cwd` is a
 *   non-absolute path (storage backends key directories off it).
 */
create(id?: SessionId, options?: CreateSessionOptions): Session

/**
 * Build a session WITHOUT entering it into the store — validate the id/cwd and
 * construct the {@link Session} (with its immutable {@link SessionHeader}).
 * Pairs with {@link enter} + {@link announce}: a caller that owns a composite
 * `ctx.effect` (the agent factory) folds the session lifecycle into that ONE
 * effect so a fiber unload tears the session + agent down as a single ORDERED
 * chain rather than as racing sibling effects — which would remove the publication hooks
 * before the driver's closing events commit, dropping them.
 *
 * @param id - the session id; omitted, the store mints `session-<n>`.
 * @param options - seed events and/or creation metadata for the header. With
 *   `seedSource: 'persistence'`, metadata and events must be fresh detached
 *   graphs whose ownership transfers to this call: they are validated and
 *   frozen in place through {@link Session.fromRestore}, so the caller must
 *   retain no mutable aliases.
 * @returns the constructed session, NOT yet in the store.
 * @throws if a session with `id` already exists, metadata is not a plain
 *   lossless-JSON record with valid scalar fields, or `meta.cwd` is a
 *   non-absolute path.
 */
prepare(id?: SessionId, options?: PrepareSessionOptions): Session

/**
 * Enter a {@link prepare}d session into the store: install the module-private
 * append publication hooks and add it to the store. Returns the DETACH
 * disposer (hooks + store removal). Does NOT emit `session/created` —
 * the caller yields this disposer inside its effect and THEN calls
 * {@link announce}, so a throwing `session/created` listener rolls the attach
 * back instead of leaking it.
 *
 * Re-checks the id for a duplicate: `prepare` and `enter` are public
 * cross-package primitives and a caller may interleave arbitrary work (or
 * another create) between them, so a stale prepared session must NOT overwrite
 * a live store entry of the same id — its detach disposer would later delete
 * the REAL session. The {@link create} convenience and the agent factory call
 * the two back-to-back so they never trip this, but the public API cannot
 * assume that.
 *
 * @param session - a {@link prepare}d session not yet in the store.
 * @returns the detach disposer (publication hooks + store removal). When called from
 *   a synchronous `session/created` listener, removal and disposal wait until
 *   that creation dispatch unwinds.
 * @throws if a session with this id is already in the store.
 */
enter(session: Session): () => void

/** Emit `session/created` exactly once for an {@link enter}ed session (with
 * the carrier {@link enter} captured). Separate from {@link enter} so the
 * caller can yield the detach disposer first (rollback safety — see
 * {@link enter}).
 * @param session - the entered session to announce to listeners.
 * @throws if the session is not live or its announcement already began,
 *   including a reentrant call from a creation listener. */
announce(session: Session): void

/**
 * Dispatch the awaited `session/flush` durability checkpoint for `session`,
 * with the carrier captured at {@link enter}. THE flush entry point: the
 * store owns the carrier, so callers (the checkpoint policy's per-request
 * barrier, goal-round-driver's idle checkpoint, teardown drains, and consumers
 * that flush themselves before reading storage) must come through here
 * rather than dispatch a raw `ctx.parallel('session/flush', …)` — one owner,
 * one spelling, and the scoped-dispatch invariant can pin it.
 * @param session - the session whose buffered events must reach durable storage.
 * @returns whether at least one durability listener participated, after every
 *   listener has settled successfully.
 * @throws the first registered listener failure after every listener settles.
 */
async flush(session: Session): Promise<boolean>

/**
 * Look up a live session.
 * @param id - the session id to look up.
 * @returns the session, or undefined when no live session has that id.
 */
get(id: SessionId): Session | undefined

/**
 * All live sessions, in creation order.
 * @returns a fresh array; mutating it does not affect the store.
 */
list(): Session[]

/**
 * Create a live child session from a stable prefix of a live source.
 * `boundary` is an inclusive source event seq; omitted means the source's
 * current last event. The selected slice may end with a between-turn event
 * but must not end inside an open turn.
 *
 * @param source - Live source session object or id.
 * @param boundary - Inclusive source event seq to fork through; omitted means
 *   the source's current last event, and omitted on an empty source forks an
 *   empty child.
 * @param childSessionId - Optional child session id; omitted delegates to
 *   `SessionStore`'s id policy.
 * @returns The created live child session.
 */
fork(source: SessionForkSource, boundary?: number, childSessionId?: SessionId): Session
```

型: [CreateSessionOptions](persistence.md) · [PrepareSessionOptions](persistence.md) · [SessionId](core.md)

ソース: [`packages/core/session/src/index.ts:792`](../../packages/core/session/src/index.ts)

<a id="session-events"></a>

### `session/*` イベント

<a id="sessioncreated--emit"></a>

#### `session/created` — emit

セッション公開時の作成通知です。同期的なスローは拒否し、対応する破棄とともにロールバックします。ディスパッチ中に要求されたデタッチは延期されます。返された Promise の rejection はログに記録されますが、この同期的な境界を遡って拒否することはできません。スコープでフィルタリングされたディスパッチ（`@deepseek-ai/dsh-scope`）では、agent スコープのリスナーは、その agent のコンテキストを介して開始されたセッションのみを受け取ります。

```ts cordis-catalog
/**
 * Creation announcement during session publication. A synchronous throw vetoes and rolls
 * back with a paired disposal; detach requested during dispatch is deferred.
 * A returned-promise rejection is logged but cannot retroactively veto this
 * synchronous boundary.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners
 * receive only sessions entered through that agent's context.
 * @param session - the session just entered and announced.
 * @dshScopeScan unsupported
 * @mode emit
 */
'session/created'(this: Scoped<Session>, session: Session): void
```

型: [Scoped](scope.md)

ソース: [`packages/core/session/src/index.ts:54`](../../packages/core/session/src/index.ts)

<a id="sessiondisposed--emit"></a>

#### `session/disposed` — emit

通知済みのセッションがストアから離れるときに、公開のロールバックを含めて一度だけ発行されます。ただし、作成通知が開始されなかったエントリでは発行されません。リスナーの失敗はログに記録され、封じ込められます。スコープでフィルタリングされたディスパッチ（`@deepseek-ai/dsh-scope`）は、所有者スコープを再利用します。

```ts cordis-catalog
/**
 * Emitted once when an announced session leaves the store, including
 * publication rollback, but never for an entry whose creation announcement
 * did not begin. Listener failures are logged and contained.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`) reuses the owner scope.
 * @param session - the session that is no longer live in the store.
 * @dshScopeScan unsupported
 * @mode emit
 */
'session/disposed'(this: Scoped<Session>, session: Session): void
```

型: [Scoped](scope.md)

ソース: [`packages/core/session/src/index.ts:64`](../../packages/core/session/src/index.ts)

<a id="sessionevent--emit"></a>

#### `session/event` — emit

コミット後に実行される、ファイアアンドフォーゲットの追記フィードです。リスナーのスナップショットはログの push 前に解決されますが、コールバックはその後に実行されます。オブザーバーの失敗はログに記録され、コミット済みの追記を失敗させることなく隔離されます。スコープでフィルタリングされたディスパッチ（`@deepseek-ai/dsh-scope`）では、エージェントスコープのリスナーは、そのエージェントのコンテキストを通じて開始されたセッションのイベントのみを受け取ります。

```ts cordis-catalog
/**
 * Post-commit, fire-and-forget append feed. The listener snapshot resolves
 * before the log push, but callbacks run after it; observer failures are
 * logged and contained without making the committed append fail.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners
 * receive only events from sessions entered through that agent's context.
 * @param session - the session whose log grew.
 * @param event - the appended event, exactly as recorded.
 * @dshScopeScan unsupported
 * @mode emit
 */
'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void
```

型: [Scoped](scope.md)

ソース: [`packages/core/session/src/index.ts:76`](../../packages/core/session/src/index.ts)

<a id="sessionflush--parallel"></a>

#### `session/flush` — parallel

待機される並列の永続性チェックポイントです。すべてのリスナーが実行され、呼び出し元はそれらすべてを待機します。ウォーターフォール方式の拒否はありません。スコープでフィルタリングされたディスパッチ（`@deepseek-ai/dsh-scope`）は、セッションの所有者スコープを再利用します。

```ts cordis-catalog
/**
 * Awaited parallel durability checkpoint: every listener runs and the
 * caller awaits all of them, with no waterfall veto. Scope-filtered dispatch
 * (`@deepseek-ai/dsh-scope`) reuses the session's owner scope.
 * @param session - the session whose buffered events must reach durable storage.
 * @dshScopeScan unsupported
 * @mode parallel
 */
'session/flush'(this: Scoped<Session>, session: Session): Promise<void> | void
```

型: [Scoped](scope.md)

ソース: [`packages/core/session/src/index.ts:85`](../../packages/core/session/src/index.ts)
<!-- END GENERATED cordis-surface -->
