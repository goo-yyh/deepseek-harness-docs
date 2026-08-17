# クライアントモジュール

Web プラグインテーブルは、[dsh-client-modules](../../packages/client/modules) にあるクライアントモジュールシステムの Node 側であり、`ctx.clientModules`（`ClientModuleRegistry`）として提供されます。ホスト Loader のエントリを走査して `dsh.client` を宣言するパッケージを探し、`window.__DSH_BOOT__` のエントリグラフを構成し、各バンドルを `/plugins/<id>/client.js` で提供し、インデックスレンダリングにフックしてブートマニフェストを注入します。これは 1 つのサービスの 4 つの側面です。これは Web GUI スタックのオプション機能であり、エージェントループの中核ではありません。また、[dsh-host-webserver](../../packages/host/webserver) のコンシューマーです。[web-server.md](web-server.md) で説明されているキャリアが、このサービスが登録するプレフィックスルートとインデックスタップを提供します。同じパッケージのブラウザー側（`ctx.modules`。これらのバンドルを取得して実体化する遅延 CJS モジュールテーブル）は、ここではなく、[パッケージ README](../../packages/client/modules/README.md) で説明されているカーネル機構です。

ソース： [`packages/client/modules/src/client/manifest.ts`](../../packages/client/modules/src/client/manifest.ts)

## ワイヤー

グラフは Node 側とブラウザー側の間におけるワイヤーの単一の情報源です。ホストは、走査したパッケージから `WebBootEntry` の行を構成し、グラフを `<head>`（`window.__DSH_BOOT__`。プラグイン制御の文字列が script 要素から抜け出せないよう `<` をエスケープします）の最初のスクリプトとして注入します。シェルは何かをブートする前にそれを解析します。有効なマニフェストのないページはブートできません。ブラウザー側のパーサーは、グラフが存在しない、または不正な場合に明確に例外を送出します。

```ts type-equiv
/**
 * One composed client entry pushed by the host (a graph row). Wire
 * single source: the host node half (package root) produces this same shape.
 * `immediately` marks stage-one prefetch; `inject` is informational graph
 * metadata (the authoritative edges live in each package's `dsh.client`
 * declaration and reach fibers through entry creation).
 */
interface WebBootEntry {
  /** Entry name == package name. */
  id: string
  /** Bundle endpoint, '/plugins/<id>/client.js?rev=<rev>'. */
  url: string
  /** Bundle content hash (cache-busting consistency anchor). */
  rev: string
  /** Package-name dependency edges, informational (preflight display / HMR diffing). */
  inject?: string[]
  /** Stage-one prefetch mark: load the script for factory registration during module-face boot. */
  immediately?: boolean
}
```

```ts type-equiv
/** The composed client entry graph the host injects as `window.__DSH_BOOT__`. */
interface WebBootGraph {
  /** Consistency anchor over the whole graph (content + bundle hashes). */
  rev: string
  /** Composed entries; order carries no semantics (activation order is fiber inject waiting). */
  entries: WebBootEntry[]
}
```

各行の `rev` はバンドルのコンテンツハッシュであり、キャッシュ回避クエリとして URL に付加されます。グラフの `rev` は構成済みの行をハッシュするため、任意の行の変更によって変化します。`immediately` はステージ 1 のプリフェッチ層（モジュール側のブート中に取得・実行し、登録のみ行います）を示します。遅延行は最初の import 時に取得されます。

## 走査

パッケージは、package.json で `dsh.client`（`platform: 'web'`、オプションの `inject` エッジ、オプションの `immediately`）を宣言し、ビルド済みバンドルを `exports["./client"]` でエクスポートすることで、テーブルに参加します。パッケージ解決は設定ツリーの `ctx.baseUrl`、すなわち構成済みの各プラグインを依存関係として宣言する cordis.yml ディレクトリに固定されます。このアンカーが未設定の場合、構築時に例外が送出されます。

走査はパッケージごとに増分で行われ、完全再走査のコードパスはありません。cordis の `internal/plugin` 発行（fiber の構築または破棄）があるたびに、その fiber のエントリ名がダーティとしてマークされ、マイクロタスクのフラッシュが各ダーティ名をライブ Loader エントリと照合します。アクティベーションパスでは、同じダーティセットを現在のすべてのエントリで初期化し、同期的にフラッシュします。そのため、最初の走査と定常状態は 1 つの実装を共有しますが、失敗時の方針は異なります。アクティベーション時は、すでに読み込まれたエントリに不正な宣言または欠落したバンドルがあると、壊れたすべてのパッケージを列挙する明確な `AggregateError` に集約されます。fiber は FAIL し、ブートの fail-loud スイープが報告します。定常状態では、壊れたパッケージは警告を記録するだけで、他のパッケージを壊してはなりません。

