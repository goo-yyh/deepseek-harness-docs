# 백그라운드 작업 런타임

장기 실행 프로듀서, `ctx.jobs` 및 작업 제어에서 공유하는 타입입니다. 설계는 [런타임 Agent Note](../../.agents/notes/implemented/architecture/2026-06-20-generic-long-running-tool-runtime.md)가 담당하며, 이 페이지에는 [`packages/jobs/jobs/src/types.ts`](../../packages/jobs/jobs/src/types.ts)의 정확한 필드와 변형을 기록합니다.

## ID와 상태

`JobId`는 [브랜드 ID](core.md#branded-ids)이며, `<kind>-N`로 생성됩니다. 접근 제어는 ID의 비밀성이 아니라 소유자 권한 부여에 의존합니다. `JobKind`는 병합 확장 가능한 맵에서 파생되며, 레지스트리는 종류를 불투명한 ID 네임스페이스로 취급합니다.

```ts type-equiv
/**
 * Producer-defined job kinds. Plugins extend this map by declaration merging;
 * the registry treats every value as an opaque id namespace.
 */
interface JobKindMap {
  bash: 'bash'
  subagent: 'subagent'
}
```

`JobStatus`는 `'running' | 'stopping' | 'completed' | 'killed' | 'failed'`이며, 프로듀서별 사실은 `JobSnapshot.detail`에 속합니다.

## 프로듀서 계약

`JobStart`는 ID와 시작기를 선언합니다. 런타임은 `run()`를 호출하기 전에 사전 점검을 완료하고, 이후 실패할 수 있는 단계 없이 커밋합니다. 프로듀서는 실행 리소스를 소유하고, 런타임은 ID, 접근 및 수명 주기 상태를 소유합니다.

```ts type-equiv
/**
 * Producer declaration passed to {@link JobRegistry.start}. The runtime
 * preflights access and cleanup before invoking {@link run}; the producer owns
 * execution resources while the runtime owns identity and lifecycle state.
 */
interface JobStart {
  /** Producer kind — also the id prefix (`bash`, `subagent`, …). */
  kind: JobKind
  /** One-line model-facing label (the command; the delegation description). */
  label: string
  /**
   * Optional UTF-8 byte cap for each complete model-facing completion notice or
   * output read, including controller status metadata.
   */
  outputLimitBytes?: number
  /**
   * Owning live agent. Access is fenced by its session id, and agent disposal
   * cancels and awaits the job. The instance must be the one currently
   * registered under its agent id. Omitting the owner creates an unowned job,
   * open to any caller until service disposal.
   */
  owner?: Agent
  /**
   * Start the work after preflight and synchronously return its hooks. Called
   * once; a throw leaves nothing registered, and the producer must clean up any
   * partially started resources.
   */
  run(): JobHooks
}
```

`JobHooks.done`는 작업이 단순히 완료될 때가 아니라 프로듀서가 리소스를 해제한 후에 해결됩니다. 선택 사항인 `readOutput`는 스트림을 소비하는 작업과 최종 출력만 제공하는 작업을 구분합니다.

```ts type-equiv
/** Hooks through which the runtime controls and observes producer work. */
interface JobHooks {
  /**
   * Request termination. Must be synchronous, idempotent, and eventually settle
   * {@link done}; throws propagate. The optional reason is forwarded verbatim.
   */
  cancel(reason?: string): void
  /**
   * Resolves after the producer releases its resources, not merely when work
   * finishes. Must not reject; the runtime converts a rejection to `failed`.
   * If teardown cancellation throws, the runtime may force-fail only the
   * registry record without claiming that the work stopped.
   */
  done: Promise<JobOutcome>
  /**
   * Consume output produced since the previous call. The producer formats
   * truncation and spill notices. Absence marks a final-output-only job; each
   * job has one consuming cursor.
   */
  readOutput?(): string
}
```

```ts type-equiv
/** Terminal result supplied by a producer through {@link JobHooks.done}. */
interface JobOutcome {
  /** How the job ended: finished (`completed`), cancelled (`killed`), or broke (`failed`). */
  status: 'completed' | 'killed' | 'failed'
  /** Kind-specific detail rendered into status lines ('exit code: 3', 'max-tokens'). */
  detail?: string
  /** Final output for jobs without `readOutput`; stream jobs leave it unset. */
  output?: string
}
```

## 소비자 뷰

스냅샷은 최신 읽기 전용 프로젝션입니다. `ownerSession`에는 권한 부여에 사용하는 공유 `SessionId`가 포함되며, 완료 리스너는 수명 주기 정리에 사용된 정확한 소유자 객체를 별도로 받습니다. `reported`는 다른 보고자가 종료 상태를 이미 전달했거나 전달하기로 커밋한 후(소유자나 서비스를 비우는 해제 취소를 포함)에 완료 알림을 억제합니다.

```ts type-equiv
/**
 * A read-only projection of one job, safe to hand to listeners and tools —
 * a fresh object per call, never live registry state.
 */
interface JobSnapshot {
  /** The registry-issued id (`<kind>-N`). */
  id: JobId
  /** The producer kind the job was registered with. */
  kind: JobKind
  /** The producer-supplied one-line label. */
  label: string
  /** Producer-owned cap for complete model-facing notices and output reads. */
  outputLimitBytes?: number
  /**
   * Owner session id used for authorization and correlation; absent for
   * unowned jobs. Completion listeners receive the exact {@link Agent}
   * separately through {@link JobDoneListener}.
   */
  ownerSession?: SessionId
  /** Current lifecycle state. */
  status: JobStatus
  /** Kind-specific status detail, present once the producer supplied one (usually terminal). */
  detail?: string
  /** Epoch ms when the job was registered. */
  startedAt: number
  /** Epoch ms when the job settled; absent while `running`/`stopping`. */
  finishedAt?: number
  /**
   * True when a kill, read, wait, or teardown cancel has reported or committed
   * to report the terminal state. Completion reporters suppress redundant
   * notices when set. Teardown claims it because the owner or service being
   * destroyed leaves no reader: a reporter that opens a turn on notice would
   * otherwise spend a model request per teardown layer.
   */
  reported: boolean
}
```

```ts type-equiv
/** Output and post-read state returned by {@link JobRegistry.read}. */
interface JobRead {
  /**
   * Stream kinds: the consuming delta since the previous read. Final-output
   * kinds: empty while live, the terminal {@link JobOutcome.output} (or
   * empty) once settled — idempotent, never consumed.
   */
  text: string
  /** The job's state at read time. */
  snapshot: JobSnapshot
}
```

## 서비스 동작

추상 [`JobRegistry`](../../packages/jobs/jobs/src/index.ts) 서비스 정의는 원자적 `start`, 호출자 범위의 `get` 및 `list`, `read`, `kill`, 제한된 `wait`, 실패 격리된 `onJobDone` 및 `onJobsChanged` 리스너, 그리고 `attachController`를 사용할 수 있게 되는 시점을 명시합니다. [`LocalJobRegistry`](../../packages/jobs/jobs-local/src/index.ts)는 프로세스 로컬 서비스 제공자입니다. 권한 부여는 소유자 세션을 비교하며, 소유자 정리와 승인에는 정확히 등록된 `Agent` 인스턴스를 사용합니다. 로컬 제공자의 양의 안전 정수 `maxConcurrentJobsPerOwner` 설정은 기본값으로 `10`를 사용하고, 정확한 소유자별 `running` 및 `stopping` 레코드를 계산하며, 소유되지 않은 작업에는 하나의 공유 버킷을 사용합니다. 종료된 프로듀서 정산은 용량을 해제합니다. 서비스 정의 계약은 [`dsh-jobs`](../../packages/jobs/jobs/README.md), 레지스트리 수명 주기와 승인 정책은 [`dsh-jobs-local`](../../packages/jobs/jobs-local/README.md), 모델 지향 소비자는 [`dsh-tool-jobs`](../../packages/jobs/tool-jobs/README.md)를 참조하세요.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`로 소스에서 생성되었습니다(문서 동기화에서 `pnpm run verify-cordis-catalog`로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`로 다시 생성합니다). 이 섹션은 페이지의 두 언어 버전에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxjobs--jobregistry-abstract-seam"></a>

