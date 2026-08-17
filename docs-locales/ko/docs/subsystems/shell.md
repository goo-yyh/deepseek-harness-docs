# Bash 실행기

bash 실행 추상 경계는 서비스 정의([dsh-shell](../../packages/shell/shell), `ctx.shell`), 서비스 제공자([dsh-bash-local](../../packages/shell/bash-local) 및 [dsh-bash-sandbox](../../packages/shell/bash-sandbox)), 소비자([dsh-tool-bash](../../packages/shell/tool-bash), `bash` 스키마)로 나뉩니다. 일반적인 백그라운드 작업 ID, 소유권 및 제어는 [jobs.md](jobs.md)에 있으며, 이 추상 경계는 작업이 없는 프로세스 핸들을 반환합니다. 원시 프로세스 그룹 메커니즘은 [subprocess 추상 경계](subprocess.md) 뒤에 있습니다.

출처: [`packages/shell/shell/src/types.ts`](../../packages/shell/shell/src/types.ts)

## 관리되는 셸 환경 네임스페이스

`DSH_*` 변수는 Harness가 소유하는 자식 프로세스 정보입니다. 모델 대상 bash 도구는 `ctx.shellEnv`를 통해 이를 수집하고 `ShellExecRequest.dshEnv`를 통해 전달합니다. subprocess 서비스는 현재 스냅샷을 병합하기 전에 상속된 `DSH_*` 이름을 제거합니다. `DshEnvironmentKey`/`DshEnvironment` 어휘는 [subprocess 추상 경계](subprocess.md)가 소유하며 `dsh-shell`에서 다시 내보냅니다.

## 요청과 사양: `resolve()` 분리

이 추상 경계는 **모델/플러그인 대상 요청** (선택적 `workdir`/`timeoutMs`/`stdoutMaxBytes`이며, 설정 또는 요청 정책에서 채워짐)과 실행기가 처리하는 **완전히 해석된 사양** (해당 필수 필드)를 분리합니다. 도구 계층은 그 사이에서 `ctx.shell.resolve(request)`를 호출합니다(저장소의 “패키지 경계에서는 명시적 > 암시적” 규칙). `ShellExecSpec`에는 해석된 값이 담깁니다.

```ts type-equiv
/**
 * A caller's execution REQUEST: `workdir` and `timeoutMs` are optional and
 * filled by {@link ShellExecutor.resolve} from the implementation's config.
 * This is the model-/plugin-facing shape; pass it to `resolve()` to obtain a
 * fully-resolved {@link ShellExecSpec}.
 */
interface ShellExecRequest {
  command: string
  /** Working directory override (default: implementation-configured). */
  workdir?: string | undefined
  /** Timeout override in milliseconds (implementations cap it). */
  timeoutMs?: number | undefined
  /**
   * Foreground stdout capture budget in bytes. Absent uses the executor's
   * default output cap. Trusted in-process consumers use this when they must
   * parse complete stdout up to their own bounded limit; the model-facing bash
   * tool does not expose it as a parameter.
   */
  stdoutMaxBytes?: number | undefined
  /** Abort signal — implementations kill the command when it fires. */
  signal?: AbortSignal | undefined
  /**
   * Bytes to write to the command's stdin, then close it. Absent leaves stdin
   * closed/empty (the default for model-driven tool calls). Set by in-process
   * plugins (e.g. the hooks bridges, which write a hook command's JSON payload
   * to its stdin); the model-facing bash tool does not expose it as a parameter
   * (a model that needs stdin uses shell syntax like a heredoc or a pipe).
   */
  stdin?: string | undefined
  /**
   * Ordinary environment entries for the command, merged after the credential
   * scrub. Managed facts belong in {@link dshEnv}, which merges after this
   * map, so an entry here can never displace one. Set by in-process plugins
   * (the hooks bridges set `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, …); the
   * model-facing bash tool does not expose it as a parameter.
   */
  env?: Record<string, string> | undefined
  /**
   * Harness-owned `DSH_*` variables for this execution (typed to managed
   * keys). Executors discard ambient `DSH_*` entries before merging this
   * snapshot last, so an unavailable current fact cannot inherit a stale
   * value from the harness process and a caller {@link env} entry cannot
   * displace a managed one.
   */
  dshEnv?: DshEnvironment | undefined
  /** Fully resolved per-call sandbox policy; sandboxing executors default it. */
  sandboxPolicy?: SandboxExecutionPolicy | undefined
}
```

```ts type-equiv
/**
 * A resolved execution spec. {@link ShellExecutor.resolve} fills and caps the
 * required fields; {@link ShellExecutor.start} ignores `timeoutMs` because
 * background processes have no executor timeout.
 */
