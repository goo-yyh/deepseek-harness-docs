# SessionTelemetryBackend

送信セッションレポートは、[機能の境界](../capability-seams.md)として分割されています。サービス定義とキャプチャコーディネーター（[dsh-session-telemetry](../../packages/session/session-telemetry)、`ctx.sessionTelemetry`）は、キャプチャポイント、固定チャンクプロジェクション、`session-telemetry/record`の秘匿化ウォーターフォール、引き渡しカーソル、および最小限のバックエンド契約を担います。デプロイメントで読み込まれるサービスプロバイダー（[dsh-session-telemetry-otel](../../packages/session/session-telemetry-otel)）は、OpenTelemetry JS SDK のログパイプラインをそのまま設定したものです。これは任意の機能の一つであり、エージェントループの中核には含まれず、ここからモデルリクエストに到達するものはありません。境界の原則、すなわち Harness の担当は `emit()` で終わり、バッチ処理、再試行、キューイング、損失ポリシーはレポーティング SDK に属するということと、却下された代替案は、[復活に関する Agent Note](../../.agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.md)に固定されています。キャプチャポイント、カーソル、プロジェクションの契約は、[サービス定義 README](../../packages/session/session-telemetry/README.md)にあります。

ソース： [`packages/session/session-telemetry/src/index.ts`](../../packages/session/session-telemetry/src/index.ts)

## 論理レコード

```ts type-equiv
/**
 * Severity of a telemetry record, pre-mapped at capture so a receiver can
 * alert with zero configuration: `error` for events whose own outcome flag
 * says so (the tool-result block's `isError`, `turn/end` error reasons) and for
 * `agent-error` operational records. Captured events otherwise default to
 * `info`; `warn` remains available to `session-telemetry/record` policies and
 * backends.
 */
type SessionTelemetrySeverity = 'info' | 'warn' | 'error'
```

```ts type-equiv
/**
 * One logical record handed to a backend — the capture contract's whole outbound
 * vocabulary. Ledger records mirror session-log events one-to-one;
 * operational records (`channel: 'ops'`) carry the two signals with no log
 * home (`agent-error`, `shutdown`) and deliberately omit `event.seq`-style
 * identity so they can never be mistaken for ledger rows.
 */
interface SessionTelemetryRecord {
  /** Ledger (session-log mirror) or ops (operational signal) channel; backends keep the two under separate instrumentation scopes. */
  channel: 'ledger' | 'ops'
  /** Unix epoch milliseconds — the source event's append time for ledger records, the emission time for ops records. */
  time: number
  /** Pre-mapped alerting severity; see {@link SessionTelemetrySeverity}. */
  severity: SessionTelemetrySeverity
  /**
   * Identity attributes, deliberately minimal: ledger records carry
   * `session.id`, `event.type`, `event.seq`, plus `session.cwd` /
   * `session.parent_id` / `session.seed_length` when the header has them;
   * ops records carry `telemetry.op`, `session.id`, and (for `agent-error`)
   * `agent.id`, `turn`, `step`, `error.name`. Anything recoverable from the
   * body is intentionally NOT duplicated here.
   */
  attributes: Record<string, string | number>
  /**
   * The complete payload: a deep copy of the session event's `data` for
   * ledger records (JSON-serializable by `Session.append`'s own
   * validation), or the op payload for ops records. Never mutated after
   * handoff.
   */
  body: unknown
}
```

各 `(turn, step)` では最初の `assistant/chunk` だけが送信されます。これはストリーム開始シグナルです。残りはキャプチャ時に破棄されるため、`seq` の欠落は通信上では通常発生し、損失のシグナルではありません。境界が認識していないプラグイン統合済みのものを含め、それ以外のすべての [セッションイベント](session.md) 型はそのまま通過します。配信はベストエフォートです。カーソルは配信済みではなく引き渡し済みを示します。レコードは失われる場合（クラッシュ、リロードの間隔）と重複する場合（カーソルなしの再採用、SDK の再試行）があるため、受信側は台帳レコードを `(session.id, event.seq)` で重複排除します。運用レコードには意図的にその識別子を含めません。これらは合計するエントリではなくアラート対象のシグナルであり、代わりに重複を許容します。

## 共有に関する開示

