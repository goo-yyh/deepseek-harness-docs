# Bash エグゼキューター

bash 実行の抽象シームは、サービス定義（[dsh-shell](../../packages/shell/shell)、`ctx.shell`）、サービスプロバイダー（[dsh-bash-local](../../packages/shell/bash-local) および [dsh-bash-sandbox](../../packages/shell/bash-sandbox)）、コンシューマー（[dsh-tool-bash](../../packages/shell/tool-bash)、`bash` スキーマ）に分かれています。汎用的なバックグラウンドジョブ ID、所有権、および制御は [jobs.md](jobs.md) にあります。このシームはタスクを持たないプロセスハンドルを返します。生のプロセスグループの仕組みは、[subprocess シーム](subprocess.md) の背後にあります。

ソース： [`packages/shell/shell/src/types.ts`](../../packages/shell/shell/src/types.ts)

## 管理対象シェル環境の名前空間

`DSH_*` 変数は、Harness が所有する子プロセスの情報です。モデル向け bash ツールは、`ctx.shellEnv` を通じてこれらを収集し、`ShellExecRequest.dshEnv` を通じて渡します。subprocess サービスは、現在のスナップショットをマージする前に、継承された `DSH_*` 名を削除します。`DshEnvironmentKey`/`DshEnvironment` の語彙は [subprocess シーム](subprocess.md) が所有し、`dsh-shell` が再エクスポートします。

## リクエストと仕様: `resolve()` の分離

このシームは、**モデル／プラグイン向けリクエスト** （任意の `workdir`/`timeoutMs`/`stdoutMaxBytes`。設定またはリクエストポリシーから補完）と、エグゼキューターが処理する **完全に解決された仕様** （これらのフィールドは必須）を分離します。ツール層は、その間で `ctx.shell.resolve(request)` を呼び出します（リポジトリの「パッケージ境界では暗黙的なものより明示的なものを優先する」ルール）。`ShellExecSpec` は解決済みの値を保持します。

```ts type-equiv
/**
 * A caller's execution REQUEST: `workdir` and `timeoutMs` are optional and
 * filled by {@link ShellExecutor.resolve} from the implementation's config.
 * This is the model-/plugin-facing shape; pass it to `resolve()` to obtain a
 * fully-resolved {@link ShellExecSpec}.
 */
interface ShellExecRequest {
  command: string
  /** Working directory override (default: implementation-configured). */
  workdir?: string | undefined
  /** Timeout override in milliseconds (implementations cap it). */
  timeoutMs?: number | undefined
  /**
   * Foreground stdout capture budget in bytes. Absent uses the executor's
   * default output cap. Trusted in-process consumers use this when they must
   * parse complete stdout up to their own bounded limit; the model-facing bash
   * tool does not expose it as a parameter.
   */
  stdoutMaxBytes?: number | undefined
  /** Abort signal — implementations kill the command when it fires. */
  signal?: AbortSignal | undefined
  /**
   * Bytes to write to the command's stdin, then close it. Absent leaves stdin
   * closed/empty (the default for model-driven tool calls). Set by in-process
   * plugins (e.g. the hooks bridges, which write a hook command's JSON payload
   * to its stdin); the model-facing bash tool does not expose it as a parameter
   * (a model that needs stdin uses shell syntax like a heredoc or a pipe).
   */
  stdin?: string | undefined
  /**
   * Ordinary environment entries for the command, merged after the credential
   * scrub. Managed facts belong in {@link dshEnv}, which merges after this
   * map, so an entry here can never displace one. Set by in-process plugins
   * (the hooks bridges set `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_ROOT`, …); the
   * model-facing bash tool does not expose it as a parameter.
   */
  env?: Record<string, string> | undefined
  /**
   * Harness-owned `DSH_*` variables for this execution (typed to managed
   * keys). Executors discard ambient `DSH_*` entries before merging this
   * snapshot last, so an unavailable current fact cannot inherit a stale
   * value from the harness process and a caller {@link env} entry cannot
   * displace a managed one.
   */
  dshEnv?: DshEnvironment | undefined
  /** Fully resolved per-call sandbox policy; sandboxing executors default it. */
  sandboxPolicy?: SandboxExecutionPolicy | undefined
}
```

