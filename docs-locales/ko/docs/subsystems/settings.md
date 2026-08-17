# 사용자 설정

[dsh-settings](../../packages/settings/settings)의 사용자 설정 이음새는 네임스페이스별 섹션으로 이루어진 사용자 소유 문서 하나를 보관하고, 등록된 각 네임스페이스를 스키마 기본값, 등록자의 구성 `base`, 사용자 섹션 순으로 해석합니다. [dsh-settings-file](../../packages/settings/settings-file) 같은 제공자는 원시 문서를 저장하고 외부 편집 내용을 전파합니다. 소비자 플러그인은 스키마를 등록하고 해석된 값을 읽거나 관찰합니다. 구성 설정은 `cordis.yml`에 유지됩니다. 네임스페이스에는 사용자가 편집할 수 있는 부분 집합만 포함됩니다.

출처: [`packages/settings/settings/src/index.ts`](../../packages/settings/settings/src/index.ts)

## 식별자

네임스페이스는 사용자 문서에서 하나의 플러그인 소유 섹션을 명명합니다. 브랜드는 호출자가 패키지나 프로세스 간에 전달되는 다른 ID와 설정 네임스페이스를 혼용하지 못하게 하며, 생성 시 소문자 kebab-case 구문을 검증합니다.

```ts type-equiv
/** Nominal id of one registered settings namespace. */
type SettingsNamespace = Branded<'SettingsNamespace'>
```

## 등록

등록은 schemastery 스키마를 호출 플러그인의 fiber에서 네임스페이스에 연결합니다. 해당 fiber를 폐기하면 네임스페이스와 관찰자가 제거됩니다. 옵션에는 구성 계층, 소유자의 효과 타이밍, 스키마로 표현할 수 없는 사항을 위한 선택적 검사가 포함됩니다.

```ts type-equiv
/** Registration options beyond the namespace schema. */
interface SettingsRegisterOptions<T> {
  /** Composition-layer values resolved below the user layer (entry-config subset). */
  base?: Partial<T>
  /** Owner's effect timing, surfaced to configuration UIs; defaults to `live`. */
  applies?: SettingsApplies
  /**
   * Reject a resolved section the owner could not act on, for constraints its
   * schema cannot express — a cross-field requirement, or one field's validity
   * depending on another's. Throwing here refuses the *write* that produced the
   * value, so a caller learns at `update`/`replace`/`mutate` instead of storing
   * something that would silently disable the owner.
   *
   * Kept separate from the schema because the schema is also what a
   * configuration surface renders and what an absent section resolves through;
   * folding a cross-field check into it would change both.
   *
   * Once the owner is registered, a stored section that fails this keeps the
   * namespace's last good value and warns, exactly as a schema failure does,
   * so an externally edited document cannot strand a running owner. At
   * registration there is no last good value yet, so a stored section that
   * already fails rejects the registration itself — again exactly as a schema
   * failure does.
   * @param value - the resolved section, schema-valid by construction.
   */
  validate?: (value: T) => void
}
```

`validate`는 스키마가 값을 허용한 후 실행되므로, 소유자가 보게 될 기본값과 구성 기반을 정확히 확인합니다. `dsh-llm-pi-ai`는 모든 경로를 비활성화할 값을 저장하는 대신, 그 값을 만든 쓰기 시점에 제공할 수 없는 제공자 프로필을 거부하는 데 이를 사용합니다.

`applies`는 메커니즘이 아니라 UI 힌트입니다. `restart` 소유자는 단순히 관찰하지 않으므로 해당 값은 생성 시 한 번 읽히며, 구성 화면에서는 보류 중인 변경 사항을 배지로 표시할 수 있습니다.

```ts type-equiv
/** When a namespace's changes take effect for its owner. */
type SettingsApplies = 'live' | 'restart'
```

## 소유자 범위

범위는 소유자용 핸들입니다. `update`는 사용자 섹션에만 희소 패치를 병합하며(`base`에는 절대 병합하지 않음), `replace`는 섹션 전체를 설정합니다. 이는 제거/재설정 경로이며, 대체 항목에 없는 키는 `base` 및 스키마 기본값을 다시 상속합니다. 하나의 네임스페이스에 대한 쓰기는 호출 순서대로 직렬화되고, 해석된 값은 깊은 동결 스냅샷입니다.

