# DeepSeek Harness のアーキテクチャ

`packages/` 配下を変更する前に、こちらをお読みください。Cordis を理解していることを前提としています。まだの場合は、[入門](cordis-primer.md)または[チュートリアル](cordis-tutorial/index.md)から始めてください。

エージェントを使用してコードベースを探索し、そのアーキテクチャを理解することをおすすめします。

## Cordis

[Cordis](cordis-primer.md) は dsh の基盤となるフレームワークです。プラグインは、共有コンテキストにサービス、型付きイベント、可逆的なエフェクトを提供します。モデルアダプター、ツールレジストリ、セッションログ、エージェントループ自体を含め、プロダクトのすべてがプラグインであるため、すべての要素を設定から置き換えられます。

パッチを適用する特権的なコアはありません。他のプラグインと並べてプラグインをマウントすることで dsh を拡張し、登録はプラグインのアンロード時に巻き戻されるエフェクトです。

## プロファイルとバンドル

実行中の `dsh` は、順序付けられたレイヤーから起動時に構成されるプラグインツリーです。

**プロファイル** は Harness ホームに保存される名前付きの構成です。積み重ねるバンドル、インストールするツリー外プラグイン、ユーザー固有の `cordis.patch.yml` を保持します。`web` と `headless` はテンプレートとして提供されます。

**バンドル** は Cordis の設定行とそれらがマウントするコードの配布形式です。そのため、挿入するものはすべて上位レイヤーからパッチ可能な状態を保ちます。

それぞれは、独自の `package.json` 内で `dsh` フィールドを使って宣言します。`dsh.profile` にはプロファイルのバンドルを列挙し、`dsh.bundle` はバンドルのパッチファイルを指します。

[`dsh-base`](../packages/bundle/base/README.md) はすべてのプロファイルの最初のレイヤーです。モデルアダプター、ツール、永続化、サンドボックスと承認ポリシー、設定、認証情報、テレメトリーを提供します。[`dsh-web-app`](../packages/bundle/web-app/README.md) はブラウザーアプリケーションを追加します。[`dsh-headless`](../packages/bundle/headless/README.md) はサーバーをまったく使用しないワンショットランナーを追加します。

レイヤーは空のエントリーリストに次の順序で適用されます。プロファイルに列挙された順の各バンドル、プロファイルの `cordis.patch.yml`、ホームレベルのもの、最後に任意の `--patch` オーバーレイです。パッチは id で行を対象にして設定全体を置き換えるか、新しい行を挿入します。

実際にマシンで起動するツリーを確認するには、次のようにします。

```sh
dsh --profile web --dump-config
```

出力される任意の行は、独自のパッチで置き換えられます。

