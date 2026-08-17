# 스토리지

스토리지 하위 시스템은 세션 이벤트 로그가 아닌 모든 항목을 영속화합니다(세션 로그에는 자체 추상적 접점이 있습니다 — [persistence.md](persistence.md)). 이는 에이전트 루프 중심부에 속하지 않는 선택적 기능 하나이며, [역량 접점](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)으로 분할됩니다. 즉 허브와 서비스 정의([dsh-storage](../../packages/storage/storage), `ctx.storage`), 서비스 제공자([dsh-storage-json](../../packages/storage/storage-json), `json`로 등록, 그리고 [dsh-storage-sqlite](../../packages/storage/storage-sqlite), `sqlite`로 등록), 소비자 데이터 형식([dsh-storage-domain](../../packages/storage/storage-domain), `ctx.storageDomain`, `ctx.storage.domain`로도 접근 가능)으로 구성됩니다. 이는 백엔드 계약의 유일한 소비자이자 다른 모든 구성 요소가 사용하는 타입 지정 API입니다. 허브는 자체적으로 IO를 수행하지 않습니다. 백엔드는 매체를 소유하고, 데이터 형식은 의미 체계를 소유하며, 제품 패키지는 백엔드에 직접 접근하지 않습니다. 설계 기록: [도메인 KV 스토리지 Agent Note](../../.agents/notes/proposed/architecture/2026-07-24-domain-kv-storage-and-workspace.md).

출처: [`packages/storage/storage/src/backend.ts`](../../packages/storage/storage/src/backend.ts) · [`packages/storage/storage-domain/src/spec.ts`](../../packages/storage/storage-domain/src/spec.ts) · [`packages/storage/storage-domain/src/events.ts`](../../packages/storage/storage-domain/src/events.ts)

## 허브: `ctx.storage`

