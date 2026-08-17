# ストレージ

ストレージサブシステムは、セッションイベントログ以外のすべてを永続化します（セッションログには専用の抽象的な接続点があります — [persistence.md](persistence.md)）。これはエージェントループの中核ではない任意の機能であり、[機能の接続点](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)として分割されています。すなわち、ハブとサービス定義（[dsh-storage](../../packages/storage/storage)、`ctx.storage`）、サービスプロバイダー（[dsh-storage-json](../../packages/storage/storage-json)。`json`として登録。および[dsh-storage-sqlite](../../packages/storage/storage-sqlite)。`sqlite`として登録）、そしてコンシューマーのデータ形式（[dsh-storage-domain](../../packages/storage/storage-domain)、`ctx.storageDomain`。`ctx.storage.domain`としても参照可能）です。これはバックエンド契約における唯一のコンシューマーであり、ほかのすべてが使用する型付き API です。ハブ自体は IO を実行しません。バックエンドが媒体を所有し、データ形式がセマンティクスを所有し、プロダクトパッケージがバックエンドに直接触れることはありません。設計記録: [ドメイン KV ストレージの Agent Note](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md)。

出典: [`packages/storage/storage/src/backend.ts`](../../packages/storage/storage/src/backend.ts) · [`packages/storage/storage-domain/src/spec.ts`](../../packages/storage/storage-domain/src/spec.ts) · [`packages/storage/storage-domain/src/events.ts`](../../packages/storage/storage-domain/src/events.ts)

## ハブ: `ctx.storage`

