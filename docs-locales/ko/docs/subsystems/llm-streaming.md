# LLM 스트리밍

[`packages/llm`](../../packages/llm/README.md)의 대화 및 스트리밍 타입입니다. 모든 요청과 영속 기록이 공유하는 `Message`/`ContentBlock` 변형, 완전히 조립된 모델 요청, 원시 `StreamChunk` 프로토콜, 모든 어댑터가 구현해야 하는 어댑터 계약, 그리고 공유 어셈블러를 포함합니다. [핵심 패키지](core.md)는 매 턴마다 이 값을 보관하고 기록하며, 이 페이지에서 이를 선언합니다.

출처: [`packages/llm/llm/src/types.ts`](../../packages/llm/llm/src/types.ts)

<a id="content-blocks-and-messages"></a>

## 콘텐츠 블록과 메시지

대화는 `Message`의 집합이며, 메시지는 타입이 지정된 **콘텐츠 블록** 배열입니다. 블록 유니온은 `ContentBlockMap`에서 파생됩니다.

출처: [`packages/llm/llm/src/types.ts`](../../packages/llm/llm/src/types.ts)

```ts type-equiv
/**
 * Merge-extensible content blocks keyed by `type`. New core blocks must land
 * with adapter, UI, and compaction support.
 */
interface ContentBlockMap {
  'text': TextBlock
  'reasoning': ReasoningBlock
  'image': ImageBlock
  'tool-call': ToolCallBlock
  'tool-result': ToolResultBlock
}
```

블록 인터페이스(전체 필드는 소스 참조): `TextBlock` (`text`), `ReasoningBlock`(보이는 텍스트와 구분되는 사고), `ImageBlock`(영속적인 [이미지 첨부 파일](attachment.md)), `ToolCallBlock`(`id: CallId`, `name`, 원시 JSON `arguments`), 그리고 `ToolResultBlock`(`toolCallId`, 중첩된 `content: ContentBlock[]`, `isError?`)입니다. `ContentBlock = ContentBlockMap[ContentBlockType]`. 새 모달리티는 어댑터, UI, 압축 및 영속적 재생 경로가 이를 준수할 때에만 병합 확장 가능한 맵에 속합니다.

출처: [`packages/llm/llm/src/message.ts`](../../packages/llm/llm/src/message.ts)

`Message`는 식별된 불변의 role/source/content 값 하나입니다. 모델이 생성한 어시스턴트 메시지는 이를 생성한 제공자와 모델의 이름을 지정하고, 소스에 선택적 어댑터 전용 재생 데이터를 담습니다.

```ts type-equiv
/** Provider/model identity and adapter-private replay data for an assistant message. */
interface AssistantProvenance {
  /** Provider route that produced the message. */
  provider: string
  /** Provider model id that produced the message. */
  model: string
  /**
   * Lossless-JSON adapter state needed to replay the provider response.
   * `LlmRuntime` exposes it to a target adapter only when that adapter instance
   * currently owns both this historical provider and the target provider.
   */
  replayState?: unknown
}
```

```ts type-equiv
/** One immutable message representation shared by delivery, durable history, and model requests. */
interface Message {
  /** Stable identity preserved across every representation boundary. */
  readonly id: MessageId
  /** Provider-neutral conversation role. */
  readonly role: 'system' | 'user' | 'assistant'
  /** Exact model-facing blocks. */
  readonly content: ContentBlock[]
  /** Required source fields supplied by the producer. */
  readonly source: MessageSource
}
```

메시지의 출처 자체가 병합 확장 가능한 합 타입입니다.

```ts type-equiv
/**
 * Where a message (or injected content) came from.
 * Merge-extensible sum type — plugins add their own `kind`s.
 */
interface MessageSourceMap {
  user: { kind: 'user' }
  plugin: { kind: 'plugin'; plugin: string } & ContextFormed
  model: ModelMessageSource
  tool: ToolMessageSource
}
```

생성자 식별성과 표시 형식은 독립적입니다. `kind`는 *누가 이를 생성했는지*에 답합니다. 선택적인 `form`는 *이 정보가 어떤 종류인지*에 답하며, 소비자는 이를 어떻게 표시할지 결정합니다. 여러 생성자가 하나의 형식을 공유할 수 있고, 한 생성자가 세션 동안 둘 이상의 형식을 내보낼 수 있습니다. 값은 의미론적이며 한 번에 하나씩 확장됩니다. 값이 없거나 인식되지 않으면 문서화된 기본값을 사용하고 불투명한 콘텐츠로 표시합니다.

```ts type-equiv
/**
 * The kind of information in producer-supplied context, declared by the
 * producer beside its provenance.
 *
 * `MessageSource.kind` answers *who produced this*; `form` answers *what kind
 * of thing it is*, and the two axes are deliberately independent — several
 * producers share one form, and one producer may emit more than one form over
 * a session.
 *
 * The vocabulary is SEMANTIC, never visual: a value states that the content is
 * a file's instructions or a catalog of available items, and a consumer decides
 * what that looks like. Colors, icons, ordering, and collapse defaults are the
 * consumer's business and must not enter this union. It grows one value at a
 * time as producers gain the structured fields their form needs; an absent or
 * unknown value is the documented default, presented as opaque content.
 */
type ContextForm =
  /** Instructions read out of workspace files the model is expected to follow. */
  | 'instructions'
  /** A catalog of items available in this session, republished as it changes. */
  | 'catalog'
  /** Current state, where a later snapshot from the same producer supersedes an earlier one. */
  | 'snapshot'
  /** A one-off account of something that just happened; it supersedes nothing. */
  | 'notice'
  /** A message another agent addressed to this one. */
  | 'relay'
  /** Material lifted out of another session's log, possibly reduced on the way in. */
  | 'recall'
```

```ts type-equiv
/** One named contribution to a `snapshot`-form context, in assembly order. */
interface ContextSnapshotSection {
  /** The contributing subsystem's name. */
  readonly name: string
  /** That contribution's model-facing text, exactly as assembled. */
  readonly text: string
}
```

