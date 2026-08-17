# 워크플로

워크플로 심을 사용하면 에이전트가 하위 에이전트를 시작하는 모델 작성 오케스트레이션 SCRIPT를 실행할 수 있습니다. [하위 에이전트](subagent.md)와 마찬가지로 이는 **선택적 기능 하나**이며 에이전트 루프의 일부가 아니므로, 해당 타입과 작업은 [core.md](core.md)가 아니라 여기에 있습니다. bash와 마찬가지로 컨텍스트당 하나의 엔진 구현만 `ctx.workflowEngine`을 제공할 수 있으며, 이름이 지정된 제공자 레지스트리는 없습니다(두 번째 엔진은 함께 실행되는 대신 플러그인 설정을 통해 첫 번째 엔진을 대체합니다).

서비스 정의: [dsh-workflow](../../packages/workflow/workflow)(`ctx.workflowEngine` 및 아래의 어휘)입니다. 서비스 제공자는 [dsh-workflow-worker-thread](../../packages/workflow/workflow-worker-thread)(`node:worker_threads` 엔진 — 실행마다 하나의 워커, 그 안에 스크립트의 vm 컨텍스트)이고, 모델이 사용하는 소비자는 [dsh-tool-workflow](../../packages/workflow/tool-workflow)입니다. 제안 및 근거는 [dynamic-workflows Agent Note](../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md)를 참조하세요.

소스: 브라우저 안전 어휘는 [`packages/workflow/workflow/src/types.ts`](../../packages/workflow/workflow/src/types.ts)에, Host 요청 및 라이브 실행 핸들은 [`runtime-types.ts`](../../packages/workflow/workflow/src/runtime-types.ts)에 있습니다.

## 시작 요청

실행을 시작할 때 호출자가 요청하는 항목입니다. 일반 워크플로 도구는 모델의 `{ script, meta, args }` 호출과 호출 에이전트에서 이를 구성합니다. 특수 소비자는 실행을 위해 엔진 전체에 하나인 `subagentProvider` 및 더 낮은 `maxTotalAgents`을 선택할 수도 있지만, 스크립트는 어느 정책도 관찰하거나 대체할 수 없습니다. `meta` 및 `args`은 일반 JSON DATA입니다(엔진은 실행 전에 `meta`을 스키마와 대조해 검증하고, 실패 시 명확하게 거부합니다. 이를 얻기 위해 어떤 스크립트 텍스트도 평가되지 않습니다). `parent`은 필수입니다. 스크립트가 시작하는 모든 자식은 여기에 귀속되며, cwd, 계보 및 깊이는 [하위 에이전트 심](subagent.md)을 통해 전달됩니다.

```ts type-equiv
/**
 * What a caller asks for when starting a workflow run. `meta` and `args` are
 * plain JSON data by the seam contract. `parent` is required because every
 * `agent()` spawned by the script is attributed to that live Agent.
 */
interface WorkflowStartRequest {
  /** The plain-JS script body (top-level await allowed; ends with `return <json-value>`). */
  script: string
  /** The workflow's identity block, as plain JSON data (shape-validated by the engine). */
  meta: WorkflowMeta
  /** Optional input exposed verbatim to the script as the `args` global. */
  args?: unknown
  /** Optional engine-wide child-provider override for this run. */
  subagentProvider?: string
  /** Optional per-run total-child ceiling. */
  maxTotalAgents?: number
  /** The agent on whose behalf the run executes (parent of every child). */
  parent: Agent
  /** Cancels the run when aborted. */
  signal?: AbortSignal
}
```

## 워크플로의 ID: `WorkflowMeta`

시작 요청에서 데이터로 전달되는 ID 블록입니다(도구의 `meta` 매개변수이며, 필드 어휘는 Claude Code dynamic-workflows 메타 블록과 일치합니다). `phases`은 진행 상황 어휘일 뿐입니다. `phase()` 호출은 관찰자를 위해 제목과 일치하며, 실행 구조를 암시하지 않습니다.

```ts type-equiv
/**
 * The script's identity block, provided as plain JSON data alongside the
 * script body (the model-facing tool carries it as its `meta` parameter) and
 * validated by the engine before the body runs. `name`/`description` are
 * required; the rest is optional annotation. The field vocabulary matches the
 * Claude Code dynamic-workflows meta block.
 */
interface WorkflowMeta {
  /** Short kebab-case workflow name (display + persistence key). */
  name: string
  /** One-line description of what the workflow does. */
  description: string
  /** Optional guidance on when this workflow applies (shown in listings). */
  whenToUse?: string
  /** Optional phase declarations matched by `phase()` calls. */
  phases?: WorkflowPhase[]
}
```

