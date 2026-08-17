# プラグインとライフサイクル

このページでは、Cordis のプラグインモデルとライフサイクル状態マシンについて説明します。

## Fiber 状態マシン

読み込まれた各プラグインは、次の状態を持つ **Fiber** スコープを所有します。

```
PENDING → LOADING → ACTIVE
                 ↘ FAILED
ACTIVE → UNLOADING → DISPOSED
```

| 状態 | 意味 |
|------|------|
| PENDING | 宣言済みですが、必要な依存関係の準備ができていません |
| LOADING | 依存関係の準備が完了し、`apply` が実行中です |
| ACTIVE | プラグインが実行中です |
| FAILED | `apply` がエラーをスローしました |
| UNLOADING | プラグインをアンロードし、リソースを破棄しています |
| DISPOSED | プラグインは完全にアンロードされています |

## 依存関係に基づく読み込み

`inject` を持つプラグインは、読み込み前に必要なすべてのサービスを待機します。

```ts ignore-check
export const inject = ['tools', 'llm']

export function apply(ctx: Context) {
  // ctx.tools and ctx.llm are ready here.
}
```

たとえばプロバイダーの置き換え中に必要なサービスが消失すると、プラグインは自動的にアンロードされ（ACTIVE → DISPOSED）、サービスが戻ると再び読み込まれます。

## 自動クリーンアップ

`ctx` を通じて行われたすべての登録は、プラグインのアンロード時に取り消されます。

```ts ignore-check
export function apply(ctx: Context) {
  // Event listener: removed automatically on unload.
  ctx.on('some-event', handler)

  // Custom resource: the returned disposer runs on unload.
  ctx.effect(() => {
    const connection = createConnection()
    return () => connection.close()
  })
}
```

フレームワークは、これらすべての操作を追跡して破棄します。
- `ctx.on(event, handler)` — イベントリスナー
- `ctx.tools.register(tool)` — ツール登録
- `ctx.llm.registerAdapter(names, adapter)` — LLM アダプター登録
- `ctx.effect(() => cleanup)` — カスタムリソース

アンロード中、ディスポーザーの呼び出しは登録とは逆順に開始されますが、複数の非同期ディスポーザーは並行して実行され、直列の完了は保証されません。順序に依存するクリーンアップは、単一の `ctx.effect()` から返す 1 つのディスポーザーにまとめ、そこで各ステップを直列に await してください。

## ネストしたコンテキスト

`ctx.plugin()` は、親コンテキストを継承しつつ独立したライフサイクルを持つ子 Fiber を作成します。

```ts ignore-check
export function apply(ctx: Context) {
  // Register a child plugin.
  ctx.plugin(childPlugin)

  // The child has its own Fiber and unloads with its parent.
}
```

## 破棄のセマンティクス

プラグインインスタンスを早期に停止するには、次のようにします。

```ts
import type { Context } from '@deepseek-ai/cordis'

declare const ctx: Context
declare function myPlugin(ctx: Context): void

const fiber = ctx.plugin(myPlugin)

// Dispose it manually later.
await fiber.dispose()
```

`dispose` は次を保証します。
1. プラグインが所有するすべての登録が削除されます。
2. 子プラグインが再帰的にアンロードされます。
3. 返された Promise は、すべての非同期クリーンアップが完了した後に解決されます。

## ホット置き換え（HMR）

`@deepseek-ai/cordis-plugin-hmr` を `cordis.yml` から読み込んでいる場合、プラグインのソースファイルを編集すると次が実行されます。

1. 古いプラグインをアンロードし、その登録をクリーンアップします。
2. 新しいコードを読み込みます。
3. 新しい `apply` を実行します。

プラグインの登録は自動的にクリーンアップされるため、ホット置き換えで古いインスタンスの登録が保持されることはありません。

## ライフサイクルの例

```ts ignore-check
export function apply(ctx: Context) {
  console.log('plugin loading')

  ctx.effect(() => {
    console.log('effect registered')
    return () => console.log('effect cleaned up')
  })
}
```

読み込み時の出力:
```
plugin loading
effect registered
```

アンロード時の出力:
```
effect cleaned up
```

## 次のステップ

- [サービスと依存関係](./service.md) — 他のプラグインに機能を公開する
- [イベントシステム](./events.md) — プラグイン間で通信する
- [Cordis チュートリアル](../../../cordis-tutorial/index.md) — Cordis ランタイムを対象に、同じライフサイクル、サービス、イベントを段階的に構築する
