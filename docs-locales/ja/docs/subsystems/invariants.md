# ランタイム不変条件

[dsh-invariants](../../packages/runtime-diagnostics/invariants) は、パッケージ所有のランタイム不変条件チェック用に設定可能なレジストリサービス（`ctx.invariants`）です。これは 3 パッケージの機能境界でもエージェントループの中核でもなく、1 つのサポートグループパッケージです。レジストリは選択、名前の予約、子ファイバーのライフサイクル、パッケージに帰属する失敗を所有し、各ワークスペースパッケージは、正確な npm パッケージ名でチェックを登録する `./invariant` コンパニオンプラグインを公開します。チェックがアサートできる対象（権威あるイベントストリームまたは可変データであり、サービスやメソッドの存在ではないこと）は、[AGENTS.md](../../AGENTS.md#conventions) のランタイム不変条件の規約で定められています。レジストリ設計は、[invariant-service Agent Note](../../.agents/notes/implemented/architecture/2026-07-19-package-owned-invariant-service.md) が所有しています。

ソース： [`packages/runtime-diagnostics/invariants/src/index.ts`](../../packages/runtime-diagnostics/invariants/src/index.ts)

## 選択

```ts type-equiv
/** Runtime invariant selection configured on the service plugin. */
interface Config {
  /** Global switch; defaults to `true`. */
  readonly enabled?: boolean
  /** Case-sensitive JavaScript regex sources that admit package names; empty admits all. */
  readonly package_allowlist?: string[]
  /** Case-sensitive JavaScript regex sources that exclude package names after allowlist matching. */
  readonly package_blocklist?: string[]
}
```

サービスが有効で、許可リストが空であるか少なくとも 1 つのパターンが完全な npm 名に一致し、かつブロックリストのパターンが一致しない場合に、パッケージが選択されます。ブロックリストの一致は許可リストの一致を上書きします。エントリは `new RegExp(source)` でコンパイルされます。ソースが `^` と `$` を指定しない限り一致はアンカーされず、`/pattern/flags` 構文は解析されません。検証はサービス起動時に明示的に失敗します。空白、前後に空白を含む、重複した、または無効なエントリはスキップされずにスローされます。有効なパターンは現在読み込まれているパッケージに一致しない場合があるため、後からの読み込みと HMR は決定的に維持されます。フィルターはサービスの存続期間中固定です（[README](../../packages/runtime-diagnostics/invariants/README.md)）。

## インストーラー

```ts type-equiv
/**
 * Throw a package-attributed invariant failure.
 * @param message - violated package contract without the standard prefix.
 * @returns never because reporting a violation throws.
 */
type InvariantFailure = (message: string) => never
```

```ts type-equiv
/** Install one package's checks into the registration's child context. */
interface InvariantInstaller {
  /**
   * Install the package contribution.
   * @param ctx - child context owned by this invariant registration.
   * @param fail - reporter bound to the registering package name.
   * @returns nothing, or a promise settling after asynchronous checks finish.
   */
  (ctx: Context, fail: InvariantFailure): void | Promise<void>
  /** Services the child installer fiber may access. */
  readonly inject?: Inject
}
```

有効なインストーラーは専用の子 Cordis ファイバーで実行されます。`installer.inject` はそのファイバーがアクセスできるサービスを宣言し、同期・非同期を問わずインストーラーの完了は、登録が成功する前に join されます。`fail(message)` は `InvariantError` をスローします。これは、安定した `code: 'INVARIANT'`、所有する `packageName`、および `invariant violated by "<package>": …` で始まるメッセージを備えた `extends Error` です。そのため、レジストリが製品パッケージをインポートしなくても、違反を帰属させられます。

## サービス

`ctx.invariants.register(packageName, installer)` は完全な npm パッケージ名に対して 1 つのアクティブな登録を予約し、そのエフェクトスコープの disposer を返します。フィルターによってインストーラーが非アクティブに保たれる場合でも予約は維持されるため、2 つのプラグインが同じパッケージ名を暗黙に要求することはありません。重複した名前、空白の名前、または空白を含む名前はスローされます。インストーラーが失敗すると、子ファイバーは破棄され、予約はアトミックに解放されます。サービスはすべての登録ファイバーを所有し、返された disposer もコンパニオンファイバーに属します。どちらか一方をアンロードすると、リスナー、トレース状態、予約が削除されるため、コンパニオンは状態を保持せずに再読み込みし、同じ名前を再登録できます。

## コンパニオンの契約

すべてのワークスペースパッケージは `./invariant` コンパニオンを所有します（[パッケージ契約](../../packages/AGENTS.md)）。公開と登録は網羅的ですが、アサーションは意図的に合成されません。コンパニオンは、そのパッケージが観測可能なイベントまたは可変データの関係を所有する場合にのみチェックをインストールします。それ以外の場合は、先頭のコメントが `No runtime invariant:` で始まり、チェック可能な対象がない理由をパッケージごとに説明する空のインストーラーをエクスポートします。`pnpm run verify-package-invariants` は、生成済みマーカー、説明のない空のインストーラー、レポーターを省略または無視する非空インストーラー、不正な登録名、不完全なエクスポート・公開・依存関係・バンドルの配線を機械的に拒否します（[mechanical-rule Agent Note](../../.agents/notes/implemented/architecture/2026-07-19-package-invariant-runtime-contracts.md)）。実行可能なコンパニオンのカタログと標準構成は、[パッケージ README](../../packages/runtime-diagnostics/invariants/README.md) にあります。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts` によりソースから生成されています（doc-sync で `pnpm run verify-cordis-catalog` により最新性を検証。`pnpm run gen-cordis-catalog` で再生成できます）。このセクションはページの両言語版でバイト単位で同一です。シグネチャブロックは `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義され、フレームワークから継承された `ctx` API は[cordis-api/inherited.md](../cordis-api/inherited.md)にあります。

<a id="ctxinvariants--invariantregistry"></a>

### `ctx.invariants` — `InvariantRegistry`

グローバルおよび正規表現ベースの選択機能を備えた、パッケージ所有の不変条件レジストリ。

```ts cordis-catalog
/**
 * Register one package's invariant installer. The package name is reserved
 * even when filtering disables its checks. Enabled installers run in a child
 * fiber; failure disposes that fiber and releases the reservation.
 * @param packageName - full npm package name that owns the contribution.
 * @param installer - listener or startup-check installer for the child context.
 * @returns an effect-scoped disposer for the registration.
 */
register(packageName: string, installer: InvariantInstaller): () => void
```

ソース： [`packages/runtime-diagnostics/invariants/src/index.ts:94`](../../packages/runtime-diagnostics/invariants/src/index.ts)
<!-- END GENERATED cordis-surface -->
