# Cordis チュートリアル

Cordis は DeepSeek Harness を支えるプラグインフレームワークです。ツール、LLM アダプター、ファイルアクセス、エージェントループ自体などのすべての機能を、共有コンテキストにマウントするプラグインとして扱う小さなランタイムです。このチュートリアルでは Cordis を実践的に学びます。各章では、このリポジトリ内のスクラッチディレクトリで作成する実行可能な例を扱い、最後には実際の harness サービスに接続したプラグインを完成させます。

対象読者はエージェント開発者です。TypeScript の深い経験は必要ありません。以下の [TypeScript の解説](#typescript-notes) で不慣れな構文を説明しており、各章では正確なコマンドと期待される出力を示します。

手順ではなく要点をまとめたリファレンスを読みたい場合は、[Cordis 入門](../cordis-primer.md)を参照してください。網羅的な API リファレンスは、[サブシステムのページ](../subsystems/core.md)および[Cordis コア API](../cordis-api/context.md)のページにある生成済みの`cordis-surface`リージョンにあります。

harness 自体のプラグイン（以下のランチャーではなく、`cordis.yml`から読み込まれ Web UI で操作されるもの）を作成するには、[最初の Harness プラグイン](../user/develop/basic/index.md)から始めてください。

## セットアップ

依存関係をインストールしたこのリポジトリのクローンが必要です。前提条件は[開発ガイド](../development.md#setup-tutorial)に記載されています。このチュートリアルに API キーは必要ありません。すべての例はキーなしで実行できます。

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
```

各章で使用するスクラッチディレクトリを作成します。`tmp/`は gitignore の対象であるため、ここに書いた内容がバージョン管理に影響することはありません。

```sh
mkdir -p tmp/cordis-tutorial
cd tmp/cordis-tutorial
```

各章では、このディレクトリから同じコマンドを実行します。

```sh
node --import tsx ../../vendor/cordis/bin.js
```

この単一ファイルのランチャー（[vendor/cordis/bin.js](../../vendor/cordis/bin.js)を参照）はルート`Context`を作成し、Loader プラグインをマウントして、カレントディレクトリから`./cordis.yml`を読み込むよう指示します。ほかのすべて、つまり存在するプラグインやその設定は、その YAML ファイルから取得されます。このファイルはすぐに作成します。`--import tsx`フラグにより、ビルド手順なしで Node が設定で指定された TypeScript ファイルを実行できます。

## 各章

1. [最初のプラグイン](01-first-plugin.md) — プラグインは関数であり、ローダーがそれをマウントします。
2. [ライフサイクルとエフェクト](02-lifecycle-and-effects.md) — Cordis が管理する登録は、プラグインがアンロードされると取り消されます。
3. [サービス](03-services.md) — `ctx`で機能を公開し、`inject`でそれに依存します。
4. [イベント](04-events.md) — 型付きイベント、ブロードキャストディスパッチ、ウォーターフォールのショートサーキットを扱います。
5. [設定](05-config.md) — `cordis.yml`から検証済みの設定を取得し、不正な入力は明確に失敗させます。
6. [コンポジションと HMR](06-composition-and-hmr.md) — プラグインツリーとしての設定ファイル、ホットリロード、そして読み込まれないプラグインの診断を扱います。
7. [harness への組み込み](07-into-the-harness.md) — 実際の harness サービスに対してモデルから呼び出せるツールを登録します。

<a id="typescript-notes"></a>

## TypeScript の解説

これらの例では、通常のモダン JavaScript に加えて、次の 3 つの TypeScript 機能を使用します。

- **型注釈** は、実行時の動作を変えずに値を記述します。`ctx: Context`は`ctx`が Cordis のコンテキスト API を持つことを示し、`who: string`はテキストを受け取り、`string[]`は文字列の配列を意味します。
- **`import type { Context } from '@deepseek-ai/cordis'`** は型情報のみをインポートします。実行時には消えるため、注釈だけのために`Context`を必要とするプラグインファイルでも、実行時の依存関係は追加されません。
- **宣言のマージ** （`declare module '@deepseek-ai/cordis' { ... }`）は、Cordis がすでに宣言しているインターフェースに独自のエントリを追加します。たとえば、新しい`ctx.greeter`プロパティやイベント名の型です。実行時の配線は生成されません。プラグインが別途サービスを提供するか、イベントを発行します。第 3 章でこのパターンを詳しく示します。

第 5 章では、設定オブジェクトのフィールドを記述する`interface`と、スキーマが検証するオブジェクトフィールドを示す`Schema<Config>`のようなジェネリック型も使用します。これらの宣言は示されているとおりにコピーできます。周囲の本文で、それぞれが何を結び付けるのかを説明します。
