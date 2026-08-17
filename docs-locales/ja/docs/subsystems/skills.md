# スキル

[スキル機能ファミリー](../../packages/skill)には、サービス定義（[dsh-skill](../../packages/skill/skill)、`ctx.skills`）、ローカルのサービスプロバイダー（[dsh-skill-filesystem](../../packages/skill/skill-filesystem)）、任意のパッケージ化されたバッジプロバイダー（[dsh-skill-badge](../../packages/skill/skill-badge)）、およびコンシューマー（[dsh-tool-skill](../../packages/skill/tool-skill)）が含まれます。レジストリは、ホスト層とスコープごとの層をまたいでプロバイダーカタログをマージします。プロバイダーはローカルまたはパッケージ化されたスキルを提供し、コンシューマーは初期カタログと置換カタログ、およびモデル向けの`skill`ツールを所有します。スキルはセッションイベントではなく任意の指示であるため、その語彙は[core.md](core.md)ではなくここにあります。

出典: [`packages/skill/skill/src/index.ts`](../../packages/skill/skill/src/index.ts)、[`packages/skill/skill-filesystem/src/index.ts`](../../packages/skill/skill-filesystem/src/index.ts)、[`packages/skill/skill-badge/src/index.ts`](../../packages/skill/skill-badge/src/index.ts)、および[`packages/skill/tool-skill/src/index.ts`](../../packages/skill/tool-skill/src/index.ts)。

## プロバイダーレジストリ

`ctx.skills`は、ローカル、埋め込み、リモート、またはその他のプロバイダーを組み合わせます。登録は同期的に行われます。リモートの初期化と検出は、await される`list()`で行います。プロバイダーオブジェクト、オプション、候補は読み取り専用で借用され、意味的フィールドは検証されます。

レジストリは、[ツールレジストリ](tools.md)が[dsh-scope](../../packages/core/scope)上に確立した形態である、ホスト＋スコープごとの階層構造です。登録は呼び出しコンテキストのスコープ層に格納されるため、ホスト行とリポジトリプラグインはグローバル層に配置され、エージェントプリセットの常設コンポジションによってマウントされたプラグインはそのプリセットの層に配置されます。プロバイダー名はプロセス全体ではなく層ごとに一意です。読み取りでは、グローバル層と閲覧中スコープのチェーンをマージします。最も近い層のエントリが重複するスキル名を完全に優先し、以下のランク順序は同一層内の重複だけを決定します。検出キャッシュは解決済みスコープチェーンでキー付けされるため、スコープの親を変更すると（空白セッションの再コンポーズ）、レジストリを変更しなくても次回の読み取りに反映されます。

同一層内では、重複する名前はランク、プロバイダー順、ローカル順で解決されます。要約は名前順に並びます。拒否された`list()`はログに記録され、不完全な観測からは除外されます。一方、明示的な不完全観測は、結果をキャッシュ可能にせずに使用可能な候補を提供します。不正な候補は即座に失敗します。各プロバイダーファクトリーは登録スコープのコントロールを受け取ります。その`invalidate()`は、正確にその登録がアクティブである間だけ完了済みカタログをクリアし、そのシグナルは登録失敗時または破棄時に中断します。進行中の検出はプロバイダー世代が変わると一度再試行します。2 回目の変更では、最新の候補を不完全かつ未キャッシュとして返します。プロバイダーおよびランタイムの変更は、フィルタリングされていない`skills/change`無効化イベントを発行します。このイベントには差分が含まれないため、コンシューマーは自身のルックアップオプションで`snapshot()`を再取得します。

`SkillProvider.list()`が返す配列は、完全検出の省略記法です。`SkillProviderObservation`を使用すると、プロバイダーは観測が信頼できるものではないと報告しながら、直接ロード可能な候補を公開できます。

```ts type-equiv
/** Provider candidates plus whether the current discovery is authoritative. */
interface SkillProviderObservation {
  /** Candidates available from the current provider discovery. */
  readonly candidates: readonly SkillCandidate[]
  /** Whether discovery completed and these candidates may be cached. */
  readonly complete: boolean
}
```

