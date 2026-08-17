# クックブック: 拡張プラグインの形

Harness 拡張のリファレンスパターンです。スニペットでは import とヘルパー実装を省略しており、そのままコピー＆ペーストで完成するものではありません。具体的な作成手順については、[パッケージのチェックリスト](adding-a-package.md)、[最初のツールのチュートリアル](../user/develop/basic/tool.md)、[ツールリファレンス](adding-a-tool.md)、[LLM アダプターガイド](adding-an-llm-adapter.md)を参照してください。[アーキテクチャ](../architecture.md)は、システムと拡張ポイントの対応表を管理します。

## ツールプラグイン

ツールは `ctx.tools` に登録します。アノテーション付きの `defineTool` の例（型付きの `execute` 引数、結果の構築、`run_in_background` パターン）は、[adding-a-tool.md](adding-a-tool.md)にあります。このガイドがツール定義の信頼できる情報源です。生の JSON-Schema `ToolDefinition` も `ctx.tools.register()` が直接受け付けます（MCP 由来のツールはこの方法で到着します）。`defineTool` はファーストパーティツール向けの型付きヘルパーです。

## フックプラグイン（権限ゲートの例）

この権限ゲートはフックプラグインの一例です。`tools/pre-execute` ゲートから型付きの決定を返し、呼び出しを許可または拒否します。サンドボックス、権限、プランモードのプラグインでは、この拡張ポイントを使用できます。フックプラグインは他の拡張ポイントをインターセプトでき、必ずしも権限ゲートではありません。「ネイティブフック」とは、インターセプトポイント上の通常の Cordis プラグインです。外部プロトコルは必要ありません。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

declare function isAllowed(exec: ToolExecution): Promise<boolean>

export const name = 'permission-gate'

export function apply(ctx: Context) {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (!(await isAllowed(exec))) {
      return { kind: 'deny', reason: 'Denied by policy.' }
    }
    return next()
  })
}
```

このウォーターフォールは、並べ替え可能なポリシーレイヤーです。不変条件で単調な最終拒否が必要な場合は `ctx.tools.guard()` を使用します。プラグインが実際のディスパッチ期間をラップする必要がある場合は `tools/execute` を使用します（timeouts/retries/metrics。置き換え可能なのは `exec.signal` だけです）。明示的な結果変換には `tools/post-execute` を使用し、不変の最終結果を限定的に観察するには `tools/result` を使用します。選択ルールは、[ツール追加ガイド](adding-a-tool.md#execution-policy-and-observation)に記載されています。

## UI プラグイン

UI プラグインは、`session/event` フィード（`assistant/chunk` としてのアシスタントトークンストリームに加え、ターン／ステップ境界とツールアクティビティ）からレンダリングし、`agent.followup()` / `agent.steer()` を介して入力を戻します。一方、組み込み Web Client にビジネス行を追加するブラウザプラグインは、`ConversationNodeDefinition` とキー付き Chat レンダラーを登録します。[Conversation Node ガイド](adding-a-conversation-node.md)に従ってください。

```ts
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

declare function render(text: string): void
declare function onUserInput(handler: (text: string) => void): void

export const name = 'my-ui'
export const inject = ['agents']

