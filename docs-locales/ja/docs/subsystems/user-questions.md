# ユーザー操作

[dsh-user-questions](../../packages/interaction/user-questions) の user-questions シームです。これは、エージェントが続行する前に人間からの回答を必要とする際に、ツールまたは権限プラグインが使用するプロバイダー非依存の語彙です。UI サーフェスはアクティブな `UserQuestionProvider` を提供し、ホストランタイムはリクエストを接続済みクライアントへ中継します。

ソース： [`packages/interaction/user-questions/src/index.ts`](../../packages/interaction/user-questions/src/index.ts)

## 質問の選択肢

`AskUserQuestionOption` には、選択可能な選択肢が 1 つ含まれます。`label` はユーザー向けの選択肢テキストであり、モデル向けの選択済み値でもあります。`description` は任意の UI ヘルプテキストです。

```ts type-equiv
/** One selectable answer offered to the user. */
interface AskUserQuestionOption {
  /** User-facing label. */
  label: string
  /** Optional extra context rendered by capable UIs. */
  description?: string
}
```

## 表示意図

`AskUserQuestionIntent` は、既知の決定種別を任意で宣言します。これは `kind` にタグ付けされているため、意図を追加できます。タグを認識しない UI は汎用の選択肢リストを表示します。意図は表示のみを変更します。これを尊重する UI は、汎用 UI が送信するものと同じ選択肢ラベルで回答するため、呼び出し元はどちらの場合でも同じ回答フィールドを読み取れます。`approve` は選択肢の順序に依存せず、肯定の選択肢を指定します。`ask()` は、どの型でも表現できない次の 2 つの表明を拒否します。すなわち、自身の質問の選択肢を 1 つも指定しない `approve` と、`detail` のない質問に対する意図です。

```ts type-equiv
/**
 * A caller-declared presentation intent: the question IS this kind of
 * decision, so a UI that recognises the tag may present it as such instead of as a
 * generic option list. Tagged so further intents can be added; a UI that does
 * not know a tag renders the generic flow, and the answer encoding is identical
 * either way — an intent changes presentation only, never the protocol.
 */
type AskUserQuestionIntent = {
  /** A plan submitted for review: `detail` is the plan markdown `ask()` requires, and the decision approves or declines it. */
  kind: 'plan-review'
  /**
   * The option label that approves the plan; every other option declines it.
   * Named rather than positional so no UI infers the verdict from option order.
   * An `approve` naming no option of its own question is rejected at `ask()`.
   */
  approve: string
}
```

## 質問項目

`AskUserQuestionItem` は、リクエスト内の 1 つの質問です。呼び出し元は安定した `id` を指定し、これは回答とともに返されるため、バッチ化された質問をルーティング可能な状態に保てます。任意の `detail` には補足テキストを含められ、プロバイダーは質問とともに表示しますが、選択可能な選択肢ラベルには含めません。

```ts type-equiv
/** One question in a user-questions request. */
interface AskUserQuestionItem {
  /** Stable caller-provided question id, echoed in the answer. */
  id: string
  /** The question to display. */
  question: string
  /** Optional supporting detail rendered with the question but kept out of option labels. */
  detail?: string
  /** Optional short heading/group label. */
  header?: string
  /** Optional choices the UI can render as a menu. */
  options?: AskUserQuestionOption[]
  /** Whether more than one option may be selected. Defaults to single-select. */
  multiSelect?: boolean
  /** Optional presentation intent for capable UIs; absent asks for the generic option list. */
  intent?: AskUserQuestionIntent
}
```

## 質問リクエスト

`AskUserQuestionRequest` はパッケージ間のリクエストです。`questions` は配列であるため、UI は関連するプロンプトを 1 つのフローで提示しながら、各回答の安定した ID を維持できます。存在する場合、`agent` は正確なライブ呼び出し元です。操作シームは、ライブレジストリがそのインスタンスをランタイムルートとして識別している場合にのみ受け入れます。