```ts type-equiv
/** Provider interface for one source of skills, such as local directories or a remote registry. */
interface SkillProvider {
  /** Unique provider name in the `ctx.skills` registry. */
  readonly name: string
  /**
   * List available skill candidates for the current lookup context. Provider
   * plugins register synchronously during `apply()`; remote initialization,
   * authentication, and discovery are awaited inside this method. Implementations
   * should settle promptly when `options.signal` aborts.
   * @param options - lookup options; `cwd` selects workspace-sensitive skills and `signal` cancels work.
   * @returns provider candidates as a complete-array shorthand, or an explicit
   *   observation when usable candidates came from incomplete discovery.
   */
  readonly list: (options: SkillLookupOptions) => Promise<readonly SkillCandidate[] | SkillProviderObservation>
  /**
   * Load a complete skill body for a previously listed candidate.
   * @param candidate - the winning candidate originally returned by this provider.
   * @param options - lookup options; `cwd` selects workspace-sensitive skills and `signal` cancels work.
   * @returns the full skill body, or `undefined` if it is no longer loadable.
   */
  readonly get: (candidate: SkillCandidate, options: SkillLookupOptions) => Promise<SkillDefinition | undefined>
}
```

```ts type-equiv
/** Registration-scoped lifecycle and invalidation capability borrowed by one provider. */
interface SkillProviderControl {
  /** Aborts if registration fails or when the exact provider registration is disposed. */
  readonly signal: AbortSignal
  /** Invalidate completed catalogs and notify consumers only while the exact registration remains active. */
  readonly invalidate: () => void
}
```

## ローカル検出の優先順位

付属のローカルプロバイダーは、ランク順にルートをスキャンします。

| ランク | ソース | ルート |
|---|---|---|
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `Config.customSkillDirs` |
| 400 | `user-dsh` | `<dshHome>/skills` |
| 500 | `user-agents` | `<agentsHome>/skills` |
| 600 | `bundled` | `Config.bundledSkillDir` 設定されている場合 |

プロジェクトルートは、`.git`を含む最も近い祖先です。存在しない場合は、現在の cwd が使用されます。`ctx.fs`が利用可能な場合、git ルート探索はファイルシステムサービスを通じて`.git`を調べるため、リモートまたはサンドボックス化されたワークスペースがホストファイルシステム境界にフォールバックすることはありません。ユーザー DSH ルートは、その`.system`子をスキップします。ローカルプロバイダーは組み込みシステムスキルを生成しません。デプロイでは、設定済みのバンドルルートまたは専用プロバイダーを通じてパッケージ化されたスキルを提供します。

`dsh-skill-badge`は、`BUNDLED_SKILL_RANK`に不変の`bundled`候補を 1 つ登録し、`resourceBase`を通じてそのパッケージ化されたアセットディレクトリを公開します。付属の CLI ではプラグインが無効と宣言されているため、そのコンポジション行を有効化するには明示的なオプトインが必要です。

Chokidar は、既存のルートを監視し、直接のバンドルまたはフラットエントリの追加・削除と、直接のスキルエントリの変更を検出します。存在しないルートは、最も近い既存の祖先から、Chokidar がアタッチできるようになるまで、不在のパスセグメントを一度に 1 つずつたどります。バンドル内のリソースファイルはカタログ変更ではありません。モデル向けの`write`および`edit`観測は、対象がカタログに関連する場合にプロバイダーを同期的に無効化します。一方、ホストウォッチャーは IDE、Git、シェル、および外部プロセスによる変更を対象とします。ウォッチャーの失敗により現在の観測は不完全になりますが、直接ロードから読み取り可能な候補が隠されることはありません。プロジェクトスコープのウォッチャーには、設定済みの上限付き LRU が使用されます。

## スキルの識別子

