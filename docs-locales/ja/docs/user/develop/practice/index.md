# 3 つの役割による機能設計

このページは、3 つの役割による機能パターンの概念リファレンスと、1 つの機能を構築する高度なチュートリアルの 2 部構成です。先に[基本プラグインの手順](../basic/)と[サービスのチュートリアル](../framework/service.md)を完了してください。

## 概念リファレンス

Bash 実行のように、置き換え可能なプロバイダーを必要とするほど汎用的な機能では、Harness は 3 つの役割に分離します。**サービス定義**、**サービスプロバイダー**、**コンシューマー**です。役割を個別に進化または置き換える必要がある場合は、別々のパッケージに配置します。それ以外の場合、1 つのパッケージが複数の役割を所有してもかまいません。完全な機能がその接続点です。個々の役割は接続点ではありません。

## Bash の例

Bash 実行機能は次の要素で構成されます。

- **サービス定義** (`dsh-shell`) — Cordis サービスと Bash のリクエストおよび結果の型を定義します
- **サービスプロバイダー** (`dsh-bash-local`) — ローカルマシン上でコマンドを実行します
- **コンシューマー** (`dsh-tool-bash`) — 機能をモデルから呼び出し可能なツールとして公開します

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│  dsh-shell   │────▶│  dsh-bash-local  │     │ dsh-tool-bash│
│(definition) │     │    (provider)     │     │(consumer/tool)│
└─────────────┘     └──────────────────┘     └──────────────┘
       ▲                                            │
       └────────────────────────────────────────────┘
                    inject: ['shell']
```

## 分離の利点

### プロバイダーを置き換える

1 つのサービス定義には、`cordis.yml`を通じて選択される複数のプロバイダーを設定できます。

```yaml
# Local execution
- name: '@deepseek-ai/dsh-bash-local'

# Replace this row with another package that provides the same service.
```

プロバイダーが変わっても、サービス定義とツールは変わりません。

### 個別に進化させる

- 呼び出し元がその契約に依存した後は、サービス定義が変更されることはほとんどありません。
- サービスプロバイダーは、パフォーマンスとセキュリティを個別に改善できます。
- コンシューマーは、機能をモデルに提示する方法を変更できます。

### 依存関係を分離する

- サービスプロバイダーはサービス定義に依存します。
- コンシューマーはサービス定義に依存します。
- サービスプロバイダーとコンシューマーは**互いに依存しません**。

[機能接続点のリファレンス](../../../capability-seams.md)では、現在組み込み済みのファミリーとパッケージリンクを扱います。

## チュートリアル: 3 つの役割による機能を開発する

### ステップ 1: サービス定義を作成する

```ts ignore-check
// packages/my-cap/my-cap/src/index.ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    myCap: MyCapService
  }
}

export abstract class MyCapService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'myCap')
  }

  /** Execute the capability. */
  abstract execute(request: MyCapRequest): Promise<MyCapResult>
}

export interface MyCapRequest {
  input: string
}

export interface MyCapResult {
  output: string
}
```

### ステップ 2: サービスプロバイダーを作成する

```ts ignore-check
// packages/my-cap/my-cap-local/src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import { MyCapService, type MyCapRequest, type MyCapResult } from '@deepseek-ai/dsh-my-cap'

class MyCapLocal extends MyCapService {
  async execute(request: MyCapRequest): Promise<MyCapResult> {
    // Local provider behavior.
    return { output: request.input.toUpperCase() }
  }
}

export const name = 'my-cap-local'

export function apply(ctx: Context) {
  ctx.plugin(MyCapLocal)
}
```

### ステップ 3: コンシューマーを作成する

```ts ignore-check
// packages/my-cap/tool-my-cap/src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-my-cap'
export const inject = ['tools', 'myCap']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'my_cap',
    description: 'Execute my capability.',
    parameters: {
      input: { type: 'string', required: true },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const result = await ctx.myCap.execute({ input: args.input })
      return result.output
    },
  }))
}
```

### cordis.yml で構成する

```yaml
- name: '@deepseek-ai/dsh-my-cap-local'
- name: '@deepseek-ai/dsh-tool-my-cap'
```

## 設計上のポイント

- **早まって分離しない** — 役割を個別に進化させる必要がある場合にのみ、別々のパッケージを使用してください。単純なツールプラグインには必要ありません。
- **サービス定義が Request/Result 型を所有する** — サービスプロバイダーとコンシューマーは、サービス定義パッケージにのみ依存します。
- **明示的な方法を暗黙的な方法より優先する** — `run()`内に`?? default`式を隠すのではなく、明示的な`resolve(request): Spec`ステップでデフォルトを解決してください。

## 次のステップ

- [LLM アダプター](./llm-adapter.md) — LLM プロバイダーを実装する
