# サービスと依存関係

サービスとは、あるプラグインが他のプラグインに公開する機能です。`inject` は、プラグインが必要とするサービスを宣言します。

## サービスとは

Harness では、`tools`、`llm`、および `agents` がサービスです。いずれも `ctx` にマウントされる名前付きの機能です。

```ts ignore-check
ctx.tools    // ToolRuntime service
ctx.llm      // LLM service
ctx.agents   // Agent service
```

どのプラグインも、他のプラグインが利用するサービスを提供できます。

## サービスを利用する

既存のサービスを利用するには、`inject` を宣言します。

```ts ignore-check
export const inject = ['tools']

export function apply(ctx: Context) {
  // ctx.tools exists and is ready here.
  ctx.tools.register(/* ... */)
}
```

`apply` が実行されるとき、`inject` で宣言されたすべてのサービスは準備完了しています。サービスの準備が完了していない場合、プラグインは実行せずに待機します。

## サービスを提供する

### Service を拡張する

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

export default class MetricsService extends Service {
  static inject = ['llm']  // A service may depend on other services.

  constructor(ctx: Context) {
    super(ctx, 'metrics')  // 'metrics' is the service name.
  }

  // Public service method.
  record(event: string, value: number) {
    // ...
  }
}
```

このプラグインを読み込むと、コンシューマーは `ctx.metrics` としてサービスにアクセスできます。

```ts ignore-check
export const inject = ['metrics']

export function apply(ctx: Context) {
  ctx.metrics.record('tool_call', 1)
}
```

### 型を宣言する

TypeScript の宣言マージを使用して、`ctx.metrics` に型を付けます。

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    metrics: MetricsService
  }
}

export default class MetricsService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'metrics')
  }

  record(event: string, value: number) { /* ... */ }
}
```

## 依存関係の動作

### 必須および任意の依存関係

```ts ignore-check
// Required: the plugin does not load while the service is absent.
export const inject = ['tools']

// Optional: omit inject and query with ctx.get() at the use site.
export function apply(ctx: Context) {
  const metrics = ctx.get('metrics')
  metrics?.record('plugin_loaded', 1)
}
```

### サービスが利用できなくなった場合

アプリケーションの実行中に、たとえばプロバイダーがアンロードされたことで必須サービスが利用できなくなった場合は、次のようになります。

1. 依存するプラグインは自動的に破棄されます。
2. サービスが復帰すると、それらは再度読み込まれます。

これにより、プラグインが存在しなくなったサービスを呼び出すことを防ぎます。

## サービスの分離

`cordis.yml` ではサービスを分離できるため、別々のプラグイングループから同じサービスの別インスタンスを参照できます。

```yaml
- id: group-a
  name: '@deepseek-ai/cordis-plugin-group'
  group: true
  isolate:
    shell: true
  config:
    - name: '@deepseek-ai/dsh-bash-local'
      config:
        timeoutMs: 5000
    - name: './src/plugin-a.ts'

- id: group-b
  name: '@deepseek-ai/cordis-plugin-group'
  group: true
  isolate:
    shell: true
  config:
    - name: '@deepseek-ai/dsh-bash-local'
      config:
        timeoutMs: 60000
    - name: './src/plugin-b.ts'
```

`plugin-a` と `plugin-b` はそれぞれ、自身のグループ内の Bash インスタンスを参照し、グループ間で影響することはありません。

## 組み込み Harness サービス

リポジトリは、サービス名、公開メソッド、ソースの場所を各サービスの [サブシステムページ](../../../subsystems/core.md) に生成します。プラグインの開発時には、これらの生成領域とサービスの TypeScript インターフェースを使用してください。別の静的リストを保守しないでください。

## 次のステップ

- [イベントシステム](./events.md) — 密結合せずにプラグイン間で通信する
- [機能の階層化](../practice/) — サービスを機能インターフェースとして使用する