```ts type-equiv
/**
 * Producer-declared {@link ContextForm} and the fields that form requires,
 * mixed into the source types that carry one.
 *
 * Discriminated by `form` so a producer cannot select a form without the
 * fields needed to present it: a `notice` must record its one-line
 * account, a `snapshot` its sections. Omitting `form` stays valid — an
 * undeclared context is the documented default.
 */
type ContextFormed =
  | { readonly form?: never }
  | { readonly form: 'instructions' }
  | { readonly form: 'catalog' }
  | {
    readonly form: 'snapshot'
    /** The named contributions this snapshot assembled, in order. */
    readonly sections: readonly ContextSnapshotSection[]
  }
  | {
    readonly form: 'notice'
    /** One-line account of what happened, shown without expanding the row. */
    readonly summary: string
  }
  | { readonly form: 'relay' }
  | { readonly form: 'recall' }
```

<a id="streamchunk--the-raw-protocol"></a>

## `StreamChunk` — 원시 프로토콜

스트리밍 응답은 여러 타입 지정 블록(텍스트, 추론, 여러 도구 호출)을 인터리브합니다. `index`는 각 델타를 해당 블록에 연결하고, `block-end`는 소비자가 직접 델타를 다시 조립하지 않아도 되도록 완전히 조립된 `ContentBlock`를 전달합니다. 이는 **닫힌**  태그드 유니온입니다. 즉, `type`에 대한 `switch`는 `assertNever`로 끝나므로, 변형을 추가하면 이를 처리해야 하는 모든 소비자에서 컴파일이 중단됩니다.

```ts type-equiv
/**
 * Raw streaming protocol emitted by adapters.
 * Block indexes correlate interleaved deltas, and `block-end` carries the
 * assembled block. Adapters emit usage before the terminal finish and nothing
 * afterward; tool arguments remain raw JSON strings. An adapter implementation
 * may throw, but `LlmRuntime.stream()` normalizes that failure to a terminal
 * `error` or `aborted` finish before exposing it to consumers.
 */
type StreamChunk =
  | { type: 'block-start'; index: number; blockType: ContentBlockType }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: CallId; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: TokenUsage }
  | {
    type: 'finish'
    reason: FinishReason
    /** Adapter-private lossless-JSON state for replaying a successful response. */
    replayState?: unknown
  }
```

## `LlmFailure`

발생한 모든 예외 또는 인밴드 최종 어댑터 실패는 직렬화 가능한 단일 공급자 중립 페이로드로 정규화됩니다. `providerRetryAfterMs`는 재시도 결정이 아니라 공급자가 요청한 검증된 양의 지연 시간이며, `ProviderRequestId`는 진단용 불투명 브랜디드 문자열입니다.

```ts type-equiv
/** Serializable provider or transport failure facts; policy decides whether they are retryable. */
interface LlmFailure {
  /** Human-readable provider or transport failure. */
  readonly message: string
  /** Stable provider-neutral machine-routing code. */
  readonly code: string
  /** HTTP status returned by the provider, when available. */
  readonly status?: number
  /** Provider-requested delay in milliseconds, when valid and available. */
  readonly providerRetryAfterMs?: number
  /** Opaque provider-issued request identifier for diagnostics. */
  readonly requestId?: ProviderRequestId
}
```

## 어댑터 계약

모든 어댑터는 다음을 반드시 준수해야 하며, 모든 소비자는 이를 신뢰할 수 있습니다.

- **`usage`는 `finish`보다 먼저, `finish` 뒤에는 아무것도 없습니다.** 후행 사용량 전용 청크가 순서를 위반하지 않도록 둘 다 공급자의 스트림 종료 마커까지 지연합니다.
- **도구 호출 `arguments`는 처음부터 끝까지 원시 JSON 문자열로 유지됩니다.** 부분 조각은 `argumentsDelta`를 통해 스트리밍되며, 파싱된 객체를 반환하는 공급자는 `block-end`에서 다시 문자열화합니다.
- **허용되는 오류 경로는 두 가지이며 `LlmFailure` 유형은 하나입니다.** 실패는 `stream()`에서 THROW할 수 있고(전송/프로토콜 오류), **또는**  `finish {kind:'error'|'aborted', failure}`로 스트림을 종료할 수 있습니다(스트림 중간에 예외를 던질 수 없는 어댑터의 공급자 인밴드 오류). `LlmError.failure`는 동일한 `LlmFailure`를 전달합니다. 호출이 어댑터를 선택한 후 스트림은 정확히 발생한 `Error` 객체를 보존하고, 불변 사실과 제공 등록의 불변 재시도 정책을 해당 호출에 연결합니다. 에이전트 루프는 실패한 단계를 닫고 오류, 사실, 불변의 이전 재시도 사실, 제공 정책 및 턴 신호를 `agent/request-error`에 제공합니다. 처리 리스너는 대기한 복구 후 `{ kind: 'retry' }`를 반환합니다. 복구가 없으면 구조화된 실패가 턴 오류가 되며, 해당 시도에서는 일반 어시스턴트 메시지나 도구 부작용이 커밋되지 않습니다.
- **어댑터 호출 하나는 공급자 시도 하나입니다.** 어댑터는 라이브러리 재시도를 비활성화합니다. 에이전트 수준 복구는 내구성 있는 번호 지정 턴을 새로 열며, 직접 `ctx.llm.stream()` 호출자는 단일 시도로 유지됩니다.
- **공급자 중단은 전송 계층에서 제한됩니다.** 출시된 두 원격 어댑터는 5분 기본값을 가진 양의 유한 `streamIdleTimeoutMs`를 노출합니다. 감시 타이머는 반복자 `next()`가 진행 중일 때만 활성화되고, 전체 요청에 하나의 안정적인 신호를 사용하며, 자체 만료를 `TIMEOUT`에 매핑하고, 더 이른 호출자 중단은 `ABORTED`로 유지합니다.
- **컨텍스트 오버플로에는 정식 코드가 하나 있습니다.** 두 DeepSeek 어댑터는 명시적인 공급자 세부 정보를 `isContextWindowExceededError()`를 통해 분류하고, 실패가 발생한 HTTP `LlmError`로 도착하든 인밴드 종료 오류로 도착하든 `CONTEXT_WINDOW_EXCEEDED`를 노출합니다. 소비자는 공급자 텍스트가 아니라 코드로 라우팅합니다.
- **빈 완료는 재시도 가능한 오류이며, 조용한 성공이 아닙니다.** 두 어댑터는 콘텐츠 블록이 없는 종료 `stop` 완료를 정식 `EMPTY_RESPONSE` 코드가 포함된 `finish {kind:'error'}`에 매핑하며, `dsh-llm-retry`는 기본적으로 이를 재시도합니다. [빈 모델 응답은 재시도 가능함](../../.agents/notes/implemented/bug-fix/2026-07-24-empty-model-response-is-retryable.md)을 참조하세요.
- **모든 공급자 HTTP 요청에는 앱 기여 헤더가 포함됩니다.** 어댑터는 `attributionHeaders()`(아래)을 전송합니다. 이는 `User-Agent` 기준선이며, 와이어 수준 테스트로 이를 입증합니다.
- **재생 상태는 어댑터가 소유합니다.** 성공한 `finish`는 네이티브 공급자 응답을 재구성하는 데 필요한 무손실 JSON 상태를 포함할 수 있습니다. 루프는 이를 조립된 어시스턴트 메시지와 함께 저장합니다. 이후 요청에서 `LlmRuntime`는 과거 공급자와 대상 공급자가 현재 정확히 동일한 어댑터 인스턴스에 등록된 경우에만 상태를 전달합니다. 해당 어댑터는 상태를 검증하고 모델 간 또는 공급자 간 변환을 소유합니다. 다른 어댑터는 비공개 상태 없이 공급자 중립 콘텐츠와 공급자/모델 필드를 받습니다.

