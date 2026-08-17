# ユーザー承認

[dsh-user-approval](../../packages/interaction/user-approval) のユーザー承認の抽象的な接点は、次の 1 つの問いに答えます。この特定のアクションを続行してよいでしょうか。これは、共有のリクエスト／結果の語彙、`ctx.approval` ディスパッチサービス、`approval/request` 回答者ウォーターフォール、ログ専用の監査ペア、およびセッションごとの `ask`/`never` ポリシーを所有します。UI チャネルは人間の回答者を提供できます。[ACP 自動化ブリッジ](../../packages/acp/acp)は、自身のエージェント向けに一回限りの機械的な決定を提供します。[dsh-tools](../../packages/core/tools) や [dsh-tool-bash](../../packages/shell/tool-bash) などの呼び出し元は、確定した結果を利用し、結果が `allowed-once` でない限りフェイルクローズします。

ソース： [`packages/interaction/user-approval/src/index.ts`](../../packages/interaction/user-approval/src/index.ts)

## 識別情報と結果

すべてのリクエストには、新しい `ApprovalRequestId` が割り当てられます。ブランドは、承認 ID をツール呼び出し ID やエージェント／セッション ID と交換可能にすることなく、`approval/asked` と `approval/decided` の監査イベントを対応付けます。

```ts type-equiv
/**
 * Pairs one `approval/asked` audit event with its `approval/decided`.
 * Service-issued (one fresh id per {@link ApprovalService.request} call).
 */
type ApprovalRequestId = Branded<'ApprovalRequestId'>
```

`ApprovalOutcome` は確定済みであり、フェイルクローズです。`allowed-once` は問い合わせ対象のアクションだけを許可します。呼び出し元は `rejected`、`cancelled`、および `unavailable` に対して拒否します。欠落している、所有権を持たない、例外を送出する、または仕様に適合しない回答者は、ゲートを開くのではなく `unavailable` になります。

```ts type-equiv
/**
 * Closed approval outcomes: a one-shot grant, explicit rejection, withdrawn
 * request, or unavailable answerer. Callers fail closed on `unavailable`.
 */
type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
```

## セッションごとのポリシー

`ApprovalPolicy` は、対話的な回答者が実行される前の動作を決定します。`ask` は合成された回答者チェーンに委譲し、その回答なし時の既定値は `unavailable` です。`never` は、回答者を一切ディスパッチせずに決定論的に `rejected` を返します。有効な値は、セッションログ内の最後の `approval/policy` イベントであり、サービス設定にフォールバックします。`setApprovalPolicy(session, policy)` は唯一の書き込み経路であるため、リプレイによってオーバーライドを再構築できます。

```ts type-equiv
/**
 * A session's approval policy — what happens to an {@link ApprovalService}
 * ask BEFORE any interactive answerer sees it:
 *
 * - `'ask'` (the default) — delegate to the composed answerers; with none
 *   composed the chain falls through to the fail-closed `'unavailable'`.
 * - `'never'` — never prompt anyone: every ask resolves `'rejected'`
 *   deterministically. The strict headless stance (CI, unattended runs) and
 *   the policy whose outcome is knowable without asking.
 */
type ApprovalPolicy = 'ask' | 'never'
```

どちらのポリシーも、キャッシュセーフなランタイムコンテキストスナップショットに現在の完全な意味を反映します。ソース付きの `user/message` は永続的でモデルから見える入力です。承認状態を変更すると、リクエストヘッダーのシステムプロンプトを書き換えることなく、保持された履歴の後に新しい完全なスナップショットが追加されます。

## 承認リクエスト

`ApprovalRequest` は、質問をルーティングおよび監査するのに十分な精度でエージェントとツールアクションを識別します。ツール引数は意図的に省略されます。回答者は、乖離しうる 2 つ目のコピーをレンダリングするのではなく、`callId` を介して、すでにストリーミングされたツール呼び出しにプロンプトを関連付けます。

```ts type-equiv
/**
 * Readonly same-process permission question. `callId` links to an already
 * presented tool call, so arguments are not duplicated here.
 */
interface ApprovalRequest {
  /**
   * The agent on whose behalf the question is asked. Routes the question (a
   * UI answerer only answers for agents it owns) and receives the audit
   * events on its session log.
   */
  readonly agent: Agent
  /** The tool the question is about (presentation and audit). */
  readonly toolName: string
  /**
   * The exact tool call being decided, when the asker has one — lets a UI
   * attach the prompt to the tool call it already streamed.
   */
  readonly callId?: CallId
  /** The asker's human-readable explanation of WHY it is asking. */
  readonly reason?: string
  /**
   * Aborting withdraws the question: the request settles `'cancelled'`
   * immediately and a late answer from a still-pending answerer is discarded.
   */
  readonly signal?: AbortSignal
}
```

