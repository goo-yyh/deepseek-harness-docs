# 동일 세션 목표

이벤트 소싱 목표 서비스와 해당 정책 소비자가 공유하는 타입입니다. [goal-domain Agent Note](../../.agents/notes/implemented/feature/2026-07-19-persisted-same-session-goal-domain.md)가 영속성 및 활성화 결정을 소유하며, 이 페이지는 [`packages/goal/goal/src/types.ts`](../../packages/goal/goal/src/types.ts)의 정확한 필드와 변형을 기록합니다.

## 식별자와 수명 주기

`GoalId`는 [브랜드 ID](core.md#branded-ids)입니다. 호출자는 `GoalRef`를 통해 하나의 정확한 리비전을 변경하며, 허용된 모든 영속적 변경은 리비전을 증가시킵니다.

```ts type-equiv
/** Compare-and-set identity for one exact goal revision. */
interface GoalRef {
  /** Stable goal identity. */
  readonly id: GoalId
  /** Positive revision; every durable mutation increments it. */
  readonly revision: number
}
```

영속적 단계는 목표에 어떤 일이 발생했는지 나타냅니다. 프로세스 로컬 활성화는 계속 소비자가 다른 라운드를 시작할 수 있는지를 별도로 나타냅니다.

```ts type-equiv
/** Durable continuation phase. Activation is process-local and separate. */
type GoalPhase =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'complete'
```

차단은 문제로 인해 중지된 유일한 영속적 상태입니다. 정책이 소유하는 그 사유는 라우팅을 위한 안정적인 lower-kebab-case 코드와 사람 및 모델을 위한 자유 형식 설명을 포함합니다.

```ts type-equiv
/** Machine-routable and human-readable explanation for a blocked goal. */
interface GoalBlockReason {
  /** Stable lower-kebab-case classification chosen by the blocking policy. */
  readonly code: string
  /** Non-empty explanation shown to humans and models. */
  readonly message: string
}
```

```ts type-equiv
/** Full durable state written by every non-clear goal mutation. */
interface GoalSnapshot extends GoalRef {
  /** Human-requested completion objective. */
  readonly objective: string
  /** Durable lifecycle phase. */
  readonly phase: GoalPhase
  /** Present exactly while `phase` is `blocked`. */
  readonly blockedReason?: GoalBlockReason
  /** Total admitted goal-round cap. */
  readonly maxGoalRounds: number
}
```

```ts type-equiv
/** Current goal projection, including values derived from the session log. */
interface GoalView extends GoalSnapshot {
  /** Highest admitted round number for this goal. */
  readonly roundsStarted: number
  /** Epoch milliseconds of the create mutation. */
  readonly createdAt: number
  /** Epoch milliseconds of the latest mutation. */
  readonly updatedAt: number
  /** Process-local continuation eligibility; never persisted. */
  readonly activation: GoalActivation
}
```

## 영속적 변경

모든 변경은 페이로드가 변경 후의 완전한 스냅샷 또는 명확한 툼스톤인 영속적 `goal/change` 세션 이벤트입니다. 엄격한 fold와 영속된 프로젝션은 이러한 이벤트에서만 수명 주기 상태를 도출하며, inbox 변경은 목표 상태에 영향을 주지 않습니다.

```ts type-equiv
/** Full-snapshot goal mutation committed by a durable `goal/change` event. */
interface GoalSnapshotChangeMeta {
  readonly kind: 'goal/change'
  readonly version: 1
  readonly operation: Exclude<GoalOperation, 'clear'>
  readonly goal: GoalSnapshot
  readonly roundsStarted: number
  readonly createdAt: number
  readonly updatedAt: number
}
```

```ts type-equiv
/** Tombstone retained when the current goal is cleared. */
interface GoalClearChangeMeta {
  readonly kind: 'goal/change'
  readonly version: 1
  readonly operation: 'clear'
  readonly cleared: GoalRef
  readonly clearedAt: number
}
```

계속 소비자는 허용된 각 사용자 메시지 턴에 양의 순차적 라운드 번호와 현재 리비전을 부여하며, 허용된 이 `user/message` 이벤트만 `roundsStarted`를 진행시킵니다. 재생은 양수가 아닌 라운드, 간격, 오래된 리비전, 중지된 단계 및 한도 초과를 거부합니다.

```ts type-equiv
/** Message attribution for admitted continuation rounds. */
interface GoalMessageSource {
  readonly kind: 'goal'
  readonly goalId: GoalId
  readonly revision: number
  /** Positive admitted continuation round. */
  readonly round: number
}
```

## 요청 및 알림

생성은 호출자의 생략과 배포 선택을 분리하며, `create()`가 이를 내부적으로 해결합니다. 편집은 런타임 검증기가 하나 이상의 필드를 요구하는 부분 교체입니다. 모든 변경 알림은 허용된 작업과 정확한 리비전을 포함하며, clear는 `goal`를 생략합니다.

```ts type-equiv
/** Input whose omitted round cap is resolved by the service configuration. */
interface CreateGoalRequest {
  readonly objective: string
  readonly maxGoalRounds?: number
}
```

```ts type-equiv
/** Fields changed by an edit; at least one must be present. */
interface EditGoalRequest {
  readonly objective?: string
  readonly maxGoalRounds?: number
}
```

```ts type-equiv
/** Live notification after one durable goal mutation commits. */
interface GoalChanged {
  readonly operation: GoalOperation
  readonly ref: GoalRef
  /** Absent for a clear tombstone. */
  readonly goal?: GoalView
}
```

## 서비스 동작

[`GoalService`](../../packages/goal/goal/src/index.ts)는 생성 기본값을 해결하고, 영속적 `goal/change` 이벤트에서 엄격한 재생을 fold하며, 정확한 라이브 에이전트 식별자와 compare-and-set 변경을 적용하고, 포함된 `goal/changed` 알림을 내보냅니다. 패키지 [README](../../packages/goal/goal/README.md)는 호출 가능한 API와 모델에 표시되는 계약을 정의합니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`에서 소스로부터 생성됩니다(doc-sync에서 `pnpm run verify-cordis-catalog`로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`로 다시 생성). 이 섹션은 페이지의 두 언어 측면에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxgoals--goalservice"></a>

