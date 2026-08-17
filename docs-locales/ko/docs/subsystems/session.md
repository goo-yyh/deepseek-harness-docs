# 세션

[dsh-session](../../packages/core/session)의 메모리 내 이벤트 소싱 모델입니다. `Session`는 에이전트의 전체 상호작용 기록을 위한 단일 진실 공급원인, 타입이 지정된 `SessionEvent`의 **추가 전용 로그** 입니다. LLM 메시지 기록은 로그에서 *파생되며* , 별도로 저장되지 않습니다. 재생은 동일한 이벤트로부터 다시 파생하는 과정입니다. 로그를 **영속화하는 방법** (영속성 추상 경계, 백엔드, 충돌 복구)은 [persistence.md](persistence.md)에서 다루는 관련 관심사입니다.

출처: [`packages/core/session/src/types.ts`](../../packages/core/session/src/types.ts)

## `SessionEventMap` — 이벤트 어휘

추가 전용 이벤트 타입입니다. 병합 확장이 가능합니다. 플러그인은 선언 병합을 통해 추가 이벤트 타입을 선언합니다. 예를 들어 [압축 추상 경계](compaction.md)는 `compaction/start` / `compaction/summary` / `compaction/end`를 추가하며, `@deepseek-ai/dsh-hook-protocol`는 훅 브리지를 위해 로그 전용 `hook/invoked` / `hook/result` 레코드를 추가합니다. `compaction/*`와 마찬가지로, 이들은 `SurfaceEventType`가 아닙니다(`surfaceOp` 없음). 생성된 [영속성 로그 이벤트 카탈로그](../persistence-catalog.md)에는 코어와 병합된 모든 멤버가 페이로드, 표면 배지, 선언 위치와 함께 나열됩니다.

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

`UserMessage`는 일반 프롬프트, 주입된 컨텍스트, 조정 및 라이브 받은편지함 이벤트가 공유하는 식별되고 고정된 사용자 역할 값입니다. 이벤트 래퍼는 이벤트 로컬의 위치 또는 결과 사실만 추가합니다. 항목이 보류 상태인 동안 루프는 드라이버가 소유한 라우팅 상태만 추가합니다.

### `TodoItem` — 할 일 목록 항목 하나

`todo/write` 이벤트의 전체 목록 스냅샷을 구성하는 단위입니다. 의도적으로 최소화되어 있습니다. `content` 줄과 세 가지 상태의 `status`만 있으며(id, 우선순위 또는 `activeForm` 없음), 매번 쓰기 시 목록 전체가 교체되므로 항목에는 안정적인 식별자가 필요하지 않습니다. [todo_write 에이전트 노트](../../.agents/notes/implemented/feature/2026-06-29-todo-write-tool.md)를 참조하세요.

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

### 요청 헤더 이벤트: `request/header`

요청 엔벌로프, 즉 `EpochHeader`(호출 설정 + 어댑터 제공 기본값의 마커 + 렌더링된 시스템 프롬프트 + 구성된 도구 스키마)는 기록된 세션 상태이므로, 모든 대화 요청은 로그의 순수 함수입니다(재구성 가능성 Agent Note). `'initial'` 또는 `'resume'` 이유를 포함하는 전체 `request/header` 스냅샷은 각 루프 인스턴스 경계를 기록하며, 이후 변경된 요청은 `'change'` 이유를 포함하는 또 다른 전체 스냅샷을 기록합니다. `foldRequestHeader(events)`은 최신 스냅샷을 선택하여 헤더를 재구성합니다. 이 이벤트는 `SurfaceEventType`가 아니며 LLM 메시지를 생성하지 않습니다.

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

정규 형식은 요청이 구성되는 방식에 맞춰 빈 시스템 프롬프트나 도구 목록을 없는 필드로 표현합니다. 레거시 `request/header-delta` 이벤트 또는 전체 스냅샷 `fallback` 이유를 포함하는 레거시 v0 로그는 불완전하게 재생하는 대신 시드, 추가, 영속성 로드 경계에서 거부됩니다.

