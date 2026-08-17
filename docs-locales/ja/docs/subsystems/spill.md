# スピルストレージ

ツールの大きすぎるテキストを永続化し、モデル向けのロケーターと取得ガイダンスを返すスピルストレージの抽象的な接合部は、[機能の接合部](../../.agents/notes/implemented/architecture/2026-07-08-tool-output-spill-files.md)であり、複数のパッケージに分かれています。サービス定義（[dsh-spill](../../packages/spill/spill)、`ctx.spillStore`）、サービスプロバイダー（[dsh-spill-local](../../packages/spill/spill-local)、ホストファイルシステム上のプライベートなセッションスコープのファイル）、コンシューマー（[dsh-spill-policy](../../packages/spill/spill-policy)、`tools/post-execute`ポリシー）です。Spill はエージェントループの中核ではなく、**任意の機能の一つ**です。そのため、用語は[core.md](core.md)ではなくここで定義します。プレビューの仕組みは[dsh-output-retention](../../packages/util/output-retention)にあり、この接合部はポリシーから渡された最終テキストだけを保存します。

ソース： [`packages/spill/spill/src/types.ts`](../../packages/spill/spill/src/types.ts)

## 保存リクエスト

`saveText`が唯一のサービス操作です。`content`をそのまま永続化し、不透明なロケーター、バックエンド提供の取得ヒント、正確なバイト数を返します。リクエストには、保存時のストレージ名前空間（`owner`）、それを生成したツールと呼び出し（`source`、命名と調査に使用し、アクセス制御には使用しません）、およびバックエンドが命名ヒントとして使用できる`suggestedName`（パスではありません）が含まれます。

```ts type-equiv
/** One request to persist text to a spill artifact. */
interface SaveTextSpill {
  owner: SpillOwner
  source: SpillSource
  /**
   * A caller-suggested base name (e.g. `web_fetch.txt`). The backend sanitizes
   * it to a single safe path segment before use — it is a hint, never a path.
   */
  suggestedName: string
  /** The full text to persist (UTF-8). */
  content: string
}
```

```ts type-equiv
/**
 * Save-time storage namespace for a spilled artifact. The session id lets a
 * backend group storage under the producing session, but the returned
 * {@link SpillLocator} is the model-facing handle. Forked sessions inherit
 * locators already present in the seeded log; those artifacts are not copied or
 * re-owned, and spills produced after the fork use the child session id.
 */
interface SpillOwner {
  sessionId: SessionId
}
```

`SpillOwner.sessionId`は保存時のストレージ名前空間です。フォークされたセッションは、シードされたログにある既存のスピルロケーターを継承します。これらのアーティファクトはコピーも再所有もされず、フォーク後に生成されたスピルには子セッション ID が使用されます。保持期間のクリーンアップでは、古いロケーターが他の古いセッションアーティファクトとともに期限切れになる場合があります。スピルの接合部では、セッションごとのクリーンアップポリシーを定義しません。

```ts type-equiv
/**
 * Tool and call that produced one spilled artifact — recorded by the backend for a readable
 * filename and inspection. Not interpreted for access control; purely
 * descriptive.
 */
interface SpillSource {
  /** The tool whose result was spilled (e.g. `web_fetch`). */
  toolName: string
  /** The model-issued call id the result belongs to. */
  callId: CallId
  /** A short human label for the artifact (e.g. `result`). */
  label: string
}
```

## 結果

```ts type-equiv
/** A saved spill artifact: its locator, byte length, and backend-specific retrieval guidance. */
interface SpillRef {
  locator: SpillLocator
  bytes: number
  retrievalHint: string
}
```

