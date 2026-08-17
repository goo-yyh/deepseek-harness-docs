# SessionTelemetryBackend

아웃바운드 세션 보고는 [기능 경계](../capability-seams.md)로 분리됩니다. 서비스 정의과 캡처 코디네이터([dsh-session-telemetry](../../packages/session/session-telemetry), `ctx.sessionTelemetry`)는 캡처 지점, 고정 청크 프로젝션, `session-telemetry/record` 삭제 워터폴, 인계 커서 및 최소 백엔드 계약을 담당합니다. 배포에서 로드하는 서비스 제공자([dsh-session-telemetry-otel](../../packages/session/session-telemetry-otel))는 그대로 구성된 OpenTelemetry JS SDK의 로그 파이프라인입니다. 이는 에이전트 루프의 중심부가 아닌 선택적 기능 하나이며, 여기의 어떤 것도 모델 요청에 도달하지 않습니다. 경계 공리, 즉 하네스의 책임은 `emit()`에서 끝나고 일괄 처리, 재시도, 큐잉 및 손실 정책은 보고 SDK에 속한다는 원칙과 기각된 대안은 [복원 Agent Note](../../.agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.md)에 고정되어 있습니다. 캡처 지점, 커서 및 프로젝션 계약은 [서비스 정의 README](../../packages/session/session-telemetry/README.md)에 있습니다.

출처: [`packages/session/session-telemetry/src/index.ts`](../../packages/session/session-telemetry/src/index.ts)

## 논리 레코드

```ts type-equiv
/**
 * Severity of a telemetry record, pre-mapped at capture so a receiver can
 * alert with zero configuration: `error` for events whose own outcome flag
 * says so (the tool-result block's `isError`, `turn/end` error reasons) and for
 * `agent-error` operational records. Captured events otherwise default to
 * `info`; `warn` remains available to `session-telemetry/record` policies and
 * backends.
 */
type SessionTelemetrySeverity = 'info' | 'warn' | 'error'
```

```ts type-equiv
/**
 * One logical record handed to a backend — the capture contract's whole outbound
 * vocabulary. Ledger records mirror session-log events one-to-one;
 * operational records (`channel: 'ops'`) carry the two signals with no log
 * home (`agent-error`, `shutdown`) and deliberately omit `event.seq`-style
 * identity so they can never be mistaken for ledger rows.
 */
interface SessionTelemetryRecord {
  /** Ledger (session-log mirror) or ops (operational signal) channel; backends keep the two under separate instrumentation scopes. */
  channel: 'ledger' | 'ops'
  /** Unix epoch milliseconds — the source event's append time for ledger records, the emission time for ops records. */
  time: number
  /** Pre-mapped alerting severity; see {@link SessionTelemetrySeverity}. */
  severity: SessionTelemetrySeverity
  /**
   * Identity attributes, deliberately minimal: ledger records carry
   * `session.id`, `event.type`, `event.seq`, plus `session.cwd` /
   * `session.parent_id` / `session.seed_length` when the header has them;
   * ops records carry `telemetry.op`, `session.id`, and (for `agent-error`)
   * `agent.id`, `turn`, `step`, `error.name`. Anything recoverable from the
   * body is intentionally NOT duplicated here.
   */
  attributes: Record<string, string | number>
  /**
   * The complete payload: a deep copy of the session event's `data` for
   * ledger records (JSON-serializable by `Session.append`'s own
   * validation), or the op payload for ops records. Never mutated after
   * handoff.
   */
  body: unknown
}
```

각 `(turn, step)`에서 첫 번째 `assistant/chunk`만 전송됩니다. 즉 스트림 시작 신호만 전송되며, 나머지는 캡처 시점에 삭제됩니다. 따라서 `seq` 간격은 전송 중 일반적으로 발생하며 손실 신호가 아닙니다. 경계가 알지 못하는 플러그인 병합 이벤트를 포함한 다른 모든 [세션 이벤트](session.md) 유형은 온전하게 통과합니다. 전송은 최선형입니다. 커서는 전송 완료가 아니라 인계 완료를 표시하며, 레코드는 손실될 수 있고(충돌, 리로드 기간) 중복될 수 있습니다(커서 없는 재채택, SDK 재시도). 따라서 수신자는 `(session.id, event.seq)`를 기준으로 원장 레코드의 중복을 제거합니다. 운영 레코드는 의도적으로 그 식별자를 생략합니다. 이는 합산할 항목이 아니라 경고를 발생시킬 신호이므로 대신 중복을 허용합니다.

