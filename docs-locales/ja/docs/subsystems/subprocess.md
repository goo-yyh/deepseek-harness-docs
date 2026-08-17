# サブプロセス

サブプロセスの抽象境界は、サービス定義（[dsh-subprocess](../../packages/subprocess/subprocess)、`ctx.subprocess`）とサービスプロバイダー（[dsh-subprocess-local](../../packages/subprocess/subprocess-local)）に分かれています。そのコンシューマーは、ほかの機能の抽象境界とプロセス外バックエンドです。[bash executor ファミリー](shell.md)は収集済みバッチ出力を使用し、LSP は生のプロトコルパイプを使用します。PTY バックエンドは端末プリミティブを使用し、ACP サブエージェントバックエンドはパイプされた ndjson と継承された stderr を使用します。この抽象境界は、管理対象の`DSH_*`環境名前空間、共有資格情報スクラブ（`scrubbedParentEnv`）、および`CollectedOutput`の形状を所有します。[dsh-shell](../../packages/shell/shell)は語彙を再エクスポートするため、bash コンシューマーは単一のインポートルートを維持できます。

出典: [`packages/subprocess/subprocess/src/types.ts`](../../packages/subprocess/subprocess/src/types.ts) および [`packages/subprocess/subprocess/src/index.ts`](../../packages/subprocess/subprocess/src/index.ts)

## 実行可能ファイルの検索

あるプロバイダーの spawn 作業ディレクトリ、実行可能ファイルパス、通常プロセス、および端末セッションは、マウントされたファイルシステムプロバイダーと同じパスおよびプロセス名前空間に属します。`resolveExecutable(command, env?, signal?)`は絶対実行可能ファイルパスを検証するか、プロバイダーでスクラブされた`PATH`と意図的なオーバーライドを通じて裸の名前を解決します。

## 管理対象の環境名前空間とキャプチャ出力

`DSH_*`変数は Harness が所有する子プロセスの事実です。実装は、呼び出し元が明示的に`env`をマージする前に、周囲の`DSH_*`名を破棄します。そのため、現在の事実は意図的な文字列エントリーとしてのみ渡され、明示的な`undefined`墓標は通常の周囲値を削除します。収集される各ストリームは、`CollectedOutput`を通じて切り詰めおよびスピル回復の状態を報告します。

```ts type-equiv
/** One environment key inside the managed {@link DSH_ENV_PREFIX} namespace. */
type DshEnvironmentKey = `${typeof DSH_ENV_PREFIX}${string}`
```

```ts type-equiv
/** Trusted DeepSeek Harness variables for one child-process execution. */
type DshEnvironment = Readonly<Record<DshEnvironmentKey, string>>
```

```ts type-equiv
/** One captured stream: the (possibly truncated) text plus recovery info. */
interface CollectedOutput {
  /** Collected text — the TAIL of the stream when truncated. */
  text: string
  /** True when bytes were dropped from `text`. */
  truncated: boolean
  /** Path to a file holding the COMPLETE stream, when truncated and available. */
  spillPath?: string
}
```

## Node 形式の stdio 割り当て

各ストリームの割り当ては明示的で、コンシューマーごとに選択されます。プロトコルフレーミング（LSP JSON-RPC、ACP ndjson）には生のパイプ、診断のパススルーには inherit、制限付きバッチ出力には collect モードを使用します。スピルファイルは任意であるため、診断末尾（言語サーバーの stderr）はファイルを残さずにバッファリングできます。

```ts type-equiv
/**
 * stdin disposition. `'ignore'` leaves fd 0 on `/dev/null`; `'pipe'` exposes
 * {@link SubprocessHandle.stdin} for the caller's ongoing protocol writes;
 * `{ data }` writes the bytes and closes (the batch shape).
 */
type SubprocessStdinMode = 'ignore' | 'pipe' | { readonly data: string }
```

```ts type-equiv
/**
 * Bounded in-memory collection for one output stream, with an optional
 * full-stream spill file. Omitting `spill` keeps only the in-memory tail —
 * the diagnostic-tail shape (a language server's stderr); including it makes
 * the complete stream recoverable up to its cap (the bash tool shape).
 */
interface SubprocessCollect {
  /** In-memory cap in bytes; overflow keeps the TAIL. */
  maxBytes: number
  /** Full-stream spill file; absent disables spilling entirely. */
  spill?: {
    /** Whole-stream byte cap; a larger stream discards its now-incomplete spill. */
    maxBytes: number
  }
}
```

```ts type-equiv
/**
 * stdout/stderr disposition. `'pipe'` exposes the raw `Readable` for the
 * caller's protocol decoding; `'inherit'` passes the parent's descriptor
 * through (child diagnostics land on the harness's own stream); a
 * {@link SubprocessCollect} object buffers boundedly with offset-based reads.
 */
type SubprocessOutputMode = 'pipe' | 'inherit' | SubprocessCollect
```