`SpillLocator`は、バックエンドが返す[ブランド化された](core.md#branded-ids)モデル向けハンドルです。ローカルバックエンドではこれをファイルシステムパスとして表現します。リモートまたはデータベースバックエンドでは、URI、キー、またはコマンドトークンとして表現できます。コンシューマーはこれを不透明なものとして扱い、`read`が常に正しい取得方法だと仮定せず、`retrievalHint`で表現します。

```ts type-equiv
/**
 * Opaque model-facing handle for one spilled artifact. A local backend may use a
 * filesystem path; a remote or database backend may use a URI or key. Consumers
 * render it with {@link SpillRef.retrievalHint}, but do not parse it.
 */
type SpillLocator = Branded<'SpillLocator'>
```

## サービス

`SpillStore`（`ctx.spillStore`、[`packages/spill/spill/src/index.ts`](../../packages/spill/spill/src/index.ts)で定義）は、単一メソッドの抽象サービスです。`saveText(input) → Promise<SpillRef>`。FULL の`content`を永続化し、実際のストレージ障害（権限、ENOSPC、バックエンドの利用不可）時には REJECTS します。この接合部が担うのはストレージのみです。保持ポリシー、ツール結果の置換、取得／検索 API は含みません。

ローカルバックエンド（[dsh-spill-local](../../packages/spill/spill-local)）は`<root>/session-<hash>/<random>-<safeName>`配下に書き込みます。これは、設定済みまたは遅延作成されるプライベート（0700）ルート、`sha256(sessionId)`セッションサブディレクトリ、および設置されたシンボリックリンクによるリダイレクトを防ぐ、排他的な所有者専用（`open(path, 'wx', 0o600)`）書き込みで構成されます。その`locator`はローカルパスであり、`retrievalHint`はモデルに対し、そのパスで`read`または`grep`を使用するよう指示します。ポリシーコンシューマー（[dsh-spill-policy](../../packages/spill/spill-policy)）は、`maxInlineBytes`を超えるプレーンテキストの最終結果を、保持ライブラリによる先頭／末尾のプレビューとスピル参照に置き換えます。これはベストエフォートであり、保存に失敗しても、成功した呼び出しを`isError`にするのではなく、元のインライン結果を維持します。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`によってソースから生成されます（doc-sync で`pnpm run verify-cordis-catalog`により最新であることを検証し、`pnpm run gen-cordis-catalog`で再生成します）。このセクションは、ページの両方の言語版でバイト単位で同一です。シグネチャブロックは`ts cordis-catalog`フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義され、フレームワーク継承の`ctx` API は[cordis-api/inherited.md](../cordis-api/inherited.md)にあります。

<a id="ctxspillstore--spillstore-abstract-seam"></a>

### `ctx.spillStore` — `SpillStore`（抽象的な接合部）

抽象スピルストレージサービスです。サブクラス化して saveText を実装し、サブクラスをプラグインとして読み込んでください。`ctx.spillStore`として登録されます（コンテキストごとに実装は一つです。二つ目を読み込むと、cordis の標準的な重複サービス動作として例外が送出されます）。

すべての実装が守るべきセマンティクス:

- saveText は FULL の`content`をそのまま永続化し、不透明なロケーター、正確なバイト長、モデル向けの取得ガイダンスを返します。
- ストレージのスコープはリクエストの SaveTextSpill.owner セッションによって決まります。バックエンドはプライベート（誰でも読める状態ではない）な場所と、呼び出し元の`suggestedName`から導出されつつも決して同一ではない、衝突しない名前を選択します。
- `saveText`は、実際のストレージ障害（権限、ENOSPC、バックエンドの利用不可）時には REJECTS します。呼び出し元が劣化時の動作を決定します（スピルポリシーは拒否をベストエフォートとして扱い、インライン結果を維持します）。

```ts cordis-catalog
/**
 * Persist `input.content` to a session-scoped spill artifact.
 * @param input - the owner, caller-supplied source fields, suggested name, and full text to save.
 * @returns the saved artifact's {@link SpillRef}; rejects on a storage failure.
 */
abstract saveText(input: SaveTextSpill): Promise<SpillRef>
```

ソース： [`packages/spill/spill/src/index.ts:45`](../../packages/spill/spill/src/index.ts)
<!-- END GENERATED cordis-surface -->
