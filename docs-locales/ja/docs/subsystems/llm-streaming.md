# LLM ストリーミング

[`packages/llm`](../../packages/llm/README.md)の会話およびストリーミング型です。すべてのリクエストと永続的な履歴で共有される`Message`/`ContentBlock`バリアント、完全に組み立てられたモデルリクエスト、生の`StreamChunk`プロトコル、各アダプターが実装する必要があるアダプター契約、共有アセンブラーを扱います。[コアパッケージ](core.md)は、各ターンでこれらの値を保持・記録します。このページではそれらを宣言します。

ソース: [`packages/llm/llm/src/types.ts`](../../packages/llm/llm/src/types.ts)

<a id="content-blocks-and-messages"></a>

## コンテンツブロックとメッセージ

会話は`Message`の集合であり、メッセージは型付き**コンテンツブロック**の配列です。ブロックの共用体は`ContentBlockMap`から導出されます。

ソース: [`packages/llm/llm/src/types.ts`](../../packages/llm/llm/src/types.ts)

```ts type-equiv
/**
 * Merge-extensible content blocks keyed by `type`. New core blocks must land
 * with adapter, UI, and compaction support.
 */
interface ContentBlockMap {
  'text': TextBlock
  'reasoning': ReasoningBlock
  'image': ImageBlock
  'tool-call': ToolCallBlock
  'tool-result': ToolResultBlock
}
```

ブロックインターフェース（完全なフィールドはソースを参照）: `TextBlock`（`text`）、`ReasoningBlock`（表示テキストとは区別される思考）、`ImageBlock`（永続的な[画像添付](attachment.md)）、`ToolCallBlock`（`id: CallId`、`name`、生の JSON `arguments`）、および`ToolResultBlock`（`toolCallId`、ネストした`content: ContentBlock[]`、`isError?`）です。`ContentBlock = ContentBlockMap[ContentBlockType]`。新しいモダリティは、そのアダプター、UI、コンパクション、永続的な再生パスが対応している場合にのみ、マージ拡張可能なマップに追加できます。

ソース: [`packages/llm/llm/src/message.ts`](../../packages/llm/llm/src/message.ts)

`Message`は、識別子を持つ不変のrole/source/content値です。モデルが生成したアシスタントメッセージは、それを生成したプロバイダーとモデルを指定し、そのソースにオプションのアダプター固有の再生データを保持します。

```ts type-equiv
/** Provider/model identity and adapter-private replay data for an assistant message. */
interface AssistantProvenance {
  /** Provider route that produced the message. */
  provider: string
  /** Provider model id that produced the message. */
  model: string
  /**
   * Lossless-JSON adapter state needed to replay the provider response.
   * `LlmRuntime` exposes it to a target adapter only when that adapter instance
   * currently owns both this historical provider and the target provider.
   */
  replayState?: unknown
}
```

```ts type-equiv
/** One immutable message representation shared by delivery, durable history, and model requests. */
interface Message {
  /** Stable identity preserved across every representation boundary. */
  readonly id: MessageId
  /** Provider-neutral conversation role. */
  readonly role: 'system' | 'user' | 'assistant'
  /** Exact model-facing blocks. */
  readonly content: ContentBlock[]
  /** Required source fields supplied by the producer. */
  readonly source: MessageSource
}
```

メッセージの生成元自体も、マージ拡張可能な直和型です。

```ts type-equiv
/**
 * Where a message (or injected content) came from.
 * Merge-extensible sum type — plugins add their own `kind`s.
 */
interface MessageSourceMap {
  user: { kind: 'user' }
  plugin: { kind: 'plugin'; plugin: string } & ContextFormed
  model: ModelMessageSource
  tool: ToolMessageSource
}
```

生成者の識別子と表示形式は独立しています。`kind`は*これを生成したのは誰か*に答えます。オプションの`form`は*これはどの種類の情報か*に答え、コンシューマーが表示方法を決定します。複数の生成者が同じ形式を共有でき、1 つの生成者がセッション中に複数の形式を出力することもあります。値は意味論的であり、1 つずつ増えていきます。値がない、または認識されない場合は、文書化されたデフォルトが使用され、不透明なコンテンツとして表示されます。

```ts type-equiv
/**
 * The kind of information in producer-supplied context, declared by the
 * producer beside its provenance.
 *
 * `MessageSource.kind` answers *who produced this*; `form` answers *what kind
 * of thing it is*, and the two axes are deliberately independent — several
 * producers share one form, and one producer may emit more than one form over
 * a session.
 *
 * The vocabulary is SEMANTIC, never visual: a value states that the content is
 * a file's instructions or a catalog of available items, and a consumer decides
 * what that looks like. Colors, icons, ordering, and collapse defaults are the
 * consumer's business and must not enter this union. It grows one value at a
 * time as producers gain the structured fields their form needs; an absent or
 * unknown value is the documented default, presented as opaque content.
 */
type ContextForm =
  /** Instructions read out of workspace files the model is expected to follow. */
  | 'instructions'
  /** A catalog of items available in this session, republished as it changes. */
  | 'catalog'
  /** Current state, where a later snapshot from the same producer supersedes an earlier one. */
  | 'snapshot'
  /** A one-off account of something that just happened; it supersedes nothing. */
  | 'notice'
  /** A message another agent addressed to this one. */
  | 'relay'
  /** Material lifted out of another session's log, possibly reduced on the way in. */
  | 'recall'
```

```ts type-equiv
/** One named contribution to a `snapshot`-form context, in assembly order. */
interface ContextSnapshotSection {
  /** The contributing subsystem's name. */
  readonly name: string
  /** That contribution's model-facing text, exactly as assembled. */
  readonly text: string
}
```

