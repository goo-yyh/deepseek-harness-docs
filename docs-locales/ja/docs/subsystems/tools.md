# ツール

[dsh-tools](../../packages/core/tools) のツールパイプラインです。[core.md](core.md) では、コアパッケージ間で共有されるパイプライン作成用の型として `ToolDefinition` を導入しています。モデル向けの[`ToolSchema`](llm-streaming.md#the-model-request-and-result) ワイヤ型は、モデルリクエストとともに宣言されます。このページでは、すべての `ToolDefinition` フィールド、それを構築する型付きスキーマ DSL、保護された実行型、UI 表示型について説明します。

ソース: [`packages/core/tools/src/index.ts`](../../packages/core/tools/src/index.ts) · [`packages/core/tools/src/schema.ts`](../../packages/core/tools/src/schema.ts) · [`packages/core/tools/src/presentation.ts`](../../packages/core/tools/src/presentation.ts)

## `ToolDefinition` — 登録済みツール

`ToolSchema`（モデル向けフィールド）に加え、必須の正規出力宣言、`execute` 関数、ホスト専用のスケジューラーメタデータ、任意の最終コンテンツコールバック、および任意の UI プレゼンターで構成されます。レジストリはこれらを保持し、ループはそれらを通じて呼び出しをディスパッチします。レジストリの `schemas()` は、明示的な許可リストによりモデル向けの `ToolSchema[]` を構築します。`output`/`execute`/`finalizeContent`/`timeoutMs`/`isConcurrencySafe`/`presentCall`/`presentResult` がモデルリクエストに漏洩してはなりません。

```ts type-equiv
/** Tool-owned canonical output contract used after the body returns a JSON value. */
interface ToolOutputDefinition {
  /** Raw supported JSON Schema enforced against every successful canonical value. */
  readonly schema: JsonSchemaNode
  /** Pure projection from validated arguments and value to Native/model content. */
  render(args: unknown, value: JsonValue): ContentBlock[]
  /** Pure replayable presentation projection, computed only for top-level calls. */
  presentationMeta?(args: unknown, value: JsonValue): JsonValue
}
```

```ts type-equiv
/** A registered tool: its schema plus the execution function. */
interface ToolDefinition extends ToolSchema {
  /** Mandatory canonical output declaration. */
  readonly output: ToolOutputDefinition
  /**
   * Run one accepted call and return only its canonical lossless-JSON value.
   * Async work must observe or forward `exec.signal` and settle only after its
   * owned work reaches quiescence. The registry preserves caller cancellation
   * through around-dispatch signal replacement and does not abandon this
   * promise, but it cannot hard-kill same-process code.
   * @param args - losslessly snapshotted, frozen model arguments.
   * @param exec - execution identity, cancellation signal, and context deferral.
   * @returns the canonical value declared by `output.schema`.
   */
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  /**
   * Synchronous last-mile transform for model-facing content. The registry
   * snapshots this callback when execution starts and invokes it exactly once
   * for every normalized outcome, including pipeline failures that bypass
   * `tools/post-execute`, immediately before lossless materialization.
   * Returning `undefined` preserves the content; every other result field
   * remains registry-owned. The callback must be total and must not throw.
   * @param exec - immutable execution identity and arguments.
   * @param result - complete normalized outcome before materialization.
   * @returns replacement content, or `undefined` to preserve it.
   */
  finalizeContent?(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): ContentBlock[] | undefined
  /**
   * Cooperative tool-call timeout budget in milliseconds. Omit for no deadline.
   * Enforced by `@deepseek-ai/dsh-tool-call-timeout-policy` (a `tools/execute` wrapper); it
   * is NEVER sent to the model — `schemas()` whitelists only name/description/
   * parameters. Declaring it asserts this tool forwards `exec.signal` to a
   * cooperative implementation that can reach quiescence when the signal aborts.
   */
  timeoutMs?: number
  /**
   * Pure synchronous classifier for overlap with sibling tool calls. Only
   * `true` opts in; omission, exceptions, non-`true` returns, and invalid
   * `defineTool` arguments are exclusive. This metadata is never model-visible.
   *
   * Opted-in executions must not mutate parent-owned state. Shared state must
   * tolerate concurrent dispatch; recorder races are permitted only when they
   * commute or fail closed. See the
   * [parallel-tool-call Agent Note](../../../../.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md)
   * for the full contract.
   * @param args - parsed arguments; `defineTool` validates before calling.
   * @returns Whether this call may join a parallel group.
   */
  isConcurrencySafe?(args: unknown): boolean
  /**
   * Optional: how to present the PENDING state of one call in a UI, derived from
   * the call's `args` (parsed arguments, `unknown` — the tool validates/narrows
   * its own input). Returns a {@link ToolCallView} (a `card`-tagged render intent),
   * or `undefined` (or omit the method) to fall back to a generic presentation
   * (title = tool name, raw args as input). Pure and side-effect-free: a UI may
   * call it during live streaming AND a session-log replay, so it must depend
   * only on `args`.
   */
  presentCall?(args: unknown): ToolCallView | undefined
  /**
   * Optional: how to present the COMPLETED state, given the same `args` and the
   * durable result projection (`content`, failure state, and optional `meta`). Returns a
   * {@link ToolResultView}, or `undefined` (or omit the method) to keep the
   * pending title and render the raw result content. Pure and side-effect-free
   * for the same replay reason.
   */
  presentResult?(args: unknown, result: ToolResult): ToolResultView | undefined
}
```

`execute` は `args: unknown` を受け取ります。生の `ToolDefinition` が自身の入力を検証します。ファーストパーティーツールはこれを手書きせず、`defineTool` を使用します。これは引数を検証して絞り込み、`output.schema` から本体の戻り値を推論し、両方の出力プロジェクタに型を付与します。`finalizeContent` が型付き引数ではなく不変の実行を意図的に受け取るのは、無効な入力と外側のパイプライン障害もここに到達するためです。これは、`isError`、正規値、構造化エラー ID、遅延コンテキスト、および表示メタデータを保持しながら、ツール所有のコンテンツ上限を適用できます。

## 統合 JSON 値スキーマ DSL

プラグイン作成者は、型付きパラメーターと型付き出力値に同じ語彙を使用します。`ValueSchemaSpec` は、`string`、`number`、`integer`、`boolean`、`null`、`array`、`object`、作成者専用の `json`、およびいずれか 1 つのみの `oneOf` をサポートします。スカラーの `enum` 値と `const` 値は、それぞれのノード型に一致する必要があります。明示的なオブジェクトノードは常に `additionalProperties: true | false` を宣言します。パラメーター定義は暗黙的なオープンオブジェクトのプロパティマップのままで、`required: true` は各必須プロパティに付加されます。

ソース: [`packages/core/tools/src/schema.ts`](../../packages/core/tools/src/schema.ts)

```ts type-equiv
/** One author-facing schema for any lossless JSON value root. */
type ValueSchemaSpec =
  | StringValueSchemaSpec
  | NumberValueSchemaSpec
  | IntegerValueSchemaSpec
  | BooleanValueSchemaSpec
  | NullValueSchemaSpec
  | ArrayValueSchemaSpec
  | ObjectValueSchemaSpec
  | JsonValueSchemaSpec
  | OneOfValueSchemaSpec
```

```ts type-equiv
/** One implicit parameter-root property, optionally required. */
type ParameterPropertySpec = ValueSchemaSpec & { required?: true }
```

```ts type-equiv
/**
 * Tool parameter schema. The map itself is an implicit open object root;
 * requiredness remains a per-property `required: true` annotation.
 */
type ParameterSchemaSpec = {
  [key: string]: ParameterPropertySpec
  [key: symbol]: never
}
```

`{ type: 'json' }` は `JsonValue` を推論し、アノテーションのみの制約なし raw schema にコンパイルします。出力ルートはオブジェクト、配列、スカラー、または null にできます。`InferValue<S>` はリテラル制約とオブジェクトの開放性を 16 コンテナ階層まで尊重し、その後は TypeScript の型インスタンス化スタックを使い果たす代わりに `JsonValue` にフォールバックします。`InferArgs<P>` はプロパティごとの必須性を、必須および任意の文字列キーに変換します:

```ts type-equiv
/**
 * Infer the TypeScript value accepted by an author-facing value schema. Exact
 * inference is bounded to 16 container levels, then falls back to `JsonValue`.
 */
type InferValue<S> = InferValueAt<S, []>
```

```ts type-equiv
/** Infer the TypeScript argument object for an implicit parameter schema. */
type InferArgs<S> = InferProperties<S, []>
```

`defineTool({ name, description, parameters, output, execute, … })` はパラメーター推論を `parameterSchemaSpecToJsonSchema()` および `validateArgs()` に結び付け、`execute`/`render`/`presentationMeta` を `InferValue<OutputSchema>` に結び付けます。schema レコードには自身の列挙可能な文字列キーのみが含まれ、schema 配列は密な組み込み配列であるため、推論、コンパイル、検証は同じ宣言を参照します。推論は 16 コンテナ階層まで正確さを維持し、その後 `JsonValue` に拡張されます。実行時検証では完全な schema の走査を継続します。`valueSchemaSpecToJsonSchema()` は同じ強制された raw サブセットを通じて出力宣言をコンパイルします。パラメーターの不一致では `ToolArgsError`（`INVALID_ARGS`）がスローされ、不正な本体またはポリシー適用後の値では `ToolOutputError`（`INVALID_TOOL_OUTPUT`）がスローされます。どちらも通常のツールエラー経路を使用します。Raw JSON Schema はデフォルトでオープンです。サポートされないキーワードは、強制されないまま受け入れられるのではなく拒否されます。

登録は、信頼された同一プロセス内の契約です。レジストリは型付き定義を読み取り専用入力として借用し、`output` を要求してその raw schema を検証し、正の有限値である `timeoutMs` などの意味的要件を確認します。`schemas()` はリクエスト構築時にモデル向け投影を生成するため、コールバックをワイヤ上に漏らすことなく、実行と表示で 1 つの解決済み定義を共有します。

## `ToolRestriction` — 1 つのスコープが継承対象に適用するライブフィルター

`ToolRestriction` は、スコープが継承するツール、すなわちデプロイ全体のレイヤーとそのチェーン上のすべての祖先スコープに適用されます。レジストリは読み取り専用の名前をプライベートセットにコンパイルし、複数の制限を交差させた後、スコープ自身の登録をオーバーレイします。自身の登録は除外対象のままであるため、委譲された子は応答先となるツールを維持できます。拒否のみのフィルターでは、後から追加されたリスト外の継承ツールが許可されますが、許可リストでは除外されます。

```ts type-equiv
/**
 * Per-scope filter over global tools. Restrictions intersect and do not affect
 * scoped registrations or the reserved Code Mode transport.
 */
interface ToolRestriction {
  /** Global tool names that stay visible; everything else is removed. */
  readonly allow?: readonly string[]
  /** Global tool names removed from visibility. */
  readonly deny?: readonly string[]
}
```

## 実行: 拡張可能なウォーターフォールと単調なポリシー

`ctx.tools.execute()` は、必須の読み取り専用 `signal` を持つ呼び出し元所有の `ToolExecutionInput` を受け取り、解析済み JSON 引数を一度だけパイプライン所有の `ToolExecution` に実体化し、その呼び出しを `tools/pre-execute`（並べ替え可能な allow/deny/ask ウォーターフォール）→ 登録済みの単調ガード → `tools/execute`（ディスパッチを囲むラッパー）→ `tools/post-execute`（結果を検査・置換）→ 任意の定義所有 `finalizeContent` → `tools/result`（不変で権威ある結果）の順に実行します。必要なシグナルを置き換えられるのは、`tools/execute` ビューだけです。結果は `ToolExecutionResult` です。

```ts type-equiv
/** Opaque call identity that permits correlation without exposing mutable execution state. */
type ToolExecutionToken = symbol & { readonly [toolExecutionTokenBrand]: true }
```

```ts type-equiv
/**
 * Caller-supplied description of one tool call. {@link ToolRuntime.execute}
 * adds the registry-owned token to form a pipeline {@link ToolExecution};
 * callers do not choose that token.
 */
interface ToolExecutionInput {
  readonly callId: CallId
  /**
   * Root model-requested call owning this execution tree. Callers omit it for
   * a root execution; nested dispatchers propagate the enclosing value.
   */
  readonly rootCallId?: CallId
  readonly name: string
  /** Losslessly JSON-serializable parsed arguments (tools validate their own schema). */
  readonly arguments: unknown
  /** The agent on whose behalf the call runs (set by the agent loop). */
  readonly agent?: Agent
  /**
   * Opaque token of the enclosing transport execution, when one exists. Code
   * Mode sets this on SDK sub-dispatches so commit-style observers can wait for
   * the outer `run_code` outcome without receiving its live mutable execution.
   * The token also marks the call as a transport sub-dispatch rather than a
   * model-direct call: under `mode: 'code'`, only calls WITH a parent may
   * execute a native tool name — a model-direct call (no parent) is denied as
   * `UNKNOWN_TOOL` before the policy pipeline. See {@link ToolRuntime.execute}.
   */
  readonly parent?: ToolExecutionToken
  /** Required caller-owned cancellation for this invocation. */
  readonly signal: AbortSignal
}
```

ツール本体は実行時拡張を受け取ります。`deferContext()` は、まだ開いている外側の呼び出し内部に注入することなく、実行自身の結果にコンテキストを付加します。これは複合ツールのネストされたディスパッチチャネルであり、プラグイン由来の命令を生成するリーフツールでも使用できます。

```ts type-equiv
/**
 * Runtime context handed to a tool implementation after the registry has
 * accepted a {@link ToolExecution}. {@link deferContext} attaches context to
 * this execution's own result — a composite tool ferries nested-dispatch
 * context back to the outer result, and a leaf tool may mint a fresh
 * plugin-sourced instruction; the loop appends it only after the
 * `tool/result`.
 */
interface ToolRunContext extends ToolExecution {
  /**
   * Defer one context — typically a nested-dispatch context ferried by a
   * composite tool, or a fresh plugin-sourced instruction — until this tool's
   * final result reaches the agent loop. Contexts retain their individual
   * source and metadata and are emitted in call order.
   */
  deferContext(context: UserMessage): void
  /**
   * Mark a successful final result as terminal for the current agent turn.
   * The marker rides this execution's own result (`concludesTurn` exists only
   * on {@link ToolExecutionSuccess}); a composite that dispatches nested
   * calls forwards it from the nested result, exactly like
   * `additionalContexts`, so only an authoritative nested success can
   * conclude the enclosing run.
   */
  concludeTurn(): void
}
```

エージェントループは、保留中の各呼び出しの実行モードをレジストリに問い合わせ、それを使用して排他的バリアとローリングプールの並列実行を形成します:

```ts type-equiv
/**
 * Scheduling mode for one pending call. `parallel` may overlap with siblings;
 * `exclusive` runs alone and forms an ordering barrier.
 */
type ToolExecutionMode =
  | { kind: 'parallel' }
  | { kind: 'exclusive' }
```

Code Mode のブリッジはさらに、完了した各サブディスパッチを `tools/code-dispatch-log` ウォーターフォールに公開します。このウォーターフォールは、永続イベント内のコンテンツのコピーを変更できます（プログラムの値とモデルに表示される結果は変更されません）:

```ts type-equiv
/**
 * One settled `run_code` sub-dispatch about to be logged, as seen by the
 * `tools/code-dispatch-log` waterfall: the parent execution (session owner,
 * outer call identity), the sub-call identity, and the outcome whose durable
 * copy a listener may reshape. `content` is the RENDERED result projection
 * (what a native `tool/result` would carry) — the program itself received
 * the structured `value` (or just the error message on failure); only the
 * `tool/code-dispatch` event's copy changes.
 */
interface CodeDispatchLog {
  /** The outer `run_code` execution. */
  readonly exec: ToolExecution
  /** The calling agent (the scope routing key and the spill owner), when the outer call has one. */
  readonly agent?: Agent
  /** Deterministic sub-call id (`<parent>:code:<n>`). */
  readonly subCallId: CallId
  /** The dispatched sub-tool name. */
  readonly name: string
  /** Whether the sub-call settled as an error. */
  readonly isError: boolean
  /** The sub-call's complete model-facing content (the settle event's default payload). */
  readonly content: ContentBlock[]
}
```

```ts type-equiv
/**
 * One pending tool call inside the registry pipeline. Parsed arguments cross
 * one lossless-JSON materialization boundary before policy and are deep-frozen;
 * call identity, the caller signal, and the registry-assigned {@link token} are
 * readonly. The registry freezes the complete object before `tools/result`
 * observers run.
 */
interface ToolExecution extends ToolExecutionInput {
  /** Root model-requested call, resolved for every root and nested execution. */
  readonly rootCallId: CallId
  /** Registry-assigned identity shared with nested calls only as their opaque `parent` token. */
  readonly token: ToolExecutionToken
}
```

```ts type-equiv
/**
 * Around-dispatch view of a {@link ToolExecution}. A `tools/execute` wrapper
 * may replace the signal for its delegated lifetime, but it cannot remove it.
 * The registry fuses every replacement with the captured caller signal.
 */
interface ToolDispatchExecution extends Omit<ToolExecution, 'signal'> {
  /** Cancellation signal visible to the next wrapper or tool body. */
  signal: AbortSignal
}
```

`ToolExecutionToken` は、不透明なランタイム `Symbol` であり、識別情報の比較にのみ使用されます。ポリシーの前に、`execute()` は引数を具体化して固定し、JSON 以外の入力を拒否して、トークンを割り当てます。識別情報フィールド、必須の呼び出し元シグナル、および任意の親トークンは読み取り専用のままです。`ToolDispatchExecution` ラッパーはシグナルを置き換えることはできますが、削除することはできません。レジストリは本体を呼び出す前に、呼び出し元シグナルを再結合します。最終オブザーバーは固定された実行識別情報を受け取ります。

`ToolGuard` は、スコープを認識する最終ディスパッチ前ポリシーです。その戻り値型には意図的に許可の結果がありません。`undefined` はウォーターフォールの決定を維持し、返された理由は権限を減らすことしかできないため、後続のリスナーがそれを取り消すことはできません。

```ts type-equiv
/**
 * A monotonic execution guard evaluated after every `tools/pre-execute`
 * listener and before the tool body. Returning a reason denies the call;
 * returning `undefined` leaves it unchanged. Because guards have no allow
 * result, listener ordering cannot turn a denial back into permission.
 * @param execution - the identity-protected call after extensible pre-execute policy completed.
 * @returns a final denial reason, or `undefined` to leave the call allowed.
 */
type ToolGuard = (execution: Readonly<ToolExecution>) => string | undefined
```

```ts type-equiv
/** Canonical failure detail; internal routing information remains optional. */
interface ToolFailure {
  /** Human-readable failure message without the Native `Error: ` envelope. */
  message: string
  /** Internal error class/code used by policy and durable diagnostics. */
  info?: ToolErrorInfo
}
```

```ts type-equiv
/** Successful canonical tool execution, including its Native/model projection. */
interface ToolExecutionSuccess {
  readonly isError: false
  /** Execution-local canonical value; deliberately omitted from durable events. */
  readonly value: JsonValue
  readonly content: ContentBlock[]
  readonly error?: never
  readonly meta?: JsonValue
  readonly additionalContexts?: UserMessage[]
  /** The agent loop stops after committing this successful result batch. */
  readonly concludesTurn?: true
}
```

```ts type-equiv
/** Failed canonical tool execution; failures never carry a successful value. */
interface ToolExecutionFailure {
  readonly isError: true
  readonly error: ToolFailure
  readonly value?: never
  readonly content: ContentBlock[]
  readonly meta?: JsonValue
  readonly additionalContexts?: UserMessage[]
  readonly concludesTurn?: never
}
```

```ts type-equiv
/** The discriminated, execution-local outcome of one tool call. */
type ToolExecutionResult = ToolExecutionSuccess | ToolExecutionFailure
```

結果が保持するのは結果内容だけです。呼び出し識別情報は、すべてのフックを通じて付随する不変の `ToolExecution` と、永続的な `tool/call` / `tool/result` セッションイベントに残るため、ラッパーは食い違う第 2 の識別情報を作成できません。正規の `value` は実行ローカルです。ループが永続化するのは `content`、`error`、および `meta` のみであり、`tool/code-dispatch` はサブ呼び出しのレンダリング済み `content` と `isError` をそのまま保存します。リプレイは表示を再現しますが、正規の中間値を再構築することはできません。

成功時、レジストリは本体値をスナップショットして検証し、固定したうえで、純粋なレンダラーと任意のトップレベル呼び出しメタデータプロジェクターを呼び出します。`tools/result` の直前に、永続的な表示フィールドを個別に具体化します。無効な値、レンダラーまたはプロジェクターの失敗、あるいは JSON 以外の表示は、JSON セーフな `isError` になります。したがって、最終ライブオブザーバーは、後で永続的に追加しても安全なフィールドと並んで、正確な実行ローカル値を確認できます。

最終コンテンツの前に、レジストリは候補結果を具体化します。コンテンツ、構造化エラー、追加コンテキスト、または表示メタデータで失敗した場合は、`finalizeContent` に引き続き到達する JSON セーフな `isError` 結果になります。レジストリはそのコールバックを正確に 1 回呼び出し、その後、受け入れられた結果を `tools/result` の直前に具体化して固定します。これにより、観測されたライブ結果は、後で永続的に `tool/result` へ追加しても安全です。

各インターセプト・ウォーターフォールは、型付きの **Decision**  を返します（`agent/*` ウォーターフォールと共有される慣用表現です）。`tools/pre-execute` リスナーは `(exec, next)` を受け取り、`PreToolDecision` を返します。`tools/execute` ラッパーは `ToolExecutionResult` を返します。`tools/post-execute` リスナーは `(exec, result, next)` を受け取り、`PostToolDecision` を返します。

```ts type-equiv
/**
 * Pre-dispatch decision. `allow` runs the call; `deny` materializes an error;
 * `ask` runs only after an approval service returns `allowed-once` and otherwise
 * denies. Input rewriting is excluded because arguments are already logged and
 * presented.
 */
type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string }
```

```ts type-equiv
/**
 * Post-dispatch decision: accept, replace one projection, attach context for the
 * next request, or block by turning corrective feedback into an error result.
 */
type PostToolDecision =
  | { kind: 'accept'; content?: ContentBlock[]; value?: never; additionalContexts?: UserMessage[] }
  | { kind: 'accept'; value: JsonValue; content?: never; additionalContexts?: UserMessage[] }
  | { kind: 'block'; feedback: ContentBlock[]; additionalContexts?: UserMessage[] }
```

デフォルトの場合は `next()` を呼び出すか、決定を返して短絡します。事前ポリシーは拒否または確認要求を行えます。処理を続行するのは `allowed-once` のみであり、許可されない場合、承認チャネルまたはサービスが存在しない場合、あるいはエージェントなしのリクエストの場合は拒否になります。ガードは引き続き最終的な拒否を課すことができます。履歴、監査、UI、および実行が一致していなければならないため、引数は書き換えられません。

ポリシー後処理では、content または value のいずれか一方のみを置き換えられ、両方を置き換えることはできません。content の置換では正規の value と既存のメタデータを保持します。value の置換は再検証され、content/metadata が再計算されます。block では value が削除され、修正フィードバックを含む `isError` になります。content の置換は表示ポリシーであり、機密性ポリシーではありません。プログラム上の value を隠す必要があるリスナーは、ブロックまたは置換を行います。`tools/result` は、正規化後の固定された実行内容と結果を受け取ります。オブザーバーはそれらを変換できず、オブザーバーの失敗は封じ込められます。未知のツールと例外を送出するツールはいずれも構造化エラーになります（`ToolNotFoundError` は `UNKNOWN_TOOL` にマッピングされます）。そのため、ターンを終了せずに呼び出しが失敗します。

## 強制される raw JSON Schema サブセット

サブエージェント、ワークフロー、MCP、動的登録からの raw スキーマでは、作成者 DSL のワイヤーレベルの対応形式を使用します。`assertSupportedJsonSchema()` は任意の JSON ルートを受け入れ、`validateJsonSchemaValue()` はそれを強制し、`JsonSchemaError` はサポートされない、または不正なスキーマパスをすべて報告します。空のアノテーション専用ノードは、制約のないロスレス JSON を意味します。`oneOf` には少なくとも 2 つの分岐が必要で、値はちょうど 1 つに一致する必要があります。オブジェクトルートを必要とするコンシューマーは `assertObjectJsonSchema()` を呼び出し、`ObjectJsonSchema` を保持します。これにより、共有語彙を制限せずに、サブエージェント／ワークフローの呼び出し元定義の構造化出力をオブジェクトルートのまま維持できます。

```ts type-equiv
/** Scalar JSON values supported by `enum` and `const`. */
type JsonSchemaScalar = string | number | boolean | null
```

```ts type-equiv
/** Single-type keywords accepted by the enforced subset. */
type JsonSchemaType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
```

```ts type-equiv
/**
 * One raw JSON Schema node in the enforced subset. The optional fields express
 * the external wire schema; {@link assertSupportedJsonSchema} rejects invalid
 * combinations before a caller treats the node as trusted.
 */
interface JsonSchemaNode {
  /** Omit with no constraints for any JSON value, or use `oneOf`. */
  type?: JsonSchemaType
  /** Exactly one branch must validate; at least two branches are required. */
  oneOf?: JsonSchemaNode[]
  /** Nested property schemas (`type: 'object'` only). */
  properties?: Record<string, JsonSchemaNode>
  /** Required property names; each must appear in `properties`. */
  required?: string[]
  /** `false` rejects undeclared keys; absent/`true` follows JSON Schema's open default. */
  additionalProperties?: boolean
  /** Item schema (`type: 'array'` only); absent accepts any JSON item. */
  items?: JsonSchemaNode
  /** Allowed values for a scalar node. */
  enum?: JsonSchemaScalar[]
  /** The single allowed value for a scalar node. */
  const?: JsonSchemaScalar
  /** Annotation, ignored for validation. */
  description?: string
  /** Annotation, ignored for validation. */
  title?: string
  /** Annotation, ignored for validation but required to be lossless JSON. */
  default?: JsonValue
  /** Annotation, ignored for validation but required to be lossless JSON. */
  examples?: JsonValue
}
```

```ts type-equiv
/** A consumer-constrained object-rooted schema. */
type ObjectJsonSchema = JsonSchemaNode & { type: 'object' }
```

## ツール表示 UI の語彙

ツール呼び出しを UI（エディタのツール呼び出しカード、CLI のログ行など）でどのように表示したいかを表します。ツールがクライアントプロトコルに依存せず自身を記述できるよう、プロバイダーに依存しません。`presentCall`/`presentResult` は、**`card` タグ付きのレンダリング意図** を返します。これは UI ブリッジが切り替える、識別可能なユニオンです。

- `ToolCallView`（保留中）: `{ card: 'generic', title, kind?, rawInput?, content?, locations? }`（デフォルトのカード。`locations` は、エディタでの追従表示のために呼び出しが読み取り／変更する `{ path, line? }[]` ファイルです）、`{ card: 'terminal', title, description?, cwd? }`（シェルコマンド → ターミナルカード）、または `{ card: 'diff', title, diffs, locations? }`（ファイルの作成／変更 → インライン差分カード。`diffs` は `{ path, oldText, newText }[]` であり、新規ファイルでは `oldText: null` です）。
- `ToolResultView`（完了）: `{ card: 'generic', title?, content? }`、`{ card: 'terminal', title?, output?, exitCode?, signal? }`（取得された実行出力と終了情報。対応 UI は終了ステータスのピルを表示でき、別の UI はフェンス付きの ` ```console ` フォールバックを生成できます）、`{ card: 'diff', title?, diffs }`（完了したファイル変更 → 表示する変更。通常は変更前／変更後の内容から計算したコンテキスト行付きの適用済み hunk であり、変更前のイメージがない場合はファイル全体の差分です）、`{ card: 'search', shape, title?, truncated, total, … }`（完了した探索検索 → `shape: 'matches'`（grep）ではファイルごとにグループ化された一致、`shape: 'paths'`（glob）ではフラットなパスリスト。`truncated`/`total` はインライン結果が上限に達したかどうかを報告するため、UI が部分的な結果を完全なものとして表示することはありません。このビューには結果テキストは含まれません。検索カードに対応しない UI は raw の結果内容にフォールバックします）、`{ card: 'read', title?, path, offset, lines, totalLines, lang?, content? }`（完了したファイル読み取り → 行番号付きで、任意で構文ハイライトされたコードビュー。`offset` はウィンドウが要求した 1 始まりの先頭行であり、`lines` が空でも保持されます。`lang` は拡張子から得た言語ヒントであり、`content` は読み取りに対応しない UI がフォールバックするエンベロープ除去済みテキストです）、または `{ card: 'web', kind: 'search' | 'fetch', title?, … }`（完了した Web 取得。`kind: 'search'` は構造化された `sources`/`answer?`/`truncated` を保持し、`kind: 'fetch'` は `url`/`statusCode`/`truncated` を保持します。`web` 機能に対応しない UI は raw の結果内容にフォールバックします。本文はビュー内に重複しません）。完了ビューは保留中ビューを置き換えるため、変更ツールは呼び出し時のスニペットと重複する場合でも差分結果を返します。検索と Web 取得には `card` の呼び出し時の対応物がありません（構造化結果は `execute` 後にのみ存在するため、保留状態は汎用カードのままです）。

`ToolCallKind`（`'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'fetch' | 'other'`）は汎用カードのアイコンを選択します。`FileLocation`（`{ path, line? }`）、`FileDiff`（`{ path, oldText, newText }`）、および `ReadFileLine`（`{ number, text }`、読み取りウィンドウの 1 始まりの番号付き 1 行）は、共有のファイルカード語彙です。設計は [render-intent-union Agent Note](../../.agents/notes/implemented/architecture/2026-07-02-tool-render-intent-union.md) に固定されています。ホスト／クライアントランタイムは、この中立的な語彙をそれぞれのビューに投影します。

表示フィールドの完全なドキュメントは [`packages/core/tools/src/presentation.ts`](../../packages/core/tools/src/presentation.ts) にあります。`bash` のスキーマと実行器は [shell.md](shell.md) に、汎用バックグラウンド制御は [jobs.md](jobs.md) にあります。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts` によりソースから生成されます（doc-sync で `pnpm run verify-cordis-catalog` により最新であることを検証します。`pnpm run gen-cordis-catalog` で再生成できます）。このセクションは、ページの両言語側でバイト単位で同一です。シグネチャブロックでは `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは [入門](../cordis-primer.md#dispatch-modes) で定義されており、フレームワークから継承される `ctx` API は [cordis-api/inherited.md](../cordis-api/inherited.md) にあります。

<a id="ctxtools--toolruntime"></a>

### `ctx.tools` — `ToolRuntime`

ツールレジストリと実行パイプライン。スコープ付き登録はグローバル登録をシャドーイングします。1 つの可視性リゾルバーが表示、検索、ディスパッチに情報を供給します。

```ts cordis-catalog
/**
 * Present the calling scope's tools in `mode` instead of the deployment
 * default. Nearest scope on the chain wins, so a preset's standing
 * declaration covers every agent joined under it.
 *
 * Scoped only, and one declaration per scope: this is how an agent preset
 * composes Code Mode agents beside native ones in the same process, and a
 * process-global override would be the `mode` config field instead.
 * @param mode - the presentation the covered agents' models see.
 * @returns the exact disposer that restores the deployment default.
 */
presentAs(mode: ToolPresentationMode): () => void

/**
 * Register globally or in the calling agent scope. Scoped tools shadow
 * globals; duplicates within one layer and the reserved `run_code` name fail.
 * @param definition - tool schema, execution, and optional finalization/presentation callbacks.
 * @returns the exact disposer that unregisters the tool.
 */
register(definition: ToolDefinition): () => void

/**
 * Restrict global tools for the calling agent scope. Empty filters, unknown
 * names, scope-local names, and reserved transport names fail. Restrictions
 * intersect; scoped registrations remain visible.
 * @param filter - global-tool mask: `allow` (keep only) and/or `deny` (remove).
 * @returns the exact disposer that lifts this restriction.
 */
restrict(filter: ToolRestriction): () => void

/**
 * Register a monotonic guard after the extensible `tools/pre-execute`
 * waterfall. A plain-context guard applies globally; one registered through
 * `agent.ctx` applies only to that agent. Any matching guard may deny by
 * returning a reason, while no guard can force-allow a call another guard
 * denied. The exact effect disposer is returned for ordered ownership and
 * HMR cleanup.
 * @param guard - synchronous check; a returned string denies the execution.
 * @returns the exact disposer that unregisters the guard.
 */
guard(guard: ToolGuard): () => void

/**
 * Look up a tool as one scope sees it (scoped
 * shadows global; a restricted-away global reads as absent). Presenters pass
 * the calling agent so the rendered card matches the definition that
 * actually executed.
 * @param name - the tool name as registered.
 * @param scope - the viewing scope (the agent); omitted = the global view.
 * @returns the definition the scope resolves, or undefined when none is visible.
 */
get(name: string, scope?: ScopeKey): ToolDefinition | undefined

/**
 * Project visible definitions onto the allowlisted model-facing schema fields,
 * excluding execution and presentation callbacks.
 * @param scope - the viewing scope (the agent); omitted = the global view.
 * @returns one deep-cloned schema per visible tool.
 */
schemas(scope?: ScopeKey): ToolSchema[]

/**
 * Classify a pending call through the caller's visible tool definition. Only
 * an exact `true` is parallel; unknown, hidden, undeclared, invalid, or
 * throwing classifiers are exclusive.
 * @param exec - call name, parsed arguments, and optional agent scope.
 * @returns the fail-closed scheduling mode.
 */
executionMode(exec: ToolExecutionInput): ToolExecutionMode

/**
 * Execute through pre-policy, guards, around-dispatch, post-policy,
 * definition-owned content finalization, and final notification. Tool and
 * listener failures resolve as materialized error results; an invisible tool
 * reports `UNKNOWN_TOOL`. The returned outcome is the same lossless, frozen
 * snapshot final observers receive. Cancellation
 * arriving after entry and before final result materialization skips a
 * not-yet-started body with `ABORTED_BEFORE_DISPATCH` or replaces a
 * successful started outcome with `ABORTED`; already-started work is still
 * drained and may retain a tool-owned structured error.
 * @param exec - the typed same-process call input. The registry assigns its
 *   correlation token before policy begins.
 * @returns the materialized final result.
 */
async execute(exec: ToolExecutionInput): Promise<ToolExecutionResult>
```

型: [ScopeKey](scope.md)

ソース: [`packages/core/tools/src/index.ts:787`](../../packages/core/tools/src/index.ts)

<a id="tools-events"></a>

### `tools/*` イベント

<a id="toolschange--emit"></a>

#### `tools/change` — 発行

ツールが登録または登録解除されたとき、あるいはスコープ付き制限が変更されたとき（利用可能なツールセットが変更されたとき。1 つのスコープだけに対する変更である可能性もあります）に発生します。意図的にスコープフィルタリングを行わない、レジストリ対象の通知です。グローバルな変更はすべてのエージェントの次回の組み立てに関係するため、ここを購読するスコープ付きリスナーは、自身のスコープの変更だけでなく、すべての変更を受け取ります。

```ts cordis-catalog
/**
 * A tool was registered or unregistered, or a scoped restriction changed
 * (the available tool set changed — possibly for one scope only). An
 * UNFILTERED registry-subject notification, deliberately not scope-filtered
 * dispatch: a global change concerns every agent's next assembly, so a
 * scoped listener subscribing here sees every change, not just its own
 * scope's.
 * @mode emit
 */
'tools/change'(): void
```

ソース: [`packages/core/tools/src/index.ts:207`](../../packages/core/tools/src/index.ts)

<a id="toolscode-dispatch-log--waterfall"></a>

#### `tools/code-dispatch-log` — ウォーターフォール

ブリッジが `tool/code-dispatch` イベントを追加する前に、リスナーが 1 つの `run_code` サブディスパッチ結果の永続ログコピー内のコンテンツを置き換えられるようにします。`next()` はコンテンツを変更せずに保持します。リスナーは置換ブロックを返せます（たとえば、サイズ超過のテキスト結果に対するスピルポリシーのプレビューとロケータ）。影響を受けるのはログに記録されるコピーのみです。プログラムはすでに完全な値を受け取っており、モデルはいずれも確認しません。リスナーが例外を送出しても封じ込められ、ブリッジは元の確定済みコンテンツのログ記録にフォールバックします。スコープフィルタリングされたディスパッチ（`@deepseek-ai/dsh-scope`）では、エージェントスコープのリスナーはそのエージェントのディスパッチのみを受け取ります。

```ts cordis-catalog
/**
 * Allow a listener to replace content in the DURABLE LOG COPY of one
 * `run_code` sub-dispatch outcome before the bridge appends its
 * `tool/code-dispatch` event. `next()` keeps the
 * content unchanged; a listener may return replacement blocks (e.g. the
 * spill policy's preview + locator for an oversized text result). Only the
 * logged copy is affected — the program already received the complete
 * value, and the model sees neither. A throwing listener is contained:
 * the bridge falls back to logging the original settled content.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's dispatches.
 * @param dispatch - the parent execution, sub-call identity, and the settled content to log.
 * @mode waterfall
 */
'tools/code-dispatch-log'(this: Scoped<ToolRuntime>, dispatch: CodeDispatchLog, next: () => Promise<ContentBlock[]>): Promise<ContentBlock[]>
```

型: [ContentBlock](llm-streaming.md) · [Scoped](scope.md)

ソース: [`packages/core/tools/src/index.ts:189`](../../packages/core/tools/src/index.ts)

<a id="toolsexecute--waterfall"></a>

#### `tools/execute` — ウォーターフォール

タイムアウト、再試行、またはメトリクスのためのディスパッチ前後のウォーターフォールです。`next()` は正規化された結果を返します。ラッパーが変更できるのは `exec.signal` のみで、呼び出しIDは不変のままです。レジストリは本体の前に元の呼び出し元シグナルを再結合するため、置換によって呼び出し元のキャンセルを切り離すことはできません。ラッパーは引き続きシグナルを復元し、静止状態に到達する必要があります。スコープフィルタリングされたディスパッチ（`@deepseek-ai/dsh-scope`）では、エージェントスコープのリスナーはそのエージェントの呼び出しのみを受け取ります。

```ts cordis-catalog
/**
 * Around-dispatch waterfall for timeout, retry, or metrics. `next()` returns
 * a normalized result; wrappers may change only `exec.signal`, while call
 * identity remains immutable. The registry re-fuses the original caller
 * signal before the body, so replacement cannot detach caller cancellation;
 * wrappers must still restore their signal and reach quiescence.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.
 * @param exec - the allowed call about to dispatch (name, parsed arguments, caller agent, signal).
 * @mode waterfall
 */
'tools/execute'(this: Scoped<ToolRuntime>, exec: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult>
```

型: [Scoped](scope.md)

ソース: [`packages/core/tools/src/index.ts:163`](../../packages/core/tools/src/index.ts)

<a id="toolspost-execute--waterfall"></a>

#### `tools/post-execute` — ウォーターフォール

正規化されたディスパッチ結果を受け入れ、置き換え、拡充、またはブロックします。`next()` は変更せずに受け入れます。ツールがスローした場合も、エラーとしてこのウォーターフォールに到達します。非同期リスナーは `exec.signal` を監視する必要があります。リスナーの完了後、呼び出し元によるキャンセルは、ツール本体が呼び出されたかどうかに応じて選択されたコードで、正常に受け入れられた結果のみを置き換えます。スコープでフィルタリングされたディスパッチ（`@deepseek-ai/dsh-scope`）では、エージェントスコープのリスナーはそのエージェントの呼び出しのみを受け取ります。

```ts cordis-catalog
/**
 * Accept, replace, enrich, or block a normalized dispatch result. `next()`
 * accepts it unchanged; thrown tools still reach this waterfall as errors. Async
 * listeners must observe `exec.signal`; after they settle, caller
 * cancellation replaces only a successful accepted outcome with the code
 * selected by whether the tool body was invoked.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.
 * @param exec - the call that just ran (name, parsed arguments, caller agent).
 * @param result - the dispatch outcome a listener may accept, replace, or block.
 * @mode waterfall
 */
'tools/post-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, result: Readonly<ToolExecutionResult>, next: () => Promise<PostToolDecision>): Promise<PostToolDecision>
```

型: [Scoped](scope.md)

ソース: [`packages/core/tools/src/index.ts:175`](../../packages/core/tools/src/index.ts)

<a id="toolspre-execute--waterfall"></a>

#### `tools/pre-execute` — ウォーターフォール

ディスパッチ前に許可、拒否、または確認を求めます。`next()` は許可に委譲します。承認サポートがない場合、`ask` は拒否になります。非同期ゲートは `exec.signal` を監視する必要があります。レジストリはゲートの完了後にキャンセルを再確認しますが、その Promise を破棄することはありません。スコープでフィルタリングされたディスパッチ（`@deepseek-ai/dsh-scope`）では、エージェントスコープのリスナーはそのエージェントの呼び出しのみを受け取ります。

```ts cordis-catalog
/**
 * Allow, deny, or ask before dispatch. `next()` delegates to allow; missing
 * approval support turns `ask` into denial. Async gates must observe
 * `exec.signal`; the registry rechecks cancellation after they settle but
 * never abandons their promise.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.
 * @param exec - the pending call (name, parsed arguments, caller agent).
 * @mode waterfall
 */
'tools/pre-execute'(this: Scoped<ToolRuntime>, exec: ToolExecution, next: () => Promise<PreToolDecision>): Promise<PreToolDecision>
```

型: [Scoped](scope.md)

ソース: [`packages/core/tools/src/index.ts:152`](../../packages/core/tools/src/index.ts)

<a id="toolsresult--emit"></a>

#### `tools/result` — 発行

固定された、ロスレス JSON の最終結果を監視します。リスナーの失敗は隔離されます。スコープでフィルタリングされたディスパッチ（`@deepseek-ai/dsh-scope`）は、`exec.agent` をキーとして使用します。

```ts cordis-catalog
/**
 * Observe the frozen, lossless-JSON final outcome. Listener failures are contained.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): keyed by `exec.agent`.
 * @param exec - the execution object that traversed the pipeline.
 * @param result - a deep-frozen snapshot of the final returned result.
 * @mode emit
 */
'tools/result'(this: Scoped<ToolRuntime>, exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined
```

型: [Scoped](scope.md)

ソース: [`packages/core/tools/src/index.ts:197`](../../packages/core/tools/src/index.ts)
<!-- END GENERATED cordis-surface -->
