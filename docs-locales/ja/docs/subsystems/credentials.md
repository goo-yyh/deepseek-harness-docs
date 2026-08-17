# ユーザー認証情報

[dsh-credentials](../../packages/credentials/credentials) の認証情報シームは、シークレットを設定から分離します。設定セクションと `cordis.yml` エントリには *参照* （環境変数名）を格納し、[dsh-credentials-local](../../packages/credentials/credentials-local) などのプロバイダーが値を管理します。コンシューマーは操作ごとに参照を一度解決します。LLM アダプターはモデルリクエストごとに一度解決するため、認証情報をローテーションすると再起動なしで直後のリクエストに反映されます。シーム全体の規則として、保存値が空の場合はどこでも存在しないものとして扱われます。

ソース： [`packages/credentials/credentials/src/index.ts`](../../packages/credentials/credentials/src/index.ts)

## 識別情報

参照は、POSIX 形式の環境変数名として 1 つの認証情報を指定します。ブランドにより、呼び出し元がパッケージ間またはプロセス間で渡される他の文字列と認証情報の参照を混同することを防ぎます。構築時にシェル識別子の構文を検証します。

```ts type-equiv
/** Nominal reference to one credential: a POSIX-style environment-variable name. */
type CredentialRef = Branded<'CredentialRef'>
```

## 解決

`resolve(ref)` は、値とそれを提供したプロバイダー定義のソースレイヤーを返します。未設定時は `undefined` を返します。コンシューマーは操作ごとに再解決し、操作をまたいでキャッシュしません。この操作ごとの読み取りがホットアップデートの仕組みです。

```ts type-equiv
/** One resolved credential value and the source layer that supplied it. */
interface ResolvedCredential {
  /** The non-empty secret value. */
  value: string
  /** Provider-defined source layer id (the local provider uses `env`, `file`, `project-env`, and `user-env`). */
  source: string
}
```

## 説明

`describe(ref)` は、値を公開せずに設定画面向けの情報を返します。参照が解決されるか、どのレイヤーから解決されるか、そして `set` が現在成功するかどうかです。ローカルプロバイダーは、実行中プロセスの環境から提供された参照を `writable: false` として報告します。書き込みは成功したように見えても、解決ではシャドーイングしている値が引き続き返されるため、シームはこれを拒否し、UI は事前に参照を読み取り専用として表示できます。

```ts type-equiv
/** Source and writability facts for one reference, safe for configuration UIs — never the value. */
interface CredentialInfo {
  /** Whether {@link CredentialProvider.resolve} would currently return a value. */
  configured: boolean
  /** Source layer currently supplying the value; absent while unconfigured. */
  source?: string
  /** Whether {@link CredentialProvider.set} would currently succeed for this reference. */
  writable: boolean
}
```

## 変更のコミット

`credentials/updated (ref)` は、プロバイダー管理のソースに対する変更がコミットされた後に発火します。対象は `set`、`unset`、またはストレージで検出された外部編集です。プロセス環境の外部変更は観測できないため、発火しません。コンシューマーにはイベントは不要です（操作ごとに再解決します）。これは「設定済み」バッジを更新する設定画面のために存在します。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts` によりソースから生成されます（doc-sync では `pnpm run verify-cordis-catalog` によって最新であることを検証します。再生成には `pnpm run gen-cordis-catalog` を使用します）。このセクションは、ページの両言語版でバイト単位で同一です。シグネチャブロックでは `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは [入門](../cordis-primer.md#dispatch-modes) で定義され、フレームワークから継承した `ctx` API は [cordis-api/inherited.md](../cordis-api/inherited.md) にあります。

<a id="ctxcredentials--credentialprovider-abstract-seam"></a>

### `ctx.credentials` — `CredentialProvider`（抽象シーム）

抽象認証情報サービスです。プロバイダーは各自のソースレイヤーに対して 4 つの操作を実装します。シーム全体の規則として、保存値が空の場合はどこでも存在しないものとして扱われます。つまり `resolve` はそれをスキップし、`describe` は未設定として報告するため、空の値が設定済みのシークレットを装うことはありません。

```ts cordis-catalog
/**
 * Resolve one reference to its current value. Resolution is per call:
 * consumers re-resolve at each operation and must not cache across
 * operations — that per-operation read is what makes a changed credential
 * reach the next operation without a restart.
 * @param ref - the reference to resolve.
 * @returns the value and its source, or `undefined` while unconfigured.
 */
abstract resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined>

/**
 * Describe one reference for configuration surfaces without exposing the
 * value.
 * @param ref - the reference to describe.
 * @returns configured state, supplying source, and writability.
 */
abstract describe(ref: CredentialRef): Promise<CredentialInfo>

/**
 * Durably store one value in the provider-managed writable source. Rejects
 * while a read-only source shadows the reference — the write would appear
 * to succeed while resolution keeps returning the shadowing value — and
 * rejects an empty value (use {@link unset}).
 * @param ref - the reference to store.
 * @param value - the non-empty secret value.
 */
abstract set(ref: CredentialRef, value: string): Promise<void>

/**
 * Remove one reference from the provider-managed writable source; removing
 * an absent reference is a no-op. Rejects while a read-only source shadows
 * the reference, like {@link set}.
 * @param ref - the reference to remove.
 */
abstract unset(ref: CredentialRef): Promise<void>
```

ソース： [`packages/credentials/credentials/src/index.ts:60`](../../packages/credentials/credentials/src/index.ts)

<a id="credentials-events"></a>

### `credentials/*` イベント

<a id="credentialsupdated--emit"></a>

#### `credentials/updated` — 発行

プロバイダー管理の認証情報ソースに対してコミットされた変更です。対象は `set`、`unset`、またはストレージで検出された外部編集です。プロセス環境の外部変更は観測できないため、発火しません。リスナーの失敗は同期 throw と非同期 rejection のいずれも封じ込められてログに記録され、コミット済み操作の結果は変わりません。ただし `INVARIANT` コードの失敗は除き、すべてのリスナー実行後に再スローされます。この再スローがエミッターに到達するのは同期リスナーからのみです。そのため、このイベントに対する不変条件チェックを非同期関数にしてはいけません。

```ts cordis-catalog
/**
 * Committed change to a provider-managed credential source: a `set`, an
 * `unset`, or an external edit observed in storage. Ambient
 * process-environment changes are not observable and never emit. Listener
 * failures are contained and logged — a sync throw and an async rejection
 * alike — without changing the committed operation's outcome, except
 * `INVARIANT`-coded failures, which rethrow after every listener ran;
 * that rethrow reaches the emitter only from synchronous listeners, so
 * invariant checks on this event must not be async functions.
 * @param ref - the reference whose stored value changed.
 * @mode emit
 */
'credentials/updated'(ref: CredentialRef): void
```

ソース： [`packages/credentials/credentials/src/types.ts:29`](../../packages/credentials/credentials/src/types.ts)
<!-- END GENERATED cordis-surface -->
