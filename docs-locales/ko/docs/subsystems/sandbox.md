# 프로세스 샌드박스

[dsh-sandbox](../../packages/sandbox/sandbox)의 프로세스 샌드박스 접점은 소비자를 플랫폼 실행기에 결합하지 않고 동일한 환경의 하위 프로세스 argv를 파일 효과 정책으로 감쌉니다. [dsh-sandbox-local](../../packages/sandbox/sandbox-local)은 Linux bwrap/Landlock, macOS Seatbelt 및 Windows ACL 제한 토큰 백엔드를 제공하며, [dsh-bash-sandbox](../../packages/shell/bash-sandbox)와 [dsh-pwsh-sandbox](../../packages/shell/pwsh-sandbox)가 이를 사용합니다. 컨테이너, microVM 및 원격 실행은 전체 기능 접점의 동등한 구현체이며, `ctx.sandbox`의 제공자가 아닙니다.

출처: [`packages/sandbox/sandbox/src/index.ts`](../../packages/sandbox/sandbox/src/index.ts)

## 모드와 적용

`SandboxMode`은 파일 시스템 효과만 제어합니다. `read-only`은 백엔드에 쓰기를 거부하도록 요청합니다. POSIX 실행기는 추가로 셸에 필요한 `/dev/null` 싱크를 허용하는 반면, Windows ACL 실행기는 명시적인 쓰기 가능 루트를 부여하지 않고 주변 ACL 공백에 대해서는 부분 적용을 보고합니다. `workspace-write`은 워크스페이스 루트와 백엔드가 약속한 임시 영역 아래의 쓰기를 허용하며, `danger-full-access`은 격리를 우회합니다. 네트워크와 프로세스 가시성은 이 어휘의 범위 밖입니다.

```ts type-equiv
/**
 * File-effect policy for confined processes. `read-only` permits only required
 * sinks such as `/dev/null`; `workspace-write` also permits the workspace and a
 * backend-defined temp area; `danger-full-access` bypasses confinement. Network
 * and process visibility are outside this vocabulary.
 */
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
```

처음 두 모드만 제공자에게 전송할 수 있습니다. `danger-full-access` 소비자는 원래 argv를 생성하고 `ctx.sandbox`을 호출하지 않습니다.

```ts type-equiv
/** A confining (non-`danger-full-access`) mode — the modes a {@link SandboxPolicy} can carry. */
type ConfinedSandboxMode = Exclude<SandboxMode, 'danger-full-access'>
```

적용은 보고되는 사실입니다. `full`은 백엔드가 해당 모드에서 약속한 모든 파일 효과를 제어함을 의미합니다. `partial`은 활성 백엔드 또는 이전 커널 ABI가 일부만 제어함을 의미하므로, 절대적인 보장을 요구하는 소비자는 이 구분을 거부하거나 노출해야 합니다. 이전 Landlock ABI와 Windows ACL 실행기의 Everyone/하드 링크 경계는 현재의 부분 적용 사례입니다.

```ts type-equiv
/**
 * Enforcement completeness for this host. `partial` means an active backend or
 * older kernel ABI cannot govern every promised file effect; callers requiring
 * an absolute boundary must not treat it as `full`.
 */
type SandboxEnforcement = 'full' | 'partial'
```

## 호출별 정책

전체 실행 정책은 기능 호출마다 해석되고 전달됩니다. 여기에는 `danger-full-access`이 포함되므로 소비자는 격리 우회 여부를 결정하기 전에 정책을 한 번 해석할 수 있습니다. 일반 도구 호출은 호출 세션의 변경 불가능한 cwd에서 `workspaceRoot`을 도출하며, 배포 설정은 에이전트 없는 대체 수단입니다. 루트는 어휘 정규화 전에 파일 시스템 의미론으로 정준화되므로, `symlink/..`이 포함된 cwd는 생성된 프로세스가 실제로 실행되는 디렉터리를 식별합니다.

```ts type-equiv
/**
 * The complete file-effect policy resolved for one capability call. The root
 * is carried even under modes that do not consume it so callers can resolve
 * policy once before choosing the enforcement path.
 */
interface SandboxExecutionPolicy {
  /** The file-effect mode this execution runs under. */
  mode: SandboxMode
  /** Absolute root directory `workspace-write` may write under. */
  workspaceRoot: string
  /**
   * Opaque identity of the calling session (the branded `dsh-session`
   * SessionId). Backends key per-session state off it (e.g. windows-acl gives
   * each live session/workspace pair a random private temp directory and SID,
   * while the workspace SID and standing grant remain per-workspace); absent
   * for agentless calls, which fall back to per-call backend state.
   */
  sessionId?: SessionId
}
```