### `ctx.jobs` — `JobRegistry` (추상 이음새)

추상 백그라운드 작업 레지스트리입니다. 하위 클래스를 만들고, 추상 메서드를 구현한 다음, 하위 클래스를 플러그인으로 로드하면 `ctx.jobs`로 등록됩니다(컨텍스트당 하나의 구현만 허용되며, 두 번째 구현을 로드하면 cordis의 표준 중복 서비스 동작에 따라 예외가 발생합니다).

구현은 다음 의미 체계를 준수해야 합니다.

- 등록은 생산자 및 컨트롤러 fiber보다 오래 유지됩니다. 소유자와 서비스가 폐기되면 진행 중인 작업을 취소하고 규정을 준수하는 생산자를 기다립니다. 정리 단계의 취소가 예외를 발생시키면 해당 레코드만 강제로 실패 처리합니다. 또한 소유자가 삭제되어 더 이상 읽는 사람이 없는 레코드이므로, 정리 단계에서 취소되면 레코드가 보고된 것으로 표시됩니다.
- 소유 작업에 대한 액세스는 소유자의 세션 ID로 제한됩니다. ID는 예측 가능하므로 비밀성이 아니라 권한 부여가 경계입니다.
- 정산은 선착순으로 처리됩니다. 늦게 도착한 생산자 결과가 있더라도 하나의 종료 레코드, 해제된 대기자, 그리고 포함된 리스너 알림 한 라운드만 존재합니다. 보고자가 동기적으로 모델 턴을 열 수 있으므로, 레코드가 커밋되고 정산을 관찰하는 다른 모든 관찰자가 이를 확인한 뒤 마지막으로 완료를 알립니다.
- 연결된 작업 컨트롤러가 명세의 소유자를 제공하지 않는 동안에는 start가 작업을 거부합니다. 따라서 생산자는 해당 소유자가 수집하거나 중지할 수 없는 작업을 시작할 수 없습니다. 하나의 레지스트리가 프로세스의 모든 구성을 제공하므로, 이 질문과 완료 리스너 전달은 프로세스 전체가 아닌 소유자 기준입니다. 범위가 지정되지 않은 컨텍스트에서 이루어진 등록은 모든 소유자를 제공하며, 에이전트 구성의 범위에서 이루어진 등록은 그 아래에 구성된 에이전트만 정확히 제공합니다.