## 종료 결과: `WorkflowResult`

한 번의 실행 결과이며 `WorkflowRun.result`에 의해 해결됩니다. `value`은 스크립트의 구체화된 반환값, 즉 일반 Host 영역 JSON 데이터입니다(스크립트가 아무것도 반환하지 않은 경우 `null`). 이는 `completed`에만 의미가 있습니다. `stopReason`은 폐쇄형 유니온입니다(엔진 소유이며 소비자가 모두 처리할 수 있습니다): `completed` | `cancelled` | `error`. `completed`이 아닌 이유는 `error`에 실패 정보를 포함하며, 소비자는 부분 출력을 성공으로 보고하는 대신 이를 `isError` 도구 결과로 매핑합니다.

```ts type-equiv
/**
 * The outcome resolved by a live workflow run. `value` is
 * the script's materialized return value (plain host-realm JSON data; `null`
 * when the script returned `undefined`) — meaningful only for `completed`.
 * A non-`completed` reason carries the failure in `error`; the consumer maps
 * it to an `isError` tool result rather than reporting partial output.
 */
interface WorkflowResult {
  /** The script's return value (host JSON data; `null` for no return). */
  value: unknown
  /** Why the run settled. */
  stopReason: WorkflowStopReason
  /** The failure message (present iff `stopReason` is not `completed`). */
  error?: string
  /**
   * How many `agent()` calls the run accepted over its whole lifetime. On a
   * graceful settlement this is the script-side count (calls still queued for
   * a concurrency slot included); on a termination path (grace force-settle,
   * worker death) it degrades to the host-observed count — calls queued
   * inside a terminated script are unknowable then.
   */
  agentsStarted: number
}
```

## 라이브 실행: `WorkflowRun`

스크립트가 실행되는 동안 소비자가 보유하는 핸들입니다. 소비자는 `result`을 기다리고, 실행 중간에 `cancel`할 수 있으며, 모든 경로에서 반드시 `dispose`해야 합니다. `result`은 거부되지 않습니다. 스크립트 실패는 `stopReason: 'error'`으로 해결됩니다. 또한 스크립트 자체가 절대 해결되지 않더라도 실행이 취소되면 엔진의 제한된 유예 시간 안에 완료됩니다(엔진은 `cancelled`을 강제로 완료하고, 워커 스레드 엔진은 스크립트 워커를 종료합니다). 따라서 `result`을 기다리는 소비자는 취소 이후 절대 멈춘 상태로 남지 않습니다. `dispose()` = 취소 + 제한된 완료 + 자식 안정화이며, 멈춘 스크립트 때문에 절대 대기하지 않습니다.

```ts type-equiv
/**
 * Holder-owned live workflow. `result` never rejects; consumers may cancel
 * and must call idempotent `dispose()` to await script and child quiescence.
 */
interface WorkflowRun {
  readonly id: WorkflowRunId
  /** The validated meta block available before the script body runs. */
  readonly meta: WorkflowMeta
  readonly result: Promise<WorkflowResult>
  /** Cancel the run and its children. */
  cancel(reason?: string): void
  /** Cancel if needed and await bounded settlement and cleanup. */
  dispose(): Promise<void>
}
```

## 실패 규율: `WorkflowError.fatal`

스크립트 내부의 훅 오용, 즉 잘못된 인수, 알 수 없거나 지연된 `agent()` 옵션, [구조화된 출력 하위 집합](../../packages/core/tools/README.md) 밖의 스키마, 한도 초과, 심 시작 실패 또는 취소는 `fatal: true`이 포함된 `WorkflowError`을 발생시킵니다. `parallel()`/`pipeline()` 컴비네이터는 항목을 `null`으로 매핑하는 대신 치명적 오류를 다시 발생시킵니다. 오타가 있는 옵션은 일반적인 자식 실패처럼 보이는 것으로 녹아들지 않고 반드시 스크립트를 명확하게 종료해야 합니다. 항목별 `null`은 자식 실행 실패(`completed`이 아닌 중지 이유) 및 스테이지 내 일반 스크립트 오류에만 사용됩니다.

## 이벤트

