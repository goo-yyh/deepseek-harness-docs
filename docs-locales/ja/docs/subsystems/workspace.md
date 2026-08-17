# ワークスペース

ワークスペースは、ユーザーが作業するディレクトリの永続的な記録です。正規化されたパスに対応する安定した id、表示タイトル、およびそれに属するセッションの順序付き一覧を保持します。このサブシステムは 1 つのパッケージ（[dsh-workspace](../../packages/workspace/workspace)、`ctx.workspaceRegistry`）で構成されます。これは任意のホスト側機能であり、エージェントループの中核には含まれず、モデルからは見えません（ツール、プロンプトテキスト、セッションイベントはいずれもありません）。記録は[ストレージドメイン形式](storage.md)を通じて保存し、セッションの所属は[`SessionHeader.cwd`](persistence.md#sessionheader--metadata-beside-the-log)に照らして検証します。そのため、`storageDomain`と`sessionPersistence`は起動時に必須の依存関係です。永続化ピアを利用できない場合、プラグインは空の履歴と誤認されるのではなく保留状態になります。設計記録: [ドメイン KV ストレージ Agent Note](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md)。ブートストラップと GUI の順序: [Workspace UI プロダクトフロー Agent Note](../../.agents/notes/implemented/feature/2026-07-25-workspace-ui-product-flow.md)。

ソース： [`packages/workspace/workspace/src/types.ts`](../../packages/workspace/workspace/src/types.ts)

## 識別情報

```ts type-equiv
/**
 * Identifies one workspace record. A generated uuid, never the path: path
 * normalization rewrites paths, and a reference anchor must stay stable.
 */
type WorkspaceId = Branded<'WorkspaceId'>
```

`WorkspaceId`は[ブランド付き id](core.md#branded-ids)です。パスの識別情報は別です。`realpathNormalize`（`fs.realpath`。末尾のスラッシュ、`..`、およびシンボリックリンクを解決済み）が唯一の一意性基準です。ワークスペースのパスは正規化して保存され、一意性は正規化されたパス文字列の等価性で判定されます（所有済みディレクトリへのシンボリックリンクは衝突します）。また、アタッチ時のセッション cwd チェックも同じ基準を通ります。

## ワークスペースエンティティ

コンシューマーが参照できるのは`Workspace`インターフェースのみで、実装はパッケージプライベートのままです。

```ts type-equiv
/**
 * One workspace: a stable id over an existing directory, a display title, and
 * an ordered candidate account of sessions. Membership requires both an id in
 * that account and a session header whose canonical cwd equals the workspace
 * path. Consumers only see this interface; the implementation stays private.
 */
interface Workspace {
  /** Stable record id (generated uuid). */
  readonly id: WorkspaceId

  /**
   * Canonical directory path: the `fs.realpath` of the path given at create
   * time (trailing slashes, `..`, and symlinks all resolved). Never rewritten
   * afterwards, even when the directory disappears (see {@link status}).
   */
  readonly path: string

  /** Display title. Defaults to `basename(path)` at create; duplicates are allowed. */
  readonly title: string

  /** ISO-8601 creation instant, stamped at create and never rewritten. */
  readonly createdAt: string

  /** ISO-8601 instant of the last durable mutation (create counts as one). */
  readonly updatedAt: string

  /**
   * Header-validated sessions in manually owned order: a new session is
   * prepended at attach, explicit reordering goes through
   * `insertSessionBefore`, and activity never reorders. The durable candidate
   * account is filtered synchronously: missing headers, invalid cwd values,
   * and canonical cwd mismatches are never returned. A subsequent workspace
   * mutation prunes those filtered candidates durably.
   */
  readonly sessionIds: readonly SessionId[]

  /**
   * Replace the display title durably.
   * @param title - New title; any string, duplicates across workspaces allowed.
   * @returns resolution after durability.
   */
  setTitle(title: string): Promise<void>

  /**
   * Prepend a session to this workspace's candidate account. An already
   * accounted id resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs. A new id's
   * live or persisted
   * header cwd must resolve to an existing directory equal to {@link path};
   * unknown ids, missing or invalid cwd values, and mismatches reject without
   * writing.
   * @param sessionId - The session to record.
   * @returns resolution after durability.
   */
  attachSession(sessionId: SessionId): Promise<void>

  /**
   * Move an accounted session within the manual order, DOM-insertBefore-like:
   * with an anchor the session lands before it, without one it appends to the
   * end. Only the moved id changes position. A session or anchor absent from
   * the account rejects without writing; a move to the current position
   * resolves without writing, aside from the durable filtered-candidate
   * prune every accepted mutation performs; decided on the domain write
   * chain.
   * @param sessionId - The accounted session to move.
   * @param beforeSessionId - Accounted anchor to insert before; omitted appends.
   * @returns resolution after durability.
   */
  insertSessionBefore(sessionId: SessionId, beforeSessionId?: SessionId): Promise<void>

  /**
   * Remove a session from this workspace's account. Idempotent: an id not on
   * the account resolves without writing, aside from the durable
   * filtered-candidate prune every accepted mutation performs; decided on
   * the domain write chain like attach. Never touches the session's own stored log.
   * @param sessionId - The session to remove.
   * @returns resolution after durability.
   */
  detachSession(sessionId: SessionId): Promise<void>

  /**
   * Live directory check, uncached: whether {@link path} currently exists and
   * is a directory. A missing directory never mutates the record — the
   * directory may only be temporarily moved.
   * @returns `'ok'` when the directory exists, `'missing-dir'` otherwise.
   */
  status(): Promise<'ok' | 'missing-dir'>
}
```

所有権の正しい情報源はレコード内の順序付き`sessionIds`であり、セッション cwd から導出されることはありません。ただし所属には両方が必要です。すなわち、一覧内の id と、正規化された cwd がワークスペースパスと一致するヘッダーです。したがって、1 つのセッションが構造的に属せるワークスペースは最大 1 つです。書き込みに失敗すると拒否されます（`insertSessionBefore`の一覧エラーは`WorkspaceMoveInvalidError`として、ストレージ障害は通常のエラーとして扱われます）。受け入れられた変更では必ず`updatedAt`を記録し、所属チェックを通らなくなった候補を永続的に削除します。

## レジストリ: `ctx.workspaceRegistry`

`WorkspaceRegistry`（[シグネチャ](#ctxworkspaceregistry--workspaceregistry)）が登録と解決を担います。`create(path, title?)`はパスを正規化し、存在しないパス（元の`ENOENT`）またはディレクトリではないパスを拒否します。正規化されたパスがすでに所有されている場合は既存エンティティを変更せずに返し、それ以外の場合は`title ?? basename(path)`を永続的なレジストリ順序の先頭に追加したレコードを作成します。新しいレコードは既存の表示タイトルを重複できません（`WorkspaceNameConflictError`）。`get(id)`と順序付き`list()`は同期キャッシュ読み取りです。`resolveByPath(path)`は作成せずに同じ realpath 正規化を適用します。`delete(id)`は登録、順序エントリ、およびセッション一覧だけを削除します。ディレクトリ、ユーザーファイル、ライブセッション、永続化されたログには一切触れないため、それらのセッションは Ungrouped になります（[決定](../../.agents/notes/implemented/feature/2026-07-27-workspace-registration-deletion.md)）。不明な id では`false`を返します。作成と削除では、2 回の書き込み（レコード + 順序）が不整合になる前に、保留中の変更マーカーを永続化します。起動時にはマークされた変更だけを解決します。つまり、マークされたテーブル行を削除します。これにより中断された削除を完了し、中断された作成をロールバックします（登録は再作成できるため、ロールバックが安全な方向です）。マークのない順序とテーブルの不一致は、破損として明示的に失敗します。

セッションの cwd は、このレジストリではなく作成者から作成時に取得されます。API ゲートウェイは、選択したワークスペースの `path` から新しいセッションの cwd を解決し（明示的またはデフォルトの cwd にフォールバックします）、cwd が不変の [`SessionHeader`](persistence.md#sessionheader--metadata-beside-the-log) に格納されるようにセッションを作成した後、保存されたヘッダーの cwd をワークスペースパスに対して再検証する `attachSession` を呼び出します。最初の正常な起動時、レジストリは永続化されたヘッダーのみ（`id`、`cwd`、`createdAt`。イベント本文は使用しません）から履歴をブートストラップし、有効な正規 cwd を持つセッションをディレクトリごとのワークスペースにグループ化して、新しい順に並べます。初期化済みマーカーは最後に書き込まれるため、中断されたブートストラップも安全に再開できます。ブートストラップは一度限りです。cwd のないレガシーセッションは Ungrouped のままとなり、その後に作成されたセッションがワークスペースに参加するのは `attachSession` を通じてのみです。

## コンシューマー

[dsh-host-apiproxy](../../packages/host/apiproxy) はプロダクトのコンシューマーです。GUI クライアントに対して `ctx.workspaceRegistry` 経由でワークスペース CRUD を提供し、前述のセッション作成後にアタッチするフローを実行します。名前に反して、[dsh-agent-instructions](../../packages/context/agent-instructions) は **コンシューマーではありません** 。エージェント自身の cwd 配下にある AGENTS.md 形式の指示ファイルを検出し、`ctx.workspaceRegistry` には一切触れません。共有されているこの語は、このレジストリのエンティティではなくユーザーの作業ディレクトリを指します。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts` によりソースから生成されています（doc-sync では `pnpm run verify-cordis-catalog` により最新であることを検証します。再生成には `pnpm run gen-cordis-catalog` を使用します）。このセクションはページの両言語版でバイト単位で同一です。シグネチャブロックには `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは [入門](../cordis-primer.md#dispatch-modes) で定義され、フレームワークから継承された `ctx` API は [cordis-api/inherited.md](../cordis-api/inherited.md) にあります。

<a id="ctxdirectorypicker--directorypicker-abstract-seam"></a>

### `ctx.directoryPicker` — `DirectoryPicker`（抽象的な接続点）

抽象的なディレクトリ選択サービスです。サブクラス化して `capability()` を実装し、そのサブクラスをプラグインとして読み込むと、`ctx.directoryPicker` として登録されます（コンテキストごとに実装は 1 つです。2 つ目を読み込むと、cordis 標準の重複サービス動作により例外がスローされます）。機能オブジェクトはサービスの存続期間中、安定していなければなりません。コンシューマーは呼び出しをまたいでそれを保持する場合があります。

```ts cordis-catalog
/**
 * The backend's interaction capability.
 * @returns the discriminated capability consumers switch on.
 */
abstract capability(): DirectoryPickerCapability
```

ソース: [`packages/host/directory-picker/src/index.ts:131`](../../packages/host/directory-picker/src/index.ts)

<a id="ctxworkspaceregistry--workspaceregistry"></a>

### `ctx.workspaceRegistry` — `WorkspaceRegistry`

永続的なワークスペースレジストリです。起動時に `sessionPersistence` を待機し、正規 cwd ヘッダーの単一インデックスを構築してから、サービスがアクティブになる前に一度限りの履歴ブートストラップを完了します。永続化の依存関係は必須です。これにより、利用できないピアが空の履歴と誤認され、初期化済みマーカーがコミットされることはありません。

```ts cordis-catalog
/**
 * Create or reuse a workspace for an existing directory. The path is
 * canonicalized through `fs.realpath`; a nonexistent path rejects with the
 * original error and a non-directory rejects. Repeated calls for the same
 * canonical path return the existing entity without changing its title.
 * A newly created workspace is prepended to the durable registry order.
 * Different canonical paths may share a display title.
 * @param path - Existing directory to own, in any path spelling.
 * @param title - Display title used only when a new record is created.
 * @returns the existing or newly durable workspace.
 */
async create(path: string, title?: string): Promise<Workspace>

/**
 * Look up a workspace by id.
 * @param id - Workspace id.
 * @returns the workspace, or `undefined` when unknown.
 */
get(id: WorkspaceId): Workspace | undefined

/**
 * Synchronous workspace projection in durable registry order. Every
 * entity's `sessionIds` getter is already filtered by the startup/live
 * canonical-cwd header index; this method performs no persistence reads.
 * @returns a fresh ordered array of workspace entities.
 */
list(): Workspace[]

/**
 * Delete one workspace registration while retaining its directory and every
 * session log. The durable order is updated before the table deletion; a
 * failed table write restores the prior order and keeps the entity
 * published. Unknown ids are an idempotent no-op for domain callers.
 * @param id - Workspace registration to remove.
 * @returns `true` when a record was deleted, `false` when it was unknown.
 */
delete(id: WorkspaceId): Promise<boolean>

/**
 * Move one workspace within the durable display order, DOM-insertBefore-like.
 * With an anchor it lands before that workspace; without one it appends.
 * @param id - Workspace to move.
 * @param beforeId - Workspace anchor; omitted appends.
 * @returns the complete committed workspace order.
 */
insertBefore(id: WorkspaceId, beforeId?: WorkspaceId): Promise<readonly WorkspaceId[]>

/**
 * Archive one session durably. The session must exist (live or in session
 * persistence); its workspace accounting — or lack of one — is irrelevant.
 * An already archived id resolves without writing.
 * @param sessionId - The session to archive.
 * @returns resolution after durability.
 */
archiveSession(sessionId: SessionId): Promise<void>

/**
 * Resolve by canonical directory path without creating or mutating a
 * workspace. A missing path rejects during `realpath`; an existing unowned
 * directory returns `undefined`.
 * @param path - Existing directory path in any spelling.
 * @returns the workspace owning the canonical path, when one exists.
 */
async resolveByPath(path: string): Promise<Workspace | undefined>
```

型: [SessionId](core.md)

ソース: [`packages/workspace/workspace/src/index.ts:92`](../../packages/workspace/workspace/src/index.ts)
<!-- END GENERATED cordis-surface -->
