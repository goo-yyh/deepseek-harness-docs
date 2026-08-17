# 6. 構成と HMR

ここまでに構築したすべての機能はプラグインであり、`cordis.yml` がアプリケーションのプラグインツリーを選択します。この章ではその構成を変更し、プラグインをホットリロードして、読み込まれないプラグインを診断します。

## エントリは名前以上のものです

設定エントリは、`name` と `config` 以外のメタデータも受け取れます。

```yaml
- id: greeter          # stable identity for this entry
  name: './greeter.ts'
- id: consumer
  name: './consumer.ts'
  disabled: true       # keep the entry, skip mounting it
```

`id` はエントリに安定した識別子を与えるため、ローダーは既存エントリの編集と、削除後の追加を区別できます。`disabled: true` はエントリを削除せずにプラグインをアンマウントします。元に戻すと、プラグイン（およびそのサービスを PENDING 中のすべてのもの）が再び読み込まれます。

グループは、1 つの単位として読み込みとアンロードを行うエントリのサブリストを入れ子にします。また、`isolate` はグループにサービス名の独自インスタンスを与えます。2 つのグループが、互いに影響せずに、それぞれ異なる設定の `shell` プロバイダーを参照できます。詳細は、[Cordis 入門](../cordis-primer.md) と [サービス分離の例](../user/develop/framework/service.md#service-isolation) を参照してください。

## ホットモジュール置換

アンロードによって副作用が解放され（[第 2 章](02-lifecycle-and-effects.md)）、読み込みは依存関係に従うため（[第 3 章](03-services.md)）、HMR は実行中のプラグインをアンロードしてから読み込むことで置き換えられます。`@deepseek-ai/cordis-plugin-hmr` プラグインはファイルを監視し、保存時にまさにそれを実行します。

`tmp/cordis-tutorial` に、`cordis.yml` を記述します。

```yaml
- id: logger
  name: '@deepseek-ai/cordis-plugin-logger-console'
- id: timer
  name: '@deepseek-ai/cordis-plugin-timer'
- id: hmr
  name: '@deepseek-ai/cordis-plugin-hmr'
  config:
    root: ['.']
- id: hello
  name: './hello.ts'
```

2 つの補助プラグインがリストに加わりました。HMR は Cordis の logger サービスを介してログを出力するため、コンソールエクスポーターがなければメッセージは表示されません。また、デバウンスのために `timer` サービスを `inject` します。`@deepseek-ai/cordis-plugin-timer` がなければ、何も出力せずに永遠に PENDING のままです。その沈黙が次の節のテーマです。

HMR は Loader のネイティブヘルパーを通じて Node のローダー内部を読み取ります。Cordis は tsx で実行してください。

```sh
node --import tsx ../../vendor/cordis/bin.js
```

次に `hello.ts` を編集し、ログメッセージを変更して保存します。

```
hello from my first plugin
2026-07-22 15:44:36 [I] hmr watching [ '.' ]
2026-07-22 15:44:39 [I] hmr reload plugin at hello.ts
hello from my EDITED plugin
```

古いインスタンスはアンロードされ（そのすべての副作用が巻き戻され）、新しいコードが読み込まれ、`apply` が再度実行されました。Ctrl-C でプロセスを停止します。`cordis.yml` 自体の編集も検出されます。ローダーは `id` によってエントリを差分比較し、変更されたものだけをマウント、アンマウント、または再設定します。これが、上記のエントリに明示的な `id` が付いている理由です。これがないエントリには読み取りのたびに生成された id が付与されるため、設定ファイルを編集すると、そのエントリ自身の行が変わっていなくても、削除後の追加として扱われて再マウントされます。

## 読み込まれないプラグインを診断する

依存関係駆動の読み込みには裏面もあります。`inject` が誰も提供していないサービスを指定するプラグインは、何も出力せずに永遠に待機します。エラーではありません。プロバイダーは後からマウントされる場合があるため、PENDING は正当な状態です。

状態は直接確認できます。すべてのコンテキストはプラグインレジストリを列挙できます。`diagnose.ts` を作成します。

```ts
import { FiberState, type Context } from '@deepseek-ai/cordis'

export const name = 'diagnose'

export function apply(ctx: Context) {
  setTimeout(() => {
    for (const runtime of ctx.registry.values()) {
      for (const fiber of runtime.fibers) {
        if (fiber.state === FiberState.PENDING) {
          console.log(`${fiber.name} is PENDING — a required service is missing`)
        }
      }
    }
  }, 500)
}
```

そして、満たせない依存関係を持つプラグイン `needs-timer.ts` を作成します。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'needs-timer'
export const inject = ['timer']

export function apply(ctx: Context) {
  console.log('needs-timer loaded')
}
```

```yaml
- name: './needs-timer.ts'
- name: './diagnose.ts'
```

これを実行します（通常の `node --import tsx ../../vendor/cordis/bin.js` を使用します。Ctrl-C で停止します）。

```
needs-timer is PENDING — a required service is missing
```

`inject: ['timer']` にはプロバイダーがありません。リストに `- name: '@deepseek-ai/cordis-plugin-timer'` を追加すると、プラグインが読み込まれます。プラグインが何もせず、何も報告しない場合は、その fiber 状態を調べてください。PENDING フィルターを使わずに反復すると、プラグインが設定ファイル自体をマウントするため、ローダー自身のプラグイン（Loader、Include）も ACTIVE の fiber として表示されます。

次へ：[ハーネスの内部へ](07-into-the-harness.md) — 実際のハーネスサービスに対して同じパターンを適用します。
