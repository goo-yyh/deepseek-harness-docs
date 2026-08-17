# 하위 프로세스

하위 프로세스 추상 경계는 서비스 정의([dsh-subprocess](../../packages/subprocess/subprocess), `ctx.subprocess`)과 서비스 제공자([dsh-subprocess-local](../../packages/subprocess/subprocess-local))로 나뉩니다. 이 경계의 소비자는 다른 기능 추상 경계와 프로세스 외부 백엔드입니다. [bash 실행기 계열](shell.md)은 수집된 배치 출력을 사용하고, LSP는 원시 프로토콜 파이프를 사용하며, PTY 백엔드는 터미널 기본 기능을 사용하고, ACP 하위 에이전트 백엔드는 파이프된 ndjson과 상속된 stderr를 사용합니다. 이 경계는 관리되는 `DSH_*` 환경 네임스페이스, 공유 자격 증명 정리(`scrubbedParentEnv`), `CollectedOutput` 형태를 소유합니다. [dsh-shell](../../packages/shell/shell)은 어휘를 다시 내보내므로 bash 소비자는 하나의 import 루트를 유지합니다.

출처: [`packages/subprocess/subprocess/src/types.ts`](../../packages/subprocess/subprocess/src/types.ts) 및 [`packages/subprocess/subprocess/src/index.ts`](../../packages/subprocess/subprocess/src/index.ts)

## 실행 파일 조회

한 Provider의 spawn 작업 디렉터리, 실행 파일 경로, 일반 프로세스 및 터미널 세션은 마운트된 파일 시스템 Provider와 동일한 경로 및 프로세스 네임스페이스에 속합니다. `resolveExecutable(command, env?, signal?)`은 절대 실행 파일 경로를 확인하거나 Provider에서 정리된 `PATH`와 의도적으로 지정한 재정의를 통해 이름만 있는 항목을 확인합니다.

## 관리형 환경 네임스페이스와 캡처된 출력

`DSH_*` 변수는 Harness가 소유하는 자식 프로세스 정보입니다. 구현은 호출자의 명시적 `env` 병합 전에 주변 `DSH_*` 이름을 버립니다. 따라서 현재 정보는 의도적으로 지정한 문자열 항목으로만 전달되며, 명시적 `undefined` 툼스톤은 일반적인 주변 값을 제거합니다. 수집된 각 스트림은 `CollectedOutput`을 통해 잘림 및 스필 복구 상태를 보고합니다.

```ts type-equiv
/** One environment key inside the managed {@link DSH_ENV_PREFIX} namespace. */
type DshEnvironmentKey = `${typeof DSH_ENV_PREFIX}${string}`
```

```ts type-equiv
/** Trusted DeepSeek Harness variables for one child-process execution. */
type DshEnvironment = Readonly<Record<DshEnvironmentKey, string>>
```

```ts type-equiv
/** One captured stream: the (possibly truncated) text plus recovery info. */
interface CollectedOutput {
  /** Collected text — the TAIL of the stream when truncated. */
  text: string
  /** True when bytes were dropped from `text`. */
  truncated: boolean
  /** Path to a file holding the COMPLETE stream, when truncated and available. */
  spillPath?: string
}
```

## Node 형태의 stdio 처리 방식

각 스트림의 처리 방식은 명시적이며 소비자별로 선택됩니다. 프로토콜 프레이밍(LSP JSON-RPC, ACP ndjson)에는 원시 파이프를, 전달 진단에는 inherit을, 제한된 배치 출력에는 collect 모드를 사용합니다. 스필 파일은 선택 사항이므로 진단용 후미(언어 서버의 stderr)는 파일을 남기지 않고 버퍼링됩니다.

```ts type-equiv
/**
 * stdin disposition. `'ignore'` leaves fd 0 on `/dev/null`; `'pipe'` exposes
 * {@link SubprocessHandle.stdin} for the caller's ongoing protocol writes;
 * `{ data }` writes the bytes and closes (the batch shape).
 */
type SubprocessStdinMode = 'ignore' | 'pipe' | { readonly data: string }
```

