# プランモード

プランモードは、[dsh-plan-mode](../../packages/plan/plan-mode)（`ctx.planMode`、`PlanModeController`）が所有するエージェントごとの協働状態として記録されます。有効な間は、デプロイメント所有のガイダンスセクションが各モデルリクエストに含まれます。プランモードは**ソフトガイダンス**です。[サンドボックスモード](sandbox.md)と[承認ポリシー](approval.md)は独立して制限を適用します。どちらもプラン状態の読み取りや書き込みを行わないため、デプロイメントでは個別に設定します。パッケージは任意であり、エージェントループはこれに依存しません。これは`plan:policy`プロンプトセクションを提供し、`exit_plan_mode`ツールと`/plan`コマンドを登録します。根拠は[設計ノート](../../.agents/notes/implemented/simplification/2026-07-22-plan-specific-collaboration-state.md)に、モデル体験と制約の詳細は[パッケージ README](../../packages/plan/plan-mode/README.md)に記載されています。

ソース： [`packages/plan/plan-mode/src/index.ts`](../../packages/plan/plan-mode/src/index.ts)

## 記録済み状態と復旧

`plan/mode`（`{ active: boolean }`）は、ログ専用で値全体を置換する[セッションイベント](session.md)です。耐久性と再生可能性を備え、モデルのトランスクリプトには含まれません。`foldPlanMode(events, end?)`はプレフィックス内で最後に記録された値を返し、存在しない場合は`false`を返します。有効な状態は常にセッションログの純粋な畳み込みであるため、再開、フォーク、圧縮ではライブミラーなしで復旧され、UI は`session/event`を通じてコミット済みの切り替えを確認します。完全なイベント宣言は、[永続化ログイベントカタログ](../persistence-catalog.md)にあります。

## 保留中の選択とステップ前の追記

すべてのセッションイベントはターン内に含まれるため、ユーザー選択は、リクエスト導出前に次に受理されるターン内の事前ステップで追記されるまで保留のままです。これはどのターンで発生しても同様です。選択によって継続が強制されることはないため、あるターンで最後に受理された事前ステップの後に行われた選択は、後続のターンで追記されます。`set(agent, active)`は保留中の選択を記録します（対象が記録済みまたはすでに保留中の状態と等しい場合は何もしません）。また、`get(agent)`は`{ active: boolean; pending?: boolean }`を返します。これは、現在のステップを組み立てるために使用した記録済み状態と、追記待ちの選択済み状態です。

