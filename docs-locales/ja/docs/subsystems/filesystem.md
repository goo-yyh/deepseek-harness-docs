# ファイルシステム

オプションのファイルシステム機能は 4 つの部分で構成されます。[dsh-fs](../../packages/fs/fs) は `ctx.fs` と、任意のガードを伴うアトミックなテキスト操作を所有します。[dsh-fs-local](../../packages/fs/fs-local) はローカルディスクを実装します。[dsh-fs-observation-policy](../../packages/fs/fs-observation-policy) は観測された存在または不在を記録し、サービスではなくイベントを通じて鮮度ルールを追加します。[dsh-tool-fs](../../packages/fs/tool-fs) はモデル向けの read/write/edit 呼び出しを直接実行し、ウィンドウをレンダリングします。これはエージェントループの中核には含まれず、代替バックエンドでもポリシーやツールスキーマは変わりません。

`dsh-fs-observation-policy` は任意です。これがない場合、`FileSystem` サービス定義、プロバイダー、および `dsh-tool-fs` コンシューマーによって、完全で制約のないファイルシステムの抽象シームが構成されます。`write` は無条件で作成または上書きし、`edit` はリテラルテキストを無条件で置き換えます。ポリシープラグインは、`fs/*` のウォーターフォールを決定することで、これらの操作を変更します。ツールは `ctx.fs` を呼び出してイベントをディスパッチし、ポリシーメソッドを呼び出さないため、これを削除してもツールは壊れません。`dsh-tool-fs` を読み込むデプロイでは、デフォルトの動作が書き込みまたは編集前の読み取りとなるよう、`dsh-fs-observation-policy` も読み込むことが想定されています。

プロバイダーのソース: [`packages/fs/fs/src/types.ts`](../../packages/fs/fs/src/types.ts) および [`packages/fs/fs/src/index.ts`](../../packages/fs/fs/src/index.ts)。ポリシーのソース: [`packages/fs/fs-observation-policy/src/types.ts`](../../packages/fs/fs-observation-policy/src/types.ts)。読み取りレンダリングのソース: [`packages/fs/tool-fs/src/read-render.ts`](../../packages/fs/tool-fs/src/read-render.ts)。

## ターゲットの識別子とメタデータ（プロバイダー契約）

すべての操作では、まずユーザー指定のパスを不透明なバックエンドターゲットに解決します。コンシューマーは `displayPath` を表示できますが、`targetKey`（ブランド付きの不透明 ID）を解析したり、それがローカルの絶対パスであると仮定したりしてはなりません。

ファイルシステムの実行環境を共有するコンシューマーは、その識別子を解釈するのではなく、プロバイダーを通じて機能横断の座標を取得します。`processPath(target)` はサブプロセスが開ける正規の絶対パスを返し、`fileUrl(target)` はそのプロバイダープラットフォームの `file:` URI を返し、`contains(parent, child)` は正規の同一性または子孫の包含関係をテストします。

```ts type-equiv
/**
 * A path resolved by a backend into a stable identity. `resolve()` produces
 * this; every other operation takes it.
 */
interface FsTarget {
  /** Opaque key for stale guards and target lookup. */
  targetKey: FsTargetKey
  /**
   * Path for model/UI-facing output. May be a local absolute path,
   * workspace-relative path, or remote URI depending on the backend.
   */
  displayPath: string
}
```

バックエンドはファイルバージョントークン、すなわち書き込みまたは編集がガードする鮮度トークンを所有します。ポリシープラグインは古い状態のチェックのためにこれらを保存します。コンシューマーはこれらを解釈しません。どちらの ID もブランド付きの不透明な文字列です。

```ts type-equiv
/**
 * Opaque key for stale guards and target lookup. The local backend uses a
 * realpath-like string; a remote backend might use a workspace URI or file id.
 * Consumers MUST NOT parse it or assume it is a local absolute path.
 */
type FsTargetKey = Branded<'FsTargetKey'>
```

```ts type-equiv
/**
 * Opaque file-version token — the freshness token a write/edit guards against.
 * The local backend derives it from high-resolution stat identity and freshness
 * fields; a remote backend might use a revision id. The policy layer records it
 * for stale checks; consumers may display related metadata but MUST NOT
 * interpret this token.
 */
type FsVersion = Branded<'FsVersion'>
```

