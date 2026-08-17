# Cookbook：ワークスペースパッケージの追加

新しい`@deepseek-ai/dsh-<name>`パッケージのファイル別チェックリストです。このチェックリストは bash および adapter パッケージをテンプレートとして検証されています。これらと乖離した場合は、ここで修正してください。

## 1. パッケージを作成する

```
packages/<group>/<pkg>/
  package.json     # copy from packages/core/tools, adjust name/description/deps
  tsconfig.json    # extends ../../../tsconfig.base.json, rootDir src,
                   # outDir lib/types, references: ../../../vendor/cosmokit,
                   # ../../../vendor/cordis (+ ../../../vendor/schemastery if
                   # you use Config, + ../../<group>/<dep> for each dsh dep)
  src/index.ts     # service default export or plugin (name/inject/apply/Config)
  README.md        # service API, events, extension points, design notes,
                   # + gated Model Experience context blocks or short form
                   # + the gated "Known Limitations and Deferred Work" section
                   # (or a whitelist entry in scripts/verify-package-readme-limitations.ts)
```

パッケージの役割に合う既存グループがあれば選択します（`core`、`llm`、`bash`、`compact`、`subagent`、`todo`、`session-persistence`、`ui`、`util`、または`support`）。新しいグループも許可されますが、純粋なコンテナです。`package.json`やソースファイルは置かず、パッケージは引き続きその直下ちょうど 1 階層に配置します。

package.json の不変条件（`pnpm run constraints` / `scripts/check-workspace-constraints.ts`で強制されます）：`private: true`、ルートの`package.json`と一致する`version`、`type: module`、`main: "lib/index.js"`、`types: "lib/types/index.d.ts"`、`exports["."].types: "./lib/types/index.d.ts"`、`exports["."].default: "./lib/index.js"`、および peerDependencies と devDependencies の両方にある`@deepseek-ai/cordis`（同じ範囲）。すべての dsh peer dependency を devDependencies にも反映します。`@deepseek-ai/schemastery`は`dependencies`に入れます（実行時バリデーターであるため）。agent-loop と一致させてください。`files`のリストには、`lib/index.js`、`lib/invariant.js`、`lib/types/**/*.d.ts`、およびゲートが認識するパッケージ固有の実行時アーティファクトのみを正確に含めます。実行時 export が生成ツリーを指すパッケージには、`lib/types/**/*.js`も含めます。`src`、宣言マップ、JS マップ、または古いルート宣言ファイルを公開しないでください。パッケージ`bin`を持つ CLI アプリパッケージでは、`files`内の`lib/index.js`の直後に`lib/bin.js`を含めます。

パッケージ内の相対 import では、ソース内で明示的な`.ts`指定子を使用します（例：`export * from './types.ts'`）。コンパイラーはこれらを生成された JS では`.js`に書き換え、宣言では明示的な`.ts`指定子のままにします。標準の NodeNext/Node16 TypeScript コンシューマーは、それらを隣接する`.d.ts`ファイルとして解決します。

## 2. ルート設定に登録する

