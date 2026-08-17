# 계획 모드

계획 모드는 [dsh-plan-mode](../../packages/plan/plan-mode) (`ctx.planMode`, `PlanModeController`)가 소유하는 에이전트별 협업 상태로 기록됩니다. 활성 상태에서는 배포가 소유하는 안내 섹션이 각 모델 요청에 포함됩니다. 계획 모드는 **완화된 안내**입니다. [샌드박스 모드](sandbox.md)와 [승인 정책](approval.md)은 독립적으로 제한을 적용합니다. 어느 쪽도 계획 상태를 읽거나 쓰지 않으므로 배포에서 별도로 구성합니다. 패키지는 선택 사항이며 에이전트 루프는 이에 의존하지 않습니다. 이 패키지는 `plan:policy` 프롬프트 섹션을 제공하고 `exit_plan_mode` 도구 및 `/plan` 명령을 등록합니다. 근거는 [설계 노트](../../.agents/notes/implemented/simplification/2026-07-22-plan-specific-collaboration-state.md)에서, 모델 경험 및 제한 사항의 세부 내용은 [패키지 README](../../packages/plan/plan-mode/README.md)에서 다룹니다.

출처: [`packages/plan/plan-mode/src/index.ts`](../../packages/plan/plan-mode/src/index.ts)

## 기록된 상태 및 복구

`plan/mode` (`{ active: boolean }`)는 로그 전용이며 전체 값을 교체하는 [세션 이벤트](session.md)입니다. 이는 내구성을 가지며 재생할 수 있지만 모델 트랜스크립트에는 포함되지 않습니다. `foldPlanMode(events, end?)`는 접두사의 마지막 기록 값을 반환하고, 값이 없으면 `false`를 반환합니다. 적용되는 상태는 항상 세션 로그의 순수 폴드이므로 라이브 미러 없이 재개, 포크 및 컴팩션으로 복구되며 UI는 `session/event`를 통해 커밋된 전환을 관찰합니다. 전체 이벤트 선언은 [영속성 로그 이벤트 카탈로그](../persistence-catalog.md)에 있습니다.

## 대기 중인 선택과 사전 단계 추가

모든 세션 이벤트는 턴으로 둘러싸이므로 사용자 선택은 다음 허용된 턴 내 사전 단계가 요청 파생 전에 이를 추가할 때까지 대기 상태로 남습니다. 이는 어느 턴에서 발생하든 동일합니다. 선택이 계속을 강제하지는 않으므로, 턴의 마지막 허용된 사전 단계 이후에 이루어진 선택은 이후 턴에 추가됩니다. `set(agent, active)`는 대기 중인 선택을 기록합니다(대상이 기록된 상태 또는 이미 대기 중인 상태와 같으면 아무 작업도 하지 않음). `get(agent)`는 `{ active: boolean; pending?: boolean }`를 반환합니다. 즉, 현재 단계를 구성하는 데 사용된 기록 상태와 추가를 기다리는 선택 상태입니다.

