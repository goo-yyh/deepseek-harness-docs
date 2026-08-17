# ツール作成リファレンス

モデル向けツールが満たす必要のある契約に関するリファレンスです。最初のツールを順序立てて作成するには、[ツールを作成する](../user/develop/basic/tool.md)に従ってください。`packages/shell/tool-bash`は、本番品質の 3 パッケージ構成の例です。

## 最小構成

```ts
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'read_file',
    description: 'Read a file from disk.',          // what the model sees
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path' },
      limit: { type: 'number' },                     // optional by default
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      // args is TYPED from the schema: { path: string; limit?: number }
      // exec carries immutable identity + token; signal is the operational field
      return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
    },
  }))
}
```

登録はエフェクトベースです。プラグイン fiber を破棄すると、ツールの登録が解除されます。スキーマはシステムプロンプトの組み立てに自動で反映されます。

## execute() 契約のルール

- **引数は自動で検証されます。** `defineTool`は、`execute`の実行前に、モデルが生成した`arguments`を統合された`ParameterSchemaSpec`に対して検証します（型、必須キー、リテラル制約、厳密に 1 つの union、ネストした値 — [実行時の引数検証](../../.agents/notes/implemented/architecture/2026-06-11-runtime-arg-validation.md)）。そのため、`execute`内の引数は`InferArgs`に一致します。明示的なオブジェクトノードは`additionalProperties: true | false`を宣言します。暗黙的なパラメータルートは開いたままです。空でない文字列、正の数、フィールド間ルールなど、DSL で表現できない制約は引き続き手動で確認してください。直接登録する生の JSON-Schema ツールは、入力検証を自身で担います。
- **登録時には読み取り専用の定義が借用されます。** 型付けされた同一プロセス内のコントリビューションはシリアル化境界ではありません。登録後にそのスキーマを変更したり、コールバックを置き換えたりしないでください。`schemas()`は、明示的なモデル向けプロジェクションのみを実体化します。ツールをホットスワップするには、その所有エフェクトを破棄して置換を登録します。コールバックのクロージャ内にある可変状態は、通常のプラグイン状態のままです。
- **実行 ID は保護されます。** レジストリは、`arguments`を再帰的な 1 回の処理で分離された可逆 JSON として実体化し、ポリシー開始前にその値を凍結して、不透明な`exec.token`を割り当てます。`callId`、`name`、`arguments`、`agent`、`token`、必須の呼び出し元所有の`signal`、および任意の外側トランスポートの`parent`トークンは、ディスパッチ中も不変です。`parent`は ID 専用であり、外側のライブ実行を公開しません。`args`は読み取り専用入力として扱ってください。可変ビューを受け取るのはディスパッチ周辺ラッパーだけであり、期限を設定するために必須の`exec.signal`を置換して復元できますが、削除はできません。
- **正規の JSON 値を 1 つ宣言して返します。** `output.schema`は`ValueSchemaSpec`を使用し、ルートにはオブジェクト、配列、スカラー、または null を指定できます。`execute`は推論された値だけを返します。レジストリはそれを可逆 JSON としてスナップショットし、検証して凍結した後、`output.render(args, value)`に渡します。本文からコンテンツブロックを返したり、ID やフィールドを得るために呼び出し元へ文章を解析させたりしないでください。
- **無効な値を throw または返すと、`isError`になります。** レジストリは throw を捕捉し、オブザーバーが実行される前に、スキーマ、レンダラー、メタデータプロジェクター、および可逆 JSON の失敗を封じ込めます。インフラストラクチャの失敗には throw を使用してください。ゼロ以外のプロセス終了など、Native レンダラーが望ましくない状態を説明する場合でも、成功したドメイン結果は正規値で表現してください。
- **`exec.signal`を尊重します。** 発火したら、進行中の作業をキャンセルしてください。
- **`presentationMeta`で永続的なカードデータをプロジェクションします（任意）。** `output.presentationMeta(args, value)`は、同じ正規値から再生可能な JSON を導出します。コアはそれを`tool/result`に永続化し、`presentResult`に渡します。そのため、`write`/`edit`の適用済み hunk など、結果時点の事実を必要とするカードは、正規値を永続化せずに再生後も存続します。ネストした Code ディスパッチにはカードがないため、プロジェクターはスキップされます。
- **非同期通知には`exec.agent`を使用します。** `agent.inject({ content, source: { kind: 'plugin', plugin: '<name>' } })`は、次のモデルリクエストで参照される永続コンテキストを追加します。これは起動シグナルではありません（アイドル状態のエージェントはアイドルのままです）。破棄済みエージェントに対してはガードしてください（try/catch）。

