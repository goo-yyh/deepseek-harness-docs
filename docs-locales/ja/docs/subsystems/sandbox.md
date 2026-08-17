# プロセスサンドボックス

[dsh-sandbox](../../packages/sandbox/sandbox) のプロセスサンドボックスの抽象的な接続点は、同一ワールドのサブプロセス argv を、コンシューマーをプラットフォームランナーに結び付けることなく、ファイル効果ポリシーでラップします。[dsh-sandbox-local](../../packages/sandbox/sandbox-local) は Linux の bwrap/Landlock、macOS の Seatbelt、Windows の ACL 制限トークンバックエンドを提供します。[dsh-bash-sandbox](../../packages/shell/bash-sandbox) と [dsh-pwsh-sandbox](../../packages/shell/pwsh-sandbox) はこれを利用します。コンテナ、microVM、リモート実行は、`ctx.sandbox` のプロバイダーではなく、完全なケイパビリティの抽象的な接続点における兄弟実装です。

出典: [`packages/sandbox/sandbox/src/index.ts`](../../packages/sandbox/sandbox/src/index.ts)

## モードと適用

`SandboxMode` はファイルシステム効果のみを制御します。`read-only` はバックエンドに書き込みの拒否を要求します。POSIX ランナーはさらにシェルが必要とする `/dev/null` シンクを許可します。一方、Windows ACL ランナーは明示的な書き込み可能ルートを許可せず、周辺 ACL の不足について部分的な適用を報告します。`workspace-write` はワークスペースルートおよびバックエンドが保証する一時領域での書き込みを許可します。`danger-full-access` は隔離をバイパスします。ネットワークとプロセス可視性はこの語彙の対象外です。

```ts type-equiv
/**
 * File-effect policy for confined processes. `read-only` permits only required
 * sinks such as `/dev/null`; `workspace-write` also permits the workspace and a
 * backend-defined temp area; `danger-full-access` bypasses confinement. Network
 * and process visibility are outside this vocabulary.
 */
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
```

最初の 2 つのモードだけをプロバイダーに送信できます。`danger-full-access` コンシューマーは元の argv を起動し、`ctx.sandbox` を呼び出しません。

```ts type-equiv
/** A confining (non-`danger-full-access`) mode — the modes a {@link SandboxPolicy} can carry. */
type ConfinedSandboxMode = Exclude<SandboxMode, 'danger-full-access'>
```

適用は報告される事実です。`full` は、バックエンドがモードによって約束されたすべてのファイル効果を制御することを意味します。`partial` は、アクティブなバックエンドまたは古いカーネル ABI が一部のみを制御することを意味するため、絶対的な保証を必要とするコンシューマーはこの違いを拒否するか明示する必要があります。古い Landlock ABI と、Windows ACL ランナーにおける Everyone/ハードリンクの境界が、現在の部分的なケースです。

```ts type-equiv
/**
 * Enforcement completeness for this host. `partial` means an active backend or
 * older kernel ABI cannot govern every promised file effect; callers requiring
 * an absolute boundary must not treat it as `full`.
 */
type SandboxEnforcement = 'full' | 'partial'
```

## 呼び出しごとのポリシー

完全な実行ポリシーは、ケイパビリティ呼び出しごとに解決されて渡されます。これには `danger-full-access` が含まれるため、コンシューマーは隔離をバイパスするか判断する前に一度だけポリシーを解決できます。通常のツール呼び出しでは、呼び出しセッションの不変な cwd から `workspaceRoot` を導出します。デプロイ設定はエージェントなしの場合のフォールバックです。ルートは字句正規化の前にファイルシステムのセマンティクスで正準化されるため、`symlink/..` を含む cwd は、起動されたプロセスが実際に実行されるディレクトリを特定します。

```ts type-equiv
/**
 * The complete file-effect policy resolved for one capability call. The root
 * is carried even under modes that do not consume it so callers can resolve
 * policy once before choosing the enforcement path.
 */
interface SandboxExecutionPolicy {
  /** The file-effect mode this execution runs under. */
  mode: SandboxMode
  /** Absolute root directory `workspace-write` may write under. */
  workspaceRoot: string
  /**
   * Opaque identity of the calling session (the branded `dsh-session`
   * SessionId). Backends key per-session state off it (e.g. windows-acl gives
   * each live session/workspace pair a random private temp directory and SID,
   * while the workspace SID and standing grant remain per-workspace); absent
   * for agentless calls, which fall back to per-call backend state.
   */
  sessionId?: SessionId
}
```

