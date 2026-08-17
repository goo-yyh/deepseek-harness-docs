# ツールを構築する

このチュートリアルでは、Web UI に `greet` ツールを追加します。まず [最初のプラグイン](./) を完了し、その `scratch-plugin` ディレクトリを保持してください。

## ツールプラグインを作成する

`scratch-plugin/src/my-plugin.ts` を次の内容に置き換えます。

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'greet-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet someone by name.',
    parameters: {
      name: { type: 'string', required: true, description: 'The name to greet' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `Hello, ${args.name}!`
    },
  }))
}
```

`inject` により、Cordis はツールレジストリを待機します。`defineTool` は `parameters` から `args` を推論して検証します。`execute` は `output.schema` で宣言された正規値を返し、`output.render` はその値をモデル向けコンテンツに変換します。

## ツールを実行して呼び出す

開発コマンドが実行されていない場合は、再起動します。

```sh
pnpm dsh web --patch ./scratch-plugin/cordis.yml
```

`http://127.0.0.1:3080` を開き、次のように質問します。`Use the greet tool to greet Ada.` モデルは `greet` を呼び出せ、ツール結果として `Hello, Ada!` を受け取ります。

## 次のステップ

- [プラグイン設定](./config.md) — 挨拶を設定可能にします。
- [ツール作成リファレンス](../../../cookbook/adding-a-tool.md) — ネストされたスキーマ、正規値、バックグラウンド処理、ポリシーフック、Code Mode、UI カードを確認します。
- [機能のレイヤリング](../practice/) — 置き換え可能な機能を、サービス定義、サービスプロバイダー、コンシューマーのパッケージに分割します。
