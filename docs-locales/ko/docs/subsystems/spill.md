# Spill 저장소

도구의 대용량 텍스트를 영속화하고 모델용 로케이터와 검색 안내를 반환하는 spill 저장소 이음새 — [기능 이음새](../../.agents/notes/implemented/architecture/2026-07-08-tool-output-spill-files.md) — 는 다음 패키지로 나뉩니다. 서비스 정의(서비스 정의)([dsh-spill](../../packages/spill/spill), `ctx.spillStore`), 서비스 제공자(서비스 제공자)([dsh-spill-local](../../packages/spill/spill-local), 호스트 파일 시스템의 비공개 세션 범위 파일), 소비자(소비자)([dsh-spill-policy](../../packages/spill/spill-policy), `tools/post-execute` 정책)입니다. Spill은 에이전트 루프의 중심부가 아닌 **선택적 기능 하나**이므로, 그 용어는 [core.md](core.md)가 아니라 여기에 있습니다. 미리 보기 메커니즘은 [dsh-output-retention](../../packages/util/output-retention)에 있으며, 이 이음새는 정책이 전달한 최종 텍스트만 저장합니다.

출처: [`packages/spill/spill/src/types.ts`](../../packages/spill/spill/src/types.ts)

## 저장 요청

`saveText`는 유일한 서비스 작업입니다. `content`를 원문 그대로 영속화하고, 불투명 로케이터, 백엔드 제공 검색 힌트, 정확한 바이트 수를 반환합니다. 요청에는 저장 시점의 저장소 네임스페이스(`owner`), 이를 생성한 도구와 호출(`source`, 이름 지정과 검사에 사용되며 접근 제어에는 사용되지 않음), 그리고 백엔드가 이름 지정 힌트로 사용할 수 있는 `suggestedName`(경로가 아님)가 포함됩니다.

```ts type-equiv
/** One request to persist text to a spill artifact. */
interface SaveTextSpill {
  owner: SpillOwner
  source: SpillSource
  /**
   * A caller-suggested base name (e.g. `web_fetch.txt`). The backend sanitizes
   * it to a single safe path segment before use — it is a hint, never a path.
   */
  suggestedName: string
  /** The full text to persist (UTF-8). */
  content: string
}
```

```ts type-equiv
/**
 * Save-time storage namespace for a spilled artifact. The session id lets a
 * backend group storage under the producing session, but the returned
 * {@link SpillLocator} is the model-facing handle. Forked sessions inherit
 * locators already present in the seeded log; those artifacts are not copied or
 * re-owned, and spills produced after the fork use the child session id.
 */
interface SpillOwner {
  sessionId: SessionId
}
```

`SpillOwner.sessionId`는 저장 시점의 저장소 네임스페이스입니다. 포크된 세션은 시드 로그에 있는 기존 spill 로케이터를 상속합니다. 이러한 아티팩트는 복사되거나 소유권이 다시 할당되지 않으며, 포크 이후 생성된 spill은 자식 세션 ID를 사용합니다. 보존 기간 정리는 다른 오래된 세션 아티팩트와 함께 오래된 로케이터를 만료시킬 수 있습니다. spill 이음새는 세션별 정리 정책을 정의하지 않습니다.

```ts type-equiv
/**
 * Tool and call that produced one spilled artifact — recorded by the backend for a readable
 * filename and inspection. Not interpreted for access control; purely
 * descriptive.
 */
interface SpillSource {
  /** The tool whose result was spilled (e.g. `web_fetch`). */
  toolName: string
  /** The model-issued call id the result belongs to. */
  callId: CallId
  /** A short human label for the artifact (e.g. `result`). */
  label: string
}
```

## 결과

```ts type-equiv
/** A saved spill artifact: its locator, byte length, and backend-specific retrieval guidance. */
interface SpillRef {
  locator: SpillLocator
  bytes: number
  retrievalHint: string
}
```

