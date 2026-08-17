# 웹 액세스

웹 액세스 심은 하나의 [기능 경계](../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)이며, 단일 `ctx.web` service에서 **두 작업** (검색과 가져오기)을 수행하고, 패키지 전반에 걸쳐 분리됩니다. 서비스 정의([dsh-web](../../packages/web/web), `ctx.web` 및 제공자 레지스트리), 서비스 제공자([dsh-web-search-exa](../../packages/web/web-search-exa), [dsh-web-search-perplexity](../../packages/web/web-search-perplexity), [dsh-web-search-deepseek](../../packages/web/web-search-deepseek), [dsh-web-fetch-http](../../packages/web/web-fetch-http)), 그리고 소비자([dsh-tool-web](../../packages/web/tool-web), `web_search`/`web_fetch` 도구 스키마)입니다. Web은 **선택적 기능 하나**일 뿐 에이전트 루프의 핵심 축에 속하지 않으므로, 그 용어는 [core.md](core.md)가 아니라 여기에 있습니다. 검색 제공자를 교체해도 모델이 쿼리를 요청하는 방식은 바뀌지 않으며, 가져오기 제공자를 교체해도 모델이 URL을 요청하는 방식은 바뀌지 않습니다.

출처: [`packages/web/web/src/types.ts`](../../packages/web/web/src/types.ts)

## 하나의 기능에 두 작업이 있는 이유

검색과 가져오기는 요청 스키마와 비즈니스 로직을 공유하지 않지만, 의도적으로 하나의 `ctx.web` 중간 계층입니다. 즉, 제공자 선택 정책 소유자 하나, 중단/오류 용어 체계 하나, 그리고 제품 관점의 “이 Harness가 웹에 도달하는 방식” 설정 API 하나를 둡니다. 그 대가는 service의 병렬 `searchX`/`fetchX` 메서드 쌍이며, 이 병렬성은 의도된 것이지 추출을 놓친 것이 아닙니다. 제공자는 도구가 아니라 **기능** (`WebSearchProvider` 또는 `WebFetchProvider`)을 등록합니다. 모델 대상 이름, 스키마, 프롬프트 지침 및 표현은 모두 단일 `dsh-tool-web` 소비자에 있습니다.

## 검색 요청 및 결과

모델 대상 도구 인수는 단순히 `query`입니다. `maxResults`은 소비자 소유의 제한값(`dsh-tool-web`의 `searchMaxResults` 설정, 기본값 `8`)으로, 심을 통해 전달되고 반환 과정에서 적용됩니다. 제공자가 초과 반환하면 심이 `sources[]`을 잘라내고 `truncated`을 설정합니다.

```ts type-equiv
/**
 * What one search-capable backend can return. The model-facing argument is just
 * a query; `maxResults` is a `dsh-tool-web`-layer bound passed through unchanged
 * and enforced on the way back by the seam (see {@link WebSearchResult}).
 */
interface WebSearchRequest {
  readonly query: string
  /**
   * Upper bound on returned sources; the seam truncates to it. Omitted = no
   * bound. `dsh-tool-web` always sets it. A provider whose API supports a
   * result-count control (Exa's `numResults`) should apply it at the request
   * layer as a cost/latency optimization; the seam enforces the bound
   * regardless.
   */
  readonly maxResults?: number
}
```

```ts type-equiv
/**
 * Normalized search outcome. `content` is optional provider-generated answer
 * text or summary (Exa and DeepSeek return none; Perplexity returns a
 * generated answer).
 * `sources[]` is the portable citation shape. `truncated` is set by the seam
 * when it cut `sources[]` down to `maxResults`.
 */
interface WebSearchResult {
  /** Optional provider-generated answer text, search context, or summary. */
  readonly content?: string
  /** Citeable sources, already truncated to the request's `maxResults`. */
  readonly sources: readonly WebSearchSource[]
  /** True when the seam dropped sources to honor `maxResults`. */
  readonly truncated: boolean
}
```

```ts type-equiv
/**
 * One citeable source. A source always has a URL; `title`, `snippet`, and
 * `publishedAt` are optional because not every provider returns them — forcing
 * adapters to invent them would make the seam lie (Perplexity citations may be
 * URL-only). `dsh-tool-web` renders `title ?? hostname(url)` for display.
 */
interface WebSearchSource {
  readonly url: string
  readonly title?: string
  readonly snippet?: string
  /** Publication/crawl timestamp as a provider-supplied ISO-8601 string. */
  readonly publishedAt?: string
}
```

