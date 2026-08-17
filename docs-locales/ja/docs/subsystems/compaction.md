# コンパクション

コンパクションの抽象シームは、bash のように分割された[機能シーム](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)です。サービス定義（[dsh-compaction](../../packages/compaction/compaction)、`ctx.compaction`）、サービスプロバイダー（[dsh-compaction-basic](../../packages/compaction/compaction-basic)などのバックエンド）、人間の コンシューマー（[dsh-command-compact](../../packages/compaction/command-compact)）から成ります。コンパクションは**任意の機能の一つ**であり、agent-loop の中核には含まれません。そのため、その語彙は[core.md](core.md)ではなくここにあります。トークナイザーまたはテンプレートベースのバックエンドは、同じインターフェースを実装する兄弟パッケージです。bash とは異なり、このインターフェースは必然的に`dsh-session`と`dsh-llm`に依存します。その動詞はエージェント所有の`Session`に作用し、永続的な要約イベントでは`ContentBlock`の語彙を使用します（[コンパクション機能シームの Agent Note](../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md)を参照してください）。

ソース： [`packages/compaction/compaction/src/types.ts`](../../packages/compaction/compaction/src/types.ts)

## `compaction/*` セッションイベント

コンパクションは、宣言マージによって[`SessionEventMap`](session.md)を 3 種類のイベント型で拡張します。3 種類はいずれも**ログ専用** です。ロック、要約、選択範囲、シャドー化されたイベント seq、トークン数、モデル呼び出しを記録しますが、surface には参加しません。`SurfaceEventType`は意図的に拡張されません（モデルに到達するのはメッセージを生成するイベントのみです）。そのため、要約自体は`surfaceOp: { op: 'replace', start, end }`を伴う別個の`user/message`で処理されます。これは要約コンパクションが実行する唯一の surface 変更です。[Agent Note](../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md)に、`user/message`を再利用する根拠があります。

| イベント | ペイロード | 役割 |
|---|---|---|
| `compaction/start` | `{ turn }` | ログに記録されるロックを取得します。数値は開いている自動ターンを識別し、`null`は単独の手動試行を識別します |
| `compaction/summary` | `{ summary, rawOutput?, llmStreamCall?, shadowedRange, shadowedSeqs, shadowedTokenCount, provider, model, maxTokens?, usage? }` | 安全な要約プロジェクション、任意の完全なプロバイダー出力と使用量、このコンテキストの`ctx.llm.stream()`を介した 1 回の呼び出しだけで結果が生成された場合の`llmStreamCall: true`マーカー（これには完全な`rawOutput`が必要です）、シャドー化された surface 境界の組（`start`/`end` seq。数値区間ではなく位置スパンです）、surface 順のシャドー化された seq、推定トークン数、要約呼び出しのエンベロープ（`provider`、`model`、および適用された場合はその生成上限）です。これらは、ログとコードからワンショット要求を再構成できるよう記録されます（再構成可能性の Agent Note）。マークされていない`rawOutput`では呼び出し経路を特定できません |
| `compaction/end` | `{ turn, error? }` | 同じ数値または null の所有者でロックを解放します（`error`は失敗した試行を記録します） |

ロックは**操作全体** を囲みます。まず`compaction/start`が追加され、次に要約、`compaction/summary`レコード、`user/message`による置換がすべて実行され、その後にのみ`compaction/end`が行われます。最後にロックを解放することで、操作途中のクラッシュは、コンパクションが完了したと誤って示す`compaction/end`ではなく、検出可能な孤立ロック（対応する`compaction/end`がない`compaction/start`）になります。

マーカーはロック時点を示すものであり、排他的なコンテナではありません。要約の保留中に、無関係なアイドル注入が単独の手動開始と終了の間に現れることがあります。手動パスは選択した位置スパンのみを再検証するため、その注入されたコンテキストは置換チェックポイント後も残ります。ライブの未対応開始はすべてのエントリポイントをブロックします。より新しい`session/end-seed`より前の未対応開始は、以前のライフサイクルからの古い証拠であるため無視されます。