```ts type-equiv
/** Per-stream stdio dispositions, all explicit — this seam applies no defaults. */
interface SubprocessStdio {
  stdin: SubprocessStdinMode
  stdout: SubprocessOutputMode
  stderr: SubprocessOutputMode
}
```

## 完全に明示的な spawn 仕様

この抽象境界はデフォルトを適用しません。すべての割り当て、制限、およびディレクトリは仕様で明示されるため、隠れたサブプロセスサービスのデフォルトではなく、呼び出し元自身の設定がそれらを決定します。`argv`がシェルで解釈されることはありません。

```ts type-equiv
/**
 * A fully-specified spawn request. This seam applies no defaults: every
 * disposition, limit, and directory is explicit, so the caller's own config —
 * not a hidden subprocess-service default — decides them (the `dsh-shell`
 * request/spec split is the owning template).
 */
interface SubprocessSpawnSpec {
  /** Executable and arguments; `argv[0]` is the program. Never shell-interpreted here. */
  argv: readonly string[]
  /** Working directory for the child. */
  cwd: string
  /** Per-stream stdio dispositions. */
  stdio: SubprocessStdio
  /**
   * Positive finite grace period in milliseconds, no greater than
   * `MAX_TIMER_DELAY_MS`, for the {@link SubprocessHandle.terminate} escalation
   * and for draining still-open collected pipes after the process exits (an
   * inherited descriptor held by a surviving descendant cannot hold the
   * outcome open indefinitely).
   */
  graceMs: number
  /**
   * Abort signal — starts the terminate escalation on the process tree when
   * it fires. The caller owns deadlines and cause classification; this seam
   * only reacts to the abort.
   */
  signal?: AbortSignal | undefined
  /**
   * Explicit environment entries merged onto the implementation's scrubbed
   * parent base (see `scrubbedParentEnv`), with no namespace validation. A
   * string is a deliberate caller opt-in, so a forwarded credential-shaped
   * entry or current `DSH_*` fact survives the scrub; `undefined` is a
   * tombstone that removes an ordinary ambient entry from the child.
   */
  env?: NodeJS.ProcessEnv | undefined
}
```

## ハンドル: ストリーム、リーダー、ツリー単位の終了

spawn は直ちにライブハンドルを返します。collect モードのリーダーはストリーム全体のバイトオフセットを取得し、決して消費しないため、独立したリーダーが互いの差分を奪うことはありません。パイプされたストリームは呼び出し元に属します。終了はすべてのプラットフォームでツリー単位です。唯一の終了動詞である`terminate()`は SIGTERM→grace→SIGKILL と段階的に強制し、`waitForExit()`はツリー全体を監視します。これによりコンシューマーは独自の終了処理ラダーを構築できます（ACP バックエンドの stdin-EOF 優先`disposeAcpChild`がテンプレートです）。

```ts type-equiv
/**
 * A live child process rooted in its own process tree. Collected output
 * remains readable after exit; piped streams belong to the caller.
 *
 * Termination is tree-scoped everywhere: POSIX signals the detached process
 * group (falling back to the direct child when the group is gone), Windows
 * terminates the tree via `taskkill /T`, so helper processes cannot outlive
 * the handle unnoticed.
 */
interface SubprocessHandle {
  /** Process id (tree root); -1 when the spawn itself failed. */
  readonly pid: number
  /** The child's stdin, present iff spawned with `stdin: 'pipe'`. */
  readonly stdin: Writable | undefined
  /** The child's raw stdout, present iff spawned with `stdout: 'pipe'`. */
  readonly stdout: Readable | undefined
  /** The child's raw stderr, present iff spawned with `stderr: 'pipe'`. */
  readonly stderr: Readable | undefined
  /** Offset-based readers for collect-mode streams (also readable after exit). */
  readonly collected: SubprocessCollectedOutputs
  /** Resolves at process close with exit facts; rejects only for spawn-level failures. */
  readonly done: Promise<SubprocessOutcome>
  /**
   * Begin the SIGTERM → `graceMs` → SIGKILL escalation on the process tree
   * (Windows force-terminates immediately) — the seam's only termination
   * verb. Idempotent, a no-op once the tree is gone (the pid may be reused),
   * and also triggered by the spec's abort signal.
   */
  terminate(): void
  /**
   * Wait until the process tree has exited — the tree, not just the direct
   * child, so a still-running helper is observable before teardown returns.
   * @param signal - optional bound for the wait.
   * @returns `true` when the tree exited, `false` when the signal aborted first.
   */
  waitForExit(signal?: AbortSignal): Promise<boolean>
}
```