```ts type-equiv
/**
 * A resolved execution spec. {@link ShellExecutor.resolve} fills and caps the
 * required fields; {@link ShellExecutor.start} ignores `timeoutMs` because
 * background processes have no executor timeout.
 */
interface ShellExecSpec {
  command: string
  workdir: string
  timeoutMs: number
  /**
   * Resolved foreground stdout capture budget in bytes. `run()` uses it for
   * stdout; background jobs and stderr keep the executor's own output cap.
   */
  stdoutMaxBytes: number
  /** Abort signal — implementations kill the command when it fires. */
  signal?: AbortSignal | undefined
  /** Bytes to write to stdin before closing it; absent means no stdin. */
  stdin?: string | undefined
  /**
   * Ordinary environment entries carried through from
   * {@link ShellExecRequest.env}; {@link dshEnv} still merges after them.
   * OPTIONAL on the spec for the same reason as `stdin`: absent means no
   * ordinary extra environment.
   */
  env?: Record<string, string> | undefined
  /** Managed `DSH_*` snapshot (typed to managed keys); merges after {@link env}. */
  dshEnv?: DshEnvironment | undefined
  /** Resolved sandbox policy; ignored by executors that do not confine. */
  sandboxPolicy: SandboxExecutionPolicy | undefined
}
```

`stdin` と `env` は信頼できるプロセス内プラグイン入力であり、`dsh-tool-bash` では公開されません。ローカルエグゼキューターは、明示的に呼び出し元が指定した env をマージする前に、環境内の認証情報を除去します。[bash-stdin-env Agent Note](../../.agents/notes/implemented/architecture/2026-06-30-bash-stdin-env-trusted-plugin-api.md) を参照してください。

`stdoutMaxBytes` も信頼できるプラグイン専用です。これにより、フォアグラウンド コンシューマー は stderr、バックグラウンドジョブ、またはモデル向け bash ツールの通常の出力上限を変更せずに、制限付きパーサーバジェットまで完全な stdout を要求できます。

## フォアグラウンド実行: `ShellRunResult`

完了した（または強制終了された）1 回のフォアグラウンド実行の結果です。直交する結果は **独立して**  報告されます。プロセスはシグナルをトラップしたためにタイムアウトし、かつ終了コード 0 で終了する場合があるため、`timedOut`、`aborted`、`signal`、`exitCode` はそれぞれ独自のフィールドです。呼び出し元が途中で打ち切られた実行を正常な成功として読み取ることはありません。

```ts type-equiv
/** The outcome of one completed (or killed) foreground run. */
interface ShellRunResult {
  /** Exit code; null when the process died from a signal. */
  exitCode: number | null
  /** Terminating signal (e.g. 'SIGTERM'); null on normal exit. */
  signal: NodeJS.Signals | null
  /**
   * True when the executor's own timeout was the FIRST cause to cut the command
   * short. Mutually exclusive with {@link aborted}: one fused deadline drives
   * both the timeout and the caller's cancellation, so a timeout and an abort
   * racing before process close report the single first-abort cause, not both
   * (see the [timeout-library Agent Note](../../../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md)).
   */
  timedOut: boolean
  /**
   * True when the caller's `AbortSignal` was the FIRST cause to kill the command
   * (and it was not the executor's own timeout). Mutually exclusive with
   * {@link timedOut} — see there for the first-cause classification.
   */
  aborted: boolean
  /** The effective timeout applied to this run (after defaulting/capping). */
  timeoutMs: number
  stdout: CollectedOutput
  stderr: CollectedOutput
  /** Sandbox execution facts, absent for an unsandboxed executor. */
  sandbox?: ShellSandboxInfo
}
```

各ストリームは `CollectedOutput` です。これは（切り詰められている可能性がある）テキストと復元情報を含みます。切り詰められた場合、`text` は **末尾** であり、完全なストリームはプライベートファイルに出力されます。これらのフィールドは [subprocess シーム](subprocess.md) が所有し、`dsh-shell` が再エクスポートします。

## ファイルサンドボックス: `ShellSandboxInfo`

サンドボックスを利用する実行器は、設定されたモードのフォールバックを `ShellExecutor.sandboxMode` を通じて公開します。ツール層は、各呼び出しセッションの永続的な `sandbox/mode` オーバーライドと不変の cwd を `ShellExecRequest.sandboxPolicy` に解決するよう、[`@deepseek-ai/dsh-sandbox-policy`](../../packages/sandbox/sandbox-policy/README.md) に要求します。ユーザーが承認した厳密に広い呼び出しでは、モードのみを置き換えます。mode/root/enforcement の語彙は、[`@deepseek-ai/dsh-sandbox` シーム](sandbox.md)が所有します。モードが制御するのはファイルへの影響だけです。

サンドボックス化された実行は、そのモード、保守的な拒否分類、および強制の完全性を報告します。`runnerFailed` は、コマンド実行前のサンドボックスランナー障害を示します。フォアグラウンド実行では `SANDBOX_UNAVAILABLE` がスローされますが、完了済みのバックグラウンドプロセスには facts チャネルのみがあります。