interface ShellExecSpec {
  command: string
  workdir: string
  timeoutMs: number
  /**
   * Resolved foreground stdout capture budget in bytes. `run()` uses it for
   * stdout; background jobs and stderr keep the executor's own output cap.
   */
  stdoutMaxBytes: number
  /** Abort signal — implementations kill the command when it fires. */
  signal?: AbortSignal | undefined
  /** Bytes to write to stdin before closing it; absent means no stdin. */
  stdin?: string | undefined
  /**
   * Ordinary environment entries carried through from
   * {@link ShellExecRequest.env}; {@link dshEnv} still merges after them.
   * OPTIONAL on the spec for the same reason as `stdin`: absent means no
   * ordinary extra environment.
   */
  env?: Record<string, string> | undefined
  /** Managed `DSH_*` snapshot (typed to managed keys); merges after {@link env}. */
  dshEnv?: DshEnvironment | undefined
  /** Resolved sandbox policy; ignored by executors that do not confine. */
  sandboxPolicy: SandboxExecutionPolicy | undefined
}
```

`stdin` 및 `env`는 신뢰할 수 있는 프로세스 내 플러그인 입력이며 `dsh-tool-bash`에서 노출되지 않습니다. 로컬 실행기는 명시적으로 호출자가 제공한 환경을 병합하기 전에 주변 자격 증명을 정리합니다. [bash-stdin-env Agent Note](../../.agents/notes/implemented/architecture/2026-06-30-bash-stdin-env-trusted-plugin-api.md)를 참조하세요.

`stdoutMaxBytes` 역시 신뢰할 수 있는 플러그인 전용입니다. 이를 사용하면 포그라운드 소비자가 stderr, 백그라운드 작업 또는 모델 대상 bash 도구의 일반 출력 한도를 변경하지 않고 제한된 파서 예산까지 전체 stdout을 요청할 수 있습니다.

## 포그라운드 실행: `ShellRunResult`

완료되었거나 종료된 포그라운드 실행 하나의 결과입니다. 직교하는 결과는 **독립적으로**  보고됩니다. 즉, 신호를 트랩한 프로세스는 시간 초과되면서 종료 코드 0으로 끝날 수도 있으므로 `timedOut`, `aborted`, `signal` 및 `exitCode`는 각각 별도의 필드입니다. 호출자는 중간에 잘린 실행을 정상적인 성공으로 읽지 않습니다.

```ts type-equiv
/** The outcome of one completed (or killed) foreground run. */
interface ShellRunResult {
  /** Exit code; null when the process died from a signal. */
  exitCode: number | null
  /** Terminating signal (e.g. 'SIGTERM'); null on normal exit. */
  signal: NodeJS.Signals | null
  /**
   * True when the executor's own timeout was the FIRST cause to cut the command
   * short. Mutually exclusive with {@link aborted}: one fused deadline drives
   * both the timeout and the caller's cancellation, so a timeout and an abort
   * racing before process close report the single first-abort cause, not both
   * (see the [timeout-library Agent Note](../../../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md)).
   */
  timedOut: boolean
  /**
   * True when the caller's `AbortSignal` was the FIRST cause to kill the command
   * (and it was not the executor's own timeout). Mutually exclusive with
   * {@link timedOut} — see there for the first-cause classification.
   */
  aborted: boolean
  /** The effective timeout applied to this run (after defaulting/capping). */
  timeoutMs: number
  stdout: CollectedOutput
  stderr: CollectedOutput
  /** Sandbox execution facts, absent for an unsandboxed executor. */
  sandbox?: ShellSandboxInfo
}
```

각 스트림은 `CollectedOutput`입니다. 즉, (잘렸을 수 있는) 텍스트와 복구 정보로 구성됩니다. 잘린 경우 `text`는 **끝부분** 이며 전체 스트림은 비공개 파일로 저장됩니다. 이 필드는 [subprocess 추상 경계](subprocess.md)가 소유하며 `dsh-shell`에서 다시 내보냅니다.

## 파일 샌드박스: `ShellSandboxInfo`

샌드박스를 사용하는 실행기는 `ShellExecutor.sandboxMode`를 통해 구성된 모드 폴백을 노출합니다. 도구 계층은 [`@deepseek-ai/dsh-sandbox-policy`](../../packages/sandbox/sandbox-policy/README.md)에 각 호출 세션의 영속적인 `sandbox/mode` 재정의와 변경 불가능한 cwd를 `ShellExecRequest.sandboxPolicy`로 해석하도록 요청합니다. 사용자가 승인한 엄격하게 더 넓은 호출은 모드만 대체합니다. mode/root/enforcement 어휘는 [`@deepseek-ai/dsh-sandbox` 추상 경계](sandbox.md)가 소유하며, 모드는 파일 효과만 제어합니다.

샌드박스 실행은 모드, 보수적인 거부 분류 및 적용 완전성을 보고합니다. `runnerFailed`는 명령이 실행되기 전에 발생한 샌드박스 실행기 실패를 표시합니다. 포그라운드 실행은 `SANDBOX_UNAVAILABLE`를 발생시키는 반면, 완료된 백그라운드 프로세스에는 사실 채널만 있습니다.

```ts type-equiv
/**
 * Sandbox facts for one run, present iff a sandboxing executor handled it.
 * Facts are reported independently of process exit status so callers can
 * distinguish command failures from policy denials and runner failures.
 */
