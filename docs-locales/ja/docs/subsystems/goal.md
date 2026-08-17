# 同一セッションの目標

イベントソーシングされた目標サービスとそのポリシーコンシューマーで共有される型です。[goal-domain Agent Note](../../.agents/notes/implemented/feature/2026-07-19-persisted-same-session-goal-domain.md) が永続化と有効化の決定を担います。このページでは、[`packages/goal/goal/src/types.ts`](../../packages/goal/goal/src/types.ts) の正確なフィールドとバリアントを記録します。

## 識別情報とライフサイクル

`GoalId` は[ブランド化された ID](core.md#branded-ids)です。呼び出し元は `GoalRef` を通じて 1 つの正確なリビジョンを変更します。受け入れられた永続的な変更ごとにリビジョンが増加します。

```ts type-equiv
/** Compare-and-set identity for one exact goal revision. */
interface GoalRef {
  /** Stable goal identity. */
  readonly id: GoalId
  /** Positive revision; every durable mutation increments it. */
  readonly revision: number
}
```

永続的なフェーズは、目標に何が起きたかを示します。プロセスローカルの有効化は、継続コンシューマーが別のラウンドを開始できるかどうかを別途示します。

```ts type-equiv
/** Durable continuation phase. Activation is process-local and separate. */
type GoalPhase =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'complete'
```

ブロックは、問題によって停止したことを表す唯一の永続的な状態です。そのポリシー所有の理由には、ルーティング用の安定した lower-kebab-case コードと、人間およびモデル向けの自由形式の説明が含まれます。

```ts type-equiv
/** Machine-routable and human-readable explanation for a blocked goal. */
interface GoalBlockReason {
  /** Stable lower-kebab-case classification chosen by the blocking policy. */
  readonly code: string
  /** Non-empty explanation shown to humans and models. */
  readonly message: string
}
```

```ts type-equiv
/** Full durable state written by every non-clear goal mutation. */
interface GoalSnapshot extends GoalRef {
  /** Human-requested completion objective. */
  readonly objective: string
  /** Durable lifecycle phase. */
  readonly phase: GoalPhase
  /** Present exactly while `phase` is `blocked`. */
  readonly blockedReason?: GoalBlockReason
  /** Total admitted goal-round cap. */
  readonly maxGoalRounds: number
}
```

```ts type-equiv
/** Current goal projection, including values derived from the session log. */
interface GoalView extends GoalSnapshot {
  /** Highest admitted round number for this goal. */
  readonly roundsStarted: number
  /** Epoch milliseconds of the create mutation. */
  readonly createdAt: number
  /** Epoch milliseconds of the latest mutation. */
  readonly updatedAt: number
  /** Process-local continuation eligibility; never persisted. */
  readonly activation: GoalActivation
}
```

## 永続的な変更

すべての変更は永続的な `goal/change` セッションイベントであり、そのペイロードは変更後の完全なスナップショットまたは明確な墓標のいずれかです。厳密な畳み込みと永続化されたプロジェクションは、これらのイベントからのみライフサイクル状態を導出します。受信トレイの変更は目標状態に影響しません。

```ts type-equiv
/** Full-snapshot goal mutation committed by a durable `goal/change` event. */
interface GoalSnapshotChangeMeta {
  readonly kind: 'goal/change'
  readonly version: 1
  readonly operation: Exclude<GoalOperation, 'clear'>
  readonly goal: GoalSnapshot
  readonly roundsStarted: number
  readonly createdAt: number
  readonly updatedAt: number
}
```

```ts type-equiv
/** Tombstone retained when the current goal is cleared. */
interface GoalClearChangeMeta {
  readonly kind: 'goal/change'
  readonly version: 1
  readonly operation: 'clear'
  readonly cleared: GoalRef
  readonly clearedAt: number
}
```

継続コンシューマーは、受理された各ユーザーメッセージターンに、正の連番ラウンド番号と現在のリビジョンを付与します。これらの受理された `user/message` イベントのみが `roundsStarted` を進めます。リプレイでは、非正のラウンド、欠番、古いリビジョン、停止済みフェーズ、および上限超過を拒否します。

```ts type-equiv
/** Message attribution for admitted continuation rounds. */
interface GoalMessageSource {
  readonly kind: 'goal'
  readonly goalId: GoalId
  readonly revision: number
  /** Positive admitted continuation round. */
  readonly round: number
}
```

## リクエストと通知

作成では、呼び出し元による省略とデプロイメントの選択を分離します。後者は `create()` が内部で解決します。編集は部分的な置換であり、ランタイムバリデーターでは少なくとも 1 つのフィールドが必要です。すべての変更通知には、受理された操作と正確なリビジョンが含まれます。クリアでは `goal` を省略します。

```ts type-equiv
/** Input whose omitted round cap is resolved by the service configuration. */
interface CreateGoalRequest {
  readonly objective: string
  readonly maxGoalRounds?: number
}
```

```ts type-equiv
/** Fields changed by an edit; at least one must be present. */
interface EditGoalRequest {
  readonly objective?: string
  readonly maxGoalRounds?: number
}
```

```ts type-equiv
/** Live notification after one durable goal mutation commits. */
interface GoalChanged {
  readonly operation: GoalOperation
  readonly ref: GoalRef
  /** Absent for a clear tombstone. */
  readonly goal?: GoalView
}
```

## サービスの動作

[`GoalService`](../../packages/goal/goal/src/index.ts) は作成時のデフォルトを解決し、永続的な `goal/change` イベントから厳密なリプレイを畳み込み、正確なライブエージェント識別情報と比較・設定による変更を強制し、内包された `goal/changed` 通知を発行します。パッケージの [README](../../packages/goal/goal/README.md) では、呼び出し可能な API とモデル可視の契約を定義しています。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts` によりソースから生成されます（doc-sync 内の `pnpm run verify-cordis-catalog` で最新性を検証し、`pnpm run gen-cordis-catalog` で再生成します）。このセクションは、ページの両言語側でバイト単位で同一です。シグネチャブロックでは `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義されており、フレームワークから継承される `ctx` API は[cordis-api/inherited.md](../cordis-api/inherited.md)にあります。

<a id="ctxgoals--goalservice"></a>

### `ctx.goals` — `GoalService`

所有するセッションログのみをバックエンドとする目標サービス（`ctx.goals`）。

```ts cordis-catalog
/**
 * Read the current goal for one exact live agent.
 * @param agent - owning live agent.
 * @returns a fresh view or `undefined` when no goal is current.
 * @throws {@link GoalError} when the agent is not the registry's live instance.
 */
get(agent: Agent): GoalView | undefined

/**
 * Remove process-local continuation authority without changing durable goal
 * phase or revision. Lifecycle owners use this before unloading a driver;
 * a later human-authorized {@link resume} records the new activation edge.
 * @param agent - owning live agent.
 * @returns a fresh disarmed view, or `undefined` when no goal is current.
 */
disarm(agent: Agent): GoalView | undefined

/**
 * Create and arm a goal. A completed goal may be replaced; every other
 * current phase must be cleared or resumed instead.
 * @param agent - owning live agent.
 * @param request - objective and optional round cap.
 * @returns the created live view.
 */
create(agent: Agent, request: CreateGoalRequest): GoalView

/**
 * Edit objective and/or round cap without changing phase.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @param request - at least one replacement field.
 * @returns the edited view.
 */
@Remote('edit') edit(agent: Agent, ref: GoalRef, request: EditGoalRequest): GoalView

/**
 * Pause an active goal and disarm automatic continuation.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @returns the paused view.
 */
@Remote('pause') pause(agent: Agent, ref: GoalRef): GoalView

/**
 * Resume and arm a stopped goal, or rearm an active goal after a
 * session-start edge, while its round budget still has capacity.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @returns the active view.
 */
@Remote('resume') resume(agent: Agent, ref: GoalRef): GoalView

/**
 * Mark a current non-complete goal complete and disarm it.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @returns the completed view.
 */
@Remote('complete') complete(agent: Agent, ref: GoalRef): GoalView

/**
 * Mark an active goal blocked and disarm it.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @param reason - policy-owned stable code and human-readable explanation.
 * @returns the blocked view with its durable reason.
 */
block(agent: Agent, ref: GoalRef, reason: GoalBlockReason): GoalView

/**
 * Clear the current goal while retaining a durable tombstone and history.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @returns the tombstone ref whose revision is one past the cleared snapshot.
 */
@Remote('clear') clear(agent: Agent, ref: GoalRef): GoalRef

/**
 * Create one Goal through the remote boundary.
 * @param agent - exact live Agent resolved from the wire identity.
 * @param request - objective and optional round cap.
 * @returns the created Goal identity.
 */
@Remote('create') remoteExportCreate(agent: Agent, request: CreateGoalRequest): CreateGoalResult
```

型: [Agent](core.md)

ソース: [`packages/goal/goal/src/index.ts:183`](../../packages/goal/goal/src/index.ts)

<a id="goal-events"></a>

### `goal/*` イベント

<a id="goalchanged--emit"></a>

#### `goal/changed` — 発行

1 つの稼働中のエージェントによる目標の変更が受け付けられました。対応する `goal/change` セッションイベントはすでにコミットされています。リスナーの失敗は封じ込められます。スコープでフィルタリングされたディスパッチ（`@deepseek-ai/dsh-scope`）では、エージェントスコープのリスナーはそのエージェントのみを受け取ります。

```ts cordis-catalog
/**
 * Goal mutation accepted by one live agent. The matching `goal/change`
 * session event has already committed. Listener failures are contained.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @param payload.agent - agent whose session owns the goal.
 * @param payload.change - fresh current projection or clear tombstone.
 * @mode emit
 */
'goal/changed'(this: import('@deepseek-ai/dsh-scope').Scoped<Agent>, payload: { agent: Agent; change: GoalChanged }): void
```

型: [Agent](core.md) · [Scoped](scope.md)

ソース: [`packages/goal/goal/src/domain.ts:114`](../../packages/goal/goal/src/domain.ts)
<!-- END GENERATED cordis-surface -->