```ts type-equiv
/** Owner-facing handle for one registered namespace. */
interface SettingsScope<T> {
  /** Current resolved value: schema defaults, then `base`, then the user layer. */
  get(): T
  /**
   * Observe committed changes to this namespace's resolved value. Invocations
   * of one callback run asynchronously, one at a time, in commit order; a
   * rejection is contained and logged like a sync throw. After the disposer
   * returns, no further invocation starts — one already queued is skipped;
   * one already started still settles, and service disposal waits for it.
   * @param callback - invoked after each commit with the next and previous values.
   * @returns the disposer removing this observer.
   */
  watch(callback: (next: T, prev: T) => void | Promise<void>): () => void
  /**
   * Merge a partial patch into this namespace's user layer and persist it.
   * @param patch - plain-object patch over the user section; JSON-compatible data
   * only (non-JSON values reject with their path before anything persists).
   */
  update(patch: object): Promise<void>
  /**
   * Replace this namespace's user section wholesale; absent keys re-inherit
   * the composition `base` and schema defaults (`replace({})` resets all).
   * @param section - the complete next user section; JSON-compatible data only,
   * as for {@link update}.
   */
  replace(section: object): Promise<void>
}
```

## 기술자

`describe()`는 구성 화면을 위해 등록된 모든 네임스페이스를 직렬화합니다. schemastery `toJSON()` 엔벌로프는 스키마로 렌더링되는 양식을 구동하고, 해석된 값은 이를 채웁니다. 분리된 `base`/`user` 계층을 통해 양식은 존재 여부로 사용자가 재정의한 필드를 표시할 수 있습니다. 모든 wire 화면에서 필수인 `describe({ redactSecrets: true })`는 세 계층 모두에서 `role('secret')` 필드를 제거하고 해당 `{path, set}` 슬롯을 열거하므로, 페이지는 비밀 값을 받지 않고도 쓰기 전용 입력을 렌더링할 수 있습니다.

```ts type-equiv
/** One registered namespace as surfaced to configuration UIs. */
interface SettingsDescriptor {
  /** The registered namespace. */
  ns: SettingsNamespace
  /** Serialized schemastery schema (`schema.toJSON()`). */
  schema: unknown
  /** Current resolved value. */
  value: unknown
  /**
   * Monotonic revision of the raw user section this descriptor was read at.
   * Send it back as `expectedRevision` on a write to refuse a stale one.
   */
  revision: number
  /** Registrant's composition `base` layer (detached), when one was declared. */
  base?: unknown
  /**
   * Raw user section from the stored document (detached), when one exists and
   * is well-formed; a field's presence here is what marks it user-overridden.
   */
  user?: unknown
  /** Owner's declared effect timing. */
  applies: SettingsApplies
  /** Schema-declared secret positions; present only under `redactSecrets`. */
  secrets?: RedactedSecret[]
}
```

삭제된 기술자만 보유한 호출자는 섹션을 안전하게 다시 빌드할 수 없으므로, 제거는 대신 경로 연산으로 전달됩니다. 각 기술자는 원시 섹션에 대한 `revision`도 포함합니다. 쓰기는 이를 `expectedRevision`로 다시 보낼 수 있으며, 더 이상 일치하지 않는 경우 먼저 적용된 작성자 위에 적용하는 대신 거부됩니다.
```ts type-equiv
/**
 * One path-addressed edit to a namespace's user section. Path mutation exists
 * for a caller holding an INCOMPLETE view of the section — a configuration UI
 * reads the redacted descriptor, which by construction never received the
 * `role('secret')` fields. Such a caller can name the field it means without
 * restating the section: a wholesale `replace` rebuilt from a redacted
 * document silently deletes every secret the wire never returned.
 */
type SettingsPathOp =
  | { op: 'set'; path: readonly string[]; value: unknown }
  | { op: 'unset'; path: readonly string[] }
```

