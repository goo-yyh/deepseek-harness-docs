# スコープ付き登録

[scope パッケージ](../../packages/core/scope)は、1 つの登録コンテキストがエージェント単位の可視性と共有ライフタイムの所有権の両方を意味するための、識別情報、キャリア、スコープ付きレイヤーの語彙を提供します。これは Cordis サービスではなくライブラリのプリミティブです。[agent-scope のランタイム設計 Agent Note](../../.agents/notes/implemented/architecture/2026-07-12-agent-scope-runtime-design.md#scope-routing-one-opaque-key-selects-one-layer)はライフサイクルの根拠を、[shared-storage Agent Note](../../.agents/notes/implemented/architecture/2026-07-12-scoped-layers-store.md)はレジストリレイヤーの決定を、パッケージの[README](../../packages/core/scope/README.md)は呼び出し可能な API とフィルタリングのセマンティクスを担当します。

ソース: [`packages/core/scope/src/index.ts`](../../packages/core/scope/src/index.ts) および [`packages/core/scope/src/store.ts`](../../packages/core/scope/src/store.ts)。

## 識別情報とディスパッチキャリア

`ScopeKey`は不透明なオブジェクト識別情報です。配布されるループは実行中の`Agent`オブジェクトを自身のキーとして使用しますが、このプリミティブがオブジェクトを調べることはありません。

```ts type-equiv
/** An opaque, identity-compared scope key. */
type ScopeKey = object
```

`Scoped<T>`は、`scopeTarget(base, key)`が返す不透明なルーティングレシーバー上のコンパイル時ブランドです。スコープでフィルタリングされたイベント宣言では、このキャリアが`this`型として必要になります。一方、実際のイベント対象は明示的な引数のままです。

```ts type-equiv
/**
 * A routing-only event receiver built by {@link scopeTarget}. The type
 * parameter records the subject type for dispatch checking; the carrier does
 * not expose the subject's properties. Event payloads carry the real subject.
 */
type Scoped<T extends object> = object & { readonly [ScopedBrand]: T }
```

## 所有される登録コンテキスト

`Scope`は、タグ付けされた登録コンテキストを 2 つの破棄経路と組み合わせます。`rawDispose`は順序付き複合エフェクトに必要な正確な Cordis disposer 識別情報を保持し、`dispose()`は直接呼び出し元と競合する呼び出し元に対する公開共有静止境界です。

```ts type-equiv
/** A minted registration scope and its quiescent disposal boundaries. */
interface Scope {
  /** Context through which scope-owned registrations are made. */
  ctx: Context
  /** Exact Cordis disposer, used when nesting this scope in an ordered composite effect. */
  rawDispose: () => Promise<void> | void
  /** Dispose every scope-owned registration; racing calls await the same completion. */
  dispose(): Promise<void>
}
```

## スコープ付きレジストリレイヤー

`ScopeLayer`は、グローバルまたは完全一致スコープのレベルにおける 1 つのレジストリの完全な寄与を表します。具体的なレイヤーは複数の名前付きテーブルと匿名テーブルを集約できます。レイヤー全体が空であることにより、`ScopedLayers`は兄弟テーブルを破棄せずにスコープ付き状態を回収できます。

```ts type-equiv
/** One scope's aggregate contribution to a registry. */
interface ScopeLayer {
  /** Whether every table in this layer is empty. */
  isEmpty(): boolean
}
```

`ScopedLayers<L>`は、即時作成されるグローバルレイヤーと遅延作成される完全一致スコープレイヤーを所有します。読み取りでレイヤーが作成されることはありません。`peek(undefined)`はオーバーレイがないことを意味し、`merge()`は挿入順のグローバル名前付きエントリに続けてスコープ付きシャドウを実体化します。登録では可視性と Cordis エフェクト所有権の両方に 1 つのコンテキストを使用し、任意の通知前に 1 つの同期 undo を収集して、Cordis の正確な disposer を返します。また、完全な`ScopeLayer`が空の場合にのみスコープ付きレイヤーを回収します。

`NamedEntries<V>`は、呼び出し元が管理する重複エラーとともに、挿入順の検索およびライブ反復を提供します。`AnonymousEntries<V>`は、等しい値も独立したままになるよう、各 append に一意の識別情報を与えます。反復は、空でない 1 つのテーブル世代内ではライブのままです。テーブルをドレインすると、既存のイテレーターは後続の挿入から切り離されます。どちらも冪等な正確なエントリの undo を返します。共有の`EntryValues`実装インターフェースは公開されません。