```ts type-equiv
/**
 * Bounded in-memory collection for one output stream, with an optional
 * full-stream spill file. Omitting `spill` keeps only the in-memory tail —
 * the diagnostic-tail shape (a language server's stderr); including it makes
 * the complete stream recoverable up to its cap (the bash tool shape).
 */
interface SubprocessCollect {
  /** In-memory cap in bytes; overflow keeps the TAIL. */
  maxBytes: number
  /** Full-stream spill file; absent disables spilling entirely. */
  spill?: {
    /** Whole-stream byte cap; a larger stream discards its now-incomplete spill. */
    maxBytes: number
  }
}
```

```ts type-equiv
/**
 * stdout/stderr disposition. `'pipe'` exposes the raw `Readable` for the
 * caller's protocol decoding; `'inherit'` passes the parent's descriptor
 * through (child diagnostics land on the harness's own stream); a
 * {@link SubprocessCollect} object buffers boundedly with offset-based reads.
 */
type SubprocessOutputMode = 'pipe' | 'inherit' | SubprocessCollect
```

```ts type-equiv
/** Per-stream stdio dispositions, all explicit — this seam applies no defaults. */
interface SubprocessStdio {
  stdin: SubprocessStdinMode
  stdout: SubprocessOutputMode
  stderr: SubprocessOutputMode
}
```

## 완전히 명시적인 spawn 사양

이 추상 경계는 기본값을 적용하지 않습니다. 모든 처리 방식, 제한 및 디렉터리가 사양에 명시되므로, 숨겨진 하위 프로세스 서비스 기본값이 아니라 호출자 자체의 설정이 이를 결정합니다. `argv`은 셸에서 해석되지 않습니다.

```ts type-equiv
/**
 * A fully-specified spawn request. This seam applies no defaults: every
 * disposition, limit, and directory is explicit, so the caller's own config —
 * not a hidden subprocess-service default — decides them (the `dsh-shell`
 * request/spec split is the owning template).
 */
interface SubprocessSpawnSpec {
  /** Executable and arguments; `argv[0]` is the program. Never shell-interpreted here. */
  argv: readonly string[]
  /** Working directory for the child. */
  cwd: string
  /** Per-stream stdio dispositions. */
  stdio: SubprocessStdio
  /**
   * Positive finite grace period in milliseconds, no greater than
   * `MAX_TIMER_DELAY_MS`, for the {@link SubprocessHandle.terminate} escalation
   * and for draining still-open collected pipes after the process exits (an
   * inherited descriptor held by a surviving descendant cannot hold the
   * outcome open indefinitely).
   */
  graceMs: number
  /**
   * Abort signal — starts the terminate escalation on the process tree when
   * it fires. The caller owns deadlines and cause classification; this seam
   * only reacts to the abort.
   */
  signal?: AbortSignal | undefined
  /**
   * Explicit environment entries merged onto the implementation's scrubbed
   * parent base (see `scrubbedParentEnv`), with no namespace validation. A
   * string is a deliberate caller opt-in, so a forwarded credential-shaped
   * entry or current `DSH_*` fact survives the scrub; `undefined` is a
   * tombstone that removes an ordinary ambient entry from the child.
   */
  env?: NodeJS.ProcessEnv | undefined
}
```

## 핸들: 스트림, 리더 및 트리 범위 종료

spawn은 즉시 활성 핸들을 반환합니다. collect 모드 리더는 전체 스트림 바이트 오프셋을 사용하며 소비하지 않으므로, 독립적인 리더가 서로의 델타를 가져갈 수 없습니다. 파이프된 스트림은 호출자에게 속합니다. 종료는 모든 플랫폼에서 트리 범위로 적용됩니다. 유일한 종료 동사인 `terminate()`은 SIGTERM→grace→SIGKILL 순으로 강화하며, `waitForExit()`은 전체 트리를 관찰합니다. 이는 소비자가 자체 해제 단계를 구성하기에 충분합니다(ACP 백엔드의 stdin-EOF-우선 `disposeAcpChild`이 템플릿입니다).