## `ResolvedRetryPolicy`

공급자 구성은 경로 등록 전에 불변 판별 공용체로 해석됩니다. 일반 모드는 `mode: 'normal'`, 유한한 `maxRetries`, `retryableCodes` 및 필수 `initialDelayMs`, `maxDelayMs`, `jitterRatio`를 포함합니다. 항상 모드는 유한한 최댓값 없이 `mode: 'always'`와 동일한 필수 백오프 필드를 포함합니다. `LlmRuntime.providerRetryPolicy(provider)`는 현재 등록된 값을 반환하고 어댑터가 값을 생략하면 일반 기본값을 제공합니다. `llmRetryPolicyOf(stream)`는 호출이 해당 등록을 선택한 후 제공 등록에서 캡처한 값을 반환하므로, 이후 경로 폐기나 교체가 진행 중인 실패의 복구 정책을 변경할 수 없습니다. 선택적 입력 필드는 [생성된 구성 카탈로그](../config-catalog.md)에 나열되어 있습니다.

## `AppIdentity` — 앱 기여

모든 어댑터가 공급자에게 전송하는 정적 공개 애플리케이션 ID입니다([`packages/llm/llm/src/attribution.ts`](../../packages/llm/llm/src/attribution.ts)). `attributionHeaders(identity?)`는 이를 표준 `User-Agent` 헤더에만 매핑합니다. 이 계약은 OpenRouter 전용 앱 기여 헤더를 의도적으로 지원하지 않습니다. 기본 `APP_IDENTITY`는 패키지 매니페스트에서 버전을 가져옵니다. 모든 필드는 공개 제품 사실이며 비밀, 경로, 세션 ID, 사용자별 식별자를 포함하지 않고 요청별로 값에 영향을 줄 수 있는 항목도 없습니다. 근거: [필수 `User-Agent` 기여](../../.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md).

```ts type-equiv
/**
 * Static public application identity sent to LLM providers.
 *
 * Every field is a public product fact, safe on every request: no secrets,
 * local paths, session ids, prompt text, or per-user identifiers belong here,
 * and nothing per-request may influence the values.
 */
interface AppIdentity {
  /** `User-Agent` product token (lowercase, hyphenated). */
  product: string
  /** Product version; sourced from package metadata, never hand-copied. */
  version: string
  /** Repository home URL of the app, used as the `User-Agent` comment. */
  url: string
}
```

## `TokenUsage`

호출별 토큰 집계입니다. 개수는 **서로 분리됩니다**. `inputTokens`는 캐시되지 않은 입력만을 뜻하며, 캐시된 입력은 별도로 보고되고 청구 입력은 세 가지의 합계입니다. 캐시 적중을 단일 프롬프트 합계(DeepSeek의 `prompt_tokens`)에 포함하는 공급자를 사용하는 어댑터는 이를 다시 제외합니다. `reasoningTokens`가 있으면 이미 `outputTokens`에 포함된 정보 세부 사항이므로 합계에 다시 더해서는 안 됩니다.

```ts type-equiv
/**
 * Token accounting for one model call (cache fields are optional).
 *
 * Counts are DISJOINT: `inputTokens` is uncached input only; cached input is
 * reported separately as `cacheReadTokens`/`cacheWriteTokens` (billed input =
 * sum of the three). Adapters whose providers fold cache hits into a total
 * prompt count (DeepSeek's `prompt_tokens`) subtract them out.
 */
interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}
```

## `BlockAssembler`

`BlockAssembler`([`packages/llm/llm/src/assembler.ts`](../../packages/llm/llm/src/assembler.ts))는 `StreamChunk` 스트림을 `ContentBlock`, 사용량, 종료 이유 및 재생 상태로 다시 접는 단일 공유 구현입니다. 루프는 동일한 청크를 조립기에 전달하면서 원시 청크를 기록한 다음, 조립된 어시스턴트 콘텐츠를 이를 생성한 공급자 및 모델과 함께 저장합니다. 폴드를 다시 구현하지 않고 조립된 결과가 필요한 소비자는 이를 사용합니다.

