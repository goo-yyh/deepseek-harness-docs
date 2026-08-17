# イベントシステム

イベントは、Cordis プラグイン間の中核となる通信メカニズムです。Harness は、疎結合な拡張ポイントのためにイベントを幅広く使用します。

## 基本的な使用方法

### イベントをリッスンする

```ts ignore-check
ctx.on('event-name', (payload) => {
  // Handle the event.
})
```

### イベントを発行する

```ts ignore-check
ctx.emit('event-name', payload)
```

## イベントモード

Cordis では、さまざまな対話契約に対応する複数のイベントモードを提供しています。

### emit — ブロードキャスト

すべてのリスナーは同期的に実行され、戻り値は無視されます。

```ts ignore-check
// Emit
ctx.emit('my-plugin/ready', { id: 'worker-1' })

// Listen
ctx.on('my-plugin/ready', ({ id }) => {
  console.log(`${id} is ready`)
})
```

### bail — 短絡

リスナーは順番に実行され、`null`、`false`、`undefined`以外で最初に得られた結果が最終結果になります。

```ts ignore-check
// Dispatch
const result = ctx.bail('some-check', input)

// Listen: a returned value stops later listeners.
ctx.on('some-check', (input) => {
  if (shouldBlock(input)) return 'blocked'
  // Return null, false, or undefined to continue to the next listener.
})
```

### serial — 順序付き実行

リスナーは登録順に実行され、非同期の結果は await されます。`null`、`false`、`undefined`以外の結果が最初に得られると、それ以降の実行は停止します。

```ts ignore-check
await ctx.serial('setup-phase', context)
```

### waterfall — パイプライン

各リスナーは下流の結果をラップし、処理チェーンを構成できます。リスナーは、下流に委譲するために**必ず `next()` を呼び出す必要があります**。呼び出しを省略すると、パイプラインは短絡します。

```ts ignore-check
// Dispatch
const output = await ctx.waterfall('my-plugin/transform', input, async () => input)

// Listen: next() is mandatory.
ctx.on('my-plugin/transform', async (_input, next) => {
  const downstream = await next()
  return downstream.trim()
})
```

::: warning
waterfall リスナーは**必ず `next()` を呼び出す必要があります**。これを省略すると、設計どおりパイプラインが短絡し、インターセプトおよびゲートウェイの動作を実現できます。
:::

## 型付きイベント

Harness は、型安全なイベントのために TypeScript の宣言マージを使用します。

```ts
import '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'my-plugin/ready': (payload: { id: string }) => void
    'my-plugin/check': (input: string) => boolean | undefined
    'my-plugin/transform': (input: string, next: () => Promise<string>) => Promise<string>
  }
}

// ctx.on('my-plugin/ready', ...) and ctx.emit('my-plugin/ready', ...)
// are now inferred correctly.
```

## Cordis イベントとセッションレコード

Harness の Cordis イベントでは、`namespace/action`という名前を使用します。これには、`agent/step`、`agent/request`、`agent/request-error`、`tools/result`、`session/event`が含まれます。[サブシステムのページ](../../../subsystems/core.md)にある生成済みの`cordis-surface`領域には、完全なシグネチャとモードが記録されています。

`turn/*`、`step/*`、`tool/call`、`tool/result`、`compaction/*`は、同名の Cordis イベントではなく、永続的なセッションイベント型です。これらを監視するには、`session/event`をリッスンし、`event.type`を確認します。

## イベントリスナーはエフェクトです

`ctx.on()`で登録したリスナーは、そのプラグインがアンロードされると自動的に削除されます。

```ts ignore-check
export function apply(ctx: Context) {
  // This listener is removed when the plugin disposes.
  ctx.on('tools/result', handler)
}
```

## 例: ロギングプラグイン

このプラグインはツール呼び出しと結果をログに記録します。

```ts
import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-tools'

export const name = 'tool-logger'

export function apply(ctx: Context) {
  ctx.on('tools/result', (exec, result) => {
    console.log(`[tool] ${exec.name}(${JSON.stringify(exec.arguments)})`)
    const text = result.content
      .map(block => block.type === 'text' ? block.text : '')
      .join('')
    console.log(`[tool result] ${text.slice(0, 100)}`)
  })
}
```

## 次のステップ

- [機能のレイヤリング](../practice/) — 機能インターフェース内のイベントを理解する
- [LLM アダプター](../practice/llm-adapter.md) — 完全な LLM バックエンドを実装する