エージェントの実行中における唯一の追記ポイントは、先頭に追加される`agent/pre-step`リスナーです。これはターン 1 のステップ 1 とリクエスト復旧の再試行を含む、提案されたすべてのリクエストステップを監視し、まず下流のリスナーを呼び出してから、ステップが受理された場合にのみ追記します。プロンプトの受け入れはターン前に行われ、`plan/mode`を追記できないため、プロンプトで行われた選択は、それが開始するターンで最初に受理されたターン内事前ステップによって追記されます。追記に失敗してもターンはブロックされず、選択は後続で受理されたターン内事前ステップまで保留されたままです。追記されたユーザー選択では、最後に記録されたリクエストヘッダーが別の状態を示していた場合にのみ、プラグイン由来の`user/message`通知が 1 件記録されます。これにより、モデルにはコンテキストが変化した時点だけが正確に伝えられ、冗長には通知されません。あるターンで最後に受理された事前ステップの後に行われた選択はプロセスローカルのままであり、次の受理済みターン内事前ステップの前にプロセスが終了すると失われます（[README の制約](../../packages/plan/plan-mode/README.md#known-limitations-and-deferred-work)）。

## 設定

```ts type-equiv
/** Deployment-owned plan guidance. */
interface PlanModeConfig {
  /** Guidance rendered as the `plan:policy` prompt section while plan mode is active. */
  section: string
}
```

`section`が欠落、空、文字列以外である場合、および未知のキーは、無視されるのではなくプラグインのロード時に失敗します。プランモードが有効な間は、正確な`section`テキストが順序 50 の`plan:policy`[システムプロンプトセクション](system-prompt.md)としてレンダリングされます。無効なプランモードではテキストは提供されません。

## 終了ツールと`/plan`コマンド

[`exit_plan_mode`](../tool-catalog.md#deepseek-aidsh-plan-mode)はプランモードが無効な間も登録されたままです。そのため、プランモードへの移行または終了で変化するのはプロンプトセクションのみであり、リクエストツールカタログは変化しません。プランモード外での実行は失敗します。プランモードでは、`#`見出しで始まる完全な Markdown プランが必要であり、[ユーザー質問の抽象的な接続点](user-questions.md)を通じてレビュー用に提示します。承認されると`{ approved: true }`が返され、次に受理されるターン内事前ステップで追記される、サイレント（ナレーションなし）の保留中終了が記録されます。したがって、プランガイダンスはアシスタントの現在のツールバッチの残りの間も有効であり、ツール結果自体が遷移を報告します。プランを継続する場合は、ユーザーのフィードバックを含む失敗した呼び出しとなるため、モデルは修正して再度提示します。対話チャネルがない場合やレビュー中にサービスが再読み込みされた場合も、プランモードを暗黙に終了するのではなく呼び出しが失敗します。

[`ctx.commands`](commands.md)が構成されると、プラグインは`/plan [off|message]`を登録します。引数なしの`/plan`はプランモードを選択し、その他の空でないメッセージはプランモードを選択してから`agent.steer()`を通じてテキストを送信します。これにより、そのテキストはプランガイダンス下で次のステップの通常の記録済みユーザーメッセージになります。厳密な引数`off`は無効状態を選択します。これは追記されてリクエストから見えるようになる前に保留中の開始も取り消します。

## サービス

`ctx.planMode`は記録済みのプラン状態を所有し、ステップ開始時に選択済み状態を適用してナレーションし、`plan:policy`セクション、`/plan`コマンド、および安定した終了ツールを所有します。`get`/`set`のシグネチャは、生成された[サービスカタログ](#ctxplanmode--planmodecontroller)にあります。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`によってソースから生成されます（doc-sync で`pnpm run verify-cordis-catalog`により最新であることを検証します。再生成には`pnpm run gen-cordis-catalog`を使用します）。このセクションはページの両言語版でバイト単位で同一です。シグネチャブロックは`ts cordis-catalog`フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義されており、フレームワークから継承された`ctx` API は[cordis-api/inherited.md](../cordis-api/inherited.md)にあります。

<a id="ctxplanmode--planmodecontroller"></a>

### `ctx.planMode` — `PlanModeController`

`ctx.planMode`: 記録済みのプラン状態、ステップ開始時の選択済み状態の適用とナレーション、`plan:policy`セクション、`/plan`コマンド、および安定した終了ツールを所有します。UI は`session/event`を通じてコミット済みの切り替えを確認します。ライブミラーはありません。

```ts cordis-catalog
/**
 * Read the logged plan state and any selected state awaiting the next
 * accepted in-turn pre-step.
 *
 * @param agent The agent to read.
 * @returns Current logged state plus a pending selection, when present.
 */
get(agent: Agent): { active: boolean; pending?: boolean }

/**
 * Select whether plan mode should be active. Between turns the method
 * appends the change immediately because no in-turn pre-step will run until
 * another prompt starts a turn. The open-turn fold is the idle signal:
 * agent status stays `running` through post-turn checkpointing, when no
 * further in-turn pre-step runs. During an open turn the selection remains
 * pending until the next accepted in-turn pre-step. Repeated selection of
 * the current or already-pending state is a no-op.
 *
 * @param agent The agent to switch.
 * @param active Whether plan mode should be active.
 * @returns what happened: `committed` (logged now), `queued` (awaiting the
 * next accepted in-turn pre-step), `cancelled` (an opposite pending selection
 * was cleared; the logged state already matches), or `noop` (already in that
 * state).
 */
set(agent: Agent, active: boolean): 'committed' | 'queued' | 'cancelled' | 'noop'
```

型: [Agent](core.md)

ソース： [`packages/plan/plan-mode/src/index.ts:184`](../../packages/plan/plan-mode/src/index.ts)
<!-- END GENERATED cordis-surface -->