```ts public-api
/**
 * Incrementally assembles raw {@link StreamChunk}s into complete
 * {@link ContentBlock}s and a final assistant {@link Message}.
 *
 * The agent loop feeds it while logging raw chunks for replay fidelity, then
 * reads `blocks()` / `message()` / `usage` / `finish` once the stream ends.
 *
 * Tolerant of delta-only protocols (no block-start/end); deltas arriving for
 * an index already closed by `block-end` are ignored (malformed stream) so a
 * misbehaving adapter cannot grow memory or corrupt a completed block.
 */
declare class BlockAssembler {
  /**
   * Feed one chunk into the assembly state.
   * @param chunk - the next raw chunk, in stream order.
   */
  push(chunk: StreamChunk): void;
  /**
   * Assemble all blocks seen so far, in stream order.
   * @returns one block per seen index, except that max-token truncation drops
   *   tool calls that cannot be executed safely; an open block assembles from
   *   its accumulated deltas (an unknown block type never closed by `block-end` throws).
   */
  blocks(): ContentBlock[];
  /** Usage from the `usage` chunk; undefined until one arrives. */
  get usage(): TokenUsage | undefined;
  /** Finish reason from the `finish` chunk; `{kind: 'stop'}` when the stream ended without one. */
  get finish(): FinishReason;
  /** Adapter-private replay state from the terminal finish chunk, if any. */
  get replayState(): unknown;
  /**
   * The assembled assistant message.
   * @param source - producer attribution for the assembled message.
   * @returns a frozen assistant-role message over `blocks()` (same open-block assembly rules).
   */
  message(source: MessageSource = { kind: 'plugin', plugin: 'dsh-llm/assembler' }): Message;
}
```

<a id="the-model-request-and-result"></a>

## 모델 요청

