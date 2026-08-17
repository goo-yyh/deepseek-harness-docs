# コードランタイム

コード実行の抽象シームは、ホスト提供の非同期バインディングに対してモデルが記述した 1 つのプログラムを実行し、その出力内容と返り値を報告する、[機能シーム](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)です。その サービス定義（[dsh-code-runtime](../../packages/code-runtime/code-runtime)、`ctx.codeRuntime`）により定義されます。コード実行はエージェントループの中核ではなく、**任意の機能の 1 つ**です。そのため、用語は [core.md](core.md) ではなくここにあります。バックエンドは実行基盤とソース言語が異なり、どちらもサービス上の読み取り専用ディスクリプターです。worker-thread の サービスプロバイダー と tool-レジストリ のコンシューマーは、[Code Mode の基盤](../../.agents/notes/implemented/feature/2026-06-15-code-mode.md)および[型付き返却の契約](../../.agents/notes/implemented/feature/2026-07-20-code-mode-typed-tool-returns.md)で規定されています。

出典: [`packages/code-runtime/code-runtime/src/types.ts`](../../packages/code-runtime/code-runtime/src/types.ts)

## 実行: リクエストを受け取り、結果を返す

`CodeRunRequest` は、**ランタイムが処理するすべての情報** を保持します。「パッケージ境界では明示が暗黙に優先する」という規則に従い、デフォルト値（時間予算、出力上限）は実装の検証済み設定であり、`run()` 内に隠された `??` ではありません。

```ts type-equiv
/**
 * One run: the program source plus everything the runtime acts on. Per the
 * explicit-over-implicit convention, defaulting (time budgets, output caps)
 * is the implementation's validated config — a request carries no optional
 * tuning knobs for a hidden `??` to fill in.
 */
interface CodeRunRequest {
  /**
   * The program source, in the runtime's {@link ../index.ts | language}. It
   * runs as the body of an async function: top-level `await` and `return`
   * are available, and the completion value becomes
   * {@link CodeRunResult.value}.
   */
  program: string
  /** Host functions exposed to the program, one global object per namespace. */
  bindings: CodeBindingNamespace[]
  /**
   * Abort the run: the runtime stops the program (hard, even mid-loop) and
   * resolves with a {@link CodeRunFailure} of kind `'abort'`. In-flight
   * binding calls are the CALLER's to settle — the runtime only stops asking.
   */
  signal?: AbortSignal
}
```

結果では、エラーは **フィールド**として報告され、`run()` の rejection にはなりません。失敗したプログラムを報告することは呼び出し元の仕事であり、例外パスではありません（失敗時にも resolve する `ShellExecutor.run` の契約に一致します）。

```ts type-equiv
/**
 * The outcome of one run. An error is a FIELD on a resolved result, never a
 * rejection of `run()` — reporting a failed program is the caller's job, not
 * an exception path.
 */
interface CodeRunResult {
  /**
   * The program's completion value (its top-level `return`), when it ran to
   * completion and the value crossed the runtime's lossless-JSON boundary.
   * Invalid or over-limit completions fail the run instead of substituting a
   * rendered string; a failed or value-less run leaves this absent.
   */
  value?: CodeJsonValue
  /** Text the program emitted, in order, bounded only as part of the outer result. */
  logs: string[]
  /** Present iff the run failed; see {@link CodeRunFailure} for the taxonomy. */
  error?: CodeRunFailure
}
```

## バインディング: プログラムのグローバルとしてのホスト関数

各 `CodeBindingNamespace` は、プログラム内で非同期呼び出し可能オブジェクトからなる 1 つのグローバルオブジェクトになります（Code Mode コンシューマーは 1 つ渡します: `tools`）。引数と解決値は可逆な JSON であり、シームレベルのバイト上限なしにやり取りされなければなりません。ランタイムは structured clone を介して橋渡しできます。名前空間は、ランタイムがコンシューマーの名前を知ることなく、プログラムから見えるエラークラスを宣言できます。ランタイムは実際のコンストラクターを注入し、rejection された呼び出しをそのインスタンスに変換します。またランタイムは、バインディング名を信頼できない入力として扱います（`__proto__` は通常の own property であり、プロトタイプ衝突にはなりません）。