`ctx.sandboxPolicy.resolve()` はアクティブなセッションと、承認済みの再試行では明示的なモードを受け取ります。サービスが優先順位とルートフォールバックを所有するため、bash と fs でこれらを繰り返す必要はありません。

```ts type-equiv
/** Inputs that select the sandbox policy for one capability call. */
interface SandboxPolicyRequest {
  /** Calling session; its immutable cwd becomes the workspace boundary. */
  session?: Session
  /** Explicit approved mode override, which outranks session policy. */
  mode?: SandboxMode
}
```

隔離された実行だけが `ctx.sandbox` に到達します。そのプロバイダーポリシーは同じルートを保持したままモードを狭めます。これにより、並行するセッション、コンシューマー、1 回限りの昇格済み再試行が、プロバイダー状態を変更せずに、異なる境界を同じプロバイダーへ要求できます。

```ts type-equiv
/**
 * What one confined execution is allowed to touch — carried PER CALL, not
 * fixed on the provider: two consumers may confine under different policies
 * at the same instant (bash under `read-only` while a confined child agent
 * needs its state directory writable), and an approved escalated retry is a
 * new call with a wider policy. Defaulting/resolution is an explicit step at
 * the consumer boundary; the provider treats the policy as fully specified.
 */
interface SandboxPolicy extends SandboxExecutionPolicy {
  /** The file-effect mode this execution runs under. */
  mode: ConfinedSandboxMode
}
```

## ラップされた argv と分類方言

`RunnerFailureRule` は、ランナーがコマンドを実行する前に失敗したことを示す証拠を組み合わせます。コンシューマーには、ゼロ以外の終了、任意の許可終了コードゲート、残る stderr の 1 行内にある大文字小文字を区別しない致命的シグネチャが必要です。大文字小文字を区別しない、行全体が完全一致する情報提供用の除外を最初に取り除くため、無害なランナー通知だけでは失敗を証明できません。一致した行はエラー詳細として利用可能なままです。分類によって stderr が書き換えられることはありません。

```ts type-equiv
/**
 * Evidence that identifies a sandbox runner failing before it executes the
 * wrapped command. A consumer first applies {@link allowedExitCodes} when
 * present, removes {@link informationalLines} by case-insensitive exact line
 * equality, then matches {@link fatalSignatures} case-insensitively within
 * each remaining stderr line. Exit status alone never proves runner failure.
 */
interface RunnerFailureRule {
  /** Nonzero process exit codes on which this rule may match; omitted permits any nonzero exit. */
  allowedExitCodes?: readonly number[]
  /** Non-empty substrings identifying a fatal runner diagnostic on one stderr line. */
  fatalSignatures: readonly string[]
  /** Benign stderr lines excluded by exact full-line equality before fatal matching. */
  informationalLines?: readonly string[]
}
```

`ConfinedArgv` はコンシューマーが起動するものです。置換 argv に加えて、バックエンドの適用事実と、直交する 2 つの stderr 分類器を保持します。`denialSignatures` は、サンドボックスが正しく機能しているときに隔離されたコマンドがブロックされることを識別します。`runnerFailureRules` は、サンドボックスランナーがコマンドを実行する前に拒否または失敗することを識別します。コンシューマーはこれらを最初に確認し、通常のタスク失敗ではなくサンドボックスインフラストラクチャの失敗として示します。

```ts type-equiv
/**
 * A {@link SandboxProvider.confine} result: the argv to spawn in place of
 * the caller's own, plus the enforcement completeness the selected backend
 * achieves for it.
 */
interface ConfinedArgv {
  /** The wrapped argv (runner, profile, separator, then the caller's argv). */
  argv: string[]
  /** How completely the selected backend enforces the policy's file effects. */
  enforcement: SandboxEnforcement
  /**
   * The selected backend's denial DIALECT: the case-insensitive stderr
   * substrings a file effect denied by THIS backend produces (EROFS text
   * under bwrap's read-only binds, EACCES under Landlock, EPERM under
   * Seatbelt). A consumer that infers denials from a failed run's stderr
   * matches against exactly these rather than a cross-backend union — the
   * union claims denials a given backend never produces.
   */
  denialSignatures: readonly string[]
  /**
   * Structured runner-failure evidence rules. Consumers require a matching
   * fatal stderr line (after informational exclusions) and any rule-specific
   * exit-code gate before checking denial signatures: runner failure means the
   * command never ran, while denial means confinement worked and blocked it.
   */
  runnerFailureRules: readonly RunnerFailureRule[]
}
```