interface ShellSandboxInfo {
  /** The mode the command actually ran under. */
  mode: SandboxMode
  /** Whether the sandbox denied a file operation. */
  denied: boolean
  /** How completely the selected runner enforced the requested mode. */
  enforcement?: SandboxEnforcement
  /** Whether the sandbox runner failed before the command could run. */
  runnerFailed?: boolean
}
```

`SANDBOX_UNAVAILABLE` 오류 코드([sandbox 추상 경계](sandbox.md)가 소유)는 제한된 모드에 사용할 수 있는 백엔드가 없을 때 `ctx.sandbox` 제공자가 발생시키고 실행기가 전파하는 코드입니다. 선택된 실행기가 해당 프로필을 거부해도 동일한 실패 폐쇄형 포그라운드 오류가 발생하며, 완료된 백그라운드 작업은 `runnerFailed`를 기록합니다. 모델은 결과에서 거부/실행기 사실을 수신하고, 거부 표시자가 이를 명시할 때만 유효 모드를 알며, `sandbox_permissions` 및 `justification`를 통해 일회성의 엄격하게 더 넓은 재시도를 요청할 수 있습니다. 실행 전에 `ctx.approval`가 정확히 그 호출을 승인해야 합니다. 전체 정책 및 전환 설계는 [sandbox Agent Note](../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)에 있습니다.

## 백그라운드 프로세스: `ShellProcess`

`start()`는 ID나 소유자 없이 핸들을 반환합니다. `dsh-tool-bash`는 이를 `ctx.jobs.start()` 훅으로 조정하며, 이후 일반 런타임이 작업 식별자와 수명 주기를 소유합니다. `done`는 프로세스가 종료되면 완료되고 절대 거부되지 않으며, 완료 후에도 읽기가 유효하고 샌드박스 사실은 `done`가 완료되기 전에 기록됩니다.

```ts type-equiv
/**
 * A background process handle returned by {@link ShellExecutor.start}. It is the
 * only access path; buffered output remains readable after exit. Composition
 * teardown (the subprocess service's disposal) kills running processes and
 * awaits {@link done}; an executor-only reload leaves them running.
 */
