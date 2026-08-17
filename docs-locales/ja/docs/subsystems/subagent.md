# サブエージェント

サブエージェントの抽象境界により、エージェントは作業を子エージェントに委任できます。[bash](shell.md) と同様に、これはエージェントループの一部ではない、**任意の 1 つの機能**です。そのため、型は [core.md](core.md) ではなくここに置かれています。他の機能の抽象境界とは異なり、bash が許可する executor は 1 つだけであるのに対し、**複数のプロバイダー実装が共存します** 。これらは名前（`ctx.subagents`）で 1 つのコンテキストに登録されます。このレジストリは、単一サービスの bash executor ではなく、[LLM アダプタレジストリ](llm-streaming.md)に従います。

サービス定義: [dsh-subagent](../../packages/subagent/subagent)（`ctx.subagents` と以下の用語）。サービスプロバイダーは兄弟パッケージ（`dsh-subagent-spawn-in-process`、`-fork`、`-acp`、`-codex`、`-claude-code`、`-dsh-sdk`）です。モデル向けコンシューマーは、[dsh-tool-subagent](../../packages/subagent/tool-subagent)（プロバイダーごとの委任）、[dsh-tool-subagent-control](../../packages/subagent/tool-subagent-control)（任意のグローバル `send_message`、`interrupt_agent`、`list_agents` コントロール）、および [dsh-tool-subagent-report](../../packages/subagent/tool-subagent-report)（任意の子スコープの `report` 戻りチャネル）です。同じ `ctx.subagents` サービスは、内部アクティベーションマネージャーを通じた継続可能な子のオーケストレーションと、セッションストアおよび任意のセッション永続化から直接行う読み取り専用の子・子孫検出を担います。製品プロバイダーの根拠は [Codex と Claude Code のエージェントノート](../../.agents/notes/implemented/feature/2026-08-04-claude-code-and-codex-subagent-backends.md)にあります。共通の抽象境界の根拠は、[サブエージェントのエージェントノート](../../.agents/notes/implemented/feature/2026-06-21-subagent-capability-seam.md)、[継続可能なサブエージェントのエージェントノート](../../.agents/notes/implemented/feature/2026-07-28-continuable-subagent-conversations.md)、[report ツールのエージェントノート](../../.agents/notes/implemented/feature/2026-07-30-continuable-subagent-report-tool.md)、[永続カタログのエージェントノート](../../.agents/notes/implemented/feature/2026-07-22-durable-subagent-catalog-and-list-agents.md)、[list-identity-projection のエージェントノート](../../.agents/notes/implemented/architecture/2026-08-06-subagent-list-identity-projection.md)、および [統合サービスのエージェントノート](../../.agents/notes/implemented/simplification/2026-07-26-merge-subagent-control-service.md)にあります。

ソース: [`packages/subagent/subagent/src/types.ts`](../../packages/subagent/subagent/src/types.ts)、[`packages/subagent/subagent/src/index.ts`](../../packages/subagent/subagent/src/index.ts)、および [`packages/subagent/subagent/src/continuation.ts`](../../packages/subagent/subagent/src/continuation.ts)

## 2 種類の機能、2 通りの検出方法