`workflow/*` 이벤트(`workflow/start`, `workflow/phase`, `workflow/log`, `workflow/agent-start`, `workflow/agent-end`, `workflow/end` — [이벤트 카탈로그](#cordis-surface) 참조)는 DATA SNAPSHOTS를 전달하는 **관찰 전용**  emit입니다. 모든 페이로드는 라이브 `WorkflowRun`가 아닌 `WorkflowRunInfo`(id + meta)로 시작하므로 구독자는 `cancel`/`dispose`를 획득할 수 없습니다. 또한 `workflow/end`는 의도적으로 결과 값을 생략합니다(결과를 관찰하는 리스너는 호출자의 결과에 대한 변경 가능한 별칭을 받아서는 안 됩니다). 각 emit은 리스너별로 격리됩니다. 예외를 던지는 구독자는 기록되지만 전파되지 않으며, 그 뒤에 등록된 리스너를 굶기지 못합니다. 또한 모든 리스너는 자체 페이로드 복제본을 받으므로 이를 변경해도 엔진이나 다른 리스너가 손상되지 않습니다. 이 격리는 `subagent/start`/`subagent/end`를 반영합니다.

## 영속적인 Chat 레코드

최상위 `dsh-tool-workflow` 소비자는 실행 소유권을 변경하지 않고 표시 정보를 호출한 상위 Session에 투영합니다. 실행이 수락된 후 `tool-workflow/run-start`를 기록하고, `runId + seq`로 멤버의 시작과 끝을 연결하며, 결과를 알게 되고 dispose가 안정 상태에 도달한 후에만 `tool-workflow/run-end`를 기록합니다. 중첩 전송 호출은 레코드를 기록하지 않습니다. 첫 번째 append 실패가 발생하면 해당 실행의 이후 기록이 비활성화되므로 로그는 비어 있거나 유효한 연속 접두사로 유지되며 도구 결과는 변경되지 않습니다.

`dsh-tool-workflow/invariant`는 라이브 커밋 전과 Session을 로드할 때 동일한 프로토콜을 검증합니다. 즉, 실행당 하나의 시작, 양수이며 고유한 멤버 시퀀스, 쌍을 이루는 멤버 종료, 멤버가 열린 상태에서 실행이 끝나지 않음, 실행 종료 이후 업데이트 없음입니다. 로그 끝의 멤버 종료 또는 실행 종료 누락은 손상이 아니라 유효한 중단 증거입니다.

`dsh-client-ui-workflow-run`는 원래 워크플로 도구 노드 뒤에서 실행 시작 시퀀스에 고정된 하나의 `workflow-run` Chat 노드로, Conversation Node 엔진을 통해 네 이벤트를 접습니다. 단계 그룹은 실제 멤버 시작에서만 생성되며 생략된 단계와 `''`의 차이를 포함해 정확한 문자열을 보존합니다. 닫힌 Location은 누락된 최종 정보를 중단된 표시 상태로 전환합니다. [UI 패키지 README](../../packages/client/ui-workflow-run/README.md)가 공개, 상태 및 동일 상위 항목 내 로컬 탐색 동작을 담당합니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`에서 소스를 기반으로 생성되었습니다(doc-sync에서 `pnpm run verify-cordis-catalog`로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`로 다시 생성). 이 섹션은 페이지의 두 언어 버전에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [개요](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxworkflowengine--workflowengine-abstract-seam"></a>

### `ctx.workflowEngine` — `WorkflowEngine` (추상 접합부)

워크플로 서비스 정의 계약입니다. 잘못된 요청은 게시 전에 예외를 발생시킵니다. 라이브 실행은 보유자가 소유하고, 그 결과는 거부되지 않으며, 취소와 dispose는 제한되고, dispose는 그 제한 내에서 하위 항목 정리를 기다립니다. 수명 주기 리스너 실패는 격리되며, 결과가 확정될 때 `workflow/end`가 정확히 한 번 발생합니다.

```ts cordis-catalog
/**
 * Parse and execute a workflow script.
 * @param request - the script, its `args`, the parent agent, and an
 *   optional cancel signal.
 * @returns the live run; its `result` resolves when the script settles.
 */
abstract start(request: WorkflowStartRequest): WorkflowRun
```

출처: [`packages/workflow/workflow/src/index.ts:157`](../../packages/workflow/workflow/src/index.ts)

<a id="workflow-events"></a>

### `workflow/*` 이벤트

<a id="workflowagent-end--emit"></a>

#### `workflow/agent-end` — emit

하나의 `agent()` 호출이 확정되었습니다(정상 결과, 하위 항목 실패 또는 실행 취소). `agent.seq`로 Events['workflow/agent-start']와 쌍을 이루며, 모든 중지 경로에서 시작된 호출마다 정확히 한 번 발생합니다. 엔진 종료 경로(유예 기간 이후 종료된 worker)에서는 결과가 `'cancelled'`인 종료 이벤트를 엔진이 생성합니다.

```ts cordis-catalog
/**
 * One `agent()` call settled (clean result, child failure, or run
 * cancellation). Paired with {@link Events['workflow/agent-start']} by
 * `agent.seq`, exactly once per started call on every stop path — on an
 * engine termination path (a worker killed past its grace) the end is
 * engine-synthesized with outcome `'cancelled'`.
 * @param info - the run's identity snapshot.
 * @param agent - the call identity plus its outcome.
 * @mode emit
 */
'workflow/agent-end'(info: WorkflowRunInfo, agent: WorkflowAgentEndInfo): void
```

출처: [`packages/workflow/workflow/src/index.ts:79`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowagent-start--emit"></a>

#### `workflow/agent-start` — emit

하나의 `agent()` 호출이 게시된 하위 실행을 설정했습니다. `agent.seq`로 Events['workflow/agent-end']와 쌍을 이룹니다. 공급자로부터 게시된 실행을 받지 못한 호출은 이 쌍의 어느 이벤트도 emit하지 않습니다.

```ts cordis-catalog
/**
 * One `agent()` call established a published child run. Paired with
 * {@link Events['workflow/agent-end']} by `agent.seq`. A call that never
 * receives a published run from the provider emits neither
 * event in this pair.
 * @param info - the run's identity snapshot.
 * @param agent - the call's sequence number, label, phase, and child id.
 * @mode emit
 */
'workflow/agent-start'(info: WorkflowRunInfo, agent: WorkflowAgentInfo): void
```

출처: [`packages/workflow/workflow/src/index.ts:68`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowend--emit"></a>

#### `workflow/end` — emit

워크플로 실행이 확정되었습니다(모든 중지 사유). WorkflowRun.result가 resolve될 때 발생합니다. Events['workflow/start']와 쌍을 이룹니다.

```ts cordis-catalog
/**
 * A workflow run settled (any stop reason). Fired when
 * {@link WorkflowRun.result} resolves. Paired with
 * {@link Events['workflow/start']}.
 * @param info - the run's identity snapshot.
 * @param result - the outcome data (stop reason, error, agent count) —
 *   deliberately WITHOUT the result value (see {@link WorkflowResultInfo}).
 * @mode emit
 */
'workflow/end'(info: WorkflowRunInfo, result: WorkflowResultInfo): void
```

출처: [`packages/workflow/workflow/src/index.ts:89`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowlog--emit"></a>

#### `workflow/log` — emit

스크립트가 내레이션 줄(`log(message)` 호출)을 emit했습니다.

```ts cordis-catalog
/**
 * The script emitted a narration line (a `log(message)` call).
 * @param info - the run's identity snapshot.
 * @param message - the logged message, verbatim.
 * @mode emit
 */
'workflow/log'(info: WorkflowRunInfo, message: string): void
```

출처: [`packages/workflow/workflow/src/index.ts:58`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowphase--emit"></a>

#### `workflow/phase` — emit

스크립트가 단계(`phase(title)` 호출)에 진입했습니다. 관찰자를 위한 진행 상황 그룹화이며 실행 의미론은 없습니다.

```ts cordis-catalog
/**
 * The script entered a phase (a `phase(title)` call) — progress grouping
 * for observers; no execution semantics.
 * @param info - the run's identity snapshot.
 * @param title - the phase title, verbatim.
 * @mode emit
 */
'workflow/phase'(info: WorkflowRunInfo, title: string): void
```

출처: [`packages/workflow/workflow/src/index.ts:51`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowstart--emit"></a>

#### `workflow/start` — emit

워크플로 실행이 시작되었습니다. 스크립트의 meta 블록이 검증되었으며 본문이 곧 실행됩니다. Events['workflow/end']와 쌍을 이룹니다.

```ts cordis-catalog
/**
 * A workflow run started — the script's meta block validated, the body
 * about to execute. Paired with {@link Events['workflow/end']}.
 * @param info - the run's identity snapshot (id + meta).
 * @mode emit
 */
'workflow/start'(info: WorkflowRunInfo): void
```

출처: [`packages/workflow/workflow/src/index.ts:43`](../../packages/workflow/workflow/src/index.ts)
<!-- END GENERATED cordis-surface -->
