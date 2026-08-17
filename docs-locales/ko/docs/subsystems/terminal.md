# 영속 PTY 세션

PTY 백엔드, `ctx.terminals` 및 모델 지향 소비자가 공유하는 타입입니다. 근거는 [영속 PTY Agent 참고 사항](../../.agents/notes/implemented/feature/2026-07-16-persistent-pty-sessions.md)에서 다루며, 이 페이지에는 [`packages/terminal/terminal/src/types.ts`](../../packages/terminal/terminal/src/types.ts)의 패키지 간 용어를 기록합니다.

## 식별 및 준비 상태

`TerminalSessionId`는 서비스가 발급하는 브랜드 id입니다. 선택적 이름은 소유자 로컬 표시 메타데이터이며, 권한 부여는 이름이나 추정한 id가 아닌 정확한 소유 `Agent`를 비교합니다.

`TerminalWaitReason`는 한 번의 전송이 반환된 이유를 나타냅니다. 이는 `TerminalSessionStatus`와 독립적입니다. 무응답 또는 시간 초과는 최상위 셸이 계속 실행 중인 상태에서 반환될 수 있지만, `session_exit`는 임의의 포그라운드 자식이 아니라 해당 셸이 종료되었음을 의미합니다.

```ts type-equiv
/** Why one interactive send returned control to its caller. */
type TerminalWaitReason = 'stdin_read' | 'inferred_idle' | 'timeout' | 'session_exit'
```

```ts type-equiv
/** Top-level PTY process status, independent of a send's wait reason. */
type TerminalSessionStatus =
  | { kind: 'running' }
  | { kind: 'exited'; exitCode: number | null; signal: NodeJS.Signals | null }
```

## 백엔드 및 활성 세션

백엔드는 등록된 하나의 타입을 시작하고 준비 상태를 감지하는 방식을 소유합니다. `TerminalSessionService`는 설정이 성공한 후에만 반환된 세션을 게시하고, 이후 id 권한 부여와 정리를 소유합니다. 부분 시작 리소스를 정리할 수 없는 백엔드는 `TerminalBackendCleanupError`로 거부하므로, 호출자의 취소 이유를 대체하지 않으면서 폐기가 정리 실패를 보존할 수 있습니다. 백엔드 세션은 터미널 상태와 캡처된 리소스의 안정 상태를 소유합니다.

```ts type-equiv
/** Replaceable provider for one PTY session type. */
interface TerminalBackend {
  /** Stable type selected by {@link TerminalSpawnRequest.type}. */
  readonly type: string
  /** Create an unpublished session or reject after cleaning partial resources; cleanup failure uses {@link TerminalBackendCleanupError}. */
  spawn(spec: TerminalBackendSpawnSpec): Promise<TerminalBackendSession>
}
```

```ts type-equiv
/** Backend-owned live session retained by {@link TerminalSessionService}. */
interface TerminalBackendSession {
  /** Initial bounded terminal output returned from `terminal_open`. */
  readonly motd: string
  /** Top-level process id when one exists. */
  readonly pid?: number
  /** Start one exclusive send operation. */
  startSend(request: TerminalSendRequest): TerminalSendOperation
  /** Read one bounded page from retained scrollback. */
  read(request: TerminalReadRequest): TerminalReadResult
  /** Signal the verified foreground process group. */
  signal(signal: TerminalSignal): Promise<TerminalSignalResult>
  /** Observe top-level process status. */
  status(): TerminalSessionStatus
  /** Idempotently close the captured owned process tree and await quiescence. */
  close(reason: string): Promise<void>
}
```

## 전송 및 보존된 출력

활성 세션 하나는 활성 전송 하나를 수락합니다. 해당 작업은 일반 백그라운드 작업용으로 소비되는 출력 커서 하나와 포그라운드 호출자용 최종 결과 하나를 노출합니다. `TerminalReadResult`는 제한된 세션 스크롤백을 별도로 페이지 처리합니다.

```ts type-equiv
/** Live backend-owned send; exactly one may be active per PTY session. */
interface TerminalSendOperation {
  /** Resolves after readiness, timeout, cancellation, or top-level process exit. */
  done: Promise<TerminalSendResult>
  /** Consume output produced since the prior call. */
  readOutput(): TerminalSendRead
  /** Request `SIGINT`; returns false after the operation settled. */
  cancel(): boolean
}
```