### 라우트 용량 이벤트: `request/context`

요청이 확인된 라우트의 컨텍스트 메타데이터는 별도로 기록되는 상태이며, 동일한 단계에서 `request/header` 옆에 추가되고 제공자, 모델 또는 용량이 이전 레코드와 다를 때만 추가됩니다. 용량은 라우트를 설명할 뿐 요청 입력이 아니므로, `headerEquals`이 필드별로 비교하는 재구성 계약인 해당 타입에 포함하면 용량 변경이 요청 엔벌로프 `change`로 등록되고 어댑터 메타데이터가 루프의 재구성 불변 조건으로 유입되기 때문에, 이는 `EpochHeader` 외부에 유지됩니다. `request/header`과 마찬가지로 이것은 `SurfaceEventType`가 아니며 LLM 메시지를 생성하지 않습니다. `session.requestContext()`은 최신 레코드를 점진적으로 접습니다. 어댑터가 용량을 알리지 않는 라우트는 `contextWindow`이 없는 상태로 기록되므로, 새 레코드가 이전 라우트의 용량을 지웁니다.

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

## `SessionEvent<T>` — 하나의 로그 항목

`type`에 대한 적절한 판별 유니온입니다(독립적인 `type`/`data` 유니온이 아님). 따라서 `switch (event.type)`은 캐스트 없이 `event.data`을 좁힙니다. `seq`은 로그의 단조 위치(`seq = log.length`)이고, `time`은 epoch ms입니다.

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

`SessionEventType = keyof SessionEventMap`. `SessionEventMap`은 병합 확장 가능하므로 `SessionEvent`에 대한 switch는 `assertNever`을 사용해서는 안 됩니다. 플러그인이 추가한 변형은 유효한 알 수 없는 값이므로 알려진 경우를 처리하고 `default`으로 폴스루해야 합니다.

`assistant/message`의 경우, 존재하는 `sourceEventSeqs: []`은 완전하고 알려진 빈 제공자 스트림인 반면 필드가 없는 레거시 또는 외부 이벤트는 어떤 이전 이벤트가 메시지를 생성했는지 기록하지 않습니다. 루프는 성공한 모든 모델 호출에 대해 이 필드를 기록하며, 그 밖의 모든 표면 이벤트는 필드가 존재할 때 비어 있지 않은 목록을 요구합니다.

## 표면 타입

메시지를 생성하는 세 가지 타입(`SurfaceEventType` — `user/message`, `assistant/message`, `tool/result`)은 정렬된 파생 표면에 결합되는 방식을 선언하는 표면 메타데이터를 가집니다. [세션 표면 Agent Note](../../.agents/notes/implemented/architecture/2026-06-18-session-surface.md)를 참조하세요.

### `SurfaceEventType` — 이벤트 타입 중 메시지를 생성하는 하위 집합

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

### `SurfaceOp` — 이벤트가 표면에 들어온 방식

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

`'append'`는 일반적인 끝 추가 경로입니다. `replace`는 `start`부터 `end`까지의 surface 항목을 가립니다(둘 다 유효한 surface seq여야 하며, `start === end`는 단일 항목을 대체합니다). 그리고 그 자리에 새 이벤트를 삽입합니다.

### `SurfaceIntent` — `session.append()`의 매개변수

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

`SurfaceEventType` 이벤트에 필요합니다. 모든 메시지 생성 이벤트는 파생 모델 기록의 유일한 소스인 surface에 참여하는 방식을 선언해야 합니다. 사람이 읽는 트랜스크립트는 다른 프로젝션이며, replacement가 요약하는 범위를 surface가 의도적으로 가리므로 대신 로그의 append-origin 이벤트를 읽습니다([dsh-session](../../packages/core/session/README.md)의 `isAppendSurfaceEvent`). surface가 아닌 타입에서는 컴파일 시 이를 거부합니다.

