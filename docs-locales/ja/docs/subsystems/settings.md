# ユーザー設定

[dsh-settings](../../packages/settings/settings) のユーザー設定シームは、名前空間ごとのセクションからなる、ユーザーが所有する 1 つのドキュメントを保持します。登録済みの各名前空間は、スキーマのデフォルト、次に登録者の合成 `base`、最後にユーザーセクションの順に解決されます。[dsh-settings-file](../../packages/settings/settings-file) のようなプロバイダーは生のドキュメントを保存して外部編集をプッシュし、コンシューマープラグインはスキーマを登録して解決済みの値を読み取るか監視します。合成設定は `cordis.yml` に保持されます。名前空間が持つのは、ユーザーが編集可能なサブセットだけです。

ソース： [`packages/settings/settings/src/index.ts`](../../packages/settings/settings/src/index.ts)

## 識別情報

名前空間は、ユーザードキュメント内のプラグイン所有セクションを 1 つ指定します。ブランドにより、呼び出し元が設定名前空間と、パッケージまたはプロセス間で渡される他の ID を混同することを防ぎます。構築時には小文字のケバブケース構文を検証します。

```ts type-equiv
/** Nominal id of one registered settings namespace. */
type SettingsNamespace = Branded<'SettingsNamespace'>
```

## 登録

登録では、schemastery スキーマを呼び出し元プラグインのファイバー上の名前空間に結び付けます。そのファイバーを破棄すると、名前空間とそのオブザーバーは削除されます。オプションには、合成レイヤー、所有者のエフェクトタイミング、およびスキーマで表現できない内容に対する任意の検査を指定します。

```ts type-equiv
/** Registration options beyond the namespace schema. */
interface SettingsRegisterOptions<T> {
  /** Composition-layer values resolved below the user layer (entry-config subset). */
  base?: Partial<T>
  /** Owner's effect timing, surfaced to configuration UIs; defaults to `live`. */
  applies?: SettingsApplies
  /**
   * Reject a resolved section the owner could not act on, for constraints its
   * schema cannot express — a cross-field requirement, or one field's validity
   * depending on another's. Throwing here refuses the *write* that produced the
   * value, so a caller learns at `update`/`replace`/`mutate` instead of storing
   * something that would silently disable the owner.
   *
   * Kept separate from the schema because the schema is also what a
   * configuration surface renders and what an absent section resolves through;
   * folding a cross-field check into it would change both.
   *
   * Once the owner is registered, a stored section that fails this keeps the
   * namespace's last good value and warns, exactly as a schema failure does,
   * so an externally edited document cannot strand a running owner. At
   * registration there is no last good value yet, so a stored section that
   * already fails rejects the registration itself — again exactly as a schema
   * failure does.
   * @param value - the resolved section, schema-valid by construction.
   */
  validate?: (value: T) => void
}
```

`validate` は、スキーマが値を受け入れた後に実行されるため、所有者が受け取るものとまったく同じデフォルトと合成ベースを確認できます。`dsh-llm-pi-ai` は、生成元の書き込み時点で処理できなかったプロバイダープロファイルを拒否するためにこれを使用します。これにより、名前空間内のすべてのルートを無効化するプロファイルを保存しません。

`applies` はメカニズムではなく UI ヒントです。`restart` の所有者は単に監視しないため、その値は構築時に一度だけ読み取られ、設定画面では保留中の変更をバッジ表示できます。

```ts type-equiv
/** When a namespace's changes take effect for its owner. */
type SettingsApplies = 'live' | 'restart'
```

## 所有者スコープ

スコープは所有者向けのハンドルです。`update` は、ユーザーセクションに対してのみ疎なパッチをマージします（`base` には決してマージしません）。`replace` はセクション全体を設定し、削除およびリセットの経路となります。置換後に存在しないキーは、`base` とスキーマのデフォルトを再継承します。1 つの名前空間への書き込みは呼び出し順に直列化され、解決済みの値はディープフリーズされたスナップショットです。

