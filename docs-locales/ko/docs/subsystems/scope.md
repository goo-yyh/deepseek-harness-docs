# 범위 지정 등록

[scope 패키지](../../packages/core/scope)는 하나의 등록 컨텍스트가 에이전트별 가시성과 공유 수명 소유권을 모두 의미하도록 하는 ID, 전달자 및 범위 지정 레이어 어휘를 제공합니다. 이는 Cordis 서비스가 아닌 라이브러리 기본 요소입니다. 수명 주기의 근거는 [agent-scope 런타임 설계 Agent Note](../../.agents/notes/implemented/architecture/2026-07-12-agent-scope-runtime-design.md#scope-routing-one-opaque-key-selects-one-layer)에서, 레지스트리 레이어 결정은 [shared-storage Agent Note](../../.agents/notes/implemented/architecture/2026-07-12-scoped-layers-store.md)에서, 호출 가능한 API와 필터링 의미 체계는 패키지 [README](../../packages/core/scope/README.md)에서 다룹니다.

소스: [`packages/core/scope/src/index.ts`](../../packages/core/scope/src/index.ts) 및 [`packages/core/scope/src/store.ts`](../../packages/core/scope/src/store.ts).

## ID 및 디스패치 전달자

`ScopeKey`는 불투명한 객체 ID입니다. 제공되는 루프는 라이브 `Agent` 객체 자체를 키로 사용하지만, 이 기본 요소는 객체를 검사하지 않습니다.

```ts type-equiv
/** An opaque, identity-compared scope key. */
type ScopeKey = object
```

`Scoped<T>`는 `scopeTarget(base, key)`가 반환하는 불투명 라우팅 수신기의 컴파일 타임 브랜드입니다. 범위 필터링된 이벤트 선언은 이 전달자를 `this` 타입으로 요구하며, 실제 이벤트 주체는 명시적 인수로 유지됩니다.

```ts type-equiv
/**
 * A routing-only event receiver built by {@link scopeTarget}. The type
 * parameter records the subject type for dispatch checking; the carrier does
 * not expose the subject's properties. Event payloads carry the real subject.
 */
type Scoped<T extends object> = object & { readonly [ScopedBrand]: T }
```

## 소유된 등록 컨텍스트

`Scope`는 태그가 지정된 등록 컨텍스트를 두 개의 정리 경로와 결합합니다. `rawDispose`는 순서가 지정된 복합 effect에 필요한 정확한 Cordis disposer ID를 보존하며, `dispose()`는 직접 호출자와 경합 호출자를 위한 공개 공유 정지 경계입니다.

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

## 범위 지정 레지스트리 레이어

`ScopeLayer`는 전역 또는 정확한 범위 수준에서 하나의 레지스트리가 수행하는 완전한 기여를 나타냅니다. 구체적인 레이어는 여러 개의 이름 있는 테이블과 익명 테이블을 집계할 수 있습니다. 전체 레이어가 비어 있으면 `ScopedLayers`가 형제 테이블을 폐기하지 않고 범위 지정 상태를 회수할 수 있습니다.

```ts type-equiv
/** One scope's aggregate contribution to a registry. */
interface ScopeLayer {
  /** Whether every table in this layer is empty. */
  isEmpty(): boolean
}
```

`ScopedLayers<L>`는 즉시 생성되는 전역 레이어와 지연 생성되는 정확한 범위 레이어를 소유합니다. 읽기는 레이어를 생성하지 않습니다. `peek(undefined)`는 오버레이가 없음을 의미하며, `merge()`는 삽입 순서의 전역 이름 있는 항목 뒤에 범위 지정 섀도를 구체화합니다. 등록은 가시성과 Cordis effect 소유권 모두에 하나의 컨텍스트를 사용하고, 선택적 알림 전에 하나의 동기 실행 취소를 수집하며, Cordis의 정확한 disposer를 반환하고, 완전한 `ScopeLayer`가 비어 있을 때에만 범위 지정 레이어를 회수합니다.

`NamedEntries<V>`는 호출자 소유 중복 오류와 함께 삽입 순서 조회 및 라이브 반복을 제공합니다. `AnonymousEntries<V>`는 모든 추가 작업에 고유한 ID를 부여하므로 같은 값도 독립적으로 유지됩니다. 반복은 비어 있지 않은 하나의 테이블 세대 내에서 라이브 상태로 유지됩니다. 테이블을 비우면 기존 반복자는 이후 삽입과 분리됩니다. 둘 다 멱등적인 정확한 항목 실행 취소를 반환하며, 공유 `EntryValues` 구현 인터페이스는 공개되지 않습니다.
