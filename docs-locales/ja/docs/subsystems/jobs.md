# バックグラウンドタスクランタイム

長時間実行されるプロデューサー、`ctx.jobs`、およびジョブ制御で共有される型です。設計は[ランタイム Agent Note](../../.agents/notes/implemented/architecture/2026-06-20-generic-long-running-tool-runtime.md)が管理します。このページには、[`packages/jobs/jobs/src/types.ts`](../../packages/jobs/jobs/src/types.ts)の正確なフィールドとバリアントを記載します。

## ID とステータス

`JobId`は、[ブランド付き ID](core.md#branded-ids)であり、`<kind>-N`として生成されます。アクセス制御は ID の秘匿性ではなく、所有者の認可に依存します。`JobKind`はマージ拡張可能なマップから導出されます。レジストリは kind を不透明な ID 名前空間として扱います。

```ts type-equiv
/**
 * Producer-defined job kinds. Plugins extend this map by declaration merging;
 * the registry treats every value as an opaque id namespace.
 */
interface JobKindMap {
  bash: 'bash'
  subagent: 'subagent'
}
```

`JobStatus`は`'running' | 'stopping' | 'completed' | 'killed' | 'failed'`です。プロデューサー固有の情報は`JobSnapshot.detail`に属します。

## プロデューサーの契約

`JobStart`は識別情報とスターターを宣言します。ランタイムは`run()`を呼び出す前に事前チェックを完了し、その後に失敗し得るステップなしでコミットします。プロデューサーは実行リソースを所有し、ランタイムは識別情報、アクセス、およびライフサイクル状態を所有します。

```ts type-equiv
/**
 * Producer declaration passed to {@link JobRegistry.start}. The runtime
 * preflights access and cleanup before invoking {@link run}; the producer owns
 * execution resources while the runtime owns identity and lifecycle state.
 */
interface JobStart {
  /** Producer kind — also the id prefix (`bash`, `subagent`, …). */
  kind: JobKind
  /** One-line model-facing label (the command; the delegation description). */
  label: string
  /**
   * Optional UTF-8 byte cap for each complete model-facing completion notice or
   * output read, including controller status metadata.
   */
  outputLimitBytes?: number
  /**
   * Owning live agent. Access is fenced by its session id, and agent disposal
   * cancels and awaits the job. The instance must be the one currently
   * registered under its agent id. Omitting the owner creates an unowned job,
   * open to any caller until service disposal.
   */
  owner?: Agent
  /**
   * Start the work after preflight and synchronously return its hooks. Called
   * once; a throw leaves nothing registered, and the producer must clean up any
   * partially started resources.
   */
  run(): JobHooks
}
```

`JobHooks.done`は、単に作業が完了した時点ではなく、プロデューサーがリソースを解放した後に解決します。オプションの`readOutput`は、ストリームを消費するジョブと最終出力のみのジョブを区別します。

```ts type-equiv
/** Hooks through which the runtime controls and observes producer work. */
interface JobHooks {
  /**
   * Request termination. Must be synchronous, idempotent, and eventually settle
   * {@link done}; throws propagate. The optional reason is forwarded verbatim.
   */
  cancel(reason?: string): void
  /**
   * Resolves after the producer releases its resources, not merely when work
   * finishes. Must not reject; the runtime converts a rejection to `failed`.
   * If teardown cancellation throws, the runtime may force-fail only the
   * registry record without claiming that the work stopped.
   */
  done: Promise<JobOutcome>
  /**
   * Consume output produced since the previous call. The producer formats
   * truncation and spill notices. Absence marks a final-output-only job; each
   * job has one consuming cursor.
   */
  readOutput?(): string
}
```

```ts type-equiv
/** Terminal result supplied by a producer through {@link JobHooks.done}. */
interface JobOutcome {
  /** How the job ended: finished (`completed`), cancelled (`killed`), or broke (`failed`). */
  status: 'completed' | 'killed' | 'failed'
  /** Kind-specific detail rendered into status lines ('exit code: 3', 'max-tokens'). */
  detail?: string
  /** Final output for jobs without `readOutput`; stream jobs leave it unset. */
  output?: string
}
```

## コンシューマービュー

スナップショットは常に最新の読み取り専用プロジェクションです。`ownerSession`は認可に使用する共有の`SessionId`を保持します。完了リスナーには、ライフサイクルのクリーンアップに使用した正確な所有者オブジェクトが個別に渡されます。`reported`は、別のレポーターが終端状態を配信済みであるか、配信を確約している場合に、完了通知を抑制します。これには、所有者またはサービスをドレインする teardown cancel も含まれます。

```ts type-equiv
/**
 * A read-only projection of one job, safe to hand to listeners and tools —
 * a fresh object per call, never live registry state.
 */
interface JobSnapshot {
  /** The registry-issued id (`<kind>-N`). */
  id: JobId
  /** The producer kind the job was registered with. */
  kind: JobKind
  /** The producer-supplied one-line label. */
  label: string
  /** Producer-owned cap for complete model-facing notices and output reads. */
  outputLimitBytes?: number
  /**
   * Owner session id used for authorization and correlation; absent for
   * unowned jobs. Completion listeners receive the exact {@link Agent}
   * separately through {@link JobDoneListener}.
   */
  ownerSession?: SessionId
  /** Current lifecycle state. */
  status: JobStatus
  /** Kind-specific status detail, present once the producer supplied one (usually terminal). */
  detail?: string
  /** Epoch ms when the job was registered. */
  startedAt: number
  /** Epoch ms when the job settled; absent while `running`/`stopping`. */
  finishedAt?: number
  /**
   * True when a kill, read, wait, or teardown cancel has reported or committed
   * to report the terminal state. Completion reporters suppress redundant
   * notices when set. Teardown claims it because the owner or service being
   * destroyed leaves no reader: a reporter that opens a turn on notice would
   * otherwise spend a model request per teardown layer.
   */
  reported: boolean
}
```

```ts type-equiv
/** Output and post-read state returned by {@link JobRegistry.read}. */
interface JobRead {
  /**
   * Stream kinds: the consuming delta since the previous read. Final-output
   * kinds: empty while live, the terminal {@link JobOutcome.output} (or
   * empty) once settled — idempotent, never consumed.
   */
  text: string
  /** The job's state at read time. */
  snapshot: JobSnapshot
}
```

## サービスの動作

抽象[`JobRegistry`](../../packages/jobs/jobs/src/index.ts)サービス定義は、原子的な`start`、呼び出し元スコープの`get`と`list`、`read`、`kill`、上限付きの`wait`、障害が分離された`onJobDone`および`onJobsChanged`リスナー、ならびに`attachController`が利用可能になるタイミングを規定します。[`LocalJobRegistry`](../../packages/jobs/jobs-local/src/index.ts)はプロセスローカルのサービスプロバイダーです。認可では所有者セッションを比較し、所有者のクリーンアップと受け入れには、登録された正確な`Agent`インスタンスを使用します。ローカルプロバイダーの正の安全な整数である`maxConcurrentJobsPerOwner`設定のデフォルトは`10`です。正確な所有者ごとに`running`と`stopping`レコードを数え、所有者のないジョブには 1 つの共有バケットを使用します。終端プロデューサーの解決により容量が解放されます。サービス定義の契約については[`dsh-jobs`](../../packages/jobs/jobs/README.md)、レジストリのライフサイクルと受け入れポリシーについては[`dsh-jobs-local`](../../packages/jobs/jobs-local/README.md)、モデル向けコンシューマーについては[`dsh-tool-jobs`](../../packages/jobs/tool-jobs/README.md)を参照してください。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`によってソースから生成されます（doc-sync で`pnpm run verify-cordis-catalog`により最新であることを検証し、`pnpm run gen-cordis-catalog`で再生成します）。このセクションはページの両言語版でバイト単位で同一です。シグネチャブロックには`ts cordis-catalog`フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義されています。フレームワークから継承される`ctx` API は、[cordis-api/inherited.md](../cordis-api/inherited.md)にあります。

<a id="ctxjobs--jobregistry-abstract-seam"></a>

### `ctx.jobs` — `JobRegistry`（抽象的な接合部）

抽象的なバックグラウンドジョブレジストリです。サブクラス化して抽象メソッドを実装し、そのサブクラスをプラグインとして読み込むと、`ctx.jobs` として登録されます（コンテキストごとに実装は 1 つです。2 つ目を読み込むと例外がスローされます。これは cordis の標準的な重複サービス動作です）。

実装は次のセマンティクスに従う必要があります。

- 登録はプロデューサーおよびコントローラーファイバーより長く存続します。所有者とサービスの破棄により実行中の作業はキャンセルされ、準拠するプロデューサーの完了が待機されます。破棄時のキャンセルで例外がスローされた場合、強制的に失敗するのはそのレコードだけです。所有者が破棄されるレコードには読み手が残っていないため、破棄時のキャンセルではそのレコードも報告済みとしてマークされます。
- 所有ジョブへのアクセスは、所有者のセッション ID によって制限されます。ID は予測可能であるため、境界となるのは秘匿性ではなく認可です。
- 決着は先着優先です。遅延したプロデューサーの結果に対しても、終端レコードは 1 つだけであり、待機者を解放し、リスナー通知は隔離された 1 ラウンドのみ行われます。レポーターが同期的にモデルターンを開く可能性があるため、完了はレコードがコミットされ、決着を監視する他のすべてのオブザーバーがそれを確認した後、最後に通知されます。
- spec の所有者に対応する、接続済みのジョブコントローラーが存在しない場合、start は作業を拒否します。これにより、所有者が収集も停止もできない作業をプロデューサーが開始することを防ぎます。1 つのレジストリがプロセス内のすべてのコンポジションを処理するため、この判定と完了リスナーの配信はプロセス全体ではなく所有者に相対的です。スコープなしのコンテキストから行った登録はすべての所有者に対応し、エージェントコンポジションのスコープ内で行った登録は、そのスコープ配下でコンポーズされたエージェントにのみ対応します。

```ts cordis-catalog
/**
 * Preflight access, validation, owner cleanup, and implementation-owned
 * admission before starting and atomically registering work. Any preflight
 * rejection leaves no job id or execution resource. A throwing starter
 * leaves nothing registered; after it returns, registration cannot fail.
 * Settlement records the outcome, notifies listeners, and releases waiters.
 * @param spec - job identity, owner, and synchronous starter.
 * @returns the registry-issued `<kind>-N` id.
 */
abstract start(spec: JobStart): JobId

/**
 * List caller-owned and unowned jobs in registration order without exposing
 * another session's labels.
 * @param caller - reading agent; a non-agent caller sees only unowned jobs.
 * @returns fresh snapshots.
 */
abstract list(caller?: Agent): JobSnapshot[]

/**
 * Return a non-consuming snapshot without changing its read cursor or notice
 * state. Throws for an unknown or foreign job.
 * @param id - job to look up.
 * @param caller - reading agent checked against the owner.
 * @returns a fresh snapshot.
 */
abstract get(id: JobId, caller?: Agent): JobSnapshot

/**
 * Read the next stream delta, or the idempotent final output after settlement.
 * A terminal read marks the job reported. Throws for an unknown or foreign
 * job.
 * @param id - job to read.
 * @param caller - reading agent checked against the owner.
 * @returns output text and the post-read snapshot.
 */
abstract read(id: JobId, caller?: Agent): JobRead

/**
 * Request cancellation, then mark the job stopping and reported. A producer
 * throw propagates without changing job state. Throws for an unknown or
 * foreign job.
 * @param id - job to cancel.
 * @param caller - killing agent checked against the owner.
 * @param reason - logged reason forwarded to the producer.
 * @returns `requested` for live work, otherwise `already-finished`.
 */
abstract kill(id: JobId, caller?: Agent, reason?: string): 'requested' | 'already-finished'

/**
 * Wait for settlement or timeout without cancelling the job. Caller abort
 * rejects only while the job is live; after settlement the terminal
 * snapshot wins so a notice suppressed for this waiter is still delivered.
 * Throws for invalid, unknown, or foreign input.
 * @param id - job to wait for.
 * @param timeoutMs - positive finite wait bound in milliseconds.
 * @param caller - waiting agent checked against the owner.
 * @param signal - optional cancellation of the wait itself.
 * @returns snapshot at settlement or timeout.
 */
abstract wait(id: JobId, timeoutMs: number, caller?: Agent, signal?: AbortSignal): Promise<JobSnapshot>

/**
 * Register an effect-scoped completion listener. It receives the settlements
 * of the owners its registering context's scope covers; each listener is
 * contained; returned promises are observed but not awaited. No listener runs
 * after service disposal.
 * @param listener - receives each terminal snapshot and its exact owner.
 * @returns disposer that unregisters the listener.
 */
abstract onJobDone(listener: JobDoneListener): () => void

/**
/**
 * Register an effect-scoped observer of visible-set changes. It fires after
 * every commit that changes what {@link list} returns for that owner —
 * registration, every stopping transition (including the one teardown
 * performs before it awaits a slow producer), settlement, owner-disposal
 * removal, and the emptying that service disposal commits — so an observer
 * re-reads rather than accumulating deltas.
 *
 * Delivery is owner-relative on the same terms as {@link onJobDone}: an
 * observer registered from an unscoped context — a host composition's own
 * carrier — sees every owner, while one registered under an agent
 * composition's scope sees exactly the agents composed under it.
 *
 * This is not a superset of {@link onJobDone}: that one delivers the terminal
 * record under first-wins semantics a job controller couples to notice
 * delivery, while this one carries no delivery meaning and marks nothing
 * reported. Listeners are contained and never awaited.
 * @param listener - receives the owner whose visible set changed, or
 *   `undefined` when an unowned job changed and every caller's set did.
 * @returns disposer that unregisters the listener.
 */
abstract onJobsChanged(listener: JobsChangedListener): () => void

/**
 * Attach an effect-scoped controller that can read and stop jobs. It serves the
 * owners its registering context's scope covers, and {@link start} refuses an
 * owner no attached controller serves.
 * @param name - diagnostic label; duplicate names remain independent.
 * @returns disposer that detaches this controller.
 */
abstract attachController(name: string): () => void
```

型: [Agent](core.md)

ソース: [`packages/jobs/jobs/src/index.ts:62`](../../packages/jobs/jobs/src/index.ts)
<!-- END GENERATED cordis-surface -->