境界の確認契約（[サービス定義 README の共有開示セクション](../../packages/session/session-telemetry/README.md#the-sharing-disclosure)が所有）は次のとおりです。各バックエンドは、`ctx.sessionTelemetry` 上の必須抽象 `sharing` メンバーを通じて、デプロイメントで選択された共有ポリシーを開示します。コンシューマーが「未設定」と表示するのは、テレメトリサービスがマウントされていない場合だけです。開示するのは現在のポリシーであり、配信や保持ではありません。引き渡しはブロックしないエンキューであり、バッチ処理、再試行、損失ポリシーは引き続きレポーティング SDK に属します。

```ts type-equiv
/**
 * Deployment-selected session-sharing policy disclosed by a mounted
 * {@link SessionTelemetryBackend} backend to human-facing acknowledgement surfaces (the
 * `/feedback` command's confirmation text). The seam owns the vocabulary so
 * any backend can disclose a policy without depending on the OTel package;
 * the values mirror the OTel backend's serialized `SessionTelemetryMode` choices.
 */
type SessionTelemetrySharingStatus = 'full' | 'feedback-only' | 'disabled'
```

## バックエンド契約

```ts type-equiv
/**
 * The minimum backend contract the coordinator requires. {@link SessionTelemetryBackend} is
 * its service-registered form; tests compose the coordinator with a bare
 * implementation of this interface.
 */
interface SessionTelemetrySink {
  /**
   * Hand one record to the backend's pipeline. MUST be a non-blocking
   * enqueue — the coordinator calls this synchronously from the
   * `session/event` hot path or an explicit canonical-log capture, so anything
   * slower than a queue push would tax the agent loop or feedback handling.
   * Errors thrown here are contained by the coordinator and logged; they
   * never reach the loop.
   * @param record - the logical record to report; owned by the backend after the call.
   */
  emit(record: SessionTelemetryRecord): void
  /**
   * Optional hint that a turn ended. A backend may forward it to its SDK's
   * flush so records are exported after each turn. Called
   * fire-and-forget; implementations must not block and must not throw
   * meaningfully (the coordinator contains exceptions). Most backends should
   * leave this unimplemented and let their SDK's own batching cadence govern
   * export timing: a backend that does implement it owns the interaction
   * between its concurrent flushes and {@link shutdown}'s drain (the OTel
   * backend leaves it unimplemented for exactly that hazard — see the
   * revival Agent Note).
   */
  flush?(): void
  /**
   * Forward the fiber's disposal to the SDK: flush whatever is queued and
   * reach quiescence, per the SDK's own shutdown contract. Everything
   * emitted before this call must still be delivered — including records
   * enqueued while a {@link flush} hint is in flight, so a backend whose SDK
   * guards against concurrent flushes orders behind the outstanding one (the
   * coordinator emits its dispose-time `shutdown` markers immediately before
   * calling this). Awaited by the coordinator's dispose; a rejection is
   * logged as a warning and never fails application teardown.
   * The coordinator captures dispose-time shutdown markers immediately before
   * this call for live capture; on-demand capture creates no ops records.
   * @returns resolves when the backend's pipeline has quiesced.
   */
  shutdown(): Promise<void>
}
```

`SessionTelemetryBackend`（`ctx.sessionTelemetry`、[シグネチャ](#ctxsessiontelemetry--sessiontelemetrybackend-abstract-seam)）は契約の読み込み可能な形式です。コンテキストごとに実装は一つだけであり、重複して読み込むと例外が発生します。バックエンドはコンストラクター内で境界の `SessionTelemetryCoordinator` を構成し、キャプチャ側をインストールします。

## 秘匿化ウォーターフォール: `session-telemetry/record`

すべてのレコードは、projection と `emit()`（[ウォーターフォール](../cordis-primer.md#cordis-waterfall-semantics)および[イベントエントリ](#session-telemetryrecord--waterfall)）の間にある `session-telemetry/record` を通過します。この抽象的な継ぎ目自体にはルールが一切ありません。リスナーが登録されていない場合、レコードは取得時のままバックエンドに到達するため、エクスポートされるデータのクリーンさはデプロイメントで登録したルールと正確に一致します。リスナーは `next()` の戻り値を変換することで積み重なります。`next()` なしで返すと、その下にあるすべてが置き換えられます。例外を送出するリスナーは、coordinator のコンテインメント内でそのレコードだけをフェイルクローズで保留します。秘匿化はエクスポートされるコピーにのみ適用され、正規のセッションログが書き換えられることはありません。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

ソースから `scripts/gen-cordis-catalog.ts` によって生成されています（doc-sync で `pnpm run verify-cordis-catalog` により最新であることを検証し、`pnpm run gen-cordis-catalog` で再生成します）。このセクションはページの両言語版でバイト単位まで同一です。シグネチャブロックには `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義されており、フレームワークから継承された `ctx` API は[cordis-api/inherited.md](../cordis-api/inherited.md)にあります。

<a id="ctxsessiontelemetry--sessiontelemetrybackend-abstract-seam"></a>

### `ctx.sessionTelemetry` — `SessionTelemetryBackend`（抽象的な継ぎ目）

バックエンド契約のロード可能な形式です。コンテキストごとに実装は 1 つであり、`telemetry` キーの下で行う cordis の `Service` 登録は、cordis の標準動作として重複時に例外を送出します。バックエンドはコンストラクターで SessionTelemetryCoordinator を構成し、取得側をインストールします。

```ts cordis-catalog
/**
 * See {@link SessionTelemetrySink.emit} — that declaration is the contract's one home.
 * @param record - the logical record to report; owned by the backend after the call.
 */
abstract emit(record: SessionTelemetryRecord): void

/** See {@link SessionTelemetrySink.flush}. */
flush?(): void

/**
 * See {@link SessionTelemetrySink.shutdown}.
 * @returns resolves when the backend's pipeline has quiesced.
 */
abstract shutdown(): Promise<void>
```

出典: [`packages/session/session-telemetry/src/index.ts:148`](../../packages/session/session-telemetry/src/index.ts)

<a id="session-telemetry-events"></a>

### `session-telemetry/*` イベント

<a id="session-telemetryrecord--waterfall"></a>

#### `session-telemetry/record` — ウォーターフォール

バックエンドに到達する前に、送信される 1 件のレコードを変換します。このウォーターフォールは、サービス定義の秘匿化拡張ポイントです。これ自体にはルールが一切ありません。最も内側の `next()` はレコードを変更せずに通過させ、リスナーが登録されていない場合は取得時のままレコードがバックエンドに到達するため、エクスポートされるデータのクリーンさはデプロイメントで登録したルールと正確に一致します。リスナーは `next()` の戻り値を変換することで積み重なります。`next()` なしで返すと、その下にあるすべてが置き換えられます。coordinator のコンテインメント内にある取得ホットパスで同期的にディスパッチされます。例外を送出するリスナーはそのレコードだけを（フェイルクローズで）保留し、agent ループには到達させません。ライブ取得では追加時にディスパッチし、オンデマンド取得では正規ログの読み取り中にディスパッチします。秘匿化はエクスポートされるコピーにのみ適用され、正規のセッションログが書き換えられることはありません。

```ts cordis-catalog
/**
 * Transform one outbound record before it reaches the backend. This
 * waterfall is the Service Definition's redaction extension point. It ships NO rules
 * of its own: the
 * innermost `next()` passes the record through unchanged, and with no
 * listener mounted records reach the backend as captured, so exported
 * data is exactly as clean as the rules a deployment mounts. Listeners
 * stack by transforming `next()`'s return value; returning without
 * `next()` replaces everything beneath. Dispatched synchronously on the
 * capture hot path inside the coordinator's containment: a throwing
 * listener withholds that one record (fail-closed) and never reaches the
 * agent loop. Live capture dispatches at append time; on-demand capture
 * dispatches while reading the canonical log. Redaction applies to the
 * exported copy only; the canonical session log is never rewritten.
 * @param record - the candidate record, already the coordinator's own deep
 *   copy; listeners return a (possibly new) record and must not mutate it.
 * @mode waterfall
 */
'session-telemetry/record'(record: SessionTelemetryRecord, next: () => SessionTelemetryRecord): SessionTelemetryRecord
```

出典: [`packages/session/session-telemetry/src/index.ts:43`](../../packages/session/session-telemetry/src/index.ts)
<!-- END GENERATED cordis-surface -->