interface ShellProcess {
  /** Process lifecycle state (settled exactly once). */
  status: ShellProcessStatus
  /** Exit code once finished (null = killed by signal / still running). */
  exitCode: number | null
  /** Terminating signal name, when signal-killed. */
  signal: NodeJS.Signals | null
  /** Resolves when the underlying process closes (never rejects — a spawn failure settles as `killed` with the error on stderr). */
  readonly done: Promise<void>
  /** Sandbox facts, stamped once a confined process settles. */
  sandbox?: ShellSandboxInfo
  /**
   * Read output produced since the previous read (consuming — consecutive
   * reads never re-deliver). Reads that lost data flag `lossy` and point at
   * full-stream spill files when available.
   */
  readOutput(): ShellProcessRead
  /**
   * Kill the process group. Returns false when it had already finished
   * (no-op); idempotent.
   */
  kill(): boolean
}
```

`readOutput()`는 증분 델타와 스필 복구 사실을 반환합니다.

```ts type-equiv
/** One incremental {@link ShellProcess.readOutput} read. */
interface ShellProcessRead {
  /** Output produced since the previous read (stderr in a marked section). */
  delta: string
  /** True when truncation dropped unread bytes the delta cannot include. */
  lossy: boolean
  /** Full stdout spill file, when stdout truncation occurred and a safe path is available. */
  stdoutSpillPath?: string
  /** Full stderr spill file, when stderr truncation occurred and a safe path is available. */
  stderrSpillPath?: string
}
```

## 서비스

`ShellExecutor`는 `resolve`, 포그라운드 `run`, 백그라운드 프로세스 `start` 및 `sandboxMode` 기능 사실을 소유합니다. `dsh-bash-local`는 명령 기본값 설정, 시간 초과/중단 분류, 터미널 환경 및 백그라운드 읽기 병합을 소유합니다. 프로세스 그룹, 제한된 수집기, 스필 파일, 자격 증명 정리 및 폐기 정지는 [하위 프로세스 서비스](subprocess.md)의 소유입니다. `dsh-tool-bash`는 모델 대상 렌더링을 소유하고 백그라운드 핸들을 [일반 작업 런타임](jobs.md)으로 조정합니다. `dsh-shell`는 셸 도구의 공유 종료 상태 계약을 소유합니다. 내보낸 `parseExitStatus`/`ParsedExitStatus`는 `[exit code: N]` / `[killed by signal: X]` 표시자인 `dsh-tool-bash`의 `renderResult` 및 `dsh-tool-pwsh`의 `renderPwshResult` 추가를 반전하며, 두 도구의 `presentResult`는 이를 사용해 렌더링된 텍스트를 터미널 카드의 출력 본문과 종료 상태 표시로 분리합니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`가 소스에서 생성했습니다(문서 동기화에서 `pnpm run verify-cordis-catalog`로 최신 상태를 확인하며, `pnpm run gen-cordis-catalog`로 다시 생성). 이 섹션은 페이지의 두 언어 측면에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxshell--shellexecutor-abstract-seam"></a>

### `ctx.shell` — `ShellExecutor` (추상 경계)

추상 bash 실행 서비스입니다. 하위 클래스를 만들고 추상 메서드를 구현한 다음 하위 클래스를 플러그인으로 로드하면 `ctx.shell`로 등록됩니다(컨텍스트당 구현 하나이며, 두 번째를 로드하면 cordis의 표준 중복 서비스 동작에 따라 오류가 발생합니다).