export function apply(ctx: Context) {
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'assistant/chunk' && event.data.chunk.type === 'text-delta') {
      render(event.data.chunk.text)
    }
  })
  onUserInput(text => ctx.agents.get(SessionId('client-session'))?.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })))
}
```

## 外部プロトコルドライバー

*プロトコルドライバー* は、ワイヤ上のピアを `ctx.agents` に適合させます。UI または自動化クライアントに提供できます。stdio ドライバーは stdout を管理し、ファクトリーを介してエージェントを作成または再開し、プロトコルリクエストを `followup()` または `cancel()` にマッピングします。低レベルのプロンプトリクエストは、永続的なエンキュー受領書を返します。`MessageId` と `turn/end` を対応付けて結果を取得することはありません。エージェント全体の状態は別途公開します。自動化メソッドは、受領書から次のアイドル状態まで待機し、その明示的に所有する区間を要約できます。一方、UI は通常、終端のないイベントストリームを継続して観察します。破棄が静止状態に達するよう、`AgentHandle.dispose()` でエージェントを終了してください。

[`packages/acp/acp`](../../packages/acp/acp)は、自動化専用の実装例です。Agent Client Protocol JSON-RPC stdio を通じて新しいテキストセッションを公開し、コミット済みのアシスタントテキストを発行し、所有するエージェント向けに一回限りのマシン権限応答者を登録します。[README](../../packages/acp/acp/README.md)では、正確なメソッド、イベント順序、ライフサイクル契約を定義しています。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-protocol-bridge'
export const inject = ['agents', 'sessions', 'sessionPersistence']

export function apply(ctx: Context) {
  // Stream every logged assistant text/reasoning delta out to the client.
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'assistant/chunk') {
      const chunk = event.data.chunk
      if (chunk.type === 'text-delta') {
        // sendToClient({ kind: 'message_chunk', text: chunk.text })
      }
    }
  })
  // Inbound "prompt": create/resume an agent, feed it, and return its enqueue receipt.
  // Whole-agent status is a separate notification; no turn end belongs to this prompt.
  // Teardown reaches quiescence via AgentHandle.dispose() (stop + await exit).
}
```

## 実行可能な配線

実行可能なリーフは、`examples/*/cordis.yml` からプラグインツリーを読み込みます。ルートの `demo:*` スクリプトとそれらのリーフディレクトリが、信頼できるインベントリです。製品の `dsh` ランチャーは Web と単発のヘッドレス実行を管理します。ACP リーフは [`@deepseek-ai/dsh-acp-demo`](../../packages/examples/acp-demo) を使用し、JSON-RPC リーフは [`@deepseek-ai/dsh-sdk-jsonrpc-demo`](../../packages/examples/jsonrpc-demo) を使用します。ヘッドレススナップショットリーフは、[`@deepseek-ai/dsh-agent-spine-demo`](../../packages/examples/agent-spine-demo) と JSONL 永続化を明示的にマウントしてから、出荷するアプリパッケージではなく、例が所有するテストフィクスチャを通じてそれらを駆動します。

## 機能 → メカニズムの対応表

すべての製品機能は、文書化された拡張ポイント上のリスナーにマッピングされます。これは、検証可能にしたマイクロカーネルの主張です（[マイクロカーネル Agent Note](../../.agents/notes/implemented/architecture/2026-06-11-microkernel-event-taxonomy.md)）。どの行もループを変更しません。

`system-prompt/assemble` は、専門家向けの協調的なアセンブリ全体の変換です。返されるアセンブリが権威を持つため、リスナーの作成者は有効な Code Mode と構造化出力プロトコルのコントリビューションを維持する責任を負います。表示、検索、実行の間で整合を維持する必要があるツールフィルタリングには、`ctx.tools.restrict()` を推奨します。