```ts cordis-catalog
/**
 * Preflight access, validation, owner cleanup, and implementation-owned
 * admission before starting and atomically registering work. Any preflight
 * rejection leaves no job id or execution resource. A throwing starter
 * leaves nothing registered; after it returns, registration cannot fail.
 * Settlement records the outcome, notifies listeners, and releases waiters.
 * @param spec - job identity, owner, and synchronous starter.
 * @returns the registry-issued `<kind>-N` id.
 */
abstract start(spec: JobStart): JobId

/**
 * List caller-owned and unowned jobs in registration order without exposing
 * another session's labels.
 * @param caller - reading agent; a non-agent caller sees only unowned jobs.
 * @returns fresh snapshots.
 */
abstract list(caller?: Agent): JobSnapshot[]

/**
 * Return a non-consuming snapshot without changing its read cursor or notice
 * state. Throws for an unknown or foreign job.
 * @param id - job to look up.
 * @param caller - reading agent checked against the owner.
 * @returns a fresh snapshot.
 */
abstract get(id: JobId, caller?: Agent): JobSnapshot

/**
 * Read the next stream delta, or the idempotent final output after settlement.
 * A terminal read marks the job reported. Throws for an unknown or foreign
 * job.
 * @param id - job to read.
 * @param caller - reading agent checked against the owner.
 * @returns output text and the post-read snapshot.
 */
abstract read(id: JobId, caller?: Agent): JobRead

/**
 * Request cancellation, then mark the job stopping and reported. A producer
 * throw propagates without changing job state. Throws for an unknown or
 * foreign job.
 * @param id - job to cancel.
 * @param caller - killing agent checked against the owner.
 * @param reason - logged reason forwarded to the producer.
 * @returns `requested` for live work, otherwise `already-finished`.
 */
abstract kill(id: JobId, caller?: Agent, reason?: string): 'requested' | 'already-finished'

/**
 * Wait for settlement or timeout without cancelling the job. Caller abort
 * rejects only while the job is live; after settlement the terminal
 * snapshot wins so a notice suppressed for this waiter is still delivered.
 * Throws for invalid, unknown, or foreign input.
 * @param id - job to wait for.
 * @param timeoutMs - positive finite wait bound in milliseconds.
 * @param caller - waiting agent checked against the owner.
 * @param signal - optional cancellation of the wait itself.
 * @returns snapshot at settlement or timeout.
 */
abstract wait(id: JobId, timeoutMs: number, caller?: Agent, signal?: AbortSignal): Promise<JobSnapshot>

/**
 * Register an effect-scoped completion listener. It receives the settlements
 * of the owners its registering context's scope covers; each listener is
 * contained; returned promises are observed but not awaited. No listener runs
 * after service disposal.
 * @param listener - receives each terminal snapshot and its exact owner.
 * @returns disposer that unregisters the listener.
 */
abstract onJobDone(listener: JobDoneListener): () => void

/**
/**
 * Register an effect-scoped observer of visible-set changes. It fires after
 * every commit that changes what {@link list} returns for that owner —
 * registration, every stopping transition (including the one teardown
 * performs before it awaits a slow producer), settlement, owner-disposal
 * removal, and the emptying that service disposal commits — so an observer
 * re-reads rather than accumulating deltas.
 *
 * Delivery is owner-relative on the same terms as {@link onJobDone}: an
 * observer registered from an unscoped context — a host composition's own
 * carrier — sees every owner, while one registered under an agent
 * composition's scope sees exactly the agents composed under it.
 *
 * This is not a superset of {@link onJobDone}: that one delivers the terminal
 * record under first-wins semantics a job controller couples to notice
 * delivery, while this one carries no delivery meaning and marks nothing
 * reported. Listeners are contained and never awaited.
 * @param listener - receives the owner whose visible set changed, or
 *   `undefined` when an unowned job changed and every caller's set did.
 * @returns disposer that unregisters the listener.
 */
abstract onJobsChanged(listener: JobsChangedListener): () => void

/**
 * Attach an effect-scoped controller that can read and stop jobs. It serves the
 * owners its registering context's scope covers, and {@link start} refuses an
 * owner no attached controller serves.
 * @param name - diagnostic label; duplicate names remain independent.
 * @returns disposer that detaches this controller.
 */
abstract attachController(name: string): () => void
```

유형: [Agent](core.md)

소스: [`packages/jobs/jobs/src/index.ts:62`](../../packages/jobs/jobs/src/index.ts)
<!-- END GENERATED cordis-surface -->