에이전트가 실행 중일 때 유일한 추가 지점은 앞에 삽입된 `agent/pre-step` 리스너입니다. 이 리스너는 턴 1의 단계 1과 요청 복구 재시도를 포함한 모든 제안된 요청 단계를 관찰하고, 먼저 하위 리스너를 호출한 뒤 이들이 단계를 허용한 경우에만 추가합니다. 프롬프트 허용은 턴 전에 발생하므로 `plan/mode`를 추가할 수 없습니다. 따라서 프롬프트에서 이루어진 선택은 해당 프롬프트가 시작한 턴의 첫 번째 허용된 턴 내 사전 단계에서 추가됩니다. 추가 실패는 턴을 차단할 수 없으며 선택은 이후의 허용된 턴 내 사전 단계를 위해 대기 상태로 유지됩니다. 추가된 사용자 선택은 플러그인 소스의 `user/message` 알림 하나도 기록하지만, 마지막으로 기록된 요청 헤더가 다른 상태를 설명한 경우에만 기록됩니다. 따라서 모델에는 컨텍스트가 변경된 시점만 정확히 알려지며 중복해서 알려지지 않습니다. 턴의 마지막 허용된 사전 단계 이후에 이루어진 선택은 프로세스 로컬에 남으며, 다른 허용된 턴 내 사전 단계 전에 프로세스가 종료되면 손실됩니다([README 제한 사항](../../packages/plan/plan-mode/README.md#known-limitations-and-deferred-work)).

## 구성

```ts type-equiv
/** Deployment-owned plan guidance. */
interface PlanModeConfig {
  /** Guidance rendered as the `plan:policy` prompt section while plan mode is active. */
  section: string
}
```

누락되었거나 비어 있거나 문자열이 아닌 `section` 및 알 수 없는 모든 키는 무시되지 않고 플러그인 로드 시 실패합니다. 계획 모드가 활성화되어 있는 동안 정확한 `section` 텍스트는 순서 50에서 `plan:policy` [시스템 프롬프트 섹션](system-prompt.md)으로 렌더링됩니다. 비활성 계획 모드는 텍스트를 제공하지 않습니다.

## 종료 도구 및 `/plan` 명령

[`exit_plan_mode`](../tool-catalog.md#deepseek-aidsh-plan-mode)는 계획 모드가 비활성일 때도 등록된 상태로 유지됩니다. 따라서 계획 모드에 진입하거나 종료해도 프롬프트 섹션만 변경되며 요청 도구 카탈로그는 변경되지 않습니다. 계획 모드 밖에서의 실행은 실패합니다. 계획 모드에서는 `#` 제목으로 시작하는 완전한 Markdown 계획이 필요하며, [사용자 질문 추상 심](user-questions.md)을 통해 검토용으로 제시합니다. 승인이 이루어지면 `{ approved: true }`를 반환하고, 다음 허용된 턴 내 사전 단계에서 추가되는 무음(내레이션되지 않는) 대기 종료를 기록합니다. 그러므로 계획 안내는 어시스턴트의 현재 도구 배치의 나머지 동안 활성 상태로 유지되며, 도구 결과 자체가 전환을 보고합니다. 계속 계획하기는 사용자의 피드백을 포함하는 실패한 호출이므로 모델은 수정 후 다시 제시합니다. 상호작용 채널이 없거나 검토 중 서비스가 다시 로드되는 경우에도 계획 모드를 조용히 유지하는 대신 호출이 실패합니다.

[`ctx.commands`](commands.md)가 구성되면 플러그인은 `/plan [off|message]`를 등록합니다. 인수 없는 `/plan`는 계획 모드를 선택하고, 비어 있지 않은 다른 메시지는 이를 선택한 다음 `agent.steer()`를 통해 텍스트를 제출하여 계획 안내 아래 다음 단계의 일반적인 기록 사용자 메시지가 되게 합니다. 정확한 인수 `off`는 비활성 상태를 선택하며, 이 선택은 추가되어 요청에 표시되기 전에 대기 중인 진입도 취소합니다.

## 서비스

`ctx.planMode`는 기록된 계획 상태를 소유하고 단계 시작 시 선택된 상태를 적용 및 설명하며, `plan:policy` 섹션, `/plan` 명령 및 안정적인 종료 도구를 소유합니다. `get`/`set` 시그니처는 생성된 [서비스 카탈로그](#ctxplanmode--planmodecontroller)에 있습니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`로 소스에서 생성되었습니다(문서 동기화에서 `pnpm run verify-cordis-catalog`로 최신 상태를 확인하며, `pnpm run gen-cordis-catalog`로 다시 생성). 이 섹션은 페이지의 두 언어 측면에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [개요](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxplanmode--planmodecontroller"></a>

### `ctx.planMode` — `PlanModeController`

`ctx.planMode`: 기록된 계획 상태, 단계 시작 시 선택된 상태의 적용 및 설명, `plan:policy` 섹션, `/plan` 명령 및 안정적인 종료 도구를 소유합니다. UI는 `session/event`를 통해 커밋된 전환을 관찰하며 라이브 미러는 없습니다.

```ts cordis-catalog
/**
 * Read the logged plan state and any selected state awaiting the next
 * accepted in-turn pre-step.
 *
 * @param agent The agent to read.
 * @returns Current logged state plus a pending selection, when present.
 */
get(agent: Agent): { active: boolean; pending?: boolean }

/**
 * Select whether plan mode should be active. Between turns the method
 * appends the change immediately because no in-turn pre-step will run until
 * another prompt starts a turn. The open-turn fold is the idle signal:
 * agent status stays `running` through post-turn checkpointing, when no
 * further in-turn pre-step runs. During an open turn the selection remains
 * pending until the next accepted in-turn pre-step. Repeated selection of
 * the current or already-pending state is a no-op.
 *
 * @param agent The agent to switch.
 * @param active Whether plan mode should be active.
 * @returns what happened: `committed` (logged now), `queued` (awaiting the
 * next accepted in-turn pre-step), `cancelled` (an opposite pending selection
 * was cleared; the logged state already matches), or `noop` (already in that
 * state).
 */
set(agent: Agent, active: boolean): 'committed' | 'queued' | 'cancelled' | 'noop'
```

유형: [Agent](core.md)

출처: [`packages/plan/plan-mode/src/index.ts:184`](../../packages/plan/plan-mode/src/index.ts)
<!-- END GENERATED cordis-surface -->
