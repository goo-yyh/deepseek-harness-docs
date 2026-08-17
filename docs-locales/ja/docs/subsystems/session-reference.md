# セッション参照

構造化されたセッション間参照リクエストと、準備済みメッセージコンテキストです。[パッケージ契約](../../packages/context/session-reference)では、正規 URI、現在のサーフェスへの投影、タグセーフな JSON とバイトの保持、安定したエラー、および信頼できないモデルプロンプトを定義します。Host アダプターは、UI のメンション構文をエージェントコアへ渡す代わりに、これらの型を使用します。

出典: [`packages/context/session-reference/src/types.ts`](../../packages/context/session-reference/src/types.ts)

## 入力と候補

`SessionReferenceInput`は Host に依存しない選択です。id が正式な値であり、label はスナップショットに引き継がれる表示メタデータです。

```ts type-equiv
/** One source session selected by a host. */
interface SessionReferenceInput {
  /** Opaque source session identity. */
  sessionId: SessionId
  /** Optional user-facing mention label. */
  label?: string
}
```

`SessionReferenceCandidate`は Host 向けの検出出力です。label には存在する場合に最新のセッションタイトルを使用しますが、フィルタリングでは引き続きセッション id と cwd のみを検索し、トランスクリプトテキストは検索しません。

```ts type-equiv
/** One host-facing candidate from exact session metadata. */
interface SessionReferenceCandidate {
  /** Opaque source session identity. */
  sessionId: SessionId
  /** Latest log-backed title, falling back to the opaque session id. */
  label: string
  /** Source session working directory, when recorded. */
  cwd?: string
  /** Source session creation time in Unix epoch milliseconds. */
  createdAt: number
}
```

## 準備済みメッセージ

準備では読み取り可能な現在のメッセージ内容を保持し、集約済みコンテキストを最大 1 件返します。

```ts type-equiv
/** Direct message content and optional referenced-session context. */
interface PreparedReferencedMessage {
  /** Readable message content after host mention tokens are removed. */
  content: ContentBlock[]
  /** Aggregated untrusted snapshot, absent when the message has no references. */
  additionalContext?: UserMessage
}
```

## エラー

`SessionReferenceError.code`は、無効な設定または入力、自己参照、件数上限、ソース読み取りの失敗、予算の失敗、およびキャンセルを区別します。Host プロトコルは、プロンプトのバイトを調べることなく、これらのコードを独自のエラーエンベロープにマッピングします。

```ts type-equiv
/** Stable failure codes exposed to host adapters. */
type SessionReferenceErrorCode =
  | 'SESSION_REFERENCE_INVALID_CONFIG'
  | 'SESSION_REFERENCE_INVALID_REFERENCE'
  | 'SESSION_REFERENCE_SELF_REFERENCE'
  | 'SESSION_REFERENCE_TOO_MANY'
  | 'SESSION_REFERENCE_READ_FAILED'
  | 'SESSION_REFERENCE_BUDGET_EXCEEDED'
  | 'SESSION_REFERENCE_CANCELLED'
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`によってソースから生成されます（doc-sync 内で`pnpm run verify-cordis-catalog`により最新であることを検証します。再生成には`pnpm run gen-cordis-catalog`を使用します）。このセクションはページの両言語版でバイト単位で同一です。シグネチャブロックには`ts cordis-catalog`フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義されており、フレームワークから継承される`ctx` API は[cordis-api/inherited.md](../cordis-api/inherited.md)にあります。

<a id="ctxsessionreferenceresolver--sessionreferenceresolver"></a>

### `ctx.sessionReferenceResolver` — `SessionReferenceResolver`

不変なセッション間メッセージコンテキストを準備する、完全読み取りのコンシューマーです。

```ts cordis-catalog
/**
 * List reference candidates, ranked by working-directory affinity.
 * @param agent - target agent; self is excluded and its cwd drives ranking.
 * @param query - optional case-insensitive session-id/cwd/title substring.
 * @param limit - optional positive result cap.
 * @param signal - optional cancellation boundary for host autocomplete teardown.
 * @returns candidates labeled by latest title or, when absent, session id.
 */
async listCandidates( agent: Agent, query: string = '', limit: number = this.config.candidateLimit, signal?: AbortSignal, ): Promise<SessionReferenceCandidate[]>

/**
 * Snapshot all references before enqueue and return one aggregated durable context.
 * @param agent - target agent; references to it are rejected.
 * @param content - already host-normalized readable message content.
 * @param references - structured source sessions in mention order.
 * @param signal - optional cancellation boundary for host request teardown.
 * @returns detached content and optional referenced-session context.
 */
async prepare( agent: Agent, content: ContentBlock[], references: SessionReferenceInput[], signal?: AbortSignal, ): Promise<PreparedReferencedMessage>
```

型: [Agent](core.md) · [ContentBlock](llm-streaming.md)

出典: [`packages/context/session-reference/src/index.ts:70`](../../packages/context/session-reference/src/index.ts)
<!-- END GENERATED cordis-surface -->