## 長時間実行される作業

プロデューサー設定で`run_in_background`をゲートし、`ctx.jobs.start({ kind, label, owner: exec.agent, run })`を通じて登録します。レジストリはプロデューサー本体の前に事前中断された呼び出しを拒否します。ランタイムは、`run()`が作業を開始する前に所有権とタスクコントローラーの可用性を検証し、その後 ID、セッションフェンス、汎用制御ツール、通知、および所有者クリーンアップを提供します。成功したバックグラウンド分岐は、`{ kind: 'background', jobId }`のような型付き正規ハンドルを返します。その Native レンダラーは`started background job bash-1`のような人間向けの文章を保持できますが、Code Mode が ID を復元するためにその文章を解析してはなりません。

プロデューサーは、同期的な`cancel`、リソースのクリーンアップ後に解決する reject しない`done`、および出力量を制限したフォーマットを行う任意の消費型`readOutput`を提供します。事前中断された呼び出しは、成功時の出力スキーマを満たす ID を持つタスクが存在しないため失敗です。`ctx.jobs.start()`が ID を公開した後は、`exec.signal`ではなくタスク所有のキャンセルシグナルを使用してください。後からの外側呼び出しのキャンセルは呼び出しを待機しないようにしますが、公開済みの作業は停止しません。`job_kill`、所有者の破棄、およびサービスの停止がそのライフタイムを管理します。フォアグラウンド作業は引き続き`exec.signal`に結合されます。ストリームプロデューサーについては、[バックグラウンドジョブランタイムの Agent Note](../../.agents/notes/implemented/architecture/2026-06-20-generic-long-running-tool-runtime.md)と`dsh-tool-bash`を参照してください。

## 実行ポリシーと監視

