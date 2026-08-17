# 파일 시스템

선택적 파일 시스템 기능은 네 부분으로 구성됩니다. [dsh-fs](../../packages/fs/fs)는 `ctx.fs` 및 선택적 가드가 있는 원자적 텍스트 작업을 소유하고, [dsh-fs-local](../../packages/fs/fs-local)은 로컬 디스크를 구현하며, [dsh-fs-observation-policy](../../packages/fs/fs-observation-policy)는 관찰된 존재 또는 부재를 기록하고 서비스가 아닌 이벤트를 통해 최신성 규칙을 추가하며, [dsh-tool-fs](../../packages/fs/tool-fs)는 모델 대상 read/write/edit 호출을 직접 실행하고 창을 렌더링합니다. 이는 에이전트 루프 핵심 경로 밖에 있으므로 대체 백엔드는 정책이나 도구 스키마를 변경하지 않습니다.

`dsh-fs-observation-policy`는 선택 사항입니다. 이것이 없으면 `FileSystem` 서비스 정의, 공급자 및 `dsh-tool-fs` 소비자가 완전하고 제약 없는 파일 시스템 추상 경계를 구성합니다. 즉, `write`은 무조건 생성하거나 덮어쓰고, `edit`은 리터럴 텍스트를 무조건 교체합니다. 정책 플러그인은 `fs/*` 워터폴을 결정하여 이러한 작업을 변경합니다. 도구는 `ctx.fs`을 호출하고 이벤트를 디스패치할 뿐 정책 메서드를 호출하지 않으므로, 이를 제거해도 도구는 손상되지 않습니다. `dsh-tool-fs`을 로드하는 배포 환경은 기본 동작이 쓰기/편집 전 읽기가 되도록 `dsh-fs-observation-policy`도 로드해야 합니다.

공급자 소스: [`packages/fs/fs/src/types.ts`](../../packages/fs/fs/src/types.ts) 및 [`packages/fs/fs/src/index.ts`](../../packages/fs/fs/src/index.ts). 정책 소스: [`packages/fs/fs-observation-policy/src/types.ts`](../../packages/fs/fs-observation-policy/src/types.ts). 읽기 렌더링 소스: [`packages/fs/tool-fs/src/read-render.ts`](../../packages/fs/tool-fs/src/read-render.ts).

## 대상 식별자 및 메타데이터(공급자 계약)

모든 작업은 먼저 사용자가 제공한 경로를 불투명한 백엔드 대상으로 해석합니다. 소비자는 `displayPath`을 표시할 수 있지만, 브랜드가 지정된 불투명 ID인 `targetKey`을 파싱하거나 이것이 로컬 절대 경로라고 가정해서는 안 됩니다.

파일 시스템의 실행 환경을 공유하는 소비자는 이 식별자를 해석하는 대신 공급자를 통해 기능 간 좌표를 얻습니다. `processPath(target)`은 하위 프로세스가 열 수 있는 표준 절대 경로를 반환하고, `fileUrl(target)`은 공급자 플랫폼의 `file:` URI를 반환하며, `contains(parent, child)`은 표준 식별자 또는 하위 항목 포함 여부를 검사합니다.

```ts type-equiv
/**
 * A path resolved by a backend into a stable identity. `resolve()` produces
 * this; every other operation takes it.
 */
interface FsTarget {
  /** Opaque key for stale guards and target lookup. */
  targetKey: FsTargetKey
  /**
   * Path for model/UI-facing output. May be a local absolute path,
   * workspace-relative path, or remote URI depending on the backend.
   */
  displayPath: string
}
```

백엔드는 파일 버전 토큰, 즉 쓰기/편집이 보호하는 최신성 토큰을 소유합니다. 정책 플러그인은 오래된 상태 검사에 이를 저장하며 소비자는 이를 해석하지 않습니다. 두 ID는 모두 브랜드가 지정된 불투명 문자열입니다.

```ts type-equiv
/**
 * Opaque key for stale guards and target lookup. The local backend uses a
 * realpath-like string; a remote backend might use a workspace URI or file id.
 * Consumers MUST NOT parse it or assume it is a local absolute path.
 */
type FsTargetKey = Branded<'FsTargetKey'>
```

