# Python SDK を始める

このチュートリアルは、Web UI のプログラムによる代替手段です。公開済みの Python SDK をインストールし、リポジトリに含まれるエージェント構成を実行して、自身のプログラムから同じ API を呼び出す方法を示します。

## 前提条件

- Python 3.10 以降
- Git
- Linux x64、Linux arm64、または arm64 上の macOS 14 以降
- DeepSeek 互換の API エンドポイントと認証情報
- エージェントによる変更を許可する隔離済みワークスペース

## SDK をインストールする

実行可能な例を利用するためにリポジトリをクローンし、仮想環境を作成して、同一バージョンのバンドル済みランタイムとともに SDK をインストールします。

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
python -m venv .venv
. .venv/bin/activate
python -m pip install deepseek-harness-sdk
```

インストールされたランタイムにはシステムの Node.js は不要です。ランタイムまたは wheel をソースからビルドする必要があるリポジトリ貢献者は、[Python のコントリビューターワークフロー](../../../python/development.md)を使用してください。

## リポジトリに含まれる例を実行する

認証情報を環境に設定します。モデルが既定の DeepSeek エンドポイントではなく OpenAI 互換プロキシから提供される場合は、`DEEPSEEK_BASE_URL`も設定してください。

```sh
export DEEPSEEK_API_KEY=sk-your-key-here
# export DEEPSEEK_BASE_URL=http://127.0.0.1:8000/v1
# export DSH_MODEL=deepseek-v4-flash
# export DSH_SYSTEM_PROMPT='You are a helpful software engineer assistant.'
```

隔離済みのワークスペースとセッションディレクトリに対して、1 つのタスクを実行します。

```sh
python examples/jsonrpc-agent/minimal.py \
  --workspace /absolute/path/to/workspace \
  --session-root /absolute/path/to/sessions \
  --session-id example-001 \
  "Inspect the repository and fix the failing tests."
```

スクリプトは最終的なアシスタント応答を出力します。セッションディレクトリには、組み立てられたモデルリクエストとツール呼び出しを含む JSONL ログが保存されます。

## 自身のプログラムで SDK を使用する

リポジトリに含まれる例は、この SDK 呼び出しを薄くラップしたものです。

```python
from pathlib import Path

from deepseek_harness import DeepSeekHarness

config = Path("examples/jsonrpc-agent/minimal.cordis.yml").resolve()
workspace = Path("/absolute/path/to/workspace").resolve()
sessions = Path("/absolute/path/to/sessions").resolve()

with DeepSeekHarness(
    provider="deepseek-official",
    model="deepseek-v4-flash",
    max_tokens=49_152,
    cwd=str(workspace),
    session_root=str(sessions),
    cordis=str(config),
) as harness:
    result = harness.run(
        "Inspect the repository and fix the failing tests.",
        session_id="example-001",
    )

print(result.final_response)
```

`DeepSeekHarness`はバンドル済みランタイムを遅延起動し、コンテキストマネージャーを終了するまで再利用します。同じ harness とセッション ID を再利用すると、作業ディレクトリ、エクスポート済み変数、シェル関数を含む、セッションが所有する Bash プロセスが維持されます。独立したタスクには新しいセッション ID を使用し、次の呼び出しで同じ永続的な会話を継続する場合にのみ ID を再利用してください。

## 例の構成を理解する

| プロパティ | 値 |
|---|---|
| システムプロンプト | `DSH_SYSTEM_PROMPT`、フォールバック先は `You are a helpful software engineer assistant.` |
| `minimal.py`内のモデル | `--model`、次に `DSH_MODEL`、次に `deepseek-v4-flash` |
| モデル向けツール | 永続的な `bash` と `str_replace_editor` のみ |
| Bash タイムアウト | 300 秒 |
| エディター出力上限 | 16,000 文字 |
| コンテキスト圧縮 | 無効 |
| ファイルシステム | 最小限のローカルバックエンド。絶対エディターパスは、ランタイムプロセスから見える任意のパスを指定できます |
| セッションの永続化 | `DSH_SESSION_ROOT`配下の非圧縮 JSONL |

この構成には、harness ID、ワークスペースのプロンプトテキスト、スキル、単発の Bash、タスクツール、圧縮、およびその他すべてのモデル向けプラグインは含まれません。サンドボックスポリシーに関する情報は、システムプロンプトに追加するのではなく、実行時のユーザーコンテキストとしてログに記録されます。

## ワークスペースとセッション ID を選択する

`cwd`はエージェントが利用できるワークスペースを選択し、`session_root`はセッションログと状態を保存します。独立したタスクには新しいセッション ID を使用し、次の呼び出しで同じ会話と永続的なシェル状態を継続する場合にのみ ID を再利用してください。

この構成では`danger-full-access`を使用します。使い捨てのチェックアウトまたはコンテナ内でのみ実行してください。Bash とエディターは、ランタイムプロセスに許可された任意のパスを変更できます。永続的な PTY バックエンドには POSIX ターミナル基盤が必要なため、この構成は Windows エージェントをサポートしません。

[`jsonrpc-agent`の例のリファレンス](../../../examples/jsonrpc-agent/README.md)には、正確な構成が記載されています。[Python SDK リファレンス](../../../python/sdk/README.md)では、ライフサイクル、結果、通知、ランタイムの選択、設定について扱い、[Cordis 入門](../../cordis-primer.md)では構成構文について扱います。