구현은 다음 의미를 준수해야 합니다.

- run은 인프라 실패에 대해서만 거부됩니다. 0이 아닌 종료, 시간 초과에 의한 종료 및 중단에 의한 종료는 ShellRunResult와 함께 완료됩니다.
- start는 즉시 반환되며 백그라운드 프로세스에는 시간 초과가 적용되지 않습니다. `done`는 프로세스 종료 시 완료되고 절대 거부되지 않습니다. 생성 실패는 stderr에 오류를 포함한 `killed`로 완료됩니다.
- ShellProcess.readOutput은 증분 방식입니다. 연속해서 읽어도 출력이 반복되지 않습니다. 손실이 있는 읽기는 잘림과 사용 가능한 스필 파일을 보고합니다.
- 소유하는 구성 요소가 해제될 때 아직 실행 중인 백그라운드 프로세스는 중지되고 완료를 기다립니다. 하위 프로세스 추상 경계에서는 그 경계가 `ctx.subprocess` 폐기이므로, 백그라운드 프로세스는 실행기만 다시 로드해도 유지됩니다.

```ts cordis-catalog
/**
 * Apply implementation-owned defaults and caps to a request before execution.
 * @param request - the caller's request; omitted fields get this
 *   implementation's defaults, capped fields are clamped.
 * @returns the fully-specified spec to hand to {@link run}/{@link start}.
 */
abstract resolve(request: ShellExecRequest): ShellExecSpec

/**
 * Run a command in the foreground; resolves when it finishes.
 * @param spec - a resolved spec from {@link resolve}, never a raw request.
 * @returns the outcome; nonzero exits, timeout kills, and abort kills
 *   resolve with a descriptive result rather than reject.
 */
abstract run(spec: ShellExecSpec): Promise<ShellRunResult>

/**
 * Start a background process and return its handle immediately.
 * @param spec - a resolved spec from {@link resolve}, never a raw request.
 * @returns the live process handle (reads, kill, quiescence promise).
 */
abstract start(spec: ShellExecSpec): ShellProcess
```

출처: [`packages/shell/shell/src/index.ts:65`](../../packages/shell/shell/src/index.ts)

<a id="ctxshellenv--shellenvregistry"></a>

### `ctx.shellEnv` — `ShellEnvRegistry`

신뢰할 수 있는 실행별 `DSH_*` 변수용 레지스트리(`ctx.shellEnv`)입니다. 네임스페이스는 모델 셸을 호출할 때마다 다시 빌드됩니다. 실행기는 주변 `DSH_*` 값을 버린 후 레지스트리의 현재 스냅샷을 주입합니다. 내장 셸 정보는 레지스트리 자체가 계속 소유하며, 플러그인은 효과 범위 지정 폐기를 통해 열거 가능한 추가 정보를 등록할 수 있습니다.

```ts cordis-catalog
/**
 * Register one environment contributor. Names and keys are unique; built-in
 * keys are reserved. Registration is disposed with the calling plugin fiber.
 * @param contributor - declared key ownership and per-execution resolver.
 * @returns the disposer that unregisters the contribution.
 */
register(contributor: BashEnvContributor): () => void

/**
 * Build the trusted `DSH_*` snapshot for one shell tool execution.
 * @param execution - the current tool execution.
 * @returns an immutable environment overlay containing built-ins and current contributions.
 */
collect(execution: ToolExecution): DshEnvironment

/**
 * Enumerate plugin-contributed variables without executing their resolvers.
 * @returns declarations sorted by environment variable name.
 */
list(): BashEnvVariableInfo[]
```

유형: [DshEnvironment](subprocess.md) · [ToolExecution](tools.md)

출처: [`packages/shell/shell-env/src/index.ts:89`](../../packages/shell/shell-env/src/index.ts)
<!-- END GENERATED cordis-surface -->