```ts type-equiv
/** Request for a human answer. */
interface AskUserQuestionRequest {
  /** Questions to display. */
  questions: AskUserQuestionItem[]
  /** Exact live calling agent, when the request came from an agent tool call. */
  agent?: Agent
  /** Abort signal for the owning tool/step. */
  signal?: AbortSignal
}
```

## 回答

プロバイダーは、質問 ID ごとに 1 つの回答項目を返します。`selected` には選択済みの選択肢ラベルが含まれ、`custom` にはユーザーが入力した場合に自由形式の「その他」の回答が入ります。単一選択の質問では、`custom` が選択済みの選択肢を上書きし、`selected` は空です。複数選択の質問では、`custom` が `selected` 内のラベルを補足する場合があります。UI は、空の `selected` と `custom` を持たない項目を使用して、完了済みのバッチ内でスキップされた質問を保持することもできます。

```ts type-equiv
/** Answer to one question. */
interface AskUserQuestionAnswerItem {
  /** The answered question id. */
  id: string
  /** Selected option labels. May accompany custom text for a multi-select question. */
  selected: string[]
  /** Optional free-text "Other" answer. */
  custom?: string
}
```

```ts type-equiv
/** The human's answer. */
interface AskUserQuestionAnswer {
  /** Structured answers keyed by question id. */
  answers: AskUserQuestionAnswerItem[]
}
```

## プロバイダー

コンテキスト内でアクティブにできるプロバイダーは 1 つだけです。プロバイダーの登録はエフェクトに束縛されるため、HMR/破棄によってアクティブな UI が削除されます。

```ts type-equiv
/** UI-side provider for user questions. */
interface UserQuestionProvider {
  ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
}
```

## エラー

`UserQuestionError` は `HarnessError` を拡張するため、`ctx.tools.execute()` は `EMPTY_QUESTIONS`、`NO_PROVIDER`、`ASK_ABORTED`、または UI 側でのキャンセルといったモデル向けツール失敗に対して `{ name, code }` を保持します。

```ts type-equiv
/** Stable error taxonomy for user-questions failures. */
class UserQuestionError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'UserQuestionError'
  }
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

ソースから `scripts/gen-cordis-catalog.ts` によって生成されています（doc-sync で `pnpm run verify-cordis-catalog` により最新性を検証します。再生成には `pnpm run gen-cordis-catalog` を使用します）。このセクションはページの両言語側でバイト単位で同一です。シグネチャブロックでは `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは [入門](../cordis-primer.md#dispatch-modes) で定義されており、フレームワークから継承される `ctx` API は [cordis-api/inherited.md](../cordis-api/inherited.md) にあります。

<a id="ctxuserquestions--userquestionservice"></a>

### `ctx.userQuestions` — `UserQuestionService`

`ctx.userQuestions`: アクティブな UI プロバイダー 1 つと `ask()` API。

```ts cordis-catalog
/**
 * Register the UI provider. Only one provider may be active in a context.
 *
 * @param provider UI-side implementation that collects answers.
 * @returns Disposer that unregisters this provider.
 */
registerProvider(provider: UserQuestionProvider): () => void

/**
 * Ask the active UI provider and wait for the user's answer.
 *
 * When a caller supplies an agent, human interaction is valid only for the
 * exact live runtime root. Runtime ownership, not durable session lineage,
 * decides this boundary: an owned child has no human answerer and would
 * block forever, while a lineage-bearing session resumed as a new runtime
 * root may ask normally.
 *
 * @param request Questions, owner agent, and abort signal.
 * @returns The answer chosen or typed by the human.
 * @throws {UserQuestionError} code `CALLER_NOT_LIVE` when a supplied
 *   agent is not the registry's exact live instance, or `DELEGATED_CALLER`
 *   when that live agent is owned by another agent.
 */
async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
```

ソース： [`packages/interaction/user-questions/src/index.ts:51`](../../packages/interaction/user-questions/src/index.ts)
<!-- END GENERATED cordis-surface -->
