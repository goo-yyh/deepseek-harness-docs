# LSP 탐색

LSP 심은 패키지 전반에 분리된 하나의 `ctx.lsp` 서비스에서 의미론적 코드 탐색을 노출하는 [기능 심](../../.agents/notes/implemented/architecture/2026-07-15-lsp-capability-seam.md)입니다. 서비스 정의([dsh-lsp](../../packages/lsp/lsp), `ctx.lsp` 및 제공자 레지스트리), 일반적인 서비스 제공자([dsh-lsp-stdio](../../packages/lsp/lsp-stdio), 구성된 stdio 언어 서버 호스트), 소비자([dsh-tool-lsp](../../packages/lsp/tool-lsp), `lsp` 도구 스키마)로 구성됩니다. LSP는 에이전트 루프의 중추가 아닌 **선택적 기능 하나**이므로, 관련 용어는 [core.md](core.md)가 아니라 여기에 있습니다. 제공자를 교체해도 모델이 탐색을 요청하는 방식은 바뀌지 않습니다.

출처: [`packages/lsp/lsp/src/types.ts`](../../packages/lsp/lsp/src/types.ts)

## 연산 및 좌표

심과 모델은 정확히 네 가지 의미론적 쿼리를 노출합니다. 합집합은 폐쇄되어 있으므로 하나를 추가하면 심, 제공자, 도구 전반에서 컴파일이 강제되는 변경이 됩니다. 위치와 범위는 프로토콜에 맞춰 0부터 시작하는 UTF-16을 사용하며, 모델 대면 도구는 1부터 시작하는 커서 규칙을 소유하고 입출력 시 변환합니다.

```ts type-equiv
/**
 * The four semantic queries the seam and model expose. A closed union: adding an operation is a
 * compile-enforced change across the seam, providers, and the tool. Symbols and call hierarchy are
 * not operations here; they need different schemas.
 */
type LspOperation = 'goToDefinition' | 'findReferences' | 'goToImplementation' | 'hover'
```

```ts type-equiv
/** A zero-based UTF-16 cursor coordinate, matching the LSP wire convention. */
interface LspPosition {
  /** Zero-based line. */
  readonly line: number
  /** Zero-based UTF-16 code-unit offset within the line. */
  readonly character: number
}
```

```ts type-equiv
/** A zero-based UTF-16 half-open range `[start, end)`. */
interface LspRange {
  readonly start: LspPosition
  readonly end: LspPosition
}
```

## 요청

모든 필드는 필수입니다. `workspaceRoot`는 호출자가 제공하고, `languageId`는 요청이 아니라 제공자 등록에서 가져오며, 소비자는 시간 제한과 결과 제한을 소유합니다. 따라서 어떤 필드도 구현 시 기본값을 지정할 필요가 없고 `resolve()` 단계도 없습니다. 제공자는 호출자의 요청과 파생된 `languageId`를 함께 수신합니다. 이는 일시적인 문서만 동기화하며 선택에는 전혀 관여하지 않습니다.

```ts type-equiv
/**
 * A caller's normalized query. Every field is required: `workspaceRoot` is caller-supplied,
 * `languageId` comes from the provider registration (not here), and consumers own timeouts and
 * result limits — so no field needs implementation defaulting and there is no `resolve()` step.
 */
interface LspQueryRequest {
  /** Which semantic query to run. */
  readonly operation: LspOperation
  /** The source file to query (relative to `workspaceRoot` or absolute; the provider canonicalizes). */
  readonly filePath: string
  /** The zero-based UTF-16 cursor position to query at. */
  readonly position: LspPosition
  /** The workspace root the provider resolves against and indexes; required, never defaulted. */
  readonly workspaceRoot: string
}
```

```ts type-equiv
/**
 * A request as a provider receives it: the caller's {@link LspQueryRequest} plus the `languageId`
 * the seam derived from the provider's extension mapping. The language id only synchronizes the
 * transient document; it does not participate in selection.
 */
interface LspProviderQuery extends LspQueryRequest {
  /** The LSP language id for `filePath`, from this provider's extension mapping. */
  readonly languageId: string
}
```

## 결과

폐쇄된 판별 유니온입니다. 탐색 연산은 `locations`로 정규화되고, `hover`는 콘텐츠 또는 `null`로 정규화됩니다. 소비자는 `kind`에서 `switch`를 사용해 철저성을 보장하므로, 새 분기가 추가되면 처리할 때까지 컴파일이 중단됩니다. `findReferences`에는 항상 선언이 포함됩니다. 제공자가 이를 내부적으로 강제하므로 호출자에게는 플래그가 없습니다. `locations` 변형은 제공자의 정식 워크스페이스 `file:` URI인 `resolvedWorkspaceUri`를 전달합니다. 위치 URI를 상대화하는 호출자는 심볼릭 링크일 수 있는 요청 루트에 호스트 플랫폼 경로 규칙을 적용하는 대신 이 좌표를 사용합니다.

```ts type-equiv
/** One resolved location: a document URI and the range within it. */
interface LspLocation {
  /** The target document URI (`file:` or otherwise), verbatim from the server. */
  readonly uri: string
  /** The range within the target document. */
  readonly range: LspRange
}
```

```ts type-equiv
/** Normalized hover content, or `null` for no hover at the position. */
interface LspHover {
  /** The normalized hover text (markdown or plaintext, provider-joined). */
  readonly contents: string
  /** The range the hover applies to, when the server supplied one. */
  readonly range?: LspRange
}
```

