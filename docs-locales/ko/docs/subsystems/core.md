# 코어

**core**  하위 시스템은 [`packages/core`](../../packages/core/README.md)입니다. 즉, 모든 컴포지션이 부팅하는 패키지로, 이벤트 소싱 세션 로그, 시스템 프롬프트 조립, 도구 레지스트리, 에이전트 유형 및 이를 구동하는 구체적 루프를 포함합니다. 이 페이지에서는 `agent`/`agent-loop` 쌍이 선언하는 내용, 즉 에이전트의 생성 및 소유 방식과 `Agent` 핸들의 전달, 취소 및 가로채기 계약, 그리고 모든 하위 시스템이 따르는 두 가지 타입 패턴을 설명합니다. 이 그룹의 전용 페이지와 폴더의 나머지 항목은 [하위 시스템 README](README.md)에 색인되어 있습니다.

## 패키지별 핵심 구조

하나의 턴은 단일 루프에서 여섯 패키지를 통과합니다. [`agent-loop`](../../packages/core/agent-loop)의 드라이버가 대기 중인 프롬프트를 가져오고, [세션 로그](session.md)(`ctx.sessions`)에서 턴을 열며, [시스템 프롬프트](system-prompt.md)(`ctx.systemPrompt`)를 통해 요청 접두사를 조립하고 로그에서 이력을 가져옵니다. سپس [LLM 추상 경계](llm-streaming.md)를 통해 모델 응답을 스트리밍하고, [도구 레지스트리](tools.md)(`ctx.tools`)를 통해 도구 호출을 디스패치한 뒤, 다음 단계가 로그에서 파생되기 전에 모델에 표시되는 모든 사실을 로그에 다시 추가합니다. 루프가 전달하는 대화 어휘, 즉 `Message`, `ContentBlock`, `StreamChunk` 및 모델 요청은 [`packages/llm`](../../packages/llm/README.md)에서 선언되며 [llm-streaming.md](llm-streaming.md)에 문서화되어 있습니다.

| 패키지 | 소유 항목 | 페이지 |
|---|---|---|
| `session/` | 추가 전용 `SessionEvent` 로그와 인메모리 저장소 — 단일 정보 원본(`ctx.sessions`) | [session.md](session.md) |
| `system-prompt/` | 프롬프트 섹션 및 도구 스키마 조립(`ctx.systemPrompt`) | [system-prompt.md](system-prompt.md) |
| `tools/` | 범위가 지정된 도구 레지스트리 및 보호된 실행 파이프라인(`ctx.tools`) | [tools.md](tools.md) |
| `agent/` | `Agent` 인터페이스, 라이브 레지스트리, 시작자 범위 및 `agent/*` 이벤트 어휘(`ctx.agents`) | 이 페이지 |
| `agent-loop/` | 공개 `Agent` 계약을 구현하는 구체적 드라이버(`ctx.agentLoop`) | 이 페이지 |
| `scope/` | 레지스트리와 루프가 에이전트별 범위를 구축하는 데 사용하는 범위 지정 등록 기본 요소 | [scope.md](scope.md) |

`scope/`는 유일한 비서비스 패키지입니다. 의존성이 없는 라이브러리(`createScope`/`scopeOf`/`scopeTarget`)로서, 순환 참조 없이 이를 사용할 수 있도록 모듈 그래프에서 `session/` 및 `system-prompt/` 아래에 위치합니다. `agent-loop`는 공개 `Agent` 계약의 유일한 구체적 구현이며, Harness의 기본 제품 루프이므로 여기에 있습니다. 각 드라이버를 `ctx.agents.withInitiator()` 내부에서 실행합니다. 확장 플러그인은 시작 Agent가 필요한 경우를 포함해 `agent`에 의존하며, `agent-loop`에 직접 의존하지 않습니다. 따라서 루프는 교체할 수 있습니다. 이 핵심 구조를 실행 가능한 에이전트에 연결하는 기본 컴포지션은 [`examples/agent-spine-demo`](../../packages/examples/agent-spine-demo/README.md)입니다.

## 생성 및 소유권

소비자는 `ctx.agents`을 통해 에이전트를 생성합니다. `create()`는 호출자가 제공한 하나의 `SessionId` 아래에서 새 세션과 에이전트를 구축하고, `resume()`는 먼저 영속화된 세션을 로드합니다. 또는 루프의 설정 항목을 통해 선언적으로 생성할 수도 있습니다. 프로그래밍 방식 생성은 소유자의 핸들을 반환합니다.

소스: [`packages/core/agent/src/index.ts`](../../packages/core/agent/src/index.ts)

```ts type-equiv
/**
 * An owned agent plus its disposer, returned by {@link AgentRegistry.create} /
 * {@link AgentRegistry.resume}. The disposer is a CAPABILITY: among consumers,
 * only the holder can tear this agent down. The registered factory provider is
 * also a structural owner because the scoped agent depends on that provider's
 * service API; provider unload stops and drains every live handle it made.
 * `dispose()` stops the loop, awaits its exit, unregisters the agent, removes
 * its session from the store, and finally unwinds its scoped world.
 *
 * `ctx.agents.get(id)` still returns a bare {@link Agent} — the handle is
 * exposed only to the consumer owner that created it; the structural provider
 * reaches the same teardown internally. Config-created agents (the loop's own
 * startup) are owned by the loop fiber and never need a handle.
 */
interface AgentHandle {
  agent: Agent
  dispose(): Promise<void>
}
```

`CreateAgentOptions`는 공유 ID와 새 에이전트가 공개되기 전에 필요한 모든 요소를 전달합니다. 여기에는 세션 메타데이터(`meta` — 검증된 `cwd`, 포크 계보, 시드 경계, 원본 분류, 위임 깊이), 포크용 선택적 `seed` 재생 접두사, 에이전트별 `AgentOptions`, 생성 전용 취소 `signal` 및 `setup`가 포함됩니다. `ResumeAgentOptions`는 영속 ID에 대응하는 항목으로, `resumeSessionId`, `agentOptions`, `signal` 및 `setup`를 포함합니다. `setup` 콜백(`AgentSetup`)은 두 ID가 아직 공개되지 않은 동안 에이전트의 범위가 지정된 환경을 구성합니다. `agentCtx`을 통해 등록된 모든 항목은 `agent/created` 및 첫 번째 프롬프트 조립 전에 존재하며, 공개 직전에 즉시 호출되는 동기 커밋을 반환할 수 있습니다. 설정 거부, 커밋 예외 또는 소유자 폐기는 어느 ID도 공개하지 않고 트랜잭션을 롤백합니다.

