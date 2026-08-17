# 사용자 승인

[dsh-user-approval](../../packages/interaction/user-approval)의 사용자 승인 추상 경계는 한 가지 질문에 답합니다. 이 특정 작업을 진행해도 될까요? 이 경계는 공유 요청/결과 어휘, `ctx.approval` 디스패치 서비스, `approval/request` 응답자 폭포식 체인, 로그 전용 감사 쌍, 세션별 `ask`/`never` 정책을 소유합니다. UI 채널은 사람 응답자를 제공할 수 있으며, [ACP 자동화 브리지](../../packages/acp/acp)는 자체 에이전트를 위한 일회성 기계 결정을 제공합니다. [dsh-tools](../../packages/core/tools) 및 [dsh-tool-bash](../../packages/shell/tool-bash) 같은 호출자는 종료된 결과를 사용하며, 결과가 `allowed-once`가 아니면 실패 시 차단합니다.

출처: [`packages/interaction/user-approval/src/index.ts`](../../packages/interaction/user-approval/src/index.ts)

## 식별자와 결과

모든 요청에는 새로운 `ApprovalRequestId`가 부여됩니다. 브랜드는 승인 id를 도구 호출 또는 에이전트/세션 id와 상호 교환 가능하게 만들지 않으면서 `approval/asked` 및 `approval/decided` 감사 이벤트를 연결합니다.

```ts type-equiv
/**
 * Pairs one `approval/asked` audit event with its `approval/decided`.
 * Service-issued (one fresh id per {@link ApprovalService.request} call).
 */
type ApprovalRequestId = Branded<'ApprovalRequestId'>
```

`ApprovalOutcome`는 종료되어 있으며 실패 시 차단합니다. `allowed-once`는 질문한 작업에만 권한을 부여합니다. 호출자는 `rejected`, `cancelled` 및 `unavailable`에서 거부합니다. 누락되었거나, 소유하지 않거나, 예외를 발생시키거나, 규격을 따르지 않는 응답자는 게이트를 열지 않고 `unavailable`가 됩니다.

```ts type-equiv
/**
 * Closed approval outcomes: a one-shot grant, explicit rejection, withdrawn
 * request, or unavailable answerer. Callers fail closed on `unavailable`.
 */
type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
```

## 세션별 정책

`ApprovalPolicy`는 대화형 응답자가 실행되기 전에 수행할 작업을 결정합니다. `ask`는 구성된 응답자 체인에 위임하며, 이 체인에서 응답이 없을 때의 기본값은 `unavailable`입니다. `never`는 어떠한 응답자도 디스패치하지 않고 결정적으로 `rejected`를 반환합니다. 유효 값은 세션 로그의 마지막 `approval/policy` 이벤트이며, 서비스 구성으로 대체됩니다. `setApprovalPolicy(session, policy)`는 유일한 쓰기 경로이므로 재생 시 재정의를 복원합니다.

```ts type-equiv
/**
 * A session's approval policy — what happens to an {@link ApprovalService}
 * ask BEFORE any interactive answerer sees it:
 *
 * - `'ask'` (the default) — delegate to the composed answerers; with none
 *   composed the chain falls through to the fail-closed `'unavailable'`.
 * - `'never'` — never prompt anyone: every ask resolves `'rejected'`
 *   deterministically. The strict headless stance (CI, unattended runs) and
 *   the policy whose outcome is knowable without asking.
 */
type ApprovalPolicy = 'ask' | 'never'
```

두 정책은 모두 캐시 안전 런타임 컨텍스트 스냅샷에 현재의 완전한 의미를 반영합니다. 출처가 있는 `user/message`는 내구성 있는 모델 표시 입력입니다. 승인 상태가 변경되면 요청 헤더의 시스템 프롬프트를 다시 작성하지 않고 보존된 이력 뒤에 새로운 전체 스냅샷을 추가합니다.

## 승인 요청

`ApprovalRequest`는 질문을 라우팅하고 감사하기에 충분할 정도로 에이전트와 도구 작업을 식별합니다. 의도적으로 도구 인수는 제외합니다. 응답자는 드리프트할 수 있는 두 번째 복사본을 렌더링하는 대신 `callId`를 통해 프롬프트를 이미 스트리밍된 도구 호출에 연결합니다.

```ts type-equiv
/**
 * Readonly same-process permission question. `callId` links to an already
 * presented tool call, so arguments are not duplicated here.
 */
interface ApprovalRequest {
  /**
   * The agent on whose behalf the question is asked. Routes the question (a
   * UI answerer only answers for agents it owns) and receives the audit
   * events on its session log.
   */
  readonly agent: Agent
  /** The tool the question is about (presentation and audit). */
  readonly toolName: string
  /**
   * The exact tool call being decided, when the asker has one — lets a UI
   * attach the prompt to the tool call it already streamed.
   */
  readonly callId?: CallId
  /** The asker's human-readable explanation of WHY it is asking. */
  readonly reason?: string
  /**
   * Aborting withdraws the question: the request settles `'cancelled'`
   * immediately and a late answer from a still-pending answerer is discarded.
   */
  readonly signal?: AbortSignal
}
```

