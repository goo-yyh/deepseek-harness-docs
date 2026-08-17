# コア

**core**  サブシステムは、[`packages/core`](../../packages/core/README.md)です。これは、すべてのコンポジションが起動するパッケージ群であり、イベントソーシングされたセッションログ、システムプロンプトの組み立て、ツールレジストリ、エージェント型、それらを駆動する具体的なループで構成されます。このページでは、`agent`/`agent-loop` ペアが宣言する内容、すなわちエージェントの作成と所有の方法、`Agent` ハンドルの配信、キャンセル、インターセプトに関する契約、さらにすべてのサブシステムが従う 2 つの型パターンについて説明します。このグループ専用のページとフォルダー内の残りの項目は、[サブシステム README](README.md)に索引化されています。

## パッケージごとの中核

1 回のターンは、6 つのパッケージを 1 つのループとして流れます。[`agent-loop`](../../packages/core/agent-loop) 内のドライバーがキューに入ったプロンプトを取得し、[セッションログ](session.md)（`ctx.sessions`）でターンを開始します。次に、[system-prompt](system-prompt.md)（`ctx.systemPrompt`）を通じてリクエストのプレフィックスを組み立て、ログから履歴を導出し、[LLM 抽象境界](llm-streaming.md)を通じてモデル応答をストリーミングします。ツール呼び出しは[ツールレジストリ](tools.md)（`ctx.tools`）を通じてディスパッチされ、次のステップがログから導出される前に、モデルから見えるすべての事実がログへ追記されます。ループが扱う会話語彙、すなわち `Message`、`ContentBlock`、`StreamChunk`、モデルリクエストは、[`packages/llm`](../../packages/llm/README.md)で宣言され、[llm-streaming.md](llm-streaming.md)で文書化されています。

| パッケージ | 所有するもの | ページ |
|---|---|---|
| `session/` | 追記専用の `SessionEvent` ログとインメモリストア。唯一の信頼できる情報源（`ctx.sessions`）です。 | [session.md](session.md) |
| `system-prompt/` | プロンプトセクションとツールスキーマの組み立て（`ctx.systemPrompt`） | [system-prompt.md](system-prompt.md) |
| `tools/` | スコープ付きツールレジストリと保護された実行パイプライン（`ctx.tools`） | [tools.md](tools.md) |
| `agent/` | `Agent` インターフェース、ライブレジストリ、開始者スコープ、`agent/*` イベント語彙（`ctx.agents`） | このページ |
| `agent-loop/` | 公開 `Agent` 契約を実装する具体的なドライバー（`ctx.agentLoop`） | このページ |
| `scope/` | レジストリとループがエージェントごとのスコープを構築するために用いる、スコープ付き登録プリミティブ | [scope.md](scope.md) |

`scope/` は唯一の非サービスパッケージです。これは依存関係のないライブラリ（`createScope`/`scopeOf`/`scopeTarget`）であり、モジュールグラフでは `session/` と `system-prompt/` の下位に置かれています。これにより、それらは循環なしにこのライブラリを利用できます。`agent-loop` は公開 `Agent` 契約の唯一の具体的実装であり、Harness のデフォルト製品ループであるためここにあります。各ドライバーは `ctx.agents.withInitiator()` 内で実行されます。拡張プラグインは、開始元 Agent が必要な場合を含め、`agent` に依存し、`agent-loop` に直接依存することはありません。そのためループは差し替え可能なままです。この中核を実行可能なエージェントへ配線するデフォルトのコンポジションは、[`examples/agent-spine-demo`](../../packages/examples/agent-spine-demo/README.md)です。

## 作成と所有

コンシューマーは `ctx.agents` を通じてエージェントを作成します。`create()` は呼び出し元が指定した 1 つの `SessionId` の下で新しいセッションとエージェントを構築し、`resume()` はまず永続化済みセッションを読み込みます。または、ループの設定エントリを通じて宣言的に作成できます。プログラムによる作成では、所有者のハンドルが返されます。

ソース： [`packages/core/agent/src/index.ts`](../../packages/core/agent/src/index.ts)

```ts type-equiv
/**
 * An owned agent plus its disposer, returned by {@link AgentRegistry.create} /
 * {@link AgentRegistry.resume}. The disposer is a CAPABILITY: among consumers,
 * only the holder can tear this agent down. The registered factory provider is
 * also a structural owner because the scoped agent depends on that provider's
 * service API; provider unload stops and drains every live handle it made.
 * `dispose()` stops the loop, awaits its exit, unregisters the agent, removes
 * its session from the store, and finally unwinds its scoped world.
 *
 * `ctx.agents.get(id)` still returns a bare {@link Agent} — the handle is
 * exposed only to the consumer owner that created it; the structural provider
 * reaches the same teardown internally. Config-created agents (the loop's own
 * startup) are owned by the loop fiber and never need a handle.
 */
interface AgentHandle {
  agent: Agent
  dispose(): Promise<void>
}
```

`CreateAgentOptions` は、共有 ID と、新しいエージェントが公開前に必要とするすべてを保持します。セッションメタデータ（`meta`、検証済みの `cwd`、フォーク系統、シード境界、起点分類、委任深度）、フォーク用の任意の `seed` リプレイプレフィックス、エージェントごとの `AgentOptions`、作成時のみのキャンセル `signal`、および `setup` です。`ResumeAgentOptions` は永続化された ID に対応するものです。`resumeSessionId`、`agentOptions`、`signal`、および `setup` が含まれます。`setup` コールバック（`AgentSetup`）は、両方の ID がまだ未公開の間にエージェントのスコープ付き世界を構成します。`agentCtx` を通じて登録されたすべては、`agent/created` と最初のプロンプト組み立てより前に存在します。また、公開直前に呼び出される同期コミットを返すこともできます。セットアップの拒否、コミット時の例外、または所有者の破棄が発生すると、どちらの ID も公開せずにトランザクションがロールバックされます。