## 가져오기 요청 및 결과

```ts type-equiv
/**
 * What one fetch-capable backend is asked to retrieve. The request deliberately
 * omits timeout, format, prompt, and extraction controls: cancellation is a
 * direct execution argument, while presentation and higher-level LLM concerns
 * belong outside safe retrieval.
 */
interface WebFetchRequest {
  readonly url: string
}
```

HTTP 상태는 자동으로 실패가 되는 것이 아니라 가져온 리소스 상태의 일부입니다. `404`/`500`에 대한 성공적인 네트워크 가져오기는 상태 코드와 제한된 디코딩 본문을 포함한 `WebFetchResult`을 반환합니다. `url`은 허용된 리디렉션 이후의 최종 URL입니다. `WebError`은 리소스를 안전하게 가져오거나 표현하지 못한 실패를 위해 예약됩니다.

```ts type-equiv
/**
 * Normalized fetch outcome. A successful network fetch of a non-2xx response is
 * a result, not an error: the status code is part of the fetched resource
 * state. {@link WebError} is reserved for failures to safely retrieve or
 * represent the resource.
 */
interface WebFetchResult {
  /** The final URL after allowed redirects (the request URL is in the request). */
  readonly url: string
  /** HTTP status code of the fetched response. */
  readonly statusCode: number
  /** Decoded body, classified by content kind. */
  readonly body: WebFetchBody
  /** True when the provider capped the decoded body. */
  readonly truncated: boolean
}
```

```ts type-equiv
/**
 * The decoded body of a fetched resource. A CLOSED discriminated union owned by
 * `dsh-web`: the provider decodes the kind and `dsh-tool-web` renders it, so a
 * new kind is a coordinated change across known packages, not a plugin
 * extension. Consumers `switch` on `kind` ending in `default: assertNever(...)`
 * so adding a kind breaks compilation at every consumer until handled. Each arm
 * stays its own object literal even where fields coincide, so an arm can gain
 * fields the others lack.
 */
type WebFetchBody =
  | { readonly kind: 'html'; readonly content: string }
  | { readonly kind: 'text'; readonly content: string }
```

## 제공자 가용성

제공자의 `available(): boolean`은 저비용의 로컬 검사(자격 증명 존재 여부, 구문 분석 가능한 설정)이며 **네트워크 호출을 수행해서는 안 됩니다**. 이는 상태 확인 시스템이 아니라 실행 시점 선택의 입력입니다. `search()`/`fetch()`은 이를 읽어 사용 가능한 제공자를 선택하며, 선택 실패는 호출자가 라우팅하는 구조화된 `WebError`으로 표면화됩니다. 여기에는 분기 가능한 세부 정보(누락된 id 또는 모호한 후보 집합)가 코드와 메시지에 담깁니다.

선택은 등록, 설정 또는 HMR 순서에 절대 의존하지 않습니다. 기능에는 명시적 제공자 id(설정 `searchProvider`/`fetchProvider` 또는 같은 필드에 값을 제공하는 일치하는 환경 변수)가 있거나, 사용 가능한 제공자가 정확히 하나 등록된 경우 자동 선택됩니다. 구성된 id 없이 사용 가능한 제공자가 여러 개인 경우는 선착순이 아니라 `WEB_PROVIDER_AMBIGUOUS`입니다.

## 오류

`WebError extends HarnessError`([core.md](core.md) 오류 분류 체계)는 닫힌 유니온이 아니라 `code: string`(다른 모든 심의 오류와 마찬가지로 열려 있음 — `LlmError`, `SubagentError`)을 사용합니다. 제공자는 `dsh-web`을 수정하지 않고도 자체 코드를 발생시킬 수 있으며, 소비자는 알 수 없는 코드를 허용해야 합니다. 코드는 소유자별로 나뉩니다. 심 중립 코드는 공유 `WebRuntime` 계약에서 발생합니다. `WEB_PROVIDER_UNAVAILABLE`, `WEB_PROVIDER_CONFIGURED_MISSING`, `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`, `WEB_PROVIDER_AMBIGUOUS`, `WEB_DUPLICATE_PROVIDER`(등록 시점 프로그래밍 오류이며 `LlmRuntime`의 `DUPLICATE_ADAPTER`에 해당), `WEB_ABORTED`, 그리고 `WEB_PROVIDER_ERROR`(DNS, 연결 거부, TLS를 포함한 네트워크/전송 실패 등, 심을 통해 표면화된 제공자 자체 실패의 포괄 코드)입니다. 가져오기 전송 코드는 `dsh-web-fetch-http` 구현이 소유하며, 다른 가져오기 백엔드는 이를 발생시킬 필요가 없습니다. `WEB_INVALID_URL`, `WEB_BLOCKED_URL`, `WEB_REDIRECT_BLOCKED`, `WEB_FETCH_TOO_LARGE`, `WEB_FETCH_TIMEOUT`, `WEB_UNSUPPORTED_CONTENT_TYPE`입니다.

