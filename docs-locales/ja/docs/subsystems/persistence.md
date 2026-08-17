# セッションの永続化

イベントログの**耐久性の境界** です。[session.md](session.md) では、メモリ内の`Session`、つまり信頼できる唯一の情報源である追記専用の`SessionEvent` ログについて説明します。このページでは、そのログを永続化する方法、すなわち抽象`SessionPersistence`サービス、そのバックエンド、フラッシュのチェックポイント、クラッシュ復旧、およびログとともに扱われるメタデータヘッダーについて説明します。ログが保持するイベント語彙は、生成された[永続化ログイベントカタログ](../persistence-catalog.md)でメンバーごとに列挙されています。

この境界は[機能の境界](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)です。1 つの抽象サービス（[dsh-session-persistence](../../packages/session/session-persistence)、`ctx.sessionPersistence`）がlocate/create/append、再利用可能な Session の準備、論理的な読み込みと検査、物理的なサフィックス読み取り、および既存の`SessionEvent`に対する軽量な一覧・スナップショット観測を定義します。**並行する永続化イベント型はありません** 。同じ契約を実装する交換可能な 2 つのバックエンドがあります。[session-persistence Agent Note](../../.agents/notes/implemented/architecture/2026-06-14-session-persistence.md)を参照してください。

## フラッシュのチェックポイント

`session/event` は*同期的な* 通知です。永続化プラグインは、プロデューサーをブロックせずにイベントをセッションごとのコントローラーへコピーします。最初の保留中イベントが固定のバッチ処理ウィンドウを開始し、後続のイベントは期限をリセットせずに参加します。期限切れにより 1 つの永続バッチが開始されます。その書き込み中に受け入れられたイベントには独自の期限が与えられ、後続バッチを形成します。`session/flush` は待機を取り消し、静止状態になるまで排出します。そのため、ループは次の通常ターンを要求する前の順序付けおよびエラー観測のチェックポイントとして引き続きこれを使用します。バックグラウンド書き込みが拒否されるとイベントは保持され、自動再試行は停止します。新しいイベントは新しいウィンドウを開始し、明示的なフラッシュは即座に再試行して、失敗を`agent/error`とロガーを通じて報告します。閉じたターンを越えたセッションイベントとして報告されることはありません。破棄時にも同じ最終排出が実行されます。設定された最大値は、意図的なバッチ処理の待機時間のみを制限し、イベントループのスケジューリングやバックエンドの耐久化レイテンシは制限しません（[判断](../../.agents/notes/implemented/architecture/2026-08-08-bounded-session-persistence-write-batching.md)）。

## クラッシュ復旧で中断されたターンを保持する