`SpillLocator`는 백엔드가 반환하는 [브랜드화된](core.md#branded-ids) 모델용 핸들입니다. 로컬 백엔드는 이를 파일 시스템 경로로 렌더링하며, 원격 또는 데이터베이스 백엔드는 URI, 키 또는 명령 토큰으로 렌더링할 수 있습니다. 소비자는 이를 불투명한 값으로 취급하고 `read`가 항상 올바른 검색 메커니즘이라고 가정하는 대신 `retrievalHint`로 렌더링합니다.

```ts type-equiv
/**
 * Opaque model-facing handle for one spilled artifact. A local backend may use a
 * filesystem path; a remote or database backend may use a URI or key. Consumers
 * render it with {@link SpillRef.retrievalHint}, but do not parse it.
 */
type SpillLocator = Branded<'SpillLocator'>
```

## 서비스

`SpillStore`(`ctx.spillStore`, [`packages/spill/spill/src/index.ts`](../../packages/spill/spill/src/index.ts)에 정의됨)는 단일 메서드 추상 서비스입니다. `saveText(input) → Promise<SpillRef>`입니다. 이는 전체 `content`를 영속화하며 실제 저장소 실패(권한, ENOSPC, 백엔드 사용 불가) 시 REJECTS합니다. 이 이음새는 저장소만 담당합니다. 보존 정책, 도구 결과 대체, 검색 API는 포함하지 않습니다.

로컬 백엔드([dsh-spill-local](../../packages/spill/spill-local))는 `<root>/session-<hash>/<random>-<safeName>` 아래에 기록합니다. 이는 구성되었거나 지연 생성된 비공개(0700) 루트, `sha256(sessionId)` 세션 하위 디렉터리, 그리고 삽입된 심볼릭 링크가 리디렉션하지 못하도록 하는 배타적 소유자 전용(`open(path, 'wx', 0o600)`) 쓰기로 구성됩니다. 해당 `locator`는 로컬 경로이고, `retrievalHint`는 모델에 그 경로에서 `read` 또는 `grep`를 사용하도록 안내합니다. 정책 소비자([dsh-spill-policy](../../packages/spill/spill-policy))는 `maxInlineBytes`를 초과하는 일반 텍스트 최종 결과를 보존 라이브러리의 head/tail 미리 보기와 spill 참조로 대체합니다. 이는 최선의 노력으로 수행되며, 저장 실패 시 성공한 호출이 `isError`로 바뀌는 대신 원래 인라인 결과를 유지합니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`가 소스에서 생성했습니다(문서 동기화에서 `pnpm run verify-cordis-catalog`로 최신 상태를 확인하며, `pnpm run gen-cordis-catalog`로 다시 생성합니다). 이 섹션은 페이지의 두 언어 버전에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxspillstore--spillstore-abstract-seam"></a>

### `ctx.spillStore` — `SpillStore`(추상 이음새)

추상 spill 저장소 서비스입니다. 하위 클래스를 만들고 saveText를 구현한 다음 하위 클래스를 플러그인으로 로드하면 `ctx.spillStore`로 등록됩니다(컨텍스트당 구현 하나이며, 두 번째를 로드하면 cordis의 표준 중복 서비스 동작에 따라 예외가 발생함).

모든 구현이 준수해야 하는 의미론은 다음과 같습니다.

- saveText는 전체 `content`를 원문 그대로 영속화하고 불투명 로케이터, 정확한 바이트 길이, 모델용 검색 안내를 반환합니다.
- 저장소는 요청의 SaveTextSpill.owner 세션 범위로 지정됩니다. 백엔드는 호출자의 `suggestedName`에서 파생되지만 절대 동일하지는 않은 충돌 없는 이름과 비공개(전 세계에서 읽을 수 없는) 위치를 선택합니다.
- `saveText`는 실제 저장소 실패(권한, ENOSPC, 백엔드 사용 불가) 시 REJECTS합니다. 호출자는 성능 저하 방식을 결정하며(spill 정책은 거부를 최선의 노력으로 처리하고 인라인 결과를 유지함) 이를 처리합니다.

```ts cordis-catalog
/**
 * Persist `input.content` to a session-scoped spill artifact.
 * @param input - the owner, caller-supplied source fields, suggested name, and full text to save.
 * @returns the saved artifact's {@link SpillRef}; rejects on a storage failure.
 */
abstract saveText(input: SaveTextSpill): Promise<SpillRef>
```

출처: [`packages/spill/spill/src/index.ts:45`](../../packages/spill/spill/src/index.ts)
<!-- END GENERATED cordis-surface -->
