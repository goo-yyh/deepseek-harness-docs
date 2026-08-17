# 세션 프로젝션

세션 프로젝션 추상 seam은 도메인 호스트 플러그인이 로그에서 파생된 세션별 상태의 현재 전체 값을 클라이언트 carrier에 제공하는 [기능 seam](../capability-seams.md)입니다. 여기에는 서비스 정의 및 레지스트리([dsh-session-projection](../../packages/session/session-projection), `ctx.sessionProjections`), 도메인 기여자(각각 하나의 순수 단위를 등록), carrier([dsh-host-apiproxy](../../packages/host/apiproxy)의 히스토리 테일 페이지 및 `session/projection` 푸시 프레임)가 포함됩니다. 이는 agent-loop spine의 일부가 아닌 선택적 기능 하나입니다. 프레임워크가 구동하고 도메인이 계산합니다. 레지스트리는 `session/event`를 한 번 구독하고, 커밋된 모든 이벤트를 모든 단위에 적용해 접습니다. 도메인은 구독을 보유하지 않으며 클라이언트는 도메인 이벤트를 접지 않고 완성된 값을 받습니다. 설계 권한: [세션 프로젝션 RFC](../../.agents/notes/proposed/architecture/2026-07-27-session-projection-and-command-log.md); drive/cache/feed 계약: [패키지 README](../../packages/session/session-projection/README.md).

출처: [`packages/session/session-projection/src/index.ts`](../../packages/session/session-projection/src/index.ts)

## 단위

`SessionProjectionMap`는 전체 체인(호스트 단위, wire 블록, 클라이언트 hook)을 위한 병합 확장형 타입 테이블입니다. 값은 wire-JSON 전체 값이며 렌더링은 이 계층이 아닌 slot 시스템의 책임입니다. 도메인은 키마다 하나의 `ProjectionDefinition`를 기여합니다.

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

전체 값 이벤트 규칙은 핵심 기반입니다. 상태를 전달하는 로그 이벤트는 단순 delta가 아니라 변경 후의 완전한 상태를 전달합니다. 따라서 모든 전환은 매우 저렴하게 처리되고 제공되는 모든 값은 자체적으로 설명됩니다(소비자에게는 마지막 값이 우선 적용됨).

## 스냅샷과 변경 피드

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

`snapshot(session)`는 완전히 동기식입니다. carrier는 페이지 슬라이스와 동일한 tick에서 이를 읽으므로 `asOfSeq`는 하나의 시퀀스 번호에서 두 읽기를 모두 포괄합니다. 모든 값은 반환 전에 해당 단위의 스키마를 통과합니다. 실수로 비동기가 된 `view`는 Promise를 반환하며 스키마 검증이 이를 거부합니다. 변경 피드는 커밋된 각 이벤트마다 상태 *참조* 가 변경된 단위마다 한 번 실행됩니다. 상태가 변경되지 않은 경우 `apply`는 동일한 참조를 반환해야 합니다.

## 레지스트리: `ctx.sessionProjections`

`SessionProjectionRegistry`([시그니처](#ctxsessionprojections--sessionprojectionregistry))가 구동을 소유합니다. 하나의 `session/event` 구독, 등록된 모든 단위에 대한 즉시 `apply`, 그리고 세션별·단위별 watermark 셀을 보유합니다. 셀은 지연 생성됩니다. 이벤트가 흐른 후 등록된 단위 또는 레지스트리보다 오래된 세션은 최초 접근(이벤트 또는 읽기) 시 메모리 내 로그에 `init`를 적용해 접습니다. 등록은 disposer가 호출 fiber를 따르는 효과입니다. 언로드된 도메인 플러그인의 키(캐시된 셀 포함)는 이후의 구동과 스냅샷에서 사라지고 클라이언트는 이를 기능 부재로 읽습니다. 중복 키는 오류를 발생시킵니다. 도메인 플러그인은 레지스트리 없이 구성된 headless 어셈블리에 영향을 주지 않도록 `ctx.inject(['sessionProjections'], …)` 아래에 등록합니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`가 소스에서 생성합니다(문서 동기화에서 `pnpm run verify-cordis-catalog`로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`로 다시 생성). 이 섹션은 페이지의 두 언어 측면에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` fence를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxsessionprojectioncache--sessionprojectioncache"></a>

### `ctx.sessionProjectionCache` — `SessionProjectionCache`

영속화된 프로젝션 캐시 서비스입니다. 초기화 시 `session_projcache` 도메인을 열고, Config의 개수/간격 트리거에 따른 조절된 write-behind와 두 개의 필수 지점(`turn/end` 및 세션 폐기(live에서 cold로 전환되는 시점))에서 활성 세션을 체크포인트합니다. 또한 캐시된 행, 영속성 `readFrom` tail, 레지스트리 `restore`, 내구성 write-back으로 이어지는 cold-read 단계를 제공합니다. 모든 내구성 쓰기는 fail-soft 방식입니다. 실패하면 경고를 기록하고 다음 쓰기 또는 cold read에서 캐시가 자동으로 복구됩니다.

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

유형: [Session](session.md) · [SessionHeader](persistence.md) · [SessionId](core.md)

소스: [`packages/session/session-projection-cache/src/index.ts:71`](../../packages/session/session-projection-cache/src/index.ts)

<a id="ctxsessionprojections--sessionprojectionregistry"></a>

### `ctx.sessionProjections` — `SessionProjectionRegistry`

`ctx.sessionProjections`: 프로젝션 단위 테이블과 해당 구동 로직입니다. 이 서비스는 `session/event`를 한 번 구독합니다. 커밋된 모든 이벤트는 등록된 각 단위의 `apply`를 통과하며(즉시 구동), 변경된 상태 참조는 스키마 검증을 거친 뷰로 변경 피드에 알립니다. 셀은 지연 생성됩니다. 즉, 이벤트가 이미 흐른 뒤 등록된 단위나 레지스트리보다 오래된 세션은 처음 접근할 때(이벤트 또는 읽기) 메모리 내 로그에 `init`를 폴드합니다. 등록은 이펙트이며(disposer는 호출한 fiber를 따름), 언로드된 도메인 플러그인의 키는 스냅샷에서 사라지고 클라이언트는 이를 기능 부재로 읽습니다. 도메인 플러그인은 `ctx.inject(['sessionProjections'], …)` 아래에 등록되므로 레지스트리가 없는 헤드리스 어셈블리에는 영향이 없습니다. 동일한 키를 공유하는 등록자는 하나의 단위를 공유하며 개수가 집계됩니다. N개의 에이전트 프리셋에 마운트된 동일한 도구 패키지는 N번 등록되며, 마지막 항목이 언로드될 때까지 키는 유지됩니다.

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

유형: [Session](session.md) · [SessionEvent](session.md)

소스: [`packages/session/session-projection/src/index.ts:171`](../../packages/session/session-projection/src/index.ts)
<!-- END GENERATED cordis-surface -->