```ts type-equiv
/**
 * Cursor-free incremental access to one collected output stream. Offsets are
 * whole-stream byte coordinates owned by the caller, so independent readers
 * cannot consume one another's output; `readFrom(0)` after settlement is the
 * batch result (`lossy` then means the in-memory tail lost its head — the
 * {@link CollectedOutput.truncated} fact).
 */
interface SubprocessOutputReader {
  /**
   * Read everything captured since `fromByte`. When that offset has slid out
   * of the in-memory tail window the read is `lossy` — it returns the whole
   * retained tail and the gap is only recoverable from the spill file.
   * @param fromByte - whole-stream offset to resume from (a prior read's `nextOffset`; 0 for the first read).
   * @returns the delta text, the next offset, the `lossy` flag, and the spill path when one exists.
   */
  readFrom(fromByte: number): SubprocessOutputRead
}
```

```ts type-equiv
/** One incremental {@link SubprocessOutputReader.readFrom} read. */
interface SubprocessOutputRead {
  /** Stream text from the requested offset (the whole retained tail when lossy). */
  text: string
  /** Whole-stream offset to resume from on the next read. */
  nextOffset: number
  /** True when the requested offset slid out of the in-memory tail window. */
  lossy: boolean
  /** Path to the full-stream spill file, when one was created and remains intact. */
  spillPath?: string
}
```

```ts type-equiv
/** Offset-based readers for the streams spawned in collect mode. */
interface SubprocessCollectedOutputs {
  /** Present iff stdout is a {@link SubprocessCollect}. */
  readonly stdout?: SubprocessOutputReader
  /** Present iff stderr is a {@link SubprocessCollect}. */
  readonly stderr?: SubprocessOutputReader
}
```


## 結果には終了に関する事実のみが含まれます

`done` は Node の close-event 語彙を報告し、原因の分類は行いません。サービスは abort 時に終了させますが、その理由を判断することはありません（呼び出し元が、自身で所有する期限シグナルを読み取ります。たとえば bash executor の `timedOut`/`aborted` の分岐です）。収集された出力は完了後も `handle.collected` を通じて読み取れるため、バッチ呼び出し元とストリーミング呼び出し元で同じアクセス経路を共有できます。

```ts type-equiv
/**
 * Exit facts of one closed process — Node's `close`-event vocabulary.
 * Deliberately carries NO timeout or cancellation classification (the caller
 * reads the signal it owns to classify causes) and NO output: collected
 * streams stay readable through {@link SubprocessHandle.collected} after
 * settlement, so batch and streaming callers share one access path.
 */
interface SubprocessOutcome {
  /** Exit code; null when the process died from a signal. */
  exitCode: number | null
  /** Terminating signal (e.g. 'SIGTERM'); null on normal exit. */
  signal: NodeJS.Signals | null
}
```

## 端末プロセスの基本機能

`spawnTerminal(spec)` は、パイプを使用しないプロセスの基本機能です。プロバイダーは制御端末を割り当て、UTF-8 テキスト転送、フォアグラウンドプロセスグループの検査とシグナル送信、およびプロバイダーが引き続き観測できる各セッションメンバーを静止状態にする、await される TERM から KILL への操作を担います。プロバイダーは基盤固有の観測可能性の制約を文書化します。PTY バックエンドは引き続き、プロンプト検出、準備完了の推論、スクロールバック、サンドボックス方針、および永続セッションの所有権を担います。通常の `spawn()` では、制御端末のセマンティクスを再構築できません。

