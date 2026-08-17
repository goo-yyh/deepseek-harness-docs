# プラグインをパッケージ化してインストールする

前のチュートリアルでは、`--patch` オーバーレイを通じてローカルプラグインを読み込みました。このチュートリアルでは、それをインストール可能な **バンドル**としてパッケージ化し、`dsh plugin add` で **プロファイル** にインストールし、合成された設定を決定するレイヤー順序を説明します。`dsh` CLI がインストール済みであることを前提としています。まず [プラグイン設定](./config.md)を完了してください。

代わりに新しいソースチェックアウトを使用する場合は、[ソースから実行するセクション](../../../../README.md#run-from-source)を完了し、このチュートリアルの `hello-plugin` ディレクトリをリポジトリルートに置いたまま、残りの `dsh ...` コマンドをそこから `pnpm dsh ...` として実行してください。ビルドとランチャーの動作については、[ソース実行](../../../../apps/cli/reference/README.md#source-execution)を参照してください。

## 2 つの概念、2 つのマニフェスト

インストールは 2 つの概念に基づいています。どちらも `package.json` で記述されますが、`dsh` キーの下に異なる種類のマニフェストを持ち、異なる問いに答えます。

- **バンドル** は、設定レイヤーを提供する npm パッケージです。そのマニフェストは `dsh.bundle` を宣言し、「このパッケージは何を提供するか」に答えます。これはプラグイン行を挿入または上書きするパッチファイルです。
- **プロファイル** は、1 つの実行可能な構成を記述する `$DSH_HOME/profiles/<name>` 配下のディレクトリです。そのマニフェストは `dsh.profile` を宣言し、「どのバンドルがどの順序でこのセットアップを構成するか」に答えます。

バンドルは作成して配布するもの、プロファイルはユーザーが `dsh --profile <name>` で起動するものです。両方を兼ねるものはありません。

### バンドルマニフェスト

パッケージディレクトリを作成します。

```sh
mkdir -p hello-plugin
```

```
hello-plugin/
├── package.json       # declares dsh.bundle
├── cordis.patch.yml   # the layer applied when a profile lists this bundle
└── index.js           # plugin modules the patch rows reference
```

`hello-plugin/package.json` を作成します。

```json
{
  "name": "dsh-hello-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

プラグインのエントリポイントを含む `hello-plugin/index.js` を作成します。

```js
export const name = 'hello-plugin'

export function apply() {
  console.log('[hello-plugin] plugin loaded!')
}
```

`hello-plugin/cordis.patch.yml` を作成します。パッチは、これまで記述してきた `--patch` オーバーレイと同様の YAML 配列です。ただし、Node の解決でインストール済みコードを見つけられるよう、プラグイン行では相対ソースパスではなく名前でパッケージを参照します。

```yaml
- insert:
    - id: hello
      name: dsh-hello-plugin
```

`dsh.bundle` 宣言のないパッケージもインストールされますが、通常の依存関係としてのみ扱われます。`dsh plugin` は警告を表示し、レイヤーを有効化しません。このパッケージ形式は、ユーザーが有効化するプラグインではなく、プラグインパッケージがインポートするライブラリに使用してください。

### プロファイルマニフェスト

プロファイルディレクトリには 2 つのファイルがあります。

- `package.json` — プロファイルのツリー外プラグイン依存関係（pnpm が管理）と、順序付き `bundles` リストを持つ `dsh.profile` マニフェストです。
- `cordis.patch.yml` — すべてのバンドルレイヤーの後に適用される、ユーザー自身のパッチレイヤーです。

プロファイルマニフェストを手書きすることはありません。`dsh plugin` が作成と維持を行います。次のセクションで結果を示します。

## プロファイルにインストールする

`dsh plugin --profile <name> <args...>` はプロファイルディレクトリ内の pnpm に転送するため、すべての pnpm 動詞が機能します。`hello-plugin` を含むディレクトリから、パッケージチェックアウトをインストールします。

```sh
dsh plugin --profile demo add ./hello-plugin
```

初回の使用時にプロファイルが初期化され（最初のバンドルは `@deepseek-ai/dsh-base`）、pnpm がチェックアウトをリンクします。パッケージが `dsh.bundle` を宣言しているため、`dsh` はバンドルを `dsh.profile.bundles` に追加します。

```json
{
  "name": "dsh-profile-demo",
  "private": true,
  "dependencies": {
    "dsh-hello-plugin": "link:/path/to/hello-plugin"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "dsh-hello-plugin"
      ]
    }
  }
}
```

起動せずにレイヤーを確認してから、起動します。

```sh
dsh --profile demo --dump-config   # shows a "# == dsh-hello-plugin" layer
dsh --profile demo
```

`dsh plugin --profile demo remove dsh-hello-plugin` は依存関係とレイヤーの両方を削除します。

## 読み込み順序

有効な設定は、空のルートに対して次の順序で適用して構成されます。

1. プロファイルの `dsh.profile.bundles` リストに名前がある各バンドルパッチを、リスト順に適用します。最初は `@deepseek-ai/dsh-base`、続いて追加された順の各インストール済みバンドルです。
2. プロファイル自身の `cordis.patch.yml`。
3. ホームレベルの `$DSH_HOME/cordis.patch.yml` — すべてのプロファイルで共有されるマシンローカル設定です。
4. 各 `--patch <path>` オーバーレイを argv 順に適用します。

アプリ引数は別のパッチレイヤーではありません。サーフェスバンドルは、以下で説明する通常のアプリ所有サービスを通じてそれらを解決できます。

後のレイヤーが行ごとに優先され、パッチはキーを深くマージするのではなく、行の `config` 値全体を置き換えます。バンドル作成者には 2 つの結果があります。

- パッチでは `id` によって前のレイヤーの行を上書きできます。これは [`dsh-web-app` バンドル](../../../../packages/bundle/web-app/cordis.patch.yml)が `dsh-base` 行を上書きする方法と同じです。ただし、変更したキーだけでなく、その行に必要なすべてのキーを再指定する必要があります。
- ユーザーはパッケージに触れずに、プロファイルの `cordis.patch.yml` で行を上書きできます。そのため、ユーザーが維持しそうな設定のデフォルトを優先し、残りはスキーマに任せてください。

同梱バンドル名は常に dsh のインストール自体から解決されます。pnpm が管理するのはツリー外パッケージのみなので、バンドルでは `@deepseek-ai/dsh-base` が存在し最新であることを前提にできます。

## サーフェスバンドルに専用のコマンドラインを与える

実行可能なアプリを定義するバンドルは、通常のプロバイダープラグインをマウントします。

```yaml
- id: hello-startup
  name: 'dsh-hello-plugin/startup'