これらのバリアントは`declare module '@deepseek-ai/dsh-session/types'`ブロック内でマージされるため、他のサブシステムページにあるトップレベル型とは異なり、drift-checked ` ```ts type-equiv `ブロックとして貼り付けられません（`verify-type-equiv`抽出器は名前でトップレベル宣言のみを照合します）。上記のペイロード表がカタログ項目です。正式なフィールドについてはソースリンクを参照してください。

## `CompactionResult`

呼び出し元に成功したコンパクションが返すものは、記帳イベントの seq、安全な要約プロジェクション、シャドー化された範囲と seq、推定トークン数です。

```ts type-equiv
/** Result of a successful compaction operation. */
interface CompactionResult {
  /** Stable identity shared by this compaction's complete durable lifecycle. */
  compactionId: CompactionId
  /** Human command that initiated this compaction, when it was manual. */
  sourceCommandId?: CommandId
  /** The seq of the appended `compaction/start` event. */
  startSeq: number
  /** The seq of the appended `compaction/summary` event. */
  summarySeq: number
  /** The seq of the appended `compaction/end` event. */
  endSeq: number
  /** The summary content blocks produced by the backend. */
  summary: ContentBlock[]
  /**
   * The surface-boundary pair that was shadowed: the seqs of the first
   * (`start`) and last (`end`) surface nodes of the replaced range. A
   * surface-POSITION span, not a numeric seq interval — after a prior replace
   * lands a fresh high-seq summary node at an older range's position, `start`
   * can be GREATER than `end`. {@link CompactionResult.shadowedSeqs} is the
   * authoritative set of shadowed nodes, in surface order.
   */
  shadowedRange: { start: number; end: number }
  /** The seqs of all shadowed surface nodes, in surface order. */
  shadowedSeqs: number[]
  /** Estimated token count of the shadowed content. */
  shadowedTokenCount: number
}
```

## サービス

自動呼び出し元はポリシーを実行する理由を指定します。実装では、通常の圧力よりも確認済みのオーバーフローを積極的に扱うことができます。

```ts type-equiv
/** Why automatic policy is asking a backend to consider compaction. */
type CompactionTrigger = 'pressure' | 'context-overflow'
```

`CompactionEngine`は、自動`pressure`または`context-overflow`ポリシー用の`compactIfNeeded(agent, trigger, signal)`、圧力未満でも有用なアイドルセッションの縮小を 1 回行うための`compactNow(agent, signal)`、明示的な包括的 surface 範囲用の`compactRegion(...)`を公開します。`compactNow()`はターン間のエージェント保守として実行され、有用な範囲がない場合は書き込みを行わず`null`を返し、要約前に単独の`turn: null`ブラケットを記録し、その後にキューされたプロンプトが新しい surface から派生する前に、終了済みの試行をフラッシュします。すべてのバックエンドは、`compactCheckpointSource(compactionId, sourceCommandId?)`を使用して置換`user/message`ソースを作成します。クライアントおよび wire の コンシューマー は、そのコンストラクター、`CompactionCheckpointSource`、`isCompactCheckpointSource()`を Cordis 非依存の`@deepseek-ai/dsh-compaction/checkpoint`サブパスからインポートします。一方、パッケージルートは Host コンシューマー 向けにそれらを再エクスポートします。必須のトランザクション ID は置換チェックポイントを関連付け、述語により特定のバックエンドに依存せず認識できます。実装は、提供された signal を要約に転送する必要があります。このシームは価格設定 API を所有しません。シングルトンの[`ctx.tokenMeter`](token-meter.md)が見積もりと再生を直接所有し、`dsh-compaction-basic`が保持、イベント順序付け、ルーティングされた要約呼び出し、およびそれらの設定を所有します。

想定される手動失敗では`ManualCompactionErrorCode`を使用します。

```ts type-equiv
/** Expected failure classes for an explicit idle-session compaction request. */
type ManualCompactionErrorCode =
  | 'busy'
  | 'cancelled'
  | 'changed'
  | 'summary'
  | 'commit'
  | 'persistence'
