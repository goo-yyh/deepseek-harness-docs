# サブシステム

DeepSeek Harness の各サブシステムに 1 ページを割り当てます。内容は、その概要、移動するデータ構造、および `ctx` サービスまたはイベントスコープが支える場合は、そのサービスとイベントのリファレンスを含む生成済みの **Cordis API** セクションです。このフォルダーは、サブシステム全体の [architecture.md](../architecture.md) で説明される *動作* （サービスマップ、session/turn/step ライフサイクル、イベント分類）を補完します。ここにある各ページは、1 つのサブシステムの用語と配線のリファレンスです。

| ページ | 内容 |
|---|---|
| [core.md](core.md) | `packages/core` がエージェントループを制御する仕組み: パッケージごとのループ説明、エージェントの作成と所有権（`AgentHandle`）、`Agent` ハンドルの delivery/cancellation/interception 契約、リポジトリ全体の型パターン（`…Map → derived-union`、ブランド付き ID） |
| [llm-streaming.md](llm-streaming.md) | `packages/llm` の会話型 — `Message`/`ContentBlock`、組み立てられたモデルリクエスト、`StreamChunk` ワイヤプロトコルとアダプター契約、`BlockAssembler`、`LlmAdapter` プロバイダー契約 |
| [token-meter.md](token-meter.md) | 消費済みログのリビジョンを伴う、不変のスカラーおよび位置的リプレイ測定値 |
| [scope.md](scope.md) | スコープ付き登録 ID、ディスパッチキャリア、および所有される `Scope` コンテキスト |
| [typert.md](typert.md) | Remote 呼び出し記述子、ルックアップ/Context 宣言、Typert レジストリ、Host ゲートウェイ/Client API 境界 |
| [goal.md](goal.md) | 永続化された目標 ID、ライフサイクルスナップショット、アクティベーション、変更レコード、ラウンド帰属 |
| [schedule.md](schedule.md) | セッションローカルのリマインダーレコード、永続的な遷移、アクティブビュー、通常会話への配信 |
| [commands.md](commands.md) | 人間コマンドのレジストリサービス: 定義、アダプター検出、直接呼び出し、結果、解析ビュー |
| [session.md](session.md) | 完全な `SessionEventMap` バリアントカタログ、`TurnTrigger`/`TurnEndReason`、`deriveMessages()`、実行エンクロージャ、スタンドアロンイベント |
| [persistence.md](persistence.md) | 永続性の抽象的境界: `SessionPersistence`、JSONL + SQLite バックエンド、`session/flush`、クラッシュリカバリー、`SessionHeader` |
| [settings.md](settings.md) | ユーザー設定の抽象的境界: `SettingsNamespace` 登録、階層的な解決（デフォルト → コンポジション `base` → ユーザードキュメント）、所有者スコープ、ホットコミット |
| [credentials.md](credentials.md) | 認証情報の抽象的境界: 設定内の `CredentialRef` 参照（値ではない）、操作ごとの解決、UI 安全な `CredentialInfo`、プロバイダーソース層 |
| [session-query.md](session-query.md) | 論理レコード、制限付きの正確なイベント読み取り、関係トレース、意味フィルター/ドキュメント、全文検索結果ページ |
| [feedback.md](feedback.md) | ライフサイクルに結び付くメッセージ単位のフィードバックレコード、楽観的バージョン、サイドカー永続化、Host Remote 契約 |
| [session-title.md](session-title.md) | 永続的なタイトルスナップショット、引用元メッセージ seq、非同期プロバイダー契約 |
| [session-reference.md](session-reference.md) | 構造化されたセッション間参照: `SessionReferenceInput`/`Candidate`、準備済みメッセージコンテキスト、安定したエラー分類 |
| [system-prompt.md](system-prompt.md) | 組み立て単位のコンテキスト、ツールプロバイダーの結果、プロンプトセクション、協調的な組み立て |
| [tools.md](tools.md) | `ToolDefinition` の完全なフィールド、スキーマ DSL、`ToolExecution`/`ToolResult`、ツール表示用 UI 型、保護された実行パイプライン |
| [user-questions.md](user-questions.md) | UI 対応の人間向け質問/回答の抽象的境界: `AskUserQuestionRequest`、回答/選択肢の語彙、プロバイダー API、エラー分類 |
| [approval.md](approval.md) | 単発のユーザー承認の抽象的境界: `ApprovalRequest`、`ApprovalOutcome`、セッションごとのポリシー、監査イベント、回答者契約 |
| [attachment.md](attachment.md) | 永続的な画像 ID とメタデータ、検証入力、検証済み読み取り、`AttachmentStore` の抽象的境界 |
| [shell.md](shell.md) | bash 実行器の抽象的境界: `ShellExecRequest`/`Spec`、`ShellRunResult`、バックグラウンドの `ShellProcess` ハンドル |
| [subprocess.md](subprocess.md) | サブプロセスの抽象的境界: 完全明示的な `SubprocessSpawnSpec`、オフセットベースの出力リーダー、未分類の `SubprocessOutcome`、管理対象の `DSH_*` 環境の語彙 |
| [terminal.md](terminal.md) | 永続的なターミナル ID、バックエンド/セッション契約、送信準備状態、制限付き読み取り、所有者に表示されるスナップショット |
| [sandbox.md](sandbox.md) | セッションごとのポリシー解決とプロセス隔離の抽象的境界: ファイル効果モード、実行/プロバイダーポリシー、`ConfinedArgv`、強制とフェイルクローズドエラー |
| [code-runtime.md](code-runtime.md) | コード実行の抽象的境界: `CodeRunRequest`/`Result`、バインディング名前空間、取得されたログ、`CodeRunFailure` 分類 |
| [extensions.md](extensions.md) | バージョン管理された動的 Cordis Plugins と Packages、Host/Client のアクティベーション、承認、ランタイム検査、ライフサイクル終了処理 |
| [filesystem.md](filesystem.md) | ファイルシステムの抽象的境界: `FsTarget`、read/write/edit の結果、監視対象ファイルの状態、`FsErrorCode` |
| [lsp.md](lsp.md) | LSP ナビゲーションの抽象的境界: `LspQueryRequest`/`Result`、`LspProvider`/`Service`、4 つの操作、`LspError` |
| [skills.md](skills.md) | スキルサービス: 検出優先順位、`SkillSummary`/`SkillDefinition`、セッション接頭辞カタログ、モデル向けの `skill` 読み込み |
| [compaction.md](compaction.md) | コンパクションの抽象的境界: `compaction/*` セッションイベント、`CompactionResult`、`CompactionEngine` インターフェース |
| [subagent.md](subagent.md) | サブエージェントの抽象的境界: 名前付きプロバイダーレジストリ、`SubagentStartRequest`/`Result`/`Run`、開始時とランタイムの機能分割 |
| [web.md](web.md) | Web アクセスの抽象的境界: `WebSearchRequest`/`Result`、`WebFetchRequest`/`Result`、`WebFetchBody`、プロバイダーの可用性、`WebError` |
| [spill.md](spill.md) | スピルストレージの抽象的境界: `SaveTextSpill`、`SpillOwner`/`SpillSource`、`SpillRef`、ブランド付き `SpillLocator` |
| [workflow.md](workflow.md) | ワークフローの抽象的境界: `WorkflowStartRequest`、`WorkflowMeta`、`WorkflowRun`/`Result`、`workflow/*` イベントペイロード、`WorkflowError` の致命性 |
| [jobs.md](jobs.md) | バックグラウンドジョブランタイム: ブランド付き `JobId`、プロデューサー契約、コンシューマービュー、`ctx.jobs` サービスの動作 |
| [permission-presets.md](permission-presets.md) | 権限プリセット層: `PresetSpec`/`PresetOption`、派生した `custom` 状態、ログ専用の `permission/preset` イベント |
| [plan.md](plan.md) | プランモード: ログ専用の `plan/mode` 状態、保留中の選択フラッシュ、`PlanModeConfig`、`exit_plan_mode` レビューアーク |
| [invariants.md](invariants.md) | ランタイム不変条件レジストリ: 選択 `Config`、`InvariantInstaller`/`InvariantFailure`、空のコンパニオン契約 |
| [web-server.md](web-server.md) | HTTP キャリア: `WebRouteKind`/`WebRoute`、一致順序、取得可能なフォールバック枠、インデックスタップ |
| [storage.md](storage.md) | ストレージサブシステム: バックエンド契約（`StorageBackend`）、`StorageForms`、`DomainSpec`/`Domain`、`domain/changed` |
| [workspace.md](workspace.md) | ワークスペースレジストリ: `Workspace`/`WorkspaceId`、登録と解決、セッションの `cwd` 関係 |
| [client-modules.md](client-modules.md) | Web プラグインテーブル: `dsh.client` 宣言、`WebBootGraph` ワイヤ構成、バンドルルートとインデックスタップ |
| [session-projection.md](session-projection.md) | プロジェクションの抽象的境界: `SessionProjectionMap`、純粋な `ProjectionDefinition` ユニット、`ProjectionSnapshot` の一貫したカット、変更フィード |
| [session-telemetry.md](session-telemetry.md) | 送信セッションレポート機能の抽象的境界: `SessionTelemetryRecord`/`SessionTelemetrySeverity`、`SessionTelemetrySink` 契約、`session-telemetry/record` の秘匿ウォーターフォール |

> これらのページにある型宣言とその JSDoc はソースと同等であり、`pnpm run verify-type-equiv` によりドリフトがチェックされます（[development.md](../development.md#documenting-types-verbatim-ts-type-equiv)を参照）。通常のブロックでは完全な宣言を保持し、`public-api` ブロックでは本体を除外した公開クラス宣言を保持します。Cordis のサービスとイベントでは、各ページで生成された **Cordis API** セクションを使用します。