```ts type-equiv
/**
 * Opaque file-version token — the freshness token a write/edit guards against.
 * The local backend derives it from high-resolution stat identity and freshness
 * fields; a remote backend might use a revision id. The policy layer records it
 * for stale checks; consumers may display related metadata but MUST NOT
 * interpret this token.
 */
type FsVersion = Branded<'FsVersion'>
```

`stat`은 콘텐츠가 아닌 메타데이터를 반환하며, 대상이 없으면 `undefined`을 반환합니다. `type`을 사용하면 소비자는 읽기 전에 디렉터리와 특수 파일을 거부할 수 있고, `size`을 사용하면 텍스트 소비자는 실패를 통해 탐색하지 않고 `readText`과 `streamText` 중에서 선택할 수 있습니다. 텍스트 소비자는 `streamText`을 소비하는 동안 자체 보존 한도를 적용합니다. 원시 바이트 소비자는 `readBytes(target, signal, maxBytes)`을 사용합니다. 필요한 완전 콘텐츠 상한은 알려졌거나 발견된 초과가 잘리거나 제한 없이 버퍼링되는 대신 `FS_TOO_LARGE`으로 실패하게 합니다.

```ts type-equiv
/**
 * Metadata about a target — what {@link FileSystem.stat} returns. Lets the
 * policy layer reject directories/special files before reading and choose
 * `readText` vs `streamText` from `size` without probing by failure. `version`
 * is the freshness token. `undefined` from `stat` means the target is absent.
 */
interface FsInfo {
  /** Opaque freshness token of the target right now. */
  version: FsVersion
  /** Whether the target is a regular file, a directory, or something else. */
  type: 'file' | 'directory' | 'other'
  /** Byte size of a regular file, when the backend can report it. */
  size?: number
}
```

`lstat`은 경로 수준의 심볼릭 링크 미추적 메타데이터 기본 요소입니다. `resolve`은 안정적인 식별자를 만들기 위해 의도적으로 심볼릭 링크를 따르므로, `FsTarget` 대신 경로를 받습니다. 신뢰 경계 검사가 필요한 소비자는 해석하기 전에 먼저 `lstat`을 호출하고 `symlink`을 거부할 수 있습니다.

```ts type-equiv
/**
 * Metadata about a path without following the final path component when it is a
 * symbolic link. Unlike {@link FsInfo}, this path-level probe can report
 * `symlink` so consumers with trust-boundary rules can reject repository-owned
 * links before resolving a target.
 */
interface FsPathInfo {
  /** Opaque freshness token of the path entry right now. */
  version: FsVersion
  /** Whether the path entry is a regular file, directory, symlink, or other. */
  type: 'file' | 'directory' | 'symlink' | 'other'
  /** Byte size of the path entry, when the backend can report it. */
  size?: number
}
```

`listDir`은 안정적인 이름 순서로 직접 하위 항목을 반환합니다. 각 항목에는 하위 항목의 기본 이름, 유형, 해석된 대상 및 백엔드가 보고할 수 있는 경우 저비용 메타데이터가 포함됩니다. 파일 콘텐츠를 읽어서는 안 되므로 `size`은 일반 파일에만 사용되며 `version`은 메타데이터에서 파생됩니다. 손상되었거나 사라진 하위 항목은 메타데이터 없이 `other`으로 반환될 수 있습니다. 나열하거나 하위 메타데이터를 해석하는 중 발생하는 권한 또는 백엔드 I/O 실패는 전체 나열을 `FS_PERMISSION_DENIED` 또는 `FS_IO_ERROR`으로 실패시킵니다.

```ts type-equiv
/**
 * One direct child returned by {@link FileSystem.listDir}. Listing returns
 * metadata and resolved targets only; it must not read file contents.
 */
interface FsDirEntry {
  /** Basename of the child inside the listed directory. */
  name: string
  /** Whether the child is a regular file, a directory, or something else. */
  type: 'file' | 'directory' | 'other'
  /** Resolved child target for follow-up operations. */
  target: FsTarget
  /** Opaque freshness token when the backend can report metadata cheaply. */
  version?: FsVersion
  /** Byte size of a regular file, when the backend can report it. */
  size?: number
}
```

