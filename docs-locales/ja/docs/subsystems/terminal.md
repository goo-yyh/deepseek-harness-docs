# 永続 PTY セッション

PTY バックエンド、`ctx.terminals`、およびモデル向けコンシューマーで共有される型です。根拠は[永続 PTY Agent Note](../../.agents/notes/implemented/feature/2026-07-16-persistent-pty-sessions.md)にあります。このページでは、[`packages/terminal/terminal/src/types.ts`](../../packages/terminal/terminal/src/types.ts)のパッケージ横断の用語を記録します。

## 識別情報と準備完了

`TerminalSessionId`はサービスが発行するブランド化された ID です。任意の名前は所有者ローカルの表示メタデータです。認可では名前や推測した ID ではなく、正確な所有元の`Agent`を比較します。

`TerminalWaitReason`は、1 回の送信が返った理由を示します。これは`TerminalSessionStatus`とは独立しています。最上位のシェルが存続していても、無応答またはタイムアウトで戻る場合があります。一方、`session_exit`は、任意のフォアグラウンド子プロセスではなく、そのシェルが終了したことを意味します。

```ts type-equiv
/** Why one interactive send returned control to its caller. */
type TerminalWaitReason = 'stdin_read' | 'inferred_idle' | 'timeout' | 'session_exit'
```

```ts type-equiv
/** Top-level PTY process status, independent of a send's wait reason. */
type TerminalSessionStatus =
  | { kind: 'running' }
  | { kind: 'exited'; exitCode: number | null; signal: NodeJS.Signals | null }
```

## バックエンドとライブセッション

バックエンドは、登録済みの 1 つの型を開始し、準備完了を検出する方法を担います。`TerminalSessionService`はセットアップが成功した後にのみ返却セッションを公開し、その後は ID の認可とクリーンアップを担います。部分的な起動リソースをクリーンアップできないバックエンドは`TerminalBackendCleanupError`で拒否します。これにより、呼び出し元のキャンセル理由を置き換えずに、破棄時にクリーンアップ失敗を保持できます。バックエンドセッションは、端末状態とキャプチャ済みリソースの静止状態を担います。

```ts type-equiv
/** Replaceable provider for one PTY session type. */
interface TerminalBackend {
  /** Stable type selected by {@link TerminalSpawnRequest.type}. */
  readonly type: string
  /** Create an unpublished session or reject after cleaning partial resources; cleanup failure uses {@link TerminalBackendCleanupError}. */
  spawn(spec: TerminalBackendSpawnSpec): Promise<TerminalBackendSession>
}
```

```ts type-equiv
/** Backend-owned live session retained by {@link TerminalSessionService}. */
interface TerminalBackendSession {
  /** Initial bounded terminal output returned from `terminal_open`. */
  readonly motd: string
  /** Top-level process id when one exists. */
  readonly pid?: number
  /** Start one exclusive send operation. */
  startSend(request: TerminalSendRequest): TerminalSendOperation
  /** Read one bounded page from retained scrollback. */
  read(request: TerminalReadRequest): TerminalReadResult
  /** Signal the verified foreground process group. */
  signal(signal: TerminalSignal): Promise<TerminalSignalResult>
  /** Observe top-level process status. */
  status(): TerminalSessionStatus
  /** Idempotently close the captured owned process tree and await quiescence. */
  close(reason: string): Promise<void>
}
```

## 送信と保持出力

1 つのライブセッションは、アクティブな送信を 1 つ受け付けます。その操作は、汎用バックグラウンドジョブ向けの消費型出力カーソルと、フォアグラウンド呼び出し元向けの 1 つの端末結果を公開します。`TerminalReadResult`は、上限付きのセッションスクロールバックを別途ページングします。

```ts type-equiv
/** Live backend-owned send; exactly one may be active per PTY session. */
interface TerminalSendOperation {
  /** Resolves after readiness, timeout, cancellation, or top-level process exit. */
  done: Promise<TerminalSendResult>
  /** Consume output produced since the prior call. */
  readOutput(): TerminalSendRead
  /** Request `SIGINT`; returns false after the operation settled. */
  cancel(): boolean
}
```

