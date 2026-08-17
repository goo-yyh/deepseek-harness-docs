# 2. ライフサイクルとエフェクト

Cordis プラグインは、設定の編集、ホットリロード、明示的な破棄、または必須サービスの喪失によってアンロードされることがあります。Cordis API を通じて行われた登録はエフェクトであり、所有するプラグインがアンロードされると元に戻されます。これらの API の外部で管理するリソースは、`ctx.effect()` でラップする必要があります。

## エフェクト

Cordis がすでに管理していないリソース（タイマー、接続、ウォッチャーなど）は、`ctx.effect()` でラップし、disposer を返します。

`tmp/cordis-tutorial` に `lifecycle.ts` を作成します。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'lifecycle-demo'

function heartbeat(ctx: Context) {
  console.log('heartbeat plugin loading')
  ctx.effect(() => {
    const timer = setInterval(() => console.log('tick'), 200)
    return () => {
      clearInterval(timer)
      console.log('heartbeat cleaned up')
    }
  })
}

export function apply(ctx: Context) {
  // Mount a child plugin and keep its fiber to dispose it later.
  const fiber = ctx.plugin(heartbeat)
  // The demo timer is itself an effect: if THIS plugin is unloaded first,
  // the pending callback is cancelled instead of firing on a dead app.
  ctx.effect(() => {
    const timer = setTimeout(async () => {
      await fiber.dispose()
      console.log('disposed')
      process.exit(0)
    }, 700)
    return () => clearTimeout(timer)
  })
}
```

`cordis.yml` をそれに向けます。

```yaml
- name: './lifecycle.ts'
```

（`node --import tsx ../../vendor/cordis/bin.js`）を実行すると、次のようになります。

```
heartbeat plugin loading
tick
tick
tick
heartbeat cleaned up
disposed
```

注目すべき点は 3 つあります。

- `ctx.plugin(heartbeat)` は、**コードから** 関数をプラグインとしてマウントします。これは、YAML ローダーが各設定エントリに対して行うのと同じ操作です。関数プラグインには `apply` メソッドは不要です。Cordis は関数を直接呼び出し、その名前は診断にのみ使用します。`apply` メソッドが必要なのは、オブジェクト形式の `ctx.plugin({ apply(ctx) { /* ... */ } })` だけです。この呼び出しは、読み込まれた 1 つのプラグインインスタンスのランタイムハンドルである**ファイバー**を返します。
- エフェクト本体はロード中に実行され、返された disposer はアンロード中に実行されます。プラグインの存続期間に属するリソースについて、disposer を自分で呼び出す必要はありません。
- `fiber.dispose()` は、非同期 disposer を含むプラグインのすべてのクリーンアップが完了した後に解決され、そのプラグインがマウントした子プラグインを再帰的にアンロードします。

## ファイバーの状態遷移

ロードされた各プラグインインスタンスは、次の状態を遷移するファイバーを所有します。

```
PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED
                 ↘ FAILED
```

- **PENDING** — 宣言済みですが、必須サービス（第 3 章）がまだ利用できません。
- **LOADING / ACTIVE** — `apply` が実行中です／完了しています。
- **FAILED** — `apply` または設定検証で例外が発生しました。
- **UNLOADING / DISPOSED** — disposer が実行中です／すべて破棄されています。

PENDING については、[第 6 章](06-composition-and-hmr.md)で再び扱います。ここでは「なぜプラグインが何も出力しないのか？」への一般的な答えです。

## すでにエフェクトであるもの

組み込みの登録 API はすでにエフェクトであるため、`ctx.effect()` を自分で記述することはほとんどありません。

- `ctx.on(event, listener)` — アンロード時にリスナーが削除されます（[第 4 章](04-events.md)）。
- `ctx.plugin(child)` — 子は親とともに破棄されます。
- サービス登録はエフェクトです。`ctx.tools.register(...)` などの Harness レジストリも、返された disposer を呼び出し元のプラグインに関連付けるため、自動的に巻き戻されます（[第 7 章](07-into-the-harness.md)）。

Cordis が管理しないリソースでは、`ctx.effect()` 内で取得し、それを解放する disposer を返します。すると Cordis は、ホットリロードを含むアンロード時にその解放処理を呼び出します。

順序に関する注意点が 1 つあります。disposer は登録の逆順に開始されますが、複数の**非同期**  disposer は並行して実行されます。破棄手順を順番に実行する必要がある場合は、1 つの disposer にまとめ、そこで await してください。

次へ: [サービス](03-services.md) — プラグイン間で機能を共有する方法。