ターンの途中でクラッシュしたログを再読み込みするバックエンドは、`turn/start`が開いたままで`turn/end`がない状態を検出します。**切り詰めません** 。長期タスクでは 1 つのターンが非常に大きくなる可能性があり（多数のステップ、大量のツール出力）、これらのイベントはクラッシュ前に永続的に追記されていました。代わりに、合成`turn/end { reason: { kind: 'interrupted' } }`で孤立したターンを閉じ、中断された実行の整合性を保ちながら、その前後にある独立したイベントを変更しません。`interrupted` は、どのループも出力しない唯一の`TurnEndReason`です（[session.md](session.md#why-a-turn-ended-turnendreasonmap)を参照してください）。

修復はコールドセッションにのみ適用されます。ライブ ID の場合、`SessionPersistence.load(id)` は信頼できるメモリ内スナップショットが永続化されるまで待機し、バランスが取れている場合にのみ返します。開いているライブターンは、合成中断境界を受け取るのではなく拒否されます。HMR は、アクティブなターンを閉じずにライブプレフィックスを引き継ぎます。

`SessionPersistence.inspect(id)` は、公開も復旧の書き込みも行わずに、不変の論理 Session を構築します。コールド検査では、破損した物理テールをそのまま残しつつ、メモリ内で中断されたターンのバランスを取ります。すでにライブである Session の検査では、現在の不変スナップショットを借用するため、開いたターンを含む場合があります。コーディネーターを基盤とする実装は、正確なコールドかつ未公開の Session を上限付き LRU に保持するため、繰り返される履歴読み取りと後続の`prepare(id)`は、1 回の読み取り、展開、検証、フリーズ、および Session 構築を共有します。`prepare(id)` は Session を予約し、保留中の修復をコミットして、破棄可能な公開ハンドルを返します。`load(id)` は同じ仕組みを使用して、公開せずに修復をコミットします。このライフサイクルは[Session 準備の判断](../../.agents/notes/implemented/architecture/2026-08-05-session-preparation.md)が管理します。

## `SessionLocation` — 任意のセッション単位アーティファクトターゲット

`SessionPersistence.locate(meta)` は、読み取り、作成、フラッシュを行わずに、バックエンドが所有する独立したアーティファクトを同期的に解決します。JSONL はプロジェクト／セッションディレクトリ内の絶対トランスクリプトパスを返します。セッションは 1 つのデータベースを共有するため、SQLite は`undefined`を返します。したがって、返されたパスは、まだ存在しないファイルや、現在の未フラッシュターンを含まないファイルを指す場合があります。これは場所のヒントであり、認可や最新性の保証ではありません。

```ts type-equiv
/**
 * A backend-resolved, per-session local artifact location. The path is an
 * absolute target path and can name an artifact that has not materialized yet.
 * Consumers must treat it as a location hint, never as an authorization token.
 */
interface SessionLocation {
  /** Backend-specific artifact kind, for example `jsonl`. */
  readonly kind: string
  /** Absolute path to this session's backend-owned artifact. */
  readonly path: string
}
```

<a id="sessionheader--metadata-beside-the-log"></a>

## `SessionHeader` — ログに付随するメタデータ

セッションごとのメタデータは、イベントログとは**別に** 扱われます。フォーマットバージョン、cwd、系統、およびシード境界は会話イベントではなくストレージ上の関心事であるため、`SessionEventMap`には含まれず、`deriveMessages()`に到達することもありません。ヘッダーは`session.header`を介して`Session`に関連付けられます。

出典: [`packages/core/session/src/types.ts`](../../packages/core/session/src/types.ts)

```ts type-equiv
/**
 * Immutable validated storage metadata, kept outside the conversation event log.
 */
interface SessionHeader {
  /**
   * On-disk format version, stamped from {@link SESSION_FORMAT_VERSION} when the
   * session is created. A persistence backend rejects any other version on load
   * (no migration — see the constant).
   */
  readonly version: number
  /** The session's id (mirrors the {@link Session}'s id). */
  readonly id: SessionId
  /** Non-negative safe-integer Unix epoch milliseconds when the session was created. */
  readonly createdAt: number
  /** Absolute working directory the session was created in (if any). */
  readonly cwd?: string
  /** The session this one was forked from (seed lineage), if any. */
  readonly parentSession?: SessionId
  /**
   * How many leading events were inherited through a seed. Persisting this
   * boundary lets resume and replay distinguish parent history from child work.
   */
  readonly seedLength?: number
  /**
   * Coarse product classification for a session created as a subagent child.
   * This is presentation metadata, not proof that the child is continuable.
   */
  readonly origin?: 'subagent'
  /**
   * Delegation depth: absent (zero) for a top-level session, parent depth + 1
   * for a subagent child. Persisted so a recursion budget survives restart and
   * resume — a runtime-only depth would reset a resumed child to top-level.
   */
  readonly delegationDepth?: number
  /**
   * Id of the agent preset this session's agent was composed from, when the
   * deployment composes per session. Durable because the preset decides the
   * session's tools and prompt: a resume that restored a different composition
   * would replay history the model can no longer act on.
   */
  readonly agentPreset?: string
}
```

## フォーマットの拒否 — ビルドが忠実に読み取れないログ

バックエンドは、破損していないため `SessionPersistenceCorruptionError` とは異なり、`SessionFormatUnsupportedError` で忠実に解釈できないログを拒否します。`SESSION_FORMAT_VERSION` より前にあるヘッダーの `version` は方向性（「より新しい harness によって書き込まれています。開くには harness をアップグレードしてください」）を示し、後ろにあるものは、このビルドにアップグレード経路がないことを示します。旧来の形式を正規化した後、このビルドで生成された語彙に含まれないイベント型（`gen-persistence-catalog` によって発行される `KNOWN_SESSION_EVENT_TYPES`）も、イベントのエンベロープに `ignorable: true` が含まれていない限り、同じように拒否されます。認識されない必須イベントを黙ってスキップすると、ログの残りの読み方が変わる可能性があるためです。バックエンドがセッションごとに 1 つのアーティファクトを保持する場合、メッセージには生のログパスが追加されるため、拒否されたテキストにも到達できます。JSONL バックエンドは、現在のヘッダー形式を検証したりイベント行をデコードしたりする前に、生のヘッダー行から外部バージョンを拒否します。構造的に異なる将来の形式でも、常にアップグレードの方向性を報告し、「破損」とは報告しません。SQLite はまず独自の `SCHEMA_VERSION` pragma を通じてファイル全体の構造を検査します。設計の根拠と延期されたアップグレーダーチェーンについては、[セッションログのバージョン管理メカニズムに関する注記](../../.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md)を参照してください。

## `CreateSessionOptions` — シードとメタデータ

ストアを通じて `Session` を作成するには、`seed`（初期リプレイまたは fork 履歴）と `meta`（ストアが `SessionHeader` に統合するストレージ層のフィールド）が必要です。ストアは `version`/`id` を設定し、`createdAt` をデフォルトにします。呼び出し元は、検証済みの絶対 `cwd`、`parentSession` の系統、`seedLength` のシード境界、任意の大まかな `origin`、`delegationDepth`、エージェントが構成された元となる `agentPreset`、および既存の `createdAt` を指定できます。`origin: 'subagent'` により、プロダクトのナビゲーションでは重複する子行を非表示にできますが、記述子が有効であることや子が再開できることを証明するものではありません。

```ts type-equiv
/**
 * Options for creating a {@link Session} via the store. `seed` replays/forks
 * an existing event log; `meta` carries the caller-supplied storage fields the
 * store folds into a {@link SessionHeader}.
 */
interface CreateSessionOptions {
  /** Initial replay or fork history supplied at construction. */
  readonly seed?: readonly SessionEvent[]
  /**
   * Storage metadata read once before publication. `seedLength` is explicit
   * because a resumed seed contains the full stored log, not only its inherited prefix.
   */
  readonly meta?: {
    readonly cwd?: string
    readonly parentSession?: SessionId
    readonly createdAt?: number
    readonly seedLength?: number
    readonly origin?: 'subagent'
    readonly delegationDepth?: number
    readonly agentPreset?: string
  }
}
```

したがって、リプレイ/fork は `ctx.sessions.create(id, { seed: seedEvents })` です。*永続化された* セッションをライブエージェントに再開することは `ctx.agents.resume({ resumeSessionId })` です。

## `SessionRawArtifact` — 保存されたアーティファクトの原文テキスト

1 つのセッションに対するバックエンド自身のアーティファクトテキストであり、永続的に書き込まれた内容とバイト単位で同一です（物理エンコーディングからデコードされます）。`readRaw` は解析済みイベントから再構築せずにこれを返すため、バックエンド固有のシリアル化（チャンクのパッキング、キー順、改行）が維持されます。コンシューマーはまず `supportsRawArtifacts` を確認します。`false` はバックエンドがこの機能を提供しないこと（例: SQLite）を意味し、`readRaw(...) === undefined` はサポートされるバックエンドにそのセッション用の実体化済みアーティファクトがないことを意味します。

```ts type-equiv
/** A backend's own raw artifact text for one session, verbatim. */
interface SessionRawArtifact {
  /** The session header parsed from the artifact's own first line. */
  readonly meta: SessionHeader
  /** The artifact's base filename on disk, without any physical encoding suffix. */
  readonly filename: string
  /** The artifact's full text content, decoded from the backend's physical encoding. */
  readonly content: string
}
```

## 準備と復元の所有権

`SessionStore.prepare()` は通常の作成オプション、または `RestoredSessionOptions` を介して転送された新しい永続化グラフを受け入れます。復元ブランチは転送されたヘッダーとイベントをその場で検証して固定するため、呼び出し元は可変のエイリアスを保持してはなりません。`SessionPreparation` は公開またはロールバックまで、正確にその未公開 Session を所有します。破棄は同期的かつ冪等です。永続化の検査で公開されるのは `SessionInspection` のみであり、同じ準備済み Session から借用した不変の論理ビューです。

```ts type-equiv
/**
 * Fresh storage values transferred to {@link SessionStore.prepare} without a
 * second serialization copy. Callers retain no mutable aliases.
 */
interface RestoredSessionOptions {
  /** Fresh detached storage events to validate and freeze in place. */
  readonly seed: SessionEvent[]
  /** Fresh detached storage metadata to validate and freeze in place. */
  readonly meta: SessionHeader
  /** Select the persistence ownership-transfer path. */
  readonly seedSource: 'persistence'
}
```

```ts type-equiv
/** Inputs accepted while constructing an unpublished Session. */
type PrepareSessionOptions =
  | (CreateSessionOptions & { readonly seedSource?: undefined })
  | RestoredSessionOptions
```

```ts type-equiv
/** Options for a preparation whose provider retains unpublished state. */
interface SessionPreparationOptions {
  /** Release provider-owned state when the Session was not published. */
  readonly release?: () => void
}
```

```ts public-api
/**
 * One exact unpublished Session and the provider state that keeps it usable.
 * Disposal is synchronous and idempotent. Providers decide whether release
 * returns the Session to a cache or discards it; publication may consume that
 * state before disposal, making the callback a no-op.
 */
declare class SessionPreparation implements Disposable {
  /** The exact Session to use for setup and publication. */
  readonly session: Session;
  /**
   * Wrap an unpublished Session in one preparation lifetime.
   * @param session - exact unpublished Session.
   * @param options - optional provider release behavior.
   * @returns a preparation disposed after publication or rollback.
   */
  static create(session: Session, options?: SessionPreparationOptions): SessionPreparation;
  /** Release provider state once when this preparation leaves its caller. */
  [Symbol.dispose](): void;
}
```

```ts type-equiv
/** Immutable logical session prepared from persistence or a live owner. */
interface SessionInspection {
  /** Validated immutable session metadata. */
  readonly meta: SessionHeader
  /** Validated contiguous logical event log. */
  readonly events: readonly SessionEvent[]
}
```

## 軽量なソース改訂

派生状態のコンシューマーは、完全なイベントログを読み込む前に、低コストの不透明な改訂を比較します。永続化バックエンドがその表現を所有し、追加または変更を伴うロード修復とともにトランザクション的に変更します。呼び出し元は等価性の比較にのみ使用します。

```ts type-equiv
/**
 * Backend-owned token that identifies both one storage source and one revision
 * of a persisted session log.
 */
type SessionPersistenceRevision = Branded<'SessionPersistenceRevision'>
```

```ts type-equiv
/** Lightweight immutable source identity returned without loading a full log. */
interface SessionPersistenceSnapshot {
  /** Detached metadata for one materialized session. */
  header: SessionHeader
  /** Opaque source-qualified token that changes whenever this stored log changes. */
  revision: SessionPersistenceRevision
}
```

## バックエンド

どちらも同じ抽象 `SessionPersistence`（`SessionEvent` 上の locate/create/append/prepare/load/inspect/readFrom/list/listSnapshots。観測メソッドでは任意でキャンセル可能）を実装し、共通の `runPersistenceContract` スイートに合格します:

- **[dsh-session-persistence-jsonl](../../packages/session/session-persistence-jsonl)** — セッションごとの追記専用論理 JSONL ログです。既定ではチェックサム付きで連結された Zstandard フレームとして保存され、設定により生の行として保存することもできます。クラッシュセーフなアトミック書き込み、中断されたターンの復旧、読み取り／再生パスを備えます。
- **[dsh-session-persistence-sqlite](../../packages/session/session-persistence-sqlite)** — `node:sqlite`、`SessionEvent` ごとに 1 行です。行フィールドの `(session_id, seq, type, time, data, source_event_seqs, surface_op)` は、任意の表層メタデータを含めてイベントに 1:1 で対応するため、同期を保つべき並列の永続化スキーマはありません。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts` によりソースから生成されます（doc-sync では `pnpm run verify-cordis-catalog` により最新性が検証されます。再生成には `pnpm run gen-cordis-catalog` を使用します）。このセクションは、ページの両言語版でバイト単位で同一です。シグネチャブロックには `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは [入門](../cordis-primer.md#dispatch-modes) で定義されており、フレームワークから継承される `ctx` API は [cordis-api/inherited.md](../cordis-api/inherited.md) にあります。

<a id="ctxsessionpersistence--sessionpersistence-abstract-seam"></a>

### `ctx.sessionPersistence` — `SessionPersistence`（抽象化の継ぎ目）

耐久性のある追記専用セッションストレージです。実装は連続した、損失なく JSON シリアライズ可能なイベントを保持します。append は永続化が完了した後にのみ解決され、load はコミット済みイベントを書き換えることなく、中断された完全な末尾を処理します。

```ts cordis-catalog
/**
 * Resolve this backend's independent local artifact for a session without
 * reading, creating, flushing, or otherwise materializing it. Backends such
 * as SQLite that do not own one artifact per session return `undefined`.
 * @param meta - the immutable session header whose artifact is requested.
 * @returns the backend-specific absolute location, when one exists.
 */
abstract locate(meta: SessionHeader): SessionLocation | undefined

/**
 * Read a session's backend-owned artifact text verbatim — the exact durable
 * bytes the backend wrote (decoded from its physical encoding, e.g. a
 * decompressed JSONL). The returned `content` is the raw text, not a
 * reconstruction from parsed events, so it preserves backend-specific
 * serialization (chunk packing, key order, line breaks). Callers first test
 * {@link supportsRawArtifacts}; `undefined` then means only that the requested
 * session has no materialized artifact.
 * @param _id - the persisted session to read (unused by the default: no
 * per-session artifact).
 * @param signal - optional cancellation for backend read work.
 * @returns the raw artifact plus its parsed header, or `undefined` when the
 * session is absent.
 * @throws when this backend does not expose per-session raw artifacts.
 */
readRaw(_id: SessionId, signal?: AbortSignal): Promise<SessionRawArtifact | undefined>

/**
 * Register a new session's metadata. A backend MAY defer the physical write
 * until the first {@link append} (lazy materialization), in which case a
 * created-but-never-appended session is absent from {@link list}
 * — abandoned sessions leave nothing behind.
 * @param meta - the immutable header (id, version, cwd, lineage) to record.
 */
abstract create(meta: SessionHeader): Promise<void>

/**
 * Durably persist a batch of events. Honors the append-only and contiguous-
 * seq contracts: the first event's `seq` MUST equal the stored next-seq
 * (after `load` has durably closed any interrupted turn). Rejects non-JSON-
 * serializable `event.data` with an error naming the offending event type.
 * @param id - the session the batch belongs to.
 * @param events - the contiguous batch to persist, in seq order.
 */
abstract append(id: SessionId, events: readonly SessionEvent[]): Promise<void>

/**
 * Prepare the exact unpublished Session used by resume. Implementations may
 * reuse object graphs retained by an earlier {@link inspect} after confirming
 * their durable revision is still current; disposal releases an unpublished
 * reservation. Revision retries require the durable log to remain unchanged
 * for one read/check round trip; continuous external writers may delay completion.
 * @param id - persisted session to prepare.
 * @param signal - optional cancellation for preparation work.
 * @returns one owned unpublished Session preparation.
 */
async prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation>

/**
 * Load an immutable balanced logical view and commit any required cold
 * recovery. A complete interrupted final turn is preserved and durably
 * closed with missing tool errors plus any open step and turn boundaries;
 * only a torn final record is discarded. Unknown versions and corruption in
 * the committed prefix reject. Implementations MUST NOT crash-repair an
 * identity still bound to a live Session: a balanced live log may return as a
 * durable snapshot, while an open live turn rejects. Returned values may be
 * shared with immutable live or prepared state and must not be mutated.
 * Revision-based implementations may wait for one stable read/check round trip.
 * @param id - the persisted session to reload.
 * @returns the header and a log ending on a balanced `turn/end`.
 */
abstract load(id: SessionId): Promise<SessionInspection>

/**
 * Inspect an immutable logical session without committing recovery or
 * publishing it. A cold complete interrupted turn receives synthetic closers
 * in memory and a torn physical tail remains untouched. An already-live
 * Session instead yields its current immutable snapshot, which may contain an
 * open turn and its `session/end-seed` boundary. Coordinator-backed
 * implementations retain the exact cold unpublished Session for bounded
 * reuse by a later {@link prepare}. A stale ready source is reloaded; a source
 * already committing or reserved for resume remains exclusive, and inspection
 * may borrow its immutable view. Callers borrow only the immutable header and
 * log. Continuous external writers may delay revision convergence.
 * @param id - the persisted session to inspect.
 * @param signal - optional cancellation for queued and backend read work.
 * @returns the validated header and current logical event log.
 */
abstract inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection>

/**
 * Read the stored events from `fromSeq` onward — the read-from-seq
 * primitive for read models that resume from a watermark (e.g. a persisted
 * projection cache folding only the tail past its checkpoint). Unlike
 * {@link inspect}, it is a detached physical suffix read: no preparation
 * cache, torn-tail truncation, synthetic closers, or coordinator-state
 * publication. Only events from the valid contiguous stored prefix are
 * returned, so a torn fragment never reaches the caller. `fromSeq` at or
 * beyond the stored prefix returns an empty event list (never an error).
 * Backends whose medium can seek by seq
 * (SQLite) read only the suffix; sequential media (JSONL, both encodings)
 * still parse the whole artifact and skip forward — the primitive bounds
 * what is RETURNED and refolded, not every backend's physical read.
 * @param id - the persisted session to read.
 * @param fromSeq - first event seq to include; a non-negative safe integer.
 * @param signal - optional cancellation for queued and backend read work.
 * @returns the header and the stored events with `seq >= fromSeq`.
 */
abstract readFrom(id: SessionId, fromSeq: number, signal?: AbortSignal): Promise<{ meta: SessionHeader; events: SessionEvent[] }>

/**
 * Lightweight listing from metadata, without a full-log parse.
 * @param signal - optional cancellation for backend listing work.
 * @returns one header per materialized session.
 */
abstract list(signal?: AbortSignal): Promise<SessionHeader[]>

/**
 * List materialized sessions with cheap per-log change tokens.
 *
 * Repeated observations of an unchanged log return the same revision. A
 * successful mutating {@link load} repair changes the next listed revision.
 * Revisions also distinguish independently backed stores so backend-local
 * counters cannot compare equal across different persistence sources.
 * @param signal - optional cancellation for backend snapshot-listing work.
 * @returns one header and opaque revision per materialized session without loading full logs.
 */
abstract listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]>
```

型: [SessionEvent](session.md) · [SessionId](core.md)

ソース: [`packages/session/session-persistence/src/index.ts:84`](../../packages/session/session-persistence/src/index.ts)
<!-- END GENERATED cordis-surface -->