`stat` はメタデータ（コンテンツは決して返しません）を返します。ターゲットが存在しない場合は `undefined` を返します。`type` により、コンシューマーは読み取り前にディレクトリと特殊ファイルを拒否でき、`size` により、テキストコンシューマーは失敗によるプローブなしで `readText` と `streamText` を選択できます。テキストコンシューマーは、`streamText` の消費中に独自の保持上限を適用します。生バイトのコンシューマーは `readBytes(target, signal, maxBytes)` を使用します。その必須の完全コンテンツ上限により、既知または検出された超過は、切り詰めたり上限なくバッファリングしたりせずに `FS_TOO_LARGE` で失敗します。

```ts type-equiv
/**
 * Metadata about a target — what {@link FileSystem.stat} returns. Lets the
 * policy layer reject directories/special files before reading and choose
 * `readText` vs `streamText` from `size` without probing by failure. `version`
 * is the freshness token. `undefined` from `stat` means the target is absent.
 */
interface FsInfo {
  /** Opaque freshness token of the target right now. */
  version: FsVersion
  /** Whether the target is a regular file, a directory, or something else. */
  type: 'file' | 'directory' | 'other'
  /** Byte size of a regular file, when the backend can report it. */
  size?: number
}
```

`lstat` は、パスレベルでシンボリックリンクを追跡しないメタデータプリミティブです。これは `FsTarget` ではなくパスを受け取ります。`resolve` は安定した識別子を生成するために意図的にシンボリックリンクを追跡するからです。信頼境界のチェックが必要なコンシューマーは、解決前にまず `lstat` を呼び出し、`symlink` を拒否できます。

```ts type-equiv
/**
 * Metadata about a path without following the final path component when it is a
 * symbolic link. Unlike {@link FsInfo}, this path-level probe can report
 * `symlink` so consumers with trust-boundary rules can reject repository-owned
 * links before resolving a target.
 */
interface FsPathInfo {
  /** Opaque freshness token of the path entry right now. */
  version: FsVersion
  /** Whether the path entry is a regular file, directory, symlink, or other. */
  type: 'file' | 'directory' | 'symlink' | 'other'
  /** Byte size of the path entry, when the backend can report it. */
  size?: number
}
```

`listDir` は、安定した名前順で直接の子エントリを返します。各エントリには、子のベース名、種類、解決済みターゲット、およびバックエンドが報告できる場合は低コストなメタデータが含まれます。ファイル内容を読み取ってはならないため、`size` は通常ファイル専用であり、`version` はメタデータから導出されます。壊れた、または消失した子は、メタデータなしで `other` として返される場合があります。子メタデータの一覧取得または解決中に発生した権限またはバックエンド I/O の失敗は、`FS_PERMISSION_DENIED` または `FS_IO_ERROR` により一覧全体を失敗させます。

```ts type-equiv
/**
 * One direct child returned by {@link FileSystem.listDir}. Listing returns
 * metadata and resolved targets only; it must not read file contents.
 */
interface FsDirEntry {
  /** Basename of the child inside the listed directory. */
  name: string
  /** Whether the child is a regular file, a directory, or something else. */
  type: 'file' | 'directory' | 'other'
  /** Resolved child target for follow-up operations. */
  target: FsTarget
  /** Opaque freshness token when the backend can report metadata cheaply. */
  version?: FsVersion
  /** Byte size of a regular file, when the backend can report it. */
  size?: number
}
```

## 書き込みと編集のガード（プロバイダー契約）

`writeText` と `editText` はどちらもバージョンガードを任意で受け取ります。無条件の（ベアプロバイダーによる）変更では省略し、ガードする場合は指定します。`writeText` のガードは `FsWriteIntent` です。`createIfAbsent` は存在しないターゲットを作成し、既存のターゲットを `FS_NOT_OBSERVED` で拒否します。これには、公開自体が置換なしでなければならないため、プロバイダーの初期プローブ後に出現したターゲットも含まれます。`replaceIfVersion` は、ターゲットが観測されたバージョンで存在する場合にのみ置き換え、それ以外の場合は `FS_STALE_VERSION` となります。`expected` を省略すると、無条件で作成または上書きします。ユニオン自体が持つのはこの 2 つのガード付き意図だけであり、「ガードなし」は省略で表現されるため、書き込みと編集はいずれも同じ任意の `expected` フィールドを使用します。