スキル名は kebab-case（`^[a-z0-9]+(?:-[a-z0-9]+)*$`）です。ローカルプロバイダーはディレクトリバンドル（`<name>/SKILL.md`）とフラットな Markdown ファイル（`<name>.md`）を受け付けます。ネストした再帰的な`**/SKILL.md`検出はサポートされません。

```ts type-equiv
/** Origin bucket for a skill contribution. The value is prompt-visible metadata, not precedence by itself. */
type SkillSource = 'project-dsh' | 'project-agents' | 'runtime' | 'user-dsh' | 'user-agents' | 'custom' | 'bundled' | (string & {})
```

## 要約、候補、および完全な定義

`SkillSummary` は、レジストリにおける呼び出し非依存の要約形状です。コンシューマーは表示するエントリとフィールドを選択します。モデルセッションのカタログでは、モデルから呼び出し可能な `name` と `description` のみを使用し、本体や絶対ファイルパスは使用しません。`SkillInvocationPolicy` は、独立した 2 つの呼び出し制御を正の真偽値に正規化します。解決済みのすべての要約、候補、定義は、任意のフロントマターをドメインモデルに変換することなく、この情報を保持します。

```ts type-equiv
/** Invocation controls shared by skill discovery consumers. */
interface SkillInvocationPolicy {
  /** Whether model-facing catalogs and loaders include this skill. */
  readonly modelInvocable: boolean
  /** Whether human-facing command catalogs and loaders include this skill. */
  readonly userInvocable: boolean
}
```

```ts type-equiv
/** Invocation-neutral skill metadata returned by `ctx.skills.list()`. */
interface SkillSummary {
  /** Kebab-case identifier used to address the skill. */
  readonly name: string
  /** Short routing description shown by discovery consumers. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** Resolved model and user invocation controls. */
  readonly invocation: SkillInvocationPolicy
  /** Discovery source that produced this winning skill. */
  readonly source: SkillSource
  /** Provider that owns this skill body. */
  readonly provider: string
  /** Provider-specific base for relative resources. */
  readonly resourceBase?: SkillResourceBase
}
```

`ctx.skills.list()` は、4 つすべてのポリシー組み合わせを保持します。`isModelInvocable(skill)` と `isUserInvocable(skill)` は、対応する必須フィールドを読み取ります。モデル専用スキルでは `{ modelInvocable: true, userInvocable: false }` を設定し、ユーザー専用スキルでは `{ modelInvocable: false, userInvocable: true }` を設定します。両方のフィールドを `false` に設定すると、信頼できる `ctx.skills.get()` 呼び出し元からのみスキルを利用できます。ローカルプロバイダーは、正確なケバブケースのフロントマターキー `disable-model-invocation` と `user-invocable` を読み取り、省略されたフィールドの既定値を `true` にして、解析されたすべてのスキルをこの正規化済みポリシーへ投影します。

`SkillCatalogSnapshot` は、権威ある不在と、一時的なプロバイダー障害または検出中に変更され続けたカタログとを区別します。`skills` には、その観測で収集された、ソート済みの呼び出し非依存要約が含まれます。`complete` が true になるのは、登録済みのすべてのプロバイダーがカタログの同時改訂なしに完了した場合のみです。不完全なスナップショットはキャッシュされないため、各コンシューマーは最後に正常だったフィルター済みカタログを保持して再試行できます。

```ts type-equiv
/** One catalog observation plus whether discovery completed within a stable catalog revision. */
interface SkillCatalogSnapshot {
  /** Sorted invocation-neutral summaries collected in this observation. */
  readonly skills: SkillSummary[]
  /** Whether every registered provider completed without a concurrent catalog revision. */
  readonly complete: boolean
}
```

`SkillCandidate` は、プロバイダーからレジストリへの形状です。`locator` は不透明なプロバイダー状態です。レジストリはこれを保存するだけで、勝者となったプロバイダーの `get()` に返します。

