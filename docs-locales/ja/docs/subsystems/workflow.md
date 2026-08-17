# ワークフロー

ワークフローの抽象的な境界により、エージェントはサブエージェントを起動する、モデルが記述したオーケストレーション SCRIPT を実行できます。[サブエージェント](subagent.md)と同様に、これは**任意の機能の一つ**であり、エージェントループの一部ではありません。そのため、型と操作は[core.md](core.md)ではなくここにあります。bash と同様に、各コンテキストで ONE のエンジン実装が `ctx.workflowEngine` を提供できます。名前付きプロバイダーレジストリはありません（2 つ目のエンジンは並行して動作するのではなく、プラグイン設定によって最初のエンジンを置き換えます）。

サービス定義: [dsh-workflow](../../packages/workflow/workflow)（`ctx.workflowEngine` と以下の用語）。サービスプロバイダーは [dsh-workflow-worker-thread](../../packages/workflow/workflow-worker-thread) です（`node:worker_threads` エンジン — 実行ごとに 1 つのワーカーがあり、その内部にスクリプトの vm コンテキストがあります）。モデル向けのコンシューマーは [dsh-tool-workflow](../../packages/workflow/tool-workflow) です。提案と根拠については、[dynamic-workflows Agent Note](../../.agents/notes/implemented/feature/2026-07-05-dynamic-workflows.md)を参照してください。

ソース: ブラウザーセーフな用語は [`packages/workflow/workflow/src/types.ts`](../../packages/workflow/workflow/src/types.ts) に、Host リクエストとライブ実行ハンドルは [`runtime-types.ts`](../../packages/workflow/workflow/src/runtime-types.ts) にあります。

## 開始リクエスト

実行を開始するときに呼び出し元が要求する内容です。通常のワークフローツールは、モデルの `{ script, meta, args }` 呼び出しと呼び出し元エージェントからこれを構築します。特殊なコンシューマーは、実行に対してエンジン全体で 1 つの `subagentProvider` と下位の `maxTotalAgents` を選択することもできますが、スクリプトはどちらのポリシーも観測または置換できません。`meta` と `args` はプレーンな JSON DATA です（エンジンは `meta` をスキーマに照らして検証し、実行前に明示的に拒否します。これを取得するためにスクリプトテキストが評価されることはありません）。`parent` は REQUIRED です。スクリプトが開始するすべての子はこれに紐付けられ、cwd、系譜、深さは [サブエージェントの抽象的な境界](subagent.md)を通じて渡されます。

```ts type-equiv
/**
 * What a caller asks for when starting a workflow run. `meta` and `args` are
 * plain JSON data by the seam contract. `parent` is required because every
 * `agent()` spawned by the script is attributed to that live Agent.
 */
interface WorkflowStartRequest {
  /** The plain-JS script body (top-level await allowed; ends with `return <json-value>`). */
  script: string
  /** The workflow's identity block, as plain JSON data (shape-validated by the engine). */
  meta: WorkflowMeta
  /** Optional input exposed verbatim to the script as the `args` global. */
  args?: unknown
  /** Optional engine-wide child-provider override for this run. */
  subagentProvider?: string
  /** Optional per-run total-child ceiling. */
  maxTotalAgents?: number
  /** The agent on whose behalf the run executes (parent of every child). */
  parent: Agent
  /** Cancels the run when aborted. */
  signal?: AbortSignal
}
```

## ワークフローの識別情報: `WorkflowMeta`

開始リクエストにデータとして含まれる識別情報ブロックです（ツールの `meta` パラメーター。フィールドの用語は Claude Code dynamic-workflows のメタブロックと一致します）。`phases` は進捗用の語彙にすぎません。`phase()` 呼び出しはオブザーバー向けのタイトルと一致しますが、実行構造を意味するものではありません。

```ts type-equiv
/**
 * The script's identity block, provided as plain JSON data alongside the
 * script body (the model-facing tool carries it as its `meta` parameter) and
 * validated by the engine before the body runs. `name`/`description` are
 * required; the rest is optional annotation. The field vocabulary matches the
 * Claude Code dynamic-workflows meta block.
 */
interface WorkflowMeta {
  /** Short kebab-case workflow name (display + persistence key). */
  name: string
  /** One-line description of what the workflow does. */
  description: string
  /** Optional guidance on when this workflow applies (shown in listings). */
  whenToUse?: string
  /** Optional phase declarations matched by `phase()` calls. */
  phases?: WorkflowPhase[]
}
```

