# 7. Harness へ組み込む

この章では、モデルが呼び出せるツールを harness の `tools` サービスに登録し、harness のツールパイプラインを通じて実行して、結果イベントを確認します。キーは不要で、モデルも呼び出しません。

## ツールプラグイン

`greet-tool.ts` に `tmp/cordis-tutorial` を作成します。

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'

export const name = 'greet-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet the named person.',
    parameters: {
      name: { type: 'string', required: true, description: 'Who to greet' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `Hello, ${args.name}!`
    },
  }))

  // Drive one call through the real execution pipeline, standing in for
  // the model. CallId brands the correlation id a provider would issue.
  void (async () => {
    const result = await ctx.tools.execute({
      callId: CallId('demo-1'),
      name: 'greet',
      arguments: { name: 'Cordis' },
      signal: new AbortController().signal,
    })
    console.log('tool replied:', JSON.stringify(result.content))
  })()
}
```

ここで使うパターンはすべて前の章で説明したものです。`inject: ['tools']`（[第 3 章](03-services.md)）はツールレジストリが作成されるまでプラグインを保持します。`ctx.tools.register(...)` は登録解除用 disposer をプラグインに関連付けます（[第 2 章](02-lifecycle-and-effects.md)）ので、アンロード時にツールの登録も解除されます。`defineTool` は `parameters` の仕様をモデルに示す JSON Schema へ変換し、`args` の型を推論して、`execute` の実行前にモデル提供の引数を検証します。ツールは `output.schema` が宣言する正規値を返し、`output.render` は Native かつ永続的な結果コンテンツを別途生成します。

## オブザーバープラグイン

`tool-logger.ts` を作成します。これは harness の `tools/result` イベントを通じて、アプリ内のすべてのツール呼び出しを監視する別のプラグインです。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'tool-logger'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.on('tools/result', (exec, result) => {
    const text = result.content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('')
    console.log(`[tool-logger] ${exec.name} -> ${text}`)
  })
}
```

`import type {} from '@deepseek-ai/dsh-tools'` の行はパッケージの宣言マージを取り込むため、`'tools/result'` とそのペイロードに型が付きます。これは第 4 章の `stats.ts` import と同じ処理を、パッケージスケールで行うものです。

## 構成して実行する

```yaml
- name: '@deepseek-ai/dsh-system-prompt'
- name: '@deepseek-ai/dsh-tools'
- name: './tool-logger.ts'
- name: './greet-tool.ts'
```

`@deepseek-ai/dsh-tools` は、ツールがシステムプロンプトにスキーマを提供するため、`systemPrompt` サービスを注入します。そのため、この構成にはそのプロバイダーも列挙します。これがない場合、[第 6 章](06-composition-and-hmr.md)で説明したとおり、ツールプラグインは PENDING のままになります。

```sh
node --import tsx ../../vendor/cordis/bin.js
```

```
[tool-logger] greet -> Hello, Cordis!
tool replied: [{"type":"text","text":"Hello, Cordis!"}]
```

ロガーが先に実行されました。`tools/result` は結果の実体化の一部として発行され、`execute` の promise が呼び出し元に解決される前に発生します。どちらのプラグインも、もう一方の存在を認識していません。レジストリサービスとイベントが両者を接続します。

## ここから完全なエージェントへ

実際のエージェントは、この構成にさらにプラグインを加えたものです。LLM アダプター、エージェントループ、永続化、エントリポイントが含まれます。[examples/headless-agent/cordis.yml](../../examples/headless-agent/cordis.yml)を比較してください。これで、その中のすべてのエントリを読めるはずです。`greet-tool.ts` をこのファイルのコピーに追加します。

次に進む場所:

- [ツールを構築する](../user/develop/basic/tool.md) — 表現方法やより豊富なスキーマを含む、`defineTool` の詳細です。
- [3 層の機能設計](../user/develop/practice/index.md) — harness が置き換え可能な機能をどのように構成するかを説明します。
- [サブシステムページ](../subsystems/core.md)上の、生成された `cordis-surface` 領域 — 注入またはリッスンできるすべてのものが、それぞれの所有ページに記載されています。
- [アーキテクチャ](../architecture.md) — これらのプラグインが存在するシステムマップです。
