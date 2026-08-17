# 하위 에이전트

하위 에이전트 심을 사용하면 에이전트가 작업을 자식 에이전트에 위임할 수 있습니다. [bash](shell.md)와 마찬가지로 이는 에이전트 루프의 일부가 아닌 **선택적 기능 하나**이므로, 해당 타입은 [core.md](core.md)가 아니라 여기에 있습니다. bash는 실행자를 하나만 허용하는 반면, 이 심은 이름(`ctx.subagents`)으로 등록된 **여러 공급자 구현이 하나의 컨텍스트에 공존한다는 점** 에서 다른 기능 심과 다릅니다. 레지스트리는 단일 서비스 bash 실행자가 아니라 [LLM 어댑터 레지스트리](llm-streaming.md)를 따릅니다.

서비스 정의: [dsh-subagent](../../packages/subagent/subagent)(`ctx.subagents` 및 아래 용어). 서비스 공급자는 형제 패키지(`dsh-subagent-spawn-in-process`, `-fork`, `-acp`, `-codex`, `-claude-code`, `-dsh-sdk`)이며, 모델 대상 소비자는 [dsh-tool-subagent](../../packages/subagent/tool-subagent)(공급자별 위임), [dsh-tool-subagent-control](../../packages/subagent/tool-subagent-control)(선택적 전역 `send_message`, `interrupt_agent` 및 `list_agents` 제어), 그리고 [dsh-tool-subagent-report](../../packages/subagent/tool-subagent-report)(선택적 자식 범위 `report` 반환 채널)입니다. 동일한 `ctx.subagents` 서비스는 내부 활성화 관리자를 통해 계속 가능한 자식 오케스트레이션을 소유하며, 세션 저장소와 선택적 세션 영속성에서 자식 및 하위 자식을 읽기 전용으로 직접 검색합니다. 제품 공급자에 대한 근거는 [Codex 및 Claude Code Agent Note](../../.agents/notes/implemented/feature/2026-08-04-claude-code-and-codex-subagent-backends.md)에 있고, 공통 심에 대한 근거는 [하위 에이전트 Agent Note](../../.agents/notes/implemented/feature/2026-06-21-subagent-capability-seam.md), [계속 가능한 하위 에이전트 Agent Note](../../.agents/notes/implemented/feature/2026-07-28-continuable-subagent-conversations.md), [보고 도구 Agent Note](../../.agents/notes/implemented/feature/2026-07-30-continuable-subagent-report-tool.md), [영속적 카탈로그 Agent Note](../../.agents/notes/implemented/feature/2026-07-22-durable-subagent-catalog-and-list-agents.md), [목록-식별성-투영 Agent Note](../../.agents/notes/implemented/architecture/2026-08-06-subagent-list-identity-projection.md) 및 [병합된 서비스 Agent Note](../../.agents/notes/implemented/simplification/2026-07-26-merge-subagent-control-service.md)에 있습니다.

소스: [`packages/subagent/subagent/src/types.ts`](../../packages/subagent/subagent/src/types.ts), [`packages/subagent/subagent/src/index.ts`](../../packages/subagent/subagent/src/index.ts) 및 [`packages/subagent/subagent/src/continuation.ts`](../../packages/subagent/subagent/src/continuation.ts)

## 두 가지 방식으로 발견되는 두 종류의 기능