## 最終結果: `WorkflowResult`

1 回の実行の結果であり、`WorkflowRun.result` によって解決されます。`value` はスクリプトの具体化された戻り値です。これはプレーンな Host realm の JSON データ（スクリプトが何も返さなかった場合は `null`）であり、`completed` に対してのみ意味を持ちます。`stopReason` は CLOSED 共用体です（エンジン所有であり、コンシューマーは網羅できます）。`completed` | `cancelled` | `error`。`completed` 以外の理由では、失敗は `error` に格納され、コンシューマーは部分出力を成功として報告するのではなく、それを `isError` ツール結果にマッピングします。

```ts type-equiv
/**
 * The outcome resolved by a live workflow run. `value` is
 * the script's materialized return value (plain host-realm JSON data; `null`
 * when the script returned `undefined`) — meaningful only for `completed`.
 * A non-`completed` reason carries the failure in `error`; the consumer maps
 * it to an `isError` tool result rather than reporting partial output.
 */
interface WorkflowResult {
  /** The script's return value (host JSON data; `null` for no return). */
  value: unknown
  /** Why the run settled. */
  stopReason: WorkflowStopReason
  /** The failure message (present iff `stopReason` is not `completed`). */
  error?: string
  /**
   * How many `agent()` calls the run accepted over its whole lifetime. On a
   * graceful settlement this is the script-side count (calls still queued for
   * a concurrency slot included); on a termination path (grace force-settle,
   * worker death) it degrades to the host-observed count — calls queued
   * inside a terminated script are unknowable then.
   */
  agentsStarted: number
}
```

## ライブ実行: `WorkflowRun`

スクリプトの実行中にコンシューマーが保持するハンドルです。コンシューマーは `result` を待機し、実行中に `cancel` を実行でき、すべての経路で必ず `dispose` を実行しなければなりません。`result` は reject しません。スクリプトの失敗は `stopReason: 'error'` で解決されます。また、一度実行がキャンセルされると、スクリプト自体が解決しない場合でもエンジンの制限付き猶予時間内に SETTLE します（エンジンが `cancelled` を強制的に settle し、worker-thread エンジンはスクリプトのワーカーを終了します）。そのため、`result` を待機するコンシューマーがキャンセル後に停止したままになることはありません。`dispose()` = キャンセル + その制限付き settle + 子の静止であり、停止したスクリプトのためにハングすることはありません。

```ts type-equiv
/**
 * Holder-owned live workflow. `result` never rejects; consumers may cancel
 * and must call idempotent `dispose()` to await script and child quiescence.
 */
interface WorkflowRun {
  readonly id: WorkflowRunId
  /** The validated meta block available before the script body runs. */
  readonly meta: WorkflowMeta
  readonly result: Promise<WorkflowResult>
  /** Cancel the run and its children. */
  cancel(reason?: string): void
  /** Cancel if needed and await bounded settlement and cleanup. */
  dispose(): Promise<void>
}
```

## 失敗時の規律: `WorkflowError.fatal`

スクリプト内でのフックの誤用、すなわち不正な引数、不明または遅延された `agent()` オプション、[構造化出力のサブセット](../../packages/core/tools/README.md)の範囲外のスキーマ、上限到達、抽象的な境界の開始失敗、キャンセルは、`fatal: true` を伴う `WorkflowError` をスローします。`parallel()`/`pipeline()` コンビネーターは、項目を `null` にマッピングするのではなく致命的なエラーを再スローします。入力ミスのあるオプションは、通常の子の失敗として読めるものに溶け込むのではなく、必ず明示的にスクリプトを停止させる必要があります。項目ごとの `null` は、子実行の失敗（`completed` 以外の停止理由）と、ステージ内の通常のスクリプトエラーのために予約されています。

## イベント