```ts type-equiv
/** Options for {@link SettingsProvider.describe}. */
interface SettingsDescribeOptions {
  /**
   * Strip `role('secret')` fields from `value`/`base`/`user` and enumerate
   * them in each descriptor's `secrets`. Every wire surface MUST pass this;
   * the verbatim default exists for same-process configuration UIs only.
   */
  redactSecrets?: boolean
}
```

## 변경 사항 커밋

커밋된 모든 변경(프로세스 내 쓰기 또는 외부에서 감지된 provider 편집)은 새 값이 권위 있는 값이 된 후 `settings/updated (ns, next, prev, source)`을(를) 발생시키며, 해석된 값이 deep-equal이면 절대 발생시키지 않습니다. 소스 태그는 두 진입 경로를 구분합니다.

```ts type-equiv
/** Origin of one committed settings change. */
type SettingsUpdateSource = 'update' | 'provider'
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`에서 소스로부터 생성되며(doc-sync에서 `pnpm run verify-cordis-catalog`으로 최신 상태를 검증하고, `pnpm run gen-cordis-catalog`으로 다시 생성) 이 섹션은 페이지의 두 언어 버전에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문](../cordis-primer.md#dispatch-modes)에서 정의하며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxsettings--settingsprovider-abstract-seam"></a>

### `ctx.settings` — `SettingsProvider` (추상 이음새)

추상 설정 서비스입니다. Provider는 원시 문서 저장소(`load`/`persist`)를 구현하고 Settings.publish를 통해 외부 변경을 전달합니다. 기본 클래스는 네임스페이스 등록, 해석, 검증, 변경 감지 및 `settings/updated` 커밋 이벤트를 담당합니다.

```ts cordis-catalog
/**
 * Prepare the provider's user-editable document for a native editor. File
 * providers may materialize an absent document before returning its path;
 * non-file providers return undefined.
 * @returns the absolute local document path, or undefined for non-file storage.
 */
prepareDocument(): Promise<string | undefined>

/**
 * Register a namespace schema and receive its owner scope. The registration
 * is an effect on the calling plugin's fiber: disposing that fiber removes
 * the namespace and its observers. An invalid stored section fails the
 * registration itself — the earliest point where the schema can judge it.
 * @param ns - unique namespace; duplicate registration fails loud.
 * @param schema - schemastery schema resolving this namespace's value.
 * @param options - composition `base` layer and effect timing.
 * @returns the owner scope for reads, observation, and updates.
 */
register<T>(ns: SettingsNamespace, schema: z<T>, options?: SettingsRegisterOptions<T>): SettingsScope<T>

/**
 * Describe every registered namespace for configuration surfaces, including
 * the composition `base` and raw user layers so a form can mark which fields
 * the user overrode (presence in `user`) and what a reset returns to.
 * @param options - redaction switch; wire surfaces must redact.
 * @returns one descriptor per registered namespace, in registration order.
 */
describe(options?: SettingsDescribeOptions): SettingsDescriptor[]

/**
 * Read one registered namespace's resolved value.
 * @param ns - the namespace to read.
 * @returns the resolved value, or `undefined` while unregistered.
 */
get(ns: SettingsNamespace): unknown

/**
 * Merge a patch into one registered namespace's user layer, validate the
 * resolved candidate, persist through the provider, then commit and emit.
 * A validation failure rejects before anything is persisted. Writes to one
 * namespace are serialized: concurrent updates apply in call order, each
 * merging over the previous write's committed section.
 * @param ns - the registered namespace to update.
 * @param patch - plain-object patch over the user section.
 * @param expectedRevision - the descriptor `revision` the caller read; a
 *   namespace that moved past it rejects with {@link SettingsConflictError}.
 */
async update(ns: SettingsNamespace, patch: object, expectedRevision?: number): Promise<void>

/**
 * Replace one registered namespace's user section wholesale, validate,
 * persist, then commit and emit. Keys absent from `section` fall back to the
 * composition `base` and schema defaults — this is the removal/reset path a
 * merge-only patch cannot express (`replace({})` re-inherits everything).
 * @param ns - the registered namespace to replace.
 * @param section - the complete next user section.
 * @param expectedRevision - the descriptor `revision` the caller read; a
 *   namespace that moved past it rejects with {@link SettingsConflictError}.
 */
async replace(ns: SettingsNamespace, section: object, expectedRevision?: number): Promise<void>

/**
 * Apply path-addressed edits to one registered namespace's user section,
 * validate, persist, then commit and emit. The ops are applied to the
 * section as it stands when the write reaches the front of the queue, so a
 * caller never has to restate fields it did not touch — and, crucially,
 * cannot delete fields it never saw. This is the write path for any caller
 * holding a redacted view; `replace` remains the wholesale reset.
 * @param ns - the registered namespace to edit.
 * @param ops - ordered path edits; later ops observe earlier ones.
 * @param expectedRevision - the descriptor `revision` the caller read; a
 *   namespace that moved past it rejects with {@link SettingsConflictError}.
 */
async mutate(ns: SettingsNamespace, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>
```

소스: [`packages/settings/settings/src/index.ts:350`](../../packages/settings/settings/src/index.ts)

<a id="settings-events"></a>

### `settings/*` 이벤트

<a id="settingsdocument-updated--emit"></a>

#### `settings/document-updated` — 발생

해석된 값의 변경 여부와 관계없이 등록된 하나의 네임스페이스에 있는 RAW 사용자 섹션이 변경되었습니다. `settings/updated`은(는) 소비자 대상 이벤트이며 deep-equal 게이트를 유지합니다. 이 이벤트는 구성 표면에서 필드가 상속됨에서 재정의됨으로 변경되었음(해석된 값은 같지만 의미는 다름)과 보유한 리비전이 오래되었음을 알 수 있도록 존재합니다. 리스너 격리는 `settings/updated`과(와) 일치합니다.

```ts cordis-catalog
/**
 * One registered namespace's RAW user section changed, whether or not the
 * resolved value did. `settings/updated` is the consumer-facing event and
 * stays deep-equal-gated; this one exists for configuration surfaces,
 * which must learn that a field went from inherited to overridden (same
 * resolved value, different meaning) and that their held revision is
 * stale. Listener containment matches `settings/updated`.
 * @param ns - the namespace whose stored section changed.
 * @param revision - the namespace's new revision.
 * @mode emit
 */
'settings/document-updated'(ns: SettingsNamespace, revision: number): void
```

소스: [`packages/settings/settings/src/types.ts:48`](../../packages/settings/settings/src/types.ts)

<a id="settingsupdated--emit"></a>

#### `settings/updated` — 발생

등록된 하나의 네임스페이스의 해석된 값에 커밋된 변경입니다. Provider가 변경을 영속화(`update`의 경우)하거나 게시(`provider`)한 후 발생하며, 해석된 값이 deep-equal이면 절대 발생하지 않습니다. 리스너 실패(동기 예외와 비동기 거부 모두)는 격리되어 기록됩니다. 단, `INVARIANT`로 코딩된 실패는 모든 리스너가 실행된 후 다시 발생합니다. 이 재발생은 동기 리스너에서만 emitter에 도달하므로, 이 이벤트의 불변성 검사는 비동기 함수여서는 안 됩니다.

```ts cordis-catalog
/**
 * Committed change to one registered namespace's resolved value. Emitted
 * after the provider persisted (for `update`) or published (`provider`)
 * the change; never emitted when the resolved value is deep-equal.
 * Listener failures are contained and logged — a sync throw and an async
 * rejection alike — except `INVARIANT`-coded failures, which rethrow
 * after every listener ran; that rethrow reaches the emitter only from
 * synchronous listeners, so invariant checks on this event must not be
 * async functions.
 * @param ns - the namespace whose resolved value changed.
 * @param next - the new resolved value.
 * @param prev - the previous resolved value.
 * @param source - whether the change entered through `update()` or the provider.
 * @mode emit
 */
'settings/updated'(ns: SettingsNamespace, next: unknown, prev: unknown, source: SettingsUpdateSource): void
```

출처: [`packages/settings/settings/src/types.ts:35`](../../packages/settings/settings/src/types.ts)
<!-- END GENERATED cordis-surface -->