```ts type-equiv
/**
 * Program-visible typed rejection for one binding namespace. The runtime
 * injects a real error constructor under `name`; rejected member calls become
 * its instances and expose the exact member name through
 * `memberNameProperty`. Both strings are runtime data rather than knowledge
 * of a particular consumer such as Code Mode.
 */
interface CodeBindingErrorClass {
  /** Constructor global and resulting `Error.name`; same portable identifier rule as {@link CodeBindingNamespace.global}. */
  name: string
  /**
   * Non-empty own property for the member name. The portable exclusion set is
   * `RESERVED_ERROR_MEMBERS` plus dunder-form names (`__x__`, non-empty
   * middle), enforced identically by every backend; any other name —
   * identifiers or not — is accepted everywhere.
   */
  memberNameProperty: string
}
```

```ts type-equiv
/**
 * A named group of {@link CodeBindingFunction}s the runtime exposes to the
 * program as one global object (e.g. `tools`). Function names are arbitrary
 * strings — a runtime must treat names like `__proto__` or `constructor` as
 * ordinary own properties (null-prototype construction), never as prototype
 * collisions.
 */
interface CodeBindingNamespace {
  /**
   * The global identifier the program sees. Must match the LANGUAGE-PORTABLE
   * identifier subset `[A-Za-z_][A-Za-z0-9_]*` and no language's reserved
   * words, so the same namespace list works against every backend regardless
   * of `language` — a JS-only spelling like `$tools` is rejected by design,
   * not just by the Python backend. Names that satisfy the identifier rule but
   * name a backend-owned slot (`RESERVED_BINDING_GLOBALS`, e.g. `console`,
   * `__dsh_main__`) are also refused everywhere; see its declaration for the
   * exact set and why each entry is reserved.
   */
  global: string
  /** The callable members, keyed by the exact name the program calls. */
  functions: Record<string, CodeBindingFunction>
  /** Optional program-visible typed rejection contract for this namespace. */
  errorClass?: CodeBindingErrorClass
}
```

```ts type-equiv
/** A lossless JSON value transferable through the dependency-light Service Definition. */
type CodeJsonValue = null | boolean | number | string | CodeJsonValue[] | { [key: string]: CodeJsonValue }
```

```ts type-equiv
/**
 * One host-side function exposed to the program as an async callable. The
 * runtime bridges calls to it (possibly across a serialization boundary), so
 * `args` and the resolution value MUST be lossless JSON. A runtime rejects a
 * lossy or non-cloneable value with a descriptive error rather than corrupting
 * the run. No seam-level byte cap applies to a binding resolution. A rejection
 * of this function surfaces inside the program as a rejection of the
 * corresponding call.
 */
type CodeBindingFunction = (args: unknown) => Promise<CodeJsonValue>
```

## キャプチャされた出力と失敗の分類

ログは出力順のプレーン文字列です。ランタイムはプログラムのコンソール出力とストリーム出力をキャプチャしますが、コンシューマーが表示するのはテキストだけであるため、チャネルおよびコンソールメソッドのメタデータはシームの一部ではありません。実装では、シリアル化された外側のログ配列に加え、完了値または失敗メッセージのペイロードに上限を設けます。固定の結果エンベロープ構文とコンシューマー表示の空白は、この可変ペイロード台帳の対象ではありません。オーバーフローは帯域内の値置換ではなく、明示的な失敗です。

失敗の種類は、**独立して報告される直交した結果** です（[defensive-patterns](../defensive-patterns.md)に従います）。予算切れは例外ではなく、中止はタイムアウトではなく、基盤の停止（例: OOM）はそのいずれでもありません。