端末仕様では、argv、cwd、環境のオーバーライド、寸法、クリーンアップ猶予時間、および任意の割り当てキャンセルを完全に規定します。そのハンドルは、`pid`、順序付けられた出力、`done`、`write`、`inspectForeground`、`signalForeground`、および await される `terminate` を公開します。正確な公開形式は、[`ctx.subprocess` サービスカタログ](#ctxsubprocess--subprocessruntime-abstract-seam)に生成されます。

## サービスの動作

抽象的な [`SubprocessRuntime`](../../packages/subprocess/subprocess/src/index.ts) サービス定義は、実行環境の座標、実行可能ファイルの検索、通常の `spawn`、および `spawnTerminal` を規定します。[`LocalSubprocessRuntime`](../../packages/subprocess/subprocess-local/src/index.ts) は、デタッチされたプロセスツリー、配置ごとの配線、認証情報の消去、`node-pty`、プラットフォームのプロセス検査、および終了して結合する破棄を提供します。サービス定義の契約については [`dsh-subprocess`](../../packages/subprocess/subprocess/README.md) を、ローカルの仕組みについては [`dsh-subprocess-local`](../../packages/subprocess/subprocess-local/README.md) を参照してください。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts` によりソースから生成されます（doc-sync で `pnpm run verify-cordis-catalog` により最新であることを検証します。再生成するには `pnpm run gen-cordis-catalog` を使用します）。このセクションは、ページの両言語版でバイト単位で同一です。シグネチャブロックは `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは [入門](../cordis-primer.md#dispatch-modes)で定義され、フレームワークから継承される `ctx` API は [cordis-api/inherited.md](../cordis-api/inherited.md) にあります。

<a id="ctxe2b--e2bruntime"></a>

### `ctx.e2b` — `E2BRuntime`

遅延して利用できる E2B SDK ハンドルを 1 つ作成し、タイムアウト時または破棄時にサンドボックスを削除します。作成はプラグイン構築時に開始され、アダプターは最初の操作の前に getSandbox を await します。

```ts cordis-catalog
/**
 * Return the shared live SDK handle.
 * @returns the created sandbox after the configured cwd exists.
 * @throws when E2B rejects creation or the service is disposing.
 */
async getSandbox(): Promise<Sandbox>
```

ソース: [`packages/e2b/e2b/src/index.ts:74`](../../packages/e2b/e2b/src/index.ts)

<a id="ctxsubprocess--subprocessruntime-abstract-seam"></a>

### `ctx.subprocess` — `SubprocessRuntime`（抽象的な接続点）

抽象サブプロセスサービスです。サブクラス化して spawn を実装し、そのサブクラスをプラグインとして読み込みます。これにより `ctx.subprocess` として登録されます（コンテキストごとに実装は 1 つです。2 つ目を読み込むと例外が発生します。これは cordis の標準的な重複サービス動作です）。

実装は次のセマンティクスを満たす必要があります:

- 実行可能ファイルのパスは、マウントされたファイルシステムプロバイダーと共有される 1 つの実行環境に属します。
- spawn はライブハンドルを直ちに返します。`done` はプロセスの終了時に終了情報とともに解決され、spawn レベルの失敗の場合にのみ拒否されます。
- 収集モードのリーダーはオフセットベースで非消費型であるため、独立したリーダーどうしが互いの出力を消費することはありません。損失を伴う読み取りでは、切り詰めと、存在する場合は完全なストリームを保持するスピルファイルが報告されます。パイプされたストリームは未加工のまま呼び出し元に渡され、ここではバッファリングされません。
- SubprocessHandle.terminate（および仕様の abort signal）は、唯一の終了操作として SIGTERM→grace→SIGKILL へエスカレーションし、すべてのプラットフォームでツリー単位に適用されます。SubprocessHandle.waitForExit はツリー全体の稼働状態を監視するため、コンシューマー所有の終了処理ラダーでは、各段階を実際の静止状態まで維持できます。
- サービスを破棄すると、まだ実行中のすべての管理対象プロセスが終了され、その終了を待機します。
- spawnTerminal は、ターミナルの割り当て、テキスト転送、フォアグラウンドグループ、シグナル送信、およびセッション全体の静止状態を、待機可能な 1 つの終了メソッドの背後で管理します。準備完了と永続シェルのポリシーは PTY コンシューマー側に残ります。その出力ストリームは、最上位プロセスの終了後、キューに入れられたターミナル出力の後に終了します。

```ts cordis-catalog
/**
 * Resolve one configured executable in this provider's execution world.
 * Absolute paths are verified; bare names use the provider's scrubbed PATH
 * plus explicit environment overrides. Relative paths containing separators
 * are rejected: the resolution base is undefined, so providers fail loud
 * instead of guessing.
 * @param command - absolute executable path or bare PATH name.
 * @param env - explicit environment entries used for lookup.
 * @param signal - aborts remote or local lookup.
 * @returns a canonical executable path.
 */
abstract resolveExecutable( command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal, ): Promise<string>

/**
 * Start one managed child process from a fully-specified spec; this seam
 * applies no defaults.
 * @param spec - argv, directory, stdio dispositions, grace, cancellation, and environment.
 * @returns the live process handle (streams/readers, signalling, outcome promise).
 */
abstract spawn(spec: SubprocessSpawnSpec): SubprocessHandle

/**
 * Allocate a real terminal and start one owned process session. This is the
 * only non-pipe process primitive: implementations own terminal byte I/O,
 * foreground groups, signals, and complete session-tree cleanup.
 * @param spec - fully specified argv, cwd, environment, dimensions, grace, and allocation cancellation.
 * @returns the live terminal handle after allocation succeeds.
 */
abstract spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle>
```

ソース： [`packages/subprocess/subprocess/src/index.ts:102`](../../packages/subprocess/subprocess/src/index.ts)
<!-- END GENERATED cordis-surface -->