「クライアントパッケージではない」という否定的な判定を含むパッケージメタデータは、名前ごとにキャッシュされ、期限切れになりません。プラグインセットの変更は再起動時に反映されます。fiber を再起動しても行と rev はそのまま再利用され、バンドル内容の変更がグラフに届くのは `rebuilt()` を通じてのみです。

## バンドルルートとインデックスタップ

`GET`/`HEAD /plugins/<id>/client.js` は、登録済みのバンドルを `no-cache` とともにディスクから提供します（一貫性の基準は HTTP キャッシュではなく rev クエリです）。それ以外のメソッドには 405 を返します。不明な ID、またはまだビルドされておらずバンドルを読み取れない登録済み行には、キャリアの SPA フォールバックが JavaScript の代わりに HTML を配信しないよう、明確な 404 を返します。インデックスタップはインデックスレンダリングごとに現在のグラフを注入するため、リロード時は常にライブ構成に対してブートします。

## サービス

`ClientModuleRegistry`（`ctx.clientModules`。[`packages/client/modules/src/index.ts`](../../packages/client/modules/src/index.ts) で定義）は読み取り機能と再ビルド側を公開します。シグネチャは生成された[サービスカタログ](#ctxclientmodules--clientmoduleregistry)にあります。`graph()` は現在構成されているグラフ（変更間では安定したオブジェクト）を返し、`clientPath(id)` はバンドルの絶対パスを返します。`rebuilt(id)` は、バンドル内容がグラフに到達する唯一のエントリポイントです。ファイルを再ハッシュし、実際に rev が変更された場合にのみグラフを再構成して通知します。`onRebuilt` は変更されたバンドルごとに新しい rev を伴って発火します。`onGraphChanged` は、グラフを再構成したフラッシュ（行の追加・削除、または再ビルドによる rev の変更）の後に発火し、プルモデルです。リスナーは `graph()` を再読み取りします。どちらの通知経路もリスナー例外を封じ込めるため、例外を送出した 1 つの購読者が後続の購読者をスキップしたり、フラッシュを引き起こした処理を停止させたりすることはありません。

開発時には、[dsh-client-hmr](../../packages/client/hmr/README.md) がレジストリの監視ドライバーです。その Node 側は、同期的に取得したベースラインから各グラフ行のバンドルを stat ポーリングし、変更時に `rebuilt(id)` を呼び出し、`onGraphChanged` を通じて監視セットを再同期し、SSE 経由で rev の変更をブラウザー側へブロードキャストします。本番グラフには HMR 行がまったく含まれません。モジュールホスト自体はファイルを監視しません。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts` によりソースから生成されます（doc-sync では `pnpm run verify-cordis-catalog` によって最新であることを検証し、`pnpm run gen-cordis-catalog` で再生成します）。このセクションはページの両言語版でバイト単位で同一です。シグネチャブロックでは `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義され、フレームワークから継承される `ctx` API は[cordis-api/inherited.md](../cordis-api/inherited.md)にあります。

<a id="ctxclientmodules--clientmoduleregistry"></a>

### `ctx.clientModules` — `ClientModuleRegistry`

Web プラグインテーブルサービス: 増分 `dsh.client` 走査 + ワイヤー構成 + バンドルルート + インデックスタップ。構築ではアクティベーション走査を同期的に実行します。すでに読み込まれたエントリに不正な宣言または欠落したバンドルがあると、明確な 1 つの例外に集約されます（fiber は FAILED となり、ブートアクティベーション監査が報告します）。

```ts cordis-catalog
/**
 * Current composed entry graph (stable object between changes).
 * @returns the graph served as `window.__DSH_BOOT__`.
 */
graph(): WebBootGraph

/**
 * Absolute path of an entry's client bundle.
 * @param id - entry id (package name).
 * @returns the path, or undefined for an unknown id.
 */
clientPath(id: string): string | undefined

/**
 * Re-hash one bundle (the HMR watch's registration hook — the only entry
 * point through which bundle content changes reach the graph).
 * @param id - entry id (package name).
 * @returns the new rev, or undefined for an unknown id.
 */
rebuilt(id: string): string | undefined

/**
 * Subscribe to bundle rebuilds; fires only when the re-hash changed the rev.
 * @param listener - receives the entry id and its new bundle rev.
 * @returns the unsubscriber.
 */
onRebuilt(listener: (id: string, rev: string) => void): () => void

/**
 * Fires after any flush that recomposed the graph (row added/removed, or a
 * rebuilt rev change). Pull model: listeners re-read {@link graph}.
 * @param listener - notified with no payload.
 * @returns the unsubscriber.
 */
onGraphChanged(listener: () => void): () => void
```

出典: [`packages/client/modules/src/index.ts:184`](../../packages/client/modules/src/index.ts)
<!-- END GENERATED cordis-surface -->