```

プラグインは `inject = ['cmdlineArgs']` をエクスポートし、独自の commander プログラムで [`@deepseek-ai/dsh-cmdline`](../../../../packages/boot/cmdline/README.md) の `parseCmdline` を呼び出し、プログラムの action からアプリ所有サービスを提供します。ランチャーはランチャーフラグの後にある同じ不変の引数をすべてのプラグインへ渡すため、アプリ固有フラグでランチャーを変更する必要はなく、複数のプラグインがそのスナップショットを解析できます。Loader 行にはランチャーマーカーや特別な種類は不要です。

これらの引数で設定された行は、プロバイダーのサービスを注入し、デプロイメント値をフォールバックとして隣に置いて、自身の `!!js` オプションから読み取ります。

```yaml
- id: my-app
  name: '@example/my-app'
  inject: [myAppStartup]
  config:
    port: !!js ctx.myAppStartup.port ?? 8080
```

`--help` では、プロバイダーはサービスを公開しないため、これらの行は有効化されません。Loader は構成を一度マウントし、各行の通常の注入を待ってから、その行の `!!js` 設定を注入されたコンテキストに対して評価します。

## GitHub からのインストール: ビルドスクリプトの注意点

レジストリへの公開は必須ではありません。ユーザーは git ホストから直接インストールできます。

```sh
dsh plugin --profile demo add github:you/hello-plugin
```

ただし、git インストールでは **ビルド済み成果物ではなくソースを取得します**。`build` スクリプトは実行されないため、TypeScript パッケージは `lib/` 出力なしで到着し、読み込みに失敗します。両側で 1 つずつ、2 つの作業が必要です。

- **作成者** は `prepare` スクリプトを提供します。pnpm は git インストール後にこれを実行し、ソースから公開エントリポイントを自己完結的にビルドします。兄弟の monorepo チェックアウトのような開発専用コンテキストを前提にしてはいけません。[turtle-ui](https://github.com/deepseek-harness/turtle-ui) は動作する例です。その `prepare` は、プロジェクト参照や型チェックなしで `src/` をトランスパイルする専用 tsdown 設定を実行します。
- **ユーザー** はビルドを許可リストに追加します。pnpm ≥10 は、明示的に許可されるまで git 依存関係の `prepare` スクリプトの実行を拒否するため、最初の `add` は失敗します。`dsh` が修正方法を示します。pnpm が出力した正確なパッケージキーをプロファイルの `pnpm-workspace.yaml` にコピーしてください。

  ```yaml
  allowBuilds:
    dsh-hello-plugin: true
  ```

  その後、`add` を再実行します。

その許可は、その本質どおりに扱ってください。つまり、**インストール時にパッケージのコードを自分のマシンで実行するための許可**であり、エージェントが実行されるサンドボックスの外で行われます。ソースを信頼できるパッケージだけを許可し、コミットを固定（`github:you/hello-plugin#<sha>`）して、後からプッシュされても実行内容が黙って変わらないようにしてください。

ユーザーにこの許可を求めたくない場合は、代わりにビルド済みアーティファクトを配布してください。どちらの形式でもビルド権限は不要です。

- **npm に公開する** ：`lib/`を`pnpm publish`時にビルドします。その後、`dsh plugin add your-package`はビルド済みコードをインストールします。
- **tarball を配布する** ：`pnpm pack`から配布し、ユーザーは`dsh plugin add ./hello-plugin-0.1.0.tgz`を実行します。

## 次のステップ

- [プラグインとライフサイクル](../framework/) — プラグインの完全なライフサイクル
- [CLI の動作リファレンス](../../../../apps/cli/reference/README.md) — 正確なレイヤー優先順位、フラグ、プロファイルの仕組み