デプロイメントポリシーをツールに組み込まないことを推奨します。拡張可能なallow/deny/askポリシーには`tools/pre-execute`（[権限ゲートの例](extension-cookbook.md#a-hook-plugin-permission-gate-example)）、後続のリスナーが取り消せない最終的な単調拒否には`ctx.tools.guard()`、期限、再試行、またはメトリクス収集でディスパッチをラップするには`tools/execute`、表示コンテンツや返却値を置換し、結果をブロックし、またはモデル向けコンテキストを付加するには`tools/post-execute`、不変の正規化済み結果を監視するには`tools/result`を使用します。コンテンツを置換しても、`value`へのプログラム的アクセスは維持されます。機密性ポリシーは値をブロックまたは置換します。サンドボックス化の実装は、ツールの executor 実装内でも実行できます。[`dsh-tools` README](../../packages/core/tools/README.md#extension-points)は、各拡張ポイントの入力、順序、返り値、および失敗時の動作を定義しています。

## Code Mode からツールをそのまま利用できます

[Code Mode](../../packages/core/tools/README.md)では、表示されている登録済みツールを、追加統合なしで`await tools.<name>(args)`として利用できます。生成された`ToolArgsMap`と`ToolOutputMap`は、同じスキーマから厳密な引数型と正規返却型を導出し、呼び出しは通常の実行パイプラインに再入します。成功した呼び出しは、レンダリング済み Native コンテンツではなく、ポリシー適用後の最終的な正規 JSON 値に解決されます。失敗した呼び出しは実際の`ToolCallError`で reject されます。プログラムが検査できるのは、その`name`、`toolName`、および人間が読める`message`だけであり、内部エラーコードや失敗 union は検査できません。

`output.schema` は有用なプログラム API として設計します。ハンドルとフィールドを直接返し、それが正直な値である場合は scalar/array/null ルートを許可し、人間向けの説明は `output.render` に保持します。中間値は実行ローカルであり、永続化もプロンプト切り詰めも行われず、バイト数の上限もありません。そのため、生成側による正確な取得境界とプロセスメモリは依然として重要です。設定可能な出力上限とモデル向けのスピルパイプラインを通過するのは、外側の `run_code` ログ／結果のみです。

## ツールの UI 表示

ツールの `output.render` はモデル向けコンテンツを返します。**UI カード** は別の関心事であり、純粋な表示プロジェクションと省略可能な `presentCall` / `presentResult` メソッドで宣言します。これらは正規値と併せて設計します。UI 表示を持たないツールは汎用カードにフォールバックします（タイトル = ツール名、入力 = 生の引数）。

両メソッドは **`card` タグ付きのレンダー意図** を返します。ツールの処理内容に一致するカード種別を選択してください。

- `presentCall(args)` → `ToolCallView`（PENDING カード）:
  - `{ card: 'generic', title, kind?, rawInput?, content?, locations? }` — デフォルトです。アイコンには `kind`（`read`/`search`/…）を設定します。対応エディターが追従／ジャンプできるよう、ツールが操作する任意のファイルには `locations: [{ path, line? }]` を設定します。
  - `{ card: 'terminal', title, description?, cwd? }` — 呼び出し自体がシェルコマンドです。`title` がコマンド、`description` がターミナルカードの上部に表示されます。（tool-bash。）
  - `{ card: 'diff', title, diffs, locations? }` — 呼び出しがファイルを作成または変更します。`diffs: [{ path, oldText, newText }]`（新規ファイルの場合は `oldText: null`）はインライン差分カードとして表示されます。（tool-fs `write`/`edit`。）
- `presentResult(args, { content, isError, meta? })` は完了カードを返します。
  - `generic` は省略可能なタイトルとコンテンツを提供します。
  - `terminal` は生の出力と省略可能な終了メタデータを提供します。各 UI は対応ビューまたはフォールバックビューを表示します。
  - `diff` は適用済みハンクを提供します。多くの場合 `output.presentationMeta` から導出され、リプレイで再現できるよう永続化された `result.meta` に保持されます。完了ビューは保留中のカードを置き換えるため、変更ツールは差分結果を保持します。
  - `search` は永続化された `result.meta` から再構築される検索結果を提供します。ファイルごとにグループ化された一致（`shape: 'matches'`、grep）またはフラットなパス一覧（`shape: 'paths'`、glob）に加え、UI が上限付きの結果を完全であるかのように表示しないための `truncated`/`total` を含みます。このビューには結果テキストがありません（検索カードのない UI は生の結果コンテンツにフォールバックします）。また、`search` の呼び出しビューはありません。一致は `execute` の後にのみ存在するため、検索呼び出しの保留状態は汎用カードのままです。（tool-fs-search `grep`/`glob`。）
  - `web` は、`result.meta` から導出され、`kind: 'search' | 'fetch'`（構造化された検索ソースまたはフェッチ要約）で識別される、完了済みの Web 取得を提供します。本体コピーは含まれないため、`web` 機能のない UI は生の結果コンテンツにフォールバックします。（tool-web `web_search`/`web_fetch`。）

厳守ルール（破ると問題になります）:

- **純粋性。** これらはライブストリーミング時とセッションログのリプレイ時に実行されるため、`args`（+ 結果）の純粋関数でなければなりません。I/O、セッション状態の読み取り、時刻／乱数の使用は不可です。差分は引数から導出されます（呼び出し時プレゼンターには以前のファイル内容がないため、`write` は `oldText: null` を使用します）。セッションコンテキストはツールではなく UI アダプターが提供します。`presentCall` 内でファイルの以前の内容や作業ディレクトリが必要だと感じたら、そこで止めてください。それはプレゼンターではなく、永続的な結果メタデータまたはアダプターに属します。
- **UI 専用の書式設定をモデル結果に含めない。** フェンス付きの ` ```console ` ブロック、差分、相対化されたパスのいずれも、UI のためだけに正規値または Native コンテンツに含めるべきではありません。`output.render` がモデル向けの説明文を担い、`presentationMeta` とカードプレゼンターがリプレイ可能な UI 状態を担います。`terminal` の結果ビューは生の出力を保持し、アダプターがフォールバック用の枠組みを追加します。
- **`defineTool` は表示パスを緩やかに検証します。** 不正な形式または古いログ引数では、ラッパーは例外をスローするのではなく `undefined`（汎用フォールバック）を返します。表示によってリプレイがクラッシュしてはなりません。

中立的な語彙は `dsh-tools` にあります。ツールが UI 型やトランスポート型をインポートすることはありません。ホスト／クライアントランタイムは各 `card` をそれぞれのビューにマッピングします。設計とその理由については、[render-intent-union Agent Note](../../.agents/notes/implemented/architecture/2026-07-02-tool-render-intent-union.md)を参照してください。`dsh-tool-fs`（汎用／差分）と `dsh-tool-bash`（ターミナル）がリファレンス実装です。

## 検証

[リポジトリのテストポリシー](../testing.md)と、所有パッケージのテストドキュメントに従ってください。出荷するモデル表示または UI 表示の変更には、そこで指定されている統合済みのカバレッジが必要です。