`AgentFactory`는 레지스트리 뒤의 생성 인터페이스입니다. 루프는 `ctx.agents.setFactory()`을 통해 팩터리를 등록하므로 소비자는 구체적 루프 패키지에 의존하지 않고 `ctx.agents`을 사용합니다. 정확한 `create`/`resume` 시그니처와 롤백 계약은 아래 [생성된 섹션](#ctxagents--agentregistry)에 있습니다.

## 에이전트 핸들

`Agent`는 모든 플러그인(UI, 훅, 오케스트레이터)이 대상으로 프로그래밍하는 표면입니다. `ctx.agents.get(id)`은 이를 반환하며, [시작자 범위](#initiating-agent)가 이를 전달합니다. 구체적 구현은 dsh-agent-loop 패키지 내부에 있으며, 루프 외부에서는 아무것도 이에 의존하지 않습니다. 통합된 `send` 메서드는 대상 및 깨우기 라우팅을 직접 노출합니다. `followup`, `steer` 및 `inject`는 고정 프리셋 별칭입니다.

소스: [`packages/core/agent/src/types.ts`](../../packages/core/agent/src/types.ts)

```ts type-equiv
/** Public live-agent handle. */
interface Agent {
  /** The single identity shared with {@link session}. */
  readonly id: SessionId
  /** The provider route and model this agent's requests use. */
  readonly options: AgentOptions
  /** The live session this agent drives; its log is the durable source of truth. */
  readonly session: Session
  /** The agent-owned projection of durable pending work. */
  readonly inbox: Inbox
  /** The current lifecycle state, mirrored on every `agent/status` transition. */
  readonly status: AgentStatus
  /** Agent-scoped context; its contributions are agent-local, unwind on disposal, and reject registration afterward. */
  readonly ctx: Context

  /**
   * Clear queued and steering work — unless `keepInbox` — and abort the active
   * turn or between-turn task. The first cause wins for that activity. With no
   * active activity, cancellation is a no-op and does not arm later work.
   * @param cause - the stable caller intent carried by the active operation signal.
   * @param options - cancellation options; `keepInbox` preserves pending work.
   */
  cancel(cause: AgentCancelCause, options?: CancelOptions): void

  /**
   * Resolve after the current whole-agent activity reaches quiescence. This
   * follows replacement work started before the observed driver retires,
   * but does not identify the settlement of any particular message.
   * @returns fulfillment after no active driver or maintenance task remains.
   */
  whenIdle(): Promise<void>

  /**
   * Run one non-turn maintenance task from the true idle phase. The task starts
   * synchronously after claiming that phase; later waking input remains in the
   * inbox until the task settles, while public status stays `idle`.
   * `whenIdle()` follows both the task and any waking work released behind it.
   * @param task - operation whose fulfillment or rejection is preserved, with a signal aborted by {@link cancel}.
   * @throws synchronously when turn-driving or another maintenance task already owns the agent.
   * @returns the task promise.
   */
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>

  /**
   * Route identified input to an inbox boundary and optionally wake the driver.
   * Waking input submitted after active cancellation is queued for the next
   * turn and runs when the aborted activity converges to idle; a `disposed`
   * cancel leaves it parked. A wake submitted while already idle always opens
   * its turn boundary, even when its message is cleared before the driver
   * claims ([cancel-convergence wake latch](../../../../.agents/notes/implemented/bug-fix/2026-08-07-cancel-convergence-wake-latch.md)).
   * @param message - identified content and the source that supplied it.
   * @param target - the preferred next-turn or next-step inbox boundary.
   * @param wakeup - whether delivery may wake the driver.
   */
  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void

  /**
   * Queue an ordinary follow-up turn and wake the driver. The item becomes the
   * sole ordinary message of its own turn.
   * @param message - identified prompt content and the source that supplied it.
   */
  followup(message: UserMessage): void

  /**
   * Submit steering for the nearest step. An idle driver starts a turn;
   * a running driver consumes it at its next step boundary.
   * A rejected step leaves steering parked in the inbox until the next
   * wake; cancellation or disposal may discard pending steering.
   * @param message - identified steering content and the source that supplied it.
   */
  steer(message: UserMessage): void

  /**
   * Queue model-facing context for the next pre-step without waking the
   * driver. A running driver claims it at the nearest later step boundary;
   * idle drivers leave it pending until follow-up or steering
   * wakes them. It may miss a request whose pre-step already claimed its
   * batch. Cancellation or disposal may discard pending context.
   * @param message - identified injected context and the source that supplied it.
   */
  inject(message: UserMessage): void
}
```

```ts type-equiv
/**
 * An agent's lifecycle state, emitted on every transition as `agent/status`:
 * `idle` means no driver is active; `running` begins when waking input starts
 * cancellable pre-step processing and lasts while the driver drains,
 * closes, or checkpoints turns. Disposal removes the agent from its registry;
 * it is not a third observable status.
 */
type AgentStatus = 'idle' | 'running'
```

`running`는 드라이버 전체의 드레인 간격을 설명하며, 연속된 대기 턴에 걸칠 수 있습니다. 이는 턴이 아직 열려 있음을 증명하지는 않습니다. 폐기하면 레지스트리에서 에이전트가 제거되고 `agent/disposed`가 발생합니다. 이는 종료 상태 값이 아닙니다. `followup()`는 핸들을 반환하지 않습니다. 이의 `MessageId`는 이후의 어시스턴트 출력이나 턴 종료가 아니라 영속적인 받은 편지함 삽입, 클레임, 폐기 사실을 식별합니다. `whenIdle()`는 전체 에이전트를 관찰하므로, 호출자는 해당 구간을 명시적으로 소유하는 경우에만 영수증부터 유휴 상태까지의 간격을 실행으로 부를 수 있습니다([결정](../../.agents/notes/implemented/architecture/2026-07-30-followup-enqueue-and-owned-runs.md)).

```ts type-equiv
/** Merge-extensible agent creation options. Persona belongs to system-prompt sections. */
interface AgentOptions {
  /** Provider route (must have a registered adapter at call time). */
  provider?: string
  /** Model id interpreted by the selected provider adapter. */
  model?: string
  /** Maximum output tokens for each conversation-model request. */
  maxTokens?: number
}
```

디스패치에는 `agent/request` 이후 `provider` 및 `model`가 필요합니다. `maxTokens`가 있으면 양의 안전한 정수여야 하며 모든 대화 모델 요청의 상한을 설정합니다. 생략하면 요청 헤더 전에 정확한 모델 어댑터 기본값이 적용되도록 하며, 그렇지 않으면 제공자 동작을 변경하지 않습니다. 에이전트 범위의 `deployment:persona` 프롬프트 섹션은 전역 기본 페르소나를 재정의할 수 있습니다.

받은 편지함은 전달 어휘입니다. 즉, 에이전트가 영속적 프로젝션으로 소유하는 순서가 있는 두 개의 대기 메시지 목록입니다.

```ts type-equiv
/** One of the two ordered pending-message lists owned by an agent. */
type InboxTarget = 'next-turn' | 'next-step'
```

모든 대기 항목은 자체 `UserMessage`를 가지며, `MessageId`만이 유일한 식별자입니다. `Inbox.append`, `prepend`, `replace`, `remove`, `clear`, `splice` 및 `claim`는 정규화된 영속적 `agent/inbox/spliced` 변경을 기록하고 중복된 대기 ID를 거부합니다. `replace(messageId, newMessage)` 및 `remove(messageId)`는 두 목록 전체에서 대기 메시지를 찾습니다. 교체는 식별성을 변경할 수 있으며, 이전 메시지를 폐기된 것으로 발생시킨 뒤 새 메시지를 삽입된 것으로 발생시킵니다. 일반 제거와 `clear()`는 취소입니다. `claim(target)`는 폐기 알림을 발생시키지 않는 순수 삭제 스플라이스를 통해 제안된 단계 배치, 즉 모든 `next-step` 입력과 턴 경계에서 하나의 `next-turn` 메시지를 제거하며, 루프는 메시지별 클레임 알림을 별도로 발생시킵니다. UI 프로젝션 같은 전체 대기열 소비자는 영속적 스플라이스에서 `nextTurn` 및 `nextStep`를 재구성하는 반면, 하나의 메시지를 추적하는 소비자는 정확한 `agent/inbox/inserted`, `claimed` 및 `discarded` 알림을 사용합니다.

취소:

```ts type-equiv
/** Options for {@link Agent.cancel}. */
interface CancelOptions {
  /**
   * Preserve queued and steering inbox items instead of discarding them. The
   * active turn is still aborted, but un-started and pending work survives for a
   * later turn and no canceled inbox splice is logged.
   */
  keepInbox?: boolean | undefined
}
```

```ts type-equiv
/** Why an active agent driver was cancelled. */
type AgentCancelCause =
  | { readonly kind: 'user' }
  | { readonly kind: 'parent' }
  | { readonly kind: 'hook'; readonly reason: string }
  | { readonly kind: 'disposed' }
```

원인은 TypeScript로 강제되는 동일 프로세스 입력입니다. 활성 취소 보유자는 이를 런타임 전용 `AbortSignal.reason`에 복사하며, 신호는 협력 리스너에게 분류 권한을 부여하지 않습니다. 영속적인 `turn/end`는 대략적인 `{ kind: 'aborted' }` 결과를 유지합니다. 취소를 요청한 주체를 기록하려면 종료 결과를 과부하하지 않고 별도의 영속 이벤트가 필요합니다.

[이벤트 분류 체계](../architecture.md#events)는 `agent/*` 수명 주기, 체크포인트 및 폭포수 계약을 소유합니다. 턴 및 단계 경계는 에이전트 emit이 아니라 영속 세션 이벤트입니다.

## 개시 에이전트

`ctx.agents`가 전달하는 프로세스 로컬 개시자는 별도의 프레임이나 복사된 ID가 아니라 위의 정확한 `Agent`입니다. 주변에 존재한다고 해서 활성 상태나 권한 부여가 증명되는 것은 아니며, [개시자 범위 결정](../../.agents/notes/implemented/architecture/2026-07-15-agent-initiator-scope.md)이 수명과 범위 규칙을 정의합니다.

## 가로채기 결정

단계 전 결정은 영속적인 사용자 역할 입력과 동일한 식별된 `UserMessage` 타입을 사용합니다. 입력된 배치는 권위가 있으며 각 메시지의 `id` 및 `source`를 보존합니다. Hook 브리지는 자체 결정 필드를 이 타입 지정 결과에 매핑합니다.

출처: [`packages/core/agent/src/types.ts`](../../packages/core/agent/src/types.ts)

`agent/pre-step`는 독점적으로 클레임된 배치(`messages`), 제안된 단계의 좌표(`turn`, `step`), 현재 턴의 취소 `signal`를 전달하는 하나의 페이로드를 받습니다. 초기 제안은 어떤 단계보다 앞서 열린 턴 내부에서 실행됩니다. 도구 연속 처리는 단계 사이에 빈 클레임 배치를 제출할 수 있습니다.

이는 `PreStepDecision`를 반환합니다. 거부는 어떤 단계도 열지 않습니다. 입력은 `step/start` 뒤에 추가되는 전체 메시지 배치를 제공합니다. 최종 결정에서 제외된 클레임 메시지는 제거된 상태로 유지되는 반면, 클레임 이후에 삽입된 입력은 대기 상태로 남습니다.

```ts type-equiv
/** Whether and with which messages the loop enters a proposed step. */
type PreStepDecision =
  | { kind: 'reject' }
  | { kind: 'enter'; messages: UserMessage[] }
```

`agent/request-error`는 실패한 모델 단계가 닫힌 뒤 해당 턴이 닫히기 전에 실행됩니다. 리스너는 실패한 턴의 신호가 아직 활성인 동안 영속 상태를 복구하거나 정책 작업을 기다릴 수 있습니다. 처리 리스너는 `next()`를 호출하지 않고 `{ kind: 'retry' }`를 반환합니다. 기본 `undefined`는 실패를 종료 상태로 둡니다.

```ts type-equiv
/** Action returned by a listener that owns model-request recovery. */
type RequestErrorAction = { kind: 'retry' } | undefined
```

`agent/pre-step`는 요청 파생 전에 존재하는 유일한 직렬 리스너 체인입니다. `agent/turn-stopping`는 턴에 도구 또는 조정 연속 처리가 없을 때 최종 조정 드레인 한 번 전에 실행됩니다.

`agent/session-start`는 `SessionStartSource`(세션 수명 주기가 시작된 이유이며, 브리지는 이를 기준으로 SessionStart 매처를 지정합니다)를 전달합니다.

```ts type-equiv
/** Why a session lifecycle began; seeded creates are `startup`, while persisted loads are `resume`. */
type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'
```

## 세션

`Session`는 타입이 지정된 `SessionEvent`의 **추가 전용 로그** 이며, 유일한 신뢰 원천입니다. LLM 메시지 기록은 별도로 저장되지 않고 로그(`deriveMessages()`)에서 *파생됩니다* . 모든 항목은 단조 증가하는 `seq`, `time` 및 `type`로 판별되는 `data` 페이로드를 포함합니다. 표면 변형은 `sourceEventSeqs`에 인용된 이전 이벤트를 나열하고 `surfaceOp`를 전달할 수도 있습니다.

`SessionEvent` 봉투의 정확한 조건부 필드, 12개 이벤트 변형(`turn/start`, `turn/end`, `step/start`, `step/end`, `user/message`, `assistant/chunk`, `assistant/message`, `tool/call`, `tool/result`, `steering/message`, `todo/write`, `request/header`), `deriveMessages()` 프로젝션 규칙, `TurnTrigger`/`TurnEndReason` 이유, 실행 인클로저 및 독립형 이벤트 규칙은 **[session.md](session.md)** 에 있습니다. 로그를 영속화하는 방법, 즉 `SessionPersistence` 인터페이스, JSONL/SQLite 백엔드, `session/flush` 체크포인트, 충돌 복구 및 `SessionHeader`는 **[persistence.md](persistence.md)** 에 있습니다.

## `ToolDefinition`

파이프라인 작성에 필요한 유일한 핵심 타입입니다. 등록된 모든 도구가 *무엇인지* , 즉 모델 지향 `ToolSchema`와 `execute` 함수, 선택적 최종 콘텐츠 및 UI 콜백의 조합을 설명합니다. 도구 작성자는 보통 이를 직접 생성하지 않습니다(`defineTool` DSL이 타입 지정 인수와 함께 생성합니다). 그러나 이는 레지스트리가 보유하고 루프가 디스패치하는 계약입니다.

전체 필드, `defineTool`/`ValueSchemaSpec`/`ParameterSchemaSpec` 타입 지정 스키마 DSL, `ToolExecution`/`ToolExecutionResult` 폭포수 타입 및 도구 표시 UI 타입은 **[tools.md](tools.md)** 에 있습니다.

## 리포지토리 전반의 타입 패턴

두 가지 패턴이 모든 하위 시스템에서 반복되며 여기에서 한 번만 설명합니다.

<a id="the-map--derived-union-pattern"></a>

### `…Map → derived-union` 패턴

Harness의 확장 가능한 거의 모든 합 타입은 하나의 패턴을 따릅니다. 판별 태그(`…Map`)로 키가 지정된 인터페이스에서 `keyof`를 사용해 유니온을 파생합니다. 플러그인은 **선언 병합** 으로 변형을 추가하므로 소유 패키지를 수정할 필요가 없습니다.

```ts ignore-check
// The pattern, schematically:
interface ThingMap {
  'a': { kind: 'a'; /* … */ }
  'b': { kind: 'b'; /* … */ }
}
type ThingKind = keyof ThingMap          // 'a' | 'b'
type Thing = ThingMap[keyof ThingMap]    // the discriminated union

// A plugin extends it without touching the source package:
declare module '@deepseek-ai/dsh-llm' {
  interface ThingMap {
    'c': { kind: 'c'; /* … */ }
  }
}
```

여섯 가지 표준 맵이 이 패턴을 사용하며 플러그인 작성자는 다음을 확장합니다.

| 맵 | 패키지 | 파생 대상 | 카탈로그 |
|---|---|---|---|
| `ContentBlockMap` | dsh-llm | `ContentBlock` | [llm-streaming.md](llm-streaming.md#content-blocks-and-messages) |
| `MessageSourceMap` | dsh-llm | `MessageSource` | [llm-streaming.md](llm-streaming.md#content-blocks-and-messages) |
| `FinishReasonMap` | dsh-llm | `FinishReason` | [llm-streaming.md](llm-streaming.md#the-model-request-and-result) |
| `TurnTriggerMap` | dsh-session | `TurnTrigger` | [session.md](session.md) |
| `TurnEndReasonMap` | dsh-session | `TurnEndReason` | [session.md](session.md) |
| `SessionEventMap` | dsh-session | `SessionEvent` | [session.md](session.md) |

두 개의 큰 판별 유니온은 소비자가 가장 자주 `switch`하는 대상입니다. **`StreamChunk`** (스트리밍 프로토콜) 및 **`SessionEvent`** (로그 항목)입니다. 리포지토리 관례에 따라 태그에는 `switch`를 사용하고 `if`를 연결하지 마십시오. 그러면 각 분기가 좁혀지고 오타가 있는 태그는 컴파일에 실패합니다.

### 브랜드 ID

패키지 간에 전달되는 ID는 **브랜드 처리됩니다** . 구조적으로는 문자열이지만 타입 수준에서는 상호 교환할 수 없습니다(`SessionId`이 필요한 위치에 `CallId`을 전달할 수 없습니다). 생성은 타입별 팩터리를 거치며, 비교·로깅·JSON은 일반 문자열처럼 동작합니다.

`Branded<B>` 기본 요소는 자체 타입 전용 패키지인 [dsh-brand](../../packages/util/brand)에 있습니다(런타임 코드 및 harness-package 종속성 없음). 따라서 모든 패키지는 관련 없는 기능 패키지에 의존하지 않고 자신이 소유하는 ID에 브랜드를 지정할 수 있습니다.

출처: [`packages/util/brand/src/index.ts`](../../packages/util/brand/src/index.ts)

```ts type-equiv
/** A string carrying a compile-time-only brand `B`. */
type Branded<B extends string> = string & { readonly [BRAND]: B }
```

두 핵심 ID는 `CallId`(도구 호출을 해당 결과와 연관시킴, dsh-llm)와 `SessionId`(공유 라이브 에이전트 및 영속 세션 ID, dsh-session)입니다. 기능 패키지 역시 [jobs.md](jobs.md)의 `JobId`처럼 자체 ID에 브랜드를 지정합니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`에서 소스로부터 생성되며(doc-sync에서 `pnpm run verify-cordis-catalog`로 최신 상태가 확인됨, `pnpm run gen-cordis-catalog`로 재생성) 페이지의 두 언어 영역에서 이 섹션은 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxagentdefaultmodel--agentdefaultmodelconfig"></a>

### `ctx.agentDefaultModel` — `AgentDefaultModelConfig`

Host 또는 전송 수단과 무관하게 기본 모델 선택을 소유합니다. 구성 진입점은 설정 제공자 없이도 사용할 수 있으며, 제공자가 마운트되면 해당 사용자 레이어를 실시간으로 읽습니다.

```ts cordis-catalog
/**
 * Read the current default model selection.
 * @returns a detached provider, model, and optional reasoning selection.
 */
currentSelection(): ModelSelection

/**
 * Save the complete default model selection. A deployment without a settings
 * provider keeps its composition entry.
 * @param next - resolved selection accepted by an entry point.
 * @returns fulfillment after the optional settings write settles.
 */
async saveSelection(next: ModelSelection): Promise<void>
```

소스: [`packages/core/agent-default-model/src/index.ts:64`](../../packages/core/agent-default-model/src/index.ts)

<a id="ctxagentloop--agentloop"></a>

### `ctx.agentLoop` — `AgentLoop`

구체적인 에이전트 팩터리 및 드라이버 서비스입니다.

```ts cordis-catalog
/**
 * Create an agent and session under one caller-supplied identity, owned by
 * the accessing fiber. Constructor-driven config calls mint a fresh combined
 * id before entering this boundary.
 * @param id - shared agent/session identity.
 * @param options - concrete loop options.
 * @param meta - optional fresh-session workspace metadata.
 * @returns the published running agent.
 */
create(id: SessionId, options: AgentOptions = {}, meta: Pick<SessionHeader, 'cwd'> = {}): Agent

/**
 * Create an owned agent on a caller-supplied session id.
 * @param ownerCtx - caller context that structurally owns the lifecycle.
 * @param options - identities, session seed/metadata, loop options, setup, and cancellation.
 * @returns the published handle.
 */
async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle>

/**
 * Resume an owned agent from the configured persistence service.
 * @param ownerCtx - caller context that owns load, setup, and the live lifecycle.
 * @param options - persisted identity, loop options, setup, and cancellation.
 * @returns the published handle.
 */
async resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle>
```

유형: [SessionHeader](persistence.md)

소스: [`packages/core/agent-loop/src/index.ts:296`](../../packages/core/agent-loop/src/index.ts)

<a id="ctxagentpresets--agentpresets"></a>

### `ctx.agentPresets` — `AgentPresets`

배포의 에이전트 프리셋을 관리하는 레지스트리입니다.

검색은 메모이제이션되지 않습니다. `list()` 및 `resolve()`은 호출할 때마다 루트를 다시 읽으므로, 프로세스 실행 중에 작성된 프리셋은 즉시 표시되고 선택기 아래에서 삭제된 프리셋은 다음 읽기에서 사라집니다.

```ts cordis-catalog
/**
 * Every preset the configured roots currently supply.
 * @returns the presets, first-root-wins per id.
 */
async list(): Promise<AgentPreset[]>

/**
 * Resolve one preset by id.
 *
 * A broken preset resolves — deleting one, reading one, and reporting one
 * all need the row — and the mounting paths refuse it AFTER resolution
 * through {@link resolveMountable}.
 * @param id - the preset id, or `undefined` for {@link defaultId}.
 * @returns the resolved preset.
 * @throws when no configured root supplies that id.
 */
async resolve(id?: string): Promise<AgentPreset>

/**
 * Compose one agent from a preset: ensure the preset's standing mount, then
 * parent the agent's scope key to it so the mount's registrations and
 * listeners cover this agent.
 *
 * Call from the agent factory's `setup(agentCtx)`; a rejection there rolls
 * the agent creation back, so a broken preset never yields a half-composed
 * session.
 * @param agentCtx - the agent's scope context.
 * @param id - the preset id, or `undefined` for {@link defaultId}.
 * @returns the preset that was composed, for the caller to record.
 * @throws when the preset is unknown or its composition is unusable.
 */
async mount(agentCtx: Context, id?: string): Promise<AgentPreset>

/**
 * Join one agent to the SAME standing composition another already runs on.
 *
 * This is how a child agent inherits its parent's capabilities. It is a bind,
 * not a mount: the parent's generation is already composed, so the child gets
 * that exact instance — the same plugin objects, the same tool registrations,
 * the same prompt sections. Re-resolving the parent's preset by id instead
 * would re-read the roster, and a composition file edited since the parent
 * started would hand the child a DIFFERENT generation than the one its
 * parent's history was produced under (and a preset deleted since would fail
 * the child outright while its parent keeps running).
 *
 * Synchronous, and with no composition failure mode of its own — it reads no
 * roster, mounts nothing, and touches no file — which is what lets a child
 * creation window use it: the two in-process subagent drivers compose their
 * children inside a synchronous `setup`. It still rejects a caller error, as
 * the `@throws` below record.
 *
 * A parent that joined no preset — a rosterless deployment — yields no join
 * and no error: there, the model-facing rows sit in the host composition and
 * the child already sees them through the global layer.
 * @param agentCtx - the joining agent's scope context.
 * @param parentCtx - the scope context of the agent whose composition to join.
 * @returns the preset id joined, or undefined when the parent joined none.
 * @throws when `agentCtx` carries no scope, or has already joined a preset.
 */
composeFrom(agentCtx: Context, parentCtx: Context): string | undefined

/**
 * The preset one live agent runs on.
 *
 * Read from the live scope chain rather than from the session, so it answers
 * for an agent whose session has not recorded a preset yet — a child agent
 * whose durable header is being built from its parent's composition.
 * @param agentCtx - the agent's scope context.
 * @returns the preset id, or undefined when the agent joined none.
 */
composedPreset(agentCtx: Context): string | undefined

/**
 * Read one preset's composition text.
 * @param id - the preset id.
 * @returns the composition exactly as stored.
 * @throws when no configured root supplies that id.
 */
async read(id: string): Promise<string>

/**
 * Create a locally authored preset by copying an existing one whole.
 *
 * Copy is the only authoring write. Composition text never crosses this
 * seam: the source is named by id and its directory is copied as it stands,
 * so the copy is exactly as loadable as its source and authoring grants no
 * capability the roster did not already carry. The copy is NOT mounted to
 * validate — a source that mounts today yields a copy that mounts today.
 * @param from - the preset the copy starts from; shipped presets are the
 * primary source, so any trust is accepted.
 * @param id - the new preset's id, which becomes its directory name.
 * @param name - display name for the copy; absent falls back to the id.
 * @throws when the source is unknown, the id is unusable or already taken,
 * or the deployment configures no writable root.
 */
async copy(from: string, id: string, name?: string): Promise<void>

/**
 * Delete a locally authored preset.
 * @param id - the preset id.
 * @throws when the preset is unknown or ships with the deployment.
 */
async remove(id: string): Promise<void>

/**
 * One agent's instance of a service its preset mounted.
 *
 * A preset publishes services behind `isolate` realms, which are invisible
 * outside the group that declares them — including to the host. This is how a
 * caller holding the agent reads one anyway: a request that is ABOUT a
 * session but arrives from outside it, which is every browser RPC.
 *
 * Read addressing only. A host row that `inject`s a service cannot use this,
 * because injection resolves before any session exists and has no agent to
 * key by; such a service belongs on the host plane instead.
 * @param agent - the agent whose composition to look inside.
 * @param name - the service name as the preset's rows resolve it.
 * @returns the agent's instance, or undefined when its preset mounts none.
 */
serviceFor<K extends string & keyof Context>(agent: { ctx: Context }, name: K): Context[K] | undefined

/**
 * Re-link one agent to a different preset's standing composition.
 *
 * Only valid while the agent has produced nothing: swapping tools mid
 * conversation would leave logged tool calls the new composition cannot
 * make. The CALLER owns that check — this method does not read session
 * history.
 *
 * The swap is a parent re-link, not an unmount: standing mounts are shared
 * and permanent, so the old composition stays for its other agents and the
 * new one is ensured BEFORE the link moves. An unknown or unusable preset
 * therefore throws with the agent exactly as it was — there is no torn-down
 * state to restore. The re-link runs through the binding this roster kept
 * from the agent's mount — dsh-scope's only re-link authority. An agent
 * that never composed one has nothing to re-link: the switch is then the
 * agent's first bind, exactly a mount.
 * @param agentCtx - the agent's scope context.
 * @param id - the preset to compose the agent from instead.
 * @returns the preset now installed.
 * @throws when the preset is unknown or its composition is unusable.
 */
async recompose(agentCtx: Context, id: string): Promise<AgentPreset>

/**
 * The standing scope key of one preset, for a host reader with no agent.
 *
 * A cold transcript read resolves tool presenters against the composition
 * the session recorded, and the standing mount makes that possible without
 * resuming anything: ensuring the mount composes plugins but starts no
 * agent, no session, and no turn.
 * @param id - the preset id, or `undefined` for {@link defaultId}.
 * @returns the standing scope key readers pass as a registry view scope.
 * @throws when the preset is unknown or its composition is unusable.
 */
async standingKeyFor(id?: string): Promise<ScopeKey>
```

유형: [ScopeKey](scope.md)

소스: [`packages/preset/agent-presets/src/index.ts:82`](../../packages/preset/agent-presets/src/index.ts)

<a id="ctxagents--agentregistry"></a>

### `ctx.agents` — `AgentRegistry`

에이전트 서비스(`ctx.agents`)는 활성 에이전트를 추적하고, 프로세스 로컬 비동기 드라이버 체인 하나를 통해 시작 에이전트를 전달합니다. 에이전트 *생성* 은 setFactory를 통해 등록된 AgentFactory(`@deepseek-ai/dsh-agent-loop`)를 구현하는 플러그인에서 제공합니다.

Initiator 메서드는 동일 프로세스 내 인과 관계 추적만 제공합니다. 주변적 존재만으로는 활성 상태나 권한 부여를 증명할 수 없으며, 주체와 소유자는 물론 worker, 프로세스, 영속성 및 wire 경계에서의 ID도 명시적으로 유지됩니다. 반환된 Promise 경계는 해체 중에 드레인되지만, 소유 fiber 언로드를 시작하는 중첩 계보는 자체 드레인에서 제외됩니다.

```ts cordis-catalog
/**
 * Read the Agent that initiated the inherited asynchronous driver chain.
 * Use this optional form for logging, tracing, metrics, or host attribution
 * that also supports agentless calls. When a parent creates a child, setup
 * reports the causal parent while `agentCtx.agent` identifies the child.
 * @returns the inherited Agent, or `undefined` outside an initiator boundary
 *   and inside an explicit clearing boundary.
 * @throws when this service instance has been disposed.
 */
currentInitiator(): Agent | undefined

/**
 * Read the initiating Agent and fail when no initiator boundary is active.
 * Use this for private helpers contractually below a driver, or for a
 * deployment-owned outbound request whose contract forbids agentless calls.
 * Generic or direct-call paths use optional lookup or explicit request fields.
 * @returns the inherited Agent.
 * @throws when no initiator is active or this service instance has been disposed.
 */
requireInitiator(): Agent

/**
 * Run an operation with one exact Agent as its process-local initiator. The
 * exact synchronous value or Promise returned by the operation is preserved.
 * Custom drivers and test harnesses wrap their complete returned foreground
 * lifetime.
 * A queue or wire receiver may establish this boundary only after validating
 * explicit identity and resolving the exact live Agent; this method does neither.
 * Detached work remains owned by the subsystem that starts it.
 * @param agent - initiating Agent to inherit; presence is neither liveness proof nor authorization.
 * @param operation - synchronous or asynchronous operation to invoke.
 * @returns the exact value returned by `operation`.
 * @throws when the initiator scope is closing/disposed, or when `operation` throws.
 */
withInitiator<T>(agent: Agent, operation: () => T): T

/**
 * Run an operation inside a boundary that hides any inherited initiating
 * Agent. The exact synchronous value or Promise is preserved.
 * Use this while creating lazy shared timers, queue pumps, pool maintenance,
 * watchers, or exporters so they do not inherit the first Agent that happens
 * to initialize them. It clears only initiator attribution, not explicit
 * fields, and does not own or drain detached resources.
 * @param operation - synchronous or asynchronous operation to invoke without an initiator.
 * @returns the exact value returned by `operation`.
 * @throws when the initiator scope is closing/disposed, or when `operation` throws.
 */
withoutInitiator<T>(operation: () => T): T

/**
 * Register the agent-creation factory (the loop calls this on construction,
 * effect-scoped). A traced Cordis service is canonicalized to its concrete
 * target; each create/resume call is then traced through that caller's
 * context so ownership follows the caller without stacking proxy layers.
 * Throws if a factory is already registered. Returns the disposer; on
 * dispose the factory slot is cleared.
 * @param factory - the loop-owned factory {@link create}/{@link resume} delegate to.
 * @returns the disposer that clears the factory slot. The exact
 *   Cordis effect disposer (single-shot): composite (generator) effects may
 *   yield it directly — exact identity nests the teardown in order.
 */
setFactory(factory: AgentFactory): () => void

/**
 * Create and publish a new agent through the registered factory.
 * Distinct from {@link register} (which records an already-constructed
 * agent): this constructs the agent and its session. Rejects if no factory is
 * registered or creation/setup fails. The resolved {@link AgentHandle} lets
 * the owner tear down exactly this agent.
 * @param options - shared identity, session seed/metadata, and agent options.
 * @returns the handle after setup, rollback-covered publication, and loop start complete.
 */
async create(options: CreateAgentOptions): Promise<AgentHandle>

/**
 * Load a persisted session and resume an agent on it through the registered
 * factory. Rejects if no factory is registered; the factory rejects if
 * session persistence is not configured or persistence/setup fails.
 * @param options - persisted identity, configuration, and optional setup.
 * @returns the handle after setup, rollback-covered publication, and loop start complete.
 */
async resume(options: ResumeAgentOptions): Promise<AgentHandle>

/**
 * Register a live agent. Throws if an agent with the same id is already
 * registered. Emits `agent/created` on registration and `agent/disposed`
 * when the calling fiber is disposed — both with the agent's scope carrier
 * (`scopeTarget(agent, agent)`): the subject is the agent in hand, so the
 * emits are scope-filtered regardless of which context invoked `register`
 * (calling through `agent.ctx` scopes EFFECTS; dispatch scoping always
 * requires passing the carrier). Returns the disposer.
 * @param agent - the already-constructed agent to record in the store.
 * @returns the EXACT Cordis effect disposer (single-shot; a repeat call
 *   returns undefined without awaiting an in-flight teardown). Exact
 *   identity is load-bearing: a composite (generator) effect that owns a
 *   teardown ORDER — the agent factory's lifecycle chain — must yield THIS
 *   function so Cordis nests the unregistration at that yield position;
 *   yielding a wrapper would leave it disposing as a concurrent sibling on
 *   owner unload, unregistering the agent (and emitting `agent/disposed`)
 *   while its final turn is still draining.
 */
register(agent: Agent): () => void

/**
 * Insert an already-constructed agent without announcing it. This is the
 * advanced ordered-lifecycle primitive used by the async agent factory: it
 * first completes setup while the agent is unpublished, then assigns the
 * returned detach closure into its pre-installed composite teardown before
 * calling {@link announce}. Ordinary callers use {@link register}.
 * @param agent - the prepared, unpublished agent.
 * @param owner - live agent whose scoped context created this agent, or
 *   undefined for a top-level runtime root. This is runtime ownership, not
 *   the resumed session's durable parent lineage.
 * @returns an idempotent closure that removes this exact entry and emits
 *   `agent/disposed` with listener failures contained. When called from a
 *   synchronous `agent/created` listener, removal and disposal wait until
 *   that creation dispatch unwinds.
 */
enter(agent: Agent, owner: Agent | undefined): () => void

/**
 * Announce an agent previously inserted with {@link enter}.
 * @param agent - the live inserted agent to announce.
 * @throws if `agent` is not the exact live registry entry for its id, or its
 *   creation announcement already began (including a reentrant call from a
 *   creation listener).
 */
announce(agent: Agent): void

/**
 * Look up a live agent.
 * @param id - the shared agent/session id to look up.
 * @returns the agent, or undefined when no live agent has that id.
 */
get(id: SessionId): Agent | undefined

/**
 * Test whether a live agent was created through one exact parent agent's
 * scoped context. Runtime ownership is independent of durable session
 * lineage and remains unambiguous when unrelated providers reuse an id.
 * @param id - the candidate child agent's shared agent/session id.
 * @param owner - the expected runtime creator agent.
 * @returns true only while the exact child entry is live under that owner.
 */
isOwnedBy(id: SessionId, owner: Agent): boolean

/**
 * All live agents, in registration order.
 * @returns a fresh array; mutating it does not affect the registry.
 */
list(): Agent[]

/**
 * All live top-level agents in registration order. A top-level agent was
 * created without an owning agent context; durable session lineage does not
 * affect this runtime relation, so a resumed fork may still be a root.
 * @returns a fresh array; mutating it does not affect the registry.
 */
roots(): Agent[]
```

소스: [`packages/core/agent/src/index.ts:256`](../../packages/core/agent/src/index.ts)

<a id="agent-events"></a>

### `agent/*` 이벤트

<a id="agentcreated--emit"></a>

#### `agent/created` — emit

완전히 구성된 에이전트와 활성 세션이 게시되었습니다. 설정은 구성 전용이며, `agent/session-start`은(는) 시작을 구동하는 첫 번째 확장 지점입니다. 동기 리스너 실패는 게시를 거부하지만, 반환된 Promise의 거부는 보고됩니다. 디스패치 중 요청된 분리는 모든 생성 리스너가 안정적인 항목을 확인할 때까지 기다립니다.

```ts cordis-catalog
/**
 * A fully configured agent and live session were published. Setup is
 * composition-only; `agent/session-start` is the first startup-driving extension point.
 * Synchronous listener failure vetoes publication, while returned-promise
 * rejection is reported. Detach requested during dispatch waits until every
 * creation listener has observed the stable entry.
 * @param payload.agent - the newly registered agent with its live session and completed setup.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/created'(this: Scoped<Agent>, payload: { agent: Agent }): void
```

타입: [Scoped](scope.md)

소스: [`packages/core/agent/src/runtime-types.ts:159`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentdisposed--emit"></a>

#### `agent/disposed` — emit

에이전트가 레지스트리를 떠났습니다. AgentLoop는 드라이버가 안정화되고 범위 지정 등록이 해제된 후, 세션이 분리되기 전에 이를 내보냅니다. 사용자 지정 레지스트리 사용자는 자체 드라이버 순서 지정 계약을 관리합니다.

```ts cordis-catalog
/**
 * An agent left the registry; AgentLoop emits this after driver quiescence
 * and scoped-registration unwind, but before session detachment. Custom
 * registry users own their driver-ordering contract.
 * @param payload.agent - the exact agent removed from the registry.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/disposed'(this: Scoped<Agent>, payload: { agent: Agent }): void
```

타입: [Scoped](scope.md)

소스: [`packages/core/agent/src/runtime-types.ts:168`](../../packages/core/agent/src/runtime-types.ts)

<a id="agenterror--emit"></a>

#### `agent/error` — emit

단계 또는 턴에서 오류가 발생했습니다. 오류에 영구 레코드를 위한 턴 내 위치가 없더라도 머신은 여기에서 실패를 보고합니다.

```ts cordis-catalog
/**
 * A step or turn errored. The machine reports a failure here even when
 * the error has no in-turn position for a durable record.
 * @param payload.agent - the agent whose turn errored.
 * @param payload.turn - the turn in which the failure surfaced.
 * @param payload.step - the step at which the failure surfaced.
 * @param payload.error - the failure, verbatim.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/error'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; error: unknown }): void
```

타입: [Scoped](scope.md)

소스: [`packages/core/agent/src/runtime-types.ts:290`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentinboxclaimed--emit"></a>

#### `agent/inbox/claimed` — emit

열린 턴 내에서 하나의 메시지가 받은 편지함을 떠났습니다. 제안된 단계가 거부되면, 확보된 메시지는 여기서 종료됩니다. 이 메시지는 삭제되지도 user/message로 다시 내보내지지도 않으며, 턴은 단계 없이 종료됩니다.

```ts cordis-catalog
/**
 * One message left the inbox inside its open turn. If the proposed step
 * is rejected, the claimed message ends here: it is neither discarded nor
 * re-emitted as a user/message, and the turn closes without a step.
 * @param payload.agent - the agent whose inbox changed.
 * @param payload.message - the claimed message.
 * @param payload.turn - the owning turn.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/inbox/claimed'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage; turn: number }): void
```

타입: [Scoped](scope.md) · [UserMessage](session.md)

소스: [`packages/core/agent/src/runtime-types.ts:197`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentinboxdiscarded--emit"></a>

#### `agent/inbox/discarded` — emit

하나의 메시지가 활성 받은 편지함에서 삭제되었습니다.

```ts cordis-catalog
/**
 * One message was discarded from the live inbox.
 * @param payload.agent - the agent whose inbox changed.
 * @param payload.message - the discarded message.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/inbox/discarded'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage }): void
```

타입: [Scoped](scope.md) · [UserMessage](session.md)

소스: [`packages/core/agent/src/runtime-types.ts:205`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentinboxinserted--emit"></a>

#### `agent/inbox/inserted` — emit

하나의 메시지가 활성 받은 편지함에 들어왔습니다.

```ts cordis-catalog
/**
 * One message entered the live inbox.
 * @param payload.agent - the agent whose inbox changed.
 * @param payload.message - the inserted message.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/inbox/inserted'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage }): void
```

타입: [Scoped](scope.md) · [UserMessage](session.md)

소스: [`packages/core/agent/src/runtime-types.ts:186`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentpre-step--waterfall"></a>

#### `agent/pre-step` — waterfall

제안된 단계를 거부하거나 그 단계에 들어오는 메시지를 교체합니다. `next()`을(를) 호출하면 현재 메시지가 유지됩니다.

```ts cordis-catalog
/**
 * Reject a proposed step or replace the messages that enter it. Calling
 * `next()` preserves the current messages.
 * @param payload.agent - the agent proposing the step.
 * @param payload.messages - messages removed from the inbox for this step.
 * @param payload.turn - the turn that will own the step.
 * @param payload.step - the step proposed by the loop.
 * @param payload.signal - the current turn's cancellation signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode waterfall
 */
'agent/pre-step'(this: Scoped<Agent>, payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal }, next: () => Promise<PreStepDecision>): Promise<PreStepDecision>
```

타입: [Scoped](scope.md) · [UserMessage](session.md)

소스: [`packages/core/agent/src/runtime-types.ts:231`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentrequest--waterfall"></a>

#### `agent/request` — waterfall

고정된 호출 구성을 교체합니다. `await next()`은(는) 머신이 사용할 구성을 반환합니다(첫 번째 요청에서는 에이전트 옵션, 이후에는 기록된 헤더). 교체할 구성을 반환하면 전환됩니다. 모델에 표시되는 콘텐츠는 기록된 채널을 사용해야 하며, 이 waterfall은 메시지를 변경할 수 없습니다.

```ts cordis-catalog
/**
 * Replace the frozen call configuration. `await next()` yields the config
 * the machine would use (agent options on the first request, the logged
 * header afterwards); return a replacement to switch. Model-visible
 * content must use logged channels; this waterfall cannot mutate messages.
 * @param payload.agent - the agent making the model call.
 * @param payload.turn - the open turn number.
 * @param payload.step - the step whose request this is.
 * @param payload.signal - the current turn's explicit abort signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode waterfall
*/
'agent/request'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; signal: AbortSignal }, next: () => Promise<LlmCallConfig>): Promise<LlmCallConfig>
```

유형: [LlmCallConfig](llm-streaming.md) · [Scoped](scope.md)

소스: [`packages/core/agent/src/runtime-types.ts:244`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentrequest-error--waterfall"></a>

#### `agent/request-error` — 워터폴

루프가 재시도하거나 단계를 닫기 전에 실패한 모델 요청 시도 하나를 처리합니다. 복구를 담당하는 리스너는 `next()`를 호출하지 않고 `{ kind: 'retry' }`를 반환하거나, 위임하기 위해 `next()`를 호출합니다. 기본 `undefined`는 실패를 최종 상태로 둡니다.

```ts cordis-catalog
/**
 * Handle one failed model-request attempt before the loop retries or closes
 * its step. A listener returns `{ kind: 'retry' }` without calling `next()`
 * when it owns recovery, or calls `next()` to delegate. The default
 * `undefined` leaves the failure terminal.
 * @param payload.agent - the agent whose request failed.
 * @param payload.turn - the turn containing the failed request.
 * @param payload.step - the step containing the failed request attempt.
 * @param payload.provider - the provider selected for the failed request.
 * @param payload.failure - serializable facts normalized at the final adapter boundary.
 * @param payload.retryPolicy - the policy of the adapter registration that served the failed request.
 * @param payload.signal - the turn abort signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode waterfall
 */
'agent/request-error'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; provider: string; failure: LlmFailure; retryPolicy: ResolvedRetryPolicy | undefined; signal: AbortSignal }, next: () => Promise<RequestErrorAction>): Promise<RequestErrorAction>
```

유형: [LlmFailure](llm-streaming.md) · [ResolvedRetryPolicy](llm-streaming.md) · [Scoped](scope.md)

소스: [`packages/core/agent/src/runtime-types.ts:260`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentsession-start--emit"></a>

#### `agent/session-start` — 발생

첫 번째 턴 전에 세션 수명 주기가 한 번 시작되었습니다. `agent.inject()`를 사용하여 모델에 전달할 컨텍스트를 초기화합니다. 이는 거부가 아닌 알림이며, 수명 주기 소유자가 요청한 폐기는 드라이버가 시작되기 전에 다시 확인됩니다.

```ts cordis-catalog
/**
 * The session lifecycle began, once before the first turn. Use
 * `agent.inject()` to seed model-facing context. This is a notification, not
 * a veto; disposal requested by a lifecycle owner is rechecked before the
 * driver starts.
 * @param payload.agent - the agent whose session lifecycle began.
 * @param payload.source - why the session started (fresh startup, resume, …).
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/session-start'(this: Scoped<Agent>, payload: { agent: Agent; source: SessionStartSource }): void
```

유형: [Scoped](scope.md)

소스: [`packages/core/agent/src/runtime-types.ts:217`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentstatus--emit"></a>

#### `agent/status` — 발생

에이전트 상태가 변경되었습니다(`idle` ⇄ `running`). 깨우기 전달은 취소를 예약한 뒤 동기적으로 `running`에 진입합니다. `idle`는 예약되었거나 활성 상태인 드라이버가 더 이상 없음을 의미합니다.

```ts cordis-catalog
/**
 * Agent status changed (`idle` ⇄ `running`). A waking delivery enters
 * `running` synchronously after reserving cancellation; `idle` means no
 * driver remains scheduled or active.
 * @param payload.agent - the agent whose status flipped.
 * @param payload.status - the status just entered (the transition's destination).
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/status'(this: Scoped<Agent>, payload: { agent: Agent; status: AgentStatus }): void
```

유형: [Scoped](scope.md)

소스: [`packages/core/agent/src/runtime-types.ts:178`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentturn-stopping--serial"></a>

#### `agent/turn-stopping` — 직렬

턴이 곧 종료됩니다. 모델은 응답할 의무가 없습니다(활성 도구 호출이나 새 조정이 없음). 경계가 확정되기 전에 대기하며, 이의를 제기하는 리스너는 조정(`agent.steer(...)`)하고 시스템은 받은 편지함을 다시 읽습니다. 새 조정이 있으면 다른 단계를 실행하고, 없으면 턴을 닫습니다. 데이터가 결정하므로 리스너 순서는 결과를 바꿀 수 없습니다. 반대 제어(도구 루프를 조기에 중지)는 데이터이기도 합니다. `concludesTurn`를 포함한 도구 결과는 해당 단계에서 턴을 끝냅니다. 결론은 이미 제출된 다음 단계 작업을 단축하지 않습니다. 동일 단계의 `additionalContexts` 또는 경합 중인 조정은 계속 실행되며, 받은 편지함이 비워질 때만 턴이 닫힙니다.

```ts cordis-catalog
/**
 * The turn is about to close: the model owes no response (no live tool
 * calls, no fresh steering). Awaited before the boundary commits — a
 * listener that objects steers (`agent.steer(...)`) and the machine
 * re-reads its inbox: fresh steering runs another step, none closes the
 * turn. Data decides, so listener order cannot change the outcome. The
 * inverse control (stop a tool loop early) is data too: a tool result
 * carrying `concludesTurn` ends the turn at its step. The conclusion
 * never short-circuits already-submitted next-step work: same-step
 * `additionalContexts` or racing steering still runs, and the turn
 * closes only when that inbox drains.
 * @param payload.agent - the agent whose turn is at its stop boundary.
 * @param payload.turn - the turn about to close.
 * @param payload.signal - the current turn's explicit abort signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode serial
 */
'agent/turn-stopping'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; signal: AbortSignal }): Promise<void> | void
```

유형: [Scoped](scope.md)

소스: [`packages/core/agent/src/runtime-types.ts:278`](../../packages/core/agent/src/runtime-types.ts)

<a id="agent-loop-events"></a>

### `agent-loop/*` 이벤트

<a id="agent-loopconfig-start-failed--emit"></a>

#### `agent-loop/config-start-failed` — 발생

선언형 에이전트 항목이 활성 에이전트를 게시하기 전에 실패했습니다. 구성된 ID에 대한 작업을 버퍼링하는 소비자는 영원히 기다리는 대신 이 일시적 신호를 사용하여 해당 작업을 거부합니다. 일반적인 팩토리 해제는 취소된 시작 시도에서 발생한 실패를 억제합니다.

```ts cordis-catalog
/**
 * A declarative agent entry failed before it could publish a live agent.
 * Consumers that buffer work for the configured identity use this
 * transient signal to reject that work instead of waiting forever. Normal
 * factory teardown suppresses failures from the cancelled startup attempt.
 * @param payload.sessionId - exact shared agent/session identity that failed startup.
 * @param payload.error - persistence, setup, or publication failure.
 * @mode emit
 */
'agent-loop/config-start-failed'(payload: { sessionId: SessionId; error: unknown }): void
```

소스: [`packages/core/agent-loop/src/index.ts:183`](../../packages/core/agent-loop/src/index.ts)

<a id="agent-preset-events"></a>

### `agent-preset/*` 이벤트

<a id="agent-presetselected--emit"></a>

#### `agent-preset/selected` — 발생

한 세션이 다른 에이전트 프리셋을 영속 로그에 커밋했습니다. 소비자는 해당 세션의 구성에서 파생된 상태만 무효화합니다.

```ts cordis-catalog
/**
 * One session committed a different agent preset to its durable log.
 * Consumers invalidate only state derived from that session's composition.
 * @mode emit
 * @param sessionId - the session whose composition changed.
 * @param agentPreset - the preset recorded by the committed selection.
 */
'agent-preset/selected'(sessionId: SessionId, agentPreset: string): void
```

소스: [`packages/preset/agent-presets/src/types.ts:13`](../../packages/preset/agent-presets/src/types.ts)
<!-- END GENERATED cordis-surface -->