```ts type-equiv
/** Settled result for one foreground or background send. */
interface TerminalSendResult {
  /** Bounded rendered terminal delta remaining at settlement. */
  viewport: string
  /** Why the wait returned; this does not imply arbitrary child-process exit. */
  waitReason: TerminalWaitReason
  /** Top-level session status observed at settlement. */
  sessionStatus: TerminalSessionStatus
  /** Whether output was dropped from the operation or retained scrollback. */
  truncated: boolean
}
```

## 소유권 및 지속성

`TerminalSessionService`는 대기되는 정리 하나를 정확한 소유자 범위에 연결하고, 외부 작업을 거부하며, 백엔드 또는 도구 플러그인을 다시 로드해도 세션을 유지합니다. PTY 상태와 원시 바이트는 프로세스 로컬로 남습니다. 모델 입력과 제한된 반환 출력은 중복 PTY 세션 이벤트가 아니라 기존 `tool/call`, `tool/result` 및 작업 결과 경로를 통해 지속됩니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`에서 소스를 기반으로 생성되었습니다(doc-sync에서 `pnpm run verify-cordis-catalog`로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`로 다시 생성). 이 섹션은 페이지의 두 언어 측면에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxterminals--terminalsessionservice"></a>

### `ctx.terminals` — `TerminalSessionService`

교체 가능한 PTY 백엔드 및 정확한 Agent 세션을 위한 프로세스 내 레지스트리입니다.

```ts cordis-catalog
/**
 * Register one backend type for this effect scope.
 * @param backend - provider with a non-empty unique type.
 * @returns disposer that removes exactly this contribution.
 */
registerBackend(backend: TerminalBackend): () => void

/**
 * List registered backend types in registration order.
 * @returns fresh backend type names.
 */
listBackends(): string[]

/**
 * Create and publish one owner-scoped session after backend setup succeeds.
 * @param owner - exact registered Agent that owns access and cleanup.
 * @param request - backend type plus optional owner-local name and cwd.
 * @param signal - cancellation of unpublished setup.
 * @returns published identity, metadata, status, and MOTD.
 */
async spawn(owner: Agent, request: TerminalSpawnRequest, signal?: AbortSignal): Promise<TerminalSpawnResult>

/**
 * Test whether an exact owner has a published session or unpublished spawn.
 * @param owner - exact live owner to inspect.
 * @returns true across the entire spawn-to-close interval, with no publication gap.
 */
hasOwnerActivity(owner: Agent): boolean

/**
 * Start one exclusive interactive send.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param request - explicit text, submit behavior, and cancellation.
 * @returns live operation handle for foreground await or task registration.
 */
startSend(owner: Agent, id: TerminalSessionId, request: TerminalSendRequest): TerminalSendOperation

/**
 * Read one bounded scrollback page from an owned session.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param request - optional newest-relative offset and line count.
 * @returns bounded retained text and pagination metadata.
 */
read(owner: Agent, id: TerminalSessionId, request: TerminalReadRequest = {}): TerminalReadResult

/**
 * Deliver an allowed signal through an owned backend session.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param signal - allowed POSIX signal name.
 * @returns delivered foreground process-group identity.
 */
signal(owner: Agent, id: TerminalSessionId, signal: TerminalSignal): Promise<TerminalSignalResult>

/**
 * Close one owned session and remove it only after quiescent backend cleanup.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param reason - diagnostic cleanup reason.
 * @returns true for a newly closed session, false when the same close is already in flight.
 */
async kill(owner: Agent, id: TerminalSessionId, reason: string = 'model request'): Promise<boolean>

/**
 * List fresh snapshots for exactly one owner.
 * @param owner - exact owner whose sessions are visible.
 * @returns owner-visible snapshots in publication order.
 */
list(owner: Agent): TerminalSessionSnapshot[]
```

유형: [Agent](core.md)

소스: [`packages/terminal/terminal/src/index.ts:105`](../../packages/terminal/terminal/src/index.ts)
<!-- END GENERATED cordis-surface -->
