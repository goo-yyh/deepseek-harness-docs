# 5. 設定

各`cordis.yml`エントリには`config`ブロックを含めることができ、プラグインは`apply`の実行前にそれを検証するスキーマを宣言します。不正な設定では、正確なエラーとともに読み込みが失敗します。プラグインが不完全な設定のまま起動することはありません。

## 設定可能なプラグイン

`tmp/cordis-tutorial`に`config-demo.ts`を作成します。

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'config-demo'

export interface Config {
  greeting: string
  targets: string[]
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  targets: Schema.array(String).default(['world']),
})

export function apply(ctx: Context, config: Config) {
  for (const target of config.targets) {
    console.log(`${config.greeting}, ${target}!`)
  }
}
```

エクスポートされる`Config`は、同じ名前を持つ TypeScript インターフェースであると同時に実行時スキーマでもあります。コンシューマーは型を取得し、Cordis はバリデーターを取得します。このリポジトリではスキーマに[Schemastery](https://github.com/shigma/schemastery)を使用します。Cordis 自体は任意の[Standard Schema](https://standardschema.dev/)バリデーターを受け入れるため、`Config`としてエクスポートしたプレーンオブジェクトは機能しません。

設定します。

```yaml
- name: './config-demo.ts'
  config:
    targets: ['alpha', 'beta']
```

実行します。

```
Hello, alpha!
Hello, beta!
```

`greeting`は省略されているため、スキーマのデフォルト値によって補われます。`apply`は常に完全で検証済みの設定を受け取ります。

## 明確に失敗させる

次に、不正な値を渡します。

```yaml
- name: './config-demo.ts'
  config:
    targets: 'not-an-array'
```

```
ValidationError: invalid config:
  - $.targets expected array but got not-an-array (at targets)
```

プラグインの fiber は FAILED になり、このチュートリアルのランチャーはエラーを出力した後、ステータス 1 で終了します。プラグインは、利用できないリソースまたはプロバイダーを指定するスキーマ上は有効な設定についても、その参照を解決できしだい拒否する必要があります。

## 計算される設定値

このリポジトリで使用するローダーは、読み込み時に計算する必要がある設定値向けに`!!js`タグをサポートしています。

```yaml
- name: './config-demo.ts'
  config:
    greeting: !!js process.env.DEMO_GREETING ?? 'Hello'
```

`!!js`は、`config`内およびエントリの`disabled`フィールド内でのみ機能します。`disabled: !!js ...`はマウント判定のたびにローダーコンテキストに対して評価されるため（このリポジトリの拡張）、行ごとにプラットフォームまたは環境で自身を制御できます。その他のメタデータ（`name`、`id`、`inject`、…）は静的なままです。そこでは式は通常の truthy なデータとして扱われます。[ローダー設定](../cordis-primer.md#loader-configuration)を参照してください。

次へ: [構成と HMR](06-composition-and-hmr.md) — `cordis.yml`をアプリケーションとして扱います。