```ts type-equiv
/**
 * Sandbox facts for one run, present iff a sandboxing executor handled it.
 * Facts are reported independently of process exit status so callers can
 * distinguish command failures from policy denials and runner failures.
 */
interface ShellSandboxInfo {
  /** The mode the command actually ran under. */
  mode: SandboxMode
  /** Whether the sandbox denied a file operation. */
  denied: boolean
  /** How completely the selected runner enforced the requested mode. */
  enforcement?: SandboxEnforcement
  /** Whether the sandbox runner failed before the command could run. */
  runnerFailed?: boolean
}
```

`SANDBOX_UNAVAILABLE` エラーコード（[sandbox シーム](sandbox.md)が所有）は、隔離モードに利用可能なバックエンドがない場合に `ctx.sandbox` プロバイダーがスローし、実行器が伝播するものです。選択されたランナーがプロファイルを拒否した場合も、同じフェイルクローズのフォアグラウンドエラーになります。完了済みのバックグラウンドジョブは `runnerFailed` を記録します。モデルは結果内の拒否／ランナー facts を受け取り、拒否マーカーが有効モードを示す場合にのみそれを認識し、`sandbox_permissions` と `justification` を通じて一度だけ厳密に広い再試行を要求できます。実行前に、`ctx.approval` がその完全に一致する呼び出しを許可しなければなりません。完全なポリシーと切り替え設計は、[sandbox Agent Note](../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)にあります。

## バックグラウンドプロセス: `ShellProcess`

`start()` は、ID も所有者もないハンドルを返します。`dsh-tool-bash` はそれを `ctx.jobs.start()` フックに適合させ、汎用ランタイムがジョブの識別子とライフサイクルを所有します。`done` はプロセス終了時に解決され、決して拒否されません。完了後も読み取りは有効で、サンドボックス facts は `done` の解決前に付与されます。

```ts type-equiv
/**
 * A background process handle returned by {@link ShellExecutor.start}. It is the
 * only access path; buffered output remains readable after exit. Composition
 * teardown (the subprocess service's disposal) kills running processes and
 * awaits {@link done}; an executor-only reload leaves them running.
 */
interface ShellProcess {
  /** Process lifecycle state (settled exactly once). */
  status: ShellProcessStatus
  /** Exit code once finished (null = killed by signal / still running). */
  exitCode: number | null
  /** Terminating signal name, when signal-killed. */
  signal: NodeJS.Signals | null
  /** Resolves when the underlying process closes (never rejects — a spawn failure settles as `killed` with the error on stderr). */
  readonly done: Promise<void>
  /** Sandbox facts, stamped once a confined process settles. */
  sandbox?: ShellSandboxInfo
  /**
   * Read output produced since the previous read (consuming — consecutive
   * reads never re-deliver). Reads that lost data flag `lossy` and point at
   * full-stream spill files when available.
   */
  readOutput(): ShellProcessRead
  /**
   * Kill the process group. Returns false when it had already finished
   * (no-op); idempotent.
   */
  kill(): boolean
}
```

`readOutput()` は、増分差分とスピル復旧 facts を返します。

```ts type-equiv
/** One incremental {@link ShellProcess.readOutput} read. */
interface ShellProcessRead {
  /** Output produced since the previous read (stderr in a marked section). */
  delta: string
  /** True when truncation dropped unread bytes the delta cannot include. */
  lossy: boolean
  /** Full stdout spill file, when stdout truncation occurred and a safe path is available. */
  stdoutSpillPath?: string
  /** Full stderr spill file, when stderr truncation occurred and a safe path is available. */
  stderrSpillPath?: string
}
```

## サービス

`ShellExecutor` は `resolve`、フォアグラウンドの `run`、バックグラウンドプロセスの `start`、および `sandboxMode` の能力 facts を所有します。`dsh-bash-local` はコマンドのデフォルト設定、タイムアウト／中止の分類、端末環境、およびバックグラウンド読み取りのマージを所有します。プロセスグループ、有界コレクター、スピルファイル、認証情報のスクラビング、および破棄時の静穏化は、[subprocess service](subprocess.md)のものです。`dsh-tool-bash` はモデル向けレンダリングを所有し、バックグラウンドハンドルを [汎用ジョブランタイム](jobs.md)に適合させます。`dsh-shell` はシェルツールの共有終了ステータス契約を所有します。エクスポートされる `parseExitStatus`/`ParsedExitStatus` は、`[exit code: N]` / `[killed by signal: X]` マーカーを反転します。これらは `dsh-tool-bash` の `renderResult` と `dsh-tool-pwsh` の `renderPwshResult` が付加するものであり、両ツールの `presentResult` はこれを使用してレンダリング済みテキストを端末カードの出力本文と終了ステータスのピルに分割します。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts` によりソースから生成されます（doc-sync で `pnpm run verify-cordis-catalog` による最新性確認済み。再生成には `pnpm run gen-cordis-catalog` を使用します）。このセクションはページの両言語側でバイト単位で同一です。シグネチャブロックには `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義されており、フレームワーク継承の `ctx` API は[cordis-api/inherited.md](../cordis-api/inherited.md)にあります。

