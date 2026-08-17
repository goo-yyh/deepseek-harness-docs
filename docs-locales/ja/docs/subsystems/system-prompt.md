# システムプロンプトの組み立て

[system-prompt パッケージ](../../packages/core/system-prompt)は、プロンプトコントリビューターと1回の組み立て呼び出しの間で交換されるデータを管理します。このパッケージの[README](../../packages/core/system-prompt/README.md)では、登録、順序付け、スコープ設定、レンダリングの動作を説明しています。このページでは、プラグインが実装または受け渡しするパッケージ間の正確な型を記録します。

出典: [`packages/core/system-prompt/src/index.ts`](../../packages/core/system-prompt/src/index.ts).

## 組み立てコンテキスト

`AssembleContext`は、1回の組み立てで解決するスコープレイヤーを識別し、そのリクエストの明示的な制御シグナルを保持できます。これはマージによって拡張可能です。`dsh-agent`は任意のライブ`agent`フィールドを追加し、`assembleContextFor(agent, signal)`は明示的なフィールドをまとめて設定します。スコープもシグナルもない組み立てはベアな組み立てです。

```ts type-equiv
/** Merge-extensible context for one prompt assembly. */
interface AssembleContext {
  /**
   * Scope whose providers and waterfall listeners participate. When absent,
   * only global providers and subject-less listeners participate.
   */
  scope?: ScopeKey
  /** Explicit control signal for the turn that requested this assembly, when any. */
  signal?: AbortSignal
}
```

## ツールプロバイダーの結果

`ToolProviderResult.schemas`は、現在の組み立てでモデルから見えるセットです。`knownNames`は、設定された名前のタイプミスと、このスコープで意図的に非表示にされている既知のツールを区別するために使用する、プロバイダーの制限適用前の名前空間です。

```ts type-equiv
/** Tool schemas visible in one assembly and their pre-restriction name set. */
interface ToolProviderResult {
  /** The schemas this provider contributes to THIS assembly. */
  readonly schemas: readonly ToolSchema[]
  /** The pre-restriction name universe for config validation (defaults to `schemas`' names). */
  readonly knownNames?: readonly string[]
}
```

## プロンプトセクション

`PromptSection`は、読み取り専用の同一プロセス内登録コントラクトです。そのテキストは静的にすることも、現在の組み立てコンテキストから解決することもできます。有効な`complete`セクションが1つある場合、協調的な組み立て後の唯一のプロンプトセクションになります。

```ts type-equiv
/** One contributed section of the system prompt (registry input). */
interface PromptSection {
  /** Unique name — a duplicate registration throws (see {@link SystemPrompt.section}). */
  readonly name: string
  /**
   * Sections are concatenated in ascending order. Convention: `-100` is the
   * harness identity, `0` the deployment persona, tool guidance uses 100–199;
   * other negative orders also render before the persona.
   */
  readonly order: number
  /**
   * Static text or a provider evaluated at each assembly with that assembly's
   * {@link AssembleContext}. The text may reference `{{variable}}`s — they are
   * interpolated later, by {@link renderPrompt}.
   */
  readonly text: string | ((context: AssembleContext) => string)
  /**
   * Treat this contribution as the complete system prompt. Assembly still
   * runs the cooperative waterfall so tools, contexts, and variables can be
   * resolved, then restores this exact section as the sole prompt section.
   * More than one effective complete section makes assembly fail.
   */
  readonly complete?: boolean
}
```

## 動的プロンプトコンテキスト

`PromptContext`は、`PromptSection`に対応するキャッシュセーフな仕組みです。組み立てはこれらのコントリビューションを解決して順序付けます。一方、agent-loop は、保持されたモデル履歴の後に、変更された場合またはコンパクションで削除された場合に限り、その完全な現在のスナップショットをログに記録します。

```ts type-equiv
/** Dynamic model context materialized as a durable user-role snapshot. */
interface PromptContext {
  /** Unique name — a duplicate registration throws (see {@link SystemPrompt.context}). */
  readonly name: string
  /** Contexts are joined in ascending order. */
  readonly order: number
  /** Static text or a provider evaluated for each assembly. Empty text contributes nothing. */
  readonly text: string | ((context: AssembleContext) => string)
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

ソースから`scripts/gen-cordis-catalog.ts`によって生成されます（doc-sync で`pnpm run verify-cordis-catalog`により最新性を検証します。`pnpm run gen-cordis-catalog`で再生成できます）。このセクションは、ページの両言語版でバイト単位で同一です。シグネチャブロックは`ts cordis-catalog`フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義されており、フレームワークから継承される`ctx` API は[cordis-api/inherited.md](../cordis-api/inherited.md)にあります。

<a id="ctxsystemprompt--systemprompt"></a>

### `ctx.systemPrompt` — `SystemPrompt`

各モデルステップの前に組み立てられるプロンプト入力のレジストリサービスです。

```ts cordis-catalog
/**
 * Register an ordered prompt section in the calling context's scope. A scoped
 * section shadows a global section with the same name; duplicates within one
 * layer and non-finite orders throw. Registration and disposal emit
 * `system-prompt/change`.
 * @param section - the section to register.
 * @returns the exact Cordis effect disposer.
 */