## ディスパッチと監査

`ctx.approval.request(req)` では、リクエスト元のセッションがオープンなターン内にある必要があります。`approval/asked` を追加し、1 つの結果を取得して、対応する `approval/decided` を追加した後、その結果で解決します。`never` ポリシーは、ウォーターフォールディスパッチより前にサービス内部で適用されます。そのため、後から `prepend` で登録された回答者であっても、これを回避できません。回答者は、リクエストを所有する場合は結果を返し、委譲する場合は `next()` を呼び出します。最初の回答が唯一の決定スロットを占有します。

監査イベントはログ専用であり、モデルのトランスクリプトには入りません。モデルから見える動作は、呼び出し元が導出したツール結果と現在のランタイムコンテキストスナップショットです。サービスを破棄すると、そのコンテキストへの寄与は削除されます。回答者リスナーは、それぞれの所有プラグインに対して独立してエフェクトにバインドされます。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts` によりソースから生成されます（doc-sync では `pnpm run verify-cordis-catalog` によって最新であることを検証します。再生成するには `pnpm run gen-cordis-catalog` を使用してください）。このセクションは、ページの両言語版でバイト単位で同一です。シグネチャブロックは `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義され、フレームワークから継承された `ctx` API は [cordis-api/inherited.md](../cordis-api/inherited.md) にあります。

<a id="ctxapproval--approvalservice"></a>

### `ctx.approval` — `ApprovalService`

回答者の前にセッションポリシーを適用し、すべての問い合わせ／結果ペアをリクエスト元のセッションに記録する承認サービスです。ランタイムコンテキストスナップショットと切り替え通知を通じて、決定論的なポリシー変更をモデルに公開します。

```ts cordis-catalog
/**
 * Switch one live agent's policy and queue the transition for its next model
 * step. Session initialization uses {@link setApprovalPolicy} directly
 * because there is no previously visible policy to change.
 * @param agent - the live agent whose policy is changing.
 * @param policy - the new effective policy.
 */
setPolicy(agent: Agent, policy: ApprovalPolicy): void

/**
 * Ask the composed answerers to decide one readonly same-process request.
 * The service borrows the request, agent, session, and live signal directly.
 * The request requires an open turn because the audit pair must be enclosed
 * by the durable log's commit/replay boundary; an idle ask rejects before
 * appending anything. The answerer phase always produces an outcome: an
 * aborted signal yields `'cancelled'`, a missing or throwing answerer yields
 * `'unavailable'` (fail closed), and a rogue non-vocabulary return value is
 * normalized to `'unavailable'`. A failure that prevents either audit append
 * from committing still rejects because returning an unlogged decision would
 * violate the pair. Session contains post-commit observer failures, so an
 * authoritative append cannot reject the request or suppress its matching
 * audit event.
 * @param req - the pending decision (agent, tool identity, reason, signal).
 * @returns the closed outcome; `'allowed-once'` is the only grant.
 * @throws when no turn is open or either audit event fails before the session
 *   append commit point.
 */
async request(req: ApprovalRequest): Promise<ApprovalOutcome>

/**
 * Read the session override without applying the configured default.
 * @param session - session whose log supplies the override.
 * @returns the last logged policy, or `undefined` without one.
 */
overrideOf(session: Session): ApprovalPolicy | undefined
```

型: [Agent](core.md) · [Session](session.md)

ソース: [`packages/interaction/user-approval/src/index.ts:192`](../../packages/interaction/user-approval/src/index.ts)

<a id="approval-events"></a>

### `approval/*` イベント

<a id="approvalrequest--waterfall"></a>

#### `approval/request` — ウォーターフォール

合成された応答者に 1 つの判断を求めます。結果を返してリクエストを引き受けるか、`next()` を呼び出します。失敗時にはフェイルクローズドのデフォルトが適用されます。スコープでフィルタリングされたディスパッチ（`@deepseek-ai/dsh-scope`）では、エージェントスコープのリスナーはそのエージェントのみを受信します。

```ts cordis-catalog
/**
 * Ask composed answerers for one decision. Return an outcome to claim the
 * request or call `next()`; failure yields the fail-closed default.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @param req - the pending decision (agent, tool identity, reason, signal).
 * @mode waterfall
 */
'approval/request'(this: Scoped<ApprovalService>, req: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>
```

型: [Scoped](scope.md)

ソース: [`packages/interaction/user-approval/src/index.ts:30`](../../packages/interaction/user-approval/src/index.ts)
<!-- END GENERATED cordis-surface -->