### `ctx.goals` — `GoalService`

소유 세션 로그만으로 지원되는 목표 서비스(`ctx.goals`)입니다.

```ts cordis-catalog
/**
 * Read the current goal for one exact live agent.
 * @param agent - owning live agent.
 * @returns a fresh view or `undefined` when no goal is current.
 * @throws {@link GoalError} when the agent is not the registry's live instance.
 */
get(agent: Agent): GoalView | undefined

/**
 * Remove process-local continuation authority without changing durable goal
 * phase or revision. Lifecycle owners use this before unloading a driver;
 * a later human-authorized {@link resume} records the new activation edge.
 * @param agent - owning live agent.
 * @returns a fresh disarmed view, or `undefined` when no goal is current.
 */
disarm(agent: Agent): GoalView | undefined

/**
 * Create and arm a goal. A completed goal may be replaced; every other
 * current phase must be cleared or resumed instead.
 * @param agent - owning live agent.
 * @param request - objective and optional round cap.
 * @returns the created live view.
 */
create(agent: Agent, request: CreateGoalRequest): GoalView

/**
 * Edit objective and/or round cap without changing phase.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @param request - at least one replacement field.
 * @returns the edited view.
 */
@Remote('edit') edit(agent: Agent, ref: GoalRef, request: EditGoalRequest): GoalView

/**
 * Pause an active goal and disarm automatic continuation.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @returns the paused view.
 */
@Remote('pause') pause(agent: Agent, ref: GoalRef): GoalView

/**
 * Resume and arm a stopped goal, or rearm an active goal after a
 * session-start edge, while its round budget still has capacity.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @returns the active view.
 */
@Remote('resume') resume(agent: Agent, ref: GoalRef): GoalView

/**
 * Mark a current non-complete goal complete and disarm it.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @returns the completed view.
 */
@Remote('complete') complete(agent: Agent, ref: GoalRef): GoalView

/**
 * Mark an active goal blocked and disarm it.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @param reason - policy-owned stable code and human-readable explanation.
 * @returns the blocked view with its durable reason.
 */
block(agent: Agent, ref: GoalRef, reason: GoalBlockReason): GoalView

/**
 * Clear the current goal while retaining a durable tombstone and history.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @returns the tombstone ref whose revision is one past the cleared snapshot.
 */
@Remote('clear') clear(agent: Agent, ref: GoalRef): GoalRef

/**
 * Create one Goal through the remote boundary.
 * @param agent - exact live Agent resolved from the wire identity.
 * @param request - objective and optional round cap.
 * @returns the created Goal identity.
 */
@Remote('create') remoteExportCreate(agent: Agent, request: CreateGoalRequest): CreateGoalResult
```

유형: [Agent](core.md)

출처: [`packages/goal/goal/src/index.ts:183`](../../packages/goal/goal/src/index.ts)

<a id="goal-events"></a>

### `goal/*` 이벤트

<a id="goalchanged--emit"></a>

#### `goal/changed` — 발생

활성 상태의 agent 하나가 Goal 변경을 수락했습니다. 일치하는 `goal/change` 세션 이벤트는 이미 커밋되었습니다. 리스너 실패는 격리됩니다. 범위 필터링 디스패치(`@deepseek-ai/dsh-scope`)에서는 agent 범위 리스너가 해당 agent만 수신합니다.

```ts cordis-catalog
/**
 * Goal mutation accepted by one live agent. The matching `goal/change`
 * session event has already committed. Listener failures are contained.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @param payload.agent - agent whose session owns the goal.
 * @param payload.change - fresh current projection or clear tombstone.
 * @mode emit
 */
'goal/changed'(this: import('@deepseek-ai/dsh-scope').Scoped<Agent>, payload: { agent: Agent; change: GoalChanged }): void
```

유형: [Agent](core.md) · [Scoped](scope.md)

출처: [`packages/goal/goal/src/domain.ts:114`](../../packages/goal/goal/src/domain.ts)
<!-- END GENERATED cordis-surface -->
