# 権限プリセット

[dsh-permission-presets](../../packages/interaction/permission-presets)（`ctx.permissionPresets`、`PermissionPresetService`）の権限プリセット層は、独立した 2 つの強制設定、すなわち[サンドボックスモード](sandbox.md)（`sandbox/mode`）と[承認ポリシー](approval.md)（`approval/policy`）を、クライアントが単一の「権限」セレクターとして提供する名前付きプリセットにまとめます。これはエージェントループの中核ではない任意の機能であり、強制機能は所有しません。実行、プロンプトの記述、リプレイは引き続き各設定値のフォールドを読み取り、プリセットの切り替えは意図を記録して各設定値の正規セッターに書き込むだけです。[パッケージ README](../../packages/interaction/permission-presets/README.md)が構成の状態と制約を定義し、[サンドボックス切り替え設計](../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)がその根拠を定義します。

出典: [`packages/interaction/permission-presets/src/index.ts`](../../packages/interaction/permission-presets/src/index.ts)

## プリセットテーブル

プリセットは、1 つのサンドボックス／承認バンドルと任意のクライアント表示にマッピングされるテーブルキーです。デフォルトテーブルには `workspace-write`（`workspace-write` + `ask`）および `danger-full-access`（`danger-full-access` + `never`）が含まれます。

```ts type-equiv
/** One preset's sandbox/approval bundle and optional client presentation. */
interface PresetSpec {
  /** The `sandbox/mode` value the preset writes through. */
  sandbox: SandboxMode
  /** The `approval/policy` value the preset writes through. */
  approval: ApprovalPolicy
  /** The display label a client shows for this preset; the raw table key when omitted. */
  name?: string
  /** One user-facing sentence on what the preset means; omitted when not configured. */
  description?: string
}
```

```ts type-equiv
/** The {@link PermissionPresetService} config: preset table and composition default. */
interface Config {
  /**
   * The preset table: name → knob bundle. Defaults to `workspace-write`
   * (workspace-write + ask) and `danger-full-access` (danger-full-access +
   * never). The name `custom` is reserved for the derived not-a-preset state.
   */
  presets?: Record<string, PresetSpec>
  /**
   * Default for new sessions. When omitted, the preset matching the composed
   * sandbox and approval defaults is used.
   */
  defaultPreset?: string
}
```

このサービスには、隔離する `ctx.shell` エグゼキューターと `ctx.approval` が必要です。設定ミスはプラグインの読み込み時に失敗します。`custom` という名前のテーブルエントリーは例外を送出します（この名前は、派生したプリセット外状態のために予約されています）。また、隔離しない bash エグゼキューター（`sandboxMode` 機能ファクトがないもの）に対して構成すると例外を送出します。これは、プリセットがサンドボックスモードをまとめるためです。

## 現在のプリセットと派生した `custom`

`current(events)` は、単独のイベントではなく設定値から有効なプリセットを導出します。セッションの有効なサンドボックスモード（エグゼキューターの設定済みモードにフォールバック）と有効な承認ポリシー（承認サービス設定にフォールバックし、次に `ask` にフォールバック）をフォールドし、依然として一致する記録済みの選択を優先し、次に宣言順で最初に一致するテーブルエントリーを選びます。それ以外の場合は `CUSTOM_PRESET`（`'custom'`）を返します。`custom` は導出専用です。クライアントは現在値として表示できますが、切り替え先やイベントペイロードにはなりません。

`names` は、切り替え可能なプリセットをテーブルの宣言順に一覧表示します。`optionOf(name)` は、テーブルキー（ラベルはキーにフォールバック）または `custom` に対してクライアントがレンダリングするオプションを構築し、それ以外の名前では例外を送出します。

```ts type-equiv
/** The select-option shape a presentation layer advertises for one preset (or for the derived `custom` state). */
interface PresetOption {
  /** Stable option value: the table key, or `custom`. */
  value: string
  /** The display label. */
  name: string
  /** One user-facing sentence on what the value means; omitted when not configured. */
  description?: string
}
```

