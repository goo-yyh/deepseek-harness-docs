# 最初のプラグイン

このチュートリアルでは、最小限の Harness プラグインを作成し、Web UI に読み込みます。[ソースから実行する手順](../../../../README.md#run-from-source)を完了したリポジトリのチェックアウトから始めてください。

## ローカルプロジェクトを作成する

リポジトリのルートから、チュートリアル用の一時プロジェクトを作成します。

```sh
mkdir -p scratch-plugin/src
```

## プラグインとは

Harness では、プラグインは `apply` 関数をエクスポートする TypeScript モジュールです。フレームワークはプラグインの読み込み時に `apply` を呼び出し、プラグインが機能を登録するための `ctx` コンテキストオブジェクトを渡します。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin'

export function apply(ctx: Context) {
  // Register capabilities here.
}
```

これで設定は完了です。

## プラグインファイルを作成する

`scratch-plugin/src/my-plugin.ts` を作成します。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello-plugin'

export function apply(ctx: Context) {
  // Required dependencies are ready before apply runs.
  console.log('[hello-plugin] plugin loaded!')
}
```

## cordis.yml に登録する

リポジトリのルートから `pwd` を実行し、ローカルプラグインを挿入する Web オーバーレイとして `scratch-plugin/cordis.yml` を作成します。以下の `/absolute/path/to/deepseek-harness` は出力されたパスに置き換えてください。

```yaml
- insert:
    - id: hello
      name: '/absolute/path/to/deepseek-harness/scratch-plugin/src/my-plugin.ts'
```

プラグインのパスは絶対パスである必要があります。パッチファイルは設定を提供しますが、ローダーがモジュールパスを解決するプロファイルディレクトリは変更しません。

そのオーバーレイを使用して Web UI を起動します。

```sh
pnpm dsh web --patch ./scratch-plugin/cordis.yml
```

`http://127.0.0.1:3080` を開きます。起動中にターミナルへ `[hello-plugin] plugin loaded!` が出力されます。

## 自動クリーンアップ

`ctx` を通じて登録されたイベントリスナー、ツール、タイマーなどは、プラグインのアンロード時にクリーンアップされます。removeListener や clearInterval を手動で呼び出す必要はありません。

ネットワーク接続のように明示的なクリーンアップが必要なリソースでは、`ctx.effect()` を使用して破棄関数を指定します。

```ts
import type { Context } from '@deepseek-ai/cordis'

export function apply(ctx: Context) {
  ctx.effect(() => {
    const timer = setInterval(() => {
      console.log('heartbeat')
    }, 5000)

    // The returned function runs when the plugin unloads.
    return () => clearInterval(timer)
  })
}
```

## 依存関係を宣言する

プラグインが `tools` や `llm` などの別のサービスを利用する場合は、`inject` で宣言します。

```ts ignore-check
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-tool-plugin'
export const inject = ['tools']

export function apply(ctx: Context) {
  // ctx.tools is ready here.
  ctx.tools.register(/* ... */)
}
```

フレームワークは、必要なすべてのサービスを待機してからプラグインを読み込みます。

## 3 つのプラグイン形式

関数モジュールに加えて、プラグインではオブジェクト形式またはクラス形式も使用できます。

### オブジェクト形式

```ts
import type { Context } from '@deepseek-ai/cordis'

export default {
  name: 'my-plugin',
  inject: ['tools'],
  apply(ctx: Context) {
    // ...
  },
}
```

### クラス形式

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

export default class MyService extends Service {
  static inject = ['tools']

  constructor(ctx: Context) {
    super(ctx, 'myService')
    // Perform synchronous initialization in the constructor.
  }
}
```

ほとんどの場合は関数形式で十分です。プラグインが他のプラグインにサービスを提供する場合はクラス形式を使用してください。[サービスと依存関係](../framework/service.md)を参照してください。

## 次のステップ

- [ツールを作成する](./tool.md) — ツール定義 DSL について学ぶ
- [プラグイン設定](./config.md) — ユーザー設定を受け取る
- [Cordis チュートリアル](../../../cordis-tutorial/index.md) — API キーなしの空のディレクトリから構築する、基盤となるプラグインフレームワーク
