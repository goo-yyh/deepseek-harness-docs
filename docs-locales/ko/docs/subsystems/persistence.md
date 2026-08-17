# 세션 영속성

이벤트 로그를 위한 **내구성 경계** 입니다. [session.md](session.md)에서는 메모리 내 `Session`, 즉 신뢰할 수 있는 단일 원본인 추가 전용 `SessionEvent` 로그를 설명합니다. 이 페이지에서는 해당 로그를 내구성 있게 만드는 방법, 즉 추상 `SessionPersistence` 서비스와 그 백엔드, 플러시 검사점, 충돌 복구, 그리고 로그와 함께 전달되는 메타데이터 헤더를 설명합니다. 로그가 담는 이벤트 어휘는 생성된 [영속성 로그 이벤트 카탈로그](../persistence-catalog.md)에서 멤버별로 열거합니다.

이 경계는 [기능 경계](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)입니다. 하나의 추상 서비스([dsh-session-persistence](../../packages/session/session-persistence), `ctx.sessionPersistence`)가 locate/create/append, 재사용 가능한 Session 준비, 논리적 로드/검사, 물리적 접미사 읽기, 기존 `SessionEvent`에 대한 경량 목록/스냅샷 관찰을 정의합니다. **병렬 영속 이벤트 유형 없음** . 또한 동일한 계약을 구현하는 두 개의 교체 가능한 백엔드가 있습니다. [session-persistence Agent Note](../../.agents/notes/implemented/architecture/2026-06-14-session-persistence.md)를 참조하세요.

## 플러시 검사점

`session/event`는 *동기식*  알림입니다. 영속성 플러그인은 생산자를 차단하지 않고 이벤트를 세션별 컨트롤러에 복사합니다. 첫 번째 보류 이벤트가 고정 배치 기간을 시작하고, 이후 이벤트는 마감 시각을 재설정하지 않고 참여합니다. 기간이 만료되면 하나의 내구성 배치가 시작됩니다. 해당 쓰기 중에 허용된 이벤트에는 자체 마감 시각이 부여되어 후속 배치를 구성합니다. `session/flush`는 대기를 취소하고 안정 상태까지 비우므로, 루프는 다음 일반 턴을 처리하기 전에 여전히 이를 순서 및 오류 관찰 검사점으로 사용합니다. 거부된 백그라운드 쓰기는 이벤트를 유지하고 자동 재시도를 일시 중지합니다. 새 이벤트는 새 기간을 시작하고, 명시적 플러시는 즉시 재시도하며 실패를 `agent/error` 및 로거를 통해 보고합니다. 닫힌 턴 이후의 세션 이벤트로 보고하지는 않습니다. 폐기 시에도 동일한 최종 비우기를 수행합니다. 구성된 최댓값은 의도적인 배치 대기만 제한하며, 이벤트 루프 스케줄링이나 백엔드 내구성 지연은 제한하지 않습니다([결정](../../.agents/notes/implemented/architecture/2026-08-08-bounded-session-persistence-write-batching.md)).

## 충돌 복구는 중단된 턴을 보존합니다