```ts type-equiv
/**
 * Guarded write intent. `createIfAbsent` rejects an existing target with
 * `FS_NOT_OBSERVED`; `replaceIfVersion` rejects absence or mismatch with
 * `FS_STALE_VERSION`. Omitting the intent from `writeText` means unconditional
 * create-or-overwrite, not a third union arm.
 */
type FsWriteIntent =
  | { kind: 'createIfAbsent' }
  | { kind: 'replaceIfVersion'; version: FsVersion }
```

```ts type-equiv
/** Outcome of a full-file write. */
interface FsWriteOutcome {
  /** Whether the write created a new file or replaced an existing one. */
  operation: 'create' | 'update'
  /** Opaque version of the file after the write. */
  version: FsVersion
  /**
   * The file's content BEFORE the write, or `null` when the file did not exist
   * (a create) or the backend declined a contextual basis (for example, a
   * binary/non-UTF-8 prior file or either overwrite side reaching its exclusive limit).
   * LF-normalized storage text (the diff basis), never a diff — a consumer
   * computes the result-time contextual diff from `before`/`after` when
   * `before` is present, else falls back to a whole-file diff.
   */
  before: string | null
  /** The file's content AFTER the write, LF-normalized to share `before`'s diff basis. */
  after: string
}
```

`editText` はプロバイダーレベルの変更であり、`read` と `write` を別の場所で組み合わせたものではありません。ガード付きの場合、リテラル照合の前に期待されるバージョンを検証します（そのため、古い編集では新しいコンテンツに対する一致失敗ではなく `FS_STALE_VERSION` が報告されます）。ガードなしの場合は現在のコンテンツを編集します。いずれの場合も、置換を適用してアトミックに書き込みます。つまり、照合、改行コードの処理、古さの確認、アトミックな置換を 1 つの変更クリティカルセクション内に保持します。また、対象が存在しない場合は、どちらの経路でも `FS_STALE_VERSION` が報告されます。

```ts type-equiv
/** A literal-replacement edit request. */
interface FsEditRequest {
  /** Literal non-empty text to replace. Must match exactly (after line-ending normalization). */
  oldString: string
  /** Literal replacement text. An empty string deletes the matched text. */
  newString: string
  /** Replace every match instead of requiring exactly one. */
  replaceAll: boolean
}
```

```ts type-equiv
/** Outcome of a literal edit. */
interface FsEditOutcome {
  /** Opaque version of the file after the edit. */
  version: FsVersion
  /**
   * The file's content BEFORE the edit. Raw storage text (LF-normalized by the
   * backend), never a diff — a consumer computes the result-time contextual diff
   * (the applied hunk with context) from `before`/`after`.
   */
  before: string
  /** The file's content AFTER the edit. */
  after: string
}
```

## fs ポリシーイベント（プロバイダー契約の語彙）

`dsh-fs` は、ツールがディスパッチし、ポリシープラグインがリッスンする 3 つのイベントを所有します。そのため、エミッター（`dsh-tool-fs`）とリスナー（`dsh-fs-observation-policy`）は、エミッターがポリシープラグインに依存することなく語彙を共有できます。これらは `dsh-fs` の語彙と不透明な `object` アクターのみを持ち、モデル向けの概念やエージェント／セッションの所有者構造は持ちません。