構成の仕組みについては[app-boot](../packages/boot/app-boot/README.md#profiles)を、設定フィールドについては生成された[設定カタログ](config-catalog.md)を参照してください。

## コアパッケージ

以下は Cordis ツリーに貢献する主要なパッケージです。

| パッケージ | 管理対象 | `ctx` キー |
|---|---|---|
| [`core/session`](subsystems/session.md) | 追記専用の `SessionEvent` ログとインメモリストア | `ctx.sessions` |
| [`core/system-prompt`](subsystems/system-prompt.md) | プロンプトセクションとツールスキーマの組み立て | `ctx.systemPrompt` |
| [`core/tools`](subsystems/tools.md) | スコープ付きツールレジストリと保護された実行パイプライン | `ctx.tools` |
| [`core/agent`](subsystems/core.md) | `Agent` インターフェース、ライブレジストリ、`agent/*` イベント | `ctx.agents` |
| [`core/agent-loop`](subsystems/core.md) | そのインターフェースを実装するデフォルトドライバー | `ctx.agentLoop` |
| [`core/scope`](subsystems/scope.md) | エージェントごとのスコープ付き登録プリミティブ | ライブラリ、キーなし |
| [`llm/llm`](subsystems/llm-streaming.md) | メッセージとストリームの語彙、およびアダプターの接続点 | `ctx.llm` |

## イベント

イベントは拡張ポイントであり、適切なドメインを選ぶことがほとんどの変更で最初の判断となります。

- **セッションイベント** は、ログに追記され、`session/event` を通じて配信される永続的な事実です。再読み込み後も事実を保持する必要がある場合に使用します。
- **エージェントイベント** （`agent/*`）は、ライブの `Agent` を運びます。受信トレイ、ステップ、状態、リクエスト、検証、継続です。進行中の作業を監視または横取りするには、これを使用します。
- **機能イベント** は、ループをインポートせずに、ポリシーとアダプターを接続点（`fs/*`、`tools/*`、`telemetry/*`）に接続します。

[イベントマップ](event-producer-consumer.md)には、すべてのイベントの生成元とコンシューマーが一覧表示されています。

## ターンのフロー

**ステップ** は、1 回のモデルリクエストと、それが呼び出すツールで構成されます。**ターン** は 0 個以上のステップです。最初の入力が取得される前に開始し、未処理のものがなくなると終了します。

```text
turn/start
  claim next-step input plus one queued message
  assemble prompt sections + tool schemas
  -> agent/pre-step                   reject | enter(messages)
     reject, or a first enter rewritten empty -> close the turn with no step
     step/start
     append entered messages as user/message
     derive model history from the log
     agent/request -> llm/stream -> assistant/chunk* -> assistant/message
     tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
     step/end
     tools owe another request, or next-step input arrived -> claim -> next step
  -> agent/turn-stopping
turn/end
```

`turn/*`、`step/*`、`user/message`、`assistant/*`、`tool/*` は永続的なセッションイベントであり、残りは 3 つのドメインにまたがるライブ拡張ポイントです。`agent/pre-step`、`agent/request`、`llm/stream`、および 3 つの `tools/*` イベントはウォーターフォールであり、リスナーは委譲するために `next()` を呼び出す必要があります。`agent/turn-stopping` は直列で、`next()` を持ちません。

入力は 1 つの受信トレイを通じてドライバーに届きます。一部のメッセージはただちにドライバーを起動します。注入されたコンテキストは、別のメッセージが到着するまで受信トレイで待機します。

`agent/pre-step` はモデルに見せる内容を決定します。リスナーは取得済みメッセージを書き換えるか、完全に拒否できます。拒否された、または空の最初の取得でも、ステップを消費しなかった永続的なターンは終了するため、ログに試行が記録されます。各ステップは、プラグインが登録したプロンプトセクションとツールスキーマを読み取ります。

詳細については、[シーケンス図](agent-lifecycle.md)、[ツールパイプライン](tool-execution-pipeline.md)、[キャンセルとエラー復旧](subsystems/core.md#the-agent-handle)を参照してください。

## セッションログ

セッションログは、モデルに見せるコンテキストのソースです。`deriveMessages()` はそこからモデル履歴を投影し、未加工の `assistant/chunk` イベントはリプレイと UI の忠実性を保持します。フォーク、再開、トランスクリプト、テレメトリー、永続化はすべてこのストリームから導出されます。

**モデルに見えるものは記録されます。** モデルリクエストに到達するものはすべてログから再構築可能でなければならず、ランタイム不変条件がこれを保証します。このため、新しいモデル可視入力には新しいセッションイベントが必要です。`SessionEventMap` を拡張し、ログからレンダリングしてください。

## 機能の接続点

**接続点** は、交換可能な機能を表し、3 つの役割があります。インターフェースを宣言する**サービス定義** 、それを実装する**サービスプロバイダー** 、そしてそれを使用する**コンシューマー** です。コンシューマーは一般にモデル向けツールです。パッケージは役割を兼ねられますが、1 つの役割だけでは接続点になりません。機能を追加するには、3 つすべてを設計します（[機能グラフ](capability-seams.md)）。

接続点があるため、プロバイダーを 1 つ交換するだけでプロダクト全体が変わります。ファイルシステムとサブプロセスのプロバイダーは 1 つの実行環境を共有するため、リモートサンドボックスを指すようにすると、プロバイダーを分岐させずに Bash、PTY、LSP も一緒に移動します。[サブエージェントプロバイダー](subsystems/subagent.md)も、単一のインターフェースの背後で、新しい子エージェントから別のプロダクト内の委譲ターンまで同じように幅広く異なります。

## 新しい動作の配置先

新しい動作は、文書化された拡張ポイントに接続します。ループ自体を変更する場合は、このマップを更新します。

| 目的 | 方法 |
|---|---|
| モデルプロバイダーを追加する | そのアダプターを `ctx.llm` に登録します |
| モデル向け機能を追加する | `ctx.tools` に登録します。そのスキーマはプロンプトの組み立てに加わります |
| 1 つのセッションに別の機能セットを与える | エージェントプリセットを構成します。そこにあるサービス行には `isolate` realm が必要です |
| シェル実行を追加する | `ctx.shell` バックエンドを登録します。ローカルのものは `ctx.subprocess` を介して起動します |
| 永続的なターミナル実行を追加する | `ctx.terminals` バックエンドと `dsh-tool-terminal` を登録します |
| 人間用コマンドを追加する | `ctx.commands` に登録します。モデルのターンなしでディスパッチされます |
| バックグラウンド作業を追加する | `ctx.jobs` に登録します。`job_*` ツールで収集または停止します |
| ファイルシステムアクセスまたはポリシーを追加する | `ctx.fs` プロバイダーを登録するか、`fs/*` イベントを監視します |
| 起動したプロセスを制限する | `ctx.sandbox` バックエンドを使用します。コンシューマーは起動前に argv をラップします |
| リクエスト、ツール、またはターンをインターセプトする | その `agent/*` または `tools/*` イベントを使用します。`agent/turn-stopping` はターンを停止します |
| モデル向けコンテキストを追加する | `agent.inject()` を呼び出します。次に受け入れられるリクエストに追加されます |
| UI またはエディター統合を追加する | `ctx.agents` を操作し、`session/event` からレンダリングします |
| Web Client Chat ノードを追加する | `ConversationNodeDefinition` とキー付きレンダラーを登録します |
| 永続的なセッション状態を追加する | `SessionEventMap` を拡張します。ログからレンダリングして再生します |
| セッションタイトルを生成する | 唯一の `ctx.sessionTitle` プロバイダーを登録します |
| 同一セッション内の目標を管理する | `ctx.goals` を使用します。`agent/*` を介して続行します |
| 実行中のセッションをフォークする | `ctx.sessions.fork(source, boundary?, childSessionId?)` |
| 登録を 1 つのエージェントに限定する | そのエージェントの `agent.ctx` を使用します |

[拡張クックブック](cookbook/extension-cookbook.md)では、機能を能力に対応付け、[パッケージ](cookbook/adding-a-package.md)、[ツール](cookbook/adding-a-tool.md)、[LLM アダプター](cookbook/adding-an-llm-adapter.md)、および[Chat ノード](cookbook/adding-a-conversation-node.md)のステップバイステップガイドを索引化しています。
