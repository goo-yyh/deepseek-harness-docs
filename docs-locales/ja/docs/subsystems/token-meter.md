# トークン メーター

`@deepseek-ai/dsh-token-meter` は、リクエスト負荷と位置的なサーフェス価格設定のために、切り離された再生スナップショットを 1 つ公開します。`logRevision` は、測定内の各フィールドで消費される永続イベントの数です。

ソース: [`packages/llm/token-meter/src/types.ts`](../../packages/llm/token-meter/src/types.ts)

## `TokenMeasurement`

```ts type-equiv
/** Detached immutable request-pressure and surface snapshot at one consumed log revision. */
interface TokenMeasurement {
  /** Number of durable events consumed; equal to the next unread event seq. */
  readonly logRevision: number
  /** Provider or heuristic anchor used for this measurement. */
  readonly baseline: TokenMeasurementBaseline
  /** Signed repricing of current surface content relative to the baseline anchor. */
  readonly surfaceDeltaTokens: number
  /** Non-negative current request-and-response pressure. */
  readonly totalTokens: number
  /** Total heuristic tokens across the current surface. */
  readonly surfaceTokens: number
  /** Current surface nodes in positional head-to-tail order. */
  readonly nodes: readonly TokenSurfaceNode[]
}
```

`baseline.kind === 'usage'` は、直近の成功したプロバイダー呼び出しが同じ正規リクエストエンベロープを持ち、その合計がその呼び出しの完全なヒューリスティックアンカー以上であることを意味します。`estimated` は、再利用可能な保守的使用量アンカーが存在しないため、サービスが固定ヒューリスティックで完全なエンベロープとサーフェスを価格設定したことを意味します。後続の成功したリクエストは以前のアンカーを置き換えます。符号付きの `surfaceDeltaTokens` は、一致するアンカーに対する増加と減少を保持します。`totalTokens` はリクエストおよびレスポンスの負荷のままですが、`surfaceTokens` はサーフェスのみのヒューリスティック合計であり、ノード価格の合計に等しくなります。

## `TokenSurfaceNode`

```ts type-equiv
/** One token-priced node in the current ordered session surface. */
interface TokenSurfaceNode {
  /** Durable sequence number of the surface event. */
  readonly seq: number
  /** Heuristic tokens for the exact message projected by this node. */
  readonly tokens: number
}
```

サーフェス順序が正規です。置換ノードは、後続の位置ノードより大きな永続 seq を持つ場合があります。スナップショットは不変であり、基盤となる再生フォールドが進んでも増加しません。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

ソースから `scripts/gen-cordis-catalog.ts` により生成されます（doc-sync で `pnpm run verify-cordis-catalog` により最新であることを検証し、`pnpm run gen-cordis-catalog` で再生成します）。このセクションはページの両方の言語版でバイト単位で同一です。シグネチャブロックは `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは [入門](../cordis-primer.md#dispatch-modes) で定義されており、フレームワークから継承される `ctx` API は [cordis-api/inherited.md](../cordis-api/inherited.md) にあります。

<a id="ctxtokenmeter--tokenmeter"></a>

### `ctx.tokenMeter` — `TokenMeter`

サービス全体の 1 つの推定器と、分離されたセッション単位のフォールドの再生所有者です。

```ts cordis-catalog
/**
 * Measure current request pressure and surface through the durable tail.
 *
 * Provider usage is reused only when the latest successful call's canonical
 * request envelope matches `requestHeader` and its total is no lower than
 * that call's full heuristic anchor; otherwise the complete envelope and
 * surface are heuristically repriced.
 *
 * `requestHeader` affects request pressure only; surface fields always
 * describe the current session surface. Every call clones those positional
 * nodes, so measurement is O(surface).
 *
 * @param session - session to replay through its current durable tail.
 * @param requestHeader - optional effective request envelope replacing the latest logged header.
 * @returns a detached deeply immutable pressure and surface measurement.
 */
measure(session: Session, requestHeader?: EpochHeader): TokenMeasurement

/**
 * Heuristically price one model-visible message (instance face of the pure
 * `estimateMessage` export from `estimate.ts`).
 * @param message - message to price without mutation.
 * @returns content and role-framing tokens under the fixed service heuristic.
 */
estimateMessage(message: Message): number
```

型: [EpochHeader](session.md) · [Message](llm-streaming.md) · [Session](session.md)

ソース: [`packages/llm/token-meter/src/index.ts:74`](../../packages/llm/token-meter/src/index.ts)
<!-- END GENERATED cordis-surface -->