`fs/write-intent` と `fs/edit-intent` は、**単一スロットの決定ウォーターフォール**です。ツールは、それぞれに `undefined`（素のプロバイダー）を返すデフォルトの thunk を付けてディスパッチし、リスナーは `next()` を呼び出さずに完全な判断を行います。スロットは登録順で先勝ちです。これを所有するポリシープラグインはデプロイ規約であり、強制された不変条件ではありません。`fs/observed` は、`FsObservation` を伝える fire-and-forget の記録イベントです。バージョン時点で存在するか、不在が確認された状態です。これは通常の `ctx.emit` でディスパッチされます。ツールは emit を保護しないため、リスナーは同期的で副作用のみでなければなりません。例外を送出するリスナーは、読み取りエラーを置き換えるか、変更がすでに成功した後にツールの `isError` 結果として表面化する可能性があります。以下の生成された [Cordis サーフェス](#cordis-surface)は、正確なシグネチャを示しています。

```ts type-equiv
/**
 * One authoritative observation of a target. A present observation carries the
 * version used by guarded replacement; an absent observation authorizes only a
 * guarded create, never an edit.
 */
type FsObservation =
  | { readonly kind: 'present'; readonly version: FsVersion }
  | { readonly kind: 'absent' }
```

## 実行コンテキスト（ポリシープラグイン）

ポリシープラグインは、`fs/*` イベントが伝える不透明な `object` アクターを絞り込むことで、観測状態の所有者を導出するために必要十分な実行コンテキストだけを必要とします。`ToolExecution` には必須フィールドがあるため、`dsh-tool-fs` は実行オブジェクトをアクターとしてそのまま渡し、`dsh-fs-observation-policy` がツール、エージェント、またはセッションのパッケージをインポートすることはありません。

```ts type-equiv
/**
 * Minimal structural view of a tool execution the policy plugin needs to derive
 * an observed-state owner. `@deepseek-ai/dsh-tools`' `ToolExecution` contains
 * these fields, so the tool passes its `exec` straight through as the opaque
 * `object` actor on the `fs/*` events; this plugin narrows that actor to
 * `FsObservationActor` without importing `dsh-tools`, `dsh-agent`, or `dsh-session`.
 *
 * The owner is `agent.session` when present. It is treated as an opaque object
 * identity (a `WeakMap` key); this package never reads any of its fields.
 */
interface FsObservationActor {
  /** The agent on whose behalf the call runs, when there is one. */
  agent?: {
    /** The session that owns observed-file state, used as an opaque key. */
    session?: object
  }
}
```

## 読み取り結果（コンシューマー／読み取りレンダリング）

テキスト読み取りは、行ウィンドウ、バイト上限、およびバックエンドの制限によって制約されます。バイト上限に達した後も、`totalLines` を正確に保つため、それ以上の行を保持せずにスキャンを続けます。モデル向けの `read` ツールがレンダリングする結果は純粋に表示用です。`full`／`partial` ビューはありません。認可は鮮度に基づきます（ツールは stat のバージョンで存在中の `fs/observed` を直接 emit します）。そのため、ファイルが変更されていなければ、ウィンドウ付き読み取りでも後続の書き込み／編集を認可できます。メタデータの欠落では、ツールが `FS_NOT_FOUND` を返す前に不在の観測結果を emit します。これにより、後続のガード付き書き込みは、編集を認可せずに外部で削除された対象を再作成できます。読み取りを所有する実行器である `dsh-tool-fs` が読み取りウィンドウ処理を実装し、この結果を構築します。ポリシープラグインは実装しません。

```ts type-equiv
/** Outcome of a bounded text read — what {@link formatReadOutput} renders. */
interface FileReadOutcome {
  /** 1-based first line requested. */
  offset: number
  /** Returned lines, already numbered. */
  lines: FileTextLine[]
  /** Exact total line count in the file. */
  totalLines: number
  /** Whether selected output hit the byte cap. */
  truncatedByBytes?: true
}
```

## 観測済みファイル状態（ポリシープラグイン）

観測状態は、`dsh-fs-observation-policy` プラグイン内で保持される `WeakMap<owner, Map<targetKey, FsObservation>>` です。マップエントリがない場合は未観測を意味します。`{ kind: 'absent' }` は、`read` または `str_replace_editor` の `view`、`str_replace`、または `insert` メタデータ欠落が不在を確認したことを意味します。`{ kind: 'present', version }` は、読み取り、書き込み、または編集がそのバージョンを観測したことを意味します。書き込みの判断では、未観測と不在を `createIfAbsent` にマッピングし、存在中を `replaceIfVersion` にマッピングします。編集の判断では、未観測を `FS_NOT_OBSERVED`、不在を `FS_NOT_FOUND`、存在中をそのバージョンガードにマッピングします。所有者はイベントアクター（通常は `exec.agent.session`）から導出され、不透明なものとして扱われ、決して読み取られません。破棄時にはすべてを削除します（HMR の安全性）。また、ポリシーはファイルシステム I/O を実行しません。

## エラー分類（プロバイダー契約）

ファイルシステムの失敗では、`FsError`（`HarnessError`）によって保持される安定した `FsErrorCode` 文字列を使用します。ツールレジストリはエラー結果でも `{ name, code }` を保持するため、再試行、権限、UI のレイヤーはテキストを解析せずに分岐できます。

```ts type-equiv
/**
 * Stable, machine-routable codes for filesystem failures. Carried on
 * {@link FsError}; the tool registry exposes `{ name, code }` on `isError`
 * results so retry/permission/UI layers can branch without parsing messages.
 */
type FsErrorCode =
  | 'FS_NOT_FOUND'
  | 'FS_NOT_DIRECTORY'
  | 'FS_NOT_TEXT'
  | 'FS_NOT_REGULAR_FILE'
  | 'FS_TOO_LARGE'
  | 'FS_PERMISSION_DENIED'
  | 'FS_SANDBOX_DENIED'
  | 'FS_IO_ERROR'
  | 'FS_STALE_VERSION'
  | 'FS_NOT_OBSERVED'
  | 'FS_AMBIGUOUS_EDIT'
  | 'FS_EDIT_NOT_FOUND'
  | 'FS_ABORTED'
```

`FS_NOT_DIRECTORY`、`FS_PERMISSION_DENIED`、および`FS_IO_ERROR`は、ディレクトリ一覧で、既存の非ディレクトリ対象、拒否された一覧取得、予期しないバックエンド I/O 障害を区別するために使用されます。`FS_SANDBOX_DENIED`はサンドボックス強制バックエンド（`dsh-fs-sandbox`）からの POLICY 拒否です。モードフェンスが書き込み/編集を拒否したことを表し、`FS_PERMISSION_DENIED`（ホストカーネルによる拒否）とは異なります。`FS_NOT_OBSERVED`は、ポリシープラグインにこの所有者の事前観測レコードがないこと（または`createIfAbsent`が既存ファイルにヒットしたこと）を意味します。`FS_NOT_FOUND`は、確認済みの不在状態から拒否された編集も表します。`FS_STALE_VERSION`は、バックエンドのバージョンが観測済みのものと一致しなくなったこと（またはプロバイダー自体が存在しない対象への編集を受け取ったこと）を意味します。鮮度の認可には部分/完全の区別がないため、`FS_PARTIAL_OBSERVATION`はありません。

## ファイル I/O にタイムアウトはありません

`read`/`write`/`edit`は**タイムアウトを受け取りません** `timeoutMs`。また、プロバイダー契約も期限を設定しません。これは bash および web（[`@deepseek-ai/dsh-timeout`](../../packages/util/timeout/README.md)を消費します）、ならびにサブプロセスを利用する`glob`/`grep`（宣言された`timeoutMs`が`@deepseek-ai/dsh-tool-call-timeout-policy`により強制されます）とは異なります。これらはプロセスベースであり、期限によって実際に処理を停止できるためです。ローカルのシステムコールは、せいぜいベストエフォートで中止できます。タイムアウトでは進行中の`fsync`/`rename`を強制停止できないため、ここでの`timeoutMs`は抽象シームが強制できない期限となり、明示より暗黙を禁じる箇所に暗黙のデフォルトを置くことになります。キャンセルは引き続きツール実行シグナルを介して伝播し、システムコール境界でのベストエフォート中止を行います。

## サービスとプラグイン

`FileSystem`（`ctx.fs`、抽象）は、プロバイダーのプリミティブを所有します。`resolve`、`processPath`、`fileUrl`、`contains`、`stat`、`lstat`、`readText`、`streamText`、`readBytes`、`listDir`、`writeText`、および`editText`です。`dsh-fs-observation-policy`は**サービスを登録しません** 。これは`fs/*`イベントゲートを通じてポリシーを追加するプラグインです。unseen/absent/presentの状態から書き込み/編集意図のウォーターフォールを決定し、`FsObservation`値を記録します。実行者は`dsh-tool-fs`です。`ctx.fs`を介してreads/writes/editsし、ウォーターフォールをディスパッチして、記録イベントを発行します。以下の生成された[`ctx.fs`セクション](#ctxfs--filesystem-abstract-seam)に、正確なシグネチャを示します。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`によってソースから生成されています（doc-sync で`pnpm run verify-cordis-catalog`により最新性を検証します。再生成には`pnpm run gen-cordis-catalog`を使用します）。このセクションはページの両言語版でバイト単位で同一です。シグネチャブロックには`ts cordis-catalog`フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義され、フレームワークから継承した`ctx` API は[cordis-api/inherited.md](../cordis-api/inherited.md)にあります。

<a id="ctxfs--filesystem-abstract-seam"></a>

### `ctx.fs` — `FileSystem`（抽象シーム）

抽象ファイルシステムプロバイダーです。対象はエイリアス間で同一性を保持する必要があります。読み取りは通常の UTF-8 テキストまたは型付きエラーを公開し、一覧は安定して内容を含まず、変更はアトミックです。オプションのガードは、ガードなしのプロバイダー契約を変更せずに古さに対する保護を追加します。

```ts cordis-catalog
/**
 * Resolve a model/plugin-supplied path into a stable {@link FsTarget}. May perform I/O (a
 * remote/sandboxed backend may need a round-trip to map a path to a stable identity), hence
 * async even though the local backend only normalizes + realpaths.
 *
 * @param path - the path to resolve; relative paths resolve against `opts.cwd`.
 * @param opts - optional cwd override and cancellation signal.
 * @returns the stable target; the same file yields the same `targetKey`.
 */
abstract resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>

/**
 * Return the canonical absolute path a subprocess in this filesystem's
 * execution world can open. The path is deliberately separate from
 * {@link FsTarget.targetKey}: consumers may pass this value to another OS
 * capability, but must continue treating the target key as opaque.
 * @param target - the resolved target whose process path is required.
 * @returns an absolute path in the backend's execution world.
 */
abstract processPath(target: FsTarget): string

/**
 * Return the canonical `file:` URI for a target in this filesystem's
 * execution world. Backends own URI encoding because the host platform may
 * differ from the execution platform.
 * @param target - the resolved target to encode.
 * @returns the target's canonical file URI.
 */
abstract fileUrl(target: FsTarget): string

/**
 * Test canonical containment without exposing or parsing backend target
 * keys. Both targets must come from this provider.
 * @param parent - canonical directory target.
 * @param child - canonical candidate target.
 * @returns true when `child` is `parent` or a descendant of it.
 */
abstract contains(parent: FsTarget, child: FsTarget): boolean

/**
 * Return target metadata, or `undefined` when the target does not exist.
 * @param target - the resolved target to stat.
 * @param signal - aborts the metadata round-trip.
 * @returns metadata only, never content; undefined for an absent target.
 */
abstract stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>

/**
 * Return path metadata without following the final path component when it is a
 * symbolic link. This is intentionally path-shaped, not target-shaped:
 * {@link resolve} follows symlinks to produce the stable identity used by
 * normal reads/writes, while `lstat` lets a consumer reject the path itself
 * before that follow happens.
 *
 * `opts.cwd` follows {@link resolve}'s cwd rules. `undefined` means the path is
 * absent.
 * @param path - the path to inspect; relative paths resolve against `opts.cwd`.
 * @param opts - `cwd` overrides the backend's default base for relative paths.
 * @param signal - aborts the metadata round-trip.
 * @returns metadata only, never content; undefined for an absent path.
 */
abstract lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined>

/**
 * Read the whole regular text file as a single decoded string.
 * @param target - the resolved target to read.
 * @param signal - aborts the read.
 * @returns the full decoded UTF-8 content.
 */
abstract readText(target: FsTarget, signal?: AbortSignal): Promise<string>

/**
 * Stream the whole regular text file as decoded text chunks (same text
 * semantics as {@link readText}, for large files). The backend owns
 * cross-chunk UTF-8 decoding and binary rejection so the policy layer never
 * touches raw bytes.
 * @param target - the resolved target to read.
 * @param signal - aborts the stream, including between chunks.
 * @returns the chunk iterable, decoded and validated like {@link readText}.
 */
abstract streamText(target: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>

/**
 * Read the whole regular file as raw bytes with no decoding or binary
 * rejection. The bound lives at this seam so a backend can never buffer an
 * unbounded file: a target known or discovered to exceed `maxBytes` fails
 * with `FS_TOO_LARGE` instead of returning a truncated result.
 * @param target - the resolved target to read.
 * @param signal - aborts the read.
 * @param maxBytes - inclusive byte cap on the complete content.
 * @returns the full raw content, at most `maxBytes` long.
 */
abstract readBytes(target: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array>

/**
 * List direct children of a directory in stable name order. Returns resolved
 * child targets plus cheap metadata only; never reads file contents.
 * @param target - the resolved directory target.
 * @param signal - aborts the listing.
 * @returns one entry per direct child, in stable name order.
 */
abstract listDir(target: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]>

/**
 * Atomically create or replace UTF-8 text. `expected` guards intent and
 * staleness; omission allows unconditional overwrite.
 * @param target - the resolved target to write.
 * @param content - the full new file content.
 * @param expected - the write intent guarding the write; omit for unconditional.
 * @param signal - aborts before atomic publication takes effect.
 * @param sandboxPolicy - the per-call mode and workspace root this write
 *   runs under; a sandboxing backend fences the write by it, the bare backend
 *   ignores it. Omit to leave the backend its own default.
 * @returns the outcome, including the version the write produced.
 */
abstract writeText( target: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy, ): Promise<FsWriteOutcome>

/**
 * Atomically edit literal text. When supplied, the version guard is checked
 * before matching so stale content reports `FS_STALE_VERSION`; omission edits
 * the current content without a freshness precondition.
 * @param target - the resolved target to edit.
 * @param edit - the literal search/replace request.
 * @param expected - the version guard; omit for an unconditional edit.
 * @param signal - aborts before atomic publication takes effect.
 * @param sandboxPolicy - the per-call mode and workspace root this edit runs
 *   under; a sandboxing backend fences the edit by it, the bare backend
 *   ignores it. Omit to leave the backend its own default.
 * @returns the outcome, including the version the edit produced.
 */
abstract editText( target: FsTarget, edit: FsEditRequest, expected?: { version: FsVersion }, signal?: AbortSignal, sandboxPolicy?: SandboxExecutionPolicy, ): Promise<FsEditOutcome>
```

型: [SandboxExecutionPolicy](sandbox.md)

出典: [`packages/fs/fs/src/index.ts:86`](../../packages/fs/fs/src/index.ts)

<a id="fs-events"></a>

### `fs/*` イベント

<a id="fsedit-intent--waterfall"></a>

#### `fs/edit-intent` — ウォーターフォール

次の FileSystem.editText に対する単一スロットの判断です。`next()`を呼び出すと無条件の編集が生成され、最初に返されたガードが採用されます。

```ts cordis-catalog
/**
 * Single-slot decision for the next {@link FileSystem.editText}. Calling
 * `next()` yields an unconditional edit; the first returned guard wins.
 * @param target - the resolved target about to be edited.
 * @param actor - the opaque tool-execution context the decider keys off.
 * @mode waterfall
 */
'fs/edit-intent'(target: FsTarget, actor: object | undefined, next: () => { version: FsVersion } | undefined | Promise<{ version: FsVersion } | undefined>): Promise<{ version: FsVersion } | undefined>
```

出典: [`packages/fs/fs/src/index.ts:66`](../../packages/fs/fs/src/index.ts)

<a id="fsobserved--emit"></a>

#### `fs/observed` — 発行

権威ある肯定または否定の観測結果を記録します。リスナーは同期的な記録役でなければなりません。例外が発生するとツール呼び出しは失敗し、返された Promise は待機されません。

```ts cordis-catalog
/**
 * Record an authoritative positive or negative observation. Listeners must
 * be synchronous recorders: throws fail the tool call and returned promises
 * are not awaited.
 * @param target - the target whose presence or absence was observed.
 * @param observation - present with its version, or confirmed absent.
 * @param actor - the observing tool-execution context; undefined records nothing useful.
 * @mode emit
 */
'fs/observed'(target: FsTarget, observation: FsObservation, actor: object | undefined): void
```

出典: [`packages/fs/fs/src/index.ts:76`](../../packages/fs/fs/src/index.ts)

<a id="fswrite-intent--waterfall"></a>

#### `fs/write-intent` — ウォーターフォール

次の FileSystem.writeText に対する単一スロットの判断です。`next()`を呼び出すと、ベアプロバイダーによる無条件の書き込みが生成されます。意図を返した最初のリスナーが、ピアと合成するのではなく、その判断を所有します。

```ts cordis-catalog
/**
 * Single-slot decision for the next {@link FileSystem.writeText}. Calling
 * `next()` yields the bare provider's unconditional write; the first listener
 * that returns an intent owns the decision rather than composing with peers.
 * @param target - the resolved target about to be written.
 * @param actor - the opaque tool-execution context the decider keys off.
 * @mode waterfall
 */
'fs/write-intent'(target: FsTarget, actor: object | undefined, next: () => FsWriteIntent | undefined | Promise<FsWriteIntent | undefined>): Promise<FsWriteIntent | undefined>
```

出典: [`packages/fs/fs/src/index.ts:58`](../../packages/fs/fs/src/index.ts)
<!-- END GENERATED cordis-surface -->