[ローカルプロバイダー](../../packages/sandbox/sandbox-local/README.md)は、オペレーター設定を管理し、そのランナー方言をこれらのルールにマッピングします。[サンドボックス化された bash コンシューマー](../../packages/shell/bash-sandbox/README.md)は、生成と結果の帰属を管理します。

## プロバイダーとフェイルクローズドエラー

`ctx.sandbox.confine(argv, policy)`は、使用可能なバックエンドがない場合に`ConfinedArgv`を返すか、コード`SANDBOX_UNAVAILABLE`を伴う`SandboxUnavailableError`をスローします。コンシューマーは、生成中または返された argv の監視中に失敗を分類することもあります。この帰属はコンシューマー契約に属します。制限されたポリシーでは、無制限のサイレントパススルーは決して許可されません。

プロバイダーの選択、プローブ、キャッシュ、およびバックエンド固有の強制レポートは、[ローカルプロバイダー](../../packages/sandbox/sandbox-local/README.md)に属します。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`によってソースから生成されます（doc-sync では`pnpm run verify-cordis-catalog`によって最新性を検証し、`pnpm run gen-cordis-catalog`で再生成します）。このセクションは、ページの両言語版でバイト単位で同一です。シグネチャブロックは`ts cordis-catalog`フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義されており、フレームワークから継承された`ctx` API は[cordis-api/inherited.md](../cordis-api/inherited.md)にあります。

<a id="ctxsandbox--sandboxprovider-abstract-seam"></a>

### `ctx.sandbox` — `SandboxProvider`（抽象的な接合部）

抽象プロセスサンドボックスサービスです。confine は、強制を行う argv を返すか、ラップ時またはランナー実行時にフェイルクローズドしなければなりません。無制限のサイレントパススルーは禁止されています。機能プローブは複数ランナーのチェーンを判定し、唯一の候補では省略できます。その候補自体の拒否がフェイルクローズドの終点になります。

```ts cordis-catalog
/**
 * Wrap `argv` so it executes confined under `policy` on this host; the
 * caller spawns the returned argv in place of its own.
 * @param argv - the exact argv the caller is about to spawn (program plus
 *   arguments), NOT a shell string — a shell-shaped consumer passes
 *   `['bash', '-c', command]`.
 * @param policy - the file-effect policy this execution runs under,
 *   carried per call (see {@link SandboxPolicy}).
 * @returns the argv to spawn instead, plus the enforcement completeness
 *   the selected backend achieves for it.
 */
abstract confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv
```

ソース: [`packages/sandbox/sandbox/src/index.ts:158`](../../packages/sandbox/sandbox/src/index.ts)

<a id="ctxsandboxpolicy--sandboxpolicyservice"></a>

### `ctx.sandboxPolicy` — `SandboxPolicyService`

サンドボックスポリシーサービス（`ctx.sandboxPolicy`）です。デプロイ時のデフォルトモード、フォールバックワークスペースルート、および現在のリクエスト時ポリシーセクションを管理します。ツールレイヤーは実行ごとに resolve を呼び出すため、セッションのモードログと不変の cwd は、すべての強制機能へ一緒に渡されます。

```ts cordis-catalog
/**
 * Resolve the complete policy for one capability call. An approved explicit
 * mode outranks the session's last `sandbox/mode` event, which outranks the
 * deployment default. A session cwd is its workspace-write boundary; the
 * configured root is the fallback for agentless calls and sessions without a
 * cwd.
 * @param request - optional session and approved mode override.
 * @returns the fully resolved per-call mode and absolute workspace root.
 */
resolve(request: SandboxPolicyRequest = {}): SandboxExecutionPolicy

/**
 * Read the session override without applying the deployment default.
 * @param session - session whose log supplies the override.
 * @returns the last logged mode, or `undefined` without one.
 */
overrideOf(session: Session): SandboxMode | undefined
```

型: [Session](session.md)

ソース: [`packages/sandbox/sandbox-policy/src/index.ts:91`](../../packages/sandbox/sandbox-policy/src/index.ts)
<!-- END GENERATED cordis-surface -->