```ts type-equiv
/**
 * A live child process rooted in its own process tree. Collected output
 * remains readable after exit; piped streams belong to the caller.
 *
 * Termination is tree-scoped everywhere: POSIX signals the detached process
 * group (falling back to the direct child when the group is gone), Windows
 * terminates the tree via `taskkill /T`, so helper processes cannot outlive
 * the handle unnoticed.
 */
interface SubprocessHandle {
  /** Process id (tree root); -1 when the spawn itself failed. */
  readonly pid: number
  /** The child's stdin, present iff spawned with `stdin: 'pipe'`. */
  readonly stdin: Writable | undefined
  /** The child's raw stdout, present iff spawned with `stdout: 'pipe'`. */
  readonly stdout: Readable | undefined
  /** The child's raw stderr, present iff spawned with `stderr: 'pipe'`. */
  readonly stderr: Readable | undefined
  /** Offset-based readers for collect-mode streams (also readable after exit). */
  readonly collected: SubprocessCollectedOutputs
  /** Resolves at process close with exit facts; rejects only for spawn-level failures. */
  readonly done: Promise<SubprocessOutcome>
  /**
   * Begin the SIGTERM → `graceMs` → SIGKILL escalation on the process tree
   * (Windows force-terminates immediately) — the seam's only termination
   * verb. Idempotent, a no-op once the tree is gone (the pid may be reused),
   * and also triggered by the spec's abort signal.
   */
  terminate(): void
  /**
   * Wait until the process tree has exited — the tree, not just the direct
   * child, so a still-running helper is observable before teardown returns.
   * @param signal - optional bound for the wait.
   * @returns `true` when the tree exited, `false` when the signal aborted first.
   */
  waitForExit(signal?: AbortSignal): Promise<boolean>
}
```

```ts type-equiv
/**
 * Cursor-free incremental access to one collected output stream. Offsets are
 * whole-stream byte coordinates owned by the caller, so independent readers
 * cannot consume one another's output; `readFrom(0)` after settlement is the
 * batch result (`lossy` then means the in-memory tail lost its head — the
 * {@link CollectedOutput.truncated} fact).
 */
interface SubprocessOutputReader {
  /**
   * Read everything captured since `fromByte`. When that offset has slid out
   * of the in-memory tail window the read is `lossy` — it returns the whole
   * retained tail and the gap is only recoverable from the spill file.
   * @param fromByte - whole-stream offset to resume from (a prior read's `nextOffset`; 0 for the first read).
   * @returns the delta text, the next offset, the `lossy` flag, and the spill path when one exists.
   */
  readFrom(fromByte: number): SubprocessOutputRead
}
```

```ts type-equiv
/** One incremental {@link SubprocessOutputReader.readFrom} read. */
interface SubprocessOutputRead {
  /** Stream text from the requested offset (the whole retained tail when lossy). */
  text: string
  /** Whole-stream offset to resume from on the next read. */
  nextOffset: number
  /** True when the requested offset slid out of the in-memory tail window. */
  lossy: boolean
  /** Path to the full-stream spill file, when one was created and remains intact. */
  spillPath?: string
}
```

```ts type-equiv
/** Offset-based readers for the streams spawned in collect mode. */
interface SubprocessCollectedOutputs {
  /** Present iff stdout is a {@link SubprocessCollect}. */
  readonly stdout?: SubprocessOutputReader
  /** Present iff stderr is a {@link SubprocessCollect}. */
  readonly stderr?: SubprocessOutputReader
}
```


## 결과에는 종료 정보만 포함됩니다