```ts type-equiv
/** Owner-facing handle for one registered namespace. */
interface SettingsScope<T> {
  /** Current resolved value: schema defaults, then `base`, then the user layer. */
  get(): T
  /**
   * Observe committed changes to this namespace's resolved value. Invocations
   * of one callback run asynchronously, one at a time, in commit order; a
   * rejection is contained and logged like a sync throw. After the disposer
   * returns, no further invocation starts — one already queued is skipped;
   * one already started still settles, and service disposal waits for it.
   * @param callback - invoked after each commit with the next and previous values.
   * @returns the disposer removing this observer.
   */
  watch(callback: (next: T, prev: T) => void | Promise<void>): () => void
  /**
   * Merge a partial patch into this namespace's user layer and persist it.
   * @param patch - plain-object patch over the user section; JSON-compatible data
   * only (non-JSON values reject with their path before anything persists).
   */
  update(patch: object): Promise<void>
  /**
   * Replace this namespace's user section wholesale; absent keys re-inherit
   * the composition `base` and schema defaults (`replace({})` resets all).
   * @param section - the complete next user section; JSON-compatible data only,
   * as for {@link update}.
   */
  replace(section: object): Promise<void>
}
```

## 記述子

`describe()` は、設定画面向けに登録済みのすべての名前空間をシリアライズします。schemastery の `toJSON()` エンベロープがスキーマで描画されるフォームを駆動し、解決済みの値がそれらを埋めます。また、分離された `base`/`user` レイヤーにより、フォームは存在を基準にユーザーが上書きしたフィールドをマークできます。すべてのワイヤー画面で必須の `describe({ redactSecrets: true })` は、3 つのレイヤーすべてから `role('secret')` フィールドを取り除き、その `{path, set}` スロットを列挙します。これにより、ページは秘密情報を受け取ることなく書き込み専用入力を描画できます。

```ts type-equiv
/** One registered namespace as surfaced to configuration UIs. */
interface SettingsDescriptor {
  /** The registered namespace. */
  ns: SettingsNamespace
  /** Serialized schemastery schema (`schema.toJSON()`). */
  schema: unknown
  /** Current resolved value. */
  value: unknown
  /**
   * Monotonic revision of the raw user section this descriptor was read at.
   * Send it back as `expectedRevision` on a write to refuse a stale one.
   */
  revision: number
  /** Registrant's composition `base` layer (detached), when one was declared. */
  base?: unknown
  /**
   * Raw user section from the stored document (detached), when one exists and
   * is well-formed; a field's presence here is what marks it user-overridden.
   */
  user?: unknown
  /** Owner's declared effect timing. */
  applies: SettingsApplies
  /** Schema-declared secret positions; present only under `redactSecrets`. */
  secrets?: RedactedSecret[]
}
```

編集済み記述子だけを保持する呼び出し元は、セクションを安全に再構築できません。そのため、削除は代わりにパス操作として伝達されます。各記述子には、生のセクションに対する `revision` も含まれます。書き込みではこれを `expectedRevision` として返送でき、すでに一致しなくなっている場合は、先に反映された書き込みの上に適用するのではなく拒否されます。
```ts type-equiv
/**
 * One path-addressed edit to a namespace's user section. Path mutation exists
 * for a caller holding an INCOMPLETE view of the section — a configuration UI
 * reads the redacted descriptor, which by construction never received the
 * `role('secret')` fields. Such a caller can name the field it means without
 * restating the section: a wholesale `replace` rebuilt from a redacted
 * document silently deletes every secret the wire never returned.
 */
type SettingsPathOp =
  | { op: 'set'; path: readonly string[]; value: unknown }
  | { op: 'unset'; path: readonly string[] }
```

```ts type-equiv
/** Options for {@link SettingsProvider.describe}. */
interface SettingsDescribeOptions {
  /**
   * Strip `role('secret')` fields from `value`/`base`/`user` and enumerate
   * them in each descriptor's `secrets`. Every wire surface MUST pass this;
   * the verbatim default exists for same-process configuration UIs only.
   */
  redactSecrets?: boolean
}
```