<a id="ctxshell--shellexecutor-abstract-seam"></a>

### `ctx.shell` — `ShellExecutor`（抽象シーム）

抽象 bash 実行サービスです。サブクラス化して抽象メソッドを実装し、そのサブクラスをプラグインとして読み込んでください。`ctx.shell` として登録されます（コンテキストごとに実装は 1 つです。2 つ目を読み込むとスローされます。これは cordis の標準的な重複サービス動作です）。

実装では、次のセマンティクスを満たす必要があります。

- run はインフラストラクチャ障害の場合にのみ拒否します。ゼロ以外の終了、タイムアウトによる強制終了、中止による強制終了は、ShellRunResult として解決されます。
- start は直ちに返します。バックグラウンドプロセスにはタイムアウトは適用されません。`done` はプロセス終了時に完了し、決して拒否しません。spawn 障害は stderr にエラーを含む `killed` として完了します。
- ShellProcess.readOutput は増分方式です。連続した読み取りで出力が繰り返されることはありません。損失のある読み取りでは、切り詰めと利用可能なスピルファイルを報告します。
- まだ実行中のバックグラウンドプロセスは、所有するコンポジションの破棄時に停止され、完了を待機します。subprocess シームでは、その境界は `ctx.subprocess` の破棄です。したがって、バックグラウンドプロセスは実行器のみの再読み込み後も存続します。

```ts cordis-catalog
/**
 * Apply implementation-owned defaults and caps to a request before execution.
 * @param request - the caller's request; omitted fields get this
 *   implementation's defaults, capped fields are clamped.
 * @returns the fully-specified spec to hand to {@link run}/{@link start}.
 */
abstract resolve(request: ShellExecRequest): ShellExecSpec

/**
 * Run a command in the foreground; resolves when it finishes.
 * @param spec - a resolved spec from {@link resolve}, never a raw request.
 * @returns the outcome; nonzero exits, timeout kills, and abort kills
 *   resolve with a descriptive result rather than reject.
 */
abstract run(spec: ShellExecSpec): Promise<ShellRunResult>

/**
 * Start a background process and return its handle immediately.
 * @param spec - a resolved spec from {@link resolve}, never a raw request.
 * @returns the live process handle (reads, kill, quiescence promise).
 */
abstract start(spec: ShellExecSpec): ShellProcess
```

ソース: [`packages/shell/shell/src/index.ts:65`](../../packages/shell/shell/src/index.ts)

<a id="ctxshellenv--shellenvregistry"></a>

### `ctx.shellEnv` — `ShellEnvRegistry`

信頼できる実行単位ごとの`DSH_*`変数のためのレジストリ（`ctx.shellEnv`）です。名前空間はモデルのシェル呼び出しごとに再構築されます。実行環境の`DSH_*`値は実行器によって破棄され、その後レジストリの現在のスナップショットが注入されます。組み込みのシェル情報はレジストリ自体が所有し続け、プラグインはエフェクトスコープ付きの破棄処理を伴う、列挙可能な追加情報を登録できます。

```ts cordis-catalog
/**
 * Register one environment contributor. Names and keys are unique; built-in
 * keys are reserved. Registration is disposed with the calling plugin fiber.
 * @param contributor - declared key ownership and per-execution resolver.
 * @returns the disposer that unregisters the contribution.
 */
register(contributor: BashEnvContributor): () => void

/**
 * Build the trusted `DSH_*` snapshot for one shell tool execution.
 * @param execution - the current tool execution.
 * @returns an immutable environment overlay containing built-ins and current contributions.
 */
collect(execution: ToolExecution): DshEnvironment

/**
 * Enumerate plugin-contributed variables without executing their resolvers.
 * @returns declarations sorted by environment variable name.
 */
list(): BashEnvVariableInfo[]
```

型: [DshEnvironment](subprocess.md) · [ToolExecution](tools.md)

ソース: [`packages/shell/shell-env/src/index.ts:89`](../../packages/shell/shell-env/src/index.ts)
<!-- END GENERATED cordis-surface -->
