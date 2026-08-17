# 도구

[dsh-tools](../../packages/core/tools)의 도구 파이프라인입니다. [core.md](core.md)에서는 핵심 패키지에서 공유하는 파이프라인 작성 타입인 `ToolDefinition`를 소개합니다. 모델 요청과 함께 모델 지향 [`ToolSchema`](llm-streaming.md#the-model-request-and-result) 와이어 타입이 선언됩니다. 이 페이지에서는 모든 `ToolDefinition` 필드, 이를 구성하는 타입 지정 스키마 DSL, 보호된 실행 타입 및 UI 표현 타입을 설명합니다.

소스: [`packages/core/tools/src/index.ts`](../../packages/core/tools/src/index.ts) · [`packages/core/tools/src/schema.ts`](../../packages/core/tools/src/schema.ts) · [`packages/core/tools/src/presentation.ts`](../../packages/core/tools/src/presentation.ts)

## `ToolDefinition` — 등록된 도구

`ToolSchema`(모델 지향 필드)에 필수 정규 출력 선언, `execute` 함수, 호스트 전용 스케줄러 메타데이터, 선택적 최종 콘텐츠 콜백 및 선택적 UI 프레젠터를 더한 것입니다. 레지스트리는 이를 보관하고 루프는 이를 통해 호출을 디스패치합니다. 레지스트리의 `schemas()`는 명시적 허용 목록으로 모델 지향 `ToolSchema[]`를 구성합니다. `output`/`execute`/`finalizeContent`/`timeoutMs`/`isConcurrencySafe`/`presentCall`/`presentResult`는 절대로 모델 요청에 노출되어서는 안 됩니다.

```ts type-equiv
/** Tool-owned canonical output contract used after the body returns a JSON value. */
interface ToolOutputDefinition {
  /** Raw supported JSON Schema enforced against every successful canonical value. */
  readonly schema: JsonSchemaNode
  /** Pure projection from validated arguments and value to Native/model content. */
  render(args: unknown, value: JsonValue): ContentBlock[]
  /** Pure replayable presentation projection, computed only for top-level calls. */
  presentationMeta?(args: unknown, value: JsonValue): JsonValue
}
```

```ts type-equiv
/** A registered tool: its schema plus the execution function. */
interface ToolDefinition extends ToolSchema {
  /** Mandatory canonical output declaration. */
  readonly output: ToolOutputDefinition
  /**
   * Run one accepted call and return only its canonical lossless-JSON value.
   * Async work must observe or forward `exec.signal` and settle only after its
   * owned work reaches quiescence. The registry preserves caller cancellation
   * through around-dispatch signal replacement and does not abandon this
   * promise, but it cannot hard-kill same-process code.
   * @param args - losslessly snapshotted, frozen model arguments.
   * @param exec - execution identity, cancellation signal, and context deferral.
   * @returns the canonical value declared by `output.schema`.
   */
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  /**
   * Synchronous last-mile transform for model-facing content. The registry
   * snapshots this callback when execution starts and invokes it exactly once
   * for every normalized outcome, including pipeline failures that bypass
   * `tools/post-execute`, immediately before lossless materialization.
   * Returning `undefined` preserves the content; every other result field
   * remains registry-owned. The callback must be total and must not throw.
   * @param exec - immutable execution identity and arguments.
   * @param result - complete normalized outcome before materialization.
   * @returns replacement content, or `undefined` to preserve it.
   */
  finalizeContent?(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): ContentBlock[] | undefined
  /**
   * Cooperative tool-call timeout budget in milliseconds. Omit for no deadline.
   * Enforced by `@deepseek-ai/dsh-tool-call-timeout-policy` (a `tools/execute` wrapper); it
   * is NEVER sent to the model — `schemas()` whitelists only name/description/
   * parameters. Declaring it asserts this tool forwards `exec.signal` to a
   * cooperative implementation that can reach quiescence when the signal aborts.
   */
  timeoutMs?: number
  /**
   * Pure synchronous classifier for overlap with sibling tool calls. Only
   * `true` opts in; omission, exceptions, non-`true` returns, and invalid
   * `defineTool` arguments are exclusive. This metadata is never model-visible.
   *
   * Opted-in executions must not mutate parent-owned state. Shared state must
   * tolerate concurrent dispatch; recorder races are permitted only when they
   * commute or fail closed. See the
   * [parallel-tool-call Agent Note](../../../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md)
   * for the full contract.
   * @param args - parsed arguments; `defineTool` validates before calling.
   * @returns Whether this call may join a parallel group.
   */
  isConcurrencySafe?(args: unknown): boolean
  /**
   * Optional: how to present the PENDING state of one call in a UI, derived from
   * the call's `args` (parsed arguments, `unknown` — the tool validates/narrows
   * its own input). Returns a {@link ToolCallView} (a `card`-tagged render intent),
   * or `undefined` (or omit the method) to fall back to a generic presentation
   * (title = tool name, raw args as input). Pure and side-effect-free: a UI may
   * call it during live streaming AND a session-log replay, so it must depend
   * only on `args`.
   */
  presentCall?(args: unknown): ToolCallView | undefined
  /**
   * Optional: how to present the COMPLETED state, given the same `args` and the
   * durable result projection (`content`, failure state, and optional `meta`). Returns a
   * {@link ToolResultView}, or `undefined` (or omit the method) to keep the
   * pending title and render the raw result content. Pure and side-effect-free
   * for the same replay reason.
   */
  presentResult?(args: unknown, result: ToolResult): ToolResultView | undefined
}
```

`execute`는 원시 `ToolDefinition`가 자체 입력을 검증하는 `args: unknown`를 받습니다. 자사 도구는 이를 직접 작성하지 않고, 인수를 검증하고 좁히며 `output.schema`에서 본문 반환 타입을 추론하고 두 출력 프로젝터 모두에 타입을 지정하는 `defineTool`를 사용합니다. `finalizeContent`는 잘못된 입력과 외부 파이프라인 실패도 여기에 도달하므로, 타입 지정 인수 대신 의도적으로 불변 실행을 받습니다. 이는 `isError`, 정규 값, 구조화된 오류 식별자, 지연된 컨텍스트 및 표현 메타데이터를 보존하면서 도구 소유 콘텐츠 경계를 강제할 수 있습니다.

## 통합 JSON 값 스키마 DSL

플러그인 작성자는 타입 지정 매개변수와 타입 지정 출력 값에 하나의 어휘를 사용합니다. `ValueSchemaSpec`는 `string`, `number`, `integer`, `boolean`, `null`, `array`, `object`, 작성자 전용 `json` 및 정확히 하나인 `oneOf`를 지원합니다. 스칼라 `enum` 및 `const` 값은 노드 타입과 일치해야 합니다. 명시적 객체 노드는 항상 `additionalProperties: true | false`를 선언합니다. 매개변수 정의는 암시적 열린 객체 속성 맵으로 유지되며, `required: true`는 각 필수 속성에 연결됩니다.

소스: [`packages/core/tools/src/schema.ts`](../../packages/core/tools/src/schema.ts)

```ts type-equiv
/** One author-facing schema for any lossless JSON value root. */
type ValueSchemaSpec =
  | StringValueSchemaSpec
  | NumberValueSchemaSpec
  | IntegerValueSchemaSpec
  | BooleanValueSchemaSpec
  | NullValueSchemaSpec
  | ArrayValueSchemaSpec
  | ObjectValueSchemaSpec
  | JsonValueSchemaSpec
  | OneOfValueSchemaSpec
```

```ts type-equiv
/** One implicit parameter-root property, optionally required. */
type ParameterPropertySpec = ValueSchemaSpec & { required?: true }
```

```ts type-equiv
/**
 * Tool parameter schema. The map itself is an implicit open object root;
 * requiredness remains a per-property `required: true` annotation.
 */
type ParameterSchemaSpec = {
  [key: string]: ParameterPropertySpec
  [key: symbol]: never
}
```

`{ type: 'json' }`는 `JsonValue`를 추론하고 주석 전용의 제약 없는 원시 스키마로 컴파일합니다. 출력 루트는 객체, 배열, 스칼라 또는 null일 수 있습니다. `InferValue<S>`는 16개 컨테이너 수준에 걸쳐 리터럴 제약과 객체 개방성을 준수한 후, TypeScript의 타입 인스턴스화 스택을 소진하는 대신 `JsonValue`로 대체합니다. `InferArgs<P>`는 속성별 필수 여부를 필수 및 선택적 문자열 키로 변환합니다:

```ts type-equiv
/**
 * Infer the TypeScript value accepted by an author-facing value schema. Exact
 * inference is bounded to 16 container levels, then falls back to `JsonValue`.
 */
type InferValue<S> = InferValueAt<S, []>
```

```ts type-equiv
/** Infer the TypeScript argument object for an implicit parameter schema. */
type InferArgs<S> = InferProperties<S, []>
```

`defineTool({ name, description, parameters, output, execute, … })`는 매개변수 추론을 `parameterSchemaSpecToJsonSchema()` 및 `validateArgs()`에 연결하고, `execute`/`render`/`presentationMeta`를 `InferValue<OutputSchema>`에 연결합니다. 스키마 레코드는 자체 열거 가능한 문자열 키만 포함하며, 스키마 배열은 조밀한 내장 배열이므로 추론, 컴파일, 검증이 동일한 선언을 관찰합니다. 추론은 16개 컨테이너 수준까지 정확하게 유지된 후 `JsonValue`로 확장됩니다. 런타임 검증은 전체 스키마를 계속 순회합니다. `valueSchemaSpecToJsonSchema()`는 동일하게 강제되는 원시 하위 집합을 통해 출력 선언을 컴파일합니다. 매개변수가 일치하지 않으면 `ToolArgsError`(`INVALID_ARGS`)를 발생시키며, 본문 또는 정책 적용 후 값이 유효하지 않으면 `ToolOutputError`(`INVALID_TOOL_OUTPUT`)를 발생시킵니다. 둘 다 일반 도구 오류 경로를 사용합니다. 원시 JSON Schema는 기본적으로 열려 있으며, 지원되지 않는 키워드는 강제 없이 허용되는 대신 거부됩니다.

등록은 신뢰할 수 있는 동일 프로세스 계약입니다. 레지스트리는 타입이 지정된 정의를 읽기 전용 입력으로 빌리고, `output`를 요구하며, 원시 스키마를 검증하고, 양의 유한한 `timeoutMs` 등의 의미론적 요구 사항을 확인합니다. `schemas()`는 요청을 빌드할 때 모델 대상 프로젝션을 구성하므로, 콜백을 와이어에 노출하지 않으면서 실행과 프레젠테이션이 하나의 확인된 정의를 공유합니다.

## `ToolRestriction` — 하나의 스코프가 상속하는 항목에 적용하는 라이브 필터

`ToolRestriction`는 스코프가 상속하는 도구, 즉 배포 전역 계층과 해당 체인의 모든 상위 스코프에 적용됩니다. 레지스트리는 읽기 전용 이름을 비공개 세트로 컴파일하고, 여러 제한을 교차한 다음, 스코프의 자체 등록을 오버레이합니다. 자체 등록은 위임된 하위 항목이 응답하는 도구를 계속 유지하도록 예외로 남습니다. 거부 전용 필터는 나중에 추가된 목록에 없는 상속 도구를 허용하는 반면, 허용 목록은 이를 제외합니다.

```ts type-equiv
/**
 * Per-scope filter over global tools. Restrictions intersect and do not affect
 * scoped registrations or the reserved Code Mode transport.
 */
interface ToolRestriction {
  /** Global tool names that stay visible; everything else is removed. */
  readonly allow?: readonly string[]
  /** Global tool names removed from visibility. */
  readonly deny?: readonly string[]
}
```

## 실행: 확장 가능한 워터폴과 단조 정책

`ctx.tools.execute()`는 필수 읽기 전용 `signal`가 있는 호출자 소유의 `ToolExecutionInput`를 받고, 파싱된 JSON 인수를 한 번만 파이프라인 소유의 `ToolExecution`로 구체화한 뒤, 해당 호출을 `tools/pre-execute`(순서를 변경할 수 있는 allow/deny/ask 워터폴) → 등록된 단조 가드 → `tools/execute`(디스패치 주변 래퍼) → `tools/post-execute`(결과 검사/교체) → 선택적 정의 소유 `finalizeContent` → `tools/result`(불변의 권위 있는 결과) 순으로 실행합니다. 필수 신호는 `tools/execute` 뷰만 교체할 수 있습니다. 결과는 `ToolExecutionResult`입니다.

```ts type-equiv
/** Opaque call identity that permits correlation without exposing mutable execution state. */
type ToolExecutionToken = symbol & { readonly [toolExecutionTokenBrand]: true }
```

```ts type-equiv
/**
 * Caller-supplied description of one tool call. {@link ToolRuntime.execute}
 * adds the registry-owned token to form a pipeline {@link ToolExecution};
 * callers do not choose that token.
 */
interface ToolExecutionInput {
  readonly callId: CallId
  /**
   * Root model-requested call owning this execution tree. Callers omit it for
   * a root execution; nested dispatchers propagate the enclosing value.
   */
  readonly rootCallId?: CallId
  readonly name: string
  /** Losslessly JSON-serializable parsed arguments (tools validate their own schema). */
  readonly arguments: unknown
  /** The agent on whose behalf the call runs (set by the agent loop). */
  readonly agent?: Agent
  /**
   * Opaque token of the enclosing transport execution, when one exists. Code
   * Mode sets this on SDK sub-dispatches so commit-style observers can wait for
   * the outer `run_code` outcome without receiving its live mutable execution.
   * The token also marks the call as a transport sub-dispatch rather than a
   * model-direct call: under `mode: 'code'`, only calls WITH a parent may
   * execute a native tool name — a model-direct call (no parent) is denied as
   * `UNKNOWN_TOOL` before the policy pipeline. See {@link ToolRuntime.execute}.
   */
  readonly parent?: ToolExecutionToken
  /** Required caller-owned cancellation for this invocation. */
  readonly signal: AbortSignal
}
```

도구 본문은 런타임 확장을 받습니다. `deferContext()`는 아직 열려 있는 외부 호출 내부에 주입하지 않고, 실행 자체의 결과에 컨텍스트를 연결합니다. 이는 복합 도구의 중첩 디스패치 채널이며, 플러그인 소스 명령을 생성하는 리프 도구에서도 사용할 수 있습니다.

```ts type-equiv
/**
 * Runtime context handed to a tool implementation after the registry has
 * accepted a {@link ToolExecution}. {@link deferContext} attaches context to
 * this execution's own result — a composite tool ferries nested-dispatch
 * context back to the outer result, and a leaf tool may mint a fresh
 * plugin-sourced instruction; the loop appends it only after the
 * `tool/result`.
 */
interface ToolRunContext extends ToolExecution {
  /**
   * Defer one context — typically a nested-dispatch context ferried by a
   * composite tool, or a fresh plugin-sourced instruction — until this tool's
   * final result reaches the agent loop. Contexts retain their individual
   * source and metadata and are emitted in call order.
   */
  deferContext(context: UserMessage): void
  /**
   * Mark a successful final result as terminal for the current agent turn.
   * The marker rides this execution's own result (`concludesTurn` exists only
   * on {@link ToolExecutionSuccess}); a composite that dispatches nested
   * calls forwards it from the nested result, exactly like
   * `additionalContexts`, so only an authoritative nested success can
   * conclude the enclosing run.
   */
  concludeTurn(): void
}
```

에이전트 루프는 레지스트리에 각 대기 중인 호출의 실행 모드를 요청하고, 이를 사용하여 배타적 장벽 및 롤링 풀 병렬 실행을 구성합니다:

```ts type-equiv
/**
 * Scheduling mode for one pending call. `parallel` may overlap with siblings;
 * `exclusive` runs alone and forms an ordering barrier.
 */
type ToolExecutionMode =
  | { kind: 'parallel' }
  | { kind: 'exclusive' }
```

Code Mode의 브리지는 추가로 정산된 각 하위 디스패치를 `tools/code-dispatch-log` 워터폴에 노출합니다. 이 워터폴은 영속 이벤트에 있는 콘텐츠 사본을 변경할 수 있습니다(프로그램의 값과 모델에 표시되는 결과는 변경되지 않음):

```ts type-equiv
/**
 * One settled `run_code` sub-dispatch about to be logged, as seen by the
 * `tools/code-dispatch-log` waterfall: the parent execution (session owner,
 * outer call identity), the sub-call identity, and the outcome whose durable
 * copy a listener may reshape. `content` is the RENDERED result projection
 * (what a native `tool/result` would carry) — the program itself received
 * the structured `value` (or just the error message on failure); only the
 * `tool/code-dispatch` event's copy changes.
 */
interface CodeDispatchLog {
  /** The outer `run_code` execution. */
  readonly exec: ToolExecution
  /** The calling agent (the scope routing key and the spill owner), when the outer call has one. */
  readonly agent?: Agent
  /** Deterministic sub-call id (`<parent>:code:<n>`). */
  readonly subCallId: CallId
  /** The dispatched sub-tool name. */
  readonly name: string
  /** Whether the sub-call settled as an error. */
  readonly isError: boolean
  /** The sub-call's complete model-facing content (the settle event's default payload). */
  readonly content: ContentBlock[]
}
```

```ts type-equiv
/**
 * One pending tool call inside the registry pipeline. Parsed arguments cross
 * one lossless-JSON materialization boundary before policy and are deep-frozen;
 * call identity, the caller signal, and the registry-assigned {@link token} are
 * readonly. The registry freezes the complete object before `tools/result`
 * observers run.
 */
interface ToolExecution extends ToolExecutionInput {
  /** Root model-requested call, resolved for every root and nested execution. */
  readonly rootCallId: CallId
  /** Registry-assigned identity shared with nested calls only as their opaque `parent` token. */
  readonly token: ToolExecutionToken
}
```

```ts type-equiv
/**
 * Around-dispatch view of a {@link ToolExecution}. A `tools/execute` wrapper
 * may replace the signal for its delegated lifetime, but it cannot remove it.
 * The registry fuses every replacement with the captured caller signal.
 */
interface ToolDispatchExecution extends Omit<ToolExecution, 'signal'> {
  /** Cancellation signal visible to the next wrapper or tool body. */
  signal: AbortSignal
}
```

`ToolExecutionToken`은(는) 식별성 비교에만 사용되는 불투명 런타임 `Symbol`입니다. 정책 적용 전에 `execute()`은(는) 인수를 구체화하고 동결하며, JSON이 아닌 입력을 거부하고 토큰을 할당합니다. 식별성 필드, 필수 호출자 신호 및 선택적 부모 토큰은 readonly로 유지됩니다. `ToolDispatchExecution` 래퍼는 신호를 대체할 수는 있지만 제거할 수는 없습니다. 레지스트리는 본문을 호출하기 전에 호출자 신호를 다시 융합합니다. 최종 관찰자는 동결된 실행 식별성을 수신합니다.

`ToolGuard`은(는) 범위를 인식하는 최종 디스패치 전 정책입니다. 반환 타입에는 의도적으로 허용 결과가 없습니다. `undefined`은(는) 워터폴 결정을 보존하고, 반환된 이유는 권한만 축소할 수 있으므로 이후 리스너가 이를 되돌릴 수 없습니다.

```ts type-equiv
/**
 * A monotonic execution guard evaluated after every `tools/pre-execute`
 * listener and before the tool body. Returning a reason denies the call;
 * returning `undefined` leaves it unchanged. Because guards have no allow
 * result, listener ordering cannot turn a denial back into permission.
 * @param execution - the identity-protected call after extensible pre-execute policy completed.
 * @returns a final denial reason, or `undefined` to leave the call allowed.
 */
type ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined
```

```ts type-equiv
/** Canonical failure detail; internal routing information remains optional. */
interface ToolFailure {
  /** Human-readable failure message without the Native `Error: ` envelope. */
  message: string
  /** Internal error class/code used by policy and durable diagnostics. */
  info?: ToolErrorInfo
}
```

```ts type-equiv
/** Successful canonical tool execution, including its Native/model projection. */
interface ToolExecutionSuccess {
  readonly isError: false
  /** Execution-local canonical value; deliberately omitted from durable events. */
  readonly value: JsonValue
  readonly content: ContentBlock[]
  readonly error?: never
  readonly meta?: JsonValue
  readonly additionalContexts?: UserMessage[]
  /** The agent loop stops after committing this successful result batch. */
  readonly concludesTurn?: true
}
```

```ts type-equiv
/** Failed canonical tool execution; failures never carry a successful value. */
interface ToolExecutionFailure {
  readonly isError: true
  readonly error: ToolFailure
  readonly value?: never
  readonly content: ContentBlock[]
  readonly meta?: JsonValue
  readonly additionalContexts?: UserMessage[]
  readonly concludesTurn?: never
}
```

```ts type-equiv
/** The discriminated, execution-local outcome of one tool call. */
type ToolExecutionResult = ToolExecutionSuccess | ToolExecutionFailure
```

결과에는 결과값만 포함됩니다. 호출 식별성은 모든 훅을 거쳐 함께 전달되는 불변 `ToolExecution` 및 영속적인 `tool/call` / `tool/result` 세션 이벤트에 남아 있으므로, 래퍼는 서로 불일치하는 두 번째 식별성을 만들 수 없습니다. 정규 `value`은(는) 실행 로컬입니다. 루프는 `content`, `error` 및 `meta`만 영속화하며, `tool/code-dispatch`에는 하위 호출에서 렌더링된 `content` 및 `isError`이(가) 그대로 저장됩니다. 재생은 표현을 재현하지만 정규 중간값을 복원할 수는 없습니다.

성공하면 레지스트리는 본문 값을 스냅샷하고 검증한 뒤 동결하고, 순수 렌더러와 선택적 최상위 호출 메타데이터 프로젝터를 호출합니다. `tools/result` 직전에 영속적 표현 필드를 별도로 구체화합니다. 잘못된 값, 렌더러/프로젝터 실패 또는 JSON이 아닌 표현은 JSON 안전 `isError`이(가) 됩니다. 따라서 최종 라이브 관찰자는 이후 영속적 추가에 안전한 필드와 함께 정확한 실행 로컬 값을 확인합니다.

최종 콘텐츠 전에 레지스트리는 후보 결과를 구체화합니다. 콘텐츠, 구조화된 오류, 추가 컨텍스트 또는 표현 메타데이터에서 발생한 실패는 JSON 안전 `isError` 결과가 되며, 이 결과도 `finalizeContent`에 계속 도달합니다. 레지스트리는 해당 콜백을 정확히 한 번 호출한 다음, `tools/result` 직전에 승인된 결과를 구체화하고 동결합니다. 따라서 관찰된 라이브 결과는 이후의 영속적 `tool/result` 추가에 안전합니다.

각 인터셉션 워터폴은 형식화된 **결정** 을(를) 반환합니다(`agent/*` 워터폴과 공유하는 관용구입니다). `tools/pre-execute` 리스너는 `(exec, next)`을(를) 수신하고 `PreToolDecision`을(를) 반환합니다. `tools/execute` 래퍼는 `ToolExecutionResult`을(를) 반환하며, `tools/post-execute` 리스너는 `(exec, result, next)`을(를) 수신하고 `PostToolDecision`을(를) 반환합니다.

```ts type-equiv
/**
 * Pre-dispatch decision. `allow` runs the call; `deny` materializes an error;
 * `ask` runs only after an approval service returns `allowed-once` and otherwise
 * denies. Input rewriting is excluded because arguments are already logged and
 * presented.
 */
type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string }
```

```ts type-equiv
/**
 * Post-dispatch decision: accept, replace one projection, attach context for the
 * next request, or block by turning corrective feedback into an error result.
 */
type PostToolDecision =
  | { kind: 'accept'; content?: ContentBlock[]; value?: never; additionalContexts?: UserMessage[] }
  | { kind: 'accept'; value: JsonValue; content?: never; additionalContexts?: UserMessage[] }
  | { kind: 'block'; feedback: ContentBlock[]; additionalContexts?: UserMessage[] }
```

기본 동작에는 `next()`을(를) 호출하거나, 단락 평가하려면 결정을 반환합니다. 사전 정책은 거부하거나 요청할 수 있습니다. `allowed-once`만 진행하며, 승인되지 않은 결과, 누락된 승인 채널 또는 서비스, 에이전트 없는 요청은 모두 거부가 됩니다. 가드는 여전히 최종 거부를 적용할 수 있습니다. 이력, 감사, UI 및 실행이 일치해야 하므로 인수는 다시 작성할 수 없습니다.

정책 후처리는 콘텐츠 또는 값 중 하나만 대체할 수 있으며, 둘 다 대체할 수는 없습니다. 콘텐츠 대체는 정식 값과 기존 메타데이터를 보존합니다. 값 대체는 다시 검증되며 콘텐츠/메타데이터를 다시 계산합니다. 차단은 값을 제거하고 수정 피드백을 포함하는 `isError`가 됩니다. 콘텐츠 대체는 기밀성 정책이 아니라 표현 정책입니다. 프로그래밍 방식의 값을 숨겨야 하는 리스너는 이를 차단하거나 대체합니다. 정규화 후 `tools/result`는 고정된 실행과 결과를 수신합니다. 관찰자는 이를 변환할 수 없으며 관찰자 실패는 격리됩니다. 알 수 없는 도구와 예외를 발생시키는 도구는 모두 구조화된 오류가 됩니다(`ToolNotFoundError`는 `UNKNOWN_TOOL`에 매핑됨). 따라서 호출은 턴을 종료하지 않고 실패합니다.

## 강제되는 원시 JSON Schema 하위 집합

하위 에이전트, 워크플로, MCP 및 동적 등록의 원시 스키마는 작성자 DSL의 와이어 수준 대응물을 사용합니다. `assertSupportedJsonSchema()`는 모든 JSON 루트를 허용하고, `validateJsonSchemaValue()`는 이를 강제하며, `JsonSchemaError`는 지원되지 않거나 잘못된 모든 스키마 경로를 보고합니다. 비어 있는 주석 전용 노드는 제약 없는 무손실 JSON을 의미합니다. `oneOf`에는 최소 두 개의 분기가 필요하며, 값은 정확히 하나와 일치해야 합니다. 여전히 객체 루트를 요구하는 소비자는 `assertObjectJsonSchema()`를 호출하고 `ObjectJsonSchema`를 전달합니다. 이로써 하위 에이전트/워크플로 호출자가 정의한 구조화된 출력은 공유 어휘를 제한하지 않으면서 객체 루트를 유지합니다.

```ts type-equiv
/** Scalar JSON values supported by `enum` and `const`. */
type JsonSchemaScalar = string | number | boolean | null
```

```ts type-equiv
/** Single-type keywords accepted by the enforced subset. */
type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
```

```ts type-equiv
/**
 * One raw JSON Schema node in the enforced subset. The optional fields express
 * the external wire schema; {@link assertSupportedJsonSchema} rejects invalid
 * combinations before a caller treats the node as trusted.
 */
interface JsonSchemaNode {
  /** Omit with no constraints for any JSON value, or use `oneOf`. */
  type?: JsonSchemaType
  /** Exactly one branch must validate; at least two branches are required. */
  oneOf?: JsonSchemaNode[]
  /** Nested property schemas (`type: 'object'` only). */
  properties?: Record<string, JsonSchemaNode>
  /** Required property names; each must appear in `properties`. */
  required?: string[]
  /** `false` rejects undeclared keys; absent/`true` follows JSON Schema's open default. */
  additionalProperties?: boolean
  /** Item schema (`type: 'array'` only); absent accepts any JSON item. */
  items?: JsonSchemaNode
  /** Allowed values for a scalar node. */
  enum?: JsonSchemaScalar[]
  /** The single allowed value for a scalar node. */
  const?: JsonSchemaScalar
  /** Annotation, ignored for validation. */
  description?: string
  /** Annotation, ignored for validation. */
  title?: string
  /** Annotation, ignored for validation but required to be lossless JSON. */
  default?: JsonValue
  /** Annotation, ignored for validation but required to be lossless JSON. */
  examples?: JsonValue
}
```

```ts type-equiv
/** A consumer-constrained object-rooted schema. */
type ObjectJsonSchema = JsonSchemaNode & { type: 'object' }
```

## 도구 표현 UI 어휘

도구 호출을 UI(편집기 도구 호출 카드, CLI 로그 줄)에 표시하려는 방식을 설명합니다. 도구가 어떤 클라이언트 프로토콜에도 의존하지 않고 자신을 설명할 수 있도록 공급자 중립적으로 설계되었습니다. `presentCall`/`presentResult`는 **`card` 태그가 지정된 렌더링 의도** 를 반환합니다. 이는 UI 브리지가 다음과 같이 분기하는 판별된 유니온입니다.

- `ToolCallView`(대기 중): `{ card: 'generic', title, kind?, rawInput?, content?, locations? }`(기본 카드, 편집기에서 진행 상황을 따라가기 위해 `locations`는 호출이 읽거나 수정하는 `{ path, line? }[]` 파일임), `{ card: 'terminal', title, description?, cwd? }`(셸 명령 → 터미널 카드) 또는 `{ card: 'diff', title, diffs, locations? }`(파일 생성/수정 → 인라인 diff 카드, `diffs`는 `{ path, oldText, newText }[]`이며 새 파일의 경우 `oldText: null`임)입니다.
- `ToolResultView`(완료됨): `{ card: 'generic', title?, content? }`, `{ card: 'terminal', title?, output?, exitCode?, signal? }`(캡처된 실행 출력 + 종료 상태, 지원하는 UI는 종료 상태 배지를 표시하고 다른 UI는 펜스된 ` ```console ` 대체 표시를 만들 수 있음), `{ card: 'diff', title?, diffs }`(완료된 파일 변경 → 표시할 변경 사항으로, 일반적으로 이전/이후 콘텐츠에서 계산한 문맥 줄이 있는 적용된 헝크 또는 이전 이미지가 없을 때의 전체 파일 diff), `{ card: 'search', shape, title?, truncated, total, … }`(완료된 검색 탐색 → `shape: 'matches'`(grep)의 파일별 그룹화된 일치 항목 또는 `shape: 'paths'`(glob)의 평면 경로 목록, `truncated`/`total`는 인라인 결과가 제한되었는지 보고하므로 UI가 부분 결과를 완전한 결과로 표시하지 않음. 뷰는 결과 텍스트를 포함하지 않으며 검색 카드가 없는 UI는 원시 결과 콘텐츠로 대체함), `{ card: 'read', title?, path, offset, lines, totalLines, lang?, content? }`(완료된 파일 읽기 → 줄 번호가 있고 선택적으로 구문 강조 표시된 코드 보기, `offset`는 `lines`가 비어 있어도 유지되는 창이 요청한 1부터 시작하는 첫 번째 줄이며, `lang`은 확장자에서 얻는 언어 힌트이고 읽기 지원이 없는 UI가 대체 표시하는 것은 `content`의 엔벌로프가 제거된 텍스트임) 또는 `{ card: 'web', kind: 'search' | 'fetch', title?, … }`(완료된 웹 검색, `kind: 'search'`는 구조화된 `sources`/`answer?`/`truncated`를 전달하고, `kind: 'fetch'`는 `url`/`statusCode`/`truncated`를 전달하며, `web` 기능이 없는 UI는 원시 결과 콘텐츠로 대체 표시함. 본문은 뷰에 중복되지 않음)입니다. 완료된 뷰는 대기 중인 뷰를 대체하므로 변경 도구는 호출 시점 스니펫과 중복되더라도 diff 결과를 반환합니다. 검색과 웹 검색에는 `card` 호출 시점 대응물이 없습니다(구조화된 결과는 `execute` 후에만 존재하므로 대기 상태는 일반 카드로 유지됨).

`ToolCallKind`(`'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'fetch' | 'other'`)은 일반 카드에서 아이콘을 선택합니다. `FileLocation`(`{ path, line? }`), `FileDiff`(`{ path, oldText, newText }`), `ReadFileLine`(읽기 창의 1부터 시작하는 번호가 매겨진 한 줄인 `{ number, text }`)은 공유 파일 카드 어휘입니다. 설계는 [render-intent-union Agent Note](../../.agents/notes/implemented/architecture/2026-07-02-tool-render-intent-union.md)에 고정되어 있습니다. 호스트/클라이언트 런타임은 이 중립적인 어휘를 자체 뷰로 투영합니다.

전체 표현 필드 문서는 [`packages/core/tools/src/presentation.ts`](../../packages/core/tools/src/presentation.ts)에 있습니다. `bash` 스키마와 실행기는 [shell.md](shell.md)에 있고, 일반 백그라운드 제어는 [jobs.md](jobs.md)에 있습니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`에서 소스로부터 생성됩니다(문서 동기화에서 `pnpm run verify-cordis-catalog`로 최신 상태를 검증하며 `pnpm run gen-cordis-catalog`로 다시 생성). 이 섹션은 페이지의 두 언어 버전에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxtools--toolruntime"></a>

### `ctx.tools` — `ToolRuntime`

도구 레지스트리 및 실행 파이프라인입니다. 범위가 지정된 등록은 전역 등록을 가리며, 하나의 가시성 확인기가 표현, 조회 및 디스패치에 사용됩니다.

```ts cordis-catalog
/**
 * Present the calling scope's tools in `mode` instead of the deployment
 * default. Nearest scope on the chain wins, so a preset's standing
 * declaration covers every agent joined under it.
 *
 * Scoped only, and one declaration per scope: this is how an agent preset
 * composes Code Mode agents beside native ones in the same process, and a
 * process-global override would be the `mode` config field instead.
 * @param mode - the presentation the covered agents' models see.
 * @returns the exact disposer that restores the deployment default.
 */
presentAs(mode: ToolPresentationMode): () => void

/**
 * Register globally or in the calling agent scope. Scoped tools shadow
 * globals; duplicates within one layer and the reserved `run_code` name fail.
 * @param definition - tool schema, execution, and optional finalization/presentation callbacks.
 * @returns the exact disposer that unregisters the tool.
 */
register(definition: ToolDefinition): () => void

/**
 * Restrict global tools for the calling agent scope. Empty filters, unknown
 * names, scope-local names, and reserved transport names fail. Restrictions
 * intersect; scoped registrations remain visible.
 * @param filter - global-tool mask: `allow` (keep only) and/or `deny` (remove).
 * @returns the exact disposer that lifts this restriction.
 */
restrict(filter: ToolRestriction): () => void

/**
 * Register a monotonic guard after the extensible `tools/pre-execute`
 * waterfall. A plain-context guard applies globally; one registered through
 * `agent.ctx` applies only to that agent. Any matching guard may deny by
 * returning a reason, while no guard can force-allow a call another guard
 * denied. The exact effect disposer is returned for ordered ownership and
 * HMR cleanup.
 * @param guard - synchronous check; a returned string denies the execution.
 * @returns the exact disposer that unregisters the guard.
 */
guard(guard: ToolGuard): () => void

/**
 * Look up a tool as one scope sees it (scoped
 * shadows global; a restricted-away global reads as absent). Presenters pass
 * the calling agent so the rendered card matches the definition that
 * actually executed.
 * @param name - the tool name as registered.
 * @param scope - the viewing scope (the agent); omitted = the global view.
 * @returns the definition the scope resolves, or undefined when none is visible.
 */
get(name: string, scope?: ScopeKey): ToolDefinition | undefined

/**
 * Project visible definitions onto the allowlisted model-facing schema fields,
 * excluding execution and presentation callbacks.
 * @param scope - the viewing scope (the agent); omitted = the global view.
 * @returns one deep-cloned schema per visible tool.
 */
schemas(scope?: ScopeKey): ToolSchema[]

/**
 * Classify a pending call through the caller's visible tool definition. Only
 * an exact `true` is parallel; unknown, hidden, undeclared, invalid, or
 * throwing classifiers are exclusive.
 * @param exec - call name, parsed arguments, and optional agent scope.
 * @returns the fail-closed scheduling mode.
 */
executionMode(exec: ToolExecutionInput): ToolExecutionMode

/**
 * Execute through pre-policy, guards, around-dispatch, post-policy,
 * definition-owned content finalization, and final notification. Tool and
 * listener failures resolve as materialized error results; an invisible tool
 * reports `UNKNOWN_TOOL`. The returned outcome is the same lossless, frozen
 * snapshot final observers receive. Cancellation
 * arriving after entry and before final result materialization skips a
 * not-yet-started body with `ABORTED_BEFORE_DISPATCH` or replaces a
 * successful started outcome with `ABORTED`; already-started work is still
 * drained and may retain a tool-owned structured error.
 * @param exec - the typed same-process call input. The registry assigns its
 *   correlation token before policy begins.
 * @returns the materialized final result.
 */
async execute(exec: ToolExecutionInput): Promise<ToolExecutionResult>
```

유형: [ScopeKey](scope.md)

소스: [`packages/core/tools/src/index.ts:787`](../../packages/core/tools/src/index.ts)

<a id="tools-events"></a>

### `tools/*` 이벤트

<a id="toolschange--emit"></a>

#### `tools/change` — 내보내기

도구가 등록 또는 등록 해제되었거나 범위 제한이 변경되었습니다(사용 가능한 도구 집합이 변경되었으며, 하나의 범위에만 해당할 수도 있습니다). 이는 의도적으로 범위 필터링을 적용하지 않는 레지스트리 주체 알림입니다. 전역 변경은 모든 에이전트의 다음 조립 과정에 영향을 미치므로, 여기에서 구독하는 범위 지정 리스너는 자신의 범위 변경뿐 아니라 모든 변경을 확인합니다.

```ts cordis-catalog
/**
 * A tool was registered or unregistered, or a scoped restriction changed
 * (the available tool set changed — possibly for one scope only). An
 * UNFILTERED registry-subject notification, deliberately not scope-filtered
 * dispatch: a global change concerns every agent's next assembly, so a
 * scoped listener subscribing here sees every change, not just its own
 * scope's.
 * @mode emit
 */
'tools/change'(): void
```

소스: [`packages/core/tools/src/index.ts:207`](../../packages/core/tools/src/index.ts)

<a id="toolscode-dispatch-log--waterfall"></a>

#### `tools/code-dispatch-log` — 워터폴

브리지가 `tool/code-dispatch` 이벤트를 추가하기 전에, 리스너가 하나의 `run_code` 하위 디스패치 결과에 대한 영속 로그 사본의 콘텐츠를 대체할 수 있도록 합니다. `next()`는 콘텐츠를 변경하지 않은 상태로 유지합니다. 리스너는 대체 블록을 반환할 수 있습니다(예: 크기가 큰 텍스트 결과에 대한 spill 정책의 미리 보기와 로케이터). 영향을 받는 것은 기록된 사본뿐입니다. 프로그램은 이미 완전한 값을 받았고 모델은 둘 다 보지 못합니다. 예외를 발생시키는 리스너는 격리되며, 브리지는 원래의 확정된 콘텐츠를 기록하는 방식으로 대체합니다. 범위 필터링 디스패치(`@deepseek-ai/dsh-scope`)에서는 에이전트 범위 리스너가 해당 에이전트의 디스패치만 수신합니다.

```ts cordis-catalog
/**
 * Allow a listener to replace content in the DURABLE LOG COPY of one
 * `run_code` sub-dispatch outcome before the bridge appends its
 * `tool/code-dispatch` event. `next()` keeps the
 * content unchanged; a listener may return replacement blocks (e.g. the
 * spill policy's preview + locator for an oversized text result). Only the
 * logged copy is affected — the program already received the complete
 * value, and the model sees neither. A throwing listener is contained:
 * the bridge falls back to logging the original settled content.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's dispatches.
 * @param dispatch - the parent execution, sub-call identity, and the settled content to log.
 * @mode waterfall
 */
'tools/code-dispatch-log'(this: Scoped<ToolRuntime>, dispatch: CodeDispatchLog, next: () => Promise<ContentBlock[]>): Promise<ContentBlock[]>
```

유형: [ContentBlock](llm-streaming.md) · [Scoped](scope.md)

소스: [`packages/core/tools/src/index.ts:189`](../../packages/core/tools/src/index.ts)

<a id="toolsexecute--waterfall"></a>

#### `tools/execute` — 워터폴

타임아웃, 재시도 또는 메트릭을 위한 디스패치 전후 워터폴입니다. `next()`는 정규화된 결과를 반환하며, 래퍼는 호출 식별자가 불변으로 유지되는 동안 `exec.signal`만 변경할 수 있습니다. 레지스트리는 본문 실행 전에 원래 호출자의 신호를 다시 결합하므로, 대체가 호출자 취소를 분리할 수 없습니다. 래퍼는 여전히 자신의 신호를 복원하고 정지 상태에 도달해야 합니다. 범위 필터링 디스패치(`@deepseek-ai/dsh-scope`)에서는 에이전트 범위 리스너가 해당 에이전트의 호출만 수신합니다.

```ts cordis-catalog
/**
 * Around-dispatch waterfall for timeout, retry, or metrics. `next()` returns
 * a normalized result; wrappers may change only `exec.signal`, while call
 * identity remains immutable. The registry re-fuses the original caller
 * signal before the body, so replacement cannot detach caller cancellation;
 * wrappers must still restore their signal and reach quiescence.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.
 * @param exec - the allowed call about to dispatch (name, parsed arguments, caller agent, signal).
 * @mode waterfall
 */
'tools/execute'(this: Scoped<ToolRuntime>, exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult>
```

유형: [Scoped](scope.md)

소스: [`packages/core/tools/src/index.ts:163`](../../packages/core/tools/src/index.ts)

<a id="toolspost-execute--waterfall"></a>

#### `tools/post-execute` — 워터폴

정규화된 디스패치 결과를 수락, 대체, 보강 또는 차단합니다. `next()`은 이를 변경 없이 수락합니다. 도구에서 발생한 예외도 오류로 이 워터폴에 도달합니다. 비동기 리스너는 `exec.signal`을 준수해야 합니다. 리스너가 완료된 후 호출자 취소는 도구 본문이 호출되었는지에 따라 선택된 코드로 성공적으로 수락된 결과만 대체합니다. 범위 필터링 디스패치(`@deepseek-ai/dsh-scope`): 에이전트 범위 리스너는 해당 에이전트의 호출만 받습니다.

```ts cordis-catalog
/**
 * Accept, replace, enrich, or block a normalized dispatch result. `next()`
 * accepts it unchanged; thrown tools still reach this waterfall as errors. Async
 * listeners must observe `exec.signal`; after they settle, caller
 * cancellation replaces only a successful accepted outcome with the code
 * selected by whether the tool body was invoked.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.
 * @param exec - the call that just ran (name, parsed arguments, caller agent).
 * @param result - the dispatch outcome a listener may accept, replace, or block.
 * @mode waterfall
 */
'tools/post-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>): Promise<PostToolDecision>
```

유형: [Scoped](scope.md)

소스: [`packages/core/tools/src/index.ts:175`](../../packages/core/tools/src/index.ts)

<a id="toolspre-execute--waterfall"></a>

#### `tools/pre-execute` — 워터폴

디스패치 전에 허용, 거부 또는 요청합니다. `next()`은 허용으로 위임합니다. 승인 지원이 없으면 `ask`은 거부로 처리됩니다. 비동기 게이트는 `exec.signal`을 준수해야 합니다. 레지스트리는 게이트가 완료된 후 취소를 다시 확인하지만 해당 Promise를 절대 포기하지 않습니다. 범위 필터링 디스패치(`@deepseek-ai/dsh-scope`): 에이전트 범위 리스너는 해당 에이전트의 호출만 받습니다.

```ts cordis-catalog
/**
 * Allow, deny, or ask before dispatch. `next()` delegates to allow; missing
 * approval support turns `ask` into denial. Async gates must observe
 * `exec.signal`; the registry rechecks cancellation after they settle but
 * never abandons their promise.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.
 * @param exec - the pending call (name, parsed arguments, caller agent).
 * @mode waterfall
 */
'tools/pre-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>
```

유형: [Scoped](scope.md)

소스: [`packages/core/tools/src/index.ts:152`](../../packages/core/tools/src/index.ts)

<a id="toolsresult--emit"></a>

#### `tools/result` — 내보내기

고정된 무손실 JSON 최종 결과를 관찰합니다. 리스너 실패는 격리됩니다. 범위 필터링 디스패치(`@deepseek-ai/dsh-scope`): `exec.agent`을 키로 사용합니다.

```ts cordis-catalog
/**
 * Observe the frozen, lossless-JSON final outcome. Listener failures are contained.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): keyed by `exec.agent`.
 * @param exec - the execution object that traversed the pipeline.
 * @param result - a deep-frozen snapshot of the final returned result.
 * @mode emit
 */
'tools/result'(this: Scoped<ToolRuntime>, exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined
```

유형: [Scoped](scope.md)

소스: [`packages/core/tools/src/index.ts:197`](../../packages/core/tools/src/index.ts)
<!-- END GENERATED cordis-surface -->
