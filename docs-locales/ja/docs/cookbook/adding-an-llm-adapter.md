# Cookbook: LLM アダプターの追加

新しいモデルプロバイダーを接続する方法です。参照実装: `packages/llm/llm-deepseek`（直接 HTTP、`eventsource-parser` でフレーミングされた SSE）および `packages/llm/llm-pi-ai`（LLM ライブラリをラップ）。まず `packages/llm/llm/src/types.ts` の `StreamChunk` ドキュメントを読んでください。両方のアダプターが検証したプロトコル規約が記録されています。

## 構成

```ts ignore-check
class MyAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> { … }
}

export const name = 'llm-myprovider'
export const inject = ['llm']
export const Config: z<Config> = z.object({ apiKey: z.string(), … })

export function apply(ctx: Context, config: Config) {
  ctx.llm.registerAdapter(['my-provider'], new MyAdapter(…))
}
```

登録はエフェクトベース（HMR セーフ）です。プロバイダールートごとに 1 つのアダプターを登録します。重複時には例外がスローされ、複数ルートの登録は全成功か全失敗になります。`options.provider` がアダプターを選択し、`options.model` はプロバイダーのモデル ID です。そのため、動的カタログアダプターはライフサイクルを再設定せずに新しいモデルを提供できます。シークレットは Cordis ネイティブです。環境変数フォールバック付きの schemastery Config を使用し、`!!js process.env.MY_KEY` を介して cordis.yml から供給します。コード内でアドホックなキーファイルを読み取らないでください。

## プロトコル上の義務（2 つの実装で検証した契約）

- `usage` より前に `finish` を発行し、`finish` の後には何も発行しません。堅牢な方法は、プロバイダーのストリーム終端マーカーまで完了情報と使用量をバッファリングしてからフラッシュすることです（末尾に使用量のみのチャンクを送るプロバイダーに対応します）。
- ツール呼び出しの `arguments` はエンドツーエンドで生の JSON 文字列です。ストリームフラグメントは `argumentsDelta` として送ります。プロバイダーからパース済みオブジェクトが返る場合は、`block-end` で再度文字列化してください。
- ブロックの `index`es は、ストリーム内で最初に出現した順序で割り当てます。同じブロックのすべての差分には同じインデックスを再利用します。
- エラーには認可された経路が厳密に 2 つあります。`stream()` からスローする方法（トランスポートおよびプロトコルの失敗。安定したコードを伴う `LlmError` を使用します）、または `finish {kind: 'error' | 'aborted'}` でストリームを終了する方法（プロバイダーのインバンド失敗）です。コンシューマーは両方を処理します。失敗の種類ごとに選択し、文書化してください。
- `options.signal` を尊重します（fetch または SDK に渡します）。
- プロバイダーが満たせない `GenerateOptions` フィールド（例: 停止シーケンスを持たないプロバイダーの `stop` リスト）については、黙って破棄せずに `LlmError(..., 'UNSUPPORTED')` をスローします。
- プロバイダーが後続呼び出しで応答 ID、署名、またはその他のネイティブメタデータを必要とする場合、最小限の可逆 JSON プロジェクションを `finish.replayState` として発行します。履歴を再構築するときに検証してください。`LlmRuntime` は、履歴上のプロバイダールートと対象プロバイダールートが現在まったく同じアダプターインスタンスに所有されている場合にのみ、それを渡します。同一モデル間、モデル間、またはプロバイダー間の復元が合法かどうかはアダプターが決定します。状態がない場合、プロバイダー名やモデル名だけからネイティブ再生を推測しないでください。

プロバイダー固有の思考モード切り替えは、アダプターの Config に残します。正確なモデルメタデータには、プロバイダー中立の 1 つの機能抽象シームを使用します。プロバイダー／モデルの識別情報と任意の `context` および `reasoning` フィールドを用いて `resolveModel()` を実装し、存在する場合にのみ設定済みの `defaultEffort` を宣言し、リゾルバーの任意の `AbortSignal` を尊重します。推論努力は、アダプターがプロバイダーリクエストへマッピングする順序付き不透明 ID です。サポートされる場合はアダプター定義の `off` を含め、最終的なワイヤー表記を公開したり、未対応の値を制限したりせずに、アダプターが権威を持つ選択可能なリストを保持します。ID はワイヤー表現と同一である必要はありません。

## 実装構造

ワイヤー型、リクエストのシリアル化、トランスポートのパース、チャンクの変換、アダプタークラスを別々の責務として維持します。[`llm-deepseek`](../../packages/llm/llm-deepseek/README.md) が参照レイアウトです。

## 検証

アダプターのカバレッジ、実プロバイダーのチェック、公開エントリーの要件を定める [リポジトリのテストポリシー](../testing.md) に従ってください。
