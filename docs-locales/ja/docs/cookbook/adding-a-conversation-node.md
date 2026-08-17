# Web Client 会話ノードを追加する

このチュートリアルでは、Web Client Chat ビューにビジネス所有の行を 1 つ追加します。完成したプラグインは、永続的な Session イベントファミリーを 1 つの Context に関連付け、ビジネス State を段階的に構築し、型付けされた Step データを公開し、Session ウィンドウや他のレンダリング済みノードを走査せずにキー付き Chat Node をレンダリングします。Host がすでにイベントを記録し、クライアントプラグインが Web バンドルに組み込まれていることを前提とします。外部の Host 側 UI や Trajectory などの追加ビューターゲットは、このチュートリアルの対象外です。

[Conversation Node のアセンブリ判断](../../.agents/notes/implemented/architecture/2026-08-09-client-conversation-node-assembly.md)では、根拠と完全なエンジンモデルを扱います。このガイドでは実装手順を説明します。

## 1. 再生可能なイベントファミリーを設計する

Definition を記述する前に、安定したビジネス ID を 1 つ選択します。同じ Node に寄与するすべてのイベントはその ID を持つか、独自のペイロードから独立して導出する必要があります。クライアントが更新を「最新の未完了」Context に割り当ててはなりません。

レビュージョブの場合、イベント契約は次のようになります。

| イベント | 役割 | 必要な永続的事実 |
|---|---|---|
| `review/start` | 一意の開始 | `reviewId`、Turn/Step 座標、タイトル |
| `review/progress` | 更新 | 同じ `reviewId`、座標、再生可能な進行状況 |
| `review/end` | 更新 | 同じ `reviewId`、座標、最終サマリー |

プロセス境界をまたいで、プロデューサー所有のブランド付き ID 型を使用します。`SessionEventMap` のマージとペイロード型をプロデューサーの型専用エクスポートに置き、そのエクスポートをクライアントパッケージから副作用のためにインポートします。各 `(kind, id)` には開始イベントを最大 1 つだけ含められます。単一イベントのビジネスでは、`event.seq` などのイベントの安定した ID を、Definition ローカル ID として使用できます。

増分イベントがサポートされています。プロデューサーが低コストで出力できる場合は、開始イベントが読み込み済みウィンドウの外側にあっても有用な、値全体のチェックポイントを優先します。各差分は安定した ID を持ち、昇順のログ `seq` で再生したときに決定的な State を生成する必要があります。ライブ専用メモリに依存してはなりません。現在の履歴ウィンドウに更新だけが含まれる場合、アセンブラーは保留中の Context を維持し、より古いページから開始イベントが提供されるまで State を構築しません。開始イベントの読み込み前に製品でレンダリングする必要がある場合、終端イベントまたはチェックポイントイベントには、Definition がその結果を直接構築できる十分な完全フォールバック State を含める必要があります。無関係なイベントを走査して復元してはなりません。

## 2. Definition と型付けされた Chat ペイロードを実装する

完全な関係を確認できるように、この例ではプロデューサーの宣言とクライアントの寄与を 1 つのブロックにまとめています。パッケージファミリーでは、ブランド付き ID と `SessionEventMap` の宣言はイベントプロデューサーとともに保持し、Definition、Chat データマージ、レンダラーはクライアントプラグインに保持します。