현재 비어 있는 `sourceEventSeqs`를 포함할 수 있는 것은 `assistant/message`뿐입니다. 필드가 없으면 이벤트는 어떤 이전 이벤트가 메시지를 생성했는지 기록하지 않으며, provider는 여전히 청크를 내보냈을 수 있습니다.

### `SessionSurface` — 라이브 읽기 전용 surface 프로젝션

`Session.surface`는 세션의 안정적인 `SessionSurface` 뷰를 반환합니다. 동일한 증분 관리자는 커밋 전에 추가 후보를 검증하고 커밋된 이벤트에서 이 프로젝션을 전진시킵니다. 호출자는 멤버십과 대체 세대를 관찰할 수 있지만 검증을 호출할 수는 없습니다.

대신 `SurfaceManager(log, baseSeq?)`는 첫 번째 이벤트의 절대 시퀀스가 `baseSeq`인 연속된 로드 창을 폴드할 수 있습니다. 모든 이벤트는 해당 절대 시퀀스 공간에서 연속성을 유지하며, 선언된 범위가 없으므로 창의 시작을 가로지르는 대체는 실패합니다.

```ts type-equiv
/** Readonly live projection of the message-producing session events. */
interface SessionSurface {
  /** Current surface event sequences in model-visible order. */
  readonly nodes: readonly number[]
  /** Monotonic count of committed positional replacements. */
  readonly replaceGeneration: number
}
```

### `SurfaceFoldReplacement` 및 `SurfaceFoldResult` — 완전한 surface 재생

`foldSurface(events)`는 분리된 현재 이벤트 시퀀스와 선언된 각 대체 범위가 실제로 가린 시퀀스를 함께 반환합니다. 라이브 관리자는 대체 기록을 보관하지 않고 동일한 전환을 사용합니다. 커밋된 대체마다 `replaceGeneration`가 증가하므로 증분 소비자는 순수한 끝 확장과 재작성을 구분할 수 있습니다.

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

## `Session` 공개 API