```ts type-equiv
/**
 * Why a run failed. The kinds are orthogonal outcomes reported independently
 * (per docs/defensive-patterns.md): a budget expiry is not an exception, an
 * abort is not a timeout, and a substrate death is neither.
 *
 * - `'exception'` — the program threw or failed to parse/transform.
 * - `'timeout'` — an implementation-owned budget expired; the message says which.
 * - `'abort'` — {@link CodeRunRequest.signal} fired.
 * - `'worker-exit'` — the execution substrate died without settling (e.g. OOM).
 * - `'invalid-output'` — the completion value was not lossless JSON.
 * - `'output-limit'` — the serialized outer logs/value/diagnostic exceeded the configured cap.
 */
interface CodeRunFailure {
  /** The failure class (see the interface doc for each kind's meaning). */
  kind: 'exception' | 'timeout' | 'abort' | 'worker-exit' | 'invalid-output' | 'output-limit'
  /** Human-readable detail, suitable for feeding back to a model to self-correct. */
  message: string
}
```

## サービス

`CodeRuntime`（`ctx.codeRuntime`、抽象 — [`packages/code-runtime/code-runtime/src/index.ts`](../../packages/code-runtime/code-runtime/src/index.ts)で定義）は、`run(request)`と、2 つの読み取り専用ディスクリプタで構成されます。`language`（プログラムの記述に必須の言語 — `'typescript'`と`'python'`はよく知られた値であり、これらを提示するのは`dsh-tools`で、公開されたバックエンドを持つのは`'typescript'`だけです。言語固有の表示を生成するコンシューマーはこの値で分岐し、表示できない値に対しては明確に失敗させます）および`isolation`（実行基盤 — `'worker-thread'`、`'process'`、`'container'`。診断用ラベルであり、**セキュリティ上の保証ではありません**）。実装では、実行同士を分離し（実行間で状態を共有しない）、静止状態まで破棄する必要があります。進行中の実行は、破棄が完了する前に終了して完了を待機します。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`によってソースから生成されます（doc-sync 内の`pnpm run verify-cordis-catalog`で最新であることを検証します。`pnpm run gen-cordis-catalog`で再生成できます）— このセクションは、ページの両言語版でバイト単位で同一です。シグネチャブロックでは`ts cordis-catalog`フェンスを使用し、元のソース JSDoc を保持します。ディスパッチモードは[入門](../cordis-primer.md#dispatch-modes)で定義され、フレームワークから継承した`ctx` API は[cordis-api/inherited.md](../cordis-api/inherited.md)にあります。

<a id="ctxcoderuntime--coderuntime-abstract-seam"></a>

### `ctx.codeRuntime` — `CodeRuntime`（抽象的な接続点）

1 つの`ctx.codeRuntime`実装を登録します。プログラム、予算、中止、および実行基盤の失敗は CodeRunResult で解決されます。拒否されるのは サービス定義 コントラクトの誤用のみです。実装は構造化クローン可能なバインディングを橋渡しし、宣言された各名前空間の拒否クラスを実体化し、プログラムを信頼できないピアとして扱い、実行同士を分離し、破棄時には進行中の実行を終了して完了を待機します。

```ts cordis-catalog
/**
 * Execute one program against the request's bindings and capture what it
 * emitted. See the class doc for the resolution contract (error is a result
 * field; rejection means Service Definition contract misuse only).
 * @param request - the program, its bindings, and the abort signal; the
 *   request carries everything the runtime acts on, with no hidden defaults.
 * @returns the run's outcome: completion value (when transferable), the
 *   ordered log capture, and the failure (if any).
 */
abstract run(request: CodeRunRequest): Promise<CodeRunResult>
```

ソース: [`packages/code-runtime/code-runtime/src/index.ts:102`](../../packages/code-runtime/code-runtime/src/index.ts)
<!-- END GENERATED cordis-surface -->