```ts ignore-check
import { createElement } from 'react'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type {
  ClientContext, ConversationLocation, ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

type ReviewId = Branded<'ReviewId'>

interface ReviewStartData {
  readonly reviewId: ReviewId
  readonly turn: number
  readonly step: number
  readonly title: string
}

interface ReviewProgressData {
  readonly reviewId: ReviewId
  readonly turn: number
  readonly step: number
  readonly completed: number
}

interface ReviewEndData {
  readonly reviewId: ReviewId
  readonly turn: number
  readonly step: number
  readonly summary: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Opens one durable review job.
     * @mode emit
     * @param data - stable identity, location, and initial display state.
     */
    'review/start': ReviewStartData
    /**
     * Records replayable progress for one review job.
     * @mode emit
     * @param data - stable identity, location, and latest progress.
     */
    'review/progress': ReviewProgressData
    /**
     * Closes one review job with its final summary.
     * @mode emit
     * @param data - stable identity, location, and final display state.
     */
    'review/end': ReviewEndData
  }
}

interface ReviewChatData {
  readonly title: string
  readonly completed: number
  readonly status: 'running' | 'completed'
  readonly summary?: string
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'review-job': ReviewChatData
  }
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationStepDataMap {
    'review-job': ReviewChatData
  }
}

interface ReviewState extends ReviewChatData {
  readonly turn: number
  readonly step: number
}

function locationOf(context: ConversationNodeContext): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

function viewData(state: ReviewState): ReviewChatData {
  return {
    title: state.title,
    completed: state.completed,
    status: state.status,
    ...state.summary === undefined ? {} : { summary: state.summary },
  }
}

const reviewDefinition: ConversationNodeDefinition<ReviewState> = {
  kind: 'review-job',
  target: 'chat',
  match: (event) => {
    if (event.type === 'review/start') {
      return { id: String(event.data.reviewId), role: 'start' }
    }
    if (event.type === 'review/progress' || event.type === 'review/end') {
      return { id: String(event.data.reviewId), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'review/start') throw new Error('review-job requires review/start')
    return {
      turn: match.event.data.turn,
      step: match.event.data.step,
      title: match.event.data.title,
      completed: 0,
      status: 'running',
    }
  },
  update: (context, match) => {
    if (match.event.type === 'review/progress') {
      return { ...context.state, completed: match.event.data.completed }
    }
    if (match.event.type === 'review/end') {
      return { ...context.state, completed: 100, status: 'completed', summary: match.event.data.summary }
    }
    return context.state
  },
  publication: match => match.event.type === 'review/progress'
    ? 'animation-frame'
    : 'immediate',
  buildLocationData: (context, scope) => {
    if (scope !== 'step' || context.state === undefined) return null
    return {
      kind: 'step',
      turn: context.state.turn,
      step: context.state.step,
      key: 'review-job',
      value: viewData(context.state),
    }
  },
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'review-job',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
      location: locationOf(context),
      visibility: 'visible',
      data: viewData(context.state),
    }
  },
}

function ReviewNodeView({ node }: ChatNodeViewProps<'review-job'>) {
  const text = node.data.summary ?? `${node.data.title}: ${node.data.completed}%`
  return createElement('p', null, text)
}

export const inject = ['conversationEvents', 'slots']

export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(reviewDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'review-job',
  }, ReviewNodeView))
}
```

`match(event)` は畳み込みではなく ID 抽出器です。現在のイベントのみを受け取り、Definition ローカルの ID とライフサイクル上の役割を返します。一致後、アセンブラーは `(kind, id)` によって Context を特定し、`start` を 1 回呼び出すか、現在の State で `update` を呼び出します。どちらの関数もエンジンが採用する State を返します。新しいイミュータブルな値を返す方法を推奨しますが、同じオブジェクトを変更して返す関数にも同じ採用セマンティクスがあります。

`buildLocationData(context, scope)` は、Definition が所有するデータをエンジンが所有する Turn または Step に任意で公開します。宣言のマージを使用して、各キーに正確な値型を与えてください。同じ Location にある別の Node は、Session を受け取ったり `snapshot.chat.nodes` を走査したりせずに、`useTurnData(key)` などの制約付きスロットフックを介してその値を利用できます。

`target` と `buildViewNode(context)` は、ターゲット所有のレンダリングへの寄与を 1 つ宣言するものであり、必ず同時に記述する必要があります。React 向けの ID として `context.key` を維持し、永続的な順序付けの根拠から `anchorSeq` を選択し、レンダラーで使用可能なデータだけを返します。ターゲット Node を公開した後は、同じキーを返し続けてください。可視フローから一時的に外す必要がある場合は、`null` で取り下げるのではなく `visibility: 'hidden'` を使用します。

## 3. 開始時にのみ過去の業務 Context を照会する