```ts type-equiv
/** Settled result for one foreground or background send. */
interface TerminalSendResult {
  /** Bounded rendered terminal delta remaining at settlement. */
  viewport: string
  /** Why the wait returned; this does not imply arbitrary child-process exit. */
  waitReason: TerminalWaitReason
  /** Top-level session status observed at settlement. */
  sessionStatus: TerminalSessionStatus
  /** Whether output was dropped from the operation or retained scrollback. */
  truncated: boolean
}
```

## 所有権と永続性

`TerminalSessionService`は、待機する 1 回のクリーンアップを正確な所有者スコープに関連付け、外部の操作を拒否し、バックエンドまたはツールプラグインの再読み込み後もセッションを存続させます。PTY 状態と生バイトはプロセスローカルのままです。モデル入力と上限付きの返却出力は、重複する PTY セッションイベントではなく、既存の`tool/call`、`tool/result`、およびタスク結果のパスを通じて永続化されます。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`によりソースから生成されます（doc-sync で`pnpm run verify-cordis-catalog`により最新であることを検証します。`pnpm run gen-cordis-catalog`で再生成します）。このセクションはページの両言語側でバイト単位で同一です。シグネチャブロックでは`ts cordis-catalog`フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義されており、フレームワーク継承の`ctx` API は[cordis-api/inherited.md](../cordis-api/inherited.md)にあります。

<a id="ctxterminals--terminalsessionservice"></a>

### `ctx.terminals` — `TerminalSessionService`

置換可能な PTY バックエンドと厳密な Agent セッションのためのプロセス内レジストリです。

```ts cordis-catalog
/**
 * Register one backend type for this effect scope.
 * @param backend - provider with a non-empty unique type.
 * @returns disposer that removes exactly this contribution.
 */
registerBackend(backend: TerminalBackend): () => void

/**
 * List registered backend types in registration order.
 * @returns fresh backend type names.
 */
listBackends(): string[]

/**
 * Create and publish one owner-scoped session after backend setup succeeds.
 * @param owner - exact registered Agent that owns access and cleanup.
 * @param request - backend type plus optional owner-local name and cwd.
 * @param signal - cancellation of unpublished setup.
 * @returns published identity, metadata, status, and MOTD.
 */
async spawn(owner: Agent, request: TerminalSpawnRequest, signal?: AbortSignal): Promise<TerminalSpawnResult>

/**
 * Test whether an exact owner has a published session or unpublished spawn.
 * @param owner - exact live owner to inspect.
 * @returns true across the entire spawn-to-close interval, with no publication gap.
 */
hasOwnerActivity(owner: Agent): boolean

/**
 * Start one exclusive interactive send.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param request - explicit text, submit behavior, and cancellation.
 * @returns live operation handle for foreground await or task registration.
 */
startSend(owner: Agent, id: TerminalSessionId, request: TerminalSendRequest): TerminalSendOperation

/**
 * Read one bounded scrollback page from an owned session.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param request - optional newest-relative offset and line count.
 * @returns bounded retained text and pagination metadata.
 */
read(owner: Agent, id: TerminalSessionId, request: TerminalReadRequest = {}): TerminalReadResult

/**
 * Deliver an allowed signal through an owned backend session.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param signal - allowed POSIX signal name.
 * @returns delivered foreground process-group identity.
 */
signal(owner: Agent, id: TerminalSessionId, signal: TerminalSignal): Promise<TerminalSignalResult>

/**
 * Close one owned session and remove it only after quiescent backend cleanup.
 * @param owner - exact session owner.
 * @param id - target PTY identity.
 * @param reason - diagnostic cleanup reason.
 * @returns true for a newly closed session, false when the same close is already in flight.
 */
async kill(owner: Agent, id: TerminalSessionId, reason: string = 'model request'): Promise<boolean>

/**
 * List fresh snapshots for exactly one owner.
 * @param owner - exact owner whose sessions are visible.
 * @returns owner-visible snapshots in publication order.
 */
list(owner: Agent): TerminalSessionSnapshot[]
```

型: [Agent](core.md)

ソース: [`packages/terminal/terminal/src/index.ts:105`](../../packages/terminal/terminal/src/index.ts)
<!-- END GENERATED cordis-surface -->