## 切り替えと `permission/preset` イベント

`set(session, name)` はプリセットを解決し（不明な名前は例外を送出します）、`name` がすでに有効なプリセットでない限り、ログ専用の `permission/preset` イベントを追加します。その後、各設定値の有効値が変化する場合にのみ、それぞれのセッターを通じて書き込みます。つまり、[dsh-sandbox-policy](../../packages/sandbox/sandbox-policy) の `setSandboxMode` と、[dsh-user-approval](../../packages/interaction/user-approval) の `setApprovalPolicy` です。選択イベントは同一ターン内で設定値イベントに先行し、有効なプリセットを再選択しても何も追加されません。

`permission/preset` は永続的なログ専用のユーザー意図です。モデルのトランスクリプトには含まれません（設定値イベントが、そのコンシューマーを通じてモデルから見える結果を担います）。これは、2 つのプリセットが同じバンドルを共有する場合に `current()` がユーザーが選択したプリセットを保持できるようにするために存在します。`effectivePermissionPreset(events)` は最後のものをフォールドし、リプレイに追いつくための状態は必要ありません。完全なイベント宣言は[永続化ログイベントカタログ](../persistence-catalog.md)に、メソッドシグネチャは生成された[サービスカタログ](#ctxpermissionpresets--permissionpresetservice)にあります。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts` によりソースから生成されます（doc-sync で `pnpm run verify-cordis-catalog` によって最新であることを検証します。`pnpm run gen-cordis-catalog` で再生成してください）。このセクションはページの両言語版でバイト単位で同一です。シグネチャブロックでは `ts cordis-catalog` フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義され、フレームワークから継承した `ctx` API は[cordis-api/inherited.md](../cordis-api/inherited.md)にあります。

<a id="ctxpermissionpresets--permissionpresetservice"></a>

### `ctx.permissionPresets` — `PermissionPresetService`

デプロイメントの権限プリセットとその書き込み経路を所有します。隔離する `ctx.shell` エグゼキューターと `ctx.approval` が必要です。一致しない設定値はエラーではなく CUSTOM_PRESET として報告されます。

```ts cordis-catalog
/**
 * Resolve the preset matching the effective knob values. A still-matching
 * last selection wins shared-bundle ties; otherwise the first table match
 * wins, or {@link CUSTOM_PRESET} when no entry matches.
 * @param events - the session's events in log order.
 * @returns the effective preset name, or `custom` when nothing matches.
 */
current(events: readonly SessionEvent[]): string

/**
 * Build the whole select value for one folded knob state: every table
 * option in declaration order, `custom` appended exactly while derived.
 * @param state - the folded knob overrides.
 * @returns the `permissions` projection payload.
 */
selectFor(state: KnobState): PermissionSelect

/**
 * Resolve a preset's knob bundle.
 * @param name - the preset name to resolve.
 * @returns the configured bundle.
 * @throws when `name` is not in the table.
 */
resolve(name: string): PresetSpec

/**
 * Build the client option for a table entry or {@link CUSTOM_PRESET}. A
 * missing label falls back to the table key.
 * @param name - a table key, or `custom`.
 * @returns the option a client renders.
 * @throws when `name` is neither a table key nor `custom`.
 */
optionOf(name: string): PresetOption

/**
 * Record a changed preset, then update each changed knob through its own
 * setter. Selecting the effective preset again appends nothing.
 * @param session - the session the switch belongs to.
 * @param name - the preset to switch to; unknown names throw.
 */
set(session: Session, name: string): void
```

型: [Session](session.md) · [SessionEvent](session.md)

出典: [`packages/interaction/permission-presets/src/index.ts:159`](../../packages/interaction/permission-presets/src/index.ts)
<!-- END GENERATED cordis-surface -->
