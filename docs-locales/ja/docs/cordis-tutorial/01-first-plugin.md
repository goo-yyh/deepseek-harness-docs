# 1. 最初のプラグイン

ここで使用するローダー設定では、Cordis プラグインモジュールが `apply` 関数を名前付きエクスポートします。Cordis はこれを読み込むと、プラグインが提供するすべての要素を登録するための `ctx` オブジェクトである **context**  を引数として `apply` を呼び出します。

## プラグインを書く

`tmp/cordis-tutorial` ディレクトリ内に（[セットアップ](index.md#setup)を参照）、`hello.ts` を作成します。

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello'

export function apply(ctx: Context) {
  console.log('hello from my first plugin')
}
```

`name` エクスポートは任意の表示メタデータであり、診断情報でプラグインにラベルを付けます。

## アプリを構成する

このチュートリアルのランチャーは、設定からアプリケーションを組み立てます。`cordis.yml` を作成します。

```yaml
- name: './hello.ts'
```

このファイルはプラグインエントリのリストです。`name` はモジュール指定子、つまり相対パスまたは npm パッケージ名であり、ローダーはすべてのエントリをマウントします。エントリは同時に開始されるため、リスト上の位置によってどのプラグインが先に読み込まれるかは保証されません。順序はファイル内の位置ではなく、サービスの依存関係（`inject`、[第 3 章](03-services.md)）によって決まります。

## 実行する

```sh
node --import tsx ../../vendor/cordis/bin.js
```

想定される出力:

```
hello from my first plugin
```

実行中のものがなくなると、プロセスは自動的に終了します。起きたことは次のとおりです。

1. ランチャーがルート `Context` を作成し、**Loader**  プラグインをマウントしました。
2. Loader は `cordis.yml` を読み取り、`./hello.ts` を解決して、子プラグインとしてマウントしました。
3. Cordis があなたの `apply(ctx)` を呼び出しました。

ファイル内にフレームワークのブートストラップコードはありません。プラグインは提供するものを記述し、`cordis.yml` がアプリケーションを構成します。たとえば、[`dsh` ベース](../../packages/bundle/base/cordis.patch.yml)は、デプロイメントのオーバーレイがパッチを適用する、より長いプラグイン構成です。

## その他 2 つのプラグイン形式

関数形式が最も一般的ですが、Cordis では次の 3 つを受け付けます。

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

// 1. Function plugin (what you just wrote).
export function apply(ctx: Context) {}

// 2. Object plugin: an object with an `apply` method.
export const objectPlugin = {
  name: 'object-plugin',
  apply(ctx: Context) {},
}

// 3. Class plugin: a Service subclass (covered in chapter 3).
export class MyService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'myTutorialService')
  }
}
```

サービスを公開する必要が生じるまでは関数形式を使用してください。クラス形式が必要になる場面については、[第 3 章](03-services.md)で説明します。

## 壊して試す

`apply` で例外をスローさせます。

```ts ignore-check
export function apply(ctx: Context) {
  throw new Error('apply exploded')
}
```

再度実行すると、プロセスはそのエラーで終了します。読み込みに失敗したプラグインは、スキップされるエントリではなく、明示的な失敗として扱われます。

早めに知っておくべき注意点が 1 つあります。モジュールを **解決できない** 設定エントリ、たとえばパスやパッケージ名のタイプミスは、プロセスをクラッシュさせる代わりに Cordis のロガーサービスを通じて報告されます。起動時には、コンソールエクスポーターが監視を始める前にこの報告が失われることがあります。新しく追加したエントリが何もしないように見える場合は、まずスペルを確認してください。

次へ: [ライフサイクルと効果](02-lifecycle-and-effects.md) — プラグインがアンロードされると何が起こるかを説明します。