section(section: PromptSection): () => void

/**
 * Register ordered dynamic context in the calling context's scope. Scoped
 * entries shadow global entries with the same name.
 * @param context - the context contribution to register.
 * @returns the exact Cordis effect disposer.
 */
context(context: PromptContext): () => void

/**
 * Suppress every dynamic runtime-context contribution in the calling
 * context's scope without changing the services that own or enforce those
 * facts. Multiple suppressors remain independently disposable.
 * @returns the exact Cordis effect disposer.
 */
suppressRuntimeContext(): () => void

/**
 * Register a tool-schema provider in the calling context's scope. Global and
 * matching scoped providers both contribute; returning the reserved
 * {@link TOOL_ORDER_REST} name makes assembly fail.
 * @param provider - evaluated for each assembly with its context.
 * @returns the exact Cordis effect disposer.
 */
tools(provider: (context: AssembleContext) => ToolProviderResult): () => void

/**
 * Register a prompt variable in the calling context's scope. Scoped values
 * shadow globals; invalid or duplicate names throw. A provider may return
 * `undefined`, but rendering a section that references that value then fails.
 * @param name - the `[a-z][a-z0-9_]*` reference name.
 * @param provider - evaluated for each assembly.
 * @returns the exact Cordis effect disposer.
 */
variable(name: string, provider: (context: AssembleContext) => string | undefined): () => void

/**
 * Assemble global and scoped providers, detach tool parameters, apply
 * canonical ordering, then run the assembly waterfall. Scoped sections and
 * variables shadow globals. The returned waterfall value is authoritative
 * except that an effective complete section is restored afterwards as the
 * sole prompt section.
 * @param context - the optional scope and plugin-defined assembly fields.
 * @returns the post-waterfall assembly with any complete prompt enforced.
 */
async assemble(context: AssembleContext = {}): Promise<PromptAssembly>
```

出典: [`packages/core/system-prompt/src/index.ts:338`](../../packages/core/system-prompt/src/index.ts)

<a id="system-prompt-events"></a>

### `system-prompt/*`イベント

<a id="system-promptassemble--waterfall"></a>

#### `system-prompt/assemble` — ウォーターフォール

組み立てられたセクション、コンテキスト、ツール、変数に対するエキスパート向けウォーターフォールです。スコープでフィルタリングされたディスパッチ（`@deepseek-ai/dsh-scope`）では、スコープ付きリスナーはそのスコープの組み立てのみを受け取ります。返される値が権威ある値です。指定されたシグナルはこの明示的な組み立てリクエストのみを制御し、後続のターンを制御するために保持してはなりません。登録済みの完全なセクションはこのウォーターフォールの後に復元されるため、リスナーはそのスコープのシステムプロンプトに追加したり置き換えたりできません。

```ts cordis-catalog
/**
 * Expert waterfall over the assembled sections, contexts, tools, and variables.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): scoped listeners
 * receive only that scope's assemblies. The returned value is authoritative.
 * A supplied signal controls only this explicit assembly request and must not
 * be retained to control later turns. A registered complete section is
 * restored after this waterfall, so listeners cannot add to or replace
 * that scope's system prompt.
 * @param assembly - the mutable assembly built from registered providers.
 * @param context - the caller's per-assembly context.
 * @mode waterfall
 */
'system-prompt/assemble'(this: Scoped<SystemPrompt>, assembly: PromptAssembly, context: AssembleContext, next: () => Promise<PromptAssembly>): Promise<PromptAssembly>
```

型: [Scoped](scope.md)

ソース: [`packages/core/system-prompt/src/index.ts:31`](../../packages/core/system-prompt/src/index.ts)

<a id="system-promptchange--emit"></a>

#### `system-prompt/change` — 発行

いずれかのプロンプトプロバイダーが変更されると発行されます。グローバルな変更はすべてのスコープに影響するため、このレジストリ通知はフィルタリングされません。

```ts cordis-catalog
/**
 * Emitted when any prompt provider changes. This registry notification is
 * unfiltered because a global change affects every scope.
 * @mode emit
 */
'system-prompt/change'(): void
```

ソース: [`packages/core/system-prompt/src/index.ts:37`](../../packages/core/system-prompt/src/index.ts)
<!-- END GENERATED cordis-surface -->