## 서비스

`WebRuntime`는 검색 및 가져오기 공급자를 등록하고, 중복 id는 `WEB_DUPLICATE_PROVIDER`로 거부하며, 구조화된 선택 오류와 함께 실행 시점에 공급자를 확인합니다. 로컬 가져오기 백엔드는 HTTP(S)만 허용하고, 자격 증명을 거부하며, 리디렉션, 바이트, 문자 및 시간을 제한하고, 동일 출처의 모든 리디렉션 홉을 다시 검증한 다음 본문을 디코딩합니다. 표시는 도구가 담당합니다. 로컬 백엔드는 사설 네트워크 대상을 차단하지 않습니다. 민감한 내부 대상에 접근할 수 있는 곳에서는 `web_fetch`를 활성화하지 마세요.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`에서 소스로부터 생성되며(문서 동기화에서 `pnpm run verify-cordis-catalog`로 최신 상태임을 검증하고, `pnpm run gen-cordis-catalog`로 다시 생성) 이 섹션은 페이지의 두 언어 영역에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 JSDoc을 유지합니다. 디스패치 모드는 [입문](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxweb--webruntime"></a>

### `ctx.web` — `WebRuntime`

웹 액세스 서비스입니다. `ctx.web`로 등록됩니다(컨텍스트당 인스턴스 하나).

선택 의미론(실행 시점에 확인되며, 순서에 의존하지 않음):

- 등록되어 있고 `available()`인 구성 id → 해당 공급자입니다.
- 구성된 id가 등록되지 않음 → `WEB_PROVIDER_CONFIGURED_MISSING`입니다.
- 구성된 id는 등록되어 있지만 사용할 수 없음 → `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`입니다.
- 구성된 id가 없고 등록된 사용 가능한 공급자가 정확히 하나임 → 해당 공급자입니다.
- 구성된 id가 없고 사용 가능한 공급자가 여러 개임 → `WEB_PROVIDER_AMBIGUOUS`입니다.
- 구성된 id가 없고 사용 가능한 공급자가 없음 → `WEB_PROVIDER_UNAVAILABLE`입니다.

```ts cordis-catalog
/**
 * Register a search provider. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
 * if its id is already registered for search. Returns a disposer; disposed
 * with the calling fiber.
 * @param provider - the provider; its `id` is the registry key.
 * @returns the disposer that unregisters the provider.
 */
registerSearchProvider(provider: WebSearchProvider): () => void

/**
 * Register a fetch provider. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
 * if its id is already registered for fetch. Returns a disposer; disposed
 * with the calling fiber.
 * @param provider - the provider; its `id` is the registry key.
 * @returns the disposer that unregisters the provider.
 */
registerFetchProvider(provider: WebFetchProvider): () => void

/**
 * Run one search through the selected provider. Resolves the provider at call
 * time with the selection rules above; throws {@link WebError} when the
 * capability cannot run. The seam enforces `request.maxResults` on the result:
 * if the provider over-returns, `sources[]` is truncated and `truncated` set.
 * @param request - the query and optional result limit.
 * @param signal - optional cancellation signal forwarded to the provider.
 * @returns the provider's results, capped to `request.maxResults`.
 */
async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>

/**
 * Retrieve one URL through the selected provider. Resolves the provider at
 * call time with the selection rules above; throws {@link WebError} when the
 * capability cannot run. A non-2xx response is a result, not a throw.
 * @param request - the URL plus retrieval options.
 * @param signal - optional cancellation signal forwarded to the provider.
 * @returns the retrieval outcome; non-2xx responses resolve descriptively.
 */
async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult>
```

소스: [`packages/web/web/src/index.ts:74`](../../packages/web/web/src/index.ts)
<!-- END GENERATED cordis-surface -->