```ts type-equiv
/** Provider catalog entry used by the registry to merge and later load skills. */
interface SkillCandidate extends SkillSummary {
  /** Lower ranks win duplicate skill names before provider registration order is considered. */
  readonly rank: number
  /** Opaque provider-owned handle passed back to `provider.get()`. */
  readonly locator: unknown
  /** Absolute file path when the provider has one. */
  readonly path?: string
  /** Parsed optional metadata object from provider-specific skill frontmatter. */
  readonly metadata?: Readonly<Record<string, unknown>>
}
```

`SkillDefinition` は、`ctx.skills.get()` が返し、`skill` ツールが使用する完全な解析結果です。`resourceBase` は、ローカル、URL、またはプロバイダー管理のスキルについて、相対リソースの案内をツールがどのように表示するかを指示します。

```ts type-equiv
/** Optional provider-specific base used by loaded skill bodies to resolve relative resources. */
type SkillResourceBase =
  | { readonly kind: 'directory'; readonly path: string }
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'opaque'; readonly description: string }
```

```ts type-equiv
/** Complete parsed skill definition, including the body loaded by `ctx.skills.get()`. */
interface SkillDefinition extends SkillSummary {
  /** Markdown instruction body after any provider-specific metadata removal. */
  readonly content: string
  /** Absolute file path when the skill came from disk. */
  readonly path?: string
  /** Parsed optional metadata object from frontmatter. */
  readonly metadata?: Readonly<Record<string, unknown>>
}
```

ランタイムのスキル入力では、呼び出し制御とプロバイダーラベルを省略できます。レジストリは両方の既定値を一度解決した後、プロバイダーと同じ完全な定義形状および先勝ちの収集順序を使用します。返される破棄関数は、登録内容を削除し、検出キャッシュを無効化します。

```ts type-equiv
/** Runtime skill contribution accepted by `ctx.skills.register()`. */
type SkillRegistration = Omit<SkillDefinition, 'invocation' | 'provider'> & {
  /** Invocation controls; omission permits both model and user surfaces. */
  readonly invocation?: SkillInvocationPolicy
  /** Provider label; omission uses the registry-owned runtime provider. */
  readonly provider?: string
}
```

## 検索と設定

スキル検索は cwd に依存します。これは、プロバイダーがワークスペースローカルのスキルを公開する場合があるためです。また、オプションのシグナルは、呼び出し元のためにプロバイダー処理をキャンセルします。レジストリの読み取りでは、さらに閲覧スコープ（コンシューマーは呼び出し元エージェントを渡し、それ自体がスコープキーです）を `SkillViewOptions` 経由で受け取ります。レジストリはレイヤー選択のために `scope` を使用し、プロバイダーは同じ借用オプションオブジェクトから自身の `SkillLookupOptions` 契約のみを読み取ります。キャンセルは、キャッシュヒットを含め、カタログ選択の前後で確認され、検出と完全定義の読み込みの両方で競合します。git ルートが見つからない場合、ローカルプロバイダーは指定された cwd 自体をプロジェクトルートとして扱います。

完全定義はレジストリでキャッシュされません。各 `get()` は、選択された候補とともに勝者のプロバイダーを呼び出すため、ローカルプロバイダーは現在の本体を再読み込みします。名前がその候補と一致しなくなった定義は拒否され、再検出のために正確なプロバイダーが無効化されます。

```ts type-equiv
/** Caller context used for cwd-sensitive and abortable provider work. */
interface SkillLookupOptions {
  /** Workspace selector for the current lookup. */
  readonly cwd?: string | undefined
  /** Abort discovery or loading work for the current caller. */
  readonly signal?: AbortSignal | undefined
}
```

```ts type-equiv
/**
 * Registry read options: provider lookup context plus the viewing scope.
 * The registry consumes `scope` to select layers; providers receive the same
 * borrowed options object and read only their {@link SkillLookupOptions}
 * contract from it.
 */
interface SkillViewOptions extends SkillLookupOptions {
  /** Viewing scope (the calling agent); omitted reads the global layer alone. */
  readonly scope?: ScopeKey | undefined
}
```