```ts type-equiv
/**
 * The closed result union. Navigation operations (`goToDefinition`, `findReferences`,
 * `goToImplementation`) normalize to `locations`; `hover` normalizes to content or `null`.
 * Consumers `switch` on `kind` to exhaustiveness so a new arm breaks compilation until handled.
 *
 * The `locations` variant carries `resolvedWorkspaceUri`: the provider's canonical `file:` URI for
 * the request's workspace root. A caller that relativizes location URIs MUST use this, not parse the
 * request's possibly symlinked process path with host-platform rules; the execution platform may
 * differ from the caller's.
 */
type LspQueryResult =
  | { readonly kind: 'locations'; readonly locations: readonly LspLocation[]; readonly resolvedWorkspaceUri: string }
  | { readonly kind: 'hover'; readonly hover: LspHover | null }
```

## 제공자 및 서비스

제공자는 안정적인 브랜드 `id`와 배타적인 소문자 선행 점 확장자 맵을 소유합니다. `registerProvider`는 id와 모든 확장자를 원자적으로 예약합니다. 잘못되었거나 충돌하는 등록은 아무것도 게시하지 않으며, 해당 disposer는 모든 예약을 해제합니다. 선택은 쿼리별로 이루어지고 순서와 무관합니다. 일치 항목이 없으면 `LspError` `LSP_UNAVAILABLE`를 발생시킵니다. 이 심은 프로토콜 타입, 프로세스/문서 제어 또는 일반 JSON-RPC 이스케이프 해치를 노출하지 않습니다.

```ts type-equiv
/**
 * A language-server backend registered on `ctx.lsp`. Each provider owns a stable {@link
 * LspProviderId} and an extension-to-language-id map (lowercase, leading-dot keys).
 * `findReferences` always includes declarations — the provider enforces this internally; callers
 * get no flag.
 */
interface LspProvider {
  /** Stable provider identity, reserved atomically with the extension mappings. */
  readonly id: LspProviderId
  /** Lowercase leading-dot extension → LSP language id (e.g. `{ '.ts': 'typescript' }`). */
  readonly extensionToLanguage: Readonly<Record<string, string>>
  /**
   * Run one query. The seam has already selected this provider and derived `languageId`.
   * @param request - the resolved provider query (caller request + derived language id).
   * @param signal - optional cancellation; the provider stops its own work when it aborts.
   * @returns the normalized, closed-union result.
   */
  query(request: LspProviderQuery, signal?: AbortSignal): Promise<LspQueryResult>
}
```

```ts type-equiv
/**
 * The LSP capability seam (`ctx.lsp`). Owns provider registration/selection and normalized query
 * execution; exposes exactly the four operations and no protocol escape hatch.
 */
interface LspService {
  /**
   * Register a provider, atomically reserving its id and every normalized extension. Any conflict
   * or invalid input publishes nothing and throws `LspError`; the returned disposer releases all
   * reservations. Disposed with the calling fiber.
   * @param provider - the backend to register.
   * @returns a synchronous disposer releasing the id and all extension reservations.
   */
  registerProvider(provider: LspProvider): () => void
  /**
   * Select a provider by the file's extension and run one query. Selection is per-query and
   * order-independent; no match throws `LspError` `LSP_UNAVAILABLE`.
   * @param request - the normalized query.
   * @param signal - optional cancellation forwarded to the selected provider.
   * @returns the normalized, closed-union result.
   */
  query(request: LspQueryRequest, signal?: AbortSignal): Promise<LspQueryResult>
}
```

`LspProviderId`은(는) seam의 브랜드 ID입니다([dsh-brand](../../packages/util/brand)에서 가져온 `Branded<'LspProviderId'>`). `LspError`은(는) `HarnessError`을(를) 확장하며 `LSP_INVALID_PROVIDER`, `LSP_CONFLICT`, `LSP_UNAVAILABLE`, `LSP_DISPOSED`, `LSP_UNSUPPORTED_OPERATION`, `LSP_MALFORMED_RESPONSE` 같은 안정적인 코드를 제공합니다. 호출자는 `message`을(를) 파싱하는 대신 이 코드를 기준으로 라우팅합니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`에 의해 소스에서 생성됩니다(doc-sync에서 `pnpm run verify-cordis-catalog`으로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`으로 다시 생성합니다). 이 섹션은 페이지의 두 언어 버전에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문](../cordis-primer.md#dispatch-modes)에서 정의하며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxlsp--lspservice"></a>

### `ctx.lsp` — `LspService`

LSP 기능 seam(`ctx.lsp`)입니다. Provider 등록 및 선택과 정규화된 쿼리 실행을 담당하며, 정확히 네 가지 작업만 노출하고 프로토콜 우회 경로는 제공하지 않습니다.

```ts cordis-catalog
/**
 * Register a provider, atomically reserving its id and every normalized extension. Any conflict
 * or invalid input publishes nothing and throws `LspError`; the returned disposer releases all
 * reservations. Disposed with the calling fiber.
 * @param provider - the backend to register.
 * @returns a synchronous disposer releasing the id and all extension reservations.
 */
registerProvider(provider: LspProvider): () => void

/**
 * Select a provider by the file's extension and run one query. Selection is per-query and
 * order-independent; no match throws `LspError` `LSP_UNAVAILABLE`.
 * @param request - the normalized query.
 * @param signal - optional cancellation forwarded to the selected provider.
 * @returns the normalized, closed-union result.
 */
query(request: LspQueryRequest, signal?: AbortSignal): Promise<LspQueryResult>
```

소스: [`packages/lsp/lsp/src/types.ts:113`](../../packages/lsp/lsp/src/types.ts)
<!-- END GENERATED cordis-surface -->
