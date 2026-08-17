# 워크스페이스

워크스페이스는 사용자가 작업하는 디렉터리의 영속적 기록입니다. 즉, 정규 경로에 대한 안정적인 id, 표시 제목, 그리고 여기에 속하는 세션의 순서가 있는 목록으로 구성됩니다. 이 하위 시스템은 하나의 패키지([dsh-workspace](../../packages/workspace/workspace), `ctx.workspaceRegistry`)이며, 에이전트 루프 핵심부에 속하지 않고 모델에는 보이지 않는(도구, 프롬프트 텍스트, 세션 이벤트 없음) 선택적 호스트 측 기능입니다. 레코드는 [스토리지 도메인 형식](storage.md)을 통해 저장하고, 세션 멤버십은 [`SessionHeader.cwd`](persistence.md#sessionheader--metadata-beside-the-log)에 대해 검증하므로 `storageDomain` 및 `sessionPersistence`는 필수 시작 종속성입니다. 영속성 피어를 사용할 수 없으면 빈 기록으로 오인하지 않고 플러그인을 대기 상태로 둡니다. 설계 기록: [도메인 KV 스토리지 Agent Note](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md), 부트스트랩 및 GUI 순서: [워크스페이스 UI 제품 흐름 Agent Note](../../.agents/notes/implemented/feature/2026-07-25-workspace-ui-product-flow.md).

출처: [`packages/workspace/workspace/src/types.ts`](../../packages/workspace/workspace/src/types.ts)

## 식별자

```ts type-equiv
/**
 * Identifies one workspace record. A generated uuid, never the path: path
 * normalization rewrites paths, and a reference anchor must stay stable.
 */
type WorkspaceId = Branded<'WorkspaceId'>
```

`WorkspaceId`는 [브랜드 id](core.md#branded-ids)입니다. 경로 식별성은 별개입니다. `realpathNormalize`(`fs.realpath`, 후행 슬래시, `..` 및 심볼릭 링크를 해석함)가 유일한 고유성 기준입니다. 워크스페이스 경로는 정규화하여 저장되며, 고유성은 정규 경로의 문자열 동등성으로 판단합니다(소유 중인 디렉터리를 가리키는 심볼릭 링크는 충돌함). 연결 시 세션 cwd 검사도 같은 기준을 거칩니다.

## 워크스페이스 엔터티

소비자는 `Workspace` 인터페이스만 보며 구현은 패키지 비공개로 유지됩니다.

```ts type-equiv
/**
 * One workspace: a stable id over an existing directory, a display title, and
 * an ordered candidate account of sessions. Membership requires both an id in
 * that account and a session header whose canonical cwd equals the workspace
 * path. Consumers only see this interface; the implementation stays private.
 */
interface Workspace {
  /** Stable record id (generated uuid). */
  readonly id: WorkspaceId

  /**
   * Canonical directory path: the `fs.realpath` of the path given at create
   * time (trailing slashes, `..`, and symlinks all resolved). Never rewritten
   * afterwards, even when the directory disappears (see {@link status}).
   */
  readonly path: string

  /** Display title. Defaults to `basename(path)` at create; duplicates are allowed. */
  readonly title: string

  /** ISO-8601 creation instant, stamped at create and never rewritten. */
  readonly createdAt: string

  /** ISO-8601 instant of the last durable mutation (create counts as one). */
  readonly updatedAt: string

  /**
   * Header-validated sessions in manually owned order: a new session is
   * prepended at attach, explicit reordering goes through
   * `insertSessionBefore`, and activity never reorders. The durable candidate
   * account is filtered synchronously: missing headers, invalid cwd values,
   * and canonical cwd mismatches are never returned. A subsequent workspace
   * mutation prunes those filtered candidates durably.
   */
  readonly sessionIds: readonly SessionId[]

  /**
   * Replace the display title durably.
   * @param title - New title; any string, duplicates across workspaces allowed.
   * @returns resolution after durability.
   */
  setTitle(title: string): Promise<void>

  /**
   * Prepend a session to this workspace's candidate account. An already
   * accounted id resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs. A new id's
   * live or persisted
   * header cwd must resolve to an existing directory equal to {@link path};
   * unknown ids, missing or invalid cwd values, and mismatches reject without
   * writing.
   * @param sessionId - The session to record.
   * @returns resolution after durability.
   */
  attachSession(sessionId: SessionId): Promise<void>

  /**
   * Move an accounted session within the manual order, DOM-insertBefore-like:
   * with an anchor the session lands before it, without one it appends to the
   * end. Only the moved id changes position. A session or anchor absent from
   * the account rejects without writing; a move to the current position
   * resolves without writing, aside from the durable filtered-candidate
   * prune every accepted mutation performs; decided on the domain write
   * chain.
   * @param sessionId - The accounted session to move.
   * @param beforeSessionId - Accounted anchor to insert before; omitted appends.
   * @returns resolution after durability.
   */
  insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void>

  /**
   * Remove a session from this workspace's account. Idempotent: an id not on
   * the account resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs; decided on
   * the domain write chain like attach. Never touches the session's own stored log.
   * @param sessionId - The session to remove.
   * @returns resolution after durability.
   */
  detachSession(sessionId: SessionId): Promise<void>

  /**
   * Live directory check, uncached: whether {@link path} currently exists and
   * is a directory. A missing directory never mutates the record — the
   * directory may only be temporarily moved.
   * @returns `'ok'` when the directory exists, `'missing-dir'` otherwise.
   */
  status(): Promise<'ok' | 'missing-dir'>
}
```

소유권의 기준은 세션 cwd에서 파생하지 않는 레코드의 순서가 있는 `sessionIds`입니다. 그러나 멤버십에는 둘 다 필요합니다. 즉, 목록의 id와 정규 cwd가 워크스페이스 경로와 일치하는 헤더가 필요하므로 하나의 세션은 구조적으로 최대 하나의 워크스페이스에만 속합니다. 쓰기 실패는 거부됩니다(`insertSessionBefore` 목록 오류는 `WorkspaceMoveInvalidError`로, 스토리지 오류는 일반 오류로 처리). 허용된 모든 변경은 `updatedAt`를 기록하고 멤버십 검사를 더 이상 통과하지 못하는 후보를 영속적으로 제거합니다.

## 레지스트리: `ctx.workspaceRegistry`

`WorkspaceRegistry`([시그니처](#ctxworkspaceregistry--workspaceregistry))는 등록과 확인을 담당합니다. `create(path, title?)`는 경로를 정규화하고, 존재하지 않는 경로(원래의 `ENOENT`) 또는 디렉터리가 아닌 경로를 거부하며, 정규 경로가 이미 소유된 경우 기존 엔터티를 변경 없이 반환합니다. 그 외에는 `title ?? basename(path)`를 영속 레지스트리 순서의 앞에 추가한 레코드를 생성합니다. 새 레코드는 기존 표시 제목을 중복할 수 없습니다(`WorkspaceNameConflictError`). `get(id)` 및 순서가 있는 `list()`는 동기식 캐시 읽기이며, `resolveByPath(path)`는 생성하지 않고 동일한 realpath 기준을 적용합니다. `delete(id)`는 등록, 순서 항목 및 세션 목록만 제거합니다. 디렉터리, 사용자 파일, 활성 세션 및 영속 로그는 절대 건드리지 않으므로 해당 세션은 미그룹 상태가 됩니다([결정](../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.md)). 알 수 없는 id는 `false`를 반환합니다. 생성 및 삭제는 두 쓰기(레코드 + 순서)가 불일치하기 전에 보류 중인 변경 마커를 영속화합니다. 시작 시 정확히 표시된 변경을 해결합니다. 즉, 표시된 테이블 행을 삭제하여 중단된 삭제를 완료하고 중단된 생성을 롤백합니다(등록은 다시 만들 수 있으므로 롤백이 안전한 방향임). 표시되지 않은 순서/테이블 불일치는 손상으로 간주하여 명확하게 실패합니다.

세션은 이 레지스트리가 아니라 세션을 생성하는 주체로부터 생성 시점에 cwd를 가져옵니다. 즉, API 게이트웨이는 선택한 워크스페이스의 `path`에서 새 세션의 cwd를 확인하고(명시적 또는 기본 cwd로 대체), cwd가 불변의 [`SessionHeader`](persistence.md#sessionheader--metadata-beside-the-log)에 저장되도록 세션을 생성한 다음 `attachSession`를 호출합니다. 이 호출은 저장된 헤더 cwd를 워크스페이스 경로와 다시 검증합니다. 첫 번째 성공적인 시작 시 레지스트리는 영속된 헤더만으로 기록을 부트스트랩합니다(`id`, `cwd`, `createdAt` — 이벤트 본문은 사용하지 않음). 유효한 정규 cwd를 가진 세션을 디렉터리별 워크스페이스로 묶고 최신순으로 정렬합니다. 초기화 마커는 마지막에 기록되므로 중단된 부트스트랩도 안전하게 재개됩니다. 부트스트랩은 한 번만 수행됩니다. cwd가 없는 레거시 세션은 Ungrouped에 남고, 이후 생성되는 세션은 `attachSession`를 통해서만 워크스페이스에 참여합니다.

## 소비자

[dsh-host-apiproxy](../../packages/host/apiproxy)는 제품 소비자입니다. GUI 클라이언트에 `ctx.workspaceRegistry`를 통해 워크스페이스 CRUD를 제공하고 위의 세션 생성 후 연결 흐름을 수행합니다. 이름과 달리 [dsh-agent-instructions](../../packages/context/agent-instructions)는 **소비자가 아닙니다** . 에이전트 자체 cwd 아래에서 AGENTS.md 스타일의 지침 파일을 검색하며 `ctx.workspaceRegistry`에는 전혀 접근하지 않습니다. 여기서 공유되는 단어는 이 레지스트리의 엔터티가 아니라 사용자의 작업 디렉터리를 가리킵니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`에서 소스로부터 생성됩니다(doc-sync에서 `pnpm run verify-cordis-catalog`로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`로 다시 생성). 이 섹션은 페이지의 두 언어 측면에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하며 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있고, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxdirectorypicker--directorypicker-abstract-seam"></a>

### `ctx.directoryPicker` — `DirectoryPicker` (추상 접합부)

추상 디렉터리 선택 서비스입니다. 서브클래스를 만들고 `capability()`를 구현한 뒤 해당 서브클래스를 플러그인으로 로드하면 `ctx.directoryPicker`로 등록됩니다(컨텍스트당 구현 하나이며, 두 번째를 로드하면 Cordis의 표준 중복 서비스 동작에 따라 예외가 발생함). 기능 객체는 서비스 수명 동안 안정적이어야 합니다. 소비자가 호출 간에 이를 캡처할 수 있기 때문입니다.

```ts cordis-catalog
/**
 * The backend's interaction capability.
 * @returns the discriminated capability consumers switch on.
 */
abstract capability(): DirectoryPickerCapability
```

소스: [`packages/host/directory-picker/src/index.ts:131`](../../packages/host/directory-picker/src/index.ts)

<a id="ctxworkspaceregistry--workspaceregistry"></a>

### `ctx.workspaceRegistry` — `WorkspaceRegistry`

영속적인 워크스페이스 레지스트리입니다. 시작 시 `sessionPersistence`를 기다리고, 하나의 정규 cwd 헤더 인덱스를 구성하며, 서비스가 활성화되기 전에 일회성 기록 부트스트랩을 완료합니다. 영속성 종속성은 필수이므로 사용할 수 없는 피어가 빈 기록으로 잘못 간주되어 초기화 마커를 커밋하는 일이 없습니다.

```ts cordis-catalog
/**
 * Create or reuse a workspace for an existing directory. The path is
 * canonicalized through `fs.realpath`; a nonexistent path rejects with the
 * original error and a non-directory rejects. Repeated calls for the same
 * canonical path return the existing entity without changing its title.
 * A newly created workspace is prepended to the durable registry order.
 * Different canonical paths may share a display title.
 * @param path - Existing directory to own, in any path spelling.
 * @param title - Display title used only when a new record is created.
 * @returns the existing or newly durable workspace.
 */
async create(path: string, title?: string): Promise<Workspace>

/**
 * Look up a workspace by id.
 * @param id - Workspace id.
 * @returns the workspace, or `undefined` when unknown.
 */
get(id: WorkspaceId): Workspace | undefined

/**
 * Synchronous workspace projection in durable registry order. Every
 * entity's `sessionIds` getter is already filtered by the startup/live
 * canonical-cwd header index; this method performs no persistence reads.
 * @returns a fresh ordered array of workspace entities.
 */
list(): Workspace[]

/**
 * Delete one workspace registration while retaining its directory and every
 * session log. The durable order is updated before the table deletion; a
 * failed table write restores the prior order and keeps the entity
 * published. Unknown ids are an idempotent no-op for domain callers.
 * @param id - Workspace registration to remove.
 * @returns `true` when a record was deleted, `false` when it was unknown.
 */
delete(id: WorkspaceId): Promise<boolean>

/**
 * Move one workspace within the durable display order, DOM-insertBefore-like.
 * With an anchor it lands before that workspace; without one it appends.
 * @param id - Workspace to move.
 * @param beforeId - Workspace anchor; omitted appends.
 * @returns the complete committed workspace order.
 */
insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]>

/**
 * Archive one session durably. The session must exist (live or in session
 * persistence); its workspace accounting — or lack of one — is irrelevant.
 * An already archived id resolves without writing.
 * @param sessionId - The session to archive.
 * @returns resolution after durability.
 */
archiveSession(sessionId: SessionId): Promise<void>

/**
 * Resolve by canonical directory path without creating or mutating a
 * workspace. A missing path rejects during `realpath`; an existing unowned
 * directory returns `undefined`.
 * @param path - Existing directory path in any spelling.
 * @returns the workspace owning the canonical path, when one exists.
 */
async resolveByPath(path: string): Promise<Workspace | undefined>
```

유형: [SessionId](core.md)

소스: [`packages/workspace/workspace/src/index.ts:92`](../../packages/workspace/workspace/src/index.ts)
<!-- END GENERATED cordis-surface -->