## 쓰기 및 편집 가드(공급자 계약)

`writeText`과 `editText`은 모두 버전 가드를 선택적으로 받습니다. 무조건적인(기본 공급자) 변경에는 생략하고, 보호하려면 제공합니다. `writeText`의 가드는 `FsWriteIntent`입니다. `createIfAbsent`은 없는 대상을 생성하고 `FS_NOT_OBSERVED`으로 기존 대상을 거부합니다. 게시 자체가 교체 불가여야 하므로 공급자의 초기 탐색 이후 나타난 대상도 포함됩니다. `replaceIfVersion`은 대상이 관찰된 버전으로 존재할 때만 교체하고, 그렇지 않으면 `FS_STALE_VERSION`입니다. `expected`을 생략하면 무조건 생성하거나 덮어씁니다. 유니온 자체에는 보호된 두 의도만 포함되며, “가드 없음”은 생략으로 표현되므로 쓰기와 편집 모두 동일한 선택적 `expected` 필드를 사용합니다.

```ts type-equiv
/**
 * Guarded write intent. `createIfAbsent` rejects an existing target with
 * `FS_NOT_OBSERVED`; `replaceIfVersion` rejects absence or mismatch with
 * `FS_STALE_VERSION`. Omitting the intent from `writeText` means unconditional
 * create-or-overwrite, not a third union arm.
 */
type FsWriteIntent =
  | { kind: 'createIfAbsent' }
  | { kind: 'replaceIfVersion'; version: FsVersion }
```

```ts type-equiv
/** Outcome of a full-file write. */
interface FsWriteOutcome {
  /** Whether the write created a new file or replaced an existing one. */
  operation: 'create' | 'update'
  /** Opaque version of the file after the write. */
  version: FsVersion
  /**
   * The file's content BEFORE the write, or `null` when the file did not exist
   * (a create) or the backend declined a contextual basis (for example, a
   * binary/non-UTF-8 prior file or either overwrite side reaching its exclusive limit).
   * LF-normalized storage text (the diff basis), never a diff — a consumer
   * computes the result-time contextual diff from `before`/`after` when
   * `before` is present, else falls back to a whole-file diff.
   */
  before: string | null
  /** The file's content AFTER the write, LF-normalized to share `before`'s diff basis. */
  after: string
}
```

`editText`은(는) 공급자 수준의 변경 작업이며, 다른 곳에서 `read`와 `write`을(를) 조합한 것이 아닙니다. 가드가 적용된 경우 리터럴 일치 전에 예상 버전을 검증하므로(따라서 오래된 편집은 최신 콘텐츠에 대한 일치 실패가 아니라 `FS_STALE_VERSION`을(를) 보고합니다), 가드가 없는 경우 현재 콘텐츠를 편집합니다. 어느 경우든 교체를 적용하고 원자적으로 기록합니다. 즉, 일치 확인, 줄 끝 처리, 오래된 상태 검사, 원자적 교체를 하나의 변경 작업 임계 구역 안에서 유지하며, 대상이 없으면 두 경로 모두에서 `FS_STALE_VERSION`을(를) 보고합니다.

```ts type-equiv
/** A literal-replacement edit request. */
interface FsEditRequest {
  /** Literal non-empty text to replace. Must match exactly (after line-ending normalization). */
  oldString: string
  /** Literal replacement text. An empty string deletes the matched text. */
  newString: string
  /** Replace every match instead of requiring exactly one. */
  replaceAll: boolean
}
```

```ts type-equiv
/** Outcome of a literal edit. */
interface FsEditOutcome {
  /** Opaque version of the file after the edit. */
  version: FsVersion
  /**
   * The file's content BEFORE the edit. Raw storage text (LF-normalized by the
   * backend), never a diff — a consumer computes the result-time contextual diff
   * (the applied hunk with context) from `before`/`after`.
   */
  before: string
  /** The file's content AFTER the edit. */
  after: string
}
```

