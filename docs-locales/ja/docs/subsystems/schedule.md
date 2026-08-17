# Session ローカル Schedule

Schedule は、通常の後続会話ターンとして元のライブ Session に戻る永続的なリマインダーを管理します。[永続的な Schedule Agent Note](../../.agents/notes/implemented/feature/2026-08-05-durable-web-schedule.md) が永続化とライフサイクルの決定を管理し、[会話による配信](../../.agents/notes/implemented/simplification/2026-08-09-conversational-schedule-delivery.md) が受領確認なしの境界を管理し、[明示的なタイムゾーン境界](../../.agents/notes/implemented/simplification/2026-08-09-explicit-schedule-time-zone.md) がブラウザー ローカルの解釈を管理し、[制限付き固定レート Schedule](../../.agents/notes/implemented/simplification/2026-08-09-bounded-fixed-rate-schedule.md) が繰り返しを管理します。このページでは、[`packages/schedule/schedule/src/types.ts`](../../packages/schedule/schedule/src/types.ts) の永続的かつモデル向けの形状を記録します。[パッケージ README](../../packages/schedule/schedule/README.md) は、構成、ツールの動作、正確なリマインダーの枠付けを管理します。

## 永続レコード

`ScheduleId` は[ブランド付き ID](core.md#branded-ids)であり、1 つの Session 内で一意で、再利用されることはありません。バージョン 1 では、正の安全な整数の `after_seconds` 遅延、明示的な絶対 `at` ターゲット、または 5 分以上の安全な整数の `every_seconds` 間隔をサポートします。作成時に、最初のすべてのターゲットは 4 桁の年を持つ RFC 3339 UTC `scheduledAt` に正規化されます。`after` レコードは送信された遅延を保持し、`at` レコードは結果の時点のみを保存し、`every` レコードは固定間隔と次のターゲットを保持します。

```ts type-equiv
/** Durable one-shot reminder created from a positive delay. */
interface AfterScheduleRecord {
  /** Session-local stable identity. */
  readonly id: ScheduleId
  /** Rule discriminator for a delayed one-shot reminder. */
  readonly kind: 'after'
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Positive safe-integer delay accepted at creation. */
  readonly afterSeconds: number
  /** Four-digit-year RFC 3339 UTC target. */
  readonly scheduledAt: string
}
```

```ts type-equiv
/** Durable one-shot reminder created from an absolute instant. */
interface AtScheduleRecord {
  /** Session-local stable identity. */
  readonly id: ScheduleId
  /** Rule discriminator for an absolute one-shot reminder. */
  readonly kind: 'at'
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Four-digit-year RFC 3339 UTC target. */
  readonly scheduledAt: string
}
```

```ts type-equiv
/** Durable fixed-rate reminder whose next target remains creation-anchor-aligned. */
interface EveryScheduleRecord {
  /** Session-local stable identity. */
  readonly id: ScheduleId
  /** Rule discriminator for a fixed-rate recurring reminder. */
  readonly kind: 'every'
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Fixed safe-integer interval, never below five minutes. */
  readonly everySeconds: number
  /** Earliest anchor-aligned occurrence not yet dispatched. */
  readonly scheduledAt: string
}
```

```ts type-equiv
/** One-shot record variants that terminate on an id-only dispatch. */
type OneShotScheduleRecord = AfterScheduleRecord | AtScheduleRecord
```

```ts type-equiv
/** The v1 durable reminder record union. */
type ScheduleRecord = OneShotScheduleRecord | EveryScheduleRecord
```

## 絶対時刻入力

`at` セレクターは、厳密なオフセット付き RFC 3339 文字列、または厳密なローカルカレンダーオブジェクトのいずれかです。ローカル形式では、ツール境界での解釈を明示的に保持します。

```ts type-equiv
/** Structured local-calendar input accepted by `schedule_create`. */
interface LocalAtInput {
  /** Four-digit ISO calendar date. */
  readonly date: string
  /** Local wall-clock time with optional one-to-three digit milliseconds. */
  readonly time: string
  /** Explicit UTC or IANA Area/Location zone. */
  readonly time_zone: string
}
```

```ts type-equiv
/** Absolute selector accepted by `schedule_create`. */
type AtInput = string | LocalAtInput
```

公式 Web オーバーレイは、すべてのプロンプトでブラウザーの IANA ゾーンを取得します。開いているターンに曖昧さのないブラウザーゾーンが 1 つある場合、タイムコンテキストは、そのリクエスト ローカルのゾーンで、他に修飾のない自然言語の日付と時刻を解釈するようモデルに指示します。来歴が混在している、または欠落している場合は、モデルに質問するよう指示します。このガイダンスは永続的な Session のデフォルトではありません。モデルは文字列形式では引き続きオフセットを、ローカル形式では `time_zone` を渡す必要があり、Schedule がブラウザー、Session、プロセス、またはモデルのコンテキストを読み取ることはありません。

Schedule は、無効なオフセットとゾーン、オフセットのない文字列、未来ではないターゲット、夏時間の欠落時間内にあるローカル時刻を拒否します。夏時間の重複では、最初の早い時点を選択します。作成に成功すると正規 UTC `scheduledAt` のみが保存されるため、再生が周囲のタイムゾーン状態に依存することはありません。

## 固定レート入力とキャッチアップ

`every_seconds` は、作成時刻に固定された、少なくとも 300 秒のレコード単位の間隔です。これは固定レートの繰り返しのみです。プロトコルには、カレンダー式や Cron 式、繰り返し用タイムゾーン、共有クールダウン、レコード間の受付ゲートはありません。

Session が複数のターゲットにまたがってコールド状態またはビジー状態だった場合、各 Every レコードが提供するのは最新の期限到来分のみです。ディスパッチは、欠落した間隔を列挙、永続化、再生せずに、ディスパッチ決定時刻の後で作成アンカーに整列する最初のターゲットへ直接進めます。次のターゲットが 4 桁の UTC 年に収まらない場合、最後のディスパッチでレコードは終了します。

複数の異なる Every レコードが期限切れで、ワンショットが期限到来していない場合、それぞれがターゲット順および作成順で同じ後続バッチに 1 回分を提供します。Every レコードは独立した状態を保持しますが、その受付済みバッチ内のすべてのディスパッチは同じ決定時刻を使用します。バッチ処理はモデルターンを制限し、5 分の最小値は各レコードのタイマー頻度を制限します。

## 永続的な変更と再生

バージョン 1 の `schedule/change` Session イベントは、唯一の永続的な Schedule 権限です。作成では完全なレコードを保存し、削除は ID のみを使用する終端遷移です。ワンショットのディスパッチも、ID のみを使用する終端遷移です。Every のディスパッチには、最新の期限到来分を選択するために使用した実時間の決定時刻が含まれ、通常は終了するのではなくアクティブなレコードを進めます。ディスパッチは、後続処理が同期的にキューへ追加されたことを意味し、モデルの回答が成功したことやユーザーが読んだことを意味するものではありません。

```ts type-equiv
/** Creates one durable reminder record. */
interface ScheduleCreateChange {
  readonly version: 1
  readonly operation: 'create'
  readonly schedule: ScheduleRecord
}
```

```ts type-equiv
/** Deletes one currently active reminder. */
interface ScheduleDeleteChange {
  readonly version: 1
  readonly operation: 'delete'
  readonly id: ScheduleId
}
```

```ts type-equiv
/** Records that one active one-shot reminder entered the durable dispatch history. */
interface OneShotScheduleDispatchChange {
  readonly version: 1
  readonly operation: 'dispatch'
  readonly id: ScheduleId
}
```

```ts type-equiv
/** Records one fixed-rate decision and advances directly past missed occurrences. */
interface EveryScheduleDispatchChange {
  readonly version: 1
  readonly operation: 'dispatch'
  readonly id: ScheduleId
  /** Wall-clock decision time used to select the latest due occurrence. */
  readonly acceptedAt: string
}
```

```ts type-equiv
/** Durable dispatch shapes supported by the current rule set. */
type ScheduleDispatchChange = OneShotScheduleDispatchChange | EveryScheduleDispatchChange
```

```ts type-equiv
/** Strict version-1 durable Schedule mutation union. */
type ScheduleChange = ScheduleCreateChange | ScheduleDeleteChange | ScheduleDispatchChange
```

厳格なデコーダーと fold は、不明なバージョン、余分なフィールド、再利用された ID、不一致な one-shot または Every の dispatch 形状、および非アクティブなレコードに対する delete または dispatch 遷移を拒否します。通常の Session は完全なイベントストリームを fold します。fork は `SessionHeader.seedLength` 以降のイベントだけを fold するため、親 Session のアクティブなリマインダーを引き継がずに履歴を保持します。`schedule/change` の宣言とソース位置も、[永続化カタログ](../persistence-catalog.md#schedulechange--log-only)に索引付けされます。

## アクティブビューと管理

ツール値は、永続レコードと現在の実時間クロックから導出された配信状態を組み合わせます。`session-local` は、元の Session が稼働中である必要があることを意味します。外部通知チャネルやコールドセッション用スケジューラーは存在しません。

```ts type-equiv
/** Current delivery timing derived from the durable record and wall clock. */
type ScheduleState = 'scheduled' | 'overdue'
```

```ts type-equiv
/** Fixed v1 delivery boundary: the original session must be live. */
type ScheduleDeliveryMode = 'session-local'
```

```ts type-equiv
/** Complete model-facing view of one active reminder. */
type ScheduleView = ScheduleRecord & {
  /** Whether the target remains in the future. */
  readonly state: ScheduleState
  /** Reminder delivery never leaves the owning session. */
  readonly deliveryMode: ScheduleDeliveryMode
}
```

生成された[ツールカタログ](../tool-catalog.md#deepseek-aidsh-schedule)が、`schedule_create`、`schedule_list`、`schedule_delete`の引数スキーマと結果スキーマを管理します。管理呼び出しは、期限到来タスクとともに 1 つの Agent スコープのキューで直列化されます。すべての読み取りまたは決定は、まず共有 Session 永続化バリアを待機します。create と実際の delete は、追記後に再度待機します。バリアの失敗では、即時書き込みがコミットされたかを推測せず、`persistence_uncertain`を報告します。その他の安定したエラーコードは、`invalid_prompt`、`invalid_selector`、`invalid_rule`、`invalid_time_zone`、`not_future`、`time_out_of_range`、`frequency_too_high`、`corrupt_schedule_log`、`internal_error`です。

## ライブ配信

プロセスローカルの所有者は、永続 fold から最も早いタイマーを導出し、制限付き待機のたびに実時間クロックを再読み込みします。コールド Session は何も処理しません。再度開くとタイマーが再構築され、過去の対象時刻は期限超過になります。期限到来した one-shot が優先され、一度に 1 つずつ後続ターンに入ります。期限到来した one-shot がない場合、期限超過したすべての Every レコードが、上記で説明した単一バッチを形成します。

期限到来タスクは、Agent が完全にアイドル状態になるのを待ち、メンテナンスフェーズを取得してから、状態を再 fold し、決定をサンプリングし、1 つの`followup()`をキューに追加して、対応する dispatch 変更を追記します。`steer()`を呼び出すことはなく、現在のターンを中断することもありません。

受け入れられた one-shot または固定レートバッチは、通常の後続ターンを 1 つ開始し、通常の会話トランスクリプトを通じてのみ表示されます。Schedule には独立した永続 Web レシートやブラウザーレンダラーはありません。フレーミングまたは同期キューへの受け入れに失敗した場合、dispatch は記録されず、リマインダーはアクティブなままです。受け入れ後かつ永続 dispatch 前の限定的なクラッシュ区間では、復旧後にリマインダー内容が繰り返される可能性があります。そのため、この境界は exactly-once 配信ではなく、ベストエフォートの at-least-once 配信です。