```ts type-equiv
/**
 * Producer-declared {@link ContextForm} and the fields that form requires,
 * mixed into the source types that carry one.
 *
 * Discriminated by `form` so a producer cannot select a form without the
 * fields needed to present it: a `notice` must record its one-line
 * account, a `snapshot` its sections. Omitting `form` stays valid — an
 * undeclared context is the documented default.
 */
type ContextFormed =
  | { readonly form?: never }
  | { readonly form: 'instructions' }
  | { readonly form: 'catalog' }
  | {
    readonly form: 'snapshot'
    /** The named contributions this snapshot assembled, in order. */
    readonly sections: readonly ContextSnapshotSection[]
  }
  | {
    readonly form: 'notice'
    /** One-line account of what happened, shown without expanding the row. */
    readonly summary: string
  }
  | { readonly form: 'relay' }
  | { readonly form: 'recall' }
```

<a id="streamchunk--the-raw-protocol"></a>

## `StreamChunk` — 生のプロトコル

ストリーミング応答には、複数の型付きブロック（テキスト、推論、複数のツール呼び出し）が交互に含まれます。`index`は各デルタをそのブロックに関連付け、`block-end`は完全に組み立てられた`ContentBlock`を保持するため、コンシューマーが自分でデルタを再組み立てする必要はありません。これは**閉じた** 判別共用体です。`type`に対する`switch`は`assertNever`で終わるため、バリアントを追加すると、それを処理する必要があるすべてのコンシューマーでコンパイルが失敗します。

```ts type-equiv
/**
 * Raw streaming protocol emitted by adapters.
 * Block indexes correlate interleaved deltas, and `block-end` carries the
 * assembled block. Adapters emit usage before the terminal finish and nothing
 * afterward; tool arguments remain raw JSON strings. An adapter implementation
 * may throw, but `LlmRuntime.stream()` normalizes that failure to a terminal
 * `error` or `aborted` finish before exposing it to consumers.
 */
type StreamChunk =
  | { type: 'block-start'; index: number; blockType: ContentBlockType }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: CallId; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: TokenUsage }
  | {
    type: 'finish'
    reason: FinishReason
    /** Adapter-private lossless-JSON state for replaying a successful response. */
    replayState?: unknown
  }
```

## `LlmFailure`

スローされた失敗または帯域内の最終アダプター失敗はすべて、シリアライズ可能なプロバイダー非依存のペイロード 1 つに正規化されます。`providerRetryAfterMs` はプロバイダーが要求する、検証済みの正の遅延であり、リトライ判断ではありません。`ProviderRequestId` は診断用の不透明なブランド文字列です。

```ts type-equiv
/** Serializable provider or transport failure facts; policy decides whether they are retryable. */
interface LlmFailure {
  /** Human-readable provider or transport failure. */
  readonly message: string
  /** Stable provider-neutral machine-routing code. */
  readonly code: string
  /** HTTP status returned by the provider, when available. */
  readonly status?: number
  /** Provider-requested delay in milliseconds, when valid and available. */
  readonly providerRetryAfterMs?: number
  /** Opaque provider-issued request identifier for diagnostics. */
  readonly requestId?: ProviderRequestId
}
```

## アダプターの契約

すべてのアダプターは以下に従う必要があり、すべてのコンシューマーはこれらに依存できます。

- **`usage` は `finish` より前、`finish` より後には何もありません。** 末尾の使用量のみを含むチャンクが順序を破らないよう、両方をプロバイダーのストリーム終端マーカーまで遅延させます。
- **ツール呼び出しの `arguments` は、エンドツーエンドで生の JSON 文字列のままにします。** 部分フラグメントは `argumentsDelta` を通じてストリームされます。パース済みオブジェクトを返すプロバイダーは、`block-end` で再度文字列化します。
- **認可されたエラーパスは 2 つ、`LlmFailure` 型は 1 つです。** 失敗は、`stream()` から THROW する（トランスポート／プロトコルエラー）か、**または** `finish {kind:'error'|'aborted', failure}` でストリームを終了できます（ストリーム途中でスローできないアダプター向けの、プロバイダー帯域内エラー）。`LlmError.failure` は同じ `LlmFailure` を保持します。呼び出しがアダプターを選択した後、ストリームはスローされた正確な `Error` オブジェクトを保持し、不変の事実と提供中の登録にある不変のリトライポリシーをその呼び出しに関連付けます。エージェントループは失敗したステップを閉じ、エラー、事実、不変の過去のリトライ済み事実、提供ポリシー、ターンシグナルを `agent/request-error` に渡します。処理リスナーは、待機した修復の後に `{ kind: 'retry' }` を返します。回復がなければ、構造化された失敗がターンエラーとなり、その試行では通常のアシスタントメッセージもツール副作用もコミットされません。
- **アダプター呼び出し 1 回はプロバイダー試行 1 回です。** アダプターではライブラリのリトライを無効にします。エージェントレベルの回復は、別の永続的な番号付きターンを開始します。直接の `ctx.llm.stream()` 呼び出し元は単一試行のままです。
- **プロバイダーの停止はトランスポートで制限されます。** 出荷される両方のリモートアダプターは、デフォルト 5 分の正かつ有限の `streamIdleTimeoutMs` を公開します。ウォッチドッグはイテレーターの `next()` が保留中の間だけ作動し、リクエスト全体で 1 つの安定したシグナルを使用し、自身の期限切れを `TIMEOUT` にマッピングし、より早い呼び出し元の中止は `ABORTED` として維持します。
- **コンテキストオーバーフローには正規のコードが 1 つあります。** 両方の DeepSeek アダプターは、明示的なプロバイダー詳細を `isContextWindowExceededError()` で分類し、失敗がスローされた HTTP `LlmError` として到着した場合も帯域内終了エラーとして到着した場合も、`CONTEXT_WINDOW_EXCEEDED` を公開します。コンシューマーはプロバイダーテキストではなくコードでルーティングします。
- **空の完了は、無言の成功ではなくリトライ可能なエラーです。** 両方のアダプターは、コンテンツブロックを含まない終端の `stop` 終了を、正規の `EMPTY_RESPONSE` コードを持つ `finish {kind:'error'}` にマッピングし、`dsh-llm-retry` はデフォルトでそれをリトライします。[空のモデル応答はリトライ可能です](../../.agents/notes/implemented/bug-fix/2026-07-24-empty-model-response-is-retryable.md)を参照してください。
- **すべてのプロバイダー HTTP リクエストにはアプリ帰属ヘッダーが含まれます。** アダプターは `attributionHeaders()`（以下）、つまり `User-Agent` のベースラインを送信し、ワイヤーレベルのテストで証明します。
- **リプレイ状態はアダプターが所有します。** 成功した `finish` は、ネイティブなプロバイダー応答を再構築するために必要なロスレス JSON 状態を保持できます。ループはそれを組み立てられたアシスタントメッセージとともに保存します。後続のリクエストでは、`LlmRuntime` は履歴プロバイダーと対象プロバイダーが現在まったく同じアダプターインスタンスに登録されている場合にのみ状態を渡します。そのアダプターが状態を検証し、モデル間またはプロバイダー間の変換を所有します。その他のアダプターは、プライベート状態なしでプロバイダー非依存のコンテンツとプロバイダー／モデルフィールドを受け取ります。

