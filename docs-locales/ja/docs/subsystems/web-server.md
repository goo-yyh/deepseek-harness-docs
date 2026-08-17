# HTTP サーバー

[dsh-host-webserver](../../packages/host/webserver) は、GUI ホスト向けのブラウザ HTTP キャリアです。単一の `node:http` プラグインとして、`ctx.webServer`、名前付きルートレジストリ、index.html 変換コールバック、およびプラグインが取得できる 1 つのフォールバックハンドラーを提供します。これはエージェントループの一部でも機能の境界でもありません。Harness の概念を認識せず、`/api` ブリッジ、プラグインバンドル、HMR イベントストリームを含むすべての機能ルートは別のプラグインが登録します（[レイヤリングに関する注記](../../.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md)）。これはブラウザ専用です。Electron はビルド済みファイルを `file://` 経由で読み込み、このサーバーではなく IPC ブリッジを介して fetch リクエストを送信します。

ソース： [`packages/host/webserver/src/index.ts`](../../packages/host/webserver/src/index.ts)

## ルート

```ts type-equiv
/** Route match kind: 'exact' matches the pathname verbatim; 'prefix' p matches p and p/<anything>. */
type WebRouteKind = 'exact' | 'prefix'
```

```ts type-equiv
/** One named route registration. */
interface WebRoute {
  kind: WebRouteKind
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns the full response lifecycle (may hold the response open, e.g. SSE). */
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}
```

一致順序は固定されています。まず完全一致テーブル、次に最長一致プレフィックス、最後に登録済みフォールバックです。登録順序はリクエストに対する意味を持ちません。名前付きルートは互いに重複しないよう構成され、フォールバック枠は名前付きルートが取得しないすべてのリクエストに応答します。所有者は 1 つだけであり、2 回目の登録は例外をスローします。提供される Web 構成は、固定されたセマンティクスを持つ SPA dist サーバーである [`dsh-host-frontend-static`](../../packages/host/frontend-static/src/index.ts) によりこの枠を取得します。非 GET/HEAD は 405、dist ルート外へのトラバーサルは 403、未一致はすべて HTTP 200 の `index.html` にフォールバックします（SPA ルーティング）。未知の拡張子は octet-stream として送信されます。

## 設定

```ts type-equiv
/** Gateway config: the listen address. */
interface Config {
  /** Listen host; the two supported values are loopback and all-interfaces. */
  host: '127.0.0.1' | '0.0.0.0'
  /** Listen port; zero requests an OS-assigned port. */
  port: number
}
```

`host` が受け入れるのは、`127.0.0.1`（デフォルトの態勢）と `0.0.0.0`（意図的なネットワーク公開）のみです。TLS、認証、オリジンポリシーはないため、ループバック以外へのバインドは、そのネットワークにサーバーを公開します。dist の場所は、この枠を取得するフロントエンドプラグインのアセンブリ上の事実です。

## サービス

`WebServer`（`ctx.webServer`）は有効化時に直ちにリッスンを開始します。リッスンの失敗（EADDRINUSE など）は初期化を拒否し、ブートプロセスは失敗したファイバーを報告します。`register(route)` は名前付きルートを 1 つ追加して、その破棄関数を返します。ルートパターンは構成レベルの契約であり、衝突は設定ミスであるため、重複した `(kind, path)` は例外をスローします。`tapIndex(transform)` は、すべての index レスポンス（`/` と各 SPA フォールバック）に登録順で適用される、純粋な html-to-html 変換を追加します。[dsh-client-modules](../../packages/client/modules) はこれを使用してブートマニフェストを挿入します。`port` はリッスン中のポートを読み取ります。`config.port` が 0 の場合に OS が割り当てたポートも含まれます。

処理中に例外が発生したリクエスト（`decodeURIComponent` に到達する不正な %-エスケープ、本文の途中で切断するクライアント）は警告としてログに記録され、400 が返されます。すでにヘッダーが送信済みの場合はソケットを破棄しますが、プロセスが終了することはありません。ハンドラーがレスポンスを開いたままにする場合があり（SSE）、そのような接続は自然には終了しないため、破棄時には `close()` と `closeAllConnections()` を組み合わせます。強制クローズがなければ、ティアダウンはハングします。このパッケージは出力を行いません。URL 行はシェルの役割です。開発モードのバンドル監視パイプラインを含むパッケージごとの運用詳細は、[README](../../packages/host/webserver/README.md) に記載されています。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

ソースから `scripts/gen-cordis-catalog.ts` により生成されます（doc-sync で `pnpm run verify-cordis-catalog` により最新性が検証されます。再生成には `pnpm run gen-cordis-catalog` を使用します）。このセクションはページの両言語版でバイト単位で同一です。シグネチャブロックは `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは [入門](../cordis-primer.md#dispatch-modes) で定義され、フレームワークから継承される `ctx` API は [cordis-api/inherited.md](../cordis-api/inherited.md) にあります。

<a id="ctxwebserver--webserver"></a>

### `ctx.webServer` — `WebServer`

ブラウザ HTTP キャリアサービスです。有効化時に直ちにリッスンを開始します。設定済みの名前付きルートは互いに異なる必要があり、フォールバックハンドラーは所有者が登録するまで起動中にまだ取得されていないすべてのリクエストに 404 で応答するため、ルート登録順序はリクエストに影響しません。リッスンの失敗は初期化を拒否し、ブートプロセスは失敗したファイバーを報告します。

```ts cordis-catalog
/**
 * Register a named route. Duplicate (kind, path) throws — route patterns are
 * a composition-level contract, so a collision is a misconfiguration.
 * @param route - kind, path, and the owning handler.
 * @returns the disposer removing the route.
 */
register(route: WebRoute): () => void

/**
 * Register an exact-path HTTP upgrade route. Duplicate paths throw because
 * one socket can have only one protocol owner.
 * @param route - pathname and handler owning negotiation plus socket use.
 * @returns the disposer removing the route.
 */
registerUpgrade(route: WebUpgradeRoute): () => void

/**
 * Claim the fallback seat: the handler answering every request no named
 * route matches (the SPA dist server in the shipped Web composition). One
 * owner only — a second registration throws, because two fallbacks cannot
 * compose.
 * @param handler - owns the full response lifecycle of unmatched requests.
 * @returns the disposer releasing the seat.
 */
registerFallback(handler: WebRoute['handler']): () => void

/**
 * Register an index.html transform, applied by the fallback owner to every
 * index response ({@link applyIndexTaps}) in registration order.
 * @param transform - pure html-to-html function.
 * @returns the disposer removing the transform.
 */
tapIndex(transform: (html: string) => string): () => void

/**
 * Run an index.html body through the registered taps in registration order
 * — called by the fallback owner on every index response it renders.
 * @param html - the raw index.html body.
 * @returns the transformed body.
 */
applyIndexTaps(html: string): string
```

ソース： [`packages/host/webserver/src/index.ts:59`](../../packages/host/webserver/src/index.ts)
<!-- END GENERATED cordis-surface -->