プロバイダーは、1 回限りの実行が存在する前にサービスが確認する静的 descriptor で、**開始時** の機能を公開します。プロバイダーにない機能を必要とするリクエストは、受理後に無視されることなく、明確に拒否されます（`SubagentError('UNSUPPORTED_CAPABILITY')`）。これらのフラグが表すのは、プロバイダーが子を構成する 1 回限りの [`start()`](#the-provider-contract-subagentprovider) パスのみです。**継続可能な** 子は継続マネージャー自身によって構成されるため、機能の有無そのものを表す任意メソッド 1 つで制御され、検出機構には TS の絞り込みが使用されます: [`SubagentProvider.prepareContinuable`](#the-provider-contract-subagentprovider)。

```ts type-equiv
/**
 * Which START-TIME features a provider supports. Checked by the service before delegating to
 * {@link SubagentProvider.start}: a request that needs a capability the chosen provider lacks
 * is rejected with a typed error rather than accepted-then-ignored (the "fail loud, no silent
 * degradation" rule). These flags describe the ONE-SHOT
 * {@link SubagentProvider.start} path, where the provider composes the child;
 * continuable children are composed by the continuation manager itself and are
 * gated by {@link SubagentProvider.prepareContinuable} instead. Each flag
 * corresponds one-to-one to a {@link SubagentStartRequest} option: `depthLimit`
 * to `maxDepth`; the other names match.
 */
interface SubagentCapabilities {
  readonly outputSchema: boolean
  readonly depthLimit: boolean
  readonly toolFilter: boolean
  readonly persona: boolean
}
```

## 1 回限りの開始リクエスト

ツール層はモデル入力と独自の設定からこのリクエストを構築します。サービスは、`start` の前に、名前付きプロバイダーに対してこれを検証します。必須の `parent` は、セッションの cwd、系統、および委任深度を提供します。任意の出力スキーマ、深度、ツールフィルター、persona には、対応する機能フラグが必要です。サポートされないスキーマは開始時に失敗します。インプロセスバックエンドはフィルターと persona を子の作成にスコープし、強制 capture ツールを使用して、サポート対象のオブジェクトルート型スキーマを実装します。

```ts type-equiv
/**
 * What a caller asks for when starting a ONE-SHOT subagent. The tool layer
 * builds this from the model's `{ description, prompt }` plus its own config;
 * the service validates {@link SubagentCapabilities} against the named provider
 * and resolves the durable descriptor before dispatching to
 * {@link SubagentProvider.start}.
 */
interface SubagentStartRequest {
  /** Optional short display label persisted with a session-backed child. */
  readonly label?: string
  /** Content delivered as the child's user message. */
  readonly prompt: ContentBlock[]
  /**
   * The spawning agent. In-process providers derive workspace, lineage, and
   * delegation depth from its durable session state. ACP reads only its cwd,
   * and only when no deployment `cwd` override is configured.
   */
  readonly parent: Agent
  /**
   * Cancellation signal from the spawning context (the tool's `exec.signal`).
   * This is the canonical cancellation channel both before and after startup:
   * a provider rejects `start()` after cleaning partial resources when it
   * fires before the run is published, and cancels the published run's
   * remaining turn work when it fires afterward.
   */
  readonly signal: AbortSignal
  readonly agentOptions?: AgentOptions
  /**
   * Object-rooted JSON Schema within `assertObjectJsonSchema`'s enforced subset. Start rejects
   * unsupported schemas or providers without the capability. Data must be plain host-realm JSON;
   * a successful child returns the matching value as {@link SubagentResult.structured}.
   */
  readonly outputSchema?: ObjectJsonSchema
  /**
   * Optional absolute delegation-depth cap for the child being started: its
   * computed depth must be less than or equal to this non-negative safe
   * integer. Requires {@link SubagentCapabilities.depthLimit}; rejected at
   * start otherwise.
   */
  readonly maxDepth?: number
  /**
   * Optional child tool scoping. Requires {@link SubagentCapabilities.toolFilter};
   * rejected at start otherwise. In-process backends apply it as a scoped
   * `tools.restrict()` in the child's creation window: the named tools vanish
   * from the child's prompt AND refuse to execute (one visibility), with loud
   * unknown-name validation.
   */
  readonly toolFilter?: ToolRestriction
  /**
   * Optional per-child persona. Requires {@link SubagentCapabilities.persona};
   * rejected at start otherwise. In-process backends register it as a scoped
   * `deployment:persona` section on the child, SHADOWING the deployment's
   * persona for this child alone — same template semantics as the deployment
   * persona (strict `{{…}}` interpolation against the registered variables).
   */
  readonly persona?: string
}
```

`signal` は、準備完了の前後で共通する唯一のキャンセルチャネルです。[サブエージェント構成コントロールのエージェントノート](../../.agents/notes/implemented/feature/2026-07-12-subagent-persona-tool-filter-and-depth.md)に、persona、ライブのグローバルツールフィルター、絶対深度、および可視性と権限の違いに関する根拠があります。

呼び出し元向けのリクエストには、カタログ形式の詳細や継続状態は含まれません。`SubagentRuntime.start()` は、能力チェック後に分離されたワンショット記述子を解決し、このプロバイダー向けリクエストを選択したトランスポートへ渡します。継続可能な子は `SubagentProvider.start()` には到達しません。

```ts type-equiv
/**
 * Provider-facing one-shot request after {@link SubagentRuntime.start} resolves
 * the durable child descriptor.
 */
interface ResolvedSubagentStartRequest extends SubagentStartRequest {
  /** Detached descriptor a session-backed provider persists in the child log. */
  readonly descriptor: SubagentDescriptorData
}
```

## 継続可能な子とアクティベーション

**継続可能なバックグラウンドサブエージェント** は、永続的な 1 つの子 Session と、再構築された子 Agent が常駐する期間である、プロセスローカルの最大 1 つの **Activation** で構成されます。Activation はリクエスト、結果、キャンセル、Task のいずれでもありません。複数の FIFO ターンを実行でき、自身が作成した子孫がまだ実行中である間は常駐し続けます。継続マネージャーは、アクティベーションの受け入れ、直接親の認可、ライブ所有グラフ、コールド再開、子優先の破棄を担当します。Agent ループは、すべてのターンの順序付けと実行を担当します。継続可能な経路では、Task や結果を保持する中間ラッパーは作成されません。

```text
persisted Session
  -> optional live Activation
       -> one retained AgentHandle
       -> Agent inbox as the only turn FIFO
       -> zero or more owned child Activations
```

`SubagentRuntime.startContinuable()` は安定した子 ID を予約し、バージョン管理された `subagent/descriptor` ペイロードをスナップショットし、指定されたプロバイダーに分離された `ContinuableCreateSpec` を要求し、非公開のアクティベーション所有者スコープを通じて子 Agent を作成し、必要に応じて継続可能な親の所有権を確立してから、初期プロンプトを送信します。受信箱の受け入れによってメッセージ ID が生成されると、ターンの開始やメッセージの Session ログへの記録を待たずに `{ childId, messageId }` として解決します。その受け入れ前の失敗では ID を返さず、作成済みのハンドルを破棄して Activation と親の所有権をロールバックします。

`SubagentRuntime.followup()` は唯一の継続メッセージ操作であり、ルーティングは Activation の常駐状態だけに依存します。

| Activation の状態 | `followup` |
|---|---|
| `running` | 同じ Activation にエンキューする |
| `waiting` | 同じ Activation を起動する |
| Activation なし | 新しい Activation をコールド再開する |

`running` は、Agent にアクティブな受け入れまたはターン、あるいは起動中の受信箱作業があることを意味します。`waiting` は静止状態ですが、破棄が完了していない子 Activation を少なくとも 1 つ所有していることを意味します。`settled` は、所有するすべての子が破棄済みの静止状態を意味し、この時点でマネージャーは [`AgentHandle`](core.md#creation-and-ownership) を破棄して Activation を削除します。マネージャーは、第 2 の実行状態マシンを維持するのではなく、Agent の静止状態と所有する子の集合からこれらの内部条件を導出します。

Agent の受信箱が唯一のキューです。すべての継続メッセージは 1 つの `Agent.followup()` FIFO ターンになるため、受け入れ済みメッセージには観測可能な順序が 1 つあり、フォローアップによってすでに進行中のターンをリダイレクトすることはできません。配信に成功すると、受け入れ済みの `MessageId` が返されます。既存の `agent/inbox/inserted`、`agent/inbox/claimed`、`agent/inbox/discarded` イベントはメッセージライフサイクルの観測として残り、継続レイヤーではサブエージェント固有の配信経路を定義しません。

フォローアップの権限は、正確なライブ Agent ツールコンテキストに基づきます。認証された Agent は、`SessionHeader.parentSession` に記録された永続的な子の直接親でなければなりません。`MessageSource` と `senderSessionId` は、受け入れ済みメッセージを提供した主体を記録しますが、権限は付与しません。任意のモデル向けツールでは `CoordinatorMessageSource` を使用します。

両方の操作において、呼び出し元のシグナルは、受信箱が受け入れるまでの検索、具体化、受け入れのみを所有します。その後、マネージャーが Activation を独立して所有します。後から呼び出し元がキャンセルしても、受け入れ済みターンはキャンセルされず、子も破棄されません。また、この境界ではステアリング操作を公開しません。

`SubagentRuntime.interrupt(targetSessionId, authority)` は唯一の公開停止操作です。同期的に認可し、ライブターゲットで `Agent.cancel(cause, { keepInbox: true })` を発行して、静止状態を待たずに返ります。Activation、その未取得の保留中受信箱作業、公開済みの子孫は変更されません。中断されたターンにすでに取得されている作業は再キューされません。中断されたドライバーがアイドル状態になると、起動する送信によって停止中の FIFO キューが再開されます。不明、ワンショット、またはすでに解決済みのターゲット、およびマネージャーのない構成は、受け入れられるノーオペレーションです。ライブターゲットでは、親アドレスの不一致、または呼び出し元がライブ祖先関係の外にいる場合、`UNAUTHORIZED` で拒否されます。古い祖先オブジェクトと自己ターゲット祖先リクエストは、ターゲット検索前に拒否されます。

```ts type-equiv
/**
 * Authority under which one interrupt request is admitted. `user` carries the
 * durable direct-parent address a human client presented; `ancestor` carries
 * the exact live Agent object whose recorded lineage must contain the caller.
 */
type SubagentInterruptAuthority =
  | { readonly kind: 'user'; readonly parentSessionId: SessionId }
  | { readonly kind: 'ancestor'; readonly agent: Agent }
```

各 Activation は自身の `AgentHandle` と `ownedChildren: Set<SessionId>` を所有します。1 つの Session にはライブ Activation が最大 1 つしか存在しないため、子 Session ID により、別の実行時インカネーション参照なしでライブな子を識別できます。子の開始または親起点の作業の送信では、子が実行可能になる前に、継続管理対象の親の集合にその子を登録します。集合が空でない間、その親は解決できません。トップレベルまたはその他の非継続 Agent には Activation がなく、待機グラフの外に留まります。子の解放は、子 Agent が静止状態であり、その子のすべての子が破棄され、ベストエフォートの最終セッションフラッシュが解決され、子の `AgentHandle` の破棄が完了した後にのみ行われます。

最終解決では `ctx.sessions.flush(session)` を待機しますが、任意のリスナーが永続化バックエンドによる状態保存を証明できるわけではないため、その参加ブール値は無視します。拒否は Activation を失敗させずにログに記録され、マネージャーは引き続きハンドルを破棄して所有権を解放します。そのため、後の再開時には永続化された子状態が欠落または古くなっている可能性があります。マネージャーのアンロードでは、受け入れを閉じ、すべてのライブフォレストを破棄する内部のマネージャー全体ドレインを呼び出します。`drainContinuableDescendants(parents)` は、正確なライブのホスト所有 Agent より下でのみ受け入れを閉じ、それらの継続可能な子孫を破棄します。無関係なフォレストはライブのままです。どちらもスコープ内ですでに受け入れ済みの具体化を待機し、キャンセルを上から下へ伝播し、ハンドルを子優先で解放し、個々の失敗にかかわらず選択したすべてのブランチを待機します。永続的な子 Session は、そのプロセスローカルな破棄後も存続します。

```ts type-equiv
/** Attribution for a model coordinator's follow-up to one of its children. */
interface CoordinatorMessageSource {
  readonly kind: 'coordinator'
  /** A message another agent addressed to this one (`relay` context form). */
  readonly form: 'relay'
  /** Session id of the agent whose tool call produced the follow-up. */
  readonly senderSessionId: SessionId
}
```

```ts type-equiv
/** Options for following up with one continuable child. */
interface SubagentFollowupOptions {
  /** Durable attribution retained on the delivered message; it grants no authority. */
  readonly source: MessageSource
  /** Caller cancellation, owning the operation only until inbox acceptance. */
  readonly signal: AbortSignal
}
```

```ts type-equiv
/** Identities returned once a continuable child accepted its initial prompt. */
interface ContinuableStart {
  /** The durable child session id, stable across activations. */
  readonly childId: SessionId
  /** The accepted initial prompt's inbox message id. */
  readonly messageId: MessageId
}
```

オプションの継続可能な子セットアップの寄与は、基本の子構成後かつ Activation の公開前に、スコープローカルな機能をインストールできます。レジストリは順序付きかつトランザクション型です。失敗または取り消されたセットアップでは未公開の Activation がロールバックされ、子スコープの破棄によりすべてのインストールが解放され、新しい登録は次の Activation に影響し、登録の削除は常駐しているすべてのインストールを直ちに取り消します。

`SubagentRuntime.reportFrom()` は、2 つ目のキューや結果を持つ子ラッパーを追加せずに、その拡張ポイントを使用します。正確なライブの子 Agent が呼び出しを認可し、呼び出し元は受信者を指定できません。マネージャーは、子の永続的な `parentSession` から唯一の受信者を導出し、その親 Agent がライブであることを要求し、選択したコンテンツを 1 件の `subagent-report` ユーザーメッセージとしてフレーム化して、メッセージの安定した `MessageId` を返します。静かな配信では `Agent.inject()` を使用し、受信トレイの発生も親ターンも作成しません。起動する配信では `Agent.followup()` を使用し、通常の後続の親ターンを 1 件作成します。どちらのモードも子のターンを終了せず、最終回答を暗黙的に報告することもありません。

```ts type-equiv
/** Durable attribution for a continuable child's explicit parent report. */
interface SubagentReportMessageSource {
  readonly kind: 'subagent-report'
  /** A message another agent addressed to this one (`relay` context form). */
  readonly form: 'relay'
  /** Session id of the reporting child. */
  readonly senderSessionId: SessionId
}
```

```ts type-equiv
/** Deployment scheduling policy for accepted child reports. */
type SubagentReportDelivery = 'quiet' | 'wakeup'
```

報告は子自身の選択であるため、マネージャーは独自の別個の記録を保持します。常駐している Activation が完了すると、そのエポックの終了方法を説明し、最終アシスタントコンテンツを含む通知を 1 件、子の永続的な直接親に配信します。この配信は呼び出し元が id を受け取ったすべての子に対して無条件で行われ、親が完了したと判断されるようになる所有権解放より前に実行され、常駐している親には報告と同じ起動受け入れの計上を通じて到達します。自身の系統がすでに終了処理中の親は、起動なしでこれを受け取ります。静止中の Agent を起動すると、作業をキューに入れるのではなくターンが開始されるためです。その来歴は別種であるため、トランスクリプトでランタイムの記録が子によって書かれたものとして表示されることはありません。

```ts type-equiv
/**
 * Durable attribution for the runtime's own account of a continuable child
 * settling. Deliberately a different kind from
 * {@link SubagentReportMessageSource}: a report is content the child chose,
 * while this message is the manager stating what became of the child, and a
 * transcript that merged them would credit the child with words it never wrote.
 */
interface SubagentSettledMessageSource {
  readonly kind: 'subagent-settled'
  /** A runtime account shown without expanding the row (`notice` context form). */
  readonly form: 'notice'
  /** One-line account of how the child ended. */
  readonly summary: string
  /** Session id of the child that settled. */
  readonly senderSessionId: SessionId
}
```

```ts type-equiv
/** Options for one continuable child's report to its direct parent. */
interface SubagentReportOptions {
  /** Already-resolved parent scheduling policy. */
  readonly delivery: SubagentReportDelivery
  /** Caller cancellation, owning authorization and admission until acceptance. */
  readonly signal: AbortSignal
}
```

プロバイダーが関与するのは、`spawn` と `fork` が異なる初期作成仕様の準備だけです。返される仕様に含まれるのは、分離されたプロバイダー固有の作成入力、現在はオプションの親履歴シードのみであり、Agent、`AgentHandle`、プロンプト配信、結果、破棄、再開操作は含まれません。コールド再開はプロバイダーをまったく経由してディスパッチされません。マネージャーは汎用ディスクリプターを統合し、同じアクティベーション所有者スコープを通じて `ctx.agents.resume()` を呼び出し、待機中のターンを送信します。

```ts type-equiv
/**
 * What the continuation manager asks a provider for while materializing one
 * continuable child's FIRST activation. The manager has already reserved the
 * durable child identity and owns every later operation, so this request
 * carries only what distinguishes a fresh child from one seeded with parent
 * history.
 */
interface ContinuableCreateRequest {
  /** The reserved durable child session id, for provider diagnostics. */
  readonly sessionId: SessionId
  /** The delegating parent agent whose history a seeding provider reads. */
  readonly parent: Agent
  /**
   * Caller cancellation, which owns preparation only until the manager accepts
   * the initial prompt into the child's inbox.
   */
  readonly signal: AbortSignal
}
```

```ts type-equiv
/**
 * A provider's detached contribution to one continuable child's creation. This
 * is DATA, never a capability: it carries no Agent, `AgentHandle`, prompt
 * delivery, result, disposal, or resume operation, because the continuation
 * manager owns the child's whole lifecycle after preparation.
 */
interface ContinuableCreateSpec {
  /**
   * Completed-turn prefix of the parent's log to seed the child session with,
   * or absent for a fresh child. Same durable contract as
   * `CreateAgentOptions.seed`: contiguous from seq 0, lossless JSON, balanced.
   */
  readonly seed?: readonly SessionEvent[]
}
```

ディスクリプター（[descriptor.ts](../../packages/subagent/subagent/src/descriptor.ts) 内の `SubagentDescriptorData`）は、セッションに支えられたすべてのサブエージェントの、モードで判別される永続的な識別子です。両方のモードでプロバイダー名が保持されます。`one-shot` ディスクリプターは、呼び出し元が所有する表示用 `label` を任意で保持します。`continuable` ディスクリプターは、委任の `description` を永続的な作成ラベルとして必須とし、さらにコールド再開のために解決済みの子 `agentOptions.provider`/`model` と任意の `persona`/`toolFilter` をスナップショットします。マージで拡張可能な `AgentOptions` オブジェクトは決してスナップショットしないため、無関係な拡張値によって継続が壊れることはなく、後続の構成入力は意図的なバージョン変更となります。`subagentDepth`（コールド再開では、永続化されたヘッダーの `delegationDepth` を単調な下限として信頼します）および `outputSchema`（1 回の実行または Activation の結果契約であり、永続的な識別子ではありません）は省略します。

ローカルのワンショットプロバイダーは、子の最初のリクエスト前、その初期ターン内でディスクリプターを追記します。継続マネージャーは、プロバイダーが提供した系統の後、かつ初期プロンプトが受け入れられる前にディスクリプターを追記します。`header.seedLength` はフォーク系統の境界のままです。再開時のディスクリプター権限は子自身のサフィックスを読み取る一方、リスト提供の識別子プロジェクションは `subagent/descriptor` を後勝ちで統合するため、子自身のディスクリプターがフォークでシードされた祖先のものを上書きします。このイベントはログ専用です。`surfaceOp` はなく、モデル履歴に入ることはなく、追記専用ログにより圧縮後も保持されます。現在のバージョンで不正なディスクリプターは破損しています。サポートされないバージョンは、このランタイムでは分類できません。

## 永続的な列挙: `listChildren()`、`listDescendants()`、およびそのエントリ

`SubagentRuntime.listChildren(parentSessionId)` は、`ctx.sessions.list()` と任意の `ctx.sessionPersistence.list()` をライブ優先でマージした結果から、親のセッションに裏付けられた直接のサブエージェントを列挙します。クエリサービスは使用せず、Agent のロードや再開も行いません。候補は、永続ヘッダーに `origin: 'subagent'` を持つ直接の子です。このマーカーは列挙と大まかな汎用ルート拒否を分類しますが、有効な記述子、再開可能性、認可を確立することはできません。識別情報はプロジェクションのフォールドが管理し、再開は Activation 契約が管理します。各行の `mode`/`label` は、登録済み `subagent` プロジェクション単位の値です。次の 3 段階のラダーで提供されます。ライブの子にはレジストリのウォーターマークキャッシュを使用します（ログ読み取りはゼロ）。コールドの子には任意のプロジェクションチェックポイントキャッシュを使用します（`cachedSnapshot`。own-suffix の seq ゲートを通過する識別情報は最終値です。own 記述子は追記後に不変であるためです）。それ以外の場合は、レジストリ経由でフォールドされる 1 回の `persistence.inspect()` 読み取りを行います（同時実行数は制限され、列挙ごとに再計算されます）。キャッシュは純粋に任意の高速化手段です。存在しない場合、`null` センチネルを提供する場合、キーがない場合、seq ゲートを通過しない場合、または障害が発生した場合は、黙って権威ある再フォールドへフォールスルーします。フォールドは失敗チャネルのない `subagent/descriptor` の後勝ちです。子自身の記述子はフォーク時にシードされた祖先の記述子を上書きし、不正形式または未知バージョンのペイロードはシリアライズ可能な `null` センチネルにフォールドされ、値なしとして扱われます。結果は `createdAt`、次に id の順で並ぶ 1 つの `SubagentListEntry[]` です。提供された識別情報は、`mode: 'one-shot' | 'continuable'` と `activity: 'running' | 'inactive'` を持つ `child` エントリを生成します。継続可能なエントリは常に `label` を持ちますが、ワンショットエントリがこれを持つのは、開始呼び出し元が表示メタデータを提供した場合のみです。フォールドで識別情報が提供されなかった完了済み候補は、`corrupt` 診断を生成します。欠落、不正形式、未知バージョンの記述子は意図的に区別されません（`unsupported` は型には残りますが、生成されることはありません）。識別情報のない実行中候補は省略されます（記述子が到着する前の作成ウィンドウです）。コールド検査が失敗した場合は、次の列挙で再試行される `unavailable` 診断を 1 件生成するため、破損した兄弟が健全な子を隠すことはありません。`hasChildren` は、同じマージ済みマテリアルから読み取られる、永続的なサブエージェント起点を持つ直接の子孫を示します。アクティビティスナップショットは、論理レコードが `ctx.sessions` においてライブかどうかのみを示し、結果や再開可能性は示しません。永続化がない場合、列挙はエラーではなくライブのみになります。コールドの子はその場合も再開できません。`listChildren()` は、`ctx.sessionProjections` レジストリがない場合にコード `SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE` を持つ `SubagentError` をスローし、セッションストアがない場合は `SUBAGENT_CONTROL_SESSION_STORE_UNAVAILABLE` をスローします。どちらも読み取り前に確認されるため、子がゼロのデプロイメントでも決定的に失敗します。リストツールは、プラグインロード時に `ctx.subagents` と `ctx.agents` を必要とします。UI などのサービスコンシューマーは両方のモードを表示し、ラベルなしのワンショットフォールバックを選択できます。一方、モデル向けの `list_agents` アダプター（[dsh-tool-subagent-control](../../packages/subagent/tool-subagent-control) の個別にロード可能な `/list-agents` プラグイン）は継続可能なエントリのみを保持し、ライブ Agent レジストリを通じてステータスを独自の `running`/`idle`/`ready` 語彙へ絞り込みます。その `ready` は、ストレージ専用の子を終端ではなく再開可能として示します。列挙では継続マネージャーの Activation マップ、Agent レジストリ、プロバイダーの可用性を参照しません。`send_message` は引き続き権威ある配信時操作であり、リストにある実行中かつ継続可能な子でも、所有権競合により配信を拒否する場合があります。読み取りパスの根拠は、[list-identity-projection Agent Note](../../.agents/notes/implemented/architecture/2026-08-06-subagent-list-identity-projection.md) にあります。

`SubagentRuntime.listDescendants(rootSessionId)` は、同じライブ優先コーパスとプロジェクションに基づく解釈を、ルートの完全な子孫ツリーに安定した先行順で適用します。通常のセッションとワンショットの子も走査ノードとして残るため、その下にある継続可能な子孫も検出されます。行を生成するのは `origin: 'subagent'` 候補だけです。返される各子または診断には、列挙された永続ヘッダーからの位置が追加されます。一方、コールド検査では、識別情報を提供する前に完全なライフサイクルを再検証します。

```ts type-equiv
/**
 * One entry of a descendant listing: the interpreted subagent facts plus its
 * position in the complete session tree. `parentId` is the durable direct
 * parent from the enumerated header, and `depth` counts edges from the root.
 */
type SubagentDescendantListEntry = SubagentListEntry & {
  /** Durable direct parent of this candidate in the enumerated tree. */
  readonly parentId: SessionId
  /** Edge distance from the requested root; direct children are `1`. */
  readonly depth: number
}
```


## 終端結果: `SubagentResult`

`SubagentRun.result` によって解決される、ワンショット実行の結果です。`structured` は、要求された `outputSchema` が正常に満たされた後にのみ存在します。スキーマを要求しても保証されず、子が失敗した場合や有効なキャプチャなしで完了した場合、プロバイダーは `stopReason: 'error'` を返すことがあります。`completed` ではない `stopReason` は、`output` が部分的である可能性を意味します。コンシューマーは、部分的な出力を成功として報告するのではなく、これを `isError` ツール結果にマッピングします。

```ts type-equiv
/**
 * The terminal outcome of a subagent run, resolved by {@link SubagentRun.result}.
 */
interface SubagentResult {
  /**
   * The child's final assistant output is the content of its last non-empty
   * assistant message. Empty-content messages, including usage-only messages,
   * are skipped. Without a non-empty message, the output is its accumulated
   * assistant text stream, or `[]` when the child produced neither.
   */
  readonly output: ContentBlock[]
  /**
   * The structured result after a requested `outputSchema` was successfully
   * satisfied. Requesting a schema does not guarantee presence: a provider can
   * end with `stopReason: 'error'` when the child fails or finishes without a
   * valid capture. The structured value is validated against the requested
   * output schema by the provider; `unknown` here because the seam is
   * schema-agnostic.
   */
  readonly structured?: unknown
  /** Why the run ended. A non-`completed` reason means `output` may be partial. */
  readonly stopReason: SubagentStopReason
}
```

`SubagentStopReason` は、[マージ拡張可能な派生ユニオン](core.md#the-map--derived-union-pattern)です。バックエンドはバリアントを追加できるため、コンシューマーは既知のケースで分岐し、未知の終端理由を失敗として扱います。

```ts type-equiv
/**
 * Why a subagent run ended. Merge-extensible (a backend may add variants);
 * consumers branch on the known cases and fall through `default`. The known
 * cases mirror the harness turn-end vocabulary so the tool layer can map a
 * non-`completed` result to an `isError` tool result.
 */
interface SubagentStopReasonMap {
  /** The child finished its turn normally. */
  completed: 'completed'
  /** Cancelled through the request signal or disposal. */
  aborted: 'aborted'
  /** Model or transport failure. */
  error: 'error'
  /** The child hit its token ceiling before finishing. */
  'max-tokens': 'max-tokens'
  /** The child declined the task. */
  refusal: 'refusal'
}
```

## ワンショット実行: `SubagentRun`

`SubagentRun` は、公開済みの単発子エージェントに対するコンシューマー所有のハンドルです。これは結果を 1 つだけ返す、使い捨てのフォアグラウンド委任であり、永続的な子ハンドルではありません。プロンプトの送信、ターンの処理、および公開後のインフラストラクチャ障害は `result` に属します。コンシューマーはその結果を待機し、静止状態に到達するために必ず実行を破棄します。子の失敗は完了以外の停止理由で解決されます。表現できないインフラストラクチャ障害のみが拒否されます。実行には操作も再開もありません。継続可能な会話には実行自体が存在しません。これは、継続マネージャーがその `AgentHandle` を直接保持し、すべてのターンを子自身の受信トレイ経由で順序付けるためです。

```ts type-equiv
/**
 * ONE-SHOT child handle returned after publication. Prompt submission, turn
 * work, and infrastructure faults after that boundary belong to {@link result}.
 * Consumers await that result and must always {@link dispose} to cancel
 * remaining work and reach quiescence. A run is one disposable foreground
 * delegation with one result; continuable conversations have no run — the
 * continuation manager holds their `AgentHandle` directly and orders every
 * turn through the child's own inbox.
 */
interface SubagentRun {
  /**
   * Parent-scoped run id. For a local run, this MUST equal the published child
   * session id, whose `parentSession` records `request.parent.session.id`; a
   * remote provider mints an id unique in the parent namespace.
   */
  readonly id: SessionId
  /**
   * The exact published in-process child, or `undefined` for a remote run.
   * When present, its id is {@link id}; the provider retains no ownership
   * implication beyond the run's ordinary {@link dispose} contract.
   */
  readonly localAgent: Agent | undefined
  /**
   * Resolves with the child's terminal {@link SubagentResult} when the run
   * settles. Does NOT reject on a child-level failure — a model/transport
   * failure resolves with `stopReason: 'error'` so the consumer maps it to an
   * `isError` tool result. Rejects on an infrastructure fault the seam cannot
   * represent as a stop reason.
   */
  readonly result: Promise<SubagentResult>
  /**
   * Cancel remaining work, reach child quiescence, and release resources.
   * Idempotent.
   */
  dispose(): Promise<void>
}
```

ローカルの単発実行は、`start()` が解決される前に通常の子エージェント／セッションを公開し、その子セッション ID を `SubagentRun.id` として返し、正確な子を `localAgent` として公開し、子の `parentSession` ヘッダーに `request.parent.session.id` を記録し、最初のリクエストの前に子の初期ターン内へ解決済みの記述子を追加しなければなりません。ランタイムの所有権では、子を親、プロバイダー、またはルートのスコープ配下に置くことができます。これに対しリモートプロバイダーは、親スコープのライフサイクル ID と `localAgent: undefined` を返します。ローカルの子 Session がないため、永続的な列挙には含まれません。

## プロバイダー契約: `SubagentProvider`

各プロバイダーは名前付きの子エージェントトランスポートであり、複数のプロバイダーを共存させることができます。サービスは `start()` の前に要求された開始時機能を検証し、`prepareContinuable` を持たないプロバイダーでの継続可能な開始を拒否します。`inheritsParentContext` は会話のシード設定のみを記述します（`fork`: true、`spawn` および `acp`: false）。これにより、コンシューマーはツール、サービス、または権限の継承を示唆せずに、モデル向けの正確な文言を生成できます。

```ts type-equiv
/**
 * One registered transport for running child agents. Providers are trusted
 * same-process implementations; callers treat descriptors and returned values
 * as borrowed immutable data. The service may call one provider concurrently
 * for distinct children. Providers isolate operation-local mutable state; a
 * shared capacity controller may delay an operation but must not couple its
 * settlement or cleanup to a sibling.
 */
interface SubagentProvider {
  /** Unique registry name (e.g. `spawn`, `fork`, `acp`). */
  readonly name: string
  /** The start-time features this provider supports (see {@link SubagentCapabilities}). */
  readonly capabilities: SubagentCapabilities
  /**
   * Whether the child sees the parent's completed-turn prefix. This is descriptive, not a
   * service-validated start capability: the model-facing tool derives truthful wording from it.
   * It says nothing about tool registration, injected services, or authority inheritance.
   */
  readonly inheritsParentContext: boolean
  /**
   * Establish a ONE-SHOT child and return its handle after publication.
   * The service has already validated that every requested start-time
   * capability is supported and resolved `request.descriptor`, so a
   * session-backed implementation appends that descriptor inside the child's
   * initial turn. Before fulfillment, the provider owns setup and cleans any
   * unpublished partial resources before rejecting. Ownership transfers on
   * fulfillment; subsequent turn or infrastructure failure settles through
   * the returned run. Distinct starts may overlap; cancellation, failure,
   * result settlement, and disposal remain independent for each run.
   */
  start(request: ResolvedSubagentStartRequest): Promise<SubagentRun>
  /**
   * OPTIONAL (continuable-creation capability): contribute the detached
   * creation inputs that distinguish this provider's continuable children —
   * only whether the child session is seeded with parent history. Method
   * presence IS the capability: the service rejects continuable starts on
   * providers without it, while a provider that has it may still serve
   * ordinary one-shot delegations.
   *
   * This is the provider's ONLY participation in a continuable child. The
   * continuation manager owns identity reservation, composition, Agent
   * creation, prompt delivery, cold resume, ownership, and disposal, so a
   * provider never sees the child's Agent, handle, turns, or teardown.
   * Distinct preparations may overlap; each follows its own signal and returns
   * data belonging only to `request.sessionId`.
   */
  prepareContinuable?(request: ContinuableCreateRequest): Promise<ContinuableCreateSpec>
}
```

プロバイダーの `start()` は公開済みの実行で解決されます。サービスは一意の `runId` を発行し、プロバイダーの正確な `localAgent` から `local` をスナップショットし、結果を監視して `subagent/start` を発行し、同じ実行を返します。`start()` の拒否は未公開リソースのクリーンアップを意味し、ライフサイクルのペアは発行されません。一方、公開後の結果の拒否は、発行済みのペアを閉じます。継続可能な Activation はそれぞれ、その常駐エポックに対して同じ監視専用のペアを発行します。そのためコールド再開は、新しい `runId` を持つ新たなエポックです。対になる `subagent/end` には、同じ ID と最終出力またはインフラストラクチャ障害が含まれます。両方のイベントは監視専用であり、リスナー例外を封じ込めます。それらの `provider` フィールドは、実行または Activation エポックを開始したプロバイダーを示します。エッジが発行された時点でそのプロバイダーが登録されたままであることを主張するものではありません。

## プロセス内バックエンド: 深さとシード

spawn および fork バックエンドは、`parent.ctx` を通じて通常の単発エージェントを作成し、キャンセルをコア作成処理に渡し、`AgentHandle` を通じて破棄します。継続可能な子は、代わりに継続マネージャーが自身のアクティベーション所有者スコープを通じて作成します。プロバイダーを削除すると新規開始はブロックされますが、受理済みの実行は取り消されません。各子には、親の登録を継承するのではなく、新しいフラットなスコープが与えられます。深さと fork のシード設定では、既存のエージェントおよびセッションの用語を再利用します:

- **委任の深さ** は、永続的な `SessionHeader.delegationDepth` とマージ拡張可能なランタイムフィールド `AgentOptions.subagentDepth` で表されます。値がない場合は最上位の深さ 0 を意味し、存在する値のうち大きい方が優先されます。この抽象的な継ぎ目が両方のフィールドを所有し、ループはそれらを設定も参照もしません。そのため、プロセス内の子は親の深さ + 1 を永続化し、コールド再開で深さを下げることはできず、各開始時に導出された深さが安全な整数の範囲外である場合、または定義済みの絶対 `request.maxDepth` 上限を超える場合は拒否されます。
- **フォークのシード設定** では、[`CreateAgentOptions.seed`](core.md#creation-and-ownership)を使用します（これは `SessionEvent[]` のプレフィックスを `AgentLoop.createAgent` → `ctx.sessions.prepare({ seed })` に渡すもので、`ctx.agents.resume()` が使用するものと同じプリミティブです）。フォークバックエンドは、親のログの *バランスの取れた完了済みターンのプレフィックス* 、つまり親の最後の `turn/end` までを含むイベントを渡します。そのため、シードは 0 から連続し、[不変条件](../../packages/runtime-diagnostics/invariants)のリプレイで受け入れられます（処理中でバランスが取れていないターンは除外されます）。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts` によりソースから生成されています（doc-sync で `pnpm run verify-cordis-catalog` により最新性を検証し、`pnpm run gen-cordis-catalog` で再生成します）。このセクションは、ページの両方の言語版でバイト単位で同一です。シグネチャブロックは `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義されており、フレームワークから継承される `ctx` API は [cordis-api/inherited.md](../cordis-api/inherited.md) にあります。

<a id="ctxsubagents--subagentruntime"></a>

### `ctx.subagents` — `SubagentRuntime`

ワンショット実行、永続的な検出、継続可能な子操作を備えた名前付きプロバイダレジストリ。

```ts cordis-catalog
/**
 * Establish one durable continuable child and deliver its initial prompt.
 * Resolves when the child's inbox accepts that prompt, without waiting for the
 * turn to start or for the message to reach the Session log; any earlier
 * failure rejects with no ids and rolls back the child entirely.
 * @param spec - provider, delegation request, and caller cancellation.
 * @returns the durable child id and the accepted prompt's message id.
 * @throws when continuation services are unavailable or materialization fails.
 */
async startContinuable(spec: ContinuableStartSpec): Promise<ContinuableStart>

/**
 * Deliver one later message to a continuable child as its next FIFO turn. A
 * resident child's Agent inbox accepts it directly (waking a `waiting`
 * Activation), while an absent one is cold-resumed from its persisted
 * Session. The Agent inbox is the only queue, so every accepted message has
 * one observable order.
 * @param parent - the exact live direct parent authorizing this delivery.
 * @param childId - durable child session id.
 * @param content - user-role content to deliver.
 * @param options - the message source fields and caller cancellation, which stops the
 *   operation only before inbox acceptance.
 * @returns the accepted message's inbox id.
 * @throws when continuation services are unavailable, parent authority is
 *   rejected, or the message was not admitted.
 */
async followup( parent: Agent, childId: SessionId, content: ContentBlock[], options: SubagentFollowupOptions, ): Promise<MessageId>

/**
 * Interrupt one live continuable child's current turn under a human parent
 * address or an exact live ancestor Agent. Fire-and-return: the cancel
 * signal is issued before this returns, but the target may keep running
 * until it observes the signal. Unclaimed pending inbox work, the Activation,
 * and published descendants are preserved; claimed work is not requeued.
 * Once the interrupted driver is idle, a waking send resumes the parked FIFO
 * queue. An absent target — including a one-shot or unknown id —
 * is an accepted no-op, as is a manager-less composition, which cannot own a
 * live Activation.
 * @param targetSessionId - the durable child session id to interrupt.
 * @param authority - the human parent address or exact live ancestor Agent.
 * @throws {SubagentError} `UNAUTHORIZED` when the authority does not own the
 *   live target.
 */
interrupt(targetSessionId: SessionId, authority: SubagentInterruptAuthority): void

/**
 * Deliver selected content from one live continuable child to its durable
 * direct parent. The child is the authority credential; callers cannot name a
 * recipient. Reporting does not conclude the child's turn or Activation.
 * @param child - exact live reporting child.
 * @param content - selected model-facing content.
 * @param options - parent scheduling and pre-acceptance cancellation.
 * @returns the stable identity of the parent-accepted message.
 * @throws when continuation services are unavailable, sender authorization
 *   fails, or the direct parent is not live.
 */
async reportFrom( child: Agent, content: ContentBlock[], options: SubagentReportOptions, ): Promise<MessageId>

/**
 * Compose one deployment capability into every continuable child's
 * unpublished creation context on fresh creation and cold resume. Grants wait
 * for the next Activation; removing the contribution revokes every resident
 * installation immediately.
 * @param contribution - synchronous child-scope installer.
 * @returns the exact Cordis effect disposer.
 */
registerContinuableSetup(contribution: ContinuableSetupContribution): () => void

/**
 * Close continuable admission below exact live parent Agents, stop only their
 * visible descendant Activations synchronously, then await admitted scoped
 * materializations and release those forests child-first. The scoped cutoff
 * lasts until each exact parent leaves the registry; unrelated parent trees
 * remain live.
 * @param parents - exact host-owned parent Agents entering teardown.
 * @returns once every retained descendant Activation released its `AgentHandle`.
 * @throws an aggregate error after all branches settle when any failed.
 */
async drainContinuableDescendants(parents: readonly Agent[]): Promise<void>

/**
 * Enumerate the parent's direct session-backed subagents without loading or
 * resuming an Agent and without any query service: the listing merges the live
 * session store with optional session persistence (live-preferred) and
 * serves each child's durable mode/label from the registered `subagent`
 * projection unit down a three-rung ladder — the registry's watermark
 * snapshot for a live child; for a cold one, a durable projection-cache
 * row when the optional cache serves an own-suffix identity (its `seq`
 * gate proves the value postdates the fork seed, where a child's own
 * descriptor is immutable once appended), else one persistence inspection
 * folded through the registry. The
 * projection fold is the single classification authority; per-child
 * diagnostics relay a fold that served no identity or a failed inspection,
 * never a list-time descriptor parse. Absent persistence, enumeration is
 * live-only (a cold child cannot be resumed then either, so its absence is
 * capability absence, not an error). This service consults no Agent
 * registrations, Activations, or providers.
 *
 * Every persistence read receives `signal`, and the listing rechecks
 * cancellation around each of those awaits. Read rejections that settle
 * after an abort become a stable `SubagentError` with code `CANCELLED`.
 * @param parentSessionId - parent session whose direct children are listed.
 * @param signal - caller-owned cancellation forwarded to persistence reads
 *   and observed around every read await.
 * @returns children and per-child diagnostics ordered by `createdAt`, then id.
 * @throws {@link SubagentError} when the projection registry or the session
 *   store is not mounted, or the caller cancels the listing.
 */
listChildren(parentSessionId: SessionId, signal?: AbortSignal): Promise<SubagentListEntry[]>

/**
 * Enumerate the root's complete session-backed subagent tree in stable
 * pre-order from one live-preferred corpus, without loading or resuming an
 * Agent. Ordinary sessions and one-shot children remain traversal nodes so
 * continuable descendants below them are discovered; each returned entry
 * adds its durable `parentId` and root-relative `depth`. Identity resolution,
 * diagnostics, optional persistence, and cancellation follow the same
 * projection-backed contract as {@link listChildren}.
 * @param rootSessionId - session whose complete descendant tree is listed.
 * @param signal - caller-owned cancellation forwarded to persistence reads
 *   and observed around every read await.
 * @returns children and per-candidate diagnostics with tree position, in
 *   stable pre-order.
 * @throws {@link SubagentError} under the same conditions as {@link listChildren}.
 */
listDescendants(rootSessionId: SessionId, signal?: AbortSignal): Promise<SubagentDescendantListEntry[]>

/**
 * Register a provider under its name. Registration is effect-scoped and HMR
 * safe; removing a provider blocks new starts but does not revoke runs that
 * were already returned to their holders.
 * @param provider - the trusted provider implementation.
 * @returns the exact Cordis effect disposer.
 */
registerProvider(provider: SubagentProvider): () => void

/**
 * Look up a provider by name.
 * @param name - the provider name.
 * @returns the provider, or undefined when absent.
 */
getProvider(name: string): SubagentProvider | undefined

/**
 * List registered provider names in insertion order.
 * @returns the registered names.
 */
list(): string[]

/**
 * Establish a published child on the named provider. Capability and semantic
 * checks run before delegation. Provider ownership lasts until its promise
 * fulfills; a rejection therefore has no run for the caller to dispose and
 * emits no run lifecycle events. Post-publication turn and infrastructure
 * failures settle through the returned run.
 * @param name - the provider to use.
 * @param request - child label, prompt, parent, signal, and optional capabilities.
 * @returns the published holder-owned run.
 */
async start(name: string, request: SubagentStartRequest): Promise<SubagentRun>
```

型: [Agent](core.md) · [ContentBlock](llm-streaming.md) · [MessageId](llm-streaming.md) · [SessionId](core.md)

ソース: [`packages/subagent/subagent/src/index.ts:171`](../../packages/subagent/subagent/src/index.ts)

<a id="subagent-events"></a>

### `subagent/*` イベント

<a id="subagentend--emit"></a>

#### `subagent/end` — 発行

公開された子が完了しました。スコープでフィルターされたディスパッチでは、`subagent/start` と同じ委譲元の親キャリアを使用するため、ライフサイクルのペアは同じスコープの対象に届きます。

```ts cordis-catalog
/**
 * A published child settled. Scope-filtered dispatch uses the same delegating
 * parent carrier as `subagent/start`, so the lifecycle pair reaches the
 * same scoped audience.
 * @param info - the run identity and terminal outcome.
 * @dshScopeScan unsupported
 * @mode emit
 */
'subagent/end'(this: Scoped<SubagentRuntime>, info: SubagentRunEndInfo): void
```

型: [Scoped](scope.md)

ソース: [`packages/subagent/subagent/src/index.ts:166`](../../packages/subagent/subagent/src/index.ts)

<a id="subagentprovider-added--emit"></a>

#### `subagent/provider-added` — 発行

プロバイダーがレジストリで解決可能になりました。

```ts cordis-catalog
/**
 * A provider became resolvable in the registry.
 * @param provider - the registered provider.
 * @mode emit
 */
'subagent/provider-added'(provider: SubagentProvider): void
```

ソース: [`packages/subagent/subagent/src/index.ts:140`](../../packages/subagent/subagent/src/index.ts)

<a id="subagentprovider-removed--emit"></a>

#### `subagent/provider-removed` — 発行

プロバイダーがレジストリから離脱しました。受け入れ済みの実行はホルダーが所有したままです。

```ts cordis-catalog
/**
 * A provider left the registry. Accepted runs remain holder-owned.
 * @param name - the provider name that no longer resolves.
 * @mode emit
 */
'subagent/provider-removed'(name: string): void
```

ソース: [`packages/subagent/subagent/src/index.ts:146`](../../packages/subagent/subagent/src/index.ts)

<a id="subagentstart--emit"></a>

#### `subagent/start` — 発行

プロバイダーが公開された子を確立しました。プロセス内プロバイダーでは、この通知中に `ctx.agents.get(info.id)` が解決されます。スコープでフィルターされたディスパッチは、委譲元の親をキーとしてキャリアを識別するため、親スコープのリスナーは自身の委譲のみを監視します。`subagent/end` と対になります。

```ts cordis-catalog
/**
 * A provider established a published child. For in-process providers,
 * `ctx.agents.get(info.id)` resolves during this notification.
 * Scope-filtered dispatch keys the carrier by the delegating parent, so a
 * parent-scoped listener observes only its own delegations. Paired with
 * `subagent/end`.
 * @param info - the provider and published child identity.
 * @dshScopeScan unsupported
 * @mode emit
 */
'subagent/start'(this: Scoped<SubagentRuntime>, info: SubagentRunInfo): void
```

型: [Scoped](scope.md)

ソース: [`packages/subagent/subagent/src/index.ts:157`](../../packages/subagent/subagent/src/index.ts)
<!-- END GENERATED cordis-surface -->