턴 도중 충돌한 로그를 다시 로드하는 백엔드는 `turn/start`는 열려 있지만 `turn/end`는 없는 상태를 발견합니다. 이 경우 잘라내지 **않습니다** . 장기 작업에서는 단일 턴이 매우 클 수 있고(많은 단계, 대용량 도구 출력), 해당 이벤트는 충돌 전에 이미 내구성 있게 추가되었기 때문입니다. 대신 합성 `turn/end { reason: { kind: 'interrupted' } }`로 고아가 된 턴을 닫아, 그 앞뒤의 독립 실행형 이벤트를 변경하지 않고 중단된 실행의 균형을 맞춥니다. `interrupted`는 어떤 루프도 내보내지 않는 유일한 `TurnEndReason`입니다([session.md](session.md#why-a-turn-ended-turnendreasonmap) 참조).

복구는 콜드 세션에만 적용됩니다. 활성 id의 경우 `SessionPersistence.load(id)`는 권위 있는 메모리 내 스냅샷이 내구성 있게 저장될 때까지 기다리고, 균형이 맞는 경우에만 이를 반환합니다. 열린 활성 턴은 합성 중단 경계를 받지 않고 거부됩니다. HMR은 활성 턴을 닫지 않고 활성 접두사를 채택합니다.

`SessionPersistence.inspect(id)`는 이를 게시하거나 복구를 기록하지 않고 변경 불가능한 논리적 Session을 구성합니다. 콜드 검사는 중단된 턴의 균형을 메모리에서 맞추면서 손상된 물리적 꼬리는 그대로 둡니다. 이미 활성 상태인 Session을 검사하면 현재의 변경 불가능한 스냅샷을 빌리므로 열린 턴을 포함할 수 있습니다. 코디네이터 기반 구현은 정확한 콜드 미게시 Session을 제한된 LRU에 유지하므로, 반복되는 기록 읽기와 이후의 `prepare(id)`는 하나의 읽기, 압축 해제, 검증, 고정 및 Session 구성을 공유합니다. `prepare(id)`는 Session을 예약하고 보류 중인 복구를 커밋한 뒤 폐기 가능한 게시 핸들을 반환합니다. `load(id)`는 동일한 메커니즘을 사용해 게시 없이 복구를 커밋합니다. 이 수명 주기는 [Session 준비 결정](../../.agents/notes/implemented/architecture/2026-08-05-session-preparation.md)에서 담당합니다.

## `SessionLocation` — 선택적 세션별 아티팩트 대상

`SessionPersistence.locate(meta)`는 백엔드가 소유한 독립 아티팩트를 읽거나 생성하거나 플러시하지 않고 동기적으로 확인합니다. JSONL은 프로젝트/세션 디렉터리 내부의 절대 트랜스크립트 경로를 반환하고, SQLite는 세션이 하나의 데이터베이스를 공유하므로 `undefined`를 반환합니다. 따라서 반환된 경로는 아직 존재하지 않거나 현재 플러시되지 않은 턴이 없는 파일을 가리킬 수 있습니다. 이는 위치 힌트이며, 권한 부여나 최신 상태 보장은 아닙니다.

```ts type-equiv
/**
 * A backend-resolved, per-session local artifact location. The path is an
 * absolute target path and can name an artifact that has not materialized yet.
 * Consumers must treat it as a location hint, never as an authorization token.
 */
interface SessionLocation {
  /** Backend-specific artifact kind, for example `jsonl`. */
  readonly kind: string
  /** Absolute path to this session's backend-owned artifact. */
  readonly path: string
}
```

<a id="sessionheader--metadata-beside-the-log"></a>

## `SessionHeader` — 로그 옆의 메타데이터

세션별 메타데이터는 이벤트 로그와 **별도로**  전달됩니다. 형식 버전, cwd, 계보 및 시드 경계는 대화 이벤트가 아닌 저장소 관련 사항이므로 `SessionEventMap`에 포함되지 않으며 `deriveMessages()`에 도달하지도 않습니다. 헤더는 `session.header`를 통해 `Session`에 연결됩니다.

출처: [`packages/core/session/src/types.ts`](../../packages/core/session/src/types.ts)

```ts type-equiv
/**
 * Immutable validated storage metadata, kept outside the conversation event log.
 */
interface SessionHeader {
  /**
   * On-disk format version, stamped from {@link SESSION_FORMAT_VERSION} when the
   * session is created. A persistence backend rejects any other version on load
   * (no migration — see the constant).
   */
  readonly version: number
  /** The session's id (mirrors the {@link Session}'s id). */
  readonly id: SessionId
  /** Non-negative safe-integer Unix epoch milliseconds when the session was created. */
  readonly createdAt: number
  /** Absolute working directory the session was created in (if any). */
  readonly cwd?: string
  /** The session this one was forked from (seed lineage), if any. */
  readonly parentSession?: SessionId
  /**
   * How many leading events were inherited through a seed. Persisting this
   * boundary lets resume and replay distinguish parent history from child work.
   */
  readonly seedLength?: number
  /**
   * Coarse product classification for a session created as a subagent child.
   * This is presentation metadata, not proof that the child is continuable.
   */
  readonly origin?: 'subagent'
  /**
   * Delegation depth: absent (zero) for a top-level session, parent depth + 1
   * for a subagent child. Persisted so a recursion budget survives restart and
   * resume — a runtime-only depth would reset a resumed child to top-level.
   */
  readonly delegationDepth?: number
  /**
   * Id of the agent preset this session's agent was composed from, when the
   * deployment composes per session. Durable because the preset decides the
   * session's tools and prompt: a resume that restored a different composition
   * would replay history the model can no longer act on.
   */
  readonly agentPreset?: string
}
```

## 형식 거부 — 빌드가 충실하게 읽을 수 없는 로그

백엔드는 손상된 것이 아니므로 `SessionPersistenceCorruptionError`와는 구별되며, `SessionFormatUnsupportedError`로 충실하게 해석할 수 없는 로그를 거부합니다. `SESSION_FORMAT_VERSION`보다 앞선 헤더 `version`는 방향을 지정합니다("더 새 Harness에서 기록됨 — 열려면 Harness를 업그레이드하세요"); 그보다 뒤처진 헤더는 이 빌드에 업그레이드 경로가 포함되어 있지 않음을 나타냅니다. 레거시 형태를 정규화한 후, 이 빌드에서 생성된 어휘에 없는 이벤트 유형(`gen-persistence-catalog`에서 발생하는 `KNOWN_SESSION_EVENT_TYPES`)도 이벤트의 envelope에 `ignorable: true`가 없으면 같은 방식으로 거부됩니다. 인식하지 못한 필수 이벤트를 조용히 건너뛰면 로그의 나머지 부분을 읽어야 하는 방식이 달라질 수 있기 때문입니다. 백엔드가 세션당 아티팩트를 하나씩 유지하는 경우 메시지에 원시 로그 경로가 추가되므로, 거부된 텍스트에 계속 접근할 수 있습니다. JSONL 백엔드는 오늘날의 헤더 형태를 검증하거나 이벤트 행을 디코드하기 전에 원시 헤더 행에서 바로 외부 버전을 거부합니다. 구조적으로 다른 미래 형식도 항상 업그레이드 방향을 알리며 "손상됨"으로 보고하지 않습니다. SQLite는 먼저 자체 `SCHEMA_VERSION` pragma를 통해 전체 파일 구조를 검사합니다. 설계 근거와 연기된 업그레이더 체인은 [세션 로그 버전 메커니즘 참고 사항](../../.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md)에 있습니다.

## `CreateSessionOptions` — 시드 및 메타데이터

저장소를 통해 `Session`를 생성하려면 `seed`(초기 재생 또는 포크 이력)와 `meta`(저장소가 `SessionHeader`에 병합하는 저장소 수준 필드)가 필요합니다. 저장소는 `version`/`id`를 채우고 `createdAt`의 기본값을 설정합니다. 호출자는 검증된 절대 `cwd`, `parentSession` 계보, `seedLength` 시드 경계, 선택적인 대략적 `origin`, `delegationDepth`, 에이전트를 구성한 `agentPreset`, 기존 `createdAt`를 제공할 수 있습니다. `origin: 'subagent'`를 사용하면 제품 탐색에서 중복된 하위 행을 숨길 수 있지만, descriptor가 유효하거나 하위 항목을 재개할 수 있음을 증명하지는 않습니다.

```ts type-equiv
/**
 * Options for creating a {@link Session} via the store. `seed` replays/forks
 * an existing event log; `meta` carries the caller-supplied storage fields the
 * store folds into a {@link SessionHeader}.
 */
interface CreateSessionOptions {
  /** Initial replay or fork history supplied at construction. */
  readonly seed?: readonly SessionEvent[]
  /**
   * Storage metadata read once before publication. `seedLength` is explicit
   * because a resumed seed contains the full stored log, not only its inherited prefix.
   */
  readonly meta?: {
    readonly cwd?: string
    readonly parentSession?: SessionId
    readonly createdAt?: number
    readonly seedLength?: number
    readonly origin?: 'subagent'
    readonly delegationDepth?: number
    readonly agentPreset?: string
  }
}
```

따라서 재생/포크는 `ctx.sessions.create(id, { seed: seedEvents })`이고, *영속된* 세션을 라이브 에이전트로 재개하는 것은 `ctx.agents.resume({ resumeSessionId })`입니다.

## `SessionRawArtifact` — 저장된 아티팩트의 원문 텍스트

세션 하나에 대한 백엔드 자체의 아티팩트 텍스트로, 지속적으로 기록한 내용과 바이트 단위로 동일합니다(물리적 인코딩에서 디코드됨). `readRaw`는 파싱된 이벤트에서 재구성하지 않고 이를 반환하므로, 백엔드별 직렬화(청크 패킹, 키 순서, 줄 바꿈)가 보존됩니다. 소비자는 먼저 `supportsRawArtifacts`를 검사합니다. `false`는 백엔드가 이 기능을 제공하지 않음을 의미하며(예: SQLite), `readRaw(...) === undefined`는 지원되는 백엔드에 해당 세션의 구체화된 아티팩트가 없음을 의미합니다.

```ts type-equiv
/** A backend's own raw artifact text for one session, verbatim. */
interface SessionRawArtifact {
  /** The session header parsed from the artifact's own first line. */
  readonly meta: SessionHeader
  /** The artifact's base filename on disk, without any physical encoding suffix. */
  readonly filename: string
  /** The artifact's full text content, decoded from the backend's physical encoding. */
  readonly content: string
}
```

## 준비 및 복원 소유권

`SessionStore.prepare()`는 일반 생성 옵션 또는 `RestoredSessionOptions`를 통해 전달되는 새로운 영속성 그래프를 허용합니다. 복원 분기는 전달된 헤더와 이벤트를 제자리에서 검증하고 고정하므로, 호출자는 변경 가능한 별칭을 보유해서는 안 됩니다. 이후 `SessionPreparation`가 게시 또는 롤백 전까지 정확한 미게시 Session을 소유하며, 폐기는 동기식이고 멱등적입니다. 영속성 검사는 동일하게 준비된 Session에서 빌린 불변의 논리적 뷰인 `SessionInspection`만 노출합니다.

```ts type-equiv
/**
 * Fresh storage values transferred to {@link SessionStore.prepare} without a
 * second serialization copy. Callers retain no mutable aliases.
 */
interface RestoredSessionOptions {
  /** Fresh detached storage events to validate and freeze in place. */
  readonly seed: SessionEvent[]
  /** Fresh detached storage metadata to validate and freeze in place. */
  readonly meta: SessionHeader
  /** Select the persistence ownership-transfer path. */
  readonly seedSource: 'persistence'
}
```

```ts type-equiv
/** Inputs accepted while constructing an unpublished Session. */
type PrepareSessionOptions =
  | (CreateSessionOptions & { readonly seedSource?: undefined })
  | RestoredSessionOptions
```

```ts type-equiv
/** Options for a preparation whose provider retains unpublished state. */
interface SessionPreparationOptions {
  /** Release provider-owned state when the Session was not published. */
  readonly release?: () => void
}
```

```ts public-api
/**
 * One exact unpublished Session and the provider state that keeps it usable.
 * Disposal is synchronous and idempotent. Providers decide whether release
 * returns the Session to a cache or discards it; publication may consume that
 * state before disposal, making the callback a no-op.
 */
declare class SessionPreparation implements Disposable {
  /** The exact Session to use for setup and publication. */
  readonly session: Session;
  /**
   * Wrap an unpublished Session in one preparation lifetime.
   * @param session - exact unpublished Session.
   * @param options - optional provider release behavior.
   * @returns a preparation disposed after publication or rollback.
   */
  static create(session: Session, options?: SessionPreparationOptions): SessionPreparation;
  /** Release provider state once when this preparation leaves its caller. */
  [Symbol.dispose](): void;
}
```

```ts type-equiv
/** Immutable logical session prepared from persistence or a live owner. */
interface SessionInspection {
  /** Validated immutable session metadata. */
  readonly meta: SessionHeader
  /** Validated contiguous logical event log. */
  readonly events: readonly SessionEvent[]
}
```

## 경량 소스 리비전

파생 상태의 소비자는 전체 이벤트 로그를 로드하기 전에 저렴하고 불투명한 리비전을 비교합니다. 영속성 백엔드는 표현을 소유하고 append 또는 변경형 로드 복구와 함께 트랜잭션 방식으로 이를 변경합니다. 호출자는 동등성 비교에만 이를 사용합니다.

```ts type-equiv
/**
 * Backend-owned token that identifies both one storage source and one revision
 * of a persisted session log.
 */
type SessionPersistenceRevision = Branded<'SessionPersistenceRevision'>
```

```ts type-equiv
/** Lightweight immutable source identity returned without loading a full log. */
interface SessionPersistenceSnapshot {
  /** Detached metadata for one materialized session. */
  header: SessionHeader
  /** Opaque source-qualified token that changes whenever this stored log changes. */
  revision: SessionPersistenceRevision
}
```

## 백엔드

둘 다 동일한 추상 `SessionPersistence`(선택적으로 관찰 메서드에서 취소 가능하며, `SessionEvent` 위의 locate/create/append/prepare/load/inspect/readFrom/list/listSnapshots)를 구현하고 공유 `runPersistenceContract` 모음을 통과합니다:

- **[dsh-session-persistence-jsonl](../../packages/session/session-persistence-jsonl)** — 세션별 추가 전용 논리적 JSONL 로그입니다. 기본적으로 체크섬이 적용된 연결된 Zstandard 프레임으로 저장되며, 설정에 따라 원시 줄로 저장할 수도 있습니다. 충돌 안전 원자적 쓰기, 중단된 턴 복구 및 읽기/재생 경로를 제공합니다.
- **[dsh-session-persistence-sqlite](../../packages/session/session-persistence-sqlite)** — `node:sqlite`, `SessionEvent`당 하나의 행입니다. 행 필드 `(session_id, seq, type, time, data, source_event_seqs, surface_op)`는 선택적 표면 메타데이터를 포함하여 이벤트에 1:1로 매핑되므로, 동기화해야 할 별도의 영속 스키마가 없습니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

소스에서 `scripts/gen-cordis-catalog.ts`로 생성됩니다(문서 동기화에서 `pnpm run verify-cordis-catalog`로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`로 다시 생성합니다). 이 섹션은 페이지의 두 언어 버전에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [개요](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxsessionpersistence--sessionpersistence-abstract-seam"></a>

### `ctx.sessionPersistence` — `SessionPersistence` (추상적 접합부)

내구성 있는 추가 전용 세션 스토리지입니다. 구현체는 연속적이고 손실 없이 JSON으로 직렬화 가능한 이벤트를 보존합니다. 추가 작업은 내구성이 확보된 후에만 완료되며, 로드는 커밋된 이벤트를 다시 쓰지 않고 완전한 중단 꼬리 부분의 균형을 맞춥니다.

```ts cordis-catalog
/**
 * Resolve this backend's independent local artifact for a session without
 * reading, creating, flushing, or otherwise materializing it. Backends such
 * as SQLite that do not own one artifact per session return `undefined`.
 * @param meta - the immutable session header whose artifact is requested.
 * @returns the backend-specific absolute location, when one exists.
 */
abstract locate(meta: SessionHeader): SessionLocation | undefined

/**
 * Read a session's backend-owned artifact text verbatim — the exact durable
 * bytes the backend wrote (decoded from its physical encoding, e.g. a
 * decompressed JSONL). The returned `content` is the raw text, not a
 * reconstruction from parsed events, so it preserves backend-specific
 * serialization (chunk packing, key order, line breaks). Callers first test
 * {@link supportsRawArtifacts}; `undefined` then means only that the requested
 * session has no materialized artifact.
 * @param _id - the persisted session to read (unused by the default: no
 * per-session artifact).
 * @param signal - optional cancellation for backend read work.
 * @returns the raw artifact plus its parsed header, or `undefined` when the
 * session is absent.
 * @throws when this backend does not expose per-session raw artifacts.
 */
readRaw(_id: SessionId, signal?: AbortSignal): Promise<SessionRawArtifact | undefined>

/**
 * Register a new session's metadata. A backend MAY defer the physical write
 * until the first {@link append} (lazy materialization), in which case a
 * created-but-never-appended session is absent from {@link list}
 * — abandoned sessions leave nothing behind.
 * @param meta - the immutable header (id, version, cwd, lineage) to record.
 */
abstract create(meta: SessionHeader): Promise<void>

/**
 * Durably persist a batch of events. Honors the append-only and contiguous-
 * seq contracts: the first event's `seq` MUST equal the stored next-seq
 * (after `load` has durably closed any interrupted turn). Rejects non-JSON-
 * serializable `event.data` with an error naming the offending event type.
 * @param id - the session the batch belongs to.
 * @param events - the contiguous batch to persist, in seq order.
 */
abstract append(id: SessionId, events: readonly SessionEvent[]): Promise<void>

/**
 * Prepare the exact unpublished Session used by resume. Implementations may
 * reuse object graphs retained by an earlier {@link inspect} after confirming
 * their durable revision is still current; disposal releases an unpublished
 * reservation. Revision retries require the durable log to remain unchanged
 * for one read/check round trip; continuous external writers may delay completion.
 * @param id - persisted session to prepare.
 * @param signal - optional cancellation for preparation work.
 * @returns one owned unpublished Session preparation.
 */
async prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation>

/**
 * Load an immutable balanced logical view and commit any required cold
 * recovery. A complete interrupted final turn is preserved and durably
 * closed with missing tool errors plus any open step and turn boundaries;
 * only a torn final record is discarded. Unknown versions and corruption in
 * the committed prefix reject. Implementations MUST NOT crash-repair an
 * identity still bound to a live Session: a balanced live log may return as a
 * durable snapshot, while an open live turn rejects. Returned values may be
 * shared with immutable live or prepared state and must not be mutated.
 * Revision-based implementations may wait for one stable read/check round trip.
 * @param id - the persisted session to reload.
 * @returns the header and a log ending on a balanced `turn/end`.
 */
abstract load(id: SessionId): Promise<SessionInspection>

/**
 * Inspect an immutable logical session without committing recovery or
 * publishing it. A cold complete interrupted turn receives synthetic closers
 * in memory and a torn physical tail remains untouched. An already-live
 * Session instead yields its current immutable snapshot, which may contain an
 * open turn and its `session/end-seed` boundary. Coordinator-backed
 * implementations retain the exact cold unpublished Session for bounded
 * reuse by a later {@link prepare}. A stale ready source is reloaded; a source
 * already committing or reserved for resume remains exclusive, and inspection
 * may borrow its immutable view. Callers borrow only the immutable header and
 * log. Continuous external writers may delay revision convergence.
 * @param id - the persisted session to inspect.
 * @param signal - optional cancellation for queued and backend read work.
 * @returns the validated header and current logical event log.
 */
abstract inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection>

/**
 * Read the stored events from `fromSeq` onward — the read-from-seq
 * primitive for read models that resume from a watermark (e.g. a persisted
 * projection cache folding only the tail past its checkpoint). Unlike
 * {@link inspect}, it is a detached physical suffix read: no preparation
 * cache, torn-tail truncation, synthetic closers, or coordinator-state
 * publication. Only events from the valid contiguous stored prefix are
 * returned, so a torn fragment never reaches the caller. `fromSeq` at or
 * beyond the stored prefix returns an empty event list (never an error).
 * Backends whose medium can seek by seq
 * (SQLite) read only the suffix; sequential media (JSONL, both encodings)
 * still parse the whole artifact and skip forward — the primitive bounds
 * what is RETURNED and refolded, not every backend's physical read.
 * @param id - the persisted session to read.
 * @param fromSeq - first event seq to include; a non-negative safe integer.
 * @param signal - optional cancellation for queued and backend read work.
 * @returns the header and the stored events with `seq >= fromSeq`.
 */
abstract readFrom(id: SessionId, fromSeq: number, signal?: AbortSignal): Promise<{ meta: SessionHeader; events: SessionEvent[] }>

/**
 * Lightweight listing from metadata, without a full-log parse.
 * @param signal - optional cancellation for backend listing work.
 * @returns one header per materialized session.
 */
abstract list(signal?: AbortSignal): Promise<SessionHeader[]>

/**
 * List materialized sessions with cheap per-log change tokens.
 *
 * Repeated observations of an unchanged log return the same revision. A
 * successful mutating {@link load} repair changes the next listed revision.
 * Revisions also distinguish independently backed stores so backend-local
 * counters cannot compare equal across different persistence sources.
 * @param signal - optional cancellation for backend snapshot-listing work.
 * @returns one header and opaque revision per materialized session without loading full logs.
 */
abstract listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]>
```

유형: [SessionEvent](session.md) · [SessionId](core.md)

소스: [`packages/session/session-persistence/src/index.ts:84`](../../packages/session/session-persistence/src/index.ts)
<!-- END GENERATED cordis-surface -->