| 製品機能 | プラグインの仕組み |
|---|---|
| フックシステム（ユーザー + プロジェクトレベル） | `agent/session-start`、`agent/pre-step`、`agent/request`、`tools/pre-execute`、`tools/post-execute`、`agent/turn-stopping` のリスナーです。ウォーターフォールは型付きの判断を返し、`agent/turn-stopping` は別のステップを誘導できます。`dsh-hooks-claude-code` / `dsh-hooks-codex` ブリッジは、フック設定ファイルをこれらの拡張ポイントに対応付けます |
| `/goal` | `ctx.goals` は永続的な状態を保持し、`dsh-goal-round-driver` は公開 `Agent` を介して同一セッションのラウンドをスケジュールします。個別のコマンド/ツールプロデューサーが人間/モデルの制御を公開します |
| `/loop` | `turn/end` セッションイベントで、次の反復を `followup()` します。または強制的に続行します |
| 動的ワークフロー | `ctx.workflowEngine` + ワーカースレッドエンジン + `workflow` ツールです。構造化されたプロセス内の子は、スコープ付きのプロンプト/ツール登録、単調なツールガード、最終的な `tools/result` コミット（包含する `run_code` を含む）、および構造化出力実行の単調な `concludeTurn()` マーカーによって出力を強制します |
| キュー済み + 誘導メッセージ | コアの `Agent.followup()` / `Agent.steer()` |
| コンテキスト圧縮（自動 + 手動） | `ctx.compaction` 抽象的な継ぎ目 + `dsh-compaction-basic` です。自動圧力はシリアル `agent/pre-step` で実行され、標準的なオーバーフロー回復は `agent/request-error` で実行され、手動の呼び出し元は同じ圧縮サービスを使用します（[圧縮 Agent Note](../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md)） |
| システムプロンプトの設定可能性 | 順序付けとスコープローカルなシャドーイングを備えた `ctx.systemPrompt.section()` |
| AGENTS.md（ルート） | ファイルを読み取るセクションプロバイダー |
| AGENTS.md（サブディレクトリ、タッチ時）+ ファイル変更通知 | ウォッチャー / ツール結果リスナーからの `agent.inject()` |
| 組み込みツール | `ctx.tools.register()`。スキーマはアセンブリに自動的に渡されます — `dsh-tool-*` ファミリー（bash、fs、web、subagent、todo）が同梱の例です |
| ToolSearch / 段階的な開示 | 表示セットの変更に応じて、スコープ付きの `ctx.tools.restrict()` 登録を置き換えます。レジストリは、表示、検索、実行の整合性を保ちます |
| ツールの期限 / 再試行 / メトリクス | コアディスパッチを `tools/execute` でラップします。ラッパーは `exec.signal` を置き換え、委譲し、正規化された結果を1つのレキシカル有効期間内で検査できます |
| 最終ツール結果のメトリクス / 監査 / キャプチャ | 不変で権威ある結果を `tools/result` で観測します。プラグインが結果を変換するかコンテキストを付加する必要がある場合にのみ、代わりに `tools/post-execute` を使用します |
| 単調な終端ターンポリシー | 成功した終端ツールから `ToolExecution.concludeTurn()` を呼び出します。同じ応答内の後続ツール呼び出しは引き続きガード可能で、ステップ後にループが停止します |
| サブプロセスサンドボックス（landlock / sandbox-exec） | `dsh-bash-sandbox` を通じて `ctx.sandbox` バックエンドを使用します。機能レベルでの拒否には `tools/pre-execute` を使用します |
| 権限システム / AskUserQuestion | `tools/pre-execute` から `ask` を返し、`ctx.approval` を通じて回答します。通常のユーザー質問には、モデル向けの個別の質問ツールを登録します |
| 計画モード | [`@deepseek-ai/dsh-plan-mode`](../../packages/plan/plan-mode/README.md) — 記録される `plan/mode` 状態、`plan:policy` ガイダンスセクション、`/plan [message]` エントリ、`/plan off` による直接終了、およびユーザーがレビューした `exit_plan_mode` 終了です。強制は独立したサンドボックス/承認の軸に留まります |
| サブエージェント委任 | `ctx.subagents` プロバイダーレジストリ（`dsh-subagent-spawn-in-process`/`-fork`/`-acp`/`-codex`/`-claude-code`/`-dsh-sdk`）+ 1つの設定済みプロバイダーをモデルに公開する `dsh-tool-subagent` |
| MCP | サーバーごとに1つのプラグイン: ツールを検出 → `ctx.tools.register()` |
| スキル | セクション + ツール登録。呼び出し時に `inject()` スキルコンテンツを使用します |
| メモリ | セクションプロバイダー + ツール |
| スケジュール済みタスク（cron） | プラグインがモデルから呼び出し可能なスケジューリングツールを登録します。タイマー起動 → アイドル時は `followup(…, {source: {kind: 'cron', …}})` / 多忙時は `inject()` 通知 |
| UI（GUI、CLI は JSONL を出力） | `session/event` をリッスンします（アシスタントチャンク、境界、ツールアクティビティ）。入力 → `followup()` |
| Web Client Chat ビジネスノード | `ConversationNodeDefinition` と `conversation.chat.node` をキーとするレンダラーを登録します |
| SessionTelemetryBackend / 再生可能なトレース | `session/event` → JSONL、再生 = `sessions.create(id, { seed })` |
| モデルアダプター | `registerAdapter` を介した `LlmAdapter` サブクラス（`dsh-llm-deepseek`、`dsh-llm-pi-ai`） |
| プラグインのホットリロード | すべての登録は `ctx.effect` です → ベンダー提供の HMR がそのまま機能します |
