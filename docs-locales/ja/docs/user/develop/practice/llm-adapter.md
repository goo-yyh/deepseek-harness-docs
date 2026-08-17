# LLM アダプター

このガイドでは、新しい LLM プロバイダーを Harness に接続します。

## 概要

LLM アダプターは `LlmAdapter` を拡張し、`stream()` を実装します。Harness のプロバイダー非依存リクエストをプロバイダー API 呼び出しに変換し、レスポンスを Harness チャンクへ変換して戻します。

## 最小実装

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

class MyAdapter extends LlmAdapter {
  private apiKey: string

  constructor(apiKey: string) {
    super()
    this.apiKey = apiKey
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // 1. Convert options.messages to the provider format.
    // 2. Call the streaming API.
    // 3. Convert the response into StreamChunk values.
  }
}

export interface Config {
  apiKey: string
  providers: string[]
}

export const Config: Schema<Config> = Schema.object({
  apiKey: Schema.string().required(),
  providers: Schema.array(Schema.string()).required(),
})

export const name = 'my-llm-adapter'
export const inject = ['llm']

export function apply(ctx: Context, config: Config) {
  const adapter = new MyAdapter(config.apiKey)
  ctx.llm.registerAdapter(config.providers, adapter)
}
```

## StreamChunk プロトコル

`stream()` はこのプロトコルを使用してチャンクを生成します。

```ts
import { CallId, type StreamChunk } from '@deepseek-ai/dsh-llm'

async function* exampleChunks(): AsyncIterable<StreamChunk> {
  // 1. Start each content block with block-start.
  yield { type: 'block-start', index: 0, blockType: 'text' }

  // 2. Stream text through text-delta.
  yield { type: 'text-delta', index: 0, text: 'Hello' }
  yield { type: 'text-delta', index: 0, text: ' world' }

  // 3. End each content block with block-end and the complete block.
  yield {
    type: 'block-end',
    index: 0,
    block: { type: 'text', text: 'Hello world' },
  }

  // 4. Tool-call block.
  yield { type: 'block-start', index: 1, blockType: 'tool-call' }
  yield {
    type: 'tool-call-delta',
    index: 1,
    id: CallId('call-123'),
    name: 'bash',
    argumentsDelta: '{"command":"ls"}',
  }
  yield {
    type: 'block-end',
    index: 1,
    block: {
      type: 'tool-call',
      id: CallId('call-123'),
      name: 'bash',
      arguments: '{"command":"ls"}',
    },
  }

  // 5. Token usage.
  yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } }

  // 6. Finish reason.
  yield { type: 'finish', reason: { kind: 'stop' } }
  // Alternatively, { kind: 'tool-calls' } requests tool execution.
}
```

### 主なルール

- すべての `block-start` には対応する `block-end` があります。
- `index` は 0 から増加し、コンテンツブロックの順序を識別します。
- `tool-call-delta` は、生の JSON テキストを `argumentsDelta` に格納します。一度にすべて格納することも、複数のチャンクに分けることもできます。
- `finish` は最終チャンクです。
- `usage` を `finish` より前に出力します。

## GenerateOptions

`stream()` はエクスポートされた `GenerateOptions` 型を受け取ります。これには、モデル、アダプターが管理する reasoning-effort ID、会話履歴、システムプロンプト、ツールスキーマ、生成パラメーター、停止シーケンス、abort signal が含まれます。`@deepseek-ai/dsh-llm` からエクスポートされる TypeScript 型を正としてください。サポートされるフィールドをプロバイダー API にマッピングします。プロバイダーがフィールドを扱えない場合は、暗黙に破棄せず、安定したコードを持つ `LlmError` をスローします。

`resolveModel(provider, model, signal?)` をオーバーライドし、正確なプロバイダー／モデル識別子と、任意の `context` および `reasoning` メタデータを 1 回の検索で返します。推論メタデータには、順序付きの不透明な ID と表示名、および任意の設定済みデフォルトが含まれます。上流の機能 API が返す場合は `off` も含め、これらの値をコア enum に昇格させるのではなく、アダプターが正とする選択可能なリストを保持してください。キャンセルと破棄が静止状態に到達できるよう、非同期検索では任意の signal を尊重します。サービスは集約結果を検証し、`stream()` の前にサポートされない明示的な effort を拒否します。`reasoning` を省略すると、そのモデルには選択可能な reasoning-effort 機能がないことを意味します。

## アダプターを登録する

```ts ignore-check
ctx.llm.registerAdapter(['my-provider'], adapter)
```

最初の引数には、アダプターが処理するプロバイダールートを列挙します。`GenerateOptions.provider` は登録済みアダプターを選択し、`GenerateOptions.model` はライフサイクル登録なしでアダプターが管理するモデル ID を渡します。アダプターがセレクターにモデル候補を提示できる場合は、`listModels()` をオーバーライドします。

## cordis.yml から使用する

```yaml
- id: my-llm
  name: './src/my-llm-adapter.ts'
  config:
    apiKey: !!js process.env.MY_API_KEY
    providers:
      - my-provider

- id: agent-loop
  name: '@deepseek-ai/dsh-agent-loop'
  config:
    agents:
      - id: main
        provider: my-provider
        model: my-model-v1
```

## 参照実装

リポジトリには完全な実装が含まれています。

- `packages/llm/llm-deepseek/` — OpenAI 互換形式を使用する DeepSeek API アダプター
- `packages/llm/llm-pi-ai/` — 異なる API 形式を使用する Pi AI アダプター

同梱されている 2 つのアダプターを比較すると、異なるプロバイダー SDK 上で同じ Harness 契約が実装されていることを確認できます。

## エラー処理

アダプターは、転送およびプロトコルの失敗を安定したコードを持つ `LlmError` 値としてスローします。エージェントループは診断とポリシーのためにエラーとコードを保持し、通常の `Error` を自動的には変換しません。すべてのプロバイダー HTTP リクエストでは、`attributionHeaders()` もマージし、`options.signal` を転送する必要があります。

```ts
import {
  attributionHeaders,
  LlmAdapter,
  LlmError,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

class HttpAdapter extends LlmAdapter {
  constructor(private readonly endpoint: string) {
    super()
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...attributionHeaders(),
      },
      body: JSON.stringify({ model: options.model, messages: options.messages }),
      ...options.signal ? { signal: options.signal } : {},
    })
    if (!response.ok) {
      throw new LlmError(`Provider API error: ${response.status}`, 'PROVIDER_HTTP_ERROR')
    }
    // A real adapter parses the response and emits the complete chunk sequence.
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
```