`ctx.sandboxPolicy.resolve()`은 활성 세션과 승인된 재시도의 경우 명시적 모드를 받습니다. 서비스가 우선순위와 루트 대체를 소유하므로 bash와 fs가 이를 반복하지 않습니다.

```ts type-equiv
/** Inputs that select the sandbox policy for one capability call. */
interface SandboxPolicyRequest {
  /** Calling session; its immutable cwd becomes the workspace boundary. */
  session?: Session
  /** Explicit approved mode override, which outranks session policy. */
  mode?: SandboxMode
}
```

격리된 실행만 `ctx.sandbox`에 도달하며, 해당 제공자 정책은 동일한 루트를 유지하면서 모드를 축소합니다. 이를 통해 동시 세션, 소비자 및 일회성 권한 상승 재시도는 제공자 상태를 변경하지 않고 서로 다른 경계를 동일한 제공자에게 요청할 수 있습니다.

```ts type-equiv
/**
 * What one confined execution is allowed to touch — carried PER CALL, not
 * fixed on the provider: two consumers may confine under different policies
 * at the same instant (bash under `read-only` while a confined child agent
 * needs its state directory writable), and an approved escalated retry is a
 * new call with a wider policy. Defaulting/resolution is an explicit step at
 * the consumer boundary; the provider treats the policy as fully specified.
 */
interface SandboxPolicy extends SandboxExecutionPolicy {
  /** The file-effect mode this execution runs under. */
  mode: ConfinedSandboxMode
}
```

## 래핑된 argv와 분류 방언

`RunnerFailureRule`은 실행기가 명령을 실행하기 전에 실패했다는 증거를 결합합니다. 소비자는 0이 아닌 종료, 선택적 허용 종료 코드 게이트 및 남아 있는 stderr 한 줄 내의 대소문자 구분 없는 치명적 서명을 요구합니다. 먼저 대소문자 구분 없는 정확한 전체 줄의 정보성 제외 항목을 제거하므로, 무해한 실행기 알림만으로는 실패를 증명할 수 없습니다. 일치한 줄은 오류 세부 정보로 계속 사용할 수 있으며, 분류는 stderr를 다시 작성하지 않습니다.

```ts type-equiv
/**
 * Evidence that identifies a sandbox runner failing before it executes the
 * wrapped command. A consumer first applies {@link allowedExitCodes} when
 * present, removes {@link informationalLines} by case-insensitive exact line
 * equality, then matches {@link fatalSignatures} case-insensitively within
 * each remaining stderr line. Exit status alone never proves runner failure.
 */
interface RunnerFailureRule {
  /** Nonzero process exit codes on which this rule may match; omitted permits any nonzero exit. */
  allowedExitCodes?: readonly number[]
  /** Non-empty substrings identifying a fatal runner diagnostic on one stderr line. */
  fatalSignatures: readonly string[]
  /** Benign stderr lines excluded by exact full-line equality before fatal matching. */
  informationalLines?: readonly string[]
}
```

`ConfinedArgv`은 소비자가 생성하는 대상입니다. 대체 argv 외에도 백엔드의 적용 사실과 서로 직교하는 두 stderr 분류기를 전달합니다. `denialSignatures`은 샌드박스가 올바르게 작동하는 동안 격리된 명령이 차단되었음을 식별합니다. `runnerFailureRules`은 명령을 실행하기 전에 샌드박스 실행기가 거부하거나 실패했음을 식별합니다. 소비자는 이를 먼저 확인하고 일반 작업 실패가 아닌 샌드박스 인프라 실패를 노출합니다.

```ts type-equiv
/**
 * A {@link SandboxProvider.confine} result: the argv to spawn in place of
 * the caller's own, plus the enforcement completeness the selected backend
 * achieves for it.
 */
interface ConfinedArgv {
  /** The wrapped argv (runner, profile, separator, then the caller's argv). */
  argv: string[]
  /** How completely the selected backend enforces the policy's file effects. */
  enforcement: SandboxEnforcement
  /**
   * The selected backend's denial DIALECT: the case-insensitive stderr
   * substrings a file effect denied by THIS backend produces (EROFS text
   * under bwrap's read-only binds, EACCES under Landlock, EPERM under
   * Seatbelt). A consumer that infers denials from a failed run's stderr
   * matches against exactly these rather than a cross-backend union — the
   * union claims denials a given backend never produces.
   */
  denialSignatures: readonly string[]
  /**
   * Structured runner-failure evidence rules. Consumers require a matching
   * fatal stderr line (after informational exclusions) and any rule-specific
   * exit-code gate before checking denial signatures: runner failure means the
   * command never ran, while denial means confinement worked and blocked it.
   */
  runnerFailureRules: readonly RunnerFailureRule[]
}
```

