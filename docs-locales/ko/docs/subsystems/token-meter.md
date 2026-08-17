# 토큰 측정기

`@deepseek-ai/dsh-token-meter`는 요청 부담과 위치별 표면 가격 책정을 위한 분리된 단일 재생 스냅샷을 노출합니다. `logRevision`는 측정의 모든 필드에 대해 소비된 영속 이벤트 수입니다.

소스: [`packages/llm/token-meter/src/types.ts`](../../packages/llm/token-meter/src/types.ts)

## `TokenMeasurement`

```ts type-equiv
/** Detached immutable request-pressure and surface snapshot at one consumed log revision. */
interface TokenMeasurement {
  /** Number of durable events consumed; equal to the next unread event seq. */
  readonly logRevision: number
  /** Provider or heuristic anchor used for this measurement. */
  readonly baseline: TokenMeasurementBaseline
  /** Signed repricing of current surface content relative to the baseline anchor. */
  readonly surfaceDeltaTokens: number
  /** Non-negative current request-and-response pressure. */
  readonly totalTokens: number
  /** Total heuristic tokens across the current surface. */
  readonly surfaceTokens: number
  /** Current surface nodes in positional head-to-tail order. */
  readonly nodes: readonly TokenSurfaceNode[]
}
```

`baseline.kind === 'usage'`는 가장 최근에 성공한 공급자 호출이 동일한 정규 요청 봉투를 가지며, 그 합계가 해당 호출의 전체 휴리스틱 기준점보다 작지 않음을 의미합니다. `estimated`는 재사용 가능한 보수적 사용량 기준점이 없으므로 서비스가 고정 휴리스틱으로 전체 봉투와 표면의 가격을 계산했음을 의미합니다. 이후의 성공한 요청은 이전 기준점을 대체합니다. 부호가 있는 `surfaceDeltaTokens`는 일치하는 기준점에 대한 증가와 감소를 보존합니다. `totalTokens`는 요청 및 응답 부담으로 유지되며, `surfaceTokens`는 표면 전용 휴리스틱 합계로 노드 가격의 합과 같습니다.

## `TokenSurfaceNode`

```ts type-equiv
/** One token-priced node in the current ordered session surface. */
interface TokenSurfaceNode {
  /** Durable sequence number of the surface event. */
  readonly seq: number
  /** Heuristic tokens for the exact message projected by this node. */
  readonly tokens: number
}
```

표면 순서는 권위 기준입니다. 대체 노드는 이후의 위치 노드보다 더 높은 영속 seq를 가질 수 있습니다. 스냅샷은 불변이며, 기반 재생 폴드가 진행되어도 증가하지 않습니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

소스에서 `scripts/gen-cordis-catalog.ts`로 생성됩니다(문서 동기화에서 `pnpm run verify-cordis-catalog`로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`로 다시 생성). 이 섹션은 페이지의 두 언어 측에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문](../cordis-primer.md#dispatch-modes)에서 정의되며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxtokenmeter--tokenmeter"></a>

### `ctx.tokenMeter` — `TokenMeter`

서비스 전체 추정기 하나와 격리된 세션별 폴드를 위한 재생 소유자입니다.

```ts cordis-catalog
/**
 * Measure current request pressure and surface through the durable tail.
 *
 * Provider usage is reused only when the latest successful call's canonical
 * request envelope matches `requestHeader` and its total is no lower than
 * that call's full heuristic anchor; otherwise the complete envelope and
 * surface are heuristically repriced.
 *
 * `requestHeader` affects request pressure only; surface fields always
 * describe the current session surface. Every call clones those positional
 * nodes, so measurement is O(surface).
 *
 * @param session - session to replay through its current durable tail.
 * @param requestHeader - optional effective request envelope replacing the latest logged header.
 * @returns a detached deeply immutable pressure and surface measurement.
 */
measure(session: Session, requestHeader?: EpochHeader): TokenMeasurement

/**
 * Heuristically price one model-visible message (instance face of the pure
 * `estimateMessage` export from `estimate.ts`).
 * @param message - message to price without mutation.
 * @returns content and role-framing tokens under the fixed service heuristic.
 */
estimateMessage(message: Message): number
```

유형: [EpochHeader](session.md) · [Message](llm-streaming.md) · [Session](session.md)

소스: [`packages/llm/token-meter/src/index.ts:74`](../../packages/llm/token-meter/src/index.ts)
<!-- END GENERATED cordis-surface -->