一部の Definition では、別の業務種別の直近の過去 State が必要です。`start` は `ConversationContextReader` を受け取ります。そこで Context コレクションを受け取ったりイベントを走査したりするのではなく、`reader.previous<State>(kind)` を呼び出してください。リーダーは、現在の開始 `seq` より前に開始された最も近い Context を読み取り専用データとして返します。

アセンブラーはその依存関係を記録します。古い prepend により後からより近い先行要素が供給された場合、以前は不明だったウィンドウの欠落が閉じられた場合、または先行要素の State が変更された場合、アセンブラーは `start` から依存 Context を再実行し、更新を昇順の `seq` で再生します。照会される Definition は有用な State の書き込みを引き続き担います。リーダーは業務固有の照会メソッドを公開せず、別の Context に対する変更権限も付与しません。

## 4. 3 つの取り込み経路を理解する

履歴は末尾から後方へ 1 ページずつ要求できますが、受理された各ページは State の再生前に昇順の `seq` へ正規化されます。

| 経路 | エンジンの処理 | Definition から見える動作 |
|---|---|---|
| オープン、再同期、または欠落修復時の置換 | 読み込み済みウィンドウを再構築し、Definition ごとに各イベントを 1 回照合してから、開始済みの各 Context を再生する | `start`、続いてその更新を昇順の `seq` で処理します。更新のみで保留中の Context には State がありません |
| 古いページを 1 つ prepend する | 新たに追加された古いイベントだけを照合し、`(kind, id)` によって Context にマージし、既存のキー付きノードを維持して、影響を受ける Context と依存関係だけを再生する | 新たに見つかった開始により収集済みの更新が有効になり、Location または先行要素の変更により Context が再実行される場合があります |
| ライブイベントを 1 件 append する | 各 Definition の `match` を 1 回呼び出し、一致した Context をキーで検索して、その Context だけを更新する | 開始後のイベントが一致した場合、`update` を 1 回実行し、要求された公開を 1 回行います。既存の Context は走査しません |

`D` 個の Definition が登録されている場合、入力イベント 1 件につき、現在のイベント照合を `D` 回行い、一致後は定数時間で Context キーを検索します。Definition のコードはこの特性を維持する必要があります。通常の append 経路で、イベントウィンドウ全体、すべての Context、`context.matches`、またはレンダリング済み Node コレクションを走査しないでください。蓄積した事実には State、同一 Turn/Step 内での共有には Location データ、インデックス化された先行要素の依存関係には `reader.previous()` を使用します。

`publication` は、変更された State を実体化するタイミングを制御します。構造的または終端的な変更には `immediate`、高頻度の可視差分には `animation-frame`、State の変更が後続の公開だけに渡る場合は `none` を使用します。エンジンは引き続きすべての更新をログ順に適用します。頻度はビューの公開をまとめるだけです。

## 5. 再生、ページネーション、レンダリングを検証する

次の結果を確立する、焦点を絞ったテストを追加します。

1. 置換で完全なウィンドウを渡すと、期待される最終 State、Location データ、Node ペイロード、および `anchorSeq` が生成されます。
2. 更新のみの末尾は保留状態のままです。一意の開始を prepend すると、完全な置換と同じ結果になります。
3. 初期履歴の後にライブ append を行うと、結合したウィンドウを再生した場合と同じ結果になります。
4. 古いページを prepend すると、データが変更されていない既存のキー付き Node 値を置き換えずに、より前の行が追加されます。
5. 可視差分を繰り返しても `context.key` が維持され、要求時にはアニメーションフレームごとに最大 1 回公開されます。
6. キー付きレンダラーは `node.data` と制約付き Location フックのみを使用します。Session のイベントウィンドウ、Context、または Chat Node は走査しません。

ストリーミングと中断については [`packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts`](../../packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts)、先行要素の照会については [`inbox.ts`](../../packages/client/ui-conversation/src/client/conversation-nodes/inbox.ts) と [`message.ts`](../../packages/client/ui-conversation/src/client/conversation-nodes/message.ts)、独自の Node を作成せずに Turn データを公開する Definition については [`packages/client/ui-deliverables`](../../packages/client/ui-deliverables) を使用してください。