[로컬 제공자](../../packages/sandbox/sandbox-local/README.md)는 운영자 설정을 소유하고 해당 실행기 방언을 이 규칙에 매핑합니다. [샌드박스 처리된 bash 소비자](../../packages/shell/bash-sandbox/README.md)는 생성 및 결과 귀속을 소유합니다.

## 제공자 및 실패 시 차단 오류

`ctx.sandbox.confine(argv, policy)`는 사용 가능한 백엔드가 없을 때 `ConfinedArgv`를 반환하거나 코드 `SANDBOX_UNAVAILABLE`의 `SandboxUnavailableError`를 발생시킵니다. 소비자는 반환된 argv를 생성하거나 관찰하는 동안의 실패도 분류할 수 있으며, 그 귀속은 소비자 계약에 속합니다. 제한 정책에서 조용히 제한 없이 통과시키는 것은 절대 허용되지 않습니다.

제공자 선택, 프로브, 캐싱 및 백엔드별 강제 적용 보고서는 [로컬 제공자](../../packages/sandbox/sandbox-local/README.md)에 속합니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`에서 소스로부터 생성되었습니다(문서 동기화에서 `pnpm run verify-cordis-catalog`로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`로 다시 생성). 이 섹션은 페이지의 두 언어 측면에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxsandbox--sandboxprovider-abstract-seam"></a>

### `ctx.sandbox` — `SandboxProvider` (추상 이음새)

추상 프로세스 샌드박스 서비스입니다. confine은 강제 적용되는 argv를 반환하거나 래핑 또는 실행기 실행 시점에 실패 시 차단해야 하며, 조용히 제한 없이 통과시키는 것은 금지됩니다. 기능 프로브는 다중 실행기 체인을 조정하며, 단일 후보의 경우 생략할 수 있지만 해당 후보 자체의 거부는 계속해서 실패 시 차단의 종점으로 남습니다.

```ts cordis-catalog
/**
 * Wrap `argv` so it executes confined under `policy` on this host; the
 * caller spawns the returned argv in place of its own.
 * @param argv - the exact argv the caller is about to spawn (program plus
 *   arguments), NOT a shell string — a shell-shaped consumer passes
 *   `['bash', '-c', command]`.
 * @param policy - the file-effect policy this execution runs under,
 *   carried per call (see {@link SandboxPolicy}).
 * @returns the argv to spawn instead, plus the enforcement completeness
 *   the selected backend achieves for it.
 */
abstract confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv
```

소스: [`packages/sandbox/sandbox/src/index.ts:158`](../../packages/sandbox/sandbox/src/index.ts)

<a id="ctxsandboxpolicy--sandboxpolicyservice"></a>

### `ctx.sandboxPolicy` — `SandboxPolicyService`

샌드박스 정책 서비스(`ctx.sandboxPolicy`)입니다. 배포 기본 모드, 대체 워크스페이스 루트 및 현재 요청 시점 정책 섹션을 소유합니다. 도구 계층은 각 실행마다 resolve를 호출하므로 세션의 모드 로그와 변경 불가능한 cwd가 모든 강제 적용 기능으로 함께 전달됩니다.

```ts cordis-catalog
/**
 * Resolve the complete policy for one capability call. An approved explicit
 * mode outranks the session's last `sandbox/mode` event, which outranks the
 * deployment default. A session cwd is its workspace-write boundary; the
 * configured root is the fallback for agentless calls and sessions without a
 * cwd.
 * @param request - optional session and approved mode override.
 * @returns the fully resolved per-call mode and absolute workspace root.
 */
resolve(request: SandboxPolicyRequest = {}): SandboxExecutionPolicy

/**
 * Read the session override without applying the deployment default.
 * @param session - session whose log supplies the override.
 * @returns the last logged mode, or `undefined` without one.
 */
overrideOf(session: Session): SandboxMode | undefined
```

유형: [Session](session.md)

소스: [`packages/sandbox/sandbox-policy/src/index.ts:91`](../../packages/sandbox/sandbox-policy/src/index.ts)
<!-- END GENERATED cordis-surface -->
