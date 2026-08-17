# 4. イベント

サービスは直接呼び出しをサポートします。一方、**イベント** を使うと、どのプラグインが受信するかを知らずに、プラグインが何かを通知できます。Harness は、ツール結果、モデルリクエスト、承認判断などのやり取りにイベントを使用します。

## 宣言、送出、リッスン

`stats.ts` に `tmp/cordis-tutorial` を作成します。これは値を数え、変更のたびに通知するサービスです。

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    stats: StatsService
  }
  interface Events {
    'stats/report'(name: string, count: number): void
  }
}

export class StatsService extends Service {
  private counts = new Map<string, number>()

  constructor(ctx: Context) {
    super(ctx, 'stats')
  }

  bump(name: string) {
    const next = (this.counts.get(name) ?? 0) + 1
    this.counts.set(name, next)
    this.ctx.emit('stats/report', name, next)
  }
}

export const name = 'stats'

export function apply(ctx: Context) {
  ctx.plugin(StatsService)
}
```

`interface Events` のマージは、第 3 章の `interface Context` マージに対応するイベントシステム側の仕組みです。イベント名とリスナーシグネチャを宣言するため、`ctx.emit` と `ctx.on` は完全に型付けされます。`namespace/action` の命名規則により、フラットなイベント名前空間を読みやすく保てます。

`reporter.ts` を作成します。

```ts ignore-check
import type { Context } from '@deepseek-ai/cordis'
import type {} from './stats.ts'

export const name = 'reporter'
export const inject = ['stats']

export function apply(ctx: Context) {
  ctx.on('stats/report', (name, count) => {
    console.log(`[stats] ${name} -> ${count}`)
  })
  ctx.stats.bump('tool_call')
  ctx.stats.bump('tool_call')
  ctx.stats.bump('prompt')
}
```

`import type {} from './stats.ts'` の行は実行時には何もインポートしません。TypeScript が宣言マージを認識するために存在します。合成して実行します。

```yaml
- name: './stats.ts'
- name: './reporter.ts'
```

```
[stats] tool_call -> 1
[stats] tool_call -> 2
[stats] prompt -> 1
```

`ctx.on()` はエフェクトであるため、プラグインとともにリスナーも消えます。`removeListener` を手作業で管理する必要はありません。

## ディスパッチモード

`emit` は 5 つのディスパッチモードの 1 つです。イベントが使用するモードはその契約の一部であり、リスナーが値を返せるか、並行して実行できるか、相互にショートサーキットできるかを決めます。

| モード | 呼び出し | セマンティクス |
|---|---|---|
| emit | `ctx.emit(name, ...args)` | 同期ブロードキャストです。返された Promise と値は待機も収集もされません。 |
| parallel | `await ctx.parallel(name, ...args)` | すべてのリスナーが並行して実行され、まとめて待機されます。 |
| serial | `await ctx.serial(name, ...args)` | リスナーは順番に実行・待機されます。最初の `null`/`false`/`undefined` 以外の戻り値が採用され、以降の実行を停止します。 |
| bail | `ctx.bail(name, ...args)` | serial の同期版です。 |
| waterfall | `ctx.waterfall(name, ...args, next)` | Around ミドルウェアです。以下を参照してください。 |

各 Harness イベントは、所有する[サブシステムページ](../subsystems/core.md)の生成済みリファレンスにモードを記載しています。

## Waterfall: 変換またはショートサーキット

Waterfall はインターセプトを実現するモードです。各リスナーは引数に加えて `next()` 継続を受け取り、`next()` が返すものを変換するか、`next()` を呼び出さずに返してチェーンの残りをショートサーキットできます。Cordis のドキュメントではこれを veto と呼びます。`waterfall-demo.ts` を作成します。

```ts
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'demo/transform'(input: string, next: () => Promise<string>): Promise<string>
  }
}

export const name = 'waterfall-demo'

export function apply(ctx: Context) {
  // Listener 1: wrap the downstream result.
  ctx.on('demo/transform', async (input, next) => {
    const downstream = await next()
    return downstream.toUpperCase()
  })

  // Listener 2: short-circuit when it owns the decision.
  ctx.on('demo/transform', async (input, next) => {
    if (input.includes('blocked')) return '** blocked **'
    return next()
  })

  void (async () => {
    console.log(await ctx.waterfall('demo/transform', 'hello', async () => 'hello'))
    console.log(await ctx.waterfall('demo/transform', 'blocked words', async () => 'blocked words'))
  })()
}
```

`cordis.yml` がこのファイルだけを指すようにして実行します。

```
HELLO
** BLOCKED **
```

2 行目を確認します。リスナー 1 が最初に実行され、`next()` を呼び出すとリスナー 2 が起動します。リスナー 2 は `blocked` を確認して `next()` を呼び出さずに返します。そのため、最も内側のデフォルト（`ctx.waterfall` に渡された関数）は実行されず、リスナー 1 は戻る途中で置換メッセージを大文字にします。

次の規律に従ってください。**観察または注釈付けのみを行う waterfall リスナーは、必ず `next()` を呼び出す必要があります**。これを呼び出さずに返すことは、意図的なショートサーキットです。ロギングリスナーで `next()` を忘れると、下流にいるすべてのプラグインのデフォルト動作が静かに失われます。これはこのリポジトリの常設ルールです（[waterfall のセマンティクス](../cordis-primer.md#cordis-waterfall-semantics)）。

Harness は、協調するプラグインがラップまたは応答できる判断に waterfall を使用します。[`agent/request`](../subsystems/core.md#agentrequest--waterfall) によりプラグインはモデル呼び出し設定を置き換えられ、[`approval/request`](../subsystems/approval.md#approvalrequest--waterfall) によりポリシーはユーザーの代わりに応答できます。

次へ: [設定](05-config.md) — `cordis.yml` からのプラグインオプション。