`done`는 Node의 close 이벤트 어휘를 보고하며 원인 분류는 제공하지 않습니다. 서비스는 중단 시 종료하지만 그 이유를 판단하지는 않습니다(호출자는 자신이 소유한 기한 신호를 읽습니다. 예: bash 실행기의 `timedOut`/`aborted` 구분). 수집된 출력은 완료 후에도 `handle.collected`를 통해 읽을 수 있으므로 일괄 호출자와 스트리밍 호출자가 하나의 접근 경로를 공유합니다.

```ts type-equiv
/**
 * Exit facts of one closed process — Node's `close`-event vocabulary.
 * Deliberately carries NO timeout or cancellation classification (the caller
 * reads the signal it owns to classify causes) and NO output: collected
 * streams stay readable through {@link SubprocessHandle.collected} after
 * settlement, so batch and streaming callers share one access path.
 */
interface SubprocessOutcome {
  /** Exit code; null when the process died from a signal. */
  exitCode: number | null
  /** Terminating signal (e.g. 'SIGTERM'); null on normal exit. */
  signal: NodeJS.Signals | null
}
```

## 터미널 프로세스 기본 요소

`spawnTerminal(spec)`는 파이프를 사용하지 않는 프로세스 기본 요소입니다. 제공자는 제어 터미널을 할당하고 UTF-8 텍스트 전송, 포그라운드 프로세스 그룹 검사 및 신호 전송, 그리고 제공자가 계속 관찰할 수 있는 모든 세션 구성원이 유휴 상태에 도달하도록 하는 한 번의 대기식 TERM-to-KILL 작업을 소유합니다. 제공자는 기반 환경별 관찰 가능성 제한을 문서화합니다. PTY 백엔드는 프롬프트 감지, 준비 상태 추론, 스크롤백, 샌드박스 정책 및 영속 세션 소유권을 계속 담당합니다. 일반 `spawn()`만으로는 제어 터미널 의미 체계를 재구성할 수 없습니다.

터미널 사양은 argv, cwd, 환경 재정의, 크기, 정리 유예 시간 및 선택적 할당 취소를 완전히 지정합니다. 해당 핸들은 `pid`, 순서가 보장된 출력, `done`, `write`, `inspectForeground`, `signalForeground` 및 대기식 `terminate`를 노출합니다. 정확한 공개 형태는 [`ctx.subprocess` 서비스 카탈로그](#ctxsubprocess--subprocessruntime-abstract-seam)에 생성됩니다.

## 서비스 동작

추상 [`SubprocessRuntime`](../../packages/subprocess/subprocess/src/index.ts) 서비스 정의는 실행 환경 좌표, 실행 파일 검색, 일반 `spawn` 및 `spawnTerminal`를 지정합니다. [`LocalSubprocessRuntime`](../../packages/subprocess/subprocess-local/src/index.ts)는 분리된 프로세스 트리, disposition별 연결 구성, 자격 증명 삭제, `node-pty`, 플랫폼 프로세스 검사 및 종료 후 조인하는 폐기를 통해 이를 제공합니다. 서비스 정의 계약은 [`dsh-subprocess`](../../packages/subprocess/subprocess/README.md)를, 로컬 동작 방식은 [`dsh-subprocess-local`](../../packages/subprocess/subprocess-local/README.md)를 참조하세요.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`가 소스에서 생성합니다(문서 동기화에서 `pnpm run verify-cordis-catalog`로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`로 다시 생성합니다). 이 섹션은 페이지의 두 언어 측면에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxe2b--e2bruntime"></a>

### `ctx.e2b` — `E2BRuntime`

지연 소비 가능한 E2B SDK 핸들을 하나 만들고 시간 초과 또는 폐기 시 샌드박스를 삭제합니다. 생성은 플러그인 구성 시 시작되며, 어댑터는 첫 작업 전에 getSandbox를 대기합니다.

```ts cordis-catalog
/**
 * Return the shared live SDK handle.
 * @returns the created sandbox after the configured cwd exists.
 * @throws when E2B rejects creation or the service is disposing.
 */
async getSandbox(): Promise<Sandbox>
```