## 変更のコミット

プロセス内書き込みまたは外部で観測されたプロバイダー編集である、コミット済みのすべての変更は、新しい値が確定した後に `settings/updated (ns, next, prev, source)` を発行します。解決後の値がディープイコールの場合は発行しません。ソースタグによって、2 つのエントリパスを区別します。

```ts type-equiv
/** Origin of one committed settings change. */
type SettingsUpdateSource = 'update' | 'provider'
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts` によりソースから生成されています（doc-sync で `pnpm run verify-cordis-catalog` によって最新であることを検証します。再生成には `pnpm run gen-cordis-catalog` を使用します）。このセクションはページの両言語版でバイト単位で同一です。シグネチャブロックでは `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは [入門](../cordis-primer.md#dispatch-modes) で定義されており、フレームワークから継承した `ctx` API は [cordis-api/inherited.md](../cordis-api/inherited.md) にあります。

<a id="ctxsettings--settingsprovider-abstract-seam"></a>

### `ctx.settings` — `SettingsProvider`（抽象的な接合部）

抽象設定サービスです。プロバイダーは生ドキュメントの保存（`load`/`persist`）を実装し、外部変更を Settings.publish を通じて通知します。基底クラスは名前空間の登録、解決、検証、変更検出、および `settings/updated` コミットイベントを担います。

```ts cordis-catalog
/**
 * Prepare the provider's user-editable document for a native editor. File
 * providers may materialize an absent document before returning its path;
 * non-file providers return undefined.
 * @returns the absolute local document path, or undefined for non-file storage.
 */
prepareDocument(): Promise<string | undefined>

/**
 * Register a namespace schema and receive its owner scope. The registration
 * is an effect on the calling plugin's fiber: disposing that fiber removes
 * the namespace and its observers. An invalid stored section fails the
 * registration itself — the earliest point where the schema can judge it.
 * @param ns - unique namespace; duplicate registration fails loud.
 * @param schema - schemastery schema resolving this namespace's value.
 * @param options - composition `base` layer and effect timing.
 * @returns the owner scope for reads, observation, and updates.
 */
register<T>(ns: SettingsNamespace, schema: z<T>, options?: SettingsRegisterOptions<T>): SettingsScope<T>

/**
 * Describe every registered namespace for configuration surfaces, including
 * the composition `base` and raw user layers so a form can mark which fields
 * the user overrode (presence in `user`) and what a reset returns to.
 * @param options - redaction switch; wire surfaces must redact.
 * @returns one descriptor per registered namespace, in registration order.
 */
describe(options?: SettingsDescribeOptions): SettingsDescriptor[]

/**
 * Read one registered namespace's resolved value.
 * @param ns - the namespace to read.
 * @returns the resolved value, or `undefined` while unregistered.
 */
get(ns: SettingsNamespace): unknown

/**
 * Merge a patch into one registered namespace's user layer, validate the
 * resolved candidate, persist through the provider, then commit and emit.
 * A validation failure rejects before anything is persisted. Writes to one
 * namespace are serialized: concurrent updates apply in call order, each
 * merging over the previous write's committed section.
 * @param ns - the registered namespace to update.
 * @param patch - plain-object patch over the user section.
 * @param expectedRevision - the descriptor `revision` the caller read; a
 *   namespace that moved past it rejects with {@link SettingsConflictError}.
 */
async update(ns: SettingsNamespace, patch: object, expectedRevision?: number): Promise<void>

/**
 * Replace one registered namespace's user section wholesale, validate,
 * persist, then commit and emit. Keys absent from `section` fall back to the
 * composition `base` and schema defaults — this is the removal/reset path a
 * merge-only patch cannot express (`replace({})` re-inherits everything).
 * @param ns - the registered namespace to replace.
 * @param section - the complete next user section.
 * @param expectedRevision - the descriptor `revision` the caller read; a
 *   namespace that moved past it rejects with {@link SettingsConflictError}.
 */