## `ResolvedRetryPolicy`

プロバイダー設定は、ルート登録前に不変の判別共用体へ解決されます。通常モードは `mode: 'normal'`、有限の `maxRetries`、`retryableCodes`、および必須の `initialDelayMs`、`maxDelayMs`、`jitterRatio` を保持します。always モードは `mode: 'always'` と、有限の最大値を除く同じ必須バックオフフィールドを保持します。`LlmRuntime.providerRetryPolicy(provider)` は現在登録されている値を返し、アダプターが値を省略した場合は通常のデフォルトを提供します。`llmRetryPolicyOf(stream)` は、呼び出しがその登録を選択した後に提供中の登録からキャプチャされた値を返すため、後からのルート破棄または置換によって進行中の失敗の回復ポリシーは変更されません。[生成された設定カタログ](../config-catalog.md)には、任意の入力フィールドが一覧表示されています。

## `AppIdentity` — アプリ帰属

すべてのアダプターがプロバイダーに送信する静的な公開アプリケーションIDです（[`packages/llm/llm/src/attribution.ts`](../../packages/llm/llm/src/attribution.ts)）。`attributionHeaders(identity?)` はこれを標準の `User-Agent` ヘッダーにのみマッピングします。この契約では、OpenRouter 固有のアプリ帰属ヘッダーは意図的にサポートされません。デフォルトの `APP_IDENTITY` はパッケージマニフェストからそのバージョンを取得します。すべてのフィールドは公開製品情報です。秘密情報、パス、セッション ID、ユーザーごとの識別子は含まれず、リクエストごとの要素が値に影響することもありません。根拠: [必須の `User-Agent` 帰属](../../.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md)。

```ts type-equiv
/**
 * Static public application identity sent to LLM providers.
 *
 * Every field is a public product fact, safe on every request: no secrets,
 * local paths, session ids, prompt text, or per-user identifiers belong here,
 * and nothing per-request may influence the values.
 */
interface AppIdentity {
  /** `User-Agent` product token (lowercase, hyphenated). */
  product: string
  /** Product version; sourced from package metadata, never hand-copied. */
  version: string
  /** Repository home URL of the app, used as the `User-Agent` comment. */
  url: string
}
```

## `TokenUsage`

呼び出しごとのトークン使用量集計です。カウントは **互いに重複しません**。`inputTokens` はキャッシュされていない入力のみです。キャッシュ入力は別途報告され、課金対象入力はこの 3 つの合計です。キャッシュヒットを単一のプロンプト合計にまとめるプロバイダーを持つアダプター（DeepSeek の `prompt_tokens`）は、それらを差し引きます。存在する場合、`reasoningTokens` はすでに `outputTokens` に含まれている参考情報であり、合計で再度加算してはいけません。

```ts type-equiv
/**
 * Token accounting for one model call (cache fields are optional).
 *
 * Counts are DISJOINT: `inputTokens` is uncached input only; cached input is
 * reported separately as `cacheReadTokens`/`cacheWriteTokens` (billed input =
 * sum of the three). Adapters whose providers fold cache hits into a total
 * prompt count (DeepSeek's `prompt_tokens`) subtract them out.
 */
interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}
```

## `BlockAssembler`

`BlockAssembler`（[`packages/llm/llm/src/assembler.ts`](../../packages/llm/llm/src/assembler.ts)）は、`StreamChunk` ストリームを `ContentBlock`、使用量、終了理由、リプレイ状態へ戻して畳み込む唯一の共有実装です。ループは同じチャンクをアセンブラーに渡しながら生のチャンクをログに記録し、その後、組み立てたアシスタントコンテンツを生成元のプロバイダーとモデルとともに保存します。畳み込みを再実装せずに組み立て済み結果が必要なコンシューマーは、これを使用します。

```ts public-api
/**
 * Incrementally assembles raw {@link StreamChunk}s into complete
 * {@link ContentBlock}s and a final assistant {@link Message}.
 *
 * The agent loop feeds it while logging raw chunks for replay fidelity, then
 * reads `blocks()` / `message()` / `usage` / `finish` once the stream ends.
 *
 * Tolerant of delta-only protocols (no block-start/end); deltas arriving for
 * an index already closed by `block-end` are ignored (malformed stream) so a
 * misbehaving adapter cannot grow memory or corrupt a completed block.
 */
declare class BlockAssembler {
  /**
   * Feed one chunk into the assembly state.
   * @param chunk - the next raw chunk, in stream order.
   */
  push(chunk: StreamChunk): void;
  /**
   * Assemble all blocks seen so far, in stream order.
   * @returns one block per seen index, except that max-token truncation drops
   *   tool calls that cannot be executed safely; an open block assembles from
   *   its accumulated deltas (an unknown block type never closed by `block-end` throws).
   */
  blocks(): ContentBlock[];
  /** Usage from the `usage` chunk; undefined until one arrives. */
  get usage(): TokenUsage | undefined;
  /** Finish reason from the `finish` chunk; `{kind: 'stop'}` when the stream ended without one. */
  get finish(): FinishReason;
  /** Adapter-private replay state from the terminal finish chunk, if any. */
  get replayState(): unknown;
  /**
   * The assembled assistant message.
   * @param source - producer attribution for the assembled message.
   * @returns a frozen assistant-role message over `blocks()` (same open-block assembly rules).
   */
  message(source: MessageSource = { kind: 'plugin', plugin: 'dsh-llm/assembler' }): Message;
}
```