`AgentFactory` はレジストリの背後にある作成インターフェースです。ループは `ctx.agents.setFactory()` を通じてそのファクトリを登録するため、コンシューマーは具体的なループパッケージに依存せずに `ctx.agents` を使用できます。正確な `create`/`resume` シグネチャとロールバック契約については、下の[生成セクション](#ctxagents--agentregistry)を参照してください。

## エージェントハンドル

`Agent` は、すべてのプラグイン（UI、フック、オーケストレーター）が利用するインターフェースです。`ctx.agents.get(id)` はこれを返し、[開始者スコープ](#initiating-agent)がこれを保持します。具体的な実装は dsh-agent-loop パッケージ内部にあり、ループ外部のものはそれに依存しません。統一された `send` メソッドは、ターゲットとウェイクアップのルーティングを直接公開します。`followup`、`steer`、および `inject` は、固定プリセットのエイリアスです。

ソース： [`packages/core/agent/src/types.ts`](../../packages/core/agent/src/types.ts)

```ts type-equiv
/** Public live-agent handle. */
interface Agent {
  /** The single identity shared with {@link session}. */
  readonly id: SessionId
  /** The provider route and model this agent's requests use. */
  readonly options: AgentOptions
  /** The live session this agent drives; its log is the durable source of truth. */
  readonly session: Session
  /** The agent-owned projection of durable pending work. */
  readonly inbox: Inbox
  /** The current lifecycle state, mirrored on every `agent/status` transition. */
  readonly status: AgentStatus
  /** Agent-scoped context; its contributions are agent-local, unwind on disposal, and reject registration afterward. */
  readonly ctx: Context

  /**
   * Clear queued and steering work — unless `keepInbox` — and abort the active
   * turn or between-turn task. The first cause wins for that activity. With no
   * active activity, cancellation is a no-op and does not arm later work.
   * @param cause - the stable caller intent carried by the active operation signal.
   * @param options - cancellation options; `keepInbox` preserves pending work.
   */
  cancel(cause: AgentCancelCause, options?: CancelOptions): void

  /**
   * Resolve after the current whole-agent activity reaches quiescence. This
   * follows replacement work started before the observed driver retires,
   * but does not identify the settlement of any particular message.
   * @returns fulfillment after no active driver or maintenance task remains.
   */
  whenIdle(): Promise<void>

  /**
   * Run one non-turn maintenance task from the true idle phase. The task starts
   * synchronously after claiming that phase; later waking input remains in the
   * inbox until the task settles, while public status stays `idle`.
   * `whenIdle()` follows both the task and any waking work released behind it.
   * @param task - operation whose fulfillment or rejection is preserved, with a signal aborted by {@link cancel}.
   * @throws synchronously when turn-driving or another maintenance task already owns the agent.
   * @returns the task promise.
   */
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>

  /**
   * Route identified input to an inbox boundary and optionally wake the driver.
   * Waking input submitted after active cancellation is queued for the next
   * turn and runs when the aborted activity converges to idle; a `disposed`
   * cancel leaves it parked. A wake submitted while already idle always opens
   * its turn boundary, even when its message is cleared before the driver
   * claims ([cancel-convergence wake latch](../../../../.agents/notes/implemented/bug-fix/2026-08-07-cancel-convergence-wake-latch.md)).
   * @param message - identified content and the source that supplied it.
   * @param target - the preferred next-turn or next-step inbox boundary.
   * @param wakeup - whether delivery may wake the driver.
   */
  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void

  /**
   * Queue an ordinary follow-up turn and wake the driver. The item becomes the
   * sole ordinary message of its own turn.
   * @param message - identified prompt content and the source that supplied it.
   */
  followup(message: UserMessage): void

  /**
   * Submit steering for the nearest step. An idle driver starts a turn;
   * a running driver consumes it at its next step boundary.
   * A rejected step leaves steering parked in the inbox until the next
   * wake; cancellation or disposal may discard pending steering.
   * @param message - identified steering content and the source that supplied it.
   */
  steer(message: UserMessage): void

  /**
   * Queue model-facing context for the next pre-step without waking the
   * driver. A running driver claims it at the nearest later step boundary;
   * idle drivers leave it pending until follow-up or steering
   * wakes them. It may miss a request whose pre-step already claimed its
   * batch. Cancellation or disposal may discard pending context.
   * @param message - identified injected context and the source that supplied it.
   */
  inject(message: UserMessage): void
}
```

```ts type-equiv
/**
 * An agent's lifecycle state, emitted on every transition as `agent/status`:
 * `idle` means no driver is active; `running` begins when waking input starts
 * cancellable pre-step processing and lasts while the driver drains,
 * closes, or checkpoints turns. Disposal removes the agent from its registry;
 * it is not a third observable status.
 */
type AgentStatus = 'idle' | 'running'
```

`running` はドライバー全体のドレイン間隔を示し、連続してキューに入れられたターンにまたがる場合があります。これはターンがまだ開いていることを証明するものではありません。破棄するとエージェントはレジストリから削除され、`agent/disposed` が発行されます。これは終端ステータス値ではありません。`followup()` はハンドルを返しません。その `MessageId` は、永続的な受信トレイへの挿入、取得、破棄に関する事実を識別するものであり、後続のアシスタント出力やターン終了を識別するものではありません。`whenIdle()` はエージェント全体を監視するため、呼び出し元はその間隔を明示的に所有している場合にのみ、レシートからアイドル状態までの間隔を実行と呼べます（[判断](../../.agents/notes/implemented/architecture/2026-07-30-followup-enqueue-and-owned-runs.md)）。

```ts type-equiv
/** Merge-extensible agent creation options. Persona belongs to system-prompt sections. */
interface AgentOptions {
  /** Provider route (must have a registered adapter at call time). */
  provider?: string
  /** Model id interpreted by the selected provider adapter. */
  model?: string
  /** Maximum output tokens for each conversation-model request. */
  maxTokens?: number
}
```

ディスパッチには、`agent/request` の後に `provider` と `model` が必要です。指定する場合、`maxTokens` は正の安全な整数でなければならず、すべての会話モデルリクエストに上限を設定します。省略した場合は、リクエストヘッダーの前に厳密なモデルアダプターのデフォルトが具体化されるか、それ以外ではプロバイダーの動作が変更されません。エージェントスコープの `deployment:persona` プロンプトセクションは、グローバルなデフォルトペルソナをシャドーできます。

受信トレイは配信の語彙です。これは、エージェントが所有する 2 つの順序付き保留メッセージリストを永続的に投影したものです。

```ts type-equiv
/** One of the two ordered pending-message lists owned by an agent. */
type InboxTarget = 'next-turn' | 'next-step'
```

保留中の各出現はその `UserMessage` であり、`MessageId` が唯一の識別子です。`Inbox.append`、`prepend`、`replace`、`remove`、`clear`、`splice`、および `claim` は、正規化された永続的な `agent/inbox/spliced` の変更を記録し、重複する保留 ID を拒否します。`replace(messageId, newMessage)` と `remove(messageId)` は、両方のリストにまたがって保留メッセージを検索します。置換では ID が変わることがあり、古いメッセージを破棄済みとして発行した後に、新しいメッセージを挿入済みとして発行します。通常の削除と `clear()` はキャンセルです。`claim(target)` は、提案されたステップバッチ、つまりすべての `next-step` 入力と、ターン境界では 1 つの `next-turn` メッセージを、破棄通知を発行しない純粋な削除スプライスによって削除します。ループは別途、メッセージごとの取得済み通知を発行します。UI 投影などのキュー全体のコンシューマーは、永続スプライスから `nextTurn` と `nextStep` を再構築します。一方、1 つのメッセージを追跡するコンシューマーは、正確な `agent/inbox/inserted`、`claimed`、および `discarded` の通知を使用します。

キャンセル：

```ts type-equiv
/** Options for {@link Agent.cancel}. */
interface CancelOptions {
  /**
   * Preserve queued and steering inbox items instead of discarding them. The
   * active turn is still aborted, but un-started and pending work survives for a
   * later turn and no canceled inbox splice is logged.
   */
  keepInbox?: boolean | undefined
}
```

```ts type-equiv
/** Why an active agent driver was cancelled. */
type AgentCancelCause =
  | { readonly kind: 'user' }
  | { readonly kind: 'parent' }
  | { readonly kind: 'hook'; readonly reason: string }
  | { readonly kind: 'disposed' }
```

原因は、TypeScript によって強制される同一プロセス内の入力です。アクティブなキャンセル保持者はこれをランタイム専用の `AbortSignal.reason` にコピーします。シグナルは協調するリスナーに分類の権限を与えません。永続的な `turn/end` は大まかな `{ kind: 'aborted' }` の結果を保持します。誰がキャンセルを要求したかを記録するには、終了結果を過負荷にするのではなく、別の永続イベントが必要です。

[イベント分類](../architecture.md#events)が、`agent/*` のライフサイクル、チェックポイント、ウォーターフォールの契約を担います。ターンとステップの境界は、エージェントの emits ではなく永続的なセッションイベントです。

## 開始元エージェント

`ctx.agents` が保持するプロセスローカルの開始元は、上記の正確な `Agent` であり、別のフレームやコピーされた ID ではありません。周囲に存在することは、生存性の証明でも認可でもありません。その存続期間とスコープの規則は、[開始元スコープの決定](../../.agents/notes/implemented/architecture/2026-07-15-agent-initiator-scope.md)で定義されます。

## インターセプトの決定

ステップ前の決定では、永続的なユーザーロール入力と同じ識別済み `UserMessage` 型を使用します。入力されたバッチが正規であり、各メッセージの `id` と `source` をすべて保持します。フックブリッジは、ネイティブの決定フィールドをこの型付き結果にマッピングします。

出典: [`packages/core/agent/src/types.ts`](../../packages/core/agent/src/types.ts)

`agent/pre-step` は、排他的に取得したバッチ（`messages`）、提案されたステップの座標（`turn`、`step`）、および現在のターンのキャンセル `signal` を含む 1 つのペイロードを受け取ります。初期提案は、どのステップよりも前に、開いているターン内で実行されます。ツール継続は、ステップ間で空の取得済みバッチを送信できます。

これは `PreStepDecision` を返します。拒否ではステップは開始されません。入力では、`step/start` の後に追加される完全なメッセージバッチを指定します。最終決定で省略された取得済みメッセージは削除されたままとなり、取得後に挿入された入力は保留されたままです。

```ts type-equiv
/** Whether and with which messages the loop enters a proposed step. */
type PreStepDecision =
  | { kind: 'reject' }
  | { kind: 'enter'; messages: UserMessage[] }
```

`agent/request-error` は、失敗したモデルステップが閉じた後、かつそのターンが閉じる前に実行されます。失敗したターンのシグナルがまだ有効な間、リスナーは永続状態を修復したり、ポリシー処理を待機したりできます。処理するリスナーは、`next()` を呼び出さずに `{ kind: 'retry' }` を返します。デフォルトの `undefined` では、失敗は終了状態のままです。

```ts type-equiv
/** Action returned by a listener that owns model-request recovery. */
type RequestErrorAction = { kind: 'retry' } | undefined
```

`agent/pre-step` は、リクエスト導出前にある唯一の直列リスナーチェーンです。`agent/turn-stopping` は、ターンにツールまたはステアリングの継続がない場合に、最後のステアリングドレインの前に実行されます。

`agent/session-start` は `SessionStartSource` を保持します（セッションライフサイクルが開始した理由。ブリッジはこれを SessionStart マッチャーのキーとして使用します）。

```ts type-equiv
/** Why a session lifecycle began; seeded creates are `startup`, while persisted loads are `resume`. */
type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'
```

## セッション

`Session` は、型付き `SessionEvent` の **追記専用ログ** であり、唯一の信頼できる情報源です。LLM のメッセージ履歴は、別途保存されるのではなく、ログ（`deriveMessages()`）から *導出されます* 。各エントリには、単調増加する `seq`、`time`、および `type` で識別される `data` ペイロードがあります。表層バリアントは、`sourceEventSeqs` で引用した以前のイベントを列挙し、`surfaceOp` を持つこともできます。

`SessionEvent` エンベロープの正確な条件付きフィールド、12 のイベントバリアント（`turn/start`、`turn/end`、`step/start`、`step/end`、`user/message`、`assistant/chunk`、`assistant/message`、`tool/call`、`tool/result`、`steering/message`、`todo/write`、`request/header`）、`deriveMessages()` の投影規則、`TurnTrigger`/`TurnEndReason` の理由、実行エンクロージャおよびスタンドアロンイベントの規則については、**[session.md](session.md)** にあります。ログを永続化する方法、すなわち `SessionPersistence` インターフェース、JSONL/SQLite バックエンド、`session/flush` チェックポイント、クラッシュリカバリ、`SessionHeader` については、**[persistence.md](persistence.md)** にあります。

## `ToolDefinition`

パイプライン作成においてコアとなる唯一の型です。登録されたすべてのツールが *何であるか* 、すなわちモデル向けの `ToolSchema`、`execute` 関数、任意の最終コンテンツおよび UI コールバックを表します。ツール作成者がこれを手作業で構築することはほとんどありません（`defineTool` DSL が型付き引数で構築します）が、これはレジストリが保持し、ループがディスパッチする契約です。

完全なフィールド、`defineTool`/`ValueSchemaSpec`/`ParameterSchemaSpec` の型付きスキーマ DSL、`ToolExecution`/`ToolExecutionResult` のウォーターフォール型、ツール表示用 UI 型については、**[tools.md](tools.md)** にあります。

## リポジトリ全体の型パターン

すべてのサブシステムで繰り返し使われる 2 つのパターンを、ここでまとめて説明します。

<a id="the-map--derived-union-pattern"></a>

### `…Map → derived-union` パターン

Harness のほぼすべての拡張可能な直和型は、1 つのパターンに従います。すなわち、識別タグ（`…Map`）をキーとするインターフェースから、`keyof` によりユニオンを導出します。プラグインは、所有パッケージを編集せずに、**宣言のマージ** によってバリアントを追加します。

```ts ignore-check
// The pattern, schematically:
interface ThingMap {
  'a': { kind: 'a'; /* … */ }
  'b': { kind: 'b'; /* … */ }
}
type ThingKind = keyof ThingMap          // 'a' | 'b'
type Thing = ThingMap[keyof ThingMap]    // the discriminated union

// A plugin extends it without touching the source package:
declare module '@deepseek-ai/dsh-llm' {
  interface ThingMap {
    'c': { kind: 'c'; /* … */ }
  }
}
```

6 つの正規マップがこのパターンを使用します。プラグイン作成者はこれらを拡張します。

| マップ | パッケージ | 導出先 | カタログ |
|---|---|---|---|
| `ContentBlockMap` | dsh-llm | `ContentBlock` | [llm-streaming.md](llm-streaming.md#content-blocks-and-messages) |
| `MessageSourceMap` | dsh-llm | `MessageSource` | [llm-streaming.md](llm-streaming.md#content-blocks-and-messages) |
| `FinishReasonMap` | dsh-llm | `FinishReason` | [llm-streaming.md](llm-streaming.md#the-model-request-and-result) |
| `TurnTriggerMap` | dsh-session | `TurnTrigger` | [session.md](session.md) |
| `TurnEndReasonMap` | dsh-session | `TurnEndReason` | [session.md](session.md) |
| `SessionEventMap` | dsh-session | `SessionEvent` | [session.md](session.md) |

コンシューマーが最も頻繁に `switch` する大きな判別ユニオンは 2 つあります。**`StreamChunk`** （ストリーミングプロトコル）と、**`SessionEvent`** （ログエントリ）です。リポジトリの規約に従い、タグには `switch` を使用します。`if` を連鎖させないでください。これにより各分岐が絞り込まれ、タグのタイプミスはコンパイルに失敗します。

### ブランド化された ID

パッケージ間で渡される ID は **ブランド化されています** 。構造上は文字列ですが、型レベルでは交換できません（`SessionId` が期待される場所に `CallId` を渡すことはできません）。構築は型ごとのファクトリを通じて行います。比較、ログ記録、JSON では通常の文字列として動作します。

`Branded<B>` プリミティブは、独自の型専用パッケージである [dsh-brand](../../packages/util/brand) にあります（ランタイムコードも Harness パッケージへの依存もありません）。そのため、どのパッケージも無関係な機能パッケージに依存せずに、所有する ID をブランド化できます。

出典: [`packages/util/brand/src/index.ts`](../../packages/util/brand/src/index.ts)

```ts type-equiv
/** A string carrying a compile-time-only brand `B`. */
type Branded<B extends string> = string & { readonly [BRAND]: B }
```

2 つのコア ID は、`CallId`（ツール呼び出しとその結果を関連付けます。dsh-llm）と `SessionId`（共有されるライブエージェントおよび永続セッションの ID。dsh-session）です。機能パッケージも独自の ID をブランド化します。たとえば、[jobs.md](jobs.md) の `JobId` です。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts` によりソースから生成されます（doc-sync で `pnpm run verify-cordis-catalog` により最新であることを確認済み。`pnpm run gen-cordis-catalog` で再生成できます）。このセクションは、ページの両言語版でバイト単位で同一です。シグネチャブロックでは `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義され、フレームワークから継承される `ctx` API は[cordis-api/inherited.md](../cordis-api/inherited.md)にあります。

<a id="ctxagentdefaultmodel--agentdefaultmodelconfig"></a>

### `ctx.agentDefaultModel` — `AgentDefaultModelConfig`

Host やトランスポートに依存せず、デフォルトのモデル選択を所有します。コンポジションエントリは設定プロバイダーなしでも使用できます。設定プロバイダーがマウントされている場合は、そのユーザーレイヤーをライブで読み取ります。

```ts cordis-catalog
/**
 * Read the current default model selection.
 * @returns a detached provider, model, and optional reasoning selection.
 */
currentSelection(): ModelSelection

/**
 * Save the complete default model selection. A deployment without a settings
 * provider keeps its composition entry.
 * @param next - resolved selection accepted by an entry point.
 * @returns fulfillment after the optional settings write settles.
 */
async saveSelection(next: ModelSelection): Promise<void>
```

ソース: [`packages/core/agent-default-model/src/index.ts:64`](../../packages/core/agent-default-model/src/index.ts)

<a id="ctxagentloop--agentloop"></a>

### `ctx.agentLoop` — `AgentLoop`

具体的なエージェントファクトリーおよびドライバーサービスです。

```ts cordis-catalog
/**
 * Create an agent and session under one caller-supplied identity, owned by
 * the accessing fiber. Constructor-driven config calls mint a fresh combined
 * id before entering this boundary.
 * @param id - shared agent/session identity.
 * @param options - concrete loop options.
 * @param meta - optional fresh-session workspace metadata.
 * @returns the published running agent.
 */
create(id: SessionId, options: AgentOptions = {}, meta: Pick<SessionHeader, 'cwd'> = {}): Agent

/**
 * Create an owned agent on a caller-supplied session id.
 * @param ownerCtx - caller context that structurally owns the lifecycle.
 * @param options - identities, session seed/metadata, loop options, setup, and cancellation.
 * @returns the published handle.
 */
async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle>

/**
 * Resume an owned agent from the configured persistence service.
 * @param ownerCtx - caller context that owns load, setup, and the live lifecycle.
 * @param options - persisted identity, loop options, setup, and cancellation.
 * @returns the published handle.
 */
async resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle>
```

型: [SessionHeader](persistence.md)

ソース: [`packages/core/agent-loop/src/index.ts:296`](../../packages/core/agent-loop/src/index.ts)

<a id="ctxagentpresets--agentpresets"></a>

### `ctx.agentPresets` — `AgentPresets`

デプロイメントのエージェントプリセットを管理するレジストリです。

検出はメモ化されません。`list()` と `resolve()` は呼び出しのたびにルートを再読み込みするため、プロセスの実行中に作成されたプリセットはすぐに表示され、ピッカーの下で削除されたプリセットは次回の読み取り時には表示されなくなります。

```ts cordis-catalog
/**
 * Every preset the configured roots currently supply.
 * @returns the presets, first-root-wins per id.
 */
async list(): Promise<AgentPreset[]>

/**
 * Resolve one preset by id.
 *
 * A broken preset resolves — deleting one, reading one, and reporting one
 * all need the row — and the mounting paths refuse it AFTER resolution
 * through {@link resolveMountable}.
 * @param id - the preset id, or `undefined` for {@link defaultId}.
 * @returns the resolved preset.
 * @throws when no configured root supplies that id.
 */
async resolve(id?: string): Promise<AgentPreset>

/**
 * Compose one agent from a preset: ensure the preset's standing mount, then
 * parent the agent's scope key to it so the mount's registrations and
 * listeners cover this agent.
 *
 * Call from the agent factory's `setup(agentCtx)`; a rejection there rolls
 * the agent creation back, so a broken preset never yields a half-composed
 * session.
 * @param agentCtx - the agent's scope context.
 * @param id - the preset id, or `undefined` for {@link defaultId}.
 * @returns the preset that was composed, for the caller to record.
 * @throws when the preset is unknown or its composition is unusable.
 */
async mount(agentCtx: Context, id?: string): Promise<AgentPreset>

/**
 * Join one agent to the SAME standing composition another already runs on.
 *
 * This is how a child agent inherits its parent's capabilities. It is a bind,
 * not a mount: the parent's generation is already composed, so the child gets
 * that exact instance — the same plugin objects, the same tool registrations,
 * the same prompt sections. Re-resolving the parent's preset by id instead
 * would re-read the roster, and a composition file edited since the parent
 * started would hand the child a DIFFERENT generation than the one its
 * parent's history was produced under (and a preset deleted since would fail
 * the child outright while its parent keeps running).
 *
 * Synchronous, and with no composition failure mode of its own — it reads no
 * roster, mounts nothing, and touches no file — which is what lets a child
 * creation window use it: the two in-process subagent drivers compose their
 * children inside a synchronous `setup`. It still rejects a caller error, as
 * the `@throws` below record.
 *
 * A parent that joined no preset — a rosterless deployment — yields no join
 * and no error: there, the model-facing rows sit in the host composition and
 * the child already sees them through the global layer.
 * @param agentCtx - the joining agent's scope context.
 * @param parentCtx - the scope context of the agent whose composition to join.
 * @returns the preset id joined, or undefined when the parent joined none.
 * @throws when `agentCtx` carries no scope, or has already joined a preset.
 */
composeFrom(agentCtx: Context, parentCtx: Context): string | undefined

/**
 * The preset one live agent runs on.
 *
 * Read from the live scope chain rather than from the session, so it answers
 * for an agent whose session has not recorded a preset yet — a child agent
 * whose durable header is being built from its parent's composition.
 * @param agentCtx - the agent's scope context.
 * @returns the preset id, or undefined when the agent joined none.
 */
composedPreset(agentCtx: Context): string | undefined

/**
 * Read one preset's composition text.
 * @param id - the preset id.
 * @returns the composition exactly as stored.
 * @throws when no configured root supplies that id.
 */
async read(id: string): Promise<string>

/**
 * Create a locally authored preset by copying an existing one whole.
 *
 * Copy is the only authoring write. Composition text never crosses this
 * seam: the source is named by id and its directory is copied as it stands,
 * so the copy is exactly as loadable as its source and authoring grants no
 * capability the roster did not already carry. The copy is NOT mounted to
 * validate — a source that mounts today yields a copy that mounts today.
 * @param from - the preset the copy starts from; shipped presets are the
 * primary source, so any trust is accepted.
 * @param id - the new preset's id, which becomes its directory name.
 * @param name - display name for the copy; absent falls back to the id.
 * @throws when the source is unknown, the id is unusable or already taken,
 * or the deployment configures no writable root.
 */
async copy(from: string, id: string, name?: string): Promise<void>

/**
 * Delete a locally authored preset.
 * @param id - the preset id.
 * @throws when the preset is unknown or ships with the deployment.
 */
async remove(id: string): Promise<void>

/**
 * One agent's instance of a service its preset mounted.
 *
 * A preset publishes services behind `isolate` realms, which are invisible
 * outside the group that declares them — including to the host. This is how a
 * caller holding the agent reads one anyway: a request that is ABOUT a
 * session but arrives from outside it, which is every browser RPC.
 *
 * Read addressing only. A host row that `inject`s a service cannot use this,
 * because injection resolves before any session exists and has no agent to
 * key by; such a service belongs on the host plane instead.
 * @param agent - the agent whose composition to look inside.
 * @param name - the service name as the preset's rows resolve it.
 * @returns the agent's instance, or undefined when its preset mounts none.
 */
serviceFor<K extends string & keyof Context>(agent: { ctx: Context }, name: K): Context[K] | undefined

/**
 * Re-link one agent to a different preset's standing composition.
 *
 * Only valid while the agent has produced nothing: swapping tools mid
 * conversation would leave logged tool calls the new composition cannot
 * make. The CALLER owns that check — this method does not read session
 * history.
 *
 * The swap is a parent re-link, not an unmount: standing mounts are shared
 * and permanent, so the old composition stays for its other agents and the
 * new one is ensured BEFORE the link moves. An unknown or unusable preset
 * therefore throws with the agent exactly as it was — there is no torn-down
 * state to restore. The re-link runs through the binding this roster kept
 * from the agent's mount — dsh-scope's only re-link authority. An agent
 * that never composed one has nothing to re-link: the switch is then the
 * agent's first bind, exactly a mount.
 * @param agentCtx - the agent's scope context.
 * @param id - the preset to compose the agent from instead.
 * @returns the preset now installed.
 * @throws when the preset is unknown or its composition is unusable.
 */
async recompose(agentCtx: Context, id: string): Promise<AgentPreset>

/**
 * The standing scope key of one preset, for a host reader with no agent.
 *
 * A cold transcript read resolves tool presenters against the composition
 * the session recorded, and the standing mount makes that possible without
 * resuming anything: ensuring the mount composes plugins but starts no
 * agent, no session, and no turn.
 * @param id - the preset id, or `undefined` for {@link defaultId}.
 * @returns the standing scope key readers pass as a registry view scope.
 * @throws when the preset is unknown or its composition is unusable.
 */
async standingKeyFor(id?: string): Promise<ScopeKey>
```

型: [ScopeKey](scope.md)

ソース: [`packages/preset/agent-presets/src/index.ts:82`](../../packages/preset/agent-presets/src/index.ts)

<a id="ctxagents--agentregistry"></a>

### `ctx.agents` — `AgentRegistry`

エージェントサービス（`ctx.agents`）: ライブエージェントを追跡し、開始元の Agent をプロセスローカルの非同期ドライバーチェーンで引き継ぎます。Agent の*作成* は、setFactory 経由で登録された、AgentFactory（`@deepseek-ai/dsh-agent-loop`）を実装するプラグインによって提供されます。

Initiator メソッドは、同一プロセス内での因果的帰属のみを提供します。アンビエントな存在は、生存性の証明でも認可でもありません。主体と所有者は、ワーカー、プロセス、永続化、wire の境界における識別子と同様に、明示的なままです。返された Promise の境界は teardown 中に drain されますが、所有ファイバーの unload を開始するネストされた lineage は、自身の drain から除外されます。

```ts cordis-catalog
/**
 * Read the Agent that initiated the inherited asynchronous driver chain.
 * Use this optional form for logging, tracing, metrics, or host attribution
 * that also supports agentless calls. When a parent creates a child, setup
 * reports the causal parent while `agentCtx.agent` identifies the child.
 * @returns the inherited Agent, or `undefined` outside an initiator boundary
 *   and inside an explicit clearing boundary.
 * @throws when this service instance has been disposed.
 */
currentInitiator(): Agent | undefined

/**
 * Read the initiating Agent and fail when no initiator boundary is active.
 * Use this for private helpers contractually below a driver, or for a
 * deployment-owned outbound request whose contract forbids agentless calls.
 * Generic or direct-call paths use optional lookup or explicit request fields.
 * @returns the inherited Agent.
 * @throws when no initiator is active or this service instance has been disposed.
 */
requireInitiator(): Agent

/**
 * Run an operation with one exact Agent as its process-local initiator. The
 * exact synchronous value or Promise returned by the operation is preserved.
 * Custom drivers and test harnesses wrap their complete returned foreground
 * lifetime.
 * A queue or wire receiver may establish this boundary only after validating
 * explicit identity and resolving the exact live Agent; this method does neither.
 * Detached work remains owned by the subsystem that starts it.
 * @param agent - initiating Agent to inherit; presence is neither liveness proof nor authorization.
 * @param operation - synchronous or asynchronous operation to invoke.
 * @returns the exact value returned by `operation`.
 * @throws when the initiator scope is closing/disposed, or when `operation` throws.
 */
withInitiator<T>(agent: Agent, operation: () => T): T

/**
 * Run an operation inside a boundary that hides any inherited initiating
 * Agent. The exact synchronous value or Promise is preserved.
 * Use this while creating lazy shared timers, queue pumps, pool maintenance,
 * watchers, or exporters so they do not inherit the first Agent that happens
 * to initialize them. It clears only initiator attribution, not explicit
 * fields, and does not own or drain detached resources.
 * @param operation - synchronous or asynchronous operation to invoke without an initiator.
 * @returns the exact value returned by `operation`.
 * @throws when the initiator scope is closing/disposed, or when `operation` throws.
 */
withoutInitiator<T>(operation: () => T): T

/**
 * Register the agent-creation factory (the loop calls this on construction,
 * effect-scoped). A traced Cordis service is canonicalized to its concrete
 * target; each create/resume call is then traced through that caller's
 * context so ownership follows the caller without stacking proxy layers.
 * Throws if a factory is already registered. Returns the disposer; on
 * dispose the factory slot is cleared.
 * @param factory - the loop-owned factory {@link create}/{@link resume} delegate to.
 * @returns the disposer that clears the factory slot. The exact
 *   Cordis effect disposer (single-shot): composite (generator) effects may
 *   yield it directly — exact identity nests the teardown in order.
 */
setFactory(factory: AgentFactory): () => void

/**
 * Create and publish a new agent through the registered factory.
 * Distinct from {@link register} (which records an already-constructed
 * agent): this constructs the agent and its session. Rejects if no factory is
 * registered or creation/setup fails. The resolved {@link AgentHandle} lets
 * the owner tear down exactly this agent.
 * @param options - shared identity, session seed/metadata, and agent options.
 * @returns the handle after setup, rollback-covered publication, and loop start complete.
 */
async create(options: CreateAgentOptions): Promise<AgentHandle>

/**
 * Load a persisted session and resume an agent on it through the registered
 * factory. Rejects if no factory is registered; the factory rejects if
 * session persistence is not configured or persistence/setup fails.
 * @param options - persisted identity, configuration, and optional setup.
 * @returns the handle after setup, rollback-covered publication, and loop start complete.
 */
async resume(options: ResumeAgentOptions): Promise<AgentHandle>

/**
 * Register a live agent. Throws if an agent with the same id is already
 * registered. Emits `agent/created` on registration and `agent/disposed`
 * when the calling fiber is disposed — both with the agent's scope carrier
 * (`scopeTarget(agent, agent)`): the subject is the agent in hand, so the
 * emits are scope-filtered regardless of which context invoked `register`
 * (calling through `agent.ctx` scopes EFFECTS; dispatch scoping always
 * requires passing the carrier). Returns the disposer.
 * @param agent - the already-constructed agent to record in the store.
 * @returns the EXACT Cordis effect disposer (single-shot; a repeat call
 *   returns undefined without awaiting an in-flight teardown). Exact
 *   identity is load-bearing: a composite (generator) effect that owns a
 *   teardown ORDER — the agent factory's lifecycle chain — must yield THIS
 *   function so Cordis nests the unregistration at that yield position;
 *   yielding a wrapper would leave it disposing as a concurrent sibling on
 *   owner unload, unregistering the agent (and emitting `agent/disposed`)
 *   while its final turn is still draining.
 */
register(agent: Agent): () => void

/**
 * Insert an already-constructed agent without announcing it. This is the
 * advanced ordered-lifecycle primitive used by the async agent factory: it
 * first completes setup while the agent is unpublished, then assigns the
 * returned detach closure into its pre-installed composite teardown before
 * calling {@link announce}. Ordinary callers use {@link register}.
 * @param agent - the prepared, unpublished agent.
 * @param owner - live agent whose scoped context created this agent, or
 *   undefined for a top-level runtime root. This is runtime ownership, not
 *   the resumed session's durable parent lineage.
 * @returns an idempotent closure that removes this exact entry and emits
 *   `agent/disposed` with listener failures contained. When called from a
 *   synchronous `agent/created` listener, removal and disposal wait until
 *   that creation dispatch unwinds.
 */
enter(agent: Agent, owner: Agent | undefined): () => void

/**
 * Announce an agent previously inserted with {@link enter}.
 * @param agent - the live inserted agent to announce.
 * @throws if `agent` is not the exact live registry entry for its id, or its
 *   creation announcement already began (including a reentrant call from a
 *   creation listener).
 */
announce(agent: Agent): void

/**
 * Look up a live agent.
 * @param id - the shared agent/session id to look up.
 * @returns the agent, or undefined when no live agent has that id.
 */
get(id: SessionId): Agent | undefined

/**
 * Test whether a live agent was created through one exact parent agent's
 * scoped context. Runtime ownership is independent of durable session
 * lineage and remains unambiguous when unrelated providers reuse an id.
 * @param id - the candidate child agent's shared agent/session id.
 * @param owner - the expected runtime creator agent.
 * @returns true only while the exact child entry is live under that owner.
 */
isOwnedBy(id: SessionId, owner: Agent): boolean

/**
 * All live agents, in registration order.
 * @returns a fresh array; mutating it does not affect the registry.
 */
list(): Agent[]

/**
 * All live top-level agents in registration order. A top-level agent was
 * created without an owning agent context; durable session lineage does not
 * affect this runtime relation, so a resumed fork may still be a root.
 * @returns a fresh array; mutating it does not affect the registry.
 */
roots(): Agent[]
```

ソース: [`packages/core/agent/src/index.ts:256`](../../packages/core/agent/src/index.ts)

<a id="agent-events"></a>

### `agent/*` イベント

<a id="agentcreated--emit"></a>

#### `agent/created` — 発行

完全に構成されたエージェントと実行中のセッションが公開されました。セットアップは合成のみであり、`agent/session-start` は起動を促す最初の拡張ポイントです。同期リスナーの失敗は公開を拒否しますが、返された Promise の拒否は報告されます。ディスパッチ中に要求されたデタッチは、すべての作成リスナーが安定したエントリを確認するまで待機します。

```ts cordis-catalog
/**
 * A fully configured agent and live session were published. Setup is
 * composition-only; `agent/session-start` is the first startup-driving extension point.
 * Synchronous listener failure vetoes publication, while returned-promise
 * rejection is reported. Detach requested during dispatch waits until every
 * creation listener has observed the stable entry.
 * @param payload.agent - the newly registered agent with its live session and completed setup.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/created'(this: Scoped<Agent>, payload: { agent: Agent }): void
```

型: [Scoped](scope.md)

ソース: [`packages/core/agent/src/runtime-types.ts:159`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentdisposed--emit"></a>

#### `agent/disposed` — 発行

エージェントがレジストリを離脱しました。AgentLoop は、ドライバーの停止とスコープ付き登録の解除後、セッションのデタッチ前にこれを発行します。カスタムレジストリの利用者は、ドライバーの順序付けに関する契約を管理します。

```ts cordis-catalog
/**
 * An agent left the registry; AgentLoop emits this after driver quiescence
 * and scoped-registration unwind, but before session detachment. Custom
 * registry users own their driver-ordering contract.
 * @param payload.agent - the exact agent removed from the registry.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/disposed'(this: Scoped<Agent>, payload: { agent: Agent }): void
```

型: [Scoped](scope.md)

ソース: [`packages/core/agent/src/runtime-types.ts:168`](../../packages/core/agent/src/runtime-types.ts)

<a id="agenterror--emit"></a>

#### `agent/error` — 発行

ステップまたはターンでエラーが発生しました。耐久性のあるレコードに対するターン内位置がエラーにない場合でも、マシンはここで失敗を報告します。

```ts cordis-catalog
/**
 * A step or turn errored. The machine reports a failure here even when
 * the error has no in-turn position for a durable record.
 * @param payload.agent - the agent whose turn errored.
 * @param payload.turn - the turn in which the failure surfaced.
 * @param payload.step - the step at which the failure surfaced.
 * @param payload.error - the failure, verbatim.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/error'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; error: unknown }): void
```

型: [Scoped](scope.md)

ソース: [`packages/core/agent/src/runtime-types.ts:290`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentinboxclaimed--emit"></a>

#### `agent/inbox/claimed` — 発行

1 件のメッセージが、開いているターン内で受信トレイを離れました。提案されたステップが拒否された場合、取得済みのメッセージはここで終了します。破棄されることも、ユーザー/メッセージとして再発行されることもなく、ターンはステップなしで終了します。

```ts cordis-catalog
/**
 * One message left the inbox inside its open turn. If the proposed step
 * is rejected, the claimed message ends here: it is neither discarded nor
 * re-emitted as a user/message, and the turn closes without a step.
 * @param payload.agent - the agent whose inbox changed.
 * @param payload.message - the claimed message.
 * @param payload.turn - the owning turn.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/inbox/claimed'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage; turn: number }): void
```

型: [Scoped](scope.md) · [UserMessage](session.md)

ソース: [`packages/core/agent/src/runtime-types.ts:197`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentinboxdiscarded--emit"></a>

#### `agent/inbox/discarded` — 発行

1 件のメッセージが実行中の受信トレイから破棄されました。

```ts cordis-catalog
/**
 * One message was discarded from the live inbox.
 * @param payload.agent - the agent whose inbox changed.
 * @param payload.message - the discarded message.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/inbox/discarded'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage }): void
```

型: [Scoped](scope.md) · [UserMessage](session.md)

ソース: [`packages/core/agent/src/runtime-types.ts:205`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentinboxinserted--emit"></a>

#### `agent/inbox/inserted` — 発行

1 件のメッセージが実行中の受信トレイに入りました。

```ts cordis-catalog
/**
 * One message entered the live inbox.
 * @param payload.agent - the agent whose inbox changed.
 * @param payload.message - the inserted message.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/inbox/inserted'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage }): void
```

型: [Scoped](scope.md) · [UserMessage](session.md)

ソース: [`packages/core/agent/src/runtime-types.ts:186`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentpre-step--waterfall"></a>

#### `agent/pre-step` — ウォーターフォール

提案されたステップを拒否するか、そこに入るメッセージを置き換えます。`next()` を呼び出すと、現在のメッセージが維持されます。

```ts cordis-catalog
/**
 * Reject a proposed step or replace the messages that enter it. Calling
 * `next()` preserves the current messages.
 * @param payload.agent - the agent proposing the step.
 * @param payload.messages - messages removed from the inbox for this step.
 * @param payload.turn - the turn that will own the step.
 * @param payload.step - the step proposed by the loop.
 * @param payload.signal - the current turn's cancellation signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode waterfall
 */
'agent/pre-step'(this: Scoped<Agent>, payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal }, next: () => Promise<PreStepDecision>): Promise<PreStepDecision>
```

型: [Scoped](scope.md) · [UserMessage](session.md)

ソース: [`packages/core/agent/src/runtime-types.ts:231`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentrequest--waterfall"></a>

#### `agent/request` — ウォーターフォール

固定された呼び出し設定を置き換えます。`await next()` はマシンが使用する設定（最初のリクエストではエージェントオプション、その後は記録されたヘッダー）を返します。置換値を返すと切り替えられます。モデルに表示されるコンテンツには記録済みチャネルを使用する必要があります。このウォーターフォールではメッセージを変更できません。

```ts cordis-catalog
/**
 * Replace the frozen call configuration. `await next()` yields the config
 * the machine would use (agent options on the first request, the logged
 * header afterwards); return a replacement to switch. Model-visible
 * content must use logged channels; this waterfall cannot mutate messages.
 * @param payload.agent - the agent making the model call.
 * @param payload.turn - the open turn number.
 * @param payload.step - the step whose request this is.
 * @param payload.signal - the current turn's explicit abort signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode waterfall
*/
'agent/request'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; signal: AbortSignal }, next: () => Promise<LlmCallConfig>): Promise<LlmCallConfig>
```

型: [LlmCallConfig](llm-streaming.md) · [Scoped](scope.md)

ソース: [`packages/core/agent/src/runtime-types.ts:244`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentrequest-error--waterfall"></a>

#### `agent/request-error` — ウォーターフォール

ループが再試行するかステップを閉じる前に、失敗したモデルリクエストの試行を 1 回処理します。リスナーがリカバリーを担当する場合は、`next()` を呼び出さずに `{ kind: 'retry' }` を返します。委譲する場合は `next()` を呼び出します。デフォルトの `undefined` は失敗を終端状態のままにします。

```ts cordis-catalog
/**
 * Handle one failed model-request attempt before the loop retries or closes
 * its step. A listener returns `{ kind: 'retry' }` without calling `next()`
 * when it owns recovery, or calls `next()` to delegate. The default
 * `undefined` leaves the failure terminal.
 * @param payload.agent - the agent whose request failed.
 * @param payload.turn - the turn containing the failed request.
 * @param payload.step - the step containing the failed request attempt.
 * @param payload.provider - the provider selected for the failed request.
 * @param payload.failure - serializable facts normalized at the final adapter boundary.
 * @param payload.retryPolicy - the policy of the adapter registration that served the failed request.
 * @param payload.signal - the turn abort signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode waterfall
 */
'agent/request-error'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; provider: string; failure: LlmFailure; retryPolicy: ResolvedRetryPolicy | undefined; signal: AbortSignal }, next: () => Promise<RequestErrorAction>): Promise<RequestErrorAction>
```

型: [LlmFailure](llm-streaming.md) · [ResolvedRetryPolicy](llm-streaming.md) · [Scoped](scope.md)

ソース: [`packages/core/agent/src/runtime-types.ts:260`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentsession-start--emit"></a>

#### `agent/session-start` — 発行

最初のターンの前に 1 回だけ、セッションのライフサイクルが開始されました。`agent.inject()` を使用して、モデルに渡すコンテキストを初期化します。これは拒否ではなく通知です。ライフサイクル所有者が要求した破棄は、ドライバーの開始前に再確認されます。

```ts cordis-catalog
/**
 * The session lifecycle began, once before the first turn. Use
 * `agent.inject()` to seed model-facing context. This is a notification, not
 * a veto; disposal requested by a lifecycle owner is rechecked before the
 * driver starts.
 * @param payload.agent - the agent whose session lifecycle began.
 * @param payload.source - why the session started (fresh startup, resume, …).
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/session-start'(this: Scoped<Agent>, payload: { agent: Agent; source: SessionStartSource }): void
```

型: [Scoped](scope.md)

ソース: [`packages/core/agent/src/runtime-types.ts:217`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentstatus--emit"></a>

#### `agent/status` — 発行

エージェントの状態が変化しました（`idle` ⇄ `running`）。起動する配信は、キャンセルを予約した後、同期的に `running` に入ります。`idle` は、スケジュール済みまたはアクティブなドライバーが存在しないことを意味します。

```ts cordis-catalog
/**
 * Agent status changed (`idle` ⇄ `running`). A waking delivery enters
 * `running` synchronously after reserving cancellation; `idle` means no
 * driver remains scheduled or active.
 * @param payload.agent - the agent whose status flipped.
 * @param payload.status - the status just entered (the transition's destination).
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/status'(this: Scoped<Agent>, payload: { agent: Agent; status: AgentStatus }): void
```

型: [Scoped](scope.md)

ソース: [`packages/core/agent/src/runtime-types.ts:178`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentturn-stopping--serial"></a>

#### `agent/turn-stopping` — 直列

ターンはまもなく閉じられます。モデルに応答義務はありません（進行中のツール呼び出しも、新しいステアリングもありません）。境界がコミットされる前に待機されます。異議を唱えるリスナーはステアリング（`agent.steer(...)`）を行い、マシンは受信トレイを再読み込みします。新しいステアリングがあれば別のステップを実行し、なければターンを閉じます。結果はデータによって決まるため、リスナーの順序で結果は変わりません。逆の制御（ツールループを早期に停止すること）もデータです。`concludesTurn` を含むツール結果は、そのステップでターンを終了させます。結論によって、すでに送信済みの次ステップ作業が短絡されることはありません。同一ステップの `additionalContexts` や競合するステアリングも引き続き実行され、受信トレイが空になったときにのみターンが閉じられます。

```ts cordis-catalog
/**
 * The turn is about to close: the model owes no response (no live tool
 * calls, no fresh steering). Awaited before the boundary commits — a
 * listener that objects steers (`agent.steer(...)`) and the machine
 * re-reads its inbox: fresh steering runs another step, none closes the
 * turn. Data decides, so listener order cannot change the outcome. The
 * inverse control (stop a tool loop early) is data too: a tool result
 * carrying `concludesTurn` ends the turn at its step. The conclusion
 * never short-circuits already-submitted next-step work: same-step
 * `additionalContexts` or racing steering still runs, and the turn
 * closes only when that inbox drains.
 * @param payload.agent - the agent whose turn is at its stop boundary.
 * @param payload.turn - the turn about to close.
 * @param payload.signal - the current turn's explicit abort signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode serial
 */
'agent/turn-stopping'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; signal: AbortSignal }): Promise<void> | void
```

型: [Scoped](scope.md)

ソース: [`packages/core/agent/src/runtime-types.ts:278`](../../packages/core/agent/src/runtime-types.ts)

<a id="agent-loop-events"></a>

### `agent-loop/*` イベント

<a id="agent-loopconfig-start-failed--emit"></a>

#### `agent-loop/config-start-failed` — 発行

宣言的なエージェントエントリが、稼働中のエージェントを公開する前に失敗しました。設定された識別子に対する作業をバッファリングするコンシューマーは、この一時的なシグナルを使用して、永遠に待機するのではなくその作業を拒否します。通常のファクトリー終了処理では、キャンセルされた起動試行による失敗は抑制されます。

```ts cordis-catalog
/**
 * A declarative agent entry failed before it could publish a live agent.
 * Consumers that buffer work for the configured identity use this
 * transient signal to reject that work instead of waiting forever. Normal
 * factory teardown suppresses failures from the cancelled startup attempt.
 * @param payload.sessionId - exact shared agent/session identity that failed startup.
 * @param payload.error - persistence, setup, or publication failure.
 * @mode emit
 */
'agent-loop/config-start-failed'(payload: { sessionId: SessionId; error: unknown }): void
```

ソース: [`packages/core/agent-loop/src/index.ts:183`](../../packages/core/agent-loop/src/index.ts)

<a id="agent-preset-events"></a>

### `agent-preset/*` イベント

<a id="agent-presetselected--emit"></a>

#### `agent-preset/selected` — 発行

あるセッションが、異なるエージェントプリセットを永続ログにコミットしました。コンシューマーは、そのセッションの構成から派生した状態のみを無効化します。

```ts cordis-catalog
/**
 * One session committed a different agent preset to its durable log.
 * Consumers invalidate only state derived from that session's composition.
 * @mode emit
 * @param sessionId - the session whose composition changed.
 * @param agentPreset - the preset recorded by the committed selection.
 */
'agent-preset/selected'(sessionId: SessionId, agentPreset: string): void
```

ソース: [`packages/preset/agent-presets/src/types.ts:13`](../../packages/preset/agent-presets/src/types.ts)
<!-- END GENERATED cordis-surface -->