`Storage`([시그니처](#ctxstorage--storage))는 저장소가 아니라 접점입니다. `ctx.storage.backend`는 이름 → 백엔드 테이블입니다. 여러 백엔드를 나란히 마운트할 수 있으며, 어떤 백엔드가 어떤 소비자에 제공되는지는 해당 소비자의 설정(도메인 계층의 라우트 테이블)으로 결정되고 허브 전역 선택이 아닙니다. `register(name, backend)`는 해제 함수를 반환하며, 중복 이름과 알 수 없는 조회는 `StorageError`를 발생시킵니다. 해제는 이름 등록만 해제합니다. 소유 플러그인은 등록 해제 후 백엔드를 닫습니다. 각 백엔드 플러그인은 수명 주기 전용 서비스 키(`storageBackendServiceKey(name)`)도 게시하며, 형식 제공자는 이를 주입하여 활성화가 백엔드 등록과 경합하지 않도록 합니다.

데이터 형식은 병합 확장 가능한 키 맵 아래에서 허브에 마운트됩니다.

```ts type-equiv
/**
 * Data forms mountable on the hub, keyed by form name. Form owners extend
 * this map via declaration merging (the domain layer merges
 * `domain: DomainFacility`) and mount the facility in their `apply`.
 */
interface StorageForms {}
```

`mount(form, facility)`는 해제 시 마운트를 해제하는 이펙트입니다. 같은 키를 두 번째로 마운트하면 `duplicate-mount`를 발생시킵니다. `form(form)`는 마운트된 기능을 확인하며, 소유 플러그인이 로드될 때까지 `form-not-mounted`를 발생시킵니다. 어셈블리는 조용히 지연하는 대신 이에 맞춰 플러그인 순서를 정합니다. 도메인 계층은 `domain: DomainFacility`를 병합하므로 `ctx.storage.domain`와 `ctx.storageDomain`는 동일한 객체입니다.

## 백엔드 계약

```ts type-equiv
/**
 * One registered backend. A backend owns exactly one medium and shares its
 * lifecycle across all facets; facets are optional members — a backend that
 * cannot serve a data kind simply omits it, and resolution fails loud instead.
 */
interface StorageBackend {
  /** Key-value operations; absent when this backend cannot serve them. */
  readonly kv?: KvFacet

  /**
   * Drain in-flight writes across all open units and release the medium.
   * Idempotent; concurrent and repeated calls resolve once teardown finishes.
   * @returns resolution after the medium is released.
   */
  close(): Promise<void>
}
```

백엔드는 하나의 매체(파일 트리 루트, 데이터베이스 파일)를 소유하고 선택적 작업 그룹을 노출합니다. 현재 `kv`가 유일한 그룹입니다. `KvFacet.open(descriptor)`는 이름이 지정된 하나의 단위를 열며, `KvUnitDescriptor`에는 이름, 형식 버전, 테이블 이름 및 전역 싱글턴 슬롯 존재 여부가 담겨 있습니다. 그리고 `loadAll`, `putRecord`, `deleteRecord`, `setGlobal`, `close`를 포함하는 `KvUnit`를 반환합니다. 단위 및 테이블 이름은 `UNIT_NAME_RE`와 일치해야 합니다(파일 이름 및 SQL 식별자 세그먼트로 안전함). 레코드 키는 파일 경로에 도달하지 않는 임의의 문자열입니다. 단위는 동시 쓰기를 직렬화하지 않으며 순서는 호출자에게 속합니다. 다만 각 단일 호출은 매체에서 원자적이고 해결되면 내구성을 가집니다. 다른 버전이 기록된 매체는 `version-mismatch`를 거부합니다. 단위로 파싱할 수 없는 매체는 `malformed-medium`를 거부합니다(마이그레이션 없음, 사전 릴리스 방침). [`backend.ts`](../../packages/storage/storage/src/backend.ts)는 규범적인 조항별 계약이며, [`tests/contract.ts`](../../packages/storage/storage/tests/contract.ts)의 공유 적합성 모음은 각 백엔드에 대해 모든 조항을 검사합니다. [json 백엔드](../../packages/storage/storage-json/README.md)는 단위마다 사람이 읽을 수 있는 파일 하나 전체를 원자적으로 다시 게시합니다. [sqlite 백엔드](../../packages/storage/storage-sqlite/README.md)는 자주 업데이트되는 데이터를 위해 하나의 데이터베이스에 행마다 문서 하나를 저장합니다.

## 도메인 선언

도메인은 소유 패키지가 사양 객체로 한 번 선언합니다. 이는 도메인의 식별성, 레이아웃 및 레코드 스키마(zod이므로 `z.infer`는 소비자 타입의 중복을 방지함)를 위한 단일 소스입니다.

```ts type-equiv
/** Static declaration of one domain: identity, version, and record layout. */
interface DomainSpec {
  /** Domain name; must match `UNIT_NAME_RE` (doubles as the backend unit name). */
  readonly name: string
  /** Domain format version; a medium stamped with a different version rejects at open. */
  readonly version: number
  /** Optional global singleton slot. */
  readonly global?: DomainGlobalSpec<unknown>
  /** Table declarations keyed by table name; each name must match `UNIT_NAME_RE`. */
  readonly tables: Record<string, DomainTableSpec>
}
```

`defineDomain(spec)`는 사양의 리터럴 타입을 고정하고 매체에 접근하기 전 소유자의 모듈 로드 시점에 명확히 실패합니다. `UNIT_NAME_RE` 범위를 벗어나는 도메인 또는 테이블 이름, 음이 아닌 정수가 아닌 버전, 또는 `null`을 허용하는 전역 스키마는 모두 오류를 발생시킵니다(`null`는 매체의 "한 번도 기록되지 않음" 센티널이므로 저장된 null 허용 전역 값은 왕복할 수 없습니다). `domainTable<K, V>(schema)`는 팬텀 컴파일 타임 키 타입(일반적으로 [브랜드 ID](core.md#branded-ids))을 사용해 테이블 하나를 선언합니다. `descriptorOf(spec)`는 백엔드용 단위 설명자를 투영합니다.

## 열린 도메인

```ts type-equiv
/** One open domain, typed by its spec. */
interface Domain<S extends DomainSpec> {
  /** Domain name from the spec. */
  readonly name: string
  /** Global singleton handle; a spec without `global` has no usable handle (`never`). */
  readonly global: DomainGlobalHandleOf<S>
  /**
   * Resolve one declared table handle. Handles are stable — repeated calls
   * return the same instance.
   * @param name - Declared table name.
   * @returns the typed table handle.
   */
  table<N extends keyof S['tables'] & string>(name: N): KvTable<TableKeyOf<S, N>, TableValueOf<S, N>>

  /**
   * Close this domain: reject new writes immediately, drain already-queued
   * writes (their events still emit), release the backend unit, then free
   * the domain name for a later open. Idempotent — repeated calls share one
   * teardown. The consumer owns this call (typically as its own `ctx.effect`
   * disposer); the facility closes any domain left open when it unmounts.
   * @returns resolution after the unit is released.
   */
  close(): Promise<void>
}
```

읽기는 권위 있는 메모리 내 상태에서 동기적으로 수행됩니다. `KvTable`는 `get`/`entries`/`keys`/`size`를 노출합니다(대기 중인 쓰기가 반영되는 동안에도 안정적으로 유지되는 스냅샷 이터레이터). 전역 핸들의 `get()`는 첫 번째 `set`가 매체에 슬롯을 구체화할 때까지 사양의 `initial` 역할을 합니다. 모든 쓰기(`put`, `delete`, `update`, `global.set`)는 도메인별 단일 체인에 대기하며, 먼저 백엔드 내구성에 도달한 뒤 메모리를 변경하고 `domain/changed`를 발생시킵니다. 거부된 백엔드 쓰기는 메모리를 변경하지 않으므로 읽기는 매체와 절대 불일치하지 않습니다. `update(key, fn)`는 해당 체인 슬롯에서 원자적으로 읽기-수정-쓰기를 수행합니다(없는 키는 `missing-key`를 거부합니다). 없는 키의 `delete`는 쓰기와 이벤트 없이 `false`를 반환합니다. 반환된 레코드는 복사본이 아닌 저장된 객체 자체입니다. 제자리에서 변경하지 말고 `put`/`update`를 통해 교체해야 합니다.

## 도메인 기능: `ctx.storageDomain`

`DomainFacility`([시그니처](#ctxstoragedomain--domainfacility))는 라우팅된 백엔드에서 선언된 도메인을 엽니다. 라우팅은 허브가 아닌 도메인 플러그인의 설정입니다. `backend`는 필수 기본 경로를 지정하고 `routes`는 도메인 이름별로 이를 재정의합니다. `open(spec)`는 엄격한 순서로 실행되며, 각 단계의 실패는 전체 호출을 실패시킵니다. 이미 열려 있거나 아직 닫히는 중인 이름(`already-open`)을 거부하고, 경로를 확인하며(`backend-not-found`), 백엔드의 `kv` 패싯을 요구하고(`facet-unsupported`), 유닛을 엽니다(백엔드 `version-mismatch`/`malformed-medium`은 그대로 전달됨). 또한 사양의 zod 스키마에 대해 저장된 모든 레코드와 전역 값을 검증합니다(문제가 있는 테이블과 키를 포함한 `invalid-record`). 호출자는 반환된 핸들을 소유하며 `Domain.close()`로 해제합니다. 플러그인이 마운트 해제될 때 아직 열려 있는 도메인은 기능에 의해 닫히며, 닫힌 도메인의 이름은 해제가 완전히 끝난 후에만 다시 열 수 있도록 해제됩니다. `get(name)`는 모든 타입 지정 핸들 뒤에 있는 패키지 전용 `DomainImpl` 런타임에 대한 타입 없는 진단 조회이며, `closeAll()`는 마운트 해제 경로입니다.

## 변경 이벤트: `domain/changed`

모든 영속적 쓰기는 백엔드가 내구성을 확인한 후 도메인의 쓰기 체인 순서대로 정확히 하나의 이벤트를 발생시킵니다([이벤트 항목](#domainchanged--emit)):

```ts type-equiv
/** Shared location fields of one durable domain change. */
interface DomainChangedBase {
  /** Owning domain name. */
  readonly domain: string
  /** Table name; `''` for a global-singleton write. */
  readonly table: string
  /** Record key; `''` for a global-singleton write. */
  readonly key: string
}
```

```ts type-equiv
/** One durable domain change; a closed union — switch on `operation`. */
type DomainChanged = DomainChangedPut | DomainChangedDeleted
```

`put`(삽입, 덮어쓰기, 전역 쓰기)는 이전 값이 아닌 새 스냅샷을 `value`에 담습니다. 차이를 비교하는 소비자는 자체 이전 스냅샷을 유지합니다. `deleted`는 값이 없는 묘비 표식입니다. 이벤트는 트랜잭션 참여자가 아니라 알림입니다. 발생 시점에는 커밋 지점이 이미 지났으므로, 동기적으로 예외를 발생시키는 리스너는 이미 영속된 쓰기를 거부하는 대신 경고 로그와 함께 격리되며, 발생된 값은 발생 시점의 메모리 내 상태와 같습니다. 이벤트는 프로세스 내에서만 제공됩니다. 프로세스 간 변경 푸시는 기록된 제한 사항입니다([패키지 README](../../packages/storage/storage-domain/README.md)).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`에서 소스로부터 생성되었습니다(doc-sync에서 `pnpm run verify-cordis-catalog`로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`로 다시 생성). 이 섹션은 페이지의 두 언어 버전에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxstorage--storage"></a>

### `ctx.storage` — `Storage`

스토리지 허브 서비스입니다. 백엔드는 `backend` 아래에 등록되며, 데이터 형식은 `StorageForms` 키 아래에 마운트되고 `ctx.storage.<form>`로 접근합니다.

```ts cordis-catalog
/**
 * Mount a data-form facility on the hub. Mounting is an effect: the
 * returned disposer unmounts the form.
 * @param form - Form key declared in {@link StorageForms}.
 * @param facility - The facility instance to expose.
 * @returns the disposer that unmounts the form.
 */
mount<K extends keyof StorageForms>(form: K, facility: StorageForms[K]): () => void

/**
 * Resolve a mounted data form.
 * @param form - Form key declared in {@link StorageForms}.
 * @returns the mounted facility.
 */
form<K extends keyof StorageForms>(form: K): StorageForms[K]
```

출처: [`packages/storage/storage/src/index.ts:47`](../../packages/storage/storage/src/index.ts)

<a id="ctxstoragedomain--domainfacility"></a>

### `ctx.storageDomain` — `DomainFacility`

마운트된 도메인 기능입니다. 라우팅된 백엔드에서 선언된 도메인을 열며, 하나의 기능 인스턴스가 열린 도메인 테이블을 소유하고 도메인 이름별 단일 열기를 강제합니다.

```ts cordis-catalog
/**
 * Open one declared domain. Steps, each failing the whole call: reject a
 * name that is already open (`already-open`); resolve the backend route
 * (`backend-not-found` passes through from the hub); require its `kv` facet
 * (`facet-unsupported`); open the unit projected from the spec (backend
 * `version-mismatch`/`malformed-medium` pass through); load and validate
 * every stored record against the spec's zod schemas (`invalid-record`
 * with the offending table and key); construct the domain.
 *
 * Lifecycle: the CALLER owns the returned handle and closes it via
 * `Domain.close()` (typically as its own `ctx.effect` disposer) — the
 * facility does not tie the domain to any consumer fiber. Domains still
 * open when the facility unmounts are closed by the plugin disposer.
 * @param spec - The domain declaration, typically from `defineDomain`.
 * @returns the opened domain handle, typed by the spec.
 */
async open<S extends DomainSpec>(spec: S): Promise<Domain<S>>

/**
 * Look up an open domain by name, untyped. Diagnostic surface (the package
 * invariant cross-checks change events against live domain state); typed
 * consumers hold the handle returned by {@link open}.
 * @param name - Domain name.
 * @returns the open domain runtime, or `undefined` when not open.
 */
get(name: string): DomainImpl | undefined

/**
 * Close every domain still open on this facility. The unmount path for
 * consumers that never called `Domain.close()` themselves; closing is
 * idempotent, so double-closing an already-closed domain is harmless.
 * @returns resolution after every unit is released.
 */
async closeAll(): Promise<void>
```

출처: [`packages/storage/storage-domain/src/index.ts:69`](../../packages/storage/storage-domain/src/index.ts)

<a id="domain-events"></a>

### `domain/*` 이벤트

<a id="domainchanged--emit"></a>

#### `domain/changed` — 발생

도메인 레코드 또는 전역 싱글턴이 변경되면 백엔드가 내구성을 확인한 후 엄격하게 쓰기당 한 번 발생합니다. 한 도메인의 이벤트는 해당 쓰기 체인 순서대로 도착합니다.

```ts cordis-catalog
/**
 * A domain record or the global singleton changed, emitted once per write
 * strictly after the backend acknowledged durability. Events of one
 * domain arrive in its write-chain order.
 * @param change - domain, table (`''` for global), key (`''` for global),
 * operation discriminant, and on `put` the new snapshot.
 * @mode emit
 */
'domain/changed'(change: DomainChanged): void
```

출처: [`packages/storage/storage-domain/src/events.ts:46`](../../packages/storage/storage-domain/src/events.ts)
<!-- END GENERATED cordis-surface -->
