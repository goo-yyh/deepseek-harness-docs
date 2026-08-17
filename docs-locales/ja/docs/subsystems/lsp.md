# LSP ナビゲーション

LSP seam は、1 つの `ctx.lsp` サービスでセマンティックなコードナビゲーションを公開する [機能 seam](../../.agents/notes/implemented/architecture/2026-07-15-lsp-capability-seam.md) であり、パッケージ間に分割されています。サービス定義（[dsh-lsp](../../packages/lsp/lsp)、`ctx.lsp` とプロバイダーレジストリ）、汎用の サービスプロバイダー（[dsh-lsp-stdio](../../packages/lsp/lsp-stdio)、設定済みの stdio 言語サーバーホスト）、コンシューマー（[dsh-tool-lsp](../../packages/lsp/tool-lsp)、`lsp` ツールスキーマ）です。LSP は**任意の機能の 1 つ**であり、agent-loop の中核には含まれません。そのため、その語彙は [core.md](core.md) ではなくここにあります。プロバイダーを入れ替えても、モデルによるナビゲーションの要求方法は変わりません。

ソース： [`packages/lsp/lsp/src/types.ts`](../../packages/lsp/lsp/src/types.ts)

## 操作と座標

seam とモデルは、厳密に 4 つのセマンティッククエリを公開します。このユニオンは閉じているため、クエリを追加すると、seam、プロバイダー、ツール全体でコンパイルにより強制される変更になります。位置と範囲はプロトコルに合わせて 0 ベースの UTF-16 です。モデル向けツールが 1 ベースのカーソル規約を管理し、入出力時に変換します。

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

## リクエスト

すべてのフィールドが必須です。`workspaceRoot` は呼び出し元が指定し、`languageId` はプロバイダーの登録から取得されます（リクエストからではありません）。また、コンシューマーがタイムアウトと結果数の上限を管理するため、どのフィールドにも実装側のデフォルト設定は不要であり、`resolve()` ステップもありません。プロバイダーは、呼び出し元のリクエストと、導出された `languageId` を受け取ります。後者は一時的なドキュメントを同期するだけで、選択には一切関与しません。

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

## 結果

CLOSED 判別ユニオンです。ナビゲーション操作は `locations` に正規化され、`hover` はコンテンツまたは `null` に正規化されます。コンシューマーは `kind` に対して `switch` を使用し、網羅性を確保するため、新しいアームが追加されると処理されるまでコンパイルに失敗します。`findReferences` には常に宣言が含まれます。これはプロバイダーが内部で強制するため、呼び出し元にフラグは提供されません。`locations` バリアントは、プロバイダーの正規ワークスペース `file:` URI である `resolvedWorkspaceUri` を保持します。呼び出し元が位置 URI を相対化する際は、シンボリックリンクの可能性があるリクエストルートにホストプラットフォームのパス規則を適用するのではなく、この座標を使用します。

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

## プロバイダーとサービス

プロバイダーは、安定したブランド付きの `id` と、排他的な小文字かつ先頭ドット付きの拡張子マップを管理します。`registerProvider` は id とすべての拡張子をアトミックに予約します。無効または競合する登録では何も公開されず、その disposer はすべての予約を解放します。選択はクエリごとに行われ、順序に依存しません。一致しない場合は `LspError` `LSP_UNAVAILABLE` がスローされます。seam は、プロトコル型、プロセス／ドキュメント制御、汎用 JSON-RPC エスケープハッチを公開しません。

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

`LspProviderId` はシームのブランド付き ID です（[dsh-brand](../../packages/util/brand) の `Branded<'LspProviderId'>`）。`LspError` は `HarnessError` を、`LSP_INVALID_PROVIDER`、`LSP_CONFLICT`、`LSP_UNAVAILABLE`、`LSP_DISPOSED`、`LSP_UNSUPPORTED_OPERATION`、`LSP_MALFORMED_RESPONSE` などの安定したコードで拡張します。呼び出し元は `message` を解析する代わりに、これらのコードに基づいてルーティングします。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts` によりソースから生成されます（doc-sync で `pnpm run verify-cordis-catalog` により最新であることを検証します。再生成には `pnpm run gen-cordis-catalog` を使用します）。このセクションはページの両言語版でバイト単位まで同一です。シグネチャブロックは `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義され、フレームワークから継承される `ctx` API は[cordis-api/inherited.md](../cordis-api/inherited.md)にあります。

<a id="ctxlsp--lspservice"></a>

### `ctx.lsp` — `LspService`

LSP 機能シーム（`ctx.lsp`）です。プロバイダーの登録と選択、および正規化されたクエリ実行を担います。公開する操作は厳密に 4 つであり、プロトコルのエスケープハッチは提供しません。

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

ソース: [`packages/lsp/lsp/src/types.ts:113`](../../packages/lsp/lsp/src/types.ts)
<!-- END GENERATED cordis-surface -->