`Storage`（[シグネチャ](#ctxstorage--storage)）は、ストアではなく接続点です。`ctx.storage.backend`は名前 → バックエンドのテーブルです。複数のバックエンドを並行してマウントでき、どのバックエンドがどのコンシューマーを提供するかは、そのコンシューマーの設定（ドメイン層のルートテーブル）で決まり、ハブ全体の選択ではありません。`register(name, backend)`は disposer を返します。重複した名前と未知のルックアップでは`StorageError`がスローされます。破棄では名前の登録解除のみを行います。所有するプラグインが、登録解除後にバックエンドを閉じます。各バックエンドプラグインは、ライフサイクル専用のサービスキー（`storageBackendServiceKey(name)`）も公開します。形式プロバイダーはこれを注入するため、アクティベーションがバックエンド登録と競合することはありません。

データ形式は、マージで拡張可能なキーマップの下でハブにマウントされます。

```ts type-equiv
/**
 * Data forms mountable on the hub, keyed by form name. Form owners extend
 * this map via declaration merging (the domain layer merges
 * `domain: DomainFacility`) and mount the facility in their `apply`.
 */
interface StorageForms {}
```

`mount(form, facility)`は、disposer によりアンマウントされるエフェクトです。同じキーを再度マウントすると`duplicate-mount`がスローされます。`form(form)`はマウント済みの機能を解決し、所有プラグインが読み込まれるまでは`form-not-mounted`をスローします。アセンブリでは、暗黙に遅延させるのではなく、それに応じてプラグインの順序を定めます。ドメイン層は`domain: DomainFacility`をマージするため、`ctx.storage.domain`と`ctx.storageDomain`は同じオブジェクトです。

## バックエンド契約

```ts type-equiv
/**
 * One registered backend. A backend owns exactly one medium and shares its
 * lifecycle across all facets; facets are optional members — a backend that
 * cannot serve a data kind simply omits it, and resolution fails loud instead.
 */
interface StorageBackend {
  /** Key-value operations; absent when this backend cannot serve them. */
  readonly kv?: KvFacet

  /**
   * Drain in-flight writes across all open units and release the medium.
   * Idempotent; concurrent and repeated calls resolve once teardown finishes.
   * @returns resolution after the medium is released.
   */
  close(): Promise<void>
}
```

バックエンドは 1 つの媒体（ファイルツリーのルート、データベースファイル）を所有し、任意の操作グループを公開します。現在のグループは`kv`のみです。`KvFacet.open(descriptor)`は名前付きユニットを 1 つ開きます。`KvUnitDescriptor`には名前、形式バージョン、テーブル名、グローバルなシングルトンスロットの有無が含まれ、`KvUnit`を返します。これには`loadAll`、`putRecord`、`deleteRecord`、`setGlobal`、`close`があります。ユニット名とテーブル名は`UNIT_NAME_RE`に一致する必要があります（ファイル名および SQL 識別子セグメントとして安全です）。レコードキーは任意の文字列であり、ファイルパスに到達することはありません。ユニットは同時書き込みを直列化しません。順序付けは呼び出し元の責務です。ただし、個々の呼び出しは媒体上でアトミックであり、解決時点で永続化されます。異なるバージョンが記録された媒体では`version-mismatch`が拒否されます。ユニットとして解析できない媒体では`malformed-medium`が拒否されます（移行なし、プレリリース方針）。[`backend.ts`](../../packages/storage/storage/src/backend.ts)は条項ごとの規範的な契約であり、[`tests/contract.ts`](../../packages/storage/storage/tests/contract.ts)にある共有適合性スイートは、各バックエンドに対してすべての条項を検証します。[json バックエンド](../../packages/storage/storage-json/README.md)は、ユニットごとに人間が読める 1 つの完全なファイルをアトミックに再公開します。[sqlite バックエンド](../../packages/storage/storage-sqlite/README.md)は、頻繁に更新されるデータのために、1 つのデータベースで行ごとに 1 つのドキュメントを保存します。

## ドメインの宣言

ドメインは、所有パッケージにより spec オブジェクトとして一度だけ宣言されます。これはドメインの識別情報、レイアウト、レコードスキーマの唯一の情報源です（zod を使用するため、`z.infer`によりコンシューマーの型が重複しません）。

```ts type-equiv
/** Static declaration of one domain: identity, version, and record layout. */
interface DomainSpec {
  /** Domain name; must match `UNIT_NAME_RE` (doubles as the backend unit name). */
  readonly name: string
  /** Domain format version; a medium stamped with a different version rejects at open. */
  readonly version: number
  /** Optional global singleton slot. */
  readonly global?: DomainGlobalSpec<unknown>
  /** Table declarations keyed by table name; each name must match `UNIT_NAME_RE`. */
  readonly tables: Record<string, DomainTableSpec>
}
```

`defineDomain(spec)`は spec のリテラル型を固定し、媒体に触れる前の所有者モジュールのロード時に明示的に失敗させます。`UNIT_NAME_RE`の範囲外にあるドメイン名またはテーブル名、非負整数ではないバージョン、あるいは`null`を受け入れるグローバルスキーマはいずれもスローされます（`null`は媒体の「未書き込み」センチネルであるため、保存された null 許容のグローバルはラウンドトリップできません）。`domainTable<K, V>(schema)`は、ファントムのコンパイル時キー型（通常は[ブランド化 ID](core.md#branded-ids)）を持つテーブルを 1 つ宣言します。`descriptorOf(spec)`はバックエンド向けのユニット記述子を投影します。

## 開かれたドメイン

```ts type-equiv
/** One open domain, typed by its spec. */
interface Domain<S extends DomainSpec> {
  /** Domain name from the spec. */
  readonly name: string
  /** Global singleton handle; a spec without `global` has no usable handle (`never`). */
  readonly global: DomainGlobalHandleOf<S>
  /**
   * Resolve one declared table handle. Handles are stable — repeated calls
   * return the same instance.
   * @param name - Declared table name.
   * @returns the typed table handle.
   */
  table<N extends keyof S['tables'] & string>(name: N): KvTable<TableKeyOf<S, N>, TableValueOf<S, N>>

  /**
   * Close this domain: reject new writes immediately, drain already-queued
   * writes (their events still emit), release the backend unit, then free
   * the domain name for a later open. Idempotent — repeated calls share one
   * teardown. The consumer owns this call (typically as its own `ctx.effect`
   * disposer); the facility closes any domain left open when it unmounts.
   * @returns resolution after the unit is released.
   */
  close(): Promise<void>
}
```

読み取りは、信頼できるインメモリ状態から同期的に行われます。`KvTable` は `get`/`entries`/`keys`/`size` を公開します（キューに入れられた書き込みが反映されている間も安定したままのスナップショットイテレーターです）。また、グローバルハンドルの `get()` は、最初の `set` によりスロットがメディア上に実体化されるまで、仕様の `initial` を提供します。すべての書き込み（`put`、`delete`、`update`、`global.set`）はドメインごとに 1 本のチェーンへキューイングされ、まずバックエンドで耐久性を確保し、次にメモリを変更し、その後 `domain/changed` を発行します。バックエンド書き込みが拒否された場合、メモリは変更されないため、読み取りがメディアと乖離することはありません。`update(key, fn)` はそのチェーンスロットでのアトミックな読み取り・変更・書き込みです（存在しないキーでは `missing-key` を拒否します）。存在しないキーに対する `delete` は、書き込みもイベントも行わず `false` を解決します。返されるレコードはコピーではなく、保存されているオブジェクトそのものです。インプレースで変更せず、`put`/`update` で置き換えてください。

## ドメイン機能: `ctx.storageDomain`

`DomainFacility`（[シグネチャ](#ctxstoragedomain--domainfacility)）は、ルーティングされたバックエンド上で宣言済みドメインを開きます。ルーティングはハブではなくドメインプラグインの設定です。`backend` は必須のデフォルトルートを指定し、`routes` はドメイン名ごとにこれをオーバーライドします。`open(spec)` は厳密な順序で実行され、各ステップで呼び出し全体が失敗します。すでに開かれている、またはまだクローズ中の名前を拒否し（`already-open`）、ルートを解決し（`backend-not-found`）、バックエンドの `kv` ファセットを要求し（`facet-unsupported`）、ユニットを開き（バックエンドの `version-mismatch`/`malformed-medium` はそのまま通過します）、保存済みの各レコードとグローバルを仕様の zod スキーマで検証します（問題のあるテーブルとキーを含む `invalid-record`）。呼び出し元は返されたハンドルを所有し、`Domain.close()` で解放します。プラグインのアンマウント時にまだ開いているドメインはこの機能によって閉じられ、閉じたドメイン名を再度開けるようになるのは、ティアダウンが完全に完了した後だけです。`get(name)` は、型付きハンドルの背後にあるパッケージプライベートな `DomainImpl` ランタイムへの型なし診断ルックアップです。`closeAll()` はアンマウントパスです。

## 変更イベント: `domain/changed`

すべての耐久化された書き込みは、バックエンドが耐久性を確認した厳密に後、ドメインの書き込みチェーン順で 1 つのイベントを発行します（[イベントエントリ](#domainchanged--emit)）。

```ts type-equiv
/** Shared location fields of one durable domain change. */
interface DomainChangedBase {
  /** Owning domain name. */
  readonly domain: string
  /** Table name; `''` for a global-singleton write. */
  readonly table: string
  /** Record key; `''` for a global-singleton write. */
  readonly key: string
}
```

```ts type-equiv
/** One durable domain change; a closed union — switch on `operation`. */
type DomainChanged = DomainChangedPut | DomainChangedDeleted
```

`put`（挿入、上書き、グローバル書き込み）は、新しいスナップショットを `value` に格納します。古い値が格納されることはありません。差分を取るコンシューマーは、独自に前のスナップショットを保持します。`deleted` は値を持たないトゥームストーンです。このイベントは通知であり、トランザクションの参加者ではありません。発行時にはコミットポイントを過ぎているため、同期的に例外を送出するリスナーは、すでに耐久化された書き込みを拒否するのではなく、警告ログとともに封じ込められます。発行値は、発行時点のインメモリ状態と一致します。イベントはプロセス内限定です。プロセス間の変更プッシュは記録済みの制限事項です（[パッケージ README](../../packages/storage/storage-domain/README.md)）。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts` によりソースから生成されます（doc-sync で `pnpm run verify-cordis-catalog` により最新であることを検証し、`pnpm run gen-cordis-catalog` で再生成します）。このセクションはページの両言語版でバイト単位で同一です。シグネチャブロックは `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義されており、フレームワークから継承した `ctx` API は[cordis-api/inherited.md](../cordis-api/inherited.md)にあります。

<a id="ctxstorage--storage"></a>

### `ctx.storage` — `Storage`

ストレージハブサービスです。バックエンドは `backend` の下に登録されます。データフォームはそれぞれの `StorageForms` キーの下にマウントされ、`ctx.storage.<form>` としてアクセスされます。

```ts cordis-catalog
/**
 * Mount a data-form facility on the hub. Mounting is an effect: the
 * returned disposer unmounts the form.
 * @param form - Form key declared in {@link StorageForms}.
 * @param facility - The facility instance to expose.
 * @returns the disposer that unmounts the form.
 */
mount<K extends keyof StorageForms>(form: K, facility: StorageForms[K]): () => void

/**
 * Resolve a mounted data form.
 * @param form - Form key declared in {@link StorageForms}.
 * @returns the mounted facility.
 */
form<K extends keyof StorageForms>(form: K): StorageForms[K]
```

ソース: [`packages/storage/storage/src/index.ts:47`](../../packages/storage/storage/src/index.ts)

<a id="ctxstoragedomain--domainfacility"></a>

### `ctx.storageDomain` — `DomainFacility`

マウントされたドメイン機能です。ルーティングされたバックエンド上で宣言済みドメインを開きます。1 つの機能インスタンスが開いているドメインテーブルを所有し、ドメイン名ごとに 1 回だけ開けることを保証します。

```ts cordis-catalog
/**
 * Open one declared domain. Steps, each failing the whole call: reject a
 * name that is already open (`already-open`); resolve the backend route
 * (`backend-not-found` passes through from the hub); require its `kv` facet
 * (`facet-unsupported`); open the unit projected from the spec (backend
 * `version-mismatch`/`malformed-medium` pass through); load and validate
 * every stored record against the spec's zod schemas (`invalid-record`
 * with the offending table and key); construct the domain.
 *
 * Lifecycle: the CALLER owns the returned handle and closes it via
 * `Domain.close()` (typically as its own `ctx.effect` disposer) — the
 * facility does not tie the domain to any consumer fiber. Domains still
 * open when the facility unmounts are closed by the plugin disposer.
 * @param spec - The domain declaration, typically from `defineDomain`.
 * @returns the opened domain handle, typed by the spec.
 */
async open<S extends DomainSpec>(spec: S): Promise<Domain<S>>

/**
 * Look up an open domain by name, untyped. Diagnostic surface (the package
 * invariant cross-checks change events against live domain state); typed
 * consumers hold the handle returned by {@link open}.
 * @param name - Domain name.
 * @returns the open domain runtime, or `undefined` when not open.
 */
get(name: string): DomainImpl | undefined

/**
 * Close every domain still open on this facility. The unmount path for
 * consumers that never called `Domain.close()` themselves; closing is
 * idempotent, so double-closing an already-closed domain is harmless.
 * @returns resolution after every unit is released.
 */
async closeAll(): Promise<void>
```

ソース: [`packages/storage/storage-domain/src/index.ts:69`](../../packages/storage/storage-domain/src/index.ts)

<a id="domain-events"></a>

### `domain/*` イベント

<a id="domainchanged--emit"></a>

#### `domain/changed` — 発行

ドメインレコードまたはグローバルシングルトンが変更されました。バックエンドが耐久性を確認した厳密に後、書き込みごとに 1 回発行されます。1 つのドメインのイベントは、その書き込みチェーン順で到着します。

```ts cordis-catalog
/**
 * A domain record or the global singleton changed, emitted once per write
 * strictly after the backend acknowledged durability. Events of one
 * domain arrive in its write-chain order.
 * @param change - domain, table (`''` for global), key (`''` for global),
 * operation discriminant, and on `put` the new snapshot.
 * @mode emit
 */
'domain/changed'(change: DomainChanged): void
```

ソース: [`packages/storage/storage-domain/src/events.ts:46`](../../packages/storage/storage-domain/src/events.ts)
<!-- END GENERATED cordis-surface -->