출처: [`packages/e2b/e2b/src/index.ts:74`](../../packages/e2b/e2b/src/index.ts)

<a id="ctxsubprocess--subprocessruntime-abstract-seam"></a>

### `ctx.subprocess` — `SubprocessRuntime` (추상 접합부)

추상 하위 프로세스 서비스입니다. 하위 클래스를 만들고 spawn을 구현한 다음 해당 하위 클래스를 플러그인으로 로드하세요. 그러면 `ctx.subprocess`로 등록됩니다(컨텍스트당 구현은 하나이며, 두 번째를 로드하면 예외가 발생합니다. 이는 cordis의 표준 중복 서비스 동작입니다).

구현은 다음 의미 체계를 준수해야 합니다:

- 실행 파일 경로는 마운트된 파일 시스템 제공자와 공유되는 하나의 실행 환경에 속합니다.
- spawn은 활성 핸들을 즉시 반환합니다. `done`는 프로세스가 종료될 때 종료 정보를 포함해 이행되며, spawn 수준의 실패에 대해서만 거부됩니다.
- 수집 모드 리더는 오프셋 기반이며 비소비형이므로, 독립적인 리더가 서로의 출력을 소비하지 않습니다. 손실 읽기는 잘림 여부와, 존재하는 경우 전체 스트림을 보관하는 스필 파일을 보고합니다. 파이프된 스트림은 호출자에게 원시 상태로 전달되며 여기서 버퍼링되지 않습니다.
- SubprocessHandle.terminate(및 사양의 abort signal)는 유일한 종료 동사로서 모든 플랫폼에서 트리 범위로 SIGTERM→grace→SIGKILL 순으로 단계적으로 종료합니다. SubprocessHandle.waitForExit는 전체 트리의 활성 상태를 관찰하므로, 소비자 소유의 정리 단계는 각 단계에서 실제 유휴 상태를 기다릴 수 있습니다.
- 서비스를 폐기하면 아직 실행 중인 모든 관리 프로세스를 종료하고, 해당 프로세스의 종료를 기다립니다.
- spawnTerminal은 하나의 대기 가능한 종료 메서드 뒤에서 터미널 할당, 텍스트 전송, 포그라운드 그룹, 시그널링 및 전체 세션 유휴 상태를 관리합니다. 준비 상태와 영속 셸 정책은 PTY 소비자에 남아 있습니다. 최상위 프로세스가 종료되면 큐에 대기한 터미널 출력 후에 해당 출력 스트림이 종료됩니다.

```ts cordis-catalog
/**
 * Resolve one configured executable in this provider's execution world.
 * Absolute paths are verified; bare names use the provider's scrubbed PATH
 * plus explicit environment overrides. Relative paths containing separators
 * are rejected: the resolution base is undefined, so providers fail loud
 * instead of guessing.
 * @param command - absolute executable path or bare PATH name.
 * @param env - explicit environment entries used for lookup.
 * @param signal - aborts remote or local lookup.
 * @returns a canonical executable path.
 */
abstract resolveExecutable( command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal, ): Promise<string>

/**
 * Start one managed child process from a fully-specified spec; this seam
 * applies no defaults.
 * @param spec - argv, directory, stdio dispositions, grace, cancellation, and environment.
 * @returns the live process handle (streams/readers, signalling, outcome promise).
 */
abstract spawn(spec: SubprocessSpawnSpec): SubprocessHandle

/**
 * Allocate a real terminal and start one owned process session. This is the
 * only non-pipe process primitive: implementations own terminal byte I/O,
 * foreground groups, signals, and complete session-tree cleanup.
 * @param spec - fully specified argv, cwd, environment, dimensions, grace, and allocation cancellation.
 * @returns the live terminal handle after allocation succeeds.
 */
abstract spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle>
```

출처: [`packages/subprocess/subprocess/src/index.ts:102`](../../packages/subprocess/subprocess/src/index.ts)
<!-- END GENERATED cordis-surface -->