하나의 모델 호출은 완전히 조립된 `GenerateOptions`입니다. 어댑터는 원시 [`StreamChunk`](#streamchunk--the-raw-protocol) 스트림으로 응답하며, 소비자는 이를 [`BlockAssembler`](#blockassembler)로 조립합니다.

출처: [`packages/llm/llm/src/types.ts`](../../packages/llm/llm/src/types.ts)

Provider 및 모델 탐색은 작고 Provider에 종속되지 않는 설명자를 사용합니다. 모델 카탈로그는 참고용입니다. 라우팅은 여전히 등록된 Provider를 기준으로 하며, 어댑터는 목록에 없는 모델 id를 허용할 수 있습니다.

어댑터를 등록하면 핸들이 반환됩니다. 여기에는 disposer와 함께, 라우트 집합을 사용자가 설정할 수 있는 플러그인에 필요한 원자적 라우트 교체 기능이 포함됩니다.

```ts type-equiv
/**
 * What {@link LlmRuntime.registerAdapter} returns: the disposer, plus an
 * atomic route replacement for the same adapter instance.
 */
interface AdapterRegistrationHandle {
  /** Release every route this registration currently holds. */
  (): void
  /**
   * Replace this registration's routes with `providers`, keeping the same
   * adapter instance. The candidate set is validated in full first — a
   * conflict with another adapter, an invalid name, or bad provider metadata
   * throws and leaves the current routes untouched — and the swap itself is
   * one synchronous section, so no request can observe a gap. An empty array
   * is legal here (a settings section that emptied holds zero routes while
   * staying registered), unlike an empty initial registration.
   *
   * Throws `LlmError` with code `REGISTRATION_DISPOSED` once the registration
   * has been released: its routes are gone and its disposer has already run,
   * so anything registered afterwards would have no owner left to release it.
   * @param providers - the complete next route set for this registration.
   */
  replace(providers: string[]): void
}
```

```ts type-equiv
/** Display metadata for one registered provider route. */
interface LlmProviderInfo {
  /** Provider route key used by {@link GenerateOptions.provider}. */
  id: string
  /** Human-readable provider name for selectors and diagnostics. */
  name: string
}
```

어댑터 플러그인은 각 라우트가 *실행될*  수 있는 `registerConfigurableProviders()`도 선언하고, 각각의 사용자 설정 섹션을 지정합니다. 따라서 라우트가 등록되기 전에도 설정 화면에서 비활성 Provider를 제공할 수 있습니다.

```ts type-equiv
/**
 * One provider route an adapter plugin can activate through configuration,
 * whether or not the route is currently registered. Configuration surfaces
 * merge this directory with `listProviders()` to offer every configurable
 * provider alongside its live/dormant state.
 */
interface LlmConfigurableProvider {
  /** Provider route key this entry activates when configured. */
  provider: string
  /** Human-readable provider name for configuration surfaces. */
  displayName: string
  /** User-settings namespace whose section configures this provider. */
  settingsNs: string
  /**
   * Path from that namespace's section root to this provider's profile
   * object; empty when the whole section is the profile.
   */
  settingsPath: readonly string[]
  /**
   * Whether the owning adapter knows this route only because configuration
   * declared it — a gateway or self-hosted server it ships nothing about.
   * Absent means the adapter draws no such distinction; false means it does
   * and this route is one of its own. Only the adapter can answer: a stored
   * profile is how a user-added route AND a corrected shipped one both look
   * from outside.
   */
  declared?: boolean
}
```

```ts type-equiv
/** One adapter-discovered model; catalog membership is advisory, not request validation. */
interface LlmModelInfo {
  /** Provider route that owns this model entry. */
  provider: string
  /** Model id passed to {@link GenerateOptions.model}. */
  id: string
  /** Human-readable model name for selectors. */
  name: string
  /** Optional user-facing distinction from otherwise similar models. */
  description?: string
  /** Accepted request modalities; absent means unknown, while an explicit omission is negative capability. */
  inputModalities?: readonly ModelModality[]
}
```

정확성이 중요한 메타데이터는 참고용 카탈로그와 별도로 확인되며, 정확한 라우트를 제공하는 어댑터가 이를 소유합니다. 컨텍스트 용량, 어댑터 호출 기본값, 추론 선택지는 하나의 정확한 모델 결과를 공유하므로 소비자가 권위 있는 모델 확인을 반복하지 않습니다.

```ts type-equiv
/** Provider-owned context capacity for one exact provider/model route. */
interface LlmModelContext {
  /** Maximum combined request and response context in tokens. */
  contextWindow: number
}
```

추론 노력은 또 다른 정확한 라우트 기능입니다. 코어는 식별자를 구분하지만 그 값을 열거하지 않습니다. 각 어댑터가 순서가 지정된 집합, 표시 이름, 선택적 배포 기본값을 소유합니다.

```ts type-equiv
/** Adapter-owned identifier for one model's selectable reasoning effort. */
type ReasoningEffortId = Branded<'ReasoningEffortId'>
```

```ts type-equiv
/** Display metadata for one adapter-owned reasoning effort. */
interface LlmReasoningEffortInfo {
  /** Opaque stable value accepted by {@link GenerateOptions.reasoningEffort}. */
  id: ReasoningEffortId
  /** Human-readable effort name for selectors and diagnostics. */
  name: string
  /** Optional user-facing distinction from otherwise similar efforts. */
  description?: string
}
```

```ts type-equiv
/** Selectable reasoning efforts for one exact provider/model route. */
interface LlmModelReasoningInfo {
  /** Supported efforts in adapter-preferred display order. */
  efforts: readonly LlmReasoningEffortInfo[]
  /**
   * Adapter-configured default materialized into requests when callers omit
   * an effort. Absence preserves the provider's own default.
   */
  defaultEffort?: ReasoningEffortId
}
```

```ts type-equiv
/** Exact-route model metadata resolved by its owning adapter. */
interface LlmResolvedModelInfo extends LlmModelInfo {
  /** Provider-owned context capacity when known. */
  context?: LlmModelContext
  /** Adapter-configured per-request output cap materialized when callers omit one. */
  defaultMaxTokens?: number
  /** Adapter-owned selectable reasoning levels when exposed. */
  reasoning?: LlmModelReasoningInfo
}
```

```ts type-equiv
/** A single model request, fully assembled. */
interface GenerateOptions {
  /** Registered provider route selecting the adapter instance. */
  provider: string
  model: string
  /** Adapter-owned reasoning effort selected for this exact model. */
  reasoningEffort?: ReasoningEffortId
  /**
   * Ordered conversation messages, exactly as the provider sees them (after
   * the `system` slot). A loop-built request assembles them as
   * the derived history (dsh-agent-loop); a hand-built one-shot passes any list.
   */
  messages: Message[]
  /** System prompt text (adapters map to the provider's system slot). */
  system?: string
  /** Tool schemas (adapters map to the provider's `tools` field). */
  tools?: ToolSchema[]
  temperature?: number
  maxTokens?: number
  /**
   * Stop sequences: generation halts as soon as the model produces any one of
   * these strings (adapters map to the provider's stop field, e.g. OpenAI
   * `stop`). The stop string itself is not included in the output.
   */
  stop?: string[]
  signal?: AbortSignal
  /**
   * Session identity stamped by the loop for request routing. Replay uses it
   * to separate cursors; adapters may map it to model-hidden transport metadata.
   */
  sessionId?: Branded<'SessionId'>
  /**
   * Provider-neutral classification for an auxiliary model call. Adapters may
   * map the purpose to model-hidden transport metadata or purpose-specific
   * generation policy. Ordinary conversation requests leave it unset.
   */
  purpose?: 'compaction' | 'session-title'
}
```

모델 응답이 중단된 이유는 병합으로 확장할 수 있는 사유입니다. 종료된 provider 실패에는 스트리밍 계약의 [`LlmFailure`](#llmfailure)가 포함됩니다:

```ts type-equiv
/**
 * Why a model response stopped.
 * Merge-extensible so adapters can surface provider-specific reasons.
 */
interface FinishReasonMap {
  'stop': { kind: 'stop' }
  'tool-calls': { kind: 'tool-calls' }
  'max-tokens': { kind: 'max-tokens' }
  'aborted': { kind: 'aborted'; failure: LlmFailure }
  'error': { kind: 'error'; failure: LlmFailure }
}
```

`FinishReason = FinishReasonMap[keyof FinishReasonMap]`. `TokenUsage`(서로 분리된 캐시 필드가 있는 호출별 계정 처리)는 [아래](#tokenusage)에 자세히 설명되어 있습니다.

`GenerateOptions.tools`에는 모델에 전송되는 도구의 JSON 스키마 설명인 `ToolSchema`가 포함됩니다. 이는 루프가 매 단계 구성하는 요청의 일부이므로 dsh-tools가 아닌 dsh-llm에 선언됩니다:

```ts type-equiv
/**
 * JSON-schema description of a tool, as sent to the model.
 *
 * Declared here (not in dsh-tools) because it is part of {@link GenerateOptions};
 * dsh-tools' ToolDefinition and dsh-system-prompt's PromptAssembly both import
 * it from this package.
 */
interface ToolSchema {
  name: string
  description: string
  /** JSON Schema object for the arguments. */
  parameters: Record<string, unknown>
}
```

모델 지향 `ToolSchema`는 wire type이며, 이를 생성하는 등록된 `ToolDefinition`(스키마 + `execute`)는 [tools.md](tools.md)에 있습니다.

provider가 아직 초안을 작성 중인 surface에는 route나 catalog가 없으므로, 조사는 별도로 설명됩니다. 요청에는 사용자가 편집 중인 초안이 포함되고, 응답은 반드시 제공해야 하는 catalog가 아니라 surface가 채택할 수 있는 후보입니다.

```ts type-equiv
/**
 * One interrogation of a provider endpoint that configuration has not stored
 * yet. Configuration surfaces send the draft a user is still editing, so the
 * request carries the endpoint and credential directly instead of naming a
 * route: a provider being added has no route to name.
 */
interface LlmModelDiscoveryRequest {
  /**
   * Route the draft is editing, when it edits an existing one. A route whose
   * adapter already knows its models answers from that knowledge instead of
   * asking the endpoint — the adapter's own registry is the better answer, and
   * it costs no network call.
   */
  provider?: string
  /**
   * Endpoint to interrogate. Optional because a route the adapter already
   * describes needs none; a route it does not must supply one.
   */
  baseURL?: string
  /** Wire protocol the endpoint speaks, when the draft names one. */
  api?: string
  /** Credential for this interrogation alone; the harness never stores it. */
  apiKey?: string
  /** Caller cancellation; implementations must settle promptly after it aborts. */
  signal?: AbortSignal
}
```

```ts type-equiv
/**
 * One model an endpoint reports about itself. Every field but the id is
 * optional because most provider listings disclose an id and nothing else;
 * a surface adopting one of these still owes the capacities its adapter needs.
 */
interface LlmDiscoveredModel {
  /** Model id the endpoint accepts. */
  id: string
  /** Human-readable name when the endpoint supplies one. */
  name?: string
  /** Maximum combined request and response context, when disclosed. */
  contextWindow?: number
  /** Maximum output tokens, when disclosed. */
  maxTokens?: number
}
```

### 요청 봉투: `LlmCallConfig` 및 기록된 헤더

루프는 기록된 상태에서 각 요청을 구성합니다. `EpochHeader`는 호출 설정을 기록하고, adapter 기본값이 제공한 필드를 표시하며, 완전한 `request/header` 스냅샷을 통해 렌더링된 프롬프트와 권한 있는 반환 도구 순서(`toolOrder`로 구성하거나 설정되지 않은 경우 사전식 순서)를 기록합니다. 파생된 기록과 함께 이를 통해 세션 로그에서 요청을 재구성할 수 있습니다. [session.md](session.md#the-request-header-event-requestheader) 및 [재구성 가능성 Agent Note](../../.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.md)를 참조하세요.

`agent/request`는 고정된 호출 설정 시드를 받고 provider, 모델, 추론 강도 또는 샘플링을 전환할 대체 값을 반환할 수 있습니다. waterfall 전에 루프는 adapter 기본값으로 표시된 값을 제거하여 정확한 모델 준비가 선택한 route의 현재 값을 구체화하도록 합니다. 표시되지 않은 명시적 설정은 proposal에 유지됩니다. waterfall 후 준비 단계는 지원되지 않는 명시적 effort id를 제한하지 않고 거부하며, turn signal 아래에 유효 설정과 adapter 기본값이 제공한 필드를 기록합니다. 준비된 호출은 dispatch를 거치는 동안 하나의 adapter 등록을 유지합니다. `llm/stream`에 도달하는 요청은 deep-freeze되므로 변경하면 예외가 발생하며, 관찰자가 별도로 기록된 고정 보조 호출을 대화 요청으로 혼동하지 않도록 프로세스 로컬 루프 식별자를 포함합니다.

wire에서 루프가 구성한 요청은 `system` 슬롯(렌더링된 프롬프트 조합)을 읽고 그 뒤에 파생된 기록을 읽습니다. 기록된 요청 스냅샷은 turn의 첫 단계에서는 최신 `user/message`로 끝나고, 이후 단계에서는 이전 단계의 도구 결과로 끝납니다. 개발 불변식은 모든 루프 구성 요청에 대해 정확히 이 식을 다시 계산합니다.

FIXME(call-config-shape): 캐시 목적상 남은 필드 중 실제로 epoch 수준인 필드를 재검토합니다(`model` 및 모델 소유의 추론 강도는 명시적이며, 샘플링 스칼라는 신중을 기해 여기에 둡니다).

```ts type-equiv
/**
 * Provider, model, reasoning effort, and sampling scalars of one conversation's
 * requests. Every field maps 1:1 onto the same-named `GenerateOptions` field;
 * the loop builds requests from the logged header rather than accepting these
 * per call.
 */
interface LlmCallConfig {
  provider: string
  model: string
  reasoningEffort?: ReasoningEffortId
  temperature?: number
  maxTokens?: number
  stop?: string[]
}
```

```ts type-equiv
/**
 * Effective config fields supplied by exact-model adapter resolution rather
 * than by the caller's request proposal.
 */
interface LlmCallConfigAdapterDefaults {
  reasoningEffort?: true
  maxTokens?: true
}
```

## 서비스 및 제공자 계약

`LlmAdapter`는 제공자 계약입니다. 하위 클래스를 만들고 `stream()`를 구현한 다음, `ctx.llm.registerAdapter(providers, adapter)`에 어댑터 인스턴스 하나를 등록합니다. `GenerateOptions.provider`는 등록된 어댑터를 선택하며, `GenerateOptions.model`는 해당 어댑터에 전달되고 수명 주기 시작 시 등록되어 있을 필요는 없습니다. 중복된 제공자 경로는 원자적으로 실패합니다. 선택 사항인 `providerRetryPolicy()`는 일반 기본값과 함께 경로별로 캡처되며, `providerInfo()` 및 비동기 `listModels()`는 분리된 선택기 메타데이터와 함께 `LlmRuntime.listProviders()` / `listModels()`에 제공됩니다. 이 카탈로그는 요청 허용 목록이 아니라 참고용입니다. 어댑터는 계속해서 권한을 가지며 나열되지 않은 모델 ID를 수락할 수 있습니다. 하나의 비동기 `resolveModel()` 쿼리는 정확한 모델 ID, 선택 사항인 정확성 민감 컨텍스트 용량, 어댑터로 구성된 `defaultMaxTokens`, 그리고 선택 사항인 배포 기본값을 포함하는 순서가 지정된 모델 소유 추론 ID를 반환합니다. 필드가 없으면 카탈로그 멤버십이 유효하지 않다는 뜻이 아니라 메타데이터를 사용할 수 없거나 제공자가 동작을 소유한다는 뜻입니다. 리졸버는 선택 사항인 취소를 수신하며 중단 후 즉시 완료되어야 합니다. `LlmRuntime.resolveModelInfo()`는 집계 결과를 검증하고 분리합니다. 최종 어댑터 경계에서 `resolveCallConfig()`는 `maxTokens`가 없을 때에만 출력 기본값을 구체화하고, 추론을 검증 및 구체화하므로 직접 호출은 구성된 두 동작 모두를 우회할 수 없습니다. 직접 디스패치는 해당 해석을 기다리기 전에 등록 하나를 캡처합니다. 반면 에이전트 루프는 `prepareCall()`를 사용하여 모델 해석, 내구성 있는 헤더 로깅, 디스패치 전반에 걸쳐 동일한 등록을 유지하고, 정확히 해당 조회에서 분리된 컨텍스트 메타데이터를 보존하며, 어댑터가 어떤 구성 필드를 기본값으로 설정했는지 보고합니다. 어댑터 조회는 `llm/stream` 폭포의 최종 연속에서 발생하므로 리스너는 조회 전에 호출을 단락시키거나 변경 가능한 일회성 요청을 라우팅할 수 있습니다. AgentLoop는 외부 폭포가 스트림 핸들을 반환하면 요청 시도를 한 번 관찰합니다. 이 제한된 경계는 지연된 최종 어댑터가 생성되었거나 제공자 I/O를 시작했음을 증명하지 않습니다. `block-start` / `block-end` `index` 상관관계와 어셈블러는 함께 어댑터가 올바른 형식의 청크만 내보내면 됨을 의미합니다. 블록 재조립은 각 어댑터의 문제가 아닙니다. [architecture.md](../architecture.md#turn-flow)에서는 `ctx.llm.stream()`와 `llm/stream` 폭포가 한 턴에서 어디에 위치하는지 보여 줍니다.

```ts type-equiv
/** One model call whose config and adapter registration were resolved together. */
interface PreparedLlmCall {
  /** Detached, deep-frozen config with any adapter-owned default materialized. */
  readonly config: LlmCallConfig
  /** Immutable retry policy captured with the adapter registration. */
  readonly retryPolicy: ResolvedRetryPolicy
  /** Detached context metadata resolved with the registration-bound call. */
  readonly context?: LlmModelContext
  /** Config fields materialized by the captured adapter rather than proposed by the caller. */
  readonly adapterDefaults: LlmCallConfigAdapterDefaults
  /**
   * Dispatch this call once through the registration captured during
   * preparation. The request's call-config fields must match {@link config};
   * reuse or mismatch fails with `INVALID_PREPARED_CALL`.
   * @param options - fully assembled request carrying the prepared config.
   * @returns the chunk stream, including the `llm/stream` waterfall.
   */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}
```

```ts public-api
/**
 * Provider-wire adapter for the harness message and stream vocabulary. Register implementations
 * with `ctx.llm.registerAdapter(providers, adapter)`. Every provider HTTP request must include
 * `attributionHeaders()`; prove the headers are added in the wire request or library header hook. The direct-fetch
 * DeepSeek and library-backed pi-ai adapters meet this contract through different internals.
 */
declare abstract class LlmAdapter {
  /**
   * Describe one provider route owned by this adapter.
   * @param provider - a route passed to `registerAdapter()` for this instance.
   * @returns detached display metadata whose id must equal `provider`.
   */
  providerInfo(provider: string): LlmProviderInfo;
  /**
   * Return the provider-owned retry policy captured with this route.
   * @param _provider - a route passed to `registerAdapter()` for this instance.
   * @returns a resolved policy, or `undefined` to use the normal defaults.
   */
  providerRetryPolicy(_provider: string): ResolvedRetryPolicy | undefined;
  /**
   * List models this adapter can currently advertise for one owned provider.
   * The result is advisory: an adapter may accept unlisted model ids, and
   * consumers must not turn absence into request rejection.
   * @param _provider - one provider route owned by this adapter.
   * @returns discoverable models in adapter-preferred order.
   */
  listModels(_provider: string): Promise<readonly LlmModelInfo[]>;
  /**
   * Resolve all metadata available for one exact model. This query is
   * independent of the advisory catalog and does not validate request routing.
   * @param provider - one provider route owned by this adapter.
   * @param model - exact model id passed to {@link GenerateOptions.model}.
   * @param _signal - cancellation for this exact-model lookup; asynchronous
   *   implementations must settle promptly after it aborts.
   * @returns provider/model identity plus any context, call-default, and reasoning metadata.
   */
  resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo>;
  /**
   * Stream one model call as raw chunks. The only required method.
   * @param options - the fully-assembled request; implementations must honor `options.signal`.
   * @returns the chunk stream, obeying the adapter contract documented on `StreamChunk`.
   */
  abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
```

`ContentBlockType`(`index`로 상관관계가 지정된 블록이 전달하는 키 집합)는 위의 [`ContentBlockMap`](#content-blocks-and-messages)에서 파생됩니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`가 소스에서 생성합니다(doc-sync에서 `pnpm run verify-cordis-catalog`로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`로 다시 생성). 이 섹션은 페이지의 두 언어 버전에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxllm--llmruntime"></a>

### `ctx.llm` — `LlmRuntime`

추상 `llm` 서비스: 어댑터 레지스트리와 `llm/stream` 폭포를 통해 가로챌 수 있는 스트리밍 모델 호출 API입니다.

```ts cordis-catalog
/**
 * Register an adapter for the given provider routes. Throws `LlmError` with code
 * `DUPLICATE_ADAPTER` if any provider already has an adapter (all-or-nothing).
 * Disposed with the fiber.
 * @param providers - every provider route this adapter should serve.
 * @param adapter - the adapter that streams calls for those providers.
 * @returns the disposer, carrying {@link AdapterRegistrationHandle.replace}.
 */
registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle

/**
 * Describe provider routes with a registered adapter.
 * @returns detached provider metadata in registration order.
 */
listProviders(): LlmProviderInfo[]

/**
 * Declare provider routes an adapter plugin can activate through
 * configuration. Registration is all-or-nothing: an empty list, invalid
 * entry, or a provider already declared by any registration throws
 * `LlmError` without registering the rest. Disposed with the fiber.
 * @param entries - every configurable provider this plugin owns.
 * @returns a handle that withdraws all of them, and can atomically replace them.
 */
registerConfigurableProviders(entries: readonly LlmConfigurableProvider[]): DirectoryRegistrationHandle

/**
 * List every declared configurable provider, registered or dormant.
 * @returns detached directory entries in declaration order.
 */
listConfigurableProviders(): LlmConfigurableProvider[]

/**
 * Offer to interrogate provider endpoints on behalf of the settings
 * namespace this plugin owns. The namespace is the key because that is what
 * a configuration surface already holds from the configurable-provider
 * directory, and because a provider being *added* has no route to name yet.
 * Disposed with the fiber.
 * @param settingsNs - the namespace whose profiles this discovery serves.
 * @param discover - interrogates one endpoint; must honor `request.signal`.
 * @returns the disposer that withdraws the offer.
 */
registerModelDiscovery( settingsNs: string, discover: (request: LlmModelDiscoveryRequest) => Promise<readonly LlmDiscoveredModel[]>, ): () => void

/**
 * Interrogate one provider endpoint for the models it advertises. The
 * request describes a draft, not a stored route, so nothing here reads or
 * writes settings or credentials — the caller owns both, and the reply is
 * candidate metadata a surface may offer for adoption.
 * @param settingsNs - namespace whose registered discovery serves this draft.
 * @param request - the endpoint, protocol, and one-shot credential to use.
 * @returns the advertised models, deduplicated in endpoint order.
 */
async discoverModels( settingsNs: string, request: LlmModelDiscoveryRequest, ): Promise<LlmDiscoveredModel[]>

/**
 * Resolve the retry policy captured when one provider route was registered.
 * @param provider - registered provider route to inspect.
 * @returns the provider-owned policy, with normal defaults already resolved.
 */
providerRetryPolicy(provider: string): ResolvedRetryPolicy

/**
 * Discover models advertised by one registered provider. Catalog membership
 * is advisory and never changes routing or request validation.
 * @param provider - registered provider route to inspect.
 * @returns detached model metadata in adapter-preferred order.
 */
async listModels(provider: string): Promise<LlmModelInfo[]>

/**
 * Resolve and validate all metadata from the adapter that owns one exact
 * route. The result is detached from adapter-owned objects; catalog
 * membership remains advisory and does not control request routing.
 * @param provider - registered provider route to inspect.
 * @param model - exact model id passed to the adapter.
 * @param signal - optional cancellation for adapter-owned asynchronous lookup.
 * @returns exact model identity plus available context and reasoning metadata.
 */
async resolveModelInfo( provider: string, model: string, signal?: AbortSignal, ): Promise<LlmResolvedModelInfo>

/**
 * Validate a conversation call config against its exact model capability and
 * materialize adapter-configured defaults. Unsupported explicit efforts
 * reject before provider I/O; no clamping or aliasing is performed. This
 * standalone query does not bind a later dispatch; use {@link prepareCall}
 * when logging and streaming must share one adapter registration.
 * @param config - provider/model route and optional request controls.
 * @param signal - optional cancellation for adapter-owned capability lookup.
 * @returns a detached config only when a default must be materialized.
 */
async resolveCallConfig(config: LlmCallConfig, signal?: AbortSignal): Promise<LlmCallConfig>

/**
 * Resolve one call under its current adapter registration. The returned
 * one-shot handle keeps that registration across header logging and dispatch,
 * so HMR cannot combine one adapter's capability result with another adapter.
 * @param config - provider/model route and optional request controls.
 * @param signal - optional cancellation for adapter-owned capability lookup.
 * @returns a prepared config and its registration-bound stream entry point.
 */
async prepareCall(config: LlmCallConfig, signal?: AbortSignal): Promise<PreparedLlmCall>

/**
 * Stream one model call as raw chunks (token-level deltas). Replay state is
 * retained only when the same adapter instance owns its historical provider
 * and the target provider. Final adapter selection remains fixed through
 * asynchronous exact-model resolution and dispatch. Adapter selection,
 * dispatch, and iteration failures become terminal `error` or `aborted`
 * finish chunks; middleware, nested-call, cleanup, and consumer failures
 * remain thrown.
 * @param options - the full request; `options.provider` selects the adapter.
 * @returns the chunk stream, possibly wrapped by `llm/stream` listeners.
 */
stream(options: GenerateOptions): AsyncIterable<StreamChunk>
```

출처: [`packages/llm/llm/src/index.ts:284`](../../packages/llm/llm/src/index.ts)

<a id="llm-events"></a>

### `llm/*` 이벤트

<a id="llmadapters-updated--emit"></a>

#### `llm/adapters-updated` — 방출

공급자 토폴로지가 변경되었습니다. 어댑터가 경로를 등록하거나 등록 해제했거나, 구성 가능한 공급자 디렉터리에 항목이 추가되거나 제거되었습니다. 페이로드가 없는 이 레지스트리 알림은 각 커밋 시점(등록 해제 포함)에 발생하며, 소비자는 새 상태를 확인하기 위해 `listProviders()`, `listModels()` 또는 `listConfigurableProviders()`를 다시 읽습니다. 관찰자 실패는 격리되며 레지스트리 변경을 거부할 수 없습니다.

```ts cordis-catalog
/**
 * The provider topology changed: an adapter registered or unregistered
 * routes, or the configurable-provider directory gained or lost entries.
 * This payload-free registry notification fires at each commit point
 * (including registration disposal); consumers re-read `listProviders()`,
 * `listModels()`, or `listConfigurableProviders()` for the new state.
 * Observer failures are contained and cannot veto the registry mutation.
 * @mode emit
 */
'llm/adapters-updated'(): void
```

출처: [`packages/llm/llm/src/types.ts:23`](../../packages/llm/llm/src/types.ts)

<a id="llmstream--waterfall"></a>

#### `llm/stream` — 워터폴

모든 스트리밍 모델 호출(재시도, 재생, 라우팅)을 감싸는 워터폴입니다. LlmRuntime에 바인딩되며, `next()`를 호출하여 해석된 어댑터의 스트림에 도달하거나 자체 청크를 yield하여 단락할 수 있습니다.

```ts cordis-catalog
/**
 * Waterfall around every streaming model call (retry, replay, routing).
 * Bound to the {@link LlmRuntime}; call `next()` to reach the resolved
 * adapter's stream, or yield your own chunks to short-circuit.
 * @param options - the full request. A LOOP-built request carries the
 *   process-local {@link markAgentLoopRequest} identity and arrives deep-frozen
 *   (mutation throws): its content is a pure function of the session log (the
 *   reconstructability Agent Note), so listeners read it, never rewrite it.
 *   Hand-built calls do not carry that marker; their messages already obey
 *   the immutable creation contract.
 * @mode waterfall
 */
'llm/stream'(this: LlmRuntime, options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>
```

출처: [`packages/llm/llm/src/index.ts:64`](../../packages/llm/llm/src/index.ts)
<!-- END GENERATED cordis-surface -->