## 디스패치 및 감사

`ctx.approval.request(req)`는 요청 세션이 열린 턴 안에 있어야 합니다. `approval/asked`를 추가하고, 하나의 결과를 얻은 뒤, 일치하는 `approval/decided`를 추가하고 해당 결과로 해결합니다. `never` 정책은 폭포식 디스패치 전에 서비스 내부에서 적용되므로, 나중에 `prepend`로 등록된 응답자도 이를 우회할 수 없습니다. 응답자는 요청을 소유한 경우 결과를 반환하거나 `next()`를 호출하여 위임합니다. 첫 번째 응답이 단일 결정 슬롯을 차지합니다.

감사 이벤트는 로그 전용이며 모델 트랜스크립트에 포함되지 않습니다. 모델에 표시되는 동작은 호출자가 파생한 도구 결과와 현재 런타임 컨텍스트 스냅샷입니다. 서비스가 폐기되면 해당 컨텍스트 기여분이 제거됩니다. 응답자 리스너는 소유 플러그인에 독립적으로 effect-bound됩니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

이 섹션은 `scripts/gen-cordis-catalog.ts`로 소스에서 생성됩니다(문서 동기화에서 `pnpm run verify-cordis-catalog`로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`로 다시 생성합니다). 이 섹션은 페이지의 두 언어 측면에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxapproval--approvalservice"></a>

### `ctx.approval` — `ApprovalService`

응답자보다 먼저 세션 정책을 적용하고 모든 질문/결과 쌍을 요청 세션에 기록하는 승인 서비스입니다. 런타임 컨텍스트 스냅샷과 전환 알림을 통해 결정적인 정책 변경 사항을 모델에 노출합니다.

```ts cordis-catalog
/**
 * Switch one live agent's policy and queue the transition for its next model
 * step. Session initialization uses {@link setApprovalPolicy} directly
 * because there is no previously visible policy to change.
 * @param agent - the live agent whose policy is changing.
 * @param policy - the new effective policy.
 */
setPolicy(agent: Agent, policy: ApprovalPolicy): void

/**
 * Ask the composed answerers to decide one readonly same-process request.
 * The service borrows the request, agent, session, and live signal directly.
 * The request requires an open turn because the audit pair must be enclosed
 * by the durable log's commit/replay boundary; an idle ask rejects before
 * appending anything. The answerer phase always produces an outcome: an
 * aborted signal yields `'cancelled'`, a missing or throwing answerer yields
 * `'unavailable'` (fail closed), and a rogue non-vocabulary return value is
 * normalized to `'unavailable'`. A failure that prevents either audit append
 * from committing still rejects because returning an unlogged decision would
 * violate the pair. Session contains post-commit observer failures, so an
 * authoritative append cannot reject the request or suppress its matching
 * audit event.
 * @param req - the pending decision (agent, tool identity, reason, signal).
 * @returns the closed outcome; `'allowed-once'` is the only grant.
 * @throws when no turn is open or either audit event fails before the session
 *   append commit point.
 */
async request(req: ApprovalRequest): Promise<ApprovalOutcome>

/**
 * Read the session override without applying the configured default.
 * @param session - session whose log supplies the override.
 * @returns the last logged policy, or `undefined` without one.
 */
overrideOf(session: Session): ApprovalPolicy | undefined
```

유형: [Agent](core.md) · [Session](session.md)

소스: [`packages/interaction/user-approval/src/index.ts:192`](../../packages/interaction/user-approval/src/index.ts)

<a id="approval-events"></a>

### `approval/*` 이벤트

<a id="approvalrequest--waterfall"></a>

#### `approval/request` — 폭포식

구성된 응답자에게 하나의 결정을 요청합니다. 요청을 점유하려면 결과를 반환하거나 `next()`을 호출합니다. 실패하면 실패 시 닫히는 기본값이 적용됩니다. 범위로 필터링된 디스패치(`@deepseek-ai/dsh-scope`)에서는 agent 범위 리스너가 해당 agent만 수신합니다.

```ts cordis-catalog
/**
 * Ask composed answerers for one decision. Return an outcome to claim the
 * request or call `next()`; failure yields the fail-closed default.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @param req - the pending decision (agent, tool identity, reason, signal).
 * @mode waterfall
 */
'approval/request'(this: Scoped<ApprovalService>, req: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>
```

유형: [Scoped](scope.md)

소스: [`packages/interaction/user-approval/src/index.ts:30`](../../packages/interaction/user-approval/src/index.ts)
<!-- END GENERATED cordis-surface -->