## 공유 공개

경계의 확인 계약([서비스 정의 README의 공유 공개 섹션](../../packages/session/session-telemetry/README.md#the-sharing-disclosure)에서 담당)은 다음과 같습니다. 모든 백엔드는 `ctx.sessionTelemetry`의 필수 추상 `sharing` 멤버를 통해 배포에서 선택된 공유 정책을 공개하며, 소비자는 어떤 텔레메트리 서비스도 마운트되지 않은 경우에만 "구성되지 않음"을 렌더링합니다. 공개 내용은 현재 정책을 명시할 뿐 전송 또는 보존을 명시하지 않습니다. 인계는 비차단 큐 등록이며, 일괄 처리, 재시도 및 손실 정책은 보고 SDK에 그대로 속합니다.

```ts type-equiv
/**
 * Deployment-selected session-sharing policy disclosed by a mounted
 * {@link SessionTelemetryBackend} backend to human-facing acknowledgement surfaces (the
 * `/feedback` command's confirmation text). The seam owns the vocabulary so
 * any backend can disclose a policy without depending on the OTel package;
 * the values mirror the OTel backend's serialized `SessionTelemetryMode` choices.
 */
type SessionTelemetrySharingStatus = 'full' | 'feedback-only' | 'disabled'
```

## 백엔드 계약

```ts type-equiv
/**
 * The minimum backend contract the coordinator requires. {@link SessionTelemetryBackend} is
 * its service-registered form; tests compose the coordinator with a bare
 * implementation of this interface.
 */
interface SessionTelemetrySink {
  /**
   * Hand one record to the backend's pipeline. MUST be a non-blocking
   * enqueue — the coordinator calls this synchronously from the
   * `session/event` hot path or an explicit canonical-log capture, so anything
   * slower than a queue push would tax the agent loop or feedback handling.
   * Errors thrown here are contained by the coordinator and logged; they
   * never reach the loop.
   * @param record - the logical record to report; owned by the backend after the call.
   */
  emit(record: SessionTelemetryRecord): void
  /**
   * Optional hint that a turn ended. A backend may forward it to its SDK's
   * flush so records are exported after each turn. Called
   * fire-and-forget; implementations must not block and must not throw
   * meaningfully (the coordinator contains exceptions). Most backends should
   * leave this unimplemented and let their SDK's own batching cadence govern
   * export timing: a backend that does implement it owns the interaction
   * between its concurrent flushes and {@link shutdown}'s drain (the OTel
   * backend leaves it unimplemented for exactly that hazard — see the
   * revival Agent Note).
   */
  flush?(): void
  /**
   * Forward the fiber's disposal to the SDK: flush whatever is queued and
   * reach quiescence, per the SDK's own shutdown contract. Everything
   * emitted before this call must still be delivered — including records
   * enqueued while a {@link flush} hint is in flight, so a backend whose SDK
   * guards against concurrent flushes orders behind the outstanding one (the
   * coordinator emits its dispose-time `shutdown` markers immediately before
   * calling this). Awaited by the coordinator's dispose; a rejection is
   * logged as a warning and never fails application teardown.
   * The coordinator captures dispose-time shutdown markers immediately before
   * this call for live capture; on-demand capture creates no ops records.
   * @returns resolves when the backend's pipeline has quiesced.
   */
  shutdown(): Promise<void>
}
```

`SessionTelemetryBackend`(`ctx.sessionTelemetry`, [시그니처](#ctxsessiontelemetry--sessiontelemetrybackend-abstract-seam))는 계약의 로드 가능한 형식입니다. 컨텍스트당 구현은 하나이며, 중복 로드는 예외를 발생시킵니다. 또한 백엔드는 생성자에서 경계의 `SessionTelemetryCoordinator`를 구성하여 캡처 측을 설치합니다.

## 삭제 워터폴: `session-telemetry/record`

모든 레코드는 프로젝션과 `emit()`([워터폴](../cordis-primer.md#cordis-waterfall-semantics), [이벤트 항목](#session-telemetryrecord--waterfall)) 사이에서 `session-telemetry/record`을 통과합니다. 이 이음새 자체에는 규칙이 전혀 포함되어 있지 않습니다. 리스너가 마운트되지 않으면 레코드는 캡처된 그대로 백엔드에 도달하므로, 내보낸 데이터의 정제 수준은 배포 환경에서 마운트한 규칙의 수준과 정확히 같습니다. 리스너는 `next()`의 반환 값을 변환하여 누적됩니다. `next()` 없이 반환하면 그 아래의 모든 항목을 대체합니다. 예외를 발생시키는 리스너는 코디네이터의 격리 범위 내에서 해당 레코드 하나를 실패 시 폐쇄 방식으로 보류합니다. 삭제는 내보낸 복사본에만 적용되며, 정본 세션 로그는 절대 다시 작성되지 않습니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

이 섹션은 `scripts/gen-cordis-catalog.ts`에서 소스로부터 생성됩니다(문서 동기화에서 `pnpm run verify-cordis-catalog`으로 최신 상태를 검증하고, `pnpm run gen-cordis-catalog`으로 다시 생성). 페이지의 두 언어 측에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하며 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있고, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxsessiontelemetry--sessiontelemetrybackend-abstract-seam"></a>

### `ctx.sessionTelemetry` — `SessionTelemetryBackend`(추상적 이음새)

백엔드 계약의 로드 가능한 형태입니다. 컨텍스트당 구현은 하나이며, `telemetry` 키 아래의 cordis `Service` 등록은 cordis의 표준 동작에 따라 중복 시 예외를 발생시킵니다. 백엔드는 생성자에서 SessionTelemetryCoordinator를 구성하여 캡처 측을 설치합니다.

```ts cordis-catalog
/**
 * See {@link SessionTelemetrySink.emit} — that declaration is the contract's one home.
 * @param record - the logical record to report; owned by the backend after the call.
 */
abstract emit(record: SessionTelemetryRecord): void

/** See {@link SessionTelemetrySink.flush}. */
flush?(): void

/**
 * See {@link SessionTelemetrySink.shutdown}.
 * @returns resolves when the backend's pipeline has quiesced.
 */
abstract shutdown(): Promise<void>
```

출처: [`packages/session/session-telemetry/src/index.ts:148`](../../packages/session/session-telemetry/src/index.ts)

<a id="session-telemetry-events"></a>

### `session-telemetry/*` 이벤트

<a id="session-telemetryrecord--waterfall"></a>

#### `session-telemetry/record` — 워터폴

백엔드에 도달하기 전에 하나의 아웃바운드 레코드를 변환합니다. 이 워터폴은 서비스 정의의 삭제 확장 지점입니다. 이 자체에는 규칙이 전혀 포함되어 있지 않습니다. 가장 안쪽의 `next()`은 레코드를 변경 없이 통과시키며, 리스너가 마운트되지 않으면 레코드는 캡처된 그대로 백엔드에 도달하므로 내보낸 데이터의 정제 수준은 배포 환경에서 마운트한 규칙의 수준과 정확히 같습니다. 리스너는 `next()`의 반환 값을 변환하여 누적됩니다. `next()` 없이 반환하면 그 아래의 모든 항목을 대체합니다. 코디네이터의 격리 범위 안에서 캡처 핫 패스에 동기적으로 디스패치됩니다. 예외를 발생시키는 리스너는 해당 레코드 하나를 보류하며(실패 시 폐쇄), 에이전트 루프에는 절대 도달하지 않습니다. 라이브 캡처는 추가 시점에 디스패치하고, 온디맨드 캡처는 정본 로그를 읽는 동안 디스패치합니다. 삭제는 내보낸 복사본에만 적용되며, 정본 세션 로그는 절대 다시 작성되지 않습니다.

```ts cordis-catalog
/**
 * Transform one outbound record before it reaches the backend. This
 * waterfall is the Service Definition's redaction extension point. It ships NO rules
 * of its own: the
 * innermost `next()` passes the record through unchanged, and with no
 * listener mounted records reach the backend as captured, so exported
 * data is exactly as clean as the rules a deployment mounts. Listeners
 * stack by transforming `next()`'s return value; returning without
 * `next()` replaces everything beneath. Dispatched synchronously on the
 * capture hot path inside the coordinator's containment: a throwing
 * listener withholds that one record (fail-closed) and never reaches the
 * agent loop. Live capture dispatches at append time; on-demand capture
 * dispatches while reading the canonical log. Redaction applies to the
 * exported copy only; the canonical session log is never rewritten.
 * @param record - the candidate record, already the coordinator's own deep
 *   copy; listeners return a (possibly new) record and must not mutate it.
 * @mode waterfall
 */
'session-telemetry/record'(record: SessionTelemetryRecord, next: () => SessionTelemetryRecord): SessionTelemetryRecord
```

출처: [`packages/session/session-telemetry/src/index.ts:43`](../../packages/session/session-telemetry/src/index.ts)
<!-- END GENERATED cordis-surface -->