```

`changed` と `summary` は会話サーフェスを変更せずに、失敗した試行を閉じてログに永続化します。`commit` は部分的な変更の後に続くことがあります。`persistence` はインメモリのブラケットは閉じたものの、そのフラッシュに失敗したことを意味します。キャンセルは引き続き別に扱われ、必要なクリーンアップ後に正確な中断理由をスローします。

プレッシャー・コンパクションは、リクエストの導出前にシリアル `agent/pre-step` で実行されます。プレッシャーまたは正規のオーバーフローが条件を満たすと、compaction-basic は範囲選択の前に任意の [`ctx.toolResultPruner`](../../packages/compaction/compaction-tool-result-pruner/README.md) を呼び出し、`ctx.tokenMeter` を通じて再計測し、要約なしでサーフェスを進められます。失敗したリクエストの復旧は、失敗したステップが閉じた後に `agent/request-error` を通じて実行され、後続の要約処理が枝刈り後にスローした場合でも、サーフェス置換世代が進んだときにのみ再試行アクションを返します。キャンセルは引き続き優先されます。リージョン境界はツール呼び出しと結果のペアリングを保持しますが、ターン全体は保持しないため、過大なターンの早期に閉じたステップをコンパクト化できます。`dsh-compaction-basic` がしきい値、保持テールのポリシー、オーバーフロー上限、および失敗処理を管理します。

サービス定義は、seq の前後でツール呼び出しと結果のペアリングを確認するための `toolPairingBalancedBefore(session, seq)` と `toolPairingBalancedAfter(session, seq)` をエクスポートします。どちらも現在のサーフェスのメンバーシップを検証し、存在しない seq と孤立した結果を拒否します。キャッシュの動作は [パッケージ契約](../../packages/compaction/compaction/README.md#tool-pairing-boundaries) で定義されています。

## ツール結果の枝刈り結果

任意のツール結果枝刈りサービスは、耐久性のある各コンテンツ置換と、Unicode コードポイントの合計削減量を報告します。公開結果型は [`compaction-tool-result-pruner/src/types.ts`](../../packages/compaction/compaction-tool-result-pruner/src/types.ts) にあります。

```ts type-equiv
/** Cited source event and size accounting for one landed surface replacement. */
interface PrunedEntry {
  /** Full-fidelity tool-result event shadowed by the replacement. */
  readonly originalSeq: number
  /** Newly appended pruned tool-result event. */
  readonly replacementSeq: number
  /** Tool call shared by the original and replacement. */
  readonly callId: CallId
  /** Original text size in Unicode code points. */
  readonly charsBefore: number
  /** Replacement text size in Unicode code points. */
  readonly charsAfter: number
}
```

```ts type-equiv
/** Aggregate outcome of one stable-surface pruning pass. */
interface PruneResult {
  /** Replacements in the snapshotted surface order. */
  readonly pruned: readonly PrunedEntry[]
  /** Total Unicode code points removed across replacements. */
  readonly charsRemoved: number
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

ソースから `scripts/gen-cordis-catalog.ts` により生成されます（doc-sync で `pnpm run verify-cordis-catalog` により最新であることを検証し、`pnpm run gen-cordis-catalog` で再生成します）。このセクションはページの両言語側でバイト単位で同一です。シグネチャブロックは `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは [入門](../cordis-primer.md#dispatch-modes) で定義されており、フレームワークから継承した `ctx` API は [cordis-api/inherited.md](../cordis-api/inherited.md) にあります。

<a id="ctxcompaction--compactionengine-abstract-seam"></a>

### `ctx.compaction` — `CompactionEngine`（抽象的な接続点）

抽象的なコンパクションサービスです。実装はトリガーポリシー、保持、および要約を管理し、別の計測サービスを利用できます。実行が成功すると、選択したサーフェス範囲を 1 つの要約ノードに置き換え、同じセッションでのコンパクションの同時実行を防ぎます。置換ユーザーメッセージは、コンシューマーがバックエンドとは独立して認識・関連付けできるよう、トランザクション識別子とともに compactCheckpointSource を使用します。コンテキストごとに 1 つの実装を `ctx.compaction` としてロードします。

```ts cordis-catalog
/**
 * Consider automatic compaction for one explicit trigger. Pressure policy
 * uses the latest durable routed request, while context-overflow policy may
 * force a useful balanced reduction even below the normal threshold. Return
 * `null` when no safe range can be compacted. A single oversized retained
 * unit or request envelope cannot be repaired through surface compaction.
 *
 * @param agent - agent context owning the session surface and routing options.
 * @param trigger - normal pressure or provider-confirmed context overflow.
 * @param signal - cancellation signal; model-backed implementations must forward it.
 * @returns the compaction result, or `null` if no compaction was needed.
 */
abstract compactIfNeeded( agent: CompactionAgentContext, trigger: CompactionTrigger, signal: AbortSignal, ): Promise<CompactionResult | null>

/**
 * Explicitly compact useful history even below automatic pressure thresholds.
 * Implementations synchronously start an idle task before any asynchronous
 * work, select a useful range without writing on a no-op, then
 * append a standalone `compaction/start` before summarization. That durable
 * marker is the compaction lock until one `compaction/end` attempt. Later waking
 * prompts remain accepted in FIFO order and start only after the optional
 * durability checkpoint and idle-task settlement. Context injected while the
 * summary runs may sit between the marker pair; only the selected span must
 * remain stable.
 *
 * @param agent - idle agent whose durable history should be compacted.
 * @param signal - cancellation scoped to this compaction request.
 * @param sourceCommandId - initiating command identity for a manual compaction.
 * @returns the compaction result, or `null` when no safe useful range exists.
 * @throws {@link ManualCompactionError} for expected busy, agent-cancellation,
 * changed-span, summarization/shrink, commit-stage, or persistence failures;
 * an aborted request preserves its exact abort reason. Failed attempts remain
 * visible in the log.
 */
abstract compactNow( agent: ManualCompactAgentContext, signal: AbortSignal, sourceCommandId?: CommandId, ): Promise<CompactionResult | null>

/**
 * Forcibly compact a range of surface nodes into a single summary node.
 * `start` and `end` name an inclusive span by surface position, not numeric seq
 * order; replacements can make visible seqs non-monotonic. Both edges must be
 * balanced so assistant tool calls remain paired with their results. A model-
 * backed implementation forwards cancellation and rejects active, missing,
 * reversed, or unbalanced ranges. The target session is `agent.session`.
 * Its replacement user message must use {@link compactCheckpointSource} with
 * the transaction's `CompactionId`.
 * Use {@link toolPairingBalancedBefore} and {@link toolPairingBalancedAfter}
 * for the edge checks.
 *
 * @param start - first surface seq, inclusive.
 * @param end - last surface seq, inclusive.
 * @param agent - context whose session is mutated and whose routing options guide summarization.
 * @param signal - optional cancellation; model-backed implementations must forward it.
 * @throws when compaction is active or the range is missing, reversed, or unbalanced.
 * @returns the appended event seqs, summary, replaced range, and token accounting.
 */
abstract compactRegion( start: number, end: number, agent: CompactionAgentContext, signal?: AbortSignal, ): Promise<CompactionResult>
```

型: [CommandId](commands.md)

ソース: [`packages/compaction/compaction/src/index.ts:96`](../../packages/compaction/compaction/src/index.ts)

<a id="ctxtoolresultpruner--toolresultpruner"></a>

### `ctx.toolResultPruner` — `ToolResultPruner`

現在のツール結果サーフェスノードに対する決定論的な head/middle/tail の枝刈り。

```ts cordis-catalog
/**
 * Measure text content in Unicode code points; non-text blocks cost zero.
 * @param blocks - tool-result content to measure.
 * @returns total Unicode code points across text blocks.
 */
measureContent(blocks: readonly ContentBlock[]): number

/**
 * Replace an over-budget text middle while retaining rich-block order.
 * Text slicing is by Unicode code point, not UTF-16 code unit, so a retained
 * boundary cannot split a surrogate pair. Grapheme clusters may still split.
 * @param blocks - original tool-result content.
 * @returns pruned content, or `null` when the text is within budget.
 */
pruneContent(blocks: readonly ContentBlock[]): ContentBlock[] | null

/**
 * Prune every over-budget tool result from one stable current-surface snapshot.
 * Each replacement preserves the complete event data except for `content`,
 * cites the shadowed node so replay can recover the replacement input, and is
 * immediately preceded by a `compaction/prune` shadow-price event pricing the
 * shadowed node through the injected token meter, so pure consumers can
 * subtract it without per-node state.
 * @param session - session whose current surface is rewritten.
 * @returns landed replacements and aggregate Unicode-code-point savings.
 * @throws when the session rejects a replacement; replacements committed
 * earlier in the pass remain durable.
 */
pruneSession(session: Session): PruneResult
```

型: [ContentBlock](llm-streaming.md) · [Session](session.md)

ソース: [`packages/compaction/compaction-tool-result-pruner/src/index.ts:44`](../../packages/compaction/compaction-tool-result-pruner/src/index.ts)
<!-- END GENERATED cordis-surface -->
