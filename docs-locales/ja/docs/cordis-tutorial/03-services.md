# 3. サービス

**サービス** とは、あるプラグインが提供し、他のプラグインが `ctx` を通じて利用する、名前付きの機能です。ハーネスでは、`ctx.tools`、`ctx.llm`、`ctx.agents` がサービスです。コンシューマーはプロバイダーをインポートするのではなく、たとえば `'tools'` のように機能を名前で指定します。これにより、コンシューマーを変更せずに設定でプロバイダーを選択できます。

## サービスを提供する

`greeter.ts` に `tmp/cordis-tutorial` を作成します。

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    greeter: GreeterService
  }
}

export class GreeterService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'greeter')
  }

  greet(who: string) {
    return `Hello, ${who}!`
  }
}

export const name = 'greeter'

export function apply(ctx: Context) {
  ctx.plugin(GreeterService)
}
```

2 つの要素が連携します。

- **実行時**: `super(ctx, 'greeter')` が、インスタンスを `greeter` という名前で登録します。それ以降、どのプラグインからも `ctx.greeter` としてアクセスできます。この登録はエフェクトです。プロバイダーをアンロードすると、サービスも削除されます。
- **コンパイル時**: `declare module '@deepseek-ai/cordis'` ブロックは TypeScript の宣言マージです。`greeter` を `Context` インターフェースに追加するため、`ctx.greeter` がどこでも型チェックされます。コードは生成しません。これがなくてもサービスは実行時に動作しますが、コンシューマーは型安全性を失います。

`Service` のサブクラス自体がプラグイン（第 1 章のクラス形式）であるため、`ctx.plugin(GreeterService)` はほかのプラグインと同様にこれをマウントします。

## `inject` でサービスを利用する

`consumer.ts` を作成します。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'consumer'
export const inject = ['greeter']

export function apply(ctx: Context) {
  console.log(ctx.greeter.greet('world'))
}
```

`inject` は、このプラグインが必要とするサービスを列挙します。Cordis は、列挙されたすべてのサービスが存在するまでプラグインを PENDING に保持するため、`apply` 内では `ctx.greeter` の準備ができていることが保証されます。`cordis.yml` のロード順は重要ではありません。プラグインの開始時期を決めるのはファイル順ではなく依存関係です。

構成して実行します。

```yaml
- name: './greeter.ts'
- name: './consumer.ts'
```

```
Hello, world!
```

`cordis.yml` の 2 行を入れ替えて再実行しても、出力は同じです。`./greeter.ts` を完全に削除してみてください。コンシューマーは PENDING のままで何も出力し、クラッシュも部分実行も発生しません。PENDING のファイバーは Node のイベントループも維持しないため、ほかに実行中のものがない構成は何も表示せずに終了コード 0 で終了します。[第 6 章](06-composition-and-hmr.md)では、この状態を診断する方法を説明します。

## 依存関係はロード後も追跡される

`inject` は一度きりの起動チェックではありません。アプリの実行中に必要なサービスがなくなった場合、つまりプロバイダーがアンロードまたはホットリプレースされた場合は、依存するすべてのプラグインもアンロードされ、サービスが戻ると再びロードされます。これをエフェクト（[第 2 章](02-lifecycle-and-effects.md)）と組み合わせることで、実行中のコンシューマーが利用できないサービスへの参照を保持し続けることを防ぎます。依存関係がなくなると、コンシューマー自身の登録も巻き戻されます。

これが、設定でのサービス置換が機能する理由でもあります。`dsh-bash-local` エントリをアンロードし、別の `shell` プロバイダーをマウントすると、`'shell'` を注入しているすべてのプラグインが新しい実装に対して安全に再起動します。

## オプションの依存関係

`inject` は必須要件に使用します。プラグインがなくても動作できる機能には、`inject` を使わず、使用箇所で確認します。

```ts ignore-check
export function apply(ctx: Context) {
  // undefined when no provider is loaded; the plugin still runs.
  const greeter = ctx.get('greeter')
  console.log(greeter?.greet('maybe') ?? 'no greeter available')
}
```

## 命名

サービス名は、アプリケーションごとに 1 つのフラットな名前空間に存在します。独自のサービスには、ほかと区別できるプレフィックスまたは名前空間を付けてください（ハーネスは `tools` や `llm` のようなプレーンな名前を使用します）。[サブシステムのページ](../subsystems/core.md)にある自動生成された `cordis-surface` 領域には、ハーネスが登録するすべての名前が一覧表示されます。

次へ: [イベント](04-events.md) — 共有サービスを使わない通信。