본문을 제거한 선언은 일반 클래스의 분리된 팩토리, 상태 접근자, 추가 메서드, 기록 프로젝션을 소스와 동기화된 상태로 유지합니다. 저장소 작업은 생성된 [`ctx.sessions` 섹션에 남아 있습니다](#ctxsessions--sessionstore).

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

## 파생 히스토리: `deriveMessages()` 및 `deriveEventMessage()`

`Session.deriveMessages()`는 이벤트 로그를 모델이 보는 `Message[]`로 프로젝션합니다. 이 프로젝션은 캐시되며(각 표면 노드는 처음 확인될 때 한 번만 프로젝션되고, 표면을 다시 작성하면 재구성됨) 고정됩니다(호출마다 공유되고 깊이 고정된 메시지 위에 새 배열을 생성하므로, 프로젝션을 통해 기록된 히스토리를 변경하는 것은 표현할 수 없음). `deriveEventMessage(event)`는 폴드가 적용하는 노드별 순수 함수입니다. 외부 재구성기와 개발 불변성 검사가 정확히 같은 규칙으로 로그 접두사를 프로젝션하여 캐시와 불일치할 수 없도록 공개되어 있습니다. 프로젝션 규칙은 다음과 같습니다.

- `user/message` → 정확한 `content`를 담은 사용자 메시지입니다. 선택적 엔벌로프는 로그 전용 표시 메타데이터로 유지됩니다.
- `assistant/message` → 이를 생성한 provider와 model, 그리고 선택적 어댑터 비공개 재생 상태가 포함된 어시스턴트 메시지입니다. 원시 `assistant/chunk` 이벤트는 재생/UI 데이터이므로 파생 과정에서 **건너뜁니다** (조립된 메시지가 권위 있음). **콘텐츠가 비어 있는** `assistant/message`도 건너뜁니다. max-tokens 단계가 콘텐츠 없이 중단된 경우에도 사용량, provider, model을 보관하기 위한 `assistant/message`는 기록되지만, 콘텐츠가 없는 어시스턴트 턴은 provider 트랜스크립트에 들어가서는 안 됩니다.
- `tool/result` → `tool-result` 블록을 담은 사용자 메시지입니다.
- `user/message`(주입된 컨텍스트, 즉 `user`이 아닌 소스) → 시간순 위치에서 해당 `content`를 그대로 담은 사용자 역할 메시지입니다. 형식화된 소스는 생산자를 명명하고 생산자별 데이터를 보관합니다.

그 밖의 모든 항목(`turn/*`, `step/*`, 플러그인 소유 `llm/retry`)은 구조적이며 메시지로 프로젝션되지 않습니다. 토큰 집계는 단계별 `assistant/chunk { type: 'usage' }` 레코드를 읽고, 사용량 청크가 없을 때 `assistant/message.usage`를 커밋된 단계의 대체값으로 처리합니다. 실패한 모델 요청 시도에는 어시스턴트 메시지가 없으므로, 해당 사용량 청크가 영구적인 집계 레코드입니다. 이 미출시 형식은 의도적으로 호환성을 약속하지 않으므로, 시드/로드 검증은 과거 데이터의 경로를 추측하지 않고 provider/model을 생략한 요청 헤더와 어시스턴트 메시지를 거부합니다.

## 라이브 세션 포크 API

`ctx.sessions.create(id, { seed, meta })`는 저수준 재생/포크 기본 요소입니다. 일반적인 라이브 세션 포크를 위해 `SessionStore`는 하나의 정책 API를 제공합니다.

- `fork(source, boundary?, childSessionId?)`는 라이브 `Session` 객체 또는 라이브 `SessionId`를 받고, 포괄적인 `boundary` seq까지 소스 이벤트를 선택하며(기본값: 현재 마지막 이벤트), 선택한 접두사가 열린 턴 밖에서 끝나야 한다고 요구한 다음, 깊이 복제된 시드 이벤트와 자식 메타데이터(`parentSession`, `seedLength`, 상속된 `cwd`)를 포함한 라이브 자식 세션을 생성합니다.

명시적인 `boundary`를 사용하면 호출자는 소스에 더 새로운 이벤트나 열린 현재 턴이 있더라도, 이전 `turn/end` 또는 이후의 독립 로그 전용 이벤트를 포함한 안정적인 턴 사이 위치에서 포크할 수 있습니다. 이 API는 접두사를 조용히 잘라내는 대신 열린 턴 내부에서 끝나는 접두사를 거부합니다. 더 광범위한 실행 관계의 건전성 검사는 `fork()`에 중복하지 않고 기존 `dsh-invariants` 플러그인과 영속성 복구 경로에 남겨 둡니다. `dsh-subagent-fork-in-process`는 도구 시간 위임이 보통 부모 턴이 열려 있는 동안 시작되므로 완료된 접두사 자르기를 유지합니다. 일반 세션 분기는 요청한 경계를 명시해야 합니다.

## 턴 종료 이유: `TurnEndReasonMap`

`turn/start`에는 트리거 필드가 없습니다. 입력된 `user/message` 배치는 각 단계에 무엇이 들어갔는지 기록하고, `llm/retry`는 요청 복구를 기록하며, 유휴 주입은 깨우는 전달이 이후 사전 단계에 도달할 때까지 보류 상태로 남습니다. 라이브 턴은 드라이버를 중지한 형식화된 [`AgentCancelCause`](core.md#the-agent-handle)를 유지합니다. 영속성은 호출자를 저장하지 않은 지원되는 대략적인 취소 레코드를 가져올 때에만 추가 `{ kind: 'legacy' }` 원인을 사용합니다.

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

`max-tokens`는 같은 이름의 모델 호출 `FinishReason`를 반영합니다. 턴 내의 어떤 `max-tokens` 단계라도 전체 턴을 `max-tokens`가 아니라 `completed`로 종료하게 합니다(후속 계속보다 단축된 사실이 우선함). 따라서 소비자는 정상 종료와 잘린 종료를 구분할 수 있습니다. 취소와 오류는 여전히 별개의 결과입니다. `interrupted`는 루프가 내보내지 않는 유일한 이유이며, 크래시 복구로 합성됩니다([persistence.md](persistence.md) 참조). 맵은 병합 확장이 가능합니다.

## 실행 범위와 독립 이벤트

턴은 전체 세션 로그가 아니라 하나의 모델 루프 실행을 포함합니다. AgentLoop는 턴 내부에서 사전 단계 배치에 진입할 때에만 주입된 `user/message` 이벤트를 기록합니다. 플러그인 소유의 로그 전용 이벤트는 `turn/end`와 다음 `turn/start` 사이에 계속 나타날 수 있으며, 턴 번호를 증가시키지 않고 이벤트 seq를 소비합니다. 영속성은 연속적으로 허용된 모든 이벤트를 제한된 영구 배치에 수용하는 반면, 크래시 복구는 실제로 열린 후행 턴만 닫습니다. 즉각적인 내구성 장벽이 필요한 생산자는 명시적으로 `ctx.sessions.flush(session)`를 기다립니다.

선택적인 `dsh-session/invariant` 동반 구성 요소는 코어가 소유한 관계, 즉 턴과 단계 번호, 실행 이벤트 범위, 동일 단계의 도구 호출/결과 쌍을 강제합니다. 병합 확장 가능한 이벤트 관계는 이를 선언한 플러그인에 속하므로, 코어는 열린 턴이 없다는 이유만으로 알 수 없는 이벤트를 거부하지 않습니다. [독립 이벤트 결정](../../.agents/notes/implemented/simplification/2026-07-28-remove-synthetic-log-only-turns.md)을 참조하세요.

## 시드 종료 경계: `session/end-seed`

재개, 포크 또는 재생된 시드 세션은 생성자 시드 직후에 이 로그 전용 이벤트를 첫 번째 라이브 쓰기로 추가합니다. 그 이전 이벤트는 더 작은 seq 값을 가지며 시드에서 왔습니다. 이는 `firstLiveSeq`의 영구적 프로젝션입니다. 이 필드는 객체를 보유한 소비자에게 이 수명 주기의 쓰기가 시작되는 위치를 알려 주는 반면, 이벤트는 저장된 바이트만 보유한 소비자에게 같은 질문에 답합니다. 페이로드는 비어 있으므로 위치와 `time`가 모든 의미를 담으며, 메시지를 생성하지 않습니다. `Session`의 생성자만이 유일한 정당한 작성자입니다.

명시적으로 제공된 빈 시드는 seq 0에 `session/end-seed`를 기록하여 빈 재개 세션과 새 세션을 구분합니다. 이미 `session/end-seed`로 끝나는 시드는 다시 표시되지 않으므로, 손대지 않은 세션을 다시 열어도 가져올 때마다 로그가 늘어나지 않습니다. 저장된 히스토리에서 `session/end-seed`의 마지막 항목을 찾으세요. 하나가 `firstLiveSeq`에 있다고 가정해서는 안 됩니다. 작업 없이 가져온 후에는 해당 이벤트의 seq가 다음 수명 주기의 `firstLiveSeq`보다 작습니다.

시드 이력과 라이브 작업은 그렇지 않으면 바이트 단위로 동일하므로, 독립적인 열기/닫기 괄호를 소유하는 모든 플러그인이 무력화되기 때문에 이것이 존재합니다. 일치하지 않는 `compaction/start`는 작성기가 압축 도중 충돌했는지 또는 지금 압축 중인지와 관계없이 동일하게 읽힙니다. `session/end-seed` 앞의 여는 마커는 생성자 시드에서 왔으며, 무엇이 이를 끝냈든(충돌, 후속 프로세스 또는 아직 실행 중인 부모에서의 포크) 종료된 수명 주기에 속하므로 해당 소유자는 이를 종료된 것으로 처리할 수 있습니다. 이는 *이*  세션이 상속한 괄호에만 적용됩니다. 동일한 이력에 대해 열린 괄호를 보유한 동시에 활성 상태인 세션에는 다른 위치에 자체 경계가 있으므로, 동시 작성기를 허용하려면 로그를 넘어서는 활성 상태 신호가 필요합니다. Core는 경계를 기록하고 여기서 아무것도 읽지 않습니다. 괄호의 어휘는 이를 소유한 플러그인에 남아 있으므로 충돌 복구는 turn/step/tool 경계를 닫고 `compaction/*`는 절대 닫지 않습니다.

사람의 활동을 기준으로 Sessions의 순서를 정하는 소비자는 이 경계를 제외합니다. Session을 가져오는 것은 작업이 아니므로, 로그 끝을 기준으로 정렬하면 열린 모든 Session이 맨 위로 올라갑니다.

## 플러그인이 추가한 로그 전용 이벤트

플러그인은 선언 병합을 통해 추가 `SessionEventMap` 유형을 만들 수 있습니다. 이는 **로그 전용**입니다. `SurfaceEventType`가 아닙니다(`surfaceOp`를 포함하지 않으며 파생 이력에도 아무것도 기여하지 않습니다). 소유자는 이들이 열린 실행 턴에 속해야 하는지, 또는 턴 사이에 존재할 수 있는지를 결정하고 자체 불변 조건 컴패니언에서 모든 관계를 강제합니다. 생성된 [영속성 로그 이벤트 카탈로그](../persistence-catalog.md)에는 모든 Core 및 플러그인 추가 이벤트가 페이로드, 표면 배지, 선언 위치와 함께 열거되어 있습니다. 압축 심의 `compaction/*` 의미 체계는 [compaction.md](compaction.md)에서 설명합니다.

하나의 플러그인 소유 계열에 속한 여러 이벤트가 하나의 Web Client Conversation Node로 조립될 때, 해당 계열의 모든 시작, 업데이트, 결과, 리소스 또는 중단 이벤트는 동일한 안정적인 비즈니스 ID를 전달하거나 독립적으로 파생합니다. 이 요구 사항은 상관관계가 있는 Node 계열에 적용되며 모든 Session 이벤트에 적용되는 것은 아닙니다. 이를 통해 클라이언트는 인접성에서 추측하거나 이력을 스캔하지 않고 각 이벤트를 그룹화할 수 있습니다. [Conversation Node 쿡북](../cookbook/adding-a-conversation-node.md)을 참조하세요.

훅 브리지의 `hook/invoked` / `hook/result` 쌍(`@deepseek-ai/dsh-hook-protocol`에서 제공)은 `handlerId`로 상관관계를 설정합니다. `UserPromptSubmit`, `PreToolUse`, `PostToolUse` 및 `Stop`는 루프의 열린 턴 내부에서 발생하므로, 해당 `hook/*` 레코드는 설계상 턴으로 둘러싸입니다. `SessionStart`는 턴 1 이전에 실행되므로 `hook/*` 레코드를 갖지 않습니다. 해당 컨텍스트는 깨우기 전달이 턴을 열 때까지 받은 편지함에서 대기 상태로 유지됩니다([훅 브리지 Agent Note](../../.agents/notes/implemented/feature/2026-06-30-hook-bridges.md) 참조).

## 내구성 계약

영속성 백엔드가 의존하는 사항은 다음과 같습니다. 내구성 로그는 **다음을 포함하여** `assistant/chunk` 모든 이벤트를 손실 없이 영속화합니다. `seq`는 연속성을 유지해야 하므로 청크를 정식 로그에서 필터링할 수 없습니다. 백엔드는 `load`가 정확히 추가된 이벤트를 반환하는 한 이벤트 배치에 자체 저장소 인코딩을 선택할 수 있습니다(JSONL 백엔드의 기본 압축 청크 행이 그러한 인코딩입니다. [persistence.md](persistence.md) 참조). 모든 `event.data`는 JSON 직렬화 가능해야 합니다. `Session.append`는 소스에서 이를 강제하므로(직렬화할 수 없는 데이터에서는 예외 발생), 잘못된 이벤트는 로그에 절대 들어가지 않고 `session.events`는 항상 백엔드가 영속화할 수 있는 것과 같습니다. 직렬화할 수 없는 데이터를 전달하거나 Core 실행 중첩을 손상시키거나 소유자가 선언한 관계를 위반하는 이벤트 유형을 추가하는 것은 디스크 형식의 호환성을 깨는 변경입니다.

이 계약을 사용하는 백엔드는 [persistence.md](persistence.md)에 있습니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`가 소스에서 생성했습니다(doc-sync에서 `pnpm run verify-cordis-catalog`로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`로 다시 생성합니다). 이 섹션은 페이지의 두 언어 버전에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하며 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있고, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxsessions--sessionstore"></a>

### `ctx.sessions` — `SessionStore`

메모리 내 세션 저장소(`ctx.sessions`).

여기서는 의도적으로 영속성을 구현하지 않습니다. 영속성 플러그인은 `session/event`를 구독하고 `session/flush` / dispose에서 플러시합니다.

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

유형: [CreateSessionOptions](persistence.md) · [PrepareSessionOptions](persistence.md) · [SessionId](core.md)

소스: [`packages/core/session/src/index.ts:792`](../../packages/core/session/src/index.ts)

<a id="session-events"></a>

### `session/*` 이벤트

<a id="sessioncreated--emit"></a>

#### `session/created` — emit

세션 게시 중 생성 알림입니다. 동기적으로 예외가 발생하면 거부되며, 연결된 폐기와 함께 롤백됩니다. 디스패치 중 요청된 분리는 지연됩니다. 반환된 Promise가 거부되면 기록되지만, 이 동기 경계를 소급하여 거부할 수는 없습니다. 범위 필터링 디스패치(`@deepseek-ai/dsh-scope`): agent 범위 리스너는 해당 agent의 컨텍스트를 통해 진입한 세션만 수신합니다.

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

유형: [Scoped](scope.md)

소스: [`packages/core/session/src/index.ts:54`](../../packages/core/session/src/index.ts)

<a id="sessiondisposed--emit"></a>

#### `session/disposed` — emit

알림이 시작된 세션이 스토어를 떠날 때 한 번 발생하며, 게시 롤백도 포함합니다. 단, 생성 알림이 시작되지 않은 항목에는 발생하지 않습니다. 리스너 실패는 기록되고 격리됩니다. 범위 필터링 디스패치(`@deepseek-ai/dsh-scope`)는 소유자 범위를 재사용합니다.

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

유형: [Scoped](scope.md)

소스: [`packages/core/session/src/index.ts:64`](../../packages/core/session/src/index.ts)

<a id="sessionevent--emit"></a>

#### `session/event` — 발생

커밋 후 실행되는 fire-and-forget 추가 피드입니다. 리스너 스냅샷은 로그 푸시 전에 결정되지만 콜백은 그 후에 실행됩니다. 관찰자 실패는 기록되고 격리되며, 커밋된 추가 작업이 실패하지 않도록 합니다. 범위 필터링 디스패치(`@deepseek-ai/dsh-scope`)에서는 에이전트 범위 리스너가 해당 에이전트의 컨텍스트를 통해 진입한 세션의 이벤트만 수신합니다.

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

유형: [Scoped](scope.md)

소스: [`packages/core/session/src/index.ts:76`](../../packages/core/session/src/index.ts)

<a id="sessionflush--parallel"></a>

#### `session/flush` — 병렬

대기되는 병렬 내구성 체크포인트입니다. 모든 리스너가 실행되고 호출자는 워터폴 거부 없이 그 모두를 기다립니다. 범위 필터링 디스패치(`@deepseek-ai/dsh-scope`)는 세션의 소유자 범위를 재사용합니다.

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

유형: [Scoped](scope.md)

소스: [`packages/core/session/src/index.ts:85`](../../packages/core/session/src/index.ts)
<!-- END GENERATED cordis-surface -->