レジストリが所有するのは、検出キャッシュの上限のみです。ローカルプロバイダーは、ファイルシステムルート（`dshHome`、`agentsHome`、`customSkillDirs`、および任意の `bundledSkillDir`/`DSH_BUNDLED_SKILL_DIR`）に加え、ウォッチャーの有効化、ポーリング、安定性、シンボリックリンク、プロジェクト容量の制御を所有します。コンシューマーは、カタログ記述の上限を所有します。正確な既定値と検証については、生成された [設定カタログ](../config-catalog.md) を参照してください。

```ts type-equiv
/** Skill registry configuration. */
interface Config {
  /** Maximum number of completed cwd/provider catalogs kept in memory. */
  readonly collectCacheMaxEntries?: number
}
```

## セッションカタログとツールの契約

`dsh-tool-skill` は、空でない完全なビューを確認するライブセッションの最初の `agent/pre-step` で、初期の永続的なユーザーロール `<system-reminder>` を注入します。カタログには、ソート済みのスキル `name` と正規化され XML エスケープされた `description` のみが含まれ、本文、パス、ソース、プロバイダー、ルーティングヒントは省略されます。検出は、ステップの中止シグナルを `SkillLookupOptions` を介して転送します。`catalogDescriptionMaxLength` は説明の上限に関するコンシューマー設定で、デフォルトは `500`、整数の最小値は `3` です。

後続の各モデルステップの前に、コンシューマーは正確なツール可視性を適用し、完全なスナップショットから `<available_skills>` タグの間にある正確にレンダリングされたエントリをダイジェストします。比較ベースラインは、プラグインが発信元である、最新の認識可能な可視カタログメッセージ内の同じエントリから導出します。ダイジェストが変更されると、`agent.inject()` を通じて永続的な完全置換を追加します。すべてのスキルを削除すると、明示的な空の置換を追加します。不完全なスナップショットでは、最後に正常だったモデルビューが維持されます。圧縮によって履歴上のカタログメッセージがすべて隠れた場合、次の完全なスナップショットが現在のカタログを再確立します。以前のカタログがない空のビューでは何も出力されません。これらのカタログメッセージはセッション履歴であり、World State ではありません。

モデル向けの `skill({ name })` ツールは、ケバブケース名を検証し、呼び出しに依存しないカタログで要約を見つけ、`isModelInvocable` がアクセスを許可しない限り読み込み前に拒否します。次に、呼び出し元エージェントの cwd に対して完全な定義を再読み込みし、コンテンツを返す前にポリシーを再確認します。未解決のスキルは不明または利用できなくなったものとして報告し、`<skill_content name="...">`、`<skill_resources>`、`<skill_instructions>` を含むツール結果を返します。`resourceBase` は明示的に参照されたスクリプト、リファレンス、アセットのみを必要に応じて解決します。読み込まれた結果ではスキルディレクトリを列挙しません。そのため、本文のみの編集はカタログメッセージを生成したり、以前のツール結果を書き換えたりせずに、後続のツール呼び出しを変更します。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

ソースから `scripts/gen-cordis-catalog.ts` により生成されます（doc-sync で `pnpm run verify-cordis-catalog` により最新であることを検証し、`pnpm run gen-cordis-catalog` で再生成します）。このセクションはページの両言語側でバイト単位で同一です。シグネチャブロックでは `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは [入門](../cordis-primer.md#dispatch-modes) で定義されており、フレームワークから継承される `ctx` API は [cordis-api/inherited.md](../cordis-api/inherited.md) にあります。

<a id="ctxskills--skillregistry"></a>

### `ctx.skills` — `SkillRegistry`

ツールレジストリが確立した、スキルプロバイダーの階層型レジストリです。ホストとスコープごとの構成を持ちます。登録は呼び出し元コンテキストのスコープ（scopeOf）のレイヤーに登録されます。ホスト行とリポジトリプラグインはグローバルレイヤーに配置され、エージェントプリセットの常設コンポジションによってマウントされたプラグインはそのプリセットのレイヤーに配置されます。読み取りでは、グローバルレイヤーと閲覧スコープのチェーンをマージします。最も近いレイヤーのエントリが重複名を完全に優先し、ランク順は同一レイヤー内の重複に対してのみ決定要因となります。ソート済みの呼び出しに依存しない要約を公開し、完全なスキル本文をオンデマンドで読み込みます。

```ts cordis-catalog
/**
 * Register a borrowed same-process provider synchronously during plugin
 * apply, into the calling context's layer: a scoped context (an agent
 * preset's standing mount) registers for that scope alone, an unscoped
 * context registers globally. Duplicate names within one layer and reserved
 * names throw; remote initialization belongs in `list()`. Fiber disposal
 * unregisters the provider and invalidates catalog caches.
 * @param create - synchronous factory receiving this registration's lifecycle and invalidation control.
 * @returns the exact Cordis effect disposer that unregisters this provider;
 *   composite effects may yield it directly to preserve teardown ordering.
 */
registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void

/**
 * Register a borrowed readonly runtime skill into the calling context's
 * layer. Project entries outrank runtime entries, which outrank user
 * entries, within one layer. Same-name runtime entries in one layer are
 * first-wins; a duplicate logs a warning and receives a no-op disposer so
 * it cannot remove the winner.
 * @param skill - the skill definition input; omitted invocation and provider fields receive defaults.
 * @returns the exact Cordis effect disposer, preserving composite teardown order and invalidating caches.
 */
register(skill: SkillRegistration): () => void

/**
 * List invocation-neutral skill summaries for a workspace. Consumers apply
 * model or user invocation policy at their operational boundary. Lookup
 * options and provider candidates are readonly same-process values borrowed
 * throughout discovery.
 * @param options - view options; `scope` selects the viewing agent's layers, `cwd` selects project roots, and `signal` cancels discovery.
 * @returns all sorted winning summaries.
 */
async list(options: SkillViewOptions = {}): Promise<SkillSummary[]>

/**
 * Observe the current invocation-neutral catalog and whether discovery completed within a stable revision.
 * Incomplete observations are never cached, allowing consumers to retain last-good state and
 * retry on their next request boundary.
 * @param options - view options; `scope` selects the viewing agent's layers, `cwd` selects project roots, and `signal` cancels discovery.
 * @returns sorted summaries plus discovery-completeness state.
 */
async snapshot(options: SkillViewOptions = {}): Promise<SkillCatalogSnapshot>

/**
 * Load and validate the winning candidate, passing its opaque discovery locator back to the
 * provider. Cancellation is rechecked after selection, including cache hits, and raced against
 * loading so an uncooperative provider cannot hang the caller.
 * @param name - kebab-case skill name.
 * @param options - view options; `scope` selects the viewing agent's layers,
 *   `cwd` selects workspace-sensitive skills, and `signal` cancels work.
 * @returns the full skill, including body content, or `undefined`.
 */
async get(name: string, options: SkillViewOptions = {}): Promise<SkillDefinition | undefined>
```

ソース: [`packages/skill/skill/src/index.ts:357`](../../packages/skill/skill/src/index.ts)

<a id="skills-events"></a>

### `skills/*` イベント

<a id="skillschange--emit"></a>

#### `skills/change` — 送出

スキルプロバイダー、ランタイムコントリビューション、またはプロバイダー支援カタログが変更された可能性があります。これはフィルタリングされない無効化通知です。コンシューマーは自身の検索オプションに対してカタログを再取得します。リスナーの失敗は封じ込められ、レジストリの変更を拒否することはできません。

```ts cordis-catalog
/**
 * A skill provider, runtime contribution, or provider-backed catalog may
 * have changed. This is an unfiltered invalidation notification; consumers
 * refetch the catalog for their own lookup options. Listener failures are
 * contained and cannot veto the registry mutation.
 * @mode emit
 */
'skills/change'(): void
```

ソース: [`packages/skill/skill/src/index.ts:297`](../../packages/skill/skill/src/index.ts)
<!-- END GENERATED cordis-surface -->