## fs 정책 이벤트(공급자 계약 어휘)

`dsh-fs`은(는) 도구가 디스패치하고 정책 플러그인이 수신하는 세 가지 이벤트를 소유합니다. 따라서 이미터(`dsh-tool-fs`)와 리스너(`dsh-fs-observation-policy`)는 이미터가 정책 플러그인에 의존하지 않고도 공통 어휘를 공유합니다. 이 이벤트들은 `dsh-fs` 어휘와 불투명한 `object` 액터만 전달하며, 모델 지향 개념이나 에이전트/세션 소유자 구조는 포함하지 않습니다.

`fs/write-intent` 및 `fs/edit-intent`은(는) **단일 슬롯 결정 폭포**입니다. 도구는 각각에 대해 `undefined`(베어 공급자)을 반환하는 기본 thunk와 함께 디스패치하며, 리스너는 `next()`을(를) 호출하지 않고 완전히 결정합니다. 이 슬롯은 등록 순서상 먼저 등록된 항목이 이깁니다. 이를 소유하는 정책 플러그인은 강제된 불변 조건이 아니라 배포 규칙입니다. `fs/observed`은(는) `FsObservation`을(를) 전달하는 fire-and-forget 기록 이벤트입니다. 즉, 특정 버전에 존재하거나 부재가 확인된 상태입니다. 이 이벤트는 일반 `ctx.emit`로 디스패치됩니다. 도구가 emit을 보호하지 않으므로 리스너는 반드시 동기식이고 부수 효과 전용이어야 합니다. 예외를 던지는 리스너는 읽기 오류를 대체하거나, 변경 작업이 이미 성공한 후 도구의 `isError` 결과로 표시될 수 있습니다. 아래의 생성된 [Cordis 표면](#cordis-surface)은(는) 정확한 시그니처를 보여 줍니다.

```ts type-equiv
/**
 * One authoritative observation of a target. A present observation carries the
 * version used by guarded replacement; an absent observation authorizes only a
 * guarded create, never an edit.
 */
type FsObservation =
  | { readonly kind: 'present'; readonly version: FsVersion }
  | { readonly kind: 'absent' }
```

## 실행 컨텍스트(정책 플러그인)

정책 플러그인은 `fs/*` 이벤트가 전달하는 불투명한 `object` 액터를 좁혀 관찰된 상태 소유자를 도출할 수 있을 만큼의 실행 컨텍스트만 필요로 합니다. `ToolExecution`에는 필수 필드가 있으므로 `dsh-tool-fs`은(는) `dsh-fs-observation-policy`이(가) 도구, 에이전트 또는 세션 패키지를 가져오지 않도록 실행 객체를 액터로 전달합니다.

```ts type-equiv
/**
 * Minimal structural view of a tool execution the policy plugin needs to derive
 * an observed-state owner. `@deepseek-ai/dsh-tools`' `ToolExecution` contains
 * these fields, so the tool passes its `exec` straight through as the opaque
 * `object` actor on the `fs/*` events; this plugin narrows that actor to
 * `FsObservationActor` without importing `dsh-tools`, `dsh-agent`, or `dsh-session`.
 *
 * The owner is `agent.session` when present. It is treated as an opaque object
 * identity (a `WeakMap` key); this package never reads any of its fields.
 */
interface FsObservationActor {
  /** The agent on whose behalf the call runs, when there is one. */
  agent?: {
    /** The session that owns observed-file state, used as an opaque key. */
    session?: object
  }
}
```

## 읽기 결과(소비자 / 읽기 렌더링)

텍스트 읽기는 줄 범위, 바이트 상한, 백엔드 제한으로 제한됩니다. 바이트 상한에 도달한 후에도 `totalLines`이(가) 정확하게 유지되도록 추가 줄을 보관하지 않고 스캔을 계속합니다. 모델 지향 `read` 도구가 렌더링하는 결과는 순전히 표현용입니다. `full`/`partial` 뷰는 없습니다. 권한 부여는 최신성 기반이며(도구가 stat의 버전과 함께 현재 `fs/observed`을(를) 직접 emit함), 파일이 변경되지 않았다면 어떤 범위 읽기든 나중의 쓰기/편집을 승인할 수 있습니다. 메타데이터 누락은 도구가 `FS_NOT_FOUND`을(를) 반환하기 전에 부재 관찰을 emit하므로, 편집을 승인하지 않고도 이후 가드된 쓰기가 외부에서 삭제된 대상을 다시 생성할 수 있습니다. 읽기를 소유하는 실행자 `dsh-tool-fs`이(가) 읽기 범위 처리를 구현하고 이 결과를 구성하며, 정책 플러그인은 이를 수행하지 않습니다.

```ts type-equiv
/** Outcome of a bounded text read — what {@link formatReadOutput} renders. */
interface FileReadOutcome {
  /** 1-based first line requested. */
  offset: number
  /** Returned lines, already numbered. */
  lines: FileTextLine[]
  /** Exact total line count in the file. */
  totalLines: number
  /** Whether selected output hit the byte cap. */
  truncatedByBytes?: true
}
```

## 관찰된 파일 상태(정책 플러그인)

관찰 상태는 `dsh-fs-observation-policy` 플러그인 내부에 보관되는 `WeakMap<owner, Map<targetKey, FsObservation>>`입니다. 맵 항목이 없으면 미관찰 상태를 의미합니다. `{ kind: 'absent' }`은(는) `read` 또는 `str_replace_editor`의 `view`, `str_replace` 또는 `insert` 메타데이터 누락이 부재를 확인했음을 의미하고, `{ kind: 'present', version }`은(는) 읽기, 쓰기 또는 편집에서 해당 버전을 관찰했음을 의미합니다. 쓰기 결정은 미관찰 및 부재 상태를 `createIfAbsent`에 매핑하고, 현재 상태는 `replaceIfVersion`에 매핑합니다. 편집 결정은 미관찰 상태를 `FS_NOT_OBSERVED`에, 부재 상태를 `FS_NOT_FOUND`에, 현재 상태를 해당 버전 가드에 매핑합니다. 소유자는 이벤트 액터(일반적으로 `exec.agent.session`)에서 도출되며, 불투명하게 취급하고 절대 읽지 않습니다. 폐기하면 모든 항목이 삭제되며(HMR 안전성), 정책은 파일 시스템 I/O를 수행하지 않습니다.

## 오류 분류(공급자 계약)

파일 시스템 실패는 `FsError`(`HarnessError`)이(가) 전달하는 안정적인 `FsErrorCode` 문자열을 사용합니다. 도구 레지스트리는 오류 결과에서 `{ name, code }`을(를) 보존하므로, 재시도, 권한 및 UI 계층은 텍스트를 파싱하지 않고 분기할 수 있습니다.

```ts type-equiv
/**
 * Stable, machine-routable codes for filesystem failures. Carried on
 * {@link FsError}; the tool registry exposes `{ name, code }` on `isError`
 * results so retry/permission/UI layers can branch without parsing messages.
 */
type FsErrorCode =
  | 'FS_NOT_FOUND'
  | 'FS_NOT_DIRECTORY'
  | 'FS_NOT_TEXT'
  | 'FS_NOT_REGULAR_FILE'
  | 'FS_TOO_LARGE'
  | 'FS_PERMISSION_DENIED'
  | 'FS_SANDBOX_DENIED'
  | 'FS_IO_ERROR'
  | 'FS_STALE_VERSION'
  | 'FS_NOT_OBSERVED'
  | 'FS_AMBIGUOUS_EDIT'
  | 'FS_EDIT_NOT_FOUND'
  | 'FS_ABORTED'
```

`FS_NOT_DIRECTORY`, `FS_PERMISSION_DENIED` 및 `FS_IO_ERROR`는 디렉터리 목록 조회에서 기존의 디렉터리가 아닌 대상, 거부된 목록 조회, 예기치 않은 백엔드 I/O 실패를 구분하는 데 사용됩니다. `FS_SANDBOX_DENIED`는 샌드박스 강제 백엔드(`dsh-fs-sandbox`)의 POLICY 거부입니다. 즉, 모드 펜스가 쓰기/편집을 거부한 것이며, 호스트 커널이 거부하는 `FS_PERMISSION_DENIED`와는 구별됩니다. `FS_NOT_OBSERVED`는 정책 플러그인에 이 소유자의 이전 관찰 기록이 없음을 의미합니다(또는 `createIfAbsent`가 기존 파일에 적용되었습니다). `FS_NOT_FOUND`도 확인된 부재 상태에서 거부된 편집을 나타냅니다. `FS_STALE_VERSION`는 백엔드 버전이 관찰된 버전과 더 이상 일치하지 않음을 의미합니다(또는 제공자 자체가 없는 대상에 대한 편집을 받는 경우입니다). 최신성 권한 부여에는 부분/전체 구분이 없으므로 `FS_PARTIAL_OBSERVATION`도 없습니다.

## 파일 I/O에는 타임아웃이 없음

`read`/`write`/`edit`는 **없음** `timeoutMs`을 사용하며, 제공자 계약은 bash 및 web([`@deepseek-ai/dsh-timeout`](../../packages/util/timeout/README.md)을 소비함), 그리고 선언된 `timeoutMs`가 `@deepseek-ai/dsh-tool-call-timeout-policy`에 의해 강제되는 하위 프로세스 기반 `glob`/`grep`와 달리 마감 시간을 설정하지 않습니다. 이들은 프로세스 기반이므로 마감 시간이 실제로 작업을 종료할 수 있습니다. 로컬 시스템 호출은 기껏해야 최선 노력으로 중단할 수 있습니다. 타임아웃은 진행 중인 `fsync`/`rename`를 강제로 멈출 수 없으므로, 여기의 `timeoutMs`는 추상 경계가 강제할 수 없는 마감 시간이자 명시적 설정 우선 원칙이 암시적 설정을 금지하는 바로 그 위치의 암시적 기본값이 됩니다. 취소는 여전히 시스템 호출 경계에서 최선 노력 중단을 위해 도구 실행 신호를 통해 전파됩니다.

## 서비스와 플러그인

`FileSystem`(`ctx.fs`, 추상)는 제공자 기본 요소를 소유합니다. 즉, `resolve`, `processPath`, `fileUrl`, `contains`, `stat`, `lstat`, `readText`, `streamText`, `readBytes`, `listDir`, `writeText` 및 `editText`입니다. `dsh-fs-observation-policy`는 **서비스를 등록하지 않습니다** . 대신 `fs/*` 이벤트 게이트를 통해 정책을 추가하는 플러그인입니다. unseen/absent/present 상태로부터 쓰기/편집 의도 워터폴을 결정하고 `FsObservation` 값을 기록합니다. 실행자는 `dsh-tool-fs`입니다. 이는 `ctx.fs`를 통해 reads/writes/edits하고, 워터폴을 디스패치하며, 기록 이벤트를 내보냅니다. 아래의 생성된 [`ctx.fs` 섹션](#ctxfs--filesystem-abstract-seam)에서 정확한 시그니처를 확인할 수 있습니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`에서 소스로부터 생성되었습니다(문서 동기화에서 `pnpm run verify-cordis-catalog`로 최신 상태가 검증되며, `pnpm run gen-cordis-catalog`로 다시 생성할 수 있음). 이 섹션은 페이지의 두 언어 버전에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxfs--filesystem-abstract-seam"></a>

### `ctx.fs` — `FileSystem`(추상 경계)

추상 파일 시스템 제공자입니다. 대상은 별칭 전반에서 식별성을 유지해야 합니다. 읽기는 일반 UTF-8 텍스트 또는 형식화된 오류를 노출하고, 목록 조회는 안정적이며 콘텐츠를 포함하지 않고, 변경은 원자적입니다. 선택적 가드는 보호되지 않은 제공자 계약을 변경하지 않고 오래된 상태에 대한 보호를 추가합니다.

```ts cordis-catalog
/**
 * Resolve a model/plugin-supplied path into a stable {@link FsTarget}. May perform I/O (a
 * remote/sandboxed backend may need a round-trip to map a path to a stable identity), hence
 * async even though the local backend only normalizes + realpaths.
 *
 * @param path - the path to resolve; relative paths resolve against `opts.cwd`.
 * @param opts - optional cwd override and cancellation signal.
 * @returns the stable target; the same file yields the same `targetKey`.
 */
abstract resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>

/**
 * Return the canonical absolute path a subprocess in this filesystem's
 * execution world can open. The path is deliberately separate from
 * {@link FsTarget.targetKey}: consumers may pass this value to another OS
 * capability, but must continue treating the target key as opaque.
 * @param target - the resolved target whose process path is required.
 * @returns an absolute path in the backend's execution world.
 */
abstract processPath(target: FsTarget): string

/**
 * Return the canonical `file:` URI for a target in this filesystem's
 * execution world. Backends own URI encoding because the host platform may
 * differ from the execution platform.
 * @param target - the resolved target to encode.
 * @returns the target's canonical file URI.
 */
abstract fileUrl(target: FsTarget): string

/**
 * Test canonical containment without exposing or parsing backend target
 * keys. Both targets must come from this provider.
 * @param parent - canonical directory target.
 * @param child - canonical candidate target.
 * @returns true when `child` is `parent` or a descendant of it.
 */
abstract contains(parent: FsTarget, child: FsTarget): boolean

/**
 * Return target metadata, or `undefined` when the target does not exist.
 * @param target - the resolved target to stat.
 * @param signal - aborts the metadata round-trip.
 * @returns metadata only, never content; undefined for an absent target.
 */
abstract stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>

/**
 * Return path metadata without following the final path component when it is a
 * symbolic link. This is intentionally path-shaped, not target-shaped:
 * {@link resolve} follows symlinks to produce the stable identity used by
 * normal reads/writes, while `lstat` lets a consumer reject the path itself
 * before that follow happens.
 *
 * `opts.cwd` follows {@link resolve}'s cwd rules. `undefined` means the path is
 * absent.
 * @param path - the path to inspect; relative paths resolve against `opts.cwd`.
 * @param opts - `cwd` overrides the backend's default base for relative paths.
 * @param signal - aborts the metadata round-trip.
 * @returns metadata only, never content; undefined for an absent path.
 */
abstract lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined>

/**
 * Read the whole regular text file as a single decoded string.
 * @param target - the resolved target to read.
 * @param signal - aborts the read.
 * @returns the full decoded UTF-8 content.
 */
abstract readText(target: FsTarget, signal?: AbortSignal): Promise<string>

/**
 * Stream the whole regular text file as decoded text chunks (same text
 * semantics as {@link readText}, for large files). The backend owns
 * cross-chunk UTF-8 decoding and binary rejection so the policy layer never
 * touches raw bytes.
 * @param target - the resolved target to read.
 * @param signal - aborts the stream, including between chunks.
 * @returns the chunk iterable, decoded and validated like {@link readText}.
 */
abstract streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>

/**
 * Read the whole regular file as raw bytes with no decoding or binary
 * rejection. The bound lives at this seam so a backend can never buffer an
 * unbounded file: a target known or discovered to exceed `maxBytes` fails
 * with `FS_TOO_LARGE` instead of returning a truncated result.
 * @param target - the resolved target to read.
 * @param signal - aborts the read.
 * @param maxBytes - inclusive byte cap on the complete content.
 * @returns the full raw content, at most `maxBytes` long.
 */
abstract readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>

/**
 * List direct children of a directory in stable name order. Returns resolved
 * child targets plus cheap metadata only; never reads file contents.
 * @param target - the resolved directory target.
 * @param signal - aborts the listing.
 * @returns one entry per direct child, in stable name order.
 */
abstract listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>

/**
 * Atomically create or replace UTF-8 text. `expected` guards intent and
 * staleness; omission allows unconditional overwrite.
 * @param target - the resolved target to write.
 * @param content - the full new file content.
 * @param expected - the write intent guarding the write; omit for unconditional.
 * @param signal - aborts before atomic publication takes effect.
 * @param sandboxPolicy - the per-call mode and workspace root this write
 *   runs under; a sandboxing backend fences the write by it, the bare backend
 *   ignores it. Omit to leave the backend its own default.
 * @returns the outcome, including the version the write produced.
 */
abstract writeText( target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy, ): Promise<FsWriteOutcome>

/**
 * Atomically edit literal text. When supplied, the version guard is checked
 * before matching so stale content reports `FS_STALE_VERSION`; omission edits
 * the current content without a freshness precondition.
 * @param target - the resolved target to edit.
 * @param edit - the literal search/replace request.
 * @param expected - the version guard; omit for an unconditional edit.
 * @param signal - aborts before atomic publication takes effect.
 * @param sandboxPolicy - the per-call mode and workspace root this edit runs
 *   under; a sandboxing backend fences the edit by it, the bare backend
 *   ignores it. Omit to leave the backend its own default.
 * @returns the outcome, including the version the edit produced.
 */
abstract editText( target: FsTarget, edit: FsEditRequest, expected?: { version: FsVersion }, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy, ): Promise<FsEditOutcome>
```

유형: [SandboxExecutionPolicy](sandbox.md)

소스: [`packages/fs/fs/src/index.ts:86`](../../packages/fs/fs/src/index.ts)

<a id="fs-events"></a>

### `fs/*` 이벤트

<a id="fsedit-intent--waterfall"></a>

#### `fs/edit-intent` — 워터폴

다음 FileSystem.editText에 대한 단일 슬롯 결정입니다. `next()`를 호출하면 무조건적인 편집이 실행되며, 처음 반환된 가드가 적용됩니다.

```ts cordis-catalog
/**
 * Single-slot decision for the next {@link FileSystem.editText}. Calling
 * `next()` yields an unconditional edit; the first returned guard wins.
 * @param target - the resolved target about to be edited.
 * @param actor - the opaque tool-execution context the decider keys off.
 * @mode waterfall
 */
'fs/edit-intent'(target: FsTarget, actor: object | undefined, next: () => { version: FsVersion } | undefined | Promise<{ version: FsVersion } | undefined>): Promise<{ version: FsVersion } | undefined>
```

소스: [`packages/fs/fs/src/index.ts:66`](../../packages/fs/fs/src/index.ts)

<a id="fsobserved--emit"></a>

#### `fs/observed` — 발생

권한 있는 긍정 또는 부정 관찰 결과를 기록합니다. 리스너는 동기식 기록기여야 합니다. 예외가 발생하면 도구 호출이 실패하고, 반환된 Promise는 대기하지 않습니다.

```ts cordis-catalog
/**
 * Record an authoritative positive or negative observation. Listeners must
 * be synchronous recorders: throws fail the tool call and returned promises
 * are not awaited.
 * @param target - the target whose presence or absence was observed.
 * @param observation - present with its version, or confirmed absent.
 * @param actor - the observing tool-execution context; undefined records nothing useful.
 * @mode emit
 */
'fs/observed'(target: FsTarget, observation: FsObservation, actor: object | undefined): void
```

소스: [`packages/fs/fs/src/index.ts:76`](../../packages/fs/fs/src/index.ts)

<a id="fswrite-intent--waterfall"></a>

#### `fs/write-intent` — 워터폴

다음 FileSystem.writeText에 대한 단일 슬롯 결정입니다. `next()`를 호출하면 기본 제공자의 무조건적인 쓰기가 실행됩니다. intent를 반환하는 첫 번째 리스너가 동료 리스너와 결합하는 대신 결정을 소유합니다.

```ts cordis-catalog
/**
 * Single-slot decision for the next {@link FileSystem.writeText}. Calling
 * `next()` yields the bare provider's unconditional write; the first listener
 * that returns an intent owns the decision rather than composing with peers.
 * @param target - the resolved target about to be written.
 * @param actor - the opaque tool-execution context the decider keys off.
 * @mode waterfall
 */
'fs/write-intent'(target: FsTarget, actor: object | undefined, next: () => FsWriteIntent | undefined | Promise<FsWriteIntent | undefined>): Promise<FsWriteIntent | undefined>
```

소스: [`packages/fs/fs/src/index.ts:58`](../../packages/fs/fs/src/index.ts)
<!-- END GENERATED cordis-surface -->