<a id="the-model-request-and-result"></a>

## モデルリクエスト

1 回のモデル呼び出しは、完全に組み立てられた `GenerateOptions` です。アダプターは生の [`StreamChunk`](#streamchunk--the-raw-protocol) ストリームで応答し、コンシューマーは [`BlockAssembler`](#blockassembler) を使用してそれを組み立てます。

出典: [`packages/llm/llm/src/types.ts`](../../packages/llm/llm/src/types.ts)

プロバイダーとモデルの検出には、小さなプロバイダー非依存の記述子を使用します。モデルカタログは参考情報です。ルーティングは引き続き登録済みのプロバイダーをキーにし、アダプターは一覧にないモデル ID を受け入れる場合があります。

アダプターを登録すると、ハンドルが返されます。これは disposer と、ルートセットをユーザーが設定できるプラグインに必要なアトミックなルート置換で構成されます。

```ts type-equiv
/**
 * What {@link LlmRuntime.registerAdapter} returns: the disposer, plus an
 * atomic route replacement for the same adapter instance.
 */
interface AdapterRegistrationHandle {
  /** Release every route this registration currently holds. */
  (): void
  /**
   * Replace this registration's routes with `providers`, keeping the same
   * adapter instance. The candidate set is validated in full first — a
   * conflict with another adapter, an invalid name, or bad provider metadata
   * throws and leaves the current routes untouched — and the swap itself is
   * one synchronous section, so no request can observe a gap. An empty array
   * is legal here (a settings section that emptied holds zero routes while
   * staying registered), unlike an empty initial registration.
   *
   * Throws `LlmError` with code `REGISTRATION_DISPOSED` once the registration
   * has been released: its routes are gone and its disposer has already run,
   * so anything registered afterwards would have no owner left to release it.
   * @param providers - the complete next route set for this registration.
   */
  replace(providers: string[]): void
}
```

```ts type-equiv
/** Display metadata for one registered provider route. */
interface LlmProviderInfo {
  /** Provider route key used by {@link GenerateOptions.provider}. */
  id: string
  /** Human-readable provider name for selectors and diagnostics. */
  name: string
}
```

アダプタープラグインではさらに、各ルートのユーザー設定セクションを指定して、どのルートが *実行される可能性がある*  `registerConfigurableProviders()` を経由するかを宣言します。これにより、設定画面ではルートが登録される前に休止中のプロバイダーを提示できます。

```ts type-equiv
/**
 * One provider route an adapter plugin can activate through configuration,
 * whether or not the route is currently registered. Configuration surfaces
 * merge this directory with `listProviders()` to offer every configurable
 * provider alongside its live/dormant state.
 */
interface LlmConfigurableProvider {
  /** Provider route key this entry activates when configured. */
  provider: string
  /** Human-readable provider name for configuration surfaces. */
  displayName: string
  /** User-settings namespace whose section configures this provider. */
  settingsNs: string
  /**
   * Path from that namespace's section root to this provider's profile
   * object; empty when the whole section is the profile.
   */
  settingsPath: readonly string[]
  /**
   * Whether the owning adapter knows this route only because configuration
   * declared it — a gateway or self-hosted server it ships nothing about.
   * Absent means the adapter draws no such distinction; false means it does
   * and this route is one of its own. Only the adapter can answer: a stored
   * profile is how a user-added route AND a corrected shipped one both look
   * from outside.
   */
  declared?: boolean
}
```

```ts type-equiv
/** One adapter-discovered model; catalog membership is advisory, not request validation. */
interface LlmModelInfo {
  /** Provider route that owns this model entry. */
  provider: string
  /** Model id passed to {@link GenerateOptions.model}. */
  id: string
  /** Human-readable model name for selectors. */
  name: string
  /** Optional user-facing distinction from otherwise similar models. */
  description?: string
  /** Accepted request modalities; absent means unknown, while an explicit omission is negative capability. */
  inputModalities?: readonly ModelModality[]
}
```

正確性が重要なメタデータは、参考用カタログとは別に解決され、正確なルートを提供するアダプターが所有します。コンテキスト容量、アダプター呼び出しのデフォルト、推論の選択肢は、コンシューマーが権威あるモデル解決を繰り返さないよう、同一の正確なモデル結果を共有します。

```ts type-equiv
/** Provider-owned context capacity for one exact provider/model route. */
interface LlmModelContext {
  /** Maximum combined request and response context in tokens. */
  contextWindow: number
}
```

推論の労力は、もう 1 つの正確なルート機能です。コアは識別子にブランドを付与しますが、その値は列挙しません。各アダプターが順序付けられたセット、表示名、および任意のデプロイメントデフォルトを所有します。

```ts type-equiv
/** Adapter-owned identifier for one model's selectable reasoning effort. */
type ReasoningEffortId = Branded<'ReasoningEffortId'>
```

```ts type-equiv
/** Display metadata for one adapter-owned reasoning effort. */
interface LlmReasoningEffortInfo {
  /** Opaque stable value accepted by {@link GenerateOptions.reasoningEffort}. */
  id: ReasoningEffortId
  /** Human-readable effort name for selectors and diagnostics. */
  name: string
  /** Optional user-facing distinction from otherwise similar efforts. */
  description?: string
}
```

```ts type-equiv
/** Selectable reasoning efforts for one exact provider/model route. */
interface LlmModelReasoningInfo {
  /** Supported efforts in adapter-preferred display order. */
  efforts: readonly LlmReasoningEffortInfo[]
  /**
   * Adapter-configured default materialized into requests when callers omit
   * an effort. Absence preserves the provider's own default.
   */
  defaultEffort?: ReasoningEffortId
}
```

```ts type-equiv
/** Exact-route model metadata resolved by its owning adapter. */
interface LlmResolvedModelInfo extends LlmModelInfo {
  /** Provider-owned context capacity when known. */
  context?: LlmModelContext
  /** Adapter-configured per-request output cap materialized when callers omit one. */
  defaultMaxTokens?: number
  /** Adapter-owned selectable reasoning levels when exposed. */
  reasoning?: LlmModelReasoningInfo
}
```

```ts type-equiv
/** A single model request, fully assembled. */
interface GenerateOptions {
  /** Registered provider route selecting the adapter instance. */
  provider: string
  model: string
  /** Adapter-owned reasoning effort selected for this exact model. */
  reasoningEffort?: ReasoningEffortId
  /**
   * Ordered conversation messages, exactly as the provider sees them (after
   * the `system` slot). A loop-built request assembles them as
   * the derived history (dsh-agent-loop); a hand-built one-shot passes any list.
   */
  messages: Message[]
  /** System prompt text (adapters map to the provider's system slot). */
  system?: string
  /** Tool schemas (adapters map to the provider's `tools` field). */
  tools?: ToolSchema[]
  temperature?: number
  maxTokens?: number
  /**
   * Stop sequences: generation halts as soon as the model produces any one of
   * these strings (adapters map to the provider's stop field, e.g. OpenAI
   * `stop`). The stop string itself is not included in the output.
   */
  stop?: string[]
  signal?: AbortSignal
  /**
   * Session identity stamped by the loop for request routing. Replay uses it
   * to separate cursors; adapters may map it to model-hidden transport metadata.
   */
  sessionId?: Branded<'SessionId'>
  /**
   * Provider-neutral classification for an auxiliary model call. Adapters may
   * map the purpose to model-hidden transport metadata or purpose-specific
   * generation policy. Ordinary conversation requests leave it unset.
   */
  purpose?: 'compaction' | 'session-title'
}
```

モデル応答が停止した理由は、マージで拡張可能です。終端のプロバイダ障害には、ストリーミング契約の[`LlmFailure`](#llmfailure)が含まれます。

```ts type-equiv
/**
 * Why a model response stopped.
 * Merge-extensible so adapters can surface provider-specific reasons.
 */
interface FinishReasonMap {
  'stop': { kind: 'stop' }
  'tool-calls': { kind: 'tool-calls' }
  'max-tokens': { kind: 'max-tokens' }
  'aborted': { kind: 'aborted'; failure: LlmFailure }
  'error': { kind: 'error'; failure: LlmFailure }
}
```

`FinishReason = FinishReasonMap[keyof FinishReasonMap]`。`TokenUsage`（分離されたキャッシュフィールドを持つ呼び出し単位の計測）については、[以下](#tokenusage)で詳しく説明します。

`GenerateOptions.tools`には、モデルに送信されるツールの JSON スキーマ記述である`ToolSchema`が含まれます。これは、ループが各ステップで組み立てるリクエストの一部であるため、dsh-tools ではなく dsh-llm で宣言されます。

```ts type-equiv
/**
 * JSON-schema description of a tool, as sent to the model.
 *
 * Declared here (not in dsh-tools) because it is part of {@link GenerateOptions};
 * dsh-tools' ToolDefinition and dsh-system-prompt's PromptAssembly both import
 * it from this package.
 */
interface ToolSchema {
  name: string
  description: string
  /** JSON Schema object for the arguments. */
  parameters: Record<string, unknown>
}
```

モデル向けの`ToolSchema`はワイヤ型です。それを生成する登録済みの`ToolDefinition`（スキーマ + `execute`）については、[tools.md](tools.md)にあります。

プロバイダがまだ作成中のサーフェスにはルートもカタログもないため、照会は別途説明します。リクエストにはユーザーが編集中のドラフトが含まれ、応答はプロバイダが採用できる候補であり、提供すべきカタログではありません。

```ts type-equiv
/**
 * One interrogation of a provider endpoint that configuration has not stored
 * yet. Configuration surfaces send the draft a user is still editing, so the
 * request carries the endpoint and credential directly instead of naming a
 * route: a provider being added has no route to name.
 */
interface LlmModelDiscoveryRequest {
  /**
   * Route the draft is editing, when it edits an existing one. A route whose
   * adapter already knows its models answers from that knowledge instead of
   * asking the endpoint — the adapter's own registry is the better answer, and
   * it costs no network call.
   */
  provider?: string
  /**
   * Endpoint to interrogate. Optional because a route the adapter already
   * describes needs none; a route it does not must supply one.
   */
  baseURL?: string
  /** Wire protocol the endpoint speaks, when the draft names one. */
  api?: string
  /** Credential for this interrogation alone; the harness never stores it. */
  apiKey?: string
  /** Caller cancellation; implementations must settle promptly after it aborts. */
  signal?: AbortSignal
}
```

```ts type-equiv
/**
 * One model an endpoint reports about itself. Every field but the id is
 * optional because most provider listings disclose an id and nothing else;
 * a surface adopting one of these still owes the capacities its adapter needs.
 */
interface LlmDiscoveredModel {
  /** Model id the endpoint accepts. */
  id: string
  /** Human-readable name when the endpoint supplies one. */
  name?: string
  /** Maximum combined request and response context, when disclosed. */
  contextWindow?: number
  /** Maximum output tokens, when disclosed. */
  maxTokens?: number
}
```

### リクエストエンベロープ: `LlmCallConfig`と記録されたヘッダー

ループは、記録された状態から各リクエストを構築します。`EpochHeader`は呼び出し設定を記録し、アダプタのデフォルトで提供されたフィールドを示し、レンダリング済みプロンプトと、`toolOrder`で設定される（未設定の場合は辞書順の）権威ある返却ツール順序を、完全な`request/header`スナップショットで記録します。導出された履歴と合わせることで、リクエストはセッションログから再構成できます。[session.md](session.md#the-request-header-event-requestheader)および[再構成可能性に関する Agent Note](../../.agents/notes/implemented/architecture/2026-07-05-reconstructable-requests.md)を参照してください。

`agent/request`は固定された呼び出し設定シードを受け取り、プロバイダ、モデル、推論努力、またはサンプリングを切り替えるための置換を返すことがあります。ウォーターフォールの前に、ループはアダプタのデフォルトとしてマークされた値を削除します。これにより、正確なモデル準備で選択したルートの現在の値が具体化されます。マークされていない明示的な設定は提案に残ります。ウォーターフォール後、準備はサポートされない明示的な effort ID をクランプせずに拒否し、有効な設定とアダプタのデフォルトで提供されたフィールドをターンシグナルの下に記録します。準備された呼び出しは、ディスパッチを通じて 1 つのアダプタ登録を維持します。`llm/stream`に到達するリクエストはディープフリーズされているため、変更すると例外が発生します。また、会話リクエストと、個別に記録された固定補助呼び出しをオブザーバーが混同しないよう、プロセスローカルのループ ID を持ちます。

ワイヤ上では、ループが構築したリクエストは、レンダリング済みプロンプトの組み立てである`system`スロットを読み取り、その後に導出された履歴を読み取ります。記録されたリクエストスナップショットは、ターンの最初のステップでは最新の`user/message`で終わり、以降のステップでは前のステップのツール結果で終わります。開発時の不変条件は、すべてのループ構築リクエストに対して、この式を正確に再計算します。

FIXME(call-config-shape): キャッシュ目的で、残りのどのフィールドが真にエポックレベルなのかを再検討します（`model`とモデル所有の推論努力は明示的です。サンプリングスカラーは慎重を期してここに置かれています）。

```ts type-equiv
/**
 * Provider, model, reasoning effort, and sampling scalars of one conversation's
 * requests. Every field maps 1:1 onto the same-named `GenerateOptions` field;
 * the loop builds requests from the logged header rather than accepting these
 * per call.
 */
interface LlmCallConfig {
  provider: string
  model: string
  reasoningEffort?: ReasoningEffortId
  temperature?: number
  maxTokens?: number
  stop?: string[]
}
```

```ts type-equiv
/**
 * Effective config fields supplied by exact-model adapter resolution rather
 * than by the caller's request proposal.
 */
interface LlmCallConfigAdapterDefaults {
  reasoningEffort?: true
  maxTokens?: true
}
```

## サービスとプロバイダーの契約

`LlmAdapter`はプロバイダー契約です。これをサブクラス化し、`stream()`を実装して、1 つのアダプターインスタンスを`ctx.llm.registerAdapter(providers, adapter)`に登録します。`GenerateOptions.provider`は登録済みアダプターを選択します。`GenerateOptions.model`はそのアダプターに渡され、ライフサイクル開始時に登録されている必要はありません。重複するプロバイダールートはアトミックに失敗します。任意の`providerRetryPolicy()`は通常のデフォルト値とともにルートごとに取得されます。一方、`providerInfo()`と非同期の`listModels()`は、分離されたセレクターのメタデータを伴って`LlmRuntime.listProviders()` / `listModels()`に入力されます。このカタログはリクエストのホワイトリストではなく助言的なものです。アダプターが最終的な権限を持ち、一覧にないモデル ID を受け入れる場合があります。1 回の非同期`resolveModel()`クエリは、正確なモデル ID、任意の正確性に影響するコンテキスト容量、アダプター設定済みの`defaultMaxTokens`、および任意のデプロイメントデフォルトを伴う順序付きのモデル所有推論 ID を返します。フィールドが存在しない場合は、無効なカタログメンバーシップではなく、メタデータを利用できないかプロバイダー所有の動作であることを意味します。リゾルバーは任意のキャンセルを受け取り、中断後は速やかに完了しなければなりません。`LlmRuntime.resolveModelInfo()`は集約を検証して分離します。最終アダプター境界では、`resolveCallConfig()`は`maxTokens`が存在しない場合にのみ出力デフォルトを具体化し、推論を検証して具体化します。そのため、直接呼び出しでは設定済みのいずれの動作もバイパスできません。直接ディスパッチは、その解決を待機する前に 1 つの登録を取得します。代わりにエージェントループは`prepareCall()`を使用し、モデル解決、永続的なヘッダーログ、ディスパッチの間で同じ登録を維持し、その完全一致の参照から分離されたコンテキストメタデータを保持して、アダプターがどの設定フィールドをデフォルト設定したかを報告します。アダプター検索は`llm/stream`ウォーターフォールの終端継続で行われるため、リスナーは呼び出しを短絡したり、検索前に変更可能なワンショットリクエストをルーティングしたりできます。AgentLoop は、外側のウォーターフォールがストリームハンドルを返すと、リクエスト試行を一度観測します。この限定的な境界は、遅延する終端アダプターが構築された、またはプロバイダー I/O を開始したことを証明するものではありません。`block-start` / `block-end` の`index`相関とアセンブラーを組み合わせることで、アダプターは整形式のチャンクを出力するだけで済みます。ブロックの再構築は各アダプターの責務ではありません。[architecture.md](../architecture.md#turn-flow)には、1 ターンにおける`ctx.llm.stream()`と`llm/stream`ウォーターフォールの位置が示されています。

```ts type-equiv
/** One model call whose config and adapter registration were resolved together. */
interface PreparedLlmCall {
  /** Detached, deep-frozen config with any adapter-owned default materialized. */
  readonly config: LlmCallConfig
  /** Immutable retry policy captured with the adapter registration. */
  readonly retryPolicy: ResolvedRetryPolicy
  /** Detached context metadata resolved with the registration-bound call. */
  readonly context?: LlmModelContext
  /** Config fields materialized by the captured adapter rather than proposed by the caller. */
  readonly adapterDefaults: LlmCallConfigAdapterDefaults
  /**
   * Dispatch this call once through the registration captured during
   * preparation. The request's call-config fields must match {@link config};
   * reuse or mismatch fails with `INVALID_PREPARED_CALL`.
   * @param options - fully assembled request carrying the prepared config.
   * @returns the chunk stream, including the `llm/stream` waterfall.
   */
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}
```

```ts public-api
/**
 * Provider-wire adapter for the harness message and stream vocabulary. Register implementations
 * with `ctx.llm.registerAdapter(providers, adapter)`. Every provider HTTP request must include
 * `attributionHeaders()`; prove the headers are added in the wire request or library header hook. The direct-fetch
 * DeepSeek and library-backed pi-ai adapters meet this contract through different internals.
 */
declare abstract class LlmAdapter {
  /**
   * Describe one provider route owned by this adapter.
   * @param provider - a route passed to `registerAdapter()` for this instance.
   * @returns detached display metadata whose id must equal `provider`.
   */
  providerInfo(provider: string): LlmProviderInfo;
  /**
   * Return the provider-owned retry policy captured with this route.
   * @param _provider - a route passed to `registerAdapter()` for this instance.
   * @returns a resolved policy, or `undefined` to use the normal defaults.
   */
  providerRetryPolicy(_provider: string): ResolvedRetryPolicy | undefined;
  /**
   * List models this adapter can currently advertise for one owned provider.
   * The result is advisory: an adapter may accept unlisted model ids, and
   * consumers must not turn absence into request rejection.
   * @param _provider - one provider route owned by this adapter.
   * @returns discoverable models in adapter-preferred order.
   */
  listModels(_provider: string): Promise<readonly LlmModelInfo[]>;
  /**
   * Resolve all metadata available for one exact model. This query is
   * independent of the advisory catalog and does not validate request routing.
   * @param provider - one provider route owned by this adapter.
   * @param model - exact model id passed to {@link GenerateOptions.model}.
   * @param _signal - cancellation for this exact-model lookup; asynchronous
   *   implementations must settle promptly after it aborts.
   * @returns provider/model identity plus any context, call-default, and reasoning metadata.
   */
  resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo>;
  /**
   * Stream one model call as raw chunks. The only required method.
   * @param options - the fully-assembled request; implementations must honor `options.signal`.
   * @returns the chunk stream, obeying the adapter contract documented on `StreamChunk`.
   */
  abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
```

`ContentBlockType`（`index`で相関付けられたブロックが保持するキーセット）は、上記の[`ContentBlockMap`](#content-blocks-and-messages)から導出されます。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`によりソースから生成されます（doc-sync で`pnpm run verify-cordis-catalog`によって最新性が検証されます。`pnpm run gen-cordis-catalog`で再生成します）。このセクションはページの両言語側でバイト単位で同一です。シグネチャブロックは`ts cordis-catalog`フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[primer](../cordis-primer.md#dispatch-modes)で定義されており、フレームワークから継承される`ctx` API は[cordis-api/inherited.md](../cordis-api/inherited.md)にあります。

<a id="ctxllm--llmruntime"></a>

### `ctx.llm` — `LlmRuntime`

抽象`llm`サービスです。アダプターレジストリとストリーミングモデル呼び出し API で構成され、`llm/stream`ウォーターフォールを介してインターセプトできます。

```ts cordis-catalog
/**
 * Register an adapter for the given provider routes. Throws `LlmError` with code
 * `DUPLICATE_ADAPTER` if any provider already has an adapter (all-or-nothing).
 * Disposed with the fiber.
 * @param providers - every provider route this adapter should serve.
 * @param adapter - the adapter that streams calls for those providers.
 * @returns the disposer, carrying {@link AdapterRegistrationHandle.replace}.
 */
registerAdapter(providers: string[], adapter: LlmAdapter): AdapterRegistrationHandle

/**
 * Describe provider routes with a registered adapter.
 * @returns detached provider metadata in registration order.
 */
listProviders(): LlmProviderInfo[]

/**
 * Declare provider routes an adapter plugin can activate through
 * configuration. Registration is all-or-nothing: an empty list, invalid
 * entry, or a provider already declared by any registration throws
 * `LlmError` without registering the rest. Disposed with the fiber.
 * @param entries - every configurable provider this plugin owns.
 * @returns a handle that withdraws all of them, and can atomically replace them.
 */
registerConfigurableProviders(entries: readonly LlmConfigurableProvider[]): DirectoryRegistrationHandle

/**
 * List every declared configurable provider, registered or dormant.
 * @returns detached directory entries in declaration order.
 */
listConfigurableProviders(): LlmConfigurableProvider[]

/**
 * Offer to interrogate provider endpoints on behalf of the settings
 * namespace this plugin owns. The namespace is the key because that is what
 * a configuration surface already holds from the configurable-provider
 * directory, and because a provider being *added* has no route to name yet.
 * Disposed with the fiber.
 * @param settingsNs - the namespace whose profiles this discovery serves.
 * @param discover - interrogates one endpoint; must honor `request.signal`.
 * @returns the disposer that withdraws the offer.
 */
registerModelDiscovery( settingsNs: string, discover: (request: LlmModelDiscoveryRequest) => Promise<readonly LlmDiscoveredModel[]>, ): () => void

/**
 * Interrogate one provider endpoint for the models it advertises. The
 * request describes a draft, not a stored route, so nothing here reads or
 * writes settings or credentials — the caller owns both, and the reply is
 * candidate metadata a surface may offer for adoption.
 * @param settingsNs - namespace whose registered discovery serves this draft.
 * @param request - the endpoint, protocol, and one-shot credential to use.
 * @returns the advertised models, deduplicated in endpoint order.
 */
async discoverModels( settingsNs: string, request: LlmModelDiscoveryRequest, ): Promise<LlmDiscoveredModel[]>

/**
 * Resolve the retry policy captured when one provider route was registered.
 * @param provider - registered provider route to inspect.
 * @returns the provider-owned policy, with normal defaults already resolved.
 */
providerRetryPolicy(provider: string): ResolvedRetryPolicy

/**
 * Discover models advertised by one registered provider. Catalog membership
 * is advisory and never changes routing or request validation.
 * @param provider - registered provider route to inspect.
 * @returns detached model metadata in adapter-preferred order.
 */
async listModels(provider: string): Promise<LlmModelInfo[]>

/**
 * Resolve and validate all metadata from the adapter that owns one exact
 * route. The result is detached from adapter-owned objects; catalog
 * membership remains advisory and does not control request routing.
 * @param provider - registered provider route to inspect.
 * @param model - exact model id passed to the adapter.
 * @param signal - optional cancellation for adapter-owned asynchronous lookup.
 * @returns exact model identity plus available context and reasoning metadata.
 */
async resolveModelInfo( provider: string, model: string, signal?: AbortSignal, ): Promise<LlmResolvedModelInfo>

/**
 * Validate a conversation call config against its exact model capability and
 * materialize adapter-configured defaults. Unsupported explicit efforts
 * reject before provider I/O; no clamping or aliasing is performed. This
 * standalone query does not bind a later dispatch; use {@link prepareCall}
 * when logging and streaming must share one adapter registration.
 * @param config - provider/model route and optional request controls.
 * @param signal - optional cancellation for adapter-owned capability lookup.
 * @returns a detached config only when a default must be materialized.
 */
async resolveCallConfig(config: LlmCallConfig, signal?: AbortSignal): Promise<LlmCallConfig>

/**
 * Resolve one call under its current adapter registration. The returned
 * one-shot handle keeps that registration across header logging and dispatch,
 * so HMR cannot combine one adapter's capability result with another adapter.
 * @param config - provider/model route and optional request controls.
 * @param signal - optional cancellation for adapter-owned capability lookup.
 * @returns a prepared config and its registration-bound stream entry point.
 */
async prepareCall(config: LlmCallConfig, signal?: AbortSignal): Promise<PreparedLlmCall>

/**
 * Stream one model call as raw chunks (token-level deltas). Replay state is
 * retained only when the same adapter instance owns its historical provider
 * and the target provider. Final adapter selection remains fixed through
 * asynchronous exact-model resolution and dispatch. Adapter selection,
 * dispatch, and iteration failures become terminal `error` or `aborted`
 * finish chunks; middleware, nested-call, cleanup, and consumer failures
 * remain thrown.
 * @param options - the full request; `options.provider` selects the adapter.
 * @returns the chunk stream, possibly wrapped by `llm/stream` listeners.
 */
stream(options: GenerateOptions): AsyncIterable<StreamChunk>
```

ソース: [`packages/llm/llm/src/index.ts:284`](../../packages/llm/llm/src/index.ts)

<a id="llm-events"></a>

### `llm/*` イベント

<a id="llmadapters-updated--emit"></a>

#### `llm/adapters-updated` — emit

プロバイダーのトポロジが変更されました。アダプターがルートを登録または登録解除したか、設定可能なプロバイダーのディレクトリでエントリが増減しました。このペイロードを持たないレジストリ通知は、各コミットポイント（登録の破棄を含む）で発行されます。コンシューマーは新しい状態を取得するために `listProviders()`、`listModels()`、または `listConfigurableProviders()` を再読み込みします。オブザーバーの失敗は封じ込められ、レジストリの変更を拒否することはできません。

```ts cordis-catalog
/**
 * The provider topology changed: an adapter registered or unregistered
 * routes, or the configurable-provider directory gained or lost entries.
 * This payload-free registry notification fires at each commit point
 * (including registration disposal); consumers re-read `listProviders()`,
 * `listModels()`, or `listConfigurableProviders()` for the new state.
 * Observer failures are contained and cannot veto the registry mutation.
 * @mode emit
 */
'llm/adapters-updated'(): void
```

ソース: [`packages/llm/llm/src/types.ts:23`](../../packages/llm/llm/src/types.ts)

<a id="llmstream--waterfall"></a>

#### `llm/stream` — waterfall

すべてのストリーミングモデル呼び出し（再試行、リプレイ、ルーティング）を囲むウォーターフォールです。LlmRuntime にバインドされます。`next()` を呼び出して解決済みアダプターのストリームに到達するか、独自のチャンクを yield してショートサーキットできます。

```ts cordis-catalog
/**
 * Waterfall around every streaming model call (retry, replay, routing).
 * Bound to the {@link LlmRuntime}; call `next()` to reach the resolved
 * adapter's stream, or yield your own chunks to short-circuit.
 * @param options - the full request. A LOOP-built request carries the
 *   process-local {@link markAgentLoopRequest} identity and arrives deep-frozen
 *   (mutation throws): its content is a pure function of the session log (the
 *   reconstructability Agent Note), so listeners read it, never rewrite it.
 *   Hand-built calls do not carry that marker; their messages already obey
 *   the immutable creation contract.
 * @mode waterfall
 */
'llm/stream'(this: LlmRuntime, options: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>
```

ソース: [`packages/llm/llm/src/index.ts:64`](../../packages/llm/llm/src/index.ts)
<!-- END GENERATED cordis-surface -->