| ファイル | 変更内容 |
|---|---|
| `tsconfig.base.json` | 既存グループの場合は編集不要です。新しいグループの場合は、`@deepseek-ai/dsh-*`ワイルドカードに`./packages/<group>/*/src`候補を追加します |
| `tsconfig.host.json`（Host パッケージ）または`tsconfig.client.json`（Client パッケージ） | `references`に`{ "path": "./packages/<group>/<pkg>" }`を追加します。通常のパッケージは、両方ではなく、必ず 1 つの集約先のみに属します。`api/remotes`は、Host が後続フェーズで Client が利用するコントラクトを生成するため、リポジトリ固有の分割を使用します。新しいパッケージはこれをコピーしてはいけません（[レイアウト](../development.md#typescript-project-layout)） |
| `knip.json` | リポジトリ検出がすでにカバーしていないエントリポイントがパッケージにある場合のみ |

`packages/client/*`パッケージは、`tsconfig.base.json`ではなく`tsconfig.base.client.json`も拡張します。さらに、クライアントプラグインパッケージは package.json で`dsh.client`を宣言し、`./client`を export し、共有 tsdown プリセット（`packages/client/tsdown.client.ts`）を呼び出します。クライアント側コントラクトについては、[packages/client/AGENTS.md](../../packages/client/AGENTS.md)を参照してください。

グロブまたはパッケージマニフェスト検出によって自動的にカバーされるため、編集は不要です：ルートの`package.json`ワークスペース、`scripts/publint-all.ts`、`tsdown.config.ts`、`.oxlintrc.json`、`scripts/check-workspace-constraints.ts`。

## 3. パッケージトポロジーを決定する

差し替え可能な機能では、サービス定義 / サービスプロバイダー / コンシューマーの役割が独立して進化する場合に、パッケージへ分離します（docs/architecture.md の「Capability seams」節を参照。shell の 3 パッケージ構成がテンプレートです）。単一目的のプラグインは 1 つのパッケージにします。

### 存在する役割に名前を付ける

安定している現在の責務を命名します。最初の実装、将来あり得る拡張、または Cordis ベースクラスにちなんで命名しないでください。インターフェースパッケージには機能名を付けます。実装パッケージには、それを区別するメカニズム、プロトコル、環境、またはベンダーを追加します。同一ホスト実行がコントラクトの一部である場合にのみ`local`を使用します。

1 つのエンジン、ランタイム、ポリシー、コントローラー、リゾルバー、ストア、または現在の設定には、単数形の`ctx`キーを使用します。レジストリ、または複数の名前付きメンバーを所有するサービスには複数形キーを使用します。クラスの役割とキーの数は一致させる必要があります。互換性のない Host と Client の宣言に、1 つの Cordis `Context`キーを再利用しないでください。実行時コンテキストが別でも、TypeScript の宣言マージでは両方の側面が認識されます。自然な複数形がすでに別の側面に属する場合は、役割サフィックスを追加します。

| 用語 | 使用する場合 | 使用しない場合 |
|---|---|---|
| `Controller` | コマンドまたはユーザーの意図を受け取り、既存のドメインまたは表示状態を 1 つ変更する場合です。 | 任意の作業を実行する、プロバイダ群を所有する、または表示用に値を変換するだけの場合です。 |
| `Store` | 1 つのデータセットを所有し、主にそのデータに対する CRUD、スナップショット、またはサブスクリプション操作を提供する場合です。 | ステートマシンを検証する、権限を調停する、作業をディスパッチする、またはプロバイダの優先順位を所有する場合です。マップがあるだけでクラスがストアになるわけではありません。 |
| `Directory` | 検出または選択のためのエントリとメタデータを公開する場合です。 | プロデューサーが任意の実装をそこへ登録する、または呼び出し元がそれを介して作業を実行する場合です。 |
| `Presenter` | ドメイン値またはツール引数をレンダリング意図へ純粋に変換する場合です。 | I/O を実行する、サブスクライブする、状態を変更する、またはライフサイクルを所有する場合です。 |
| `Registry` | 検索、重複または優先順位の規則、存続期間、破棄を含む、名前付き登録の動的な集合を所有する場合です。 | 主な契約がディスパッチ、実行、キャンセル、ポリシー、またはオーケストレーションである場合です。 |
| `Runtime` | ライブな作業を実行し、呼び出しをまたいでディスパッチ、キャンセル、プロバイダの調整、または操作のライフサイクルを所有する場合です。 | レコードを保存するだけ、カタログを返すだけ、1 つの値を解決するだけ、または設定を保持するだけの場合です。 |
| `Resolver` | 提供された入力から、その回答のライフサイクルを所有せずに 1 つの回答を計算または特定する場合です。 | 変更可能なコレクションまたは長時間実行する処理を所有する場合です。 |
| `Binder` | 宣言されたインターフェースを呼び出し元のコンテキストまたはライフサイクルに接続し、バインドされた値を返す場合です。 | コレクションとして値を所有する、ドメイン状態を制御する、またはデータを変換するだけの場合です。 |
| `Engine` | ドメインアルゴリズムまたは状態を持つ実行モデルを実装する場合です。 | プロバイダを選択するだけ、またはプロトコル境界をまたいで転送するだけの場合です。 |
| `Policy` | 許可、選択、制限、または観測する対象を決定する場合です。 | その決定が許可するメカニズムを実行する場合です。 |
| `Executor` | 1 つの機能において、明示的なリクエストまたは解決済みの仕様を 1 つ実行する場合です。 | 広範なアプリケーションライフサイクルまたはプロバイダカタログを所有する場合です。 |
| `Gateway` | プロセス、ネットワーク、RPC、または API の境界を適応させる場合です。 | 同一プロセスのサービスを登録するだけ、またはメタデータを保存するだけの場合です。 |
| `Provider` | 機能定義の実装を 1 つ提供する場合です。複数存在し得る場合は、メカニズムまたはベンダーの修飾子を追加してください。 | 機能定義、プロバイダレジストリ、またはコンシューマーランタイムである場合です。 |
| `Backend` | 定義済みインターフェースの背後にある、置き換え可能な低レベルの永続化、トランスポート、または実行を実装する場合です。 | ユーザー向けサービス、または返されるライブリソース参照である場合です。 |
| `Handle` | 1 つのライブリソースを参照し、そのリソースを制御または観測する場合です。 | 完全なリソースプールを作成して管理する場合です。 |
| `Config` | 解決済みの設定値 1 つ、または厳密に限定されたレコード 1 つと、その更新契約を所有する場合です。 | 一般的なコレクションを保存する、作業を実行する、または関連のない設定を公開する場合です。 |
| `Service` | 上記のどのより明確な役割にも正直に該当しない、まとまりのあるドメインサービスを所有する場合です。 | クラスが Cordis `Service`を拡張しているという理由だけで、その名前が存在する場合です。 |

`SDK`は、サポート対象の Python および TypeScript SDK で使用される JSON-RPC クライアント/サーバープロトコルにのみ使用してください。DeepSeek Harness 自体はエージェントハーネスであり、SDK プロジェクトではありません。正規の製品表記には`Typert`を使用し、`TypeRT`または`typeRT`は決して使用しないでください。

## 4. パッケージ README を作成する

まず、パッケージ固有のサービス API、設定、イベント、拡張ポイント、設計上の注意事項を記載してください。制限事項セクションには、このパッケージが所有する永続的なコンシューマーの不足点と、明白ではないメンテナー向けの制約を記録します。通常のクリーンアップは、そのソースの TODO または Agent Note に残します。間接的な Model Experience の文では、このパッケージの貢献を表面化するコンシューマーを示せますが、そのコンシューマーの実装を言い直してはなりません。パッケージ README は、次の正規の順序で終えてください。

````markdown
## Model Experience

### Request context and condition

#### What the model sees

The exact data-dependent fields, an anchored generated-catalog link, or an introduction to the verbatim literal below.

##### Verbatim text for this field, when needed

```markdown
Stable system-prompt prose of any length, or another long non-generated literal, copied exactly from source.
```

#### Token effect

Fixed, conditional, retained, replaced, capped, or zero-direct token effect.

#### KV Cache effect

Append-only, prefix-stable, replacing, or independent behavior, including the exact conditions that may invalidate reuse.

## Known Limitations and Deferred Work

- **Consumer-visible gap** — exact missing operation or case, its consequence, and any maintainer constraint.
````

Model Experience は実装から記入してください。直接的、条件付き、上限付き、ライフタイム、または補助的な各モデルコンテキスト項目には、それぞれ H3 を 1 つ使用し、上記の順序で示した 3 つの H4 フィールドと、その下に散文段落を 1 つ置きます。パッケージが所有する安定したテキストを引用してください。システムプロンプトの散文は、通常は`What the model sees`である、そのフィールドの下にタイトル付き H5 と`markdown`フェンスを付けて置きます。ほかの短いリテラルは名前付きプレースホルダーとともにインラインに置き、ほかの長いリテラルには同じネスト形式を使用します。データ依存またはプロバイダ所有のテキストだけを要約してください。ツールスキーマ項目は、生成された[ツールカタログ](../tool-catalog.md)のアンカー付きセクションへリンクし、そこにない差分だけを記載します。一方が他方なしでスコープできる場合があるため、プロンプト項目とスキーマ項目は分けてください。`KV Cache effect`では、追記のみの増加、安定した繰り返しプレフィックス、以前のリクエストトークンの置換、独立したモデルリクエストを区別し、再利用を無効にし得るパッケージ所有の変更を示します。「無効にしない」とは、パッケージがすでに再利用可能なプレフィックスを維持することを意味します。プロバイダのキャッシュ可用性と退避は、パッケージ契約の範囲外です。完全性と所有権は[散文標準](../../.agents/skills/dsh-prose-standard/SKILL.md)に従い、検証ツールは必須セクション構造を強制します。

コンテキストへの影響がないパッケージ、またはコンシューマー所有のパスが 1 つだけのパッケージでは、[`SENTENCE_MODEL_EXPERIENCE`](../../scripts/verify-package-readme-model-experience.ts)内の監査済み`None, as `または`Indirectly, through `の文を使用し、その後に`KV Cache effect` H4 と空でない段落を 1 つ続けます。モデル非依存の汎用パッケージは、代わりに`NO_MODEL_EXPERIENCE_SECTION`に参加できます。どちらの場合も、別のパッケージの作業の説明へ拡張しないでください。制限事項の[許可リスト](../../scripts/verify-package-readme-limitations.ts)は独立しています。根拠は[Model Experience Agent Note](../../.agents/notes/implemented/process/2026-07-12-package-model-experience-contract.md)に記録されています。

## 5. 検証する

```sh
pnpm install        # registers the workspace
pnpm run doc-sync
pnpm run constraints && pnpm run typecheck && pnpm run lint
pnpm run build && pnpm run hygiene
```

新しいパッケージに必要な動作固有のチェックとカバレッジについては、[リポジトリのテストポリシー](../testing.md)に従ってください。
