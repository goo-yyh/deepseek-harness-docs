# 압축

압축 심은 bash와 같은 방식으로 분리된 [기능 심](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)입니다. 즉, 서비스 정의([dsh-compaction](../../packages/compaction/compaction), `ctx.compaction`), 서비스 제공자([dsh-compaction-basic](../../packages/compaction/compaction-basic) 같은 백엔드), 사람 소비자([dsh-command-compact](../../packages/compaction/command-compact))로 구성됩니다. 압축은 에이전트 루프의 핵심 부분이 아니라 **선택적 기능 하나**이므로, 관련 용어는 [core.md](core.md)가 아니라 여기에 있습니다. 토크나이저 기반 또는 템플릿 기반 백엔드는 동일한 인터페이스를 구현하는 형제 패키지입니다. bash와 달리 이 인터페이스는 필연적으로 `dsh-session` 및 `dsh-llm`에 의존합니다. 해당 동사는 에이전트가 소유한 `Session`에 작동하며, 영속적인 요약 이벤트는 `ContentBlock` 용어를 사용합니다([압축 기능 심 Agent Note](../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md) 참조).

출처: [`packages/compaction/compaction/src/types.ts`](../../packages/compaction/compaction/src/types.ts)

## `compaction/*` 세션 이벤트

압축은 선언 병합을 통해 [`SessionEventMap`](session.md)를 세 가지 이벤트 유형으로 확장합니다. 세 이벤트는 모두 **로그 전용** 입니다. 즉, surface에 참여하지 않고 잠금, 요약, 선택 범위, 가려진 이벤트 seq, 토큰 수 및 모델 호출을 기록합니다. `SurfaceEventType`는 의도적으로 확장하지 않습니다(메시지를 생성하는 이벤트만 모델에 도달함). 따라서 요약 자체는 `surfaceOp: { op: 'replace', start, end }`가 포함된 별도 `user/message`를 통해 전달되며, 이는 요약 압축이 수행하는 유일한 surface 변경입니다. [Agent Note](../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md)에서 `user/message`를 재사용하는 근거를 설명합니다.

| 이벤트 | 페이로드 | 역할 |
|---|---|---|
| `compaction/start` | `{ turn }` | 로그에 기록되는 잠금을 획득합니다. 숫자는 열려 있는 자동 턴을 식별하고, `null`는 독립적인 수동 시도를 식별합니다. |
| `compaction/summary` | `{ summary, rawOutput?, llmStreamCall?, shadowedRange, shadowedSeqs, shadowedTokenCount, provider, model, maxTokens?, usage? }` | 안전한 요약 프로젝션, 선택적 완전 제공자 출력 및 사용량, 결과 생성 시 이 컨텍스트의 `ctx.llm.stream()`를 통해 정확히 한 번 호출했음을 나타내는 `llmStreamCall: true` 마커(완전한 `rawOutput` 필요), 가려진 surface 경계 쌍(`start`/`end` seq — 숫자 구간이 아닌 위치 범위), surface 순서의 가려진 seq, 추정 토큰 수, 그리고 요약 호출의 엔벌로프(`provider`, `model` 및 적용된 경우 생성 한도)를 포함합니다. 로그 + 코드로 일회성 요청을 재구성할 수 있도록 기록됩니다(재구성 가능성 Agent Note). 마커가 없는 `rawOutput`는 호출 경로를 식별하지 않습니다. |
| `compaction/end` | `{ turn, error? }` | 동일한 숫자 또는 null 소유자로 잠금을 해제합니다(`error`는 실패한 시도를 기록함). |

잠금은 **전체**  작업을 감쌉니다. 먼저 `compaction/start`가 추가되고, 이어서 요약, `compaction/summary` 레코드, `user/message` 교체가 모두 완료된 후에야 `compaction/end`가 추가됩니다. 잠금을 마지막에 해제하면 작업 중 충돌이 발생해도 압축이 완료되었다고 잘못 주장하는 `compaction/end` 대신 감지 가능한 고아 잠금(일치하는 `compaction/end`가 없는 `compaction/start`)이 됩니다.

마커는 배타적 컨테이너가 아니라 잠금 시점입니다. 요약이 대기 중인 동안 독립적인 수동 시작과 종료 사이에 관련 없는 유휴 삽입이 나타날 수 있습니다. 수동 경로는 선택한 위치 범위만 다시 검증하므로, 삽입된 컨텍스트는 교체 체크포인트 후에도 유지됩니다. 일치하지 않는 시작이 활성 상태이면 모든 진입점을 차단합니다. 더 새로운 `session/end-seed` 이전의 일치하지 않는 시작은 이전 수명 주기의 오래된 증거이므로 무시됩니다.

