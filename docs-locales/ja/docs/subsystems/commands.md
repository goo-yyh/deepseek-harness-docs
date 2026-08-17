# 人間向けコマンド

[`dsh-commands`](../../packages/interaction/commands)の人間向けコマンドレジストリサービスです。対話型アダプターはこれを使用して、モデルメッセージを作成せずに、特定のエージェントに対するプラグイン所有コマンドを検出して直接実行します。ディスパッチとライフサイクルの根拠は[コマンドの Agent Note](../../.agents/notes/implemented/feature/2026-07-19-plugin-command-registration.md)が、構成と制約は[パッケージ README](../../packages/interaction/commands/README.md)が担います。

ソース： [`packages/interaction/commands/src/index.ts`](../../packages/interaction/commands/src/index.ts)

## 入力メタデータ

このサービスは、任意の非構造化入力ヒントを 1 つ公開します。コマンドの可用性はプラグイン構成に従います。レジストリを利用するすべてのアダプターは、すべての有効な定義を確認できます。

```ts type-equiv
/** Immutable metadata for a command's optional unstructured input. */
interface CommandInputDescriptor {
  /** Placeholder shown before the user supplies free-form input. */
  readonly hint: string
}
```

## 定義

`CommandDefinition`は、プラグインによって記述される登録です。レジストリは分離された有効定義を検証して固定します。

```ts type-equiv
/** Plugin-owned command registration. */
interface CommandDefinition {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Human-readable summary used in discovery UI. */
  readonly description: string
  /** Optional free-form input hint advertised to capable clients. */
  readonly input?: CommandInputDescriptor
  /**
   * Whether `command/run` records `rawInput`. Defaults to true. A command
   * whose domain event owns the payload sets this false to avoid duplicating
   * that payload in the session log.
   */
  readonly recordInput?: boolean
  /** Execute against the receiving agent without sending the command to the model. */
  readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>
}
```

## 呼び出しと結果

アダプターがキャンセルを管理し、正確な対象エージェントを渡します。`rawInput`は解析済みの名前の直後から始まり、アダプターが渡した区切り文字と接尾辞を保持します。結果はツール結果やセッションイベントではなく、直接的な UI の結果です。

```ts type-equiv
/** Invocation passed to one registered command handler. */
interface CommandInvocation {
  /** Pairing id already written to this invocation's `command/run` event. */
  readonly commandId: CommandId
  /** Exact agent whose UI received the command. */
  readonly agent: Agent
  /** Exact text following the registered command name, including separator whitespace. */
  readonly rawInput: string
  /** Cancellation signal owned by the dispatching UI request. */
  readonly signal: AbortSignal
}
```

```ts type-equiv
/** Expected command outcome rendered directly by the dispatching UI. */
type CommandResult =
  | {
    readonly kind: 'success'
    readonly text?: string
    /** Earlier authoritative domain event that owns a richer presentation. */
    readonly sourceEventSeq?: number
  }
  | { readonly kind: 'error'; readonly text: string }
```

`sourceEventSeq`は任意であり、成功時にのみ使用されます。存在する場合は、受信セッションログ内の先行するコマンド以外のイベントを指します。`command/done`は同じ参照を永続化するため、クライアントは`text`を解析したり隣接する行に依存したりせずに、コマンドのライフサイクルをそのドメイン投影と結合できます。

## 検出と解析のビュー

アダプターは、スコープ解決後にハンドラーを含まない不変の記述子を受け取ります。`parseCommand()`は、レジストリ解決前に`ParsedCommand`を返します。構文的に有効な入力であっても、利用できないコマンドを指定する場合があります。

```ts type-equiv
/** Handler-free immutable command view returned to UI adapters. */
interface CommandDescriptor {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Human-readable summary used in discovery UI. */
  readonly description: string
  /** Optional free-form input hint advertised to capable clients. */
  readonly input?: CommandInputDescriptor
}
```

```ts type-equiv
/** Syntactically valid slash command before registry resolution. */
interface ParsedCommand {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Exact text following the command name. */
  readonly rawInput: string
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

ソースから`scripts/gen-cordis-catalog.ts`によって生成されます（doc-sync では`pnpm run verify-cordis-catalog`により最新であることを検証し、`pnpm run gen-cordis-catalog`で再生成します）。このセクションはページの両言語版でバイト単位で同一です。シグネチャブロックは`ts cordis-catalog`フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義され、フレームワークから継承される`ctx` API は[cordis-api/inherited.md](../cordis-api/inherited.md)にあります。

<a id="ctxcommands--commandruntime"></a>

### `ctx.commands` — `CommandRuntime`

人間向けコマンドレジストリです。プレーンコンテキストの定義はグローバルです。エージェントコンテキストのコマンド注入された子を介して登録された定義は、そのエージェントではグローバル定義より優先されます。

```ts cordis-catalog
/**
 * Register a global or calling-agent-scoped command.
 * @param definition - discovery metadata and direct UI handler.
 * @returns the exact effect disposer that unregisters this definition.
 */
register(definition: CommandDefinition): () => void

/**
 * List the effective immutable command descriptors for one agent.
 * @param agent - exact receiving agent and scoped-layer key.
 * @returns name-sorted descriptors after scoped shadowing.
 */
@Remote list(agent: Agent): readonly CommandDescriptor[]

/**
 * Resolve one effective command definition.
 * @param agent - exact receiving agent and scoped-layer key.
 * @param name - command name without a slash.
 * @returns the scoped shadow or global definition.
 */
find(agent: Agent, name: string): CommandDefinition | undefined

/**
 * Parse and execute a known command without sending it to the model.
 *
 * A resolved command's lifecycle is logged: `command/run` is appended
 * before the handler is invoked and `command/done` after settlement (a
 * thrown or aborted handler settles as `kind: 'error'`). Both are direct
 * log-only appends — no turn wraps them, and persistence drains them at
 * ordinary checkpoints. Admission misses (syntax or unknown name) log
 * nothing — they never entered a handler. A `command/run` append failure
 * fails the execution loud; a `command/done` append failure on the
 * handler-failure path is contained so the handler's own error stays the
 * reported failure.
 *
 * @param agent - exact receiving agent.
 * @param line - complete slash-command line.
 * @param signal - cancellation signal owned by the UI request.
 * @returns the settled execution (result + lifecycle pairing id), or
 *   `undefined` when syntax or name does not resolve.
 */
@Remote async execute( agent: Agent, line: string, signal: AbortSignal, ): Promise<CommandExecution | undefined>
```

型: [Agent](core.md)

ソース： [`packages/interaction/commands/src/index.ts:225`](../../packages/interaction/commands/src/index.ts)

<a id="commands-events"></a>

### `commands/*`イベント

<a id="commandschange--emit"></a>

#### `commands/change` — emit

コマンドが登録または登録解除されました。グローバルまたはスコープ付きの変更はいずれの UI ビューにも影響し得るため、これはフィルターされないレジストリ通知です。オブザーバーの失敗は封じ込められ、レジストリの変更を拒否することはできません。

```ts cordis-catalog
/**
 * A command was registered or unregistered. This is an unfiltered registry
 * notification because a global or scoped change may affect any UI view.
 * Observer failures are contained and cannot veto the registry mutation.
 * @mode emit
 */
'commands/change'(): void
```

ソース： [`packages/interaction/commands/src/types.ts:72`](../../packages/interaction/commands/src/types.ts)
<!-- END GENERATED cordis-surface -->