async replace(ns: SettingsNamespace, section: object, expectedRevision?: number): Promise<void>

/**
 * Apply path-addressed edits to one registered namespace's user section,
 * validate, persist, then commit and emit. The ops are applied to the
 * section as it stands when the write reaches the front of the queue, so a
 * caller never has to restate fields it did not touch — and, crucially,
 * cannot delete fields it never saw. This is the write path for any caller
 * holding a redacted view; `replace` remains the wholesale reset.
 * @param ns - the registered namespace to edit.
 * @param ops - ordered path edits; later ops observe earlier ones.
 * @param expectedRevision - the descriptor `revision` the caller read; a
 *   namespace that moved past it rejects with {@link SettingsConflictError}.
 */
async mutate(ns: SettingsNamespace, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>
```

ソース: [`packages/settings/settings/src/index.ts:350`](../../packages/settings/settings/src/index.ts)

<a id="settings-events"></a>

### `settings/*` イベント

<a id="settingsdocument-updated--emit"></a>

#### `settings/document-updated` — 発行

解決後の値が変更されたかどうかにかかわらず、登録済み名前空間の RAW ユーザーセクションが 1 つ変更されました。`settings/updated` はコンシューマー向けイベントであり、ディープイコールでのゲートを維持します。これは設定画面のために存在し、フィールドが継承からオーバーライドへ移行したこと（解決後の値は同じでも意味は異なること）、および保持しているリビジョンが古くなったことを認識できるようにします。リスナーの封じ込めは `settings/updated` と一致します。

```ts cordis-catalog
/**
 * One registered namespace's RAW user section changed, whether or not the
 * resolved value did. `settings/updated` is the consumer-facing event and
 * stays deep-equal-gated; this one exists for configuration surfaces,
 * which must learn that a field went from inherited to overridden (same
 * resolved value, different meaning) and that their held revision is
 * stale. Listener containment matches `settings/updated`.
 * @param ns - the namespace whose stored section changed.
 * @param revision - the namespace's new revision.
 * @mode emit
 */
'settings/document-updated'(ns: SettingsNamespace, revision: number): void
```

ソース: [`packages/settings/settings/src/types.ts:48`](../../packages/settings/settings/src/types.ts)

<a id="settingsupdated--emit"></a>

#### `settings/updated` — 発行

登録済み名前空間の 1 つにおける解決後の値へのコミット済み変更です。プロバイダーが変更を永続化した後（`update`）または公開した後（`provider`）に発行されます。解決後の値がディープイコールの場合は発行されません。リスナーの失敗は、同期スローと非同期リジェクションのいずれも封じ込められてログに記録されます。ただし、`INVARIANT` でコード化された失敗は例外で、すべてのリスナーの実行後に再スローされます。この再スローが発行元に到達するのは同期リスナーからのみであるため、このイベントの不変条件チェックを非同期関数にしてはいけません。

```ts cordis-catalog
/**
 * Committed change to one registered namespace's resolved value. Emitted
 * after the provider persisted (for `update`) or published (`provider`)
 * the change; never emitted when the resolved value is deep-equal.
 * Listener failures are contained and logged — a sync throw and an async
 * rejection alike — except `INVARIANT`-coded failures, which rethrow
 * after every listener ran; that rethrow reaches the emitter only from
 * synchronous listeners, so invariant checks on this event must not be
 * async functions.
 * @param ns - the namespace whose resolved value changed.
 * @param next - the new resolved value.
 * @param prev - the previous resolved value.
 * @param source - whether the change entered through `update()` or the provider.
 * @mode emit
 */
'settings/updated'(ns: SettingsNamespace, next: unknown, prev: unknown, source: SettingsUpdateSource): void
```

ソース: [`packages/settings/settings/src/types.ts:35`](../../packages/settings/settings/src/types.ts)
<!-- END GENERATED cordis-surface -->
