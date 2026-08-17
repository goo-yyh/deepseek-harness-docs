# プラグイン設定

`cordis.yml` を通じて提供される設定を受け取ります。

## Config 型を定義する

`Config` 型と、同名の Schemastery スキーマをエクスポートします。デフォルト値はスキーマのフィールドに直接指定します。

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'my-plugin'

export interface Config {
  greeting: string
  maxRetries: number
  verbose?: boolean
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  maxRetries: Schema.number().default(3),
  verbose: Schema.boolean().default(false),
})

export function apply(ctx: Context, config: Config) {
  console.log(config.greeting)  // User value or schema default.
}
```

`scratch-plugin/cordis.yml` の挿入済みローカルプラグイン行に設定を追加します。

```yaml
- insert:
    - id: hello
      name: './src/my-plugin.ts'
      config:
        greeting: 'Hi there'
        maxRetries: 5
```

プラグインの読み込み時、Cordis はエクスポートされたスキーマを使用して設定を検証し、デフォルト値を補います。`Config` としてプレーンオブジェクトをエクスポートしないでください。これは Cordis が必要とする Standard Schema インターフェースを実装していません。

## スキーマ検証

Schemastery を使用して、より厳格な検証を表現します。

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'validated-plugin'

export interface Config {
  apiKey: string
  timeout: number
  mode: 'fast' | 'accurate'
}

export const Config = Schema.object({
  apiKey: Schema.string().required(),
  timeout: Schema.number().default(30000),
  mode: Schema.union(['fast', 'accurate']).default('fast'),
})

export function apply(ctx: Context, config: Config) {
  // config is validated and type-safe.
}
```

スキーマはプラグインの読み込み中に実行されます。無効な設定の場合は、対処可能なエラーとともに読み込みに失敗します。

## 設計原則

### 調整可能な値をハードコードしない

Harness では、**2 つのデプロイで異なる値を設定したい可能性があるものはすべて設定フィールドにする必要があります**。

```ts
// Wrong: hardcoded timeout.
const TIMEOUT = 30000

// Correct: configurable.
export interface Config {
  timeoutMs: number  // Defaults to 30000.
}
```

コードを編集せずに `cordis.yml` が値を変更できるかどうかが判断基準です。

### 無効な設定では明確に失敗させる

自己完結した制約はスキーマで表現し、無効な設定ではプラグインの読み込み中に失敗するようにします。サービスまたは登録済みリソースへの参照には依存性注入が必要です。その契約については、[サービスのチュートリアル](../framework/service.md)で紹介しています。

## HMR に対応する

設定を編集すると、プラグインはホットリプレースされます。フレームワークは古いインスタンスをアンロードし、新しいインスタンスを読み込みます。登録は副作用であり、自動的にクリーンアップされるため、置き換え後に古いインスタンスの登録が残ることはありません。

## 次のステップ

- [プラグインをパッケージ化してインストールする](./publish.md) — プラグインをインストール可能なパッケージとして配布します
- [プラグインとライフサイクル](../framework/) — プラグインの完全なライフサイクルを理解します
- [サービスと依存関係](../framework/service.md) — 他のプラグインにサービスを提供します