공급자는 일회성 실행이 존재하기 전에 서비스가 확인하는 정적 설명자에서 **시작 시점**  기능을 알립니다. 공급자에 없는 기능이 필요한 요청은 묵묵히 거부되지 않고(`SubagentError('UNSUPPORTED_CAPABILITY')`) 명시적으로 거부되며, 수락된 뒤 무시되지 않습니다. 이 플래그는 공급자가 자식을 구성하는 일회성 [`start()`](#the-provider-contract-subagentprovider) 경로만 설명합니다. **계속 가능한**  자식은 계속 관리자가 직접 구성하므로, 기능의 존재 자체를 의미하는 선택적 메서드 하나로 제어되며 TS 좁히기가 발견 메커니즘으로 사용됩니다: [`SubagentProvider.prepareContinuable`](#the-provider-contract-subagentprovider).

```ts type-equiv
/**
 * Which START-TIME features a provider supports. Checked by the service before delegating to
 * {@link SubagentProvider.start}: a request that needs a capability the chosen provider lacks
 * is rejected with a typed error rather than accepted-then-ignored (the "fail loud, no silent
 * degradation" rule). These flags describe the ONE-SHOT
 * {@link SubagentProvider.start} path, where the provider composes the child;
 * continuable children are composed by the continuation manager itself and are
 * gated by {@link SubagentProvider.prepareContinuable} instead. Each flag
 * corresponds one-to-one to a {@link SubagentStartRequest} option: `depthLimit`
 * to `maxDepth`; the other names match.
 */
interface SubagentCapabilities {
  readonly outputSchema: boolean
  readonly depthLimit: boolean
  readonly toolFilter: boolean
  readonly persona: boolean
}
```

## 일회성 시작 요청

도구 계층은 모델 입력과 자체 설정을 바탕으로 이 요청을 빌드합니다. 서비스는 `start` 전에 이름이 지정된 공급자에 대해 이를 검증합니다. 필수 `parent`는 세션 cwd, 계보 및 위임 깊이를 제공합니다. 선택적 출력 스키마, 깊이, 도구 필터 및 페르소나는 일치하는 기능 플래그가 필요합니다. 지원되지 않는 스키마는 시작 시 실패합니다. 프로세스 내 백엔드는 필터와 페르소나를 자식 생성 범위로 한정하고, 강제 캡처 도구를 사용해 지원되는 객체 루트 스키마를 구현합니다.

```ts type-equiv
/**
 * What a caller asks for when starting a ONE-SHOT subagent. The tool layer
 * builds this from the model's `{ description, prompt }` plus its own config;
 * the service validates {@link SubagentCapabilities} against the named provider
 * and resolves the durable descriptor before dispatching to
 * {@link SubagentProvider.start}.
 */
interface SubagentStartRequest {
  /** Optional short display label persisted with a session-backed child. */
  readonly label?: string
  /** Content delivered as the child's user message. */
  readonly prompt: ContentBlock[]
  /**
   * The spawning agent. In-process providers derive workspace, lineage, and
   * delegation depth from its durable session state. ACP reads only its cwd,
   * and only when no deployment `cwd` override is configured.
   */
  readonly parent: Agent
  /**
   * Cancellation signal from the spawning context (the tool's `exec.signal`).
   * This is the canonical cancellation channel both before and after startup:
   * a provider rejects `start()` after cleaning partial resources when it
   * fires before the run is published, and cancels the published run's
   * remaining turn work when it fires afterward.
   */
  readonly signal: AbortSignal
  readonly agentOptions?: AgentOptions
  /**
   * Object-rooted JSON Schema within `assertObjectJsonSchema`'s enforced subset. Start rejects
   * unsupported schemas or providers without the capability. Data must be plain host-realm JSON;
   * a successful child returns the matching value as {@link SubagentResult.structured}.
   */
  readonly outputSchema?: ObjectJsonSchema
  /**
   * Optional absolute delegation-depth cap for the child being started: its
   * computed depth must be less than or equal to this non-negative safe
   * integer. Requires {@link SubagentCapabilities.depthLimit}; rejected at
   * start otherwise.
   */
  readonly maxDepth?: number
  /**
   * Optional child tool scoping. Requires {@link SubagentCapabilities.toolFilter};
   * rejected at start otherwise. In-process backends apply it as a scoped
   * `tools.restrict()` in the child's creation window: the named tools vanish
   * from the child's prompt AND refuse to execute (one visibility), with loud
   * unknown-name validation.
   */
  readonly toolFilter?: ToolRestriction
  /**
   * Optional per-child persona. Requires {@link SubagentCapabilities.persona};
   * rejected at start otherwise. In-process backends register it as a scoped
   * `deployment:persona` section on the child, SHADOWING the deployment's
   * persona for this child alone — same template semantics as the deployment
   * persona (strict `{{…}}` interpolation against the registered variables).
   */
  readonly persona?: string
}
```

`signal`는 준비 전후의 단일 취소 채널입니다. [하위 에이전트 구성 제어 Agent Note](../../.agents/notes/implemented/feature/2026-07-12-subagent-persona-tool-filter-and-depth.md)에는 페르소나, 라이브 전역 도구 필터, 절대 깊이, 그리고 가시성과 권한은 다르다는 근거가 설명되어 있습니다.

호출자 측 요청에는 카탈로그 형식 세부 정보나 연속 상태가 포함되지 않습니다. `SubagentRuntime.start()`는 기능 검사 후 분리된 일회성 기술자를 확인한 다음, 이 공급자 측 요청을 선택된 전송 계층에 전달합니다. 연속 가능한 자식은 `SubagentProvider.start()`에 도달하지 않습니다.

```ts type-equiv
/**
 * Provider-facing one-shot request after {@link SubagentRuntime.start} resolves
 * the durable child descriptor.
 */
interface ResolvedSubagentStartRequest extends SubagentStartRequest {
  /** Detached descriptor a session-backed provider persists in the child log. */
  readonly descriptor: SubagentDescriptorData
}
```

## 연속 가능한 자식 및 활성화

**연속 가능한 백그라운드 하위 에이전트** 는 내구성 있는 하나의 자식 Session이며, 재구성된 자식 Agent가 메모리에 상주하는 기간인 프로세스 로컬 **Activation**을 최대 하나 가집니다. Activation은 요청, 결과, 취소 또는 Task가 아닙니다. 여러 FIFO 턴을 실행할 수 있으며, 자신이 생성한 하위 항목이 계속 실행 중인 동안에는 상주 상태를 유지합니다. 연속 관리자에서는 활성화 승인, 직접 부모 권한 부여, 활성 소유권 그래프, 콜드 재개 및 자식 우선 폐기를 담당하고, Agent 루프에서는 모든 턴 순서와 실행을 담당합니다. 연속 가능한 경로에서는 Task나 결과를 담는 중간 래퍼를 생성하지 않습니다.

```text
persisted Session
  -> optional live Activation
       -> one retained AgentHandle
       -> Agent inbox as the only turn FIFO
       -> zero or more owned child Activations
```

`SubagentRuntime.startContinuable()`는 안정적인 자식 ID를 예약하고, 버전이 지정된 `subagent/descriptor` 페이로드의 스냅샷을 만들며, 명명된 공급자에게 분리된 `ContinuableCreateSpec`를 요청하고, 비공개 활성화 소유자 범위를 통해 자식 Agent를 생성하며, 필요한 연속 가능한 부모 소유권을 설정한 뒤 초기 프롬프트를 제출합니다. 받은편지함 수락으로 메시지 ID가 생성되면 턴이 시작되거나 메시지가 Session 로그에 들어갈 때까지 기다리지 않고 `{ childId, messageId }`로 확인됩니다. 그 수락 이전의 모든 실패는 ID 없이 거부되며, 생성된 핸들을 폐기하고 Activation 및 부모 소유권을 롤백합니다.

`SubagentRuntime.followup()`는 유일한 연속 메시지 작업이며, 라우팅은 Activation 상주 상태에만 따라 결정됩니다.

| 활성화 상태 | `followup` |
|---|---|
| `running` | 동일한 Activation에 대기열로 추가 |
| `waiting` | 동일한 Activation 깨우기 |
| Activation 없음 | 새 Activation 콜드 재개 |

`running`는 Agent에 활성 승인 또는 턴이 있거나 받은편지함 작업을 깨우는 중임을 의미합니다. `waiting`는 유휴 상태이지만 아직 폐기 완료되지 않은 자식 Activation을 하나 이상 소유하고 있음을 의미합니다. `settled`는 소유한 모든 자식이 폐기된 유휴 상태를 의미하며, 이 시점에 관리자는 [`AgentHandle`](core.md#creation-and-ownership)를 폐기하고 Activation을 제거합니다. 관리자는 별도의 실행 상태 머신을 유지하는 대신 Agent의 유휴 상태와 소유한 자식 집합에서 이러한 내부 조건을 도출합니다.

Agent 받은편지함은 유일한 대기열입니다. 모든 연속 메시지는 하나의 `Agent.followup()` FIFO 턴이 되므로 수락된 메시지에는 관찰 가능한 단일 순서가 있으며, 후속 작업은 이미 진행 중인 턴을 다시 라우팅할 수 없습니다. 성공적으로 전달되면 수락된 `MessageId`를 반환합니다. 기존 `agent/inbox/inserted`, `agent/inbox/claimed` 및 `agent/inbox/discarded` 이벤트는 메시지 수명 주기 관찰로 유지되며, 연속 계층에서는 하위 에이전트 전용 전달 경로를 정의하지 않습니다.

후속 작업 권한은 정확한 활성 Agent 도구 컨텍스트에서 나옵니다. 인증된 Agent는 `SessionHeader.parentSession`에 기록된 내구성 자식의 직접 부모여야 합니다. `MessageSource` 및 `senderSessionId`는 승인된 메시지를 제공한 주체를 기록하지만 어떠한 권한도 부여하지 않습니다. 선택적 모델 대면 도구에서는 `CoordinatorMessageSource`를 사용합니다.

두 작업 모두에서 호출자 신호는 받은편지함 수락 전까지 조회, 구체화 및 승인만 소유합니다. 이후에는 관리자가 Activation을 독립적으로 소유합니다. 이후의 호출자 취소는 수락된 턴을 취소하거나 자식을 폐기하지 않으며, 추상 경계에서는 조종 작업을 노출하지 않습니다.

`SubagentRuntime.interrupt(targetSessionId, authority)`는 유일한 공개 중지 작업입니다. 동기적으로 권한을 부여하고, 활성 대상에 `Agent.cancel(cause, { keepInbox: true })`를 실행한 뒤 유휴 상태를 기다리지 않고 반환합니다. Activation, 아직 가져가지 않은 보류 중인 받은편지함 작업 및 게시된 하위 항목은 변경되지 않습니다. 인터럽트된 턴에 이미 할당된 작업은 다시 대기열에 넣지 않습니다. 인터럽트된 드라이버가 유휴 상태가 되면 깨우기 전송이 보류된 FIFO 대기열을 재개합니다. 알 수 없거나 일회성이거나 이미 완료된 대상의 부재와 관리자 없는 구성은 허용되는 무작업입니다. 활성 대상의 경우, 일치하지 않는 부모 주소 또는 활성 조상 계보 밖의 호출자는 `UNAUTHORIZED`로 거부됩니다. 오래된 조상 객체와 자신을 대상으로 하는 조상 요청은 대상 조회 전에 거부됩니다.

```ts type-equiv
/**
 * Authority under which one interrupt request is admitted. `user` carries the
 * durable direct-parent address a human client presented; `ancestor` carries
 * the exact live Agent object whose recorded lineage must contain the caller.
 */
type SubagentInterruptAuthority =
  | { readonly kind: 'user'; readonly parentSessionId: SessionId }
  | { readonly kind: 'ancestor'; readonly agent: Agent }
```

각 Activation은 자신의 `AgentHandle` 및 `ownedChildren: Set<SessionId>`를 소유합니다. 하나의 Session에는 활성 Activation이 최대 하나이므로, 자식 Session ID는 별도의 런타임 인스턴스 참조 없이 활성 자식을 식별합니다. 자식을 시작하거나 부모에서 시작된 작업을 제출하면 자식이 실행되기 전에 연속 관리 부모의 집합에 자식을 등록하며, 이 집합이 비어 있지 않은 동안 부모는 완료될 수 없습니다. 최상위 Agent 또는 다른 비연속 Agent에는 Activation이 없으며 대기 그래프 밖에 유지됩니다. 자식 해제는 자식 Agent가 유휴 상태이고 그 자식의 모든 하위 항목이 폐기되었으며 최선 노력 최종 세션 플러시가 완료되고 자식의 `AgentHandle`가 폐기를 완료한 후에만 발생합니다.

최종 완료는 `ctx.sessions.flush(session)`를 기다리지만 임의의 리스너가 영속성 백엔드가 상태를 저장했음을 증명할 수 없으므로 참여 부울 값은 무시합니다. 거부는 Activation을 실패시키지 않고 기록되며, 관리자는 여전히 핸들을 폐기하고 소유권을 해제합니다. 따라서 이후 재개 시 영속된 자식 상태가 없거나 오래되었을 수 있습니다. 관리자 언로드는 승인을 닫고 모든 활성 포리스트를 폐기하는 내부 관리자 전체 드레인을 호출합니다. `drainContinuableDescendants(parents)`는 정확한 활성 호스트 소유 Agent 아래에서만 승인을 닫고 연속 가능한 하위 항목을 폐기하며, 관련 없는 포리스트는 활성 상태로 유지됩니다. 둘 다 범위 내에서 이미 승인된 구체화가 끝날 때까지 기다리고, 취소를 상위에서 하위로 전파하며, 핸들을 자식 우선으로 해제하고, 개별 실패가 있어도 선택된 모든 분기를 기다립니다. 내구성 자식 Session은 이러한 프로세스 로컬 해체 후에도 유지됩니다.

```ts type-equiv
/** Attribution for a model coordinator's follow-up to one of its children. */
interface CoordinatorMessageSource {
  readonly kind: 'coordinator'
  /** A message another agent addressed to this one (`relay` context form). */
  readonly form: 'relay'
  /** Session id of the agent whose tool call produced the follow-up. */
  readonly senderSessionId: SessionId
}
```

```ts type-equiv
/** Options for following up with one continuable child. */
interface SubagentFollowupOptions {
  /** Durable attribution retained on the delivered message; it grants no authority. */
  readonly source: MessageSource
  /** Caller cancellation, owning the operation only until inbox acceptance. */
  readonly signal: AbortSignal
}
```

```ts type-equiv
/** Identities returned once a continuable child accepted its initial prompt. */
interface ContinuableStart {
  /** The durable child session id, stable across activations. */
  readonly childId: SessionId
  /** The accepted initial prompt's inbox message id. */
  readonly messageId: MessageId
}
```

선택적인 계속 가능 자식 설정 기여는 기본 자식 구성이 완료된 후 Activation이 게시되기 전에 범위 로컬 기능을 설치할 수 있습니다. 레지스트리는 순서가 보장되고 트랜잭션 방식으로 동작합니다. 실패하거나 취소된 설정은 게시되지 않은 Activation을 롤백하고, 자식 범위를 폐기하면 모든 설치가 해제되며, 새 등록은 다음 Activation에 영향을 주고, 등록을 제거하면 상주 중인 모든 설치가 즉시 취소됩니다.

`SubagentRuntime.reportFrom()`는 두 번째 큐나 결과를 포함하는 자식 래퍼를 추가하지 않고 이 확장 지점을 사용합니다. 정확히 현재 활성 상태인 자식 Agent가 호출을 승인하며, 호출자는 수신자를 지정할 수 없습니다. 관리자는 자식의 영속적인 `parentSession`에서 유일한 수신자를 도출하고, 해당 부모 Agent가 활성 상태여야 하며, 선택한 콘텐츠를 하나의 `subagent-report` 사용자 메시지로 구성하고, 메시지의 안정적인 `MessageId`를 반환합니다. 조용한 전달은 `Agent.inject()`를 사용하며 받은 편지함 항목이나 부모 턴을 생성하지 않습니다. 깨우는 전달은 `Agent.followup()`를 사용하며 일반적인 이후 부모 턴 하나를 생성합니다. 어느 모드도 자식의 턴을 종료하지 않으며, 최종 답변이 암묵적으로 보고되지 않습니다.

```ts type-equiv
/** Durable attribution for a continuable child's explicit parent report. */
interface SubagentReportMessageSource {
  readonly kind: 'subagent-report'
  /** A message another agent addressed to this one (`relay` context form). */
  readonly form: 'relay'
  /** Session id of the reporting child. */
  readonly senderSessionId: SessionId
}
```

```ts type-equiv
/** Deployment scheduling policy for accepted child reports. */
type SubagentReportDelivery = 'quiet' | 'wakeup'
```

보고는 자식이 직접 선택하므로, 관리자는 별도로 자신의 기록을 유지합니다. 상주 Activation이 완료되면 해당 에포크가 어떻게 종료되었는지 설명하고 최종 assistant 콘텐츠를 담은 알림 하나를 자식의 영속적인 직접 부모에게 전달합니다. 이 전달은 호출자가 id를 받은 모든 자식에 대해 무조건 수행되며, 부모가 완료된 것으로 판정될 수 있게 하는 소유권 해제보다 먼저 발생하고, 상주 부모에게는 보고와 동일한 깨우기 승인 회계를 통해 도달합니다. 자체 계보가 이미 해체 중인 부모는 대기 상태의 Agent를 깨우면 작업을 큐에 넣는 대신 턴을 시작하므로 깨우지 않고 이를 받습니다. 그 출처는 별도의 종류이므로 트랜스크립트에서 런타임 기록이 자식이 작성한 것처럼 표시되지 않습니다.

```ts type-equiv
/**
 * Durable attribution for the runtime's own account of a continuable child
 * settling. Deliberately a different kind from
 * {@link SubagentReportMessageSource}: a report is content the child chose,
 * while this message is the manager stating what became of the child, and a
 * transcript that merged them would credit the child with words it never wrote.
 */
interface SubagentSettledMessageSource {
  readonly kind: 'subagent-settled'
  /** A runtime account shown without expanding the row (`notice` context form). */
  readonly form: 'notice'
  /** One-line account of how the child ended. */
  readonly summary: string
  /** Session id of the child that settled. */
  readonly senderSessionId: SessionId
}
```

```ts type-equiv
/** Options for one continuable child's report to its direct parent. */
interface SubagentReportOptions {
  /** Already-resolved parent scheduling policy. */
  readonly delivery: SubagentReportDelivery
  /** Caller cancellation, owning authorization and admission until acceptance. */
  readonly signal: AbortSignal
}
```

공급자는 `spawn`와 `fork`가 다른 초기 생성 사양을 준비하는 데에만 참여합니다. 반환되는 사양에는 분리된 공급자별 생성 입력(현재는 선택적 부모 기록 시드)만 포함되며 Agent, `AgentHandle`, 프롬프트 전달, 결과, 폐기 또는 재개 작업은 포함되지 않습니다. 콜드 재개는 공급자를 통해 전혀 디스패치하지 않습니다. 관리자는 일반 디스크립터를 접고, 동일한 활성화 소유자 범위를 통해 `ctx.agents.resume()`를 호출한 다음 대기 중인 턴을 제출합니다.

```ts type-equiv
/**
 * What the continuation manager asks a provider for while materializing one
 * continuable child's FIRST activation. The manager has already reserved the
 * durable child identity and owns every later operation, so this request
 * carries only what distinguishes a fresh child from one seeded with parent
 * history.
 */
interface ContinuableCreateRequest {
  /** The reserved durable child session id, for provider diagnostics. */
  readonly sessionId: SessionId
  /** The delegating parent agent whose history a seeding provider reads. */
  readonly parent: Agent
  /**
   * Caller cancellation, which owns preparation only until the manager accepts
   * the initial prompt into the child's inbox.
   */
  readonly signal: AbortSignal
}
```

```ts type-equiv
/**
 * A provider's detached contribution to one continuable child's creation. This
 * is DATA, never a capability: it carries no Agent, `AgentHandle`, prompt
 * delivery, result, disposal, or resume operation, because the continuation
 * manager owns the child's whole lifecycle after preparation.
 */
interface ContinuableCreateSpec {
  /**
   * Completed-turn prefix of the parent's log to seed the child session with,
   * or absent for a fresh child. Same durable contract as
   * `CreateAgentOptions.seed`: contiguous from seq 0, lossless JSON, balanced.
   */
  readonly seed?: readonly SessionEvent[]
}
```

디스크립터([descriptor.ts](../../packages/subagent/subagent/src/descriptor.ts)의 `SubagentDescriptorData`)는 세션 기반 모든 subagent의 모드로 구분되는 영속적 식별자입니다. 두 모드 모두 공급자 이름을 포함합니다. `one-shot` 디스크립터는 호출자 소유의 표시 `label`를 선택적으로 포함합니다. `continuable` 디스크립터는 위임 `description`를 영속적 생성 레이블로 요구하며, 콜드 재개를 위해 확인된 자식 `agentOptions.provider`/`model` 및 선택적 `persona`/`toolFilter`도 스냅샷으로 저장합니다. 병합 확장이 가능한 `AgentOptions` 객체는 절대 스냅샷으로 저장하지 않으므로 관련 없는 확장 값이 계속을 중단시킬 수 없고, 이후의 구성 입력은 의도적인 버전 변경이 됩니다. `subagentDepth`(콜드 재개는 영속 헤더의 `delegationDepth`를 단조 증가 하한으로 신뢰함)와 `outputSchema`(영속적 식별자가 아닌 단일 실행 또는 Activation의 결과 계약)는 생략합니다.

로컬 일회성 공급자는 첫 요청 전에 자식의 초기 턴 내부에 디스크립터를 추가합니다. 계속 관리자는 공급자가 제공한 모든 계보 뒤와 초기 프롬프트가 승인되기 전에 디스크립터를 추가합니다. `header.seedLength`는 포크 계보 경계로 유지됩니다. 재개 시점의 디스크립터 권한은 자식 자체의 접미사를 읽는 반면, 목록 제공 식별성 프로젝션은 `subagent/descriptor`를 마지막 값 우선으로 접으므로 자식 자체의 디스크립터가 포크로 시드된 조상의 디스크립터를 재정의합니다. 이 이벤트는 로그 전용입니다. `surfaceOp`가 없고, 모델 기록에 포함되지 않으며, 추가 전용 로그에 의해 압축 이후에도 유지됩니다. 현재 버전의 형식이 잘못된 디스크립터는 손상된 것이며, 지원되지 않는 버전은 이 런타임에서 분류할 수 없습니다.

## 영속적 열거: `listChildren()`, `listDescendants()` 및 해당 항목

`SubagentRuntime.listChildren(parentSessionId)`는 `ctx.sessions.list()` 및 선택적 `ctx.sessionPersistence.list()`의 라이브 우선 병합본에서 부모의 직접 세션 기반 하위 에이전트를 열거합니다. 쿼리 서비스는 없으며 어떤 Agent도 로드되거나 재개되지 않습니다. 후보는 영속 헤더에 `origin: 'subagent'`가 있는 직접 자식입니다. 이 마커는 열거와 대략적인 일반 경로 거부를 분류하지만 유효한 기술자, 재개 가능성 또는 권한을 확립할 수는 없습니다. 프로젝션 폴드가 ID를 소유하고 Activation 계약이 재개를 소유합니다. 각 행의 `mode`/`label`는 등록된 `subagent` 프로젝션 단위의 값이며, 세 단계 사다리를 통해 제공됩니다. 즉, 라이브 자식에 대한 레지스트리의 워터마크 캐시(로그 읽기 0회), 콜드 자식에 대한 선택적 프로젝션 체크포인트 캐시(`cachedSnapshot` — 자체 접미사 seq 게이트를 통과한 ID는 최종값입니다. 자체 기술자는 추가된 뒤에는 불변이기 때문입니다), 또는 그 외에는 레지스트리를 통해 폴드된 `persistence.inspect()` 1회 읽기(제한된 동시성, 각 목록 조회마다 재계산)입니다. 캐시는 순수하게 선택적인 가속기입니다. 캐시가 없거나 `null` 센티널을 제공하거나 키가 없거나 seq 게이트를 통과하지 못하거나 오류가 발생하면, 조용히 권위 있는 재폴드로 넘어갑니다. 폴드는 실패 채널이 없는 `subagent/descriptor` 마지막 값 우선 방식입니다. 자식 자체 기술자가 포크 시드된 조상의 기술자를 재정의하며, 잘못되었거나 알 수 없는 버전의 페이로드는 직렬화 가능한 `null` 센티널로 폴드되어 값이 없는 것으로 처리됩니다. 결과는 `createdAt`-그다음-id 순서의 `SubagentListEntry[]` 하나입니다. 제공된 ID는 `mode: 'one-shot' | 'continuable'` 및 `activity: 'running' | 'inactive'`을 포함한 `child` 항목을 생성합니다. 계속 가능한 항목은 항상 `label`를 포함하며, 일회성 항목은 시작 호출자가 표시 메타데이터를 제공한 경우에만 이를 포함합니다. 폴드가 ID를 제공하지 않은 완료된 후보는 `corrupt` 진단을 생성합니다. 누락된, 잘못된, 알 수 없는 버전의 기술자는 의도적으로 구분하지 않습니다(`unsupported`는 타입에 남아 있지만 생성되지는 않습니다). ID가 없는 실행 중 후보는 생략됩니다(기술자가 기록되기 전의 생성 창). 콜드 검사 실패는 다음 목록 조회에서 재시도되는 `unavailable` 진단 하나를 생성하므로 손상된 형제 하나가 정상 자식을 숨길 수 없습니다. `hasChildren`는 동일한 병합 자료에서 읽은 영속 하위 에이전트 출처를 가진 직접 자손을 표시합니다. 활동 스냅샷은 논리 레코드가 `ctx.sessions`에서 라이브 상태인지 여부만 나타내며, 결과나 재개 가능성은 나타내지 않습니다. 영속성이 없으면 열거는 오류가 아니라 라이브 전용이 됩니다. 콜드 자식도 재개할 수 없기 때문입니다. `listChildren()`는 `ctx.sessionProjections` 레지스트리가 없을 때 코드 `SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE`를 포함한 `SubagentError`를, 세션 저장소가 없을 때 `SUBAGENT_CONTROL_SESSION_STORE_UNAVAILABLE`를 발생시킵니다. 둘 다 읽기 전에 검사되므로 자식이 0명인 배포에서도 결정적으로 실패합니다. 목록 도구는 플러그인 로드 시 `ctx.subagents` 및 `ctx.agents`를 요구합니다. UI 같은 서비스 소비자는 두 모드를 모두 표시하고 레이블 없는 일회성 대체 항목을 선택할 수 있습니다. 반면 모델 대상 `list_agents` 어댑터([dsh-tool-subagent-control](../../packages/subagent/tool-subagent-control)의 별도 로드 가능 `/list-agents` 플러그인)는 계속 가능한 항목만 유지하고, 라이브 Agent 레지스트리를 통해 상태를 자체 `running`/`idle`/`ready` 용어로 세분화합니다. 여기서 `ready`는 저장소 전용 자식을 종료됨이 아니라 재개 가능으로 명명합니다. 목록 조회는 계속 관리자 Activation 맵, Agent 레지스트리 또는 제공자 가용성을 참조하지 않습니다. `send_message`는 여전히 권위 있는 전달 시점 작업이며, 목록에 있는 실행 중 계속 가능 자식도 소유권 충돌로 전달을 거부할 수 있습니다. 읽기 경로의 근거는 [list-identity-projection Agent Note](../../.agents/notes/implemented/architecture/2026-08-06-subagent-list-identity-projection.md)에 있습니다.

`SubagentRuntime.listDescendants(rootSessionId)`는 동일한 라이브 우선 코퍼스와 프로젝션 기반 해석을 안정적인 전위 순회의 루트 전체 자손 트리에 적용합니다. 일반 세션과 일회성 자식도 순회 노드로 남으므로 그 아래의 계속 가능한 자손이 발견됩니다. `origin: 'subagent'` 후보만 행을 생성합니다. 반환된 각 자식 또는 진단은 열거된 영속 헤더의 위치를 추가하며, 콜드 검사는 ID를 제공하기 전에 전체 수명 주기를 다시 검증합니다.

```ts type-equiv
/**
 * One entry of a descendant listing: the interpreted subagent facts plus its
 * position in the complete session tree. `parentId` is the durable direct
 * parent from the enumerated header, and `depth` counts edges from the root.
 */
type SubagentDescendantListEntry = SubagentListEntry & {
  /** Durable direct parent of this candidate in the enumerated tree. */
  readonly parentId: SessionId
  /** Edge distance from the requested root; direct children are `1`. */
  readonly depth: number
}
```


## 최종 결과: `SubagentResult`

일회성 실행의 결과이며 `SubagentRun.result`에 의해 결정됩니다. `structured`는 요청한 `outputSchema`가 성공적으로 충족된 후에만 존재합니다. 스키마를 요청한다고 해서 이를 보장하지는 않으며, 자식이 실패하거나 유효한 캡처 없이 완료되면 제공자는 `stopReason: 'error'`를 반환할 수 있습니다. `completed`가 아닌 `stopReason`는 `output`가 부분적일 수 있음을 의미합니다. 소비자는 부분 출력을 성공으로 보고하지 않고 이를 `isError` 도구 결과로 매핑합니다.

```ts type-equiv
/**
 * The terminal outcome of a subagent run, resolved by {@link SubagentRun.result}.
 */
interface SubagentResult {
  /**
   * The child's final assistant output is the content of its last non-empty
   * assistant message. Empty-content messages, including usage-only messages,
   * are skipped. Without a non-empty message, the output is its accumulated
   * assistant text stream, or `[]` when the child produced neither.
   */
  readonly output: ContentBlock[]
  /**
   * The structured result after a requested `outputSchema` was successfully
   * satisfied. Requesting a schema does not guarantee presence: a provider can
   * end with `stopReason: 'error'` when the child fails or finishes without a
   * valid capture. The structured value is validated against the requested
   * output schema by the provider; `unknown` here because the seam is
   * schema-agnostic.
   */
  readonly structured?: unknown
  /** Why the run ended. A non-`completed` reason means `output` may be partial. */
  readonly stopReason: SubagentStopReason
}
```

`SubagentStopReason`는 [병합 확장 가능한 파생 유니온](core.md#the-map--derived-union-pattern)입니다. 백엔드는 변형을 추가할 수 있으므로 소비자는 알려진 경우에 따라 분기하고 알 수 없는 종료 이유는 실패로 처리합니다.

```ts type-equiv
/**
 * Why a subagent run ended. Merge-extensible (a backend may add variants);
 * consumers branch on the known cases and fall through `default`. The known
 * cases mirror the harness turn-end vocabulary so the tool layer can map a
 * non-`completed` result to an `isError` tool result.
 */
interface SubagentStopReasonMap {
  /** The child finished its turn normally. */
  completed: 'completed'
  /** Cancelled through the request signal or disposal. */
  aborted: 'aborted'
  /** Model or transport failure. */
  error: 'error'
  /** The child hit its token ceiling before finishing. */
  'max-tokens': 'max-tokens'
  /** The child declined the task. */
  refusal: 'refusal'
}
```

## 일회성 실행: `SubagentRun`

`SubagentRun`는 게시된 일회성 자식의 소비자 소유 핸들입니다. 하나의 결과를 갖는 일회용 포그라운드 위임이며, 영구적인 자식 핸들이 아닙니다. 게시 이후의 프롬프트 제출, 턴 작업 및 인프라 장애는 `result`에 속합니다. 소비자는 해당 결과를 기다린 다음, 항상 실행을 폐기하여 정지 상태에 도달합니다. 자식 실패는 완료되지 않은 중지 사유로 해결되며, 표현할 수 없는 인프라 장애만 거부됩니다. 실행에는 조작이나 재개가 없습니다. 계속 가능한 대화에는 실행 자체가 없는데, 연속성 관리자가 해당 대화의 `AgentHandle`를 직접 보유하고 모든 턴을 자식 자체의 받은편지함을 통해 정렬하기 때문입니다.

```ts type-equiv
/**
 * ONE-SHOT child handle returned after publication. Prompt submission, turn
 * work, and infrastructure faults after that boundary belong to {@link result}.
 * Consumers await that result and must always {@link dispose} to cancel
 * remaining work and reach quiescence. A run is one disposable foreground
 * delegation with one result; continuable conversations have no run — the
 * continuation manager holds their `AgentHandle` directly and orders every
 * turn through the child's own inbox.
 */
interface SubagentRun {
  /**
   * Parent-scoped run id. For a local run, this MUST equal the published child
   * session id, whose `parentSession` records `request.parent.session.id`; a
   * remote provider mints an id unique in the parent namespace.
   */
  readonly id: SessionId
  /**
   * The exact published in-process child, or `undefined` for a remote run.
   * When present, its id is {@link id}; the provider retains no ownership
   * implication beyond the run's ordinary {@link dispose} contract.
   */
  readonly localAgent: Agent | undefined
  /**
   * Resolves with the child's terminal {@link SubagentResult} when the run
   * settles. Does NOT reject on a child-level failure — a model/transport
   * failure resolves with `stopReason: 'error'` so the consumer maps it to an
   * `isError` tool result. Rejects on an infrastructure fault the seam cannot
   * represent as a stop reason.
   */
  readonly result: Promise<SubagentResult>
  /**
   * Cancel remaining work, reach child quiescence, and release resources.
   * Idempotent.
   */
  dispose(): Promise<void>
}
```

로컬 일회성 실행은 `start()`가 이행되기 전에 일반 자식 에이전트/세션을 게시해야 하며, 해당 자식 세션 ID를 `SubagentRun.id`로 반환하고, 정확한 자식을 `localAgent`로 노출하며, 자식의 `parentSession` 헤더에 `request.parent.session.id`를 기록하고, 첫 번째 요청 전에 자식의 초기 턴 내부에 해결된 설명자를 추가해야 합니다. 런타임 소유권은 자식을 부모, 제공자 또는 루트 범위 아래에 둘 수 있습니다. 원격 제공자는 대신 부모 범위의 수명 주기 ID와 `localAgent: undefined`를 반환하며, 로컬 자식 Session이 없으므로 영구 열거에 포함되지 않습니다.

## 제공자 계약: `SubagentProvider`

각 제공자는 이름이 지정된 자식 에이전트 전송 수단이며, 여러 제공자가 공존할 수 있습니다. 서비스는 `start()` 전에 요청된 시작 시점 기능을 검증하고, `prepareContinuable`가 없는 제공자에서 계속 가능한 시작을 거부합니다. `inheritsParentContext`는 대화 초기화만 설명합니다(`fork`: true, `spawn` 및 `acp`: false). 따라서 소비자는 상속된 도구, 서비스 또는 권한을 암시하지 않으면서 모델에 전달할 정확한 문구를 생성할 수 있습니다.

```ts type-equiv
/**
 * One registered transport for running child agents. Providers are trusted
 * same-process implementations; callers treat descriptors and returned values
 * as borrowed immutable data. The service may call one provider concurrently
 * for distinct children. Providers isolate operation-local mutable state; a
 * shared capacity controller may delay an operation but must not couple its
 * settlement or cleanup to a sibling.
 */
interface SubagentProvider {
  /** Unique registry name (e.g. `spawn`, `fork`, `acp`). */
  readonly name: string
  /** The start-time features this provider supports (see {@link SubagentCapabilities}). */
  readonly capabilities: SubagentCapabilities
  /**
   * Whether the child sees the parent's completed-turn prefix. This is descriptive, not a
   * service-validated start capability: the model-facing tool derives truthful wording from it.
   * It says nothing about tool registration, injected services, or authority inheritance.
   */
  readonly inheritsParentContext: boolean
  /**
   * Establish a ONE-SHOT child and return its handle after publication.
   * The service has already validated that every requested start-time
   * capability is supported and resolved `request.descriptor`, so a
   * session-backed implementation appends that descriptor inside the child's
   * initial turn. Before fulfillment, the provider owns setup and cleans any
   * unpublished partial resources before rejecting. Ownership transfers on
   * fulfillment; subsequent turn or infrastructure failure settles through
   * the returned run. Distinct starts may overlap; cancellation, failure,
   * result settlement, and disposal remain independent for each run.
   */
  start(request: ResolvedSubagentStartRequest): Promise<SubagentRun>
  /**
   * OPTIONAL (continuable-creation capability): contribute the detached
   * creation inputs that distinguish this provider's continuable children —
   * only whether the child session is seeded with parent history. Method
   * presence IS the capability: the service rejects continuable starts on
   * providers without it, while a provider that has it may still serve
   * ordinary one-shot delegations.
   *
   * This is the provider's ONLY participation in a continuable child. The
   * continuation manager owns identity reservation, composition, Agent
   * creation, prompt delivery, cold resume, ownership, and disposal, so a
   * provider never sees the child's Agent, handle, turns, or teardown.
   * Distinct preparations may overlap; each follows its own signal and returns
   * data belonging only to `request.sessionId`.
   */
  prepareContinuable?(request: ContinuableCreateRequest): Promise<ContinuableCreateSpec>
}
```

제공자 `start()`는 게시된 실행으로 이행됩니다. 서비스는 고유한 `runId`를 생성하고, 제공자의 정확한 `localAgent`에서 `local`를 스냅샷하며, 결과를 관찰하고, `subagent/start`를 내보낸 뒤, 동일한 실행을 반환합니다. `start()` 거부는 게시되지 않은 리소스의 정리를 의미하고 수명 주기 쌍을 내보내지 않지만, 게시 후 결과 거부는 내보낸 쌍을 닫습니다. 계속 가능한 각 Activation은 상주 기간에 대해 동일한 관찰 전용 쌍을 내보내므로, 콜드 재개는 자체 `runId`를 가진 새로운 기간입니다. 쌍을 이루는 `subagent/end`는 동일한 ID와 최종 출력 또는 인프라 실패를 전달합니다. 두 이벤트는 모두 관찰 전용이며 리스너 예외를 포함합니다. 해당 이벤트의 `provider` 필드는 실행 또는 Activation 기간을 시작한 제공자의 이름을 나타내며, 에지가 내보내질 때도 그 제공자가 등록되어 있음을 주장하지는 않습니다.

## 프로세스 내 백엔드: 깊이와 초기값

spawn 및 fork 백엔드는 `parent.ctx`를 통해 일반 일회성 에이전트를 생성하고, 취소를 핵심 생성 과정에 전달하며, `AgentHandle`를 통해 폐기합니다. 계속 가능한 자식은 대신 연속성 관리자가 자체 활성화 소유자 범위를 통해 생성합니다. 제공자를 제거하면 새 시작은 차단되지만 승인된 실행은 취소되지 않습니다. 각 자식에는 부모 등록을 상속하는 대신 새로운 평면 범위가 부여됩니다. 깊이와 fork 초기값은 기존 에이전트 및 세션 용어를 재사용합니다:

- **위임 깊이** 는 지속되는 `SessionHeader.delegationDepth` 및 병합 확장 가능한 런타임 필드 `AgentOptions.subagentDepth`입니다. 둘 다 없으면 최상위 깊이는 0을 의미하며, 존재하는 값 중 더 큰 값이 권한을 갖습니다. 추상 경계가 두 필드를 모두 소유합니다. 루프는 이를 설정하거나 읽지 않습니다. 따라서 프로세스 내 자식은 부모 깊이 + 1을 지속하고, 콜드 재개로 이를 낮출 수 없으며, 모든 시작은 파생된 깊이가 안전한 정수 범위를 벗어나거나 정의된 절대 `request.maxDepth` 상한을 초과하면 거부합니다.
- **Fork 시딩** 은 [`CreateAgentOptions.seed`](core.md#creation-and-ownership)를 사용합니다(`SessionEvent[]` 접두사가 `AgentLoop.createAgent` → `ctx.sessions.prepare({ seed })`를 통해 전달되며, 이는 `ctx.agents.resume()`가 사용하는 것과 같은 기본 요소입니다). fork 백엔드는 부모 로그의 *균형이 맞는 완료된 턴 접두사* , 즉 마지막 `turn/end`를 포함한 부모 이벤트까지를 전달합니다. 따라서 시드는 0부터 연속적이며 [불변 조건](../../packages/runtime-diagnostics/invariants) 재생이 이를 수용합니다(진행 중인 균형이 맞지 않는 턴은 제외됩니다).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

소스에서 `scripts/gen-cordis-catalog.ts`로 생성되었습니다(doc-sync에서 `pnpm run verify-cordis-catalog`로 최신 상태를 확인하며, `pnpm run gen-cordis-catalog`로 다시 생성합니다). 이 섹션은 페이지의 두 언어 버전에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하며 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에서 정의되며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxsubagents--subagentruntime"></a>

### `ctx.subagents` — `SubagentRuntime`

일회성 실행, 지속 가능한 검색 및 계속 가능한 자식 작업을 갖춘 이름 지정 공급자 레지스트리.

```ts cordis-catalog
/**
 * Establish one durable continuable child and deliver its initial prompt.
 * Resolves when the child's inbox accepts that prompt, without waiting for the
 * turn to start or for the message to reach the Session log; any earlier
 * failure rejects with no ids and rolls back the child entirely.
 * @param spec - provider, delegation request, and caller cancellation.
 * @returns the durable child id and the accepted prompt's message id.
 * @throws when continuation services are unavailable or materialization fails.
 */
async startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>

/**
 * Deliver one later message to a continuable child as its next FIFO turn. A
 * resident child's Agent inbox accepts it directly (waking a `waiting`
 * Activation), while an absent one is cold-resumed from its persisted
 * Session. The Agent inbox is the only queue, so every accepted message has
 * one observable order.
 * @param parent - the exact live direct parent authorizing this delivery.
 * @param childId - durable child session id.
 * @param content - user-role content to deliver.
 * @param options - the message source fields and caller cancellation, which stops the
 *   operation only before inbox acceptance.
 * @returns the accepted message's inbox id.
 * @throws when continuation services are unavailable, parent authority is
 *   rejected, or the message was not admitted.
 */
async followup( parent: Agent, childId: SessionId, content: ContentBlock[], options: SubagentFollowupOptions, ): Promise<MessageId>

/**
 * Interrupt one live continuable child's current turn under a human parent
 * address or an exact live ancestor Agent. Fire-and-return: the cancel
 * signal is issued before this returns, but the target may keep running
 * until it observes the signal. Unclaimed pending inbox work, the Activation,
 * and published descendants are preserved; claimed work is not requeued.
 * Once the interrupted driver is idle, a waking send resumes the parked FIFO
 * queue. An absent target — including a one-shot or unknown id —
 * is an accepted no-op, as is a manager-less composition, which cannot own a
 * live Activation.
 * @param targetSessionId - the durable child session id to interrupt.
 * @param authority - the human parent address or exact live ancestor Agent.
 * @throws {SubagentError} `UNAUTHORIZED` when the authority does not own the
 *   live target.
 */
interrupt(targetSessionId: SessionId, authority: SubagentInterruptAuthority): void

/**
 * Deliver selected content from one live continuable child to its durable
 * direct parent. The child is the authority credential; callers cannot name a
 * recipient. Reporting does not conclude the child's turn or Activation.
 * @param child - exact live reporting child.
 * @param content - selected model-facing content.
 * @param options - parent scheduling and pre-acceptance cancellation.
 * @returns the stable identity of the parent-accepted message.
 * @throws when continuation services are unavailable, sender authorization
 *   fails, or the direct parent is not live.
 */
async reportFrom( child: Agent, content: ContentBlock[], options: SubagentReportOptions, ): Promise<MessageId>

/**
 * Compose one deployment capability into every continuable child's
 * unpublished creation context on fresh creation and cold resume. Grants wait
 * for the next Activation; removing the contribution revokes every resident
 * installation immediately.
 * @param contribution - synchronous child-scope installer.
 * @returns the exact Cordis effect disposer.
 */
registerContinuableSetup(contribution: ContinuableSetupContribution): () => void

/**
 * Close continuable admission below exact live parent Agents, stop only their
 * visible descendant Activations synchronously, then await admitted scoped
 * materializations and release those forests child-first. The scoped cutoff
 * lasts until each exact parent leaves the registry; unrelated parent trees
 * remain live.
 * @param parents - exact host-owned parent Agents entering teardown.
 * @returns once every retained descendant Activation released its `AgentHandle`.
 * @throws an aggregate error after all branches settle when any failed.
 */
async drainContinuableDescendants(parents: readonly Agent[]): Promise<void>

/**
 * Enumerate the parent's direct session-backed subagents without loading or
 * resuming an Agent and without any query service: the listing merges the live
 * session store with optional session persistence (live-preferred) and
 * serves each child's durable mode/label from the registered `subagent`
 * projection unit down a three-rung ladder — the registry's watermark
 * snapshot for a live child; for a cold one, a durable projection-cache
 * row when the optional cache serves an own-suffix identity (its `seq`
 * gate proves the value postdates the fork seed, where a child's own
 * descriptor is immutable once appended), else one persistence inspection
 * folded through the registry. The
 * projection fold is the single classification authority; per-child
 * diagnostics relay a fold that served no identity or a failed inspection,
 * never a list-time descriptor parse. Absent persistence, enumeration is
 * live-only (a cold child cannot be resumed then either, so its absence is
 * capability absence, not an error). This service consults no Agent
 * registrations, Activations, or providers.
 *
 * Every persistence read receives `signal`, and the listing rechecks
 * cancellation around each of those awaits. Read rejections that settle
 * after an abort become a stable `SubagentError` with code `CANCELLED`.
 * @param parentSessionId - parent session whose direct children are listed.
 * @param signal - caller-owned cancellation forwarded to persistence reads
 *   and observed around every read await.
 * @returns children and per-child diagnostics ordered by `createdAt`, then id.
 * @throws {@link SubagentError} when the projection registry or the session
 *   store is not mounted, or the caller cancels the listing.
 */
listChildren(parentSessionId: SessionId, signal?: AbortSignal): Promise<SubagentListEntry[]>

/**
 * Enumerate the root's complete session-backed subagent tree in stable
 * pre-order from one live-preferred corpus, without loading or resuming an
 * Agent. Ordinary sessions and one-shot children remain traversal nodes so
 * continuable descendants below them are discovered; each returned entry
 * adds its durable `parentId` and root-relative `depth`. Identity resolution,
 * diagnostics, optional persistence, and cancellation follow the same
 * projection-backed contract as {@link listChildren}.
 * @param rootSessionId - session whose complete descendant tree is listed.
 * @param signal - caller-owned cancellation forwarded to persistence reads
 *   and observed around every read await.
 * @returns children and per-candidate diagnostics with tree position, in
 *   stable pre-order.
 * @throws {@link SubagentError} under the same conditions as {@link listChildren}.
 */
listDescendants(rootSessionId: SessionId, signal?: AbortSignal): Promise<SubagentDescendantListEntry[]>

/**
 * Register a provider under its name. Registration is effect-scoped and HMR
 * safe; removing a provider blocks new starts but does not revoke runs that
 * were already returned to their holders.
 * @param provider - the trusted provider implementation.
 * @returns the exact Cordis effect disposer.
 */
registerProvider(provider: SubagentProvider): () => void

/**
 * Look up a provider by name.
 * @param name - the provider name.
 * @returns the provider, or undefined when absent.
 */
getProvider(name: string): SubagentProvider | undefined

/**
 * List registered provider names in insertion order.
 * @returns the registered names.
 */
list(): string[]

/**
 * Establish a published child on the named provider. Capability and semantic
 * checks run before delegation. Provider ownership lasts until its promise
 * fulfills; a rejection therefore has no run for the caller to dispose and
 * emits no run lifecycle events. Post-publication turn and infrastructure
 * failures settle through the returned run.
 * @param name - the provider to use.
 * @param request - child label, prompt, parent, signal, and optional capabilities.
 * @returns the published holder-owned run.
 */
async start(name: string, request: SubagentStartRequest): Promise<SubagentRun>
```

유형: [Agent](core.md) · [ContentBlock](llm-streaming.md) · [MessageId](llm-streaming.md) · [SessionId](core.md)

소스: [`packages/subagent/subagent/src/index.ts:171`](../../packages/subagent/subagent/src/index.ts)

<a id="subagent-events"></a>

### `subagent/*` 이벤트

<a id="subagentend--emit"></a>

#### `subagent/end` — 발생

게시된 자식이 안정 상태에 도달했습니다. 범위 필터링 디스패치는 `subagent/start`와 동일한 위임 부모 캐리어를 사용하므로, 수명 주기 쌍이 동일한 범위 대상에게 도달합니다.

```ts cordis-catalog
/**
 * A published child settled. Scope-filtered dispatch uses the same delegating
 * parent carrier as `subagent/start`, so the lifecycle pair reaches the
 * same scoped audience.
 * @param info - the run identity and terminal outcome.
 * @dshScopeScan unsupported
 * @mode emit
 */
'subagent/end'(this: Scoped<SubagentRuntime>, info: SubagentRunEndInfo): void
```

유형: [Scoped](scope.md)

소스: [`packages/subagent/subagent/src/index.ts:166`](../../packages/subagent/subagent/src/index.ts)

<a id="subagentprovider-added--emit"></a>

#### `subagent/provider-added` — 발생

공급자가 레지스트리에서 확인 가능해졌습니다.

```ts cordis-catalog
/**
 * A provider became resolvable in the registry.
 * @param provider - the registered provider.
 * @mode emit
 */
'subagent/provider-added'(provider: SubagentProvider): void
```

소스: [`packages/subagent/subagent/src/index.ts:140`](../../packages/subagent/subagent/src/index.ts)

<a id="subagentprovider-removed--emit"></a>

#### `subagent/provider-removed` — 발생

공급자가 레지스트리를 떠났습니다. 수락된 실행은 계속 보유자가 소유합니다.

```ts cordis-catalog
/**
 * A provider left the registry. Accepted runs remain holder-owned.
 * @param name - the provider name that no longer resolves.
 * @mode emit
 */
'subagent/provider-removed'(name: string): void
```

소스: [`packages/subagent/subagent/src/index.ts:146`](../../packages/subagent/subagent/src/index.ts)

<a id="subagentstart--emit"></a>

#### `subagent/start` — 발생

공급자가 게시된 자식을 설정했습니다. 프로세스 내 공급자의 경우 이 알림 중에 `ctx.agents.get(info.id)`가 확인됩니다. 범위 필터링 디스패치는 위임 부모를 기준으로 캐리어에 키를 지정하므로, 부모 범위 리스너는 자신이 위임한 항목만 관찰합니다. `subagent/end`와 쌍을 이룹니다.

```ts cordis-catalog
/**
 * A provider established a published child. For in-process providers,
 * `ctx.agents.get(info.id)` resolves during this notification.
 * Scope-filtered dispatch keys the carrier by the delegating parent, so a
 * parent-scoped listener observes only its own delegations. Paired with
 * `subagent/end`.
 * @param info - the provider and published child identity.
 * @dshScopeScan unsupported
 * @mode emit
 */
'subagent/start'(this: Scoped<SubagentRuntime>, info: SubagentRunInfo): void
```

유형: [Scoped](scope.md)

소스: [`packages/subagent/subagent/src/index.ts:157`](../../packages/subagent/subagent/src/index.ts)
<!-- END GENERATED cordis-surface -->