이 변형은 `declare module '@deepseek-ai/dsh-session/types'` 블록 내부에서 병합되므로, 다른 하위 시스템 페이지의 최상위 유형과 달리 드리프트 검사를 거친 ` ```ts type-equiv ` 블록으로 붙여 넣지 않습니다(`verify-type-equiv` 추출기는 이름으로 최상위 선언만 일치시킴). 위 페이로드 표가 카탈로그 항목이며, 권위 있는 필드는 소스 링크를 따르세요.

## `CompactionResult`

성공한 압축이 호출자에게 반환하는 값은 회계 이벤트 seq, 안전한 요약 프로젝션, 가려진 범위 및 seq, 추정 토큰 수입니다.

```ts type-equiv
/** Result of a successful compaction operation. */
interface CompactionResult {
  /** Stable identity shared by this compaction's complete durable lifecycle. */
  compactionId: CompactionId
  /** Human command that initiated this compaction, when it was manual. */
  sourceCommandId?: CommandId
  /** The seq of the appended `compaction/start` event. */
  startSeq: number
  /** The seq of the appended `compaction/summary` event. */
  summarySeq: number
  /** The seq of the appended `compaction/end` event. */
  endSeq: number
  /** The summary content blocks produced by the backend. */
  summary: ContentBlock[]
  /**
   * The surface-boundary pair that was shadowed: the seqs of the first
   * (`start`) and last (`end`) surface nodes of the replaced range. A
   * surface-POSITION span, not a numeric seq interval — after a prior replace
   * lands a fresh high-seq summary node at an older range's position, `start`
   * can be GREATER than `end`. {@link CompactionResult.shadowedSeqs} is the
   * authoritative set of shadowed nodes, in surface order.
   */
  shadowedRange: { start: number; end: number }
  /** The seqs of all shadowed surface nodes, in surface order. */
  shadowedSeqs: number[]
  /** Estimated token count of the shadowed content. */
  shadowedTokenCount: number
}
```

## 서비스

자동 호출자는 정책이 실행되는 이유를 지정합니다. 구현은 일반적인 압박보다 확인된 오버플로를 더 적극적으로 처리할 수 있습니다.

```ts type-equiv
/** Why automatic policy is asking a backend to consider compaction. */
type CompactionTrigger = 'pressure' | 'context-overflow'
```

`CompactionEngine`는 자동 `pressure` 또는 `context-overflow` 정책을 위한 `compactIfNeeded(agent, trigger, signal)`, 압박 상태가 아니어도 유용한 유휴 세션 축소를 한 번 수행하기 위한 `compactNow(agent, signal)`, 명시적인 포함 surface 범위를 위한 `compactRegion(...)`를 제공합니다. `compactNow()`는 턴 사이에 에이전트 유지 관리로 실행되며, 유용한 범위가 없으면 쓰지 않고 `null`를 반환하고, 요약 전에 독립적인 `turn: null` 범위를 기록하며, 이후 대기 중인 프롬프트가 새 surface에서 파생되기 전에 종료된 시도를 플러시합니다. 모든 백엔드는 `compactCheckpointSource(compactionId, sourceCommandId?)`를 사용하여 교체 `user/message` 소스를 만듭니다. 클라이언트 및 wire 소비자는 cordis-free `@deepseek-ai/dsh-compaction/checkpoint` 하위 경로에서 해당 생성자, `CompactionCheckpointSource` 및 `isCompactCheckpointSource()`를 가져오고, 패키지 루트는 호스트 소비자를 위해 이를 다시 내보냅니다. 필수 트랜잭션 ID는 교체 체크포인트의 상관관계를 지정하고, 조건자는 특정 백엔드와 무관하게 인식을 유지합니다. 구현은 제공된 signal을 요약으로 전달해야 합니다. 이 심은 가격 책정 API를 소유하지 않습니다. 싱글턴 [`ctx.tokenMeter`](token-meter.md)가 추정 및 재생을 직접 소유하고, `dsh-compaction-basic`가 보존, 이벤트 시퀀싱, 라우팅된 요약 호출 및 해당 설정을 소유합니다.

예상되는 수동 실패에는 `ManualCompactionErrorCode`를 사용합니다.

```ts type-equiv
/** Expected failure classes for an explicit idle-session compaction request. */
type ManualCompactionErrorCode =
  | 'busy'
  | 'cancelled'
  | 'changed'
  | 'summary'
  | 'commit'
  | 'persistence'