`workflow/*` イベント（`workflow/start`、`workflow/phase`、`workflow/log`、`workflow/agent-start`、`workflow/agent-end`、`workflow/end`。[イベントカタログ](#cordis-surface)を参照）は、データスナップショットを伴う**観測専用** の emit です。すべてのペイロードはライブの `WorkflowRun` ではなく `WorkflowRunInfo`（id + meta）で始まるため、サブスクライバーが `cancel`/`dispose` を取得することはできません。また、`workflow/end` は意図的に結果値を省略します（結果を観測するリスナーが、呼び出し元の結果への可変エイリアスを受け取ってはなりません）。各 emit はリスナーごとに隔離されます。例外を送出するサブスクライバーはログに記録されるだけで伝播せず、その後に登録されたリスナーを飢餓状態にすることもありません。各リスナーは独自のペイロードクローンを受け取るため、それを変更してもエンジンや他のリスナーは破損しません。この隔離は `subagent/start`/`subagent/end` を反映しています。

## 永続的な Chat レコード

最上位の `dsh-tool-workflow` コンシューマーは、実行の所有権を変更せずに、表示用の事実を呼び出し元の親 Session に投影します。実行が受理された後に `tool-workflow/run-start` を書き込み、`runId + seq` によってメンバーの開始と終了を対応付け、結果が判明して破棄が静止状態に達した後にのみ `tool-workflow/run-end` を書き込みます。ネストしたトランスポート呼び出しはレコードを書き込みません。最初の追記失敗により、その実行の以降の書き込みは無効化されます。したがってログは空、または正当な連続プレフィックスのままとなり、ツール結果は変更されません。

`dsh-tool-workflow/invariant` は、ライブコミット前および Session のロード時に同じプロトコルを検証します。すなわち、実行ごとに開始は 1 つ、メンバーシーケンスは正で一意、メンバー終了は対応付けられ、オープンなメンバーを残して実行が終了せず、実行終了後に更新がないことです。ログ末尾でメンバー終了または実行終了が欠けている場合は、破損ではなく有効な中断の証拠です。

`dsh-client-ui-workflow-run` は、元のワークフローツールノードの後で、4 つのイベントを Conversation Node エンジンを通じて、実行開始シーケンスにアンカーされた 1 つの `workflow-run` Chat ノードへ畳み込みます。フェーズグループは実際のメンバー開始からのみ生成され、省略されたフェーズと `''` の違いを含め、文字列を正確に保持します。閉じた Location は、欠けている終端情報を中断表示に変換します。[UI パッケージ README](../../packages/client/ui-workflow-run/README.md) が、開示、ステータス、同一親内のローカルナビゲーションの動作を管理します。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts` によりソースから生成されています（doc-sync で `pnpm run verify-cordis-catalog` により最新性を検証。`pnpm run gen-cordis-catalog` で再生成）。このセクションはページの両言語版でバイト単位で同一です。シグネチャブロックでは `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義されており、フレームワークから継承した `ctx` API は [cordis-api/inherited.md](../cordis-api/inherited.md) にあります。

<a id="ctxworkflowengine--workflowengine-abstract-seam"></a>

### `ctx.workflowEngine` — `WorkflowEngine`（抽象的な接続点）

ワークフロー サービス定義 の契約です。無効なリクエストは公開前に例外を送出します。ライブ実行はホルダーが所有し、その結果は拒否されません。キャンセルと破棄には上限があり、破棄はその上限内で子のクリーンアップを待機します。ライフサイクルリスナーの失敗は隔離され、結果の確定時に `workflow/end` が正確に 1 回発火します。

```ts cordis-catalog
/**
 * Parse and execute a workflow script.
 * @param request - the script, its `args`, the parent agent, and an
 *   optional cancel signal.
 * @returns the live run; its `result` resolves when the script settles.
 */
abstract start(request: WorkflowStartRequest): WorkflowRun
```

ソース: [`packages/workflow/workflow/src/index.ts:157`](../../packages/workflow/workflow/src/index.ts)

<a id="workflow-events"></a>

### `workflow/*` イベント

<a id="workflowagent-end--emit"></a>

#### `workflow/agent-end` — emit

1 回の `agent()` 呼び出しが確定しました（正常な結果、子の失敗、または実行のキャンセル）。`agent.seq` により Events['workflow/agent-start'] と対応付けられ、開始された各呼び出しについて、すべての停止経路で正確に 1 回発生します。エンジン終了経路（猶予期間を超えてワーカーが停止された場合）では、エンジンが結果 `'cancelled'` で終了を合成します。

```ts cordis-catalog
/**
 * One `agent()` call settled (clean result, child failure, or run
 * cancellation). Paired with {@link Events['workflow/agent-start']} by
 * `agent.seq`, exactly once per started call on every stop path — on an
 * engine termination path (a worker killed past its grace) the end is
 * engine-synthesized with outcome `'cancelled'`.
 * @param info - the run's identity snapshot.
 * @param agent - the call identity plus its outcome.
 * @mode emit
 */
'workflow/agent-end'(info: WorkflowRunInfo, agent: WorkflowAgentEndInfo): void
```

ソース: [`packages/workflow/workflow/src/index.ts:79`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowagent-start--emit"></a>

#### `workflow/agent-start` — emit

1 回の `agent()` 呼び出しにより、公開済みの子実行が確立されました。`agent.seq` により Events['workflow/agent-end'] と対応付けられます。プロバイダーから公開済み実行を受け取らない呼び出しは、このペアのいずれのイベントも emit しません。

```ts cordis-catalog
/**
 * One `agent()` call established a published child run. Paired with
 * {@link Events['workflow/agent-end']} by `agent.seq`. A call that never
 * receives a published run from the provider emits neither
 * event in this pair.
 * @param info - the run's identity snapshot.
 * @param agent - the call's sequence number, label, phase, and child id.
 * @mode emit
 */
'workflow/agent-start'(info: WorkflowRunInfo, agent: WorkflowAgentInfo): void
```

ソース: [`packages/workflow/workflow/src/index.ts:68`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowend--emit"></a>

#### `workflow/end` — emit

ワークフロー実行が確定しました（停止理由を問いません）。WorkflowRun.result が解決されたときに発火します。Events['workflow/start'] と対応付けられます。

```ts cordis-catalog
/**
 * A workflow run settled (any stop reason). Fired when
 * {@link WorkflowRun.result} resolves. Paired with
 * {@link Events['workflow/start']}.
 * @param info - the run's identity snapshot.
 * @param result - the outcome data (stop reason, error, agent count) —
 *   deliberately WITHOUT the result value (see {@link WorkflowResultInfo}).
 * @mode emit
 */
'workflow/end'(info: WorkflowRunInfo, result: WorkflowResultInfo): void
```

ソース: [`packages/workflow/workflow/src/index.ts:89`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowlog--emit"></a>

#### `workflow/log` — emit

スクリプトがナレーション行（`log(message)` 呼び出し）を emit しました。

```ts cordis-catalog
/**
 * The script emitted a narration line (a `log(message)` call).
 * @param info - the run's identity snapshot.
 * @param message - the logged message, verbatim.
 * @mode emit
 */
'workflow/log'(info: WorkflowRunInfo, message: string): void
```

ソース: [`packages/workflow/workflow/src/index.ts:58`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowphase--emit"></a>

#### `workflow/phase` — emit

スクリプトがフェーズ（`phase(title)` 呼び出し）に入りました。これは観測者向けの進捗グループ化であり、実行セマンティクスはありません。

```ts cordis-catalog
/**
 * The script entered a phase (a `phase(title)` call) — progress grouping
 * for observers; no execution semantics.
 * @param info - the run's identity snapshot.
 * @param title - the phase title, verbatim.
 * @mode emit
 */
'workflow/phase'(info: WorkflowRunInfo, title: string): void
```

ソース: [`packages/workflow/workflow/src/index.ts:51`](../../packages/workflow/workflow/src/index.ts)

<a id="workflowstart--emit"></a>

#### `workflow/start` — emit

ワークフロー実行が開始されました。スクリプトの meta ブロックは検証済みで、本文はこれから実行されます。Events['workflow/end'] と対応付けられます。

```ts cordis-catalog
/**
 * A workflow run started — the script's meta block validated, the body
 * about to execute. Paired with {@link Events['workflow/end']}.
 * @param info - the run's identity snapshot (id + meta).
 * @mode emit
 */
'workflow/start'(info: WorkflowRunInfo): void
```

出典: [`packages/workflow/workflow/src/index.ts:43`](../../packages/workflow/workflow/src/index.ts)
<!-- END GENERATED cordis-surface -->
