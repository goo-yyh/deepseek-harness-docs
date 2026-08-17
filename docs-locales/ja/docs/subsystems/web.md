# Webアクセス

Webアクセスシームは1つの[能力シーム](../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)であり、1つの`ctx.web` service で**2つの操作** （検索と取得）を扱います。パッケージにまたがって分割されています。サービス定義（[dsh-web](../../packages/web/web)、`ctx.web` とプロバイダーレジストリ）、サービスプロバイダー（[dsh-web-search-exa](../../packages/web/web-search-exa)、[dsh-web-search-perplexity](../../packages/web/web-search-perplexity)、[dsh-web-search-deepseek](../../packages/web/web-search-deepseek)、[dsh-web-fetch-http](../../packages/web/web-fetch-http)）、およびコンシューマー（[dsh-tool-web](../../packages/web/tool-web)、`web_search`/`web_fetch` ツールスキーマ）です。Webは**1つの任意機能**であり、エージェントループの中核ではありません。そのため、その用語は[core.md](core.md)ではなくここにあります。検索プロバイダーを交換しても、モデルによるクエリの要求方法は変わりません。取得プロバイダーを交換しても、モデルによるURLの要求方法は変わりません。

出典: [`packages/web/web/src/types.ts`](../../packages/web/web/src/types.ts)

## 1つの機能に2つの操作がある理由

検索と取得はリクエストスキーマもビジネスロジックも共有しませんが、意図的に1つの`ctx.web`中間層として扱われます。プロバイダー選択ポリシーの所有者、abort/errorの用語、そして「このHarnessがWebに到達する方法」を示す製品向け設定APIがそれぞれ1つになります。代償として、serviceには並列した`searchX`/`fetchX`メソッドペアがあります。この並列性は意図的なものであり、抽出の見落としではありません。プロバイダーが登録するのはツールではなく、**能力** （`WebSearchProvider` または `WebFetchProvider`）です。モデル向けの名前、スキーマ、プロンプトガイダンス、表示はすべて単一の`dsh-tool-web`コンシューマーにあります。

## 検索リクエストと結果

モデル向けツールの引数は単なる`query`です。`maxResults`は、シームを通過して戻る際に適用されるコンシューマー所有の上限（`dsh-tool-web`の`searchMaxResults`設定、デフォルトは`8`）です。プロバイダーが過剰に返した場合、シームは`sources[]`を切り詰め、`truncated`を設定します。

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

## 取得リクエストと結果

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

HTTPステータスは取得したリソース状態の一部であり、自動的に失敗となるわけではありません。`404`/`500`のネットワーク取得が成功すると、ステータスコードと上限付きのデコード済み本文を持つ`WebFetchResult`が返されます。`url`は許可されたリダイレクト後の最終URLです。`WebError`は、リソースを安全に取得または表現できない失敗のために予約されています。

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

## プロバイダーの可用性

プロバイダーの`available(): boolean`は低コストのローカルチェック（認証情報の存在、解析可能な設定）であり、**ネットワーク呼び出しを行ってはなりません**。これはヘルスシステムではなく、実行時選択への入力です。`search()`/`fetch()`はこれを読み取り、使用可能なプロバイダーを選択します。選択の失敗は、呼び出し元がルーティングする構造化された`WebError`として表面化します。これは、分岐可能な詳細（欠落したidまたは曖昧な候補セット）をコードとメッセージに含みます。

選択は登録、設定、またはHMRの順序に依存しません。能力には明示的なプロバイダーid（設定の`searchProvider`/`fetchProvider`、または同じフィールドに渡される対応するenv var）があるか、使用可能なプロバイダーが1つだけ登録されている場合は自動選択されます。設定済みidがなく使用可能なプロバイダーが複数ある場合は、先着順ではなく`WEB_PROVIDER_AMBIGUOUS`です。

## エラー

`WebError extends HarnessError`（[core.md](core.md)のエラー分類）は、閉じたunionではなく`code: string`です（他のすべてのシームのエラーと同様にopenです。`LlmError`、`SubagentError`）。プロバイダーは`dsh-web`を編集せずに独自のコードを送出でき、コンシューマーは未知のコードを許容する必要があります。コードは所有者ごとに分かれます。シーム中立のコードは共有`WebRuntime`契約によって送出されます。`WEB_PROVIDER_UNAVAILABLE`、`WEB_PROVIDER_CONFIGURED_MISSING`、`WEB_PROVIDER_CONFIGURED_UNAVAILABLE`、`WEB_PROVIDER_AMBIGUOUS`、`WEB_DUPLICATE_PROVIDER`（登録時のプログラミングエラーであり、`LlmRuntime`の`DUPLICATE_ADAPTER`に相当）、`WEB_ABORTED`、および`WEB_PROVIDER_ERROR`（DNS、接続拒否、TLSなどのネットワーク/トランスポート障害を含め、シームを通じて表面化するプロバイダー固有の失敗を包括するもの）です。取得トランスポートコードは`dsh-web-fetch-http`実装が所有しており、別の取得バックエンドがこれらを送出する必要はありません。`WEB_INVALID_URL`、`WEB_BLOCKED_URL`、`WEB_REDIRECT_BLOCKED`、`WEB_FETCH_TOO_LARGE`、`WEB_FETCH_TIMEOUT`、`WEB_UNSUPPORTED_CONTENT_TYPE`。

## サービス

`WebRuntime` は検索プロバイダーと取得プロバイダーを登録し、重複する id を `WEB_DUPLICATE_PROVIDER` で拒否し、構造化された選択エラーとともに実行時にプロバイダーを解決します。ローカル取得バックエンドは HTTP(S) のみを受け入れ、認証情報を拒否し、リダイレクト数、バイト数、文字数、時間を上限設定し、同一オリジンのリダイレクトホップごとに再検証して本文をデコードします。表示はツールが担います。ローカルバックエンドはプライベートネットワークのターゲットをブロックしません。機密性の高い内部ターゲットに到達できる場所では、`web_fetch` を有効にしないでください。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts` によりソースから生成されます（doc-sync で `pnpm run verify-cordis-catalog` により最新であることを検証し、`pnpm run gen-cordis-catalog` で再生成します）。このセクションはページの両言語版でバイト単位で同一です。シグネチャブロックには `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは [入門](../cordis-primer.md#dispatch-modes) で定義され、フレームワークから継承される `ctx` API は [cordis-api/inherited.md](../cordis-api/inherited.md) にあります。

<a id="ctxweb--webruntime"></a>

### `ctx.web` — `WebRuntime`

Web アクセスサービスです。`ctx.web` として登録されます（コンテキストごとに 1 インスタンス）。

選択のセマンティクス（実行時に解決され、順序には依存しません）：

- 登録済みで `available()` の設定済み id → そのプロバイダー。
- 設定済みの id が未登録 → `WEB_PROVIDER_CONFIGURED_MISSING`。
- 設定済みの id は登録済みだが利用不可 → `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`。
- id が未設定で、登録済みかつ利用可能なプロバイダーがちょうど 1 つ → そのプロバイダー。
- id が未設定で、利用可能なプロバイダーが複数 → `WEB_PROVIDER_AMBIGUOUS`。
- id が未設定で、利用可能なプロバイダーがない → `WEB_PROVIDER_UNAVAILABLE`。

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

ソース: [`packages/web/web/src/index.ts:74`](../../packages/web/web/src/index.ts)
<!-- END GENERATED cordis-surface -->