```

`changed` 및 `summary`은(는) 대화 표면을 변경하지 않지만, 실패한 시도를 로그에서 종료하고 영속화합니다. `commit`은(는) 부분 변경 후에 이어질 수 있으며, `persistence`은(는) 메모리 내 브래킷은 종료되었지만 플러시가 실패했음을 의미합니다. 취소는 별도로 유지되며, 필요한 정리 후 정확한 중단 사유를 throw합니다.

압력 기반 압축은 요청 파생 전에 직렬 `agent/pre-step`에서 실행됩니다. 압력 또는 표준 오버플로가 조건을 충족하면, compaction-basic은 범위 선택 전에 선택적 [`ctx.toolResultPruner`](../../packages/compaction/compaction-tool-result-pruner/README.md)을(를) 호출하고, `ctx.tokenMeter`을(를) 통해 다시 측정하며, 요약 없이 표면을 진행시킬 수 있습니다. 실패한 요청 복구는 실패한 단계가 종료된 후 `agent/request-error`을(를) 통해 실행되며, 이후 가지치기 후 요약 작업에서 오류가 발생하더라도 표면 교체 생성이 진행된 경우에만 재시도 작업을 반환합니다. 취소는 여전히 우선합니다. 영역 경계는 도구 호출/결과 쌍을 보존하지만 전체 턴은 보존하지 않으므로, 하나의 지나치게 큰 턴에서 일찍 종료된 단계를 압축할 수 있습니다. `dsh-compaction-basic`은(는) 임곗값, 유지되는 꼬리 정책, 오버플로 상한 및 실패 처리를 담당합니다.

서비스 정의는 seq 전후의 도구 호출/결과 쌍 검사에 사용할 수 있도록 `toolPairingBalancedBefore(session, seq)` 및 `toolPairingBalancedAfter(session, seq)`을(를) 내보냅니다. 둘 다 현재 표면 멤버십을 검증하고 누락된 seq 및 고아 결과를 거부합니다. 캐시 동작은 [패키지 계약](../../packages/compaction/compaction/README.md#tool-pairing-boundaries)에서 정의합니다.

## 도구 결과 가지치기 결과

선택적 도구 결과 가지치기 서비스는 각 영속적 콘텐츠 교체와 집계된 유니코드 코드 포인트 감소량을 보고합니다. 공개 결과 타입은 [`compaction-tool-result-pruner/src/types.ts`](../../packages/compaction/compaction-tool-result-pruner/src/types.ts)에 있습니다.

```ts type-equiv
/** Cited source event and size accounting for one landed surface replacement. */
interface PrunedEntry {
  /** Full-fidelity tool-result event shadowed by the replacement. */
  readonly originalSeq: number
  /** Newly appended pruned tool-result event. */
  readonly replacementSeq: number
  /** Tool call shared by the original and replacement. */
  readonly callId: CallId
  /** Original text size in Unicode code points. */
  readonly charsBefore: number
  /** Replacement text size in Unicode code points. */
  readonly charsAfter: number
}
```

```ts type-equiv
/** Aggregate outcome of one stable-surface pruning pass. */
interface PruneResult {
  /** Replacements in the snapshotted surface order. */
  readonly pruned: readonly PrunedEntry[]
  /** Total Unicode code points removed across replacements. */
  readonly charsRemoved: number
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`에서 소스로부터 생성되었습니다(doc-sync에서 `pnpm run verify-cordis-catalog`으로 최신 상태를 확인하며, `pnpm run gen-cordis-catalog`으로 다시 생성). 이 섹션은 페이지의 두 언어 측면에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에서 정의하며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxcompaction--compactionengine-abstract-seam"></a>

### `ctx.compaction` — `CompactionEngine` (추상 심)

추상 압축 서비스입니다. 구현은 트리거 정책, 보존 및 요약을 담당하며, 별도의 측정 서비스를 사용할 수 있습니다. 성공적으로 실행되면 선택한 표면 범위를 하나의 요약 노드로 교체하고 같은 세션의 동시 압축을 방지합니다. 교체 사용자 메시지는 트랜잭션 ID와 함께 compactCheckpointSource를 사용하므로 소비자가 백엔드와 독립적으로 이를 인식하고 상관관계를 파악할 수 있습니다. 컨텍스트당 하나의 구현을 `ctx.compaction`으로 로드합니다.

```ts cordis-catalog
/**
 * Consider automatic compaction for one explicit trigger. Pressure policy
 * uses the latest durable routed request, while context-overflow policy may
 * force a useful balanced reduction even below the normal threshold. Return
 * `null` when no safe range can be compacted. A single oversized retained
 * unit or request envelope cannot be repaired through surface compaction.
 *
 * @param agent - agent context owning the session surface and routing options.
 * @param trigger - normal pressure or provider-confirmed context overflow.
 * @param signal - cancellation signal; model-backed implementations must forward it.
 * @returns the compaction result, or `null` if no compaction was needed.
 */
abstract compactIfNeeded( agent: CompactionAgentContext, trigger: CompactionTrigger, signal: AbortSignal, ): Promise<CompactionResult | null>

/**
 * Explicitly compact useful history even below automatic pressure thresholds.
 * Implementations synchronously start an idle task before any asynchronous
 * work, select a useful range without writing on a no-op, then
 * append a standalone `compaction/start` before summarization. That durable
 * marker is the compaction lock until one `compaction/end` attempt. Later waking
 * prompts remain accepted in FIFO order and start only after the optional
 * durability checkpoint and idle-task settlement. Context injected while the
 * summary runs may sit between the marker pair; only the selected span must
 * remain stable.
 *
 * @param agent - idle agent whose durable history should be compacted.
 * @param signal - cancellation scoped to this compaction request.
 * @param sourceCommandId - initiating command identity for a manual compaction.
 * @returns the compaction result, or `null` when no safe useful range exists.
 * @throws {@link ManualCompactionError} for expected busy, agent-cancellation,
 * changed-span, summarization/shrink, commit-stage, or persistence failures;
 * an aborted request preserves its exact abort reason. Failed attempts remain
 * visible in the log.
 */
abstract compactNow( agent: ManualCompactAgentContext, signal: AbortSignal, sourceCommandId?: CommandId, ): Promise<CompactionResult | null>

/**
 * Forcibly compact a range of surface nodes into a single summary node.
 * `start` and `end` name an inclusive span by surface position, not numeric seq
 * order; replacements can make visible seqs non-monotonic. Both edges must be
 * balanced so assistant tool calls remain paired with their results. A model-
 * backed implementation forwards cancellation and rejects active, missing,
 * reversed, or unbalanced ranges. The target session is `agent.session`.
 * Its replacement user message must use {@link compactCheckpointSource} with
 * the transaction's `CompactionId`.
 * Use {@link toolPairingBalancedBefore} and {@link toolPairingBalancedAfter}
 * for the edge checks.
 *
 * @param start - first surface seq, inclusive.
 * @param end - last surface seq, inclusive.
 * @param agent - context whose session is mutated and whose routing options guide summarization.
 * @param signal - optional cancellation; model-backed implementations must forward it.
 * @throws when compaction is active or the range is missing, reversed, or unbalanced.
 * @returns the appended event seqs, summary, replaced range, and token accounting.
 */
abstract compactRegion( start: number, end: number, agent: CompactionAgentContext, signal?: AbortSignal, ): Promise<CompactionResult>
```

타입: [CommandId](commands.md)

소스: [`packages/compaction/compaction/src/index.ts:96`](../../packages/compaction/compaction/src/index.ts)

<a id="ctxtoolresultpruner--toolresultpruner"></a>

### `ctx.toolResultPruner` — `ToolResultPruner`

현재 도구 결과 표면 노드에 대한 결정론적 head/middle/tail 가지치기.

```ts cordis-catalog
/**
 * Measure text content in Unicode code points; non-text blocks cost zero.
 * @param blocks - tool-result content to measure.
 * @returns total Unicode code points across text blocks.
 */
measureContent(blocks: readonly ContentBlock[]): number

/**
 * Replace an over-budget text middle while retaining rich-block order.
 * Text slicing is by Unicode code point, not UTF-16 code unit, so a retained
 * boundary cannot split a surrogate pair. Grapheme clusters may still split.
 * @param blocks - original tool-result content.
 * @returns pruned content, or `null` when the text is within budget.
 */
pruneContent(blocks: readonly ContentBlock[]): ContentBlock[] | null

/**
 * Prune every over-budget tool result from one stable current-surface snapshot.
 * Each replacement preserves the complete event data except for `content`,
 * cites the shadowed node so replay can recover the replacement input, and is
 * immediately preceded by a `compaction/prune` shadow-price event pricing the
 * shadowed node through the injected token meter, so pure consumers can
 * subtract it without per-node state.
 * @param session - session whose current surface is rewritten.
 * @returns landed replacements and aggregate Unicode-code-point savings.
 * @throws when the session rejects a replacement; replacements committed
 * earlier in the pass remain durable.
 */
pruneSession(session: Session): PruneResult
```

유형: [ContentBlock](llm-streaming.md) · [Session](session.md)

소스: [`packages/compaction/compaction-tool-result-pruner/src/index.ts:44`](../../packages/compaction/compaction-tool-result-pruner/src/index.ts)
<!-- END GENERATED cordis-surface -->
