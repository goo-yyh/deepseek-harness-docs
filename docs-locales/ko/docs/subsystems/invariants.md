# 런타임 불변성

[dsh-invariants](../../packages/runtime-diagnostics/invariants)는 패키지 소유 런타임 불변성 검사를 위한 구성 가능한 레지스트리 서비스(`ctx.invariants`)입니다. 이는 지원 그룹 패키지 하나이며, 세 패키지 기능 추상 경계가 아니고 에이전트 루프 핵심부의 일부도 아닙니다. 레지스트리는 선택, 이름 예약, 자식 fiber 수명 주기 및 패키지 귀속 실패를 소유하며, 모든 워크스페이스 패키지는 정확한 npm 패키지 이름으로 검사를 등록하는 `./invariant` 동반 플러그인을 게시합니다. 검사가 단언할 수 있는 대상, 즉 서비스나 메서드 존재 여부가 아니라 권위 있는 이벤트 스트림 또는 변경 가능한 데이터는 [AGENTS.md](../../AGENTS.md#conventions)의 런타임 불변성 규칙에 정의되어 있으며, 레지스트리 설계는 [불변성 서비스 Agent Note](../../.agents/notes/implemented/architecture/2026-07-19-package-owned-invariant-service.md)에서 관리합니다.

소스: [`packages/runtime-diagnostics/invariants/src/index.ts`](../../packages/runtime-diagnostics/invariants/src/index.ts)

## 선택

```ts type-equiv
/** Runtime invariant selection configured on the service plugin. */
interface Config {
  /** Global switch; defaults to `true`. */
  readonly enabled?: boolean
  /** Case-sensitive JavaScript regex sources that admit package names; empty admits all. */
  readonly package_allowlist?: string[]
  /** Case-sensitive JavaScript regex sources that exclude package names after allowlist matching. */
  readonly package_blocklist?: string[]
}
```

서비스가 활성화되어 있고, 허용 목록이 비어 있거나 하나 이상의 패턴이 전체 npm 이름과 일치하며, 차단 목록 패턴과는 일치하지 않을 때 패키지가 선택됩니다. 차단 목록 일치는 허용 목록 일치보다 우선합니다. 항목은 `new RegExp(source)`로 컴파일됩니다. 소스가 `^` 및 `$`를 제공하지 않는 한 일치는 앵커되지 않으며, `/pattern/flags` 구문은 파싱되지 않습니다. 검증은 서비스 시작 시 명확하게 실패합니다. 비어 있거나 공백으로 둘러싸였거나 중복되었거나 유효하지 않은 항목은 건너뛰는 대신 예외를 발생시킵니다. 유효한 패턴은 현재 로드된 패키지와 일치하지 않을 수 있으므로 이후 로딩과 HMR이 결정적으로 유지됩니다. 필터는 서비스 수명 동안 고정됩니다([README](../../packages/runtime-diagnostics/invariants/README.md)).

## 설치 프로그램

```ts type-equiv
/**
 * Throw a package-attributed invariant failure.
 * @param message - violated package contract without the standard prefix.
 * @returns never because reporting a violation throws.
 */
type InvariantFailure = (message: string) => never
```

```ts type-equiv
/** Install one package's checks into the registration's child context. */
interface InvariantInstaller {
  /**
   * Install the package contribution.
   * @param ctx - child context owned by this invariant registration.
   * @param fail - reporter bound to the registering package name.
   * @returns nothing, or a promise settling after asynchronous checks finish.
   */
  (ctx: Context, fail: InvariantFailure): void | Promise<void>
  /** Services the child installer fiber may access. */
  readonly inject?: Inject
}
```

활성화된 설치 프로그램은 전용 자식 Cordis fiber에서 실행됩니다. `installer.inject`는 해당 fiber가 액세스할 수 있는 서비스를 선언하고, 동기 또는 비동기 설치 프로그램 완료는 등록이 성공하기 전에 결합됩니다. `fail(message)`는 `InvariantError`를 발생시킵니다. 즉, 안정적인 `code: 'INVARIANT'`, 소유 `packageName` 및 `invariant violated by "<package>": …`로 시작하는 메시지를 포함하는 `extends Error`입니다. 따라서 레지스트리가 어떤 제품 패키지도 가져오지 않고 위반 사항을 귀속할 수 있습니다.

## 서비스

`ctx.invariants.register(packageName, installer)`는 전체 npm 패키지 이름에 대해 활성 등록 하나를 예약하고 해당 effect 범위 disposer를 반환합니다. 필터가 설치 프로그램을 비활성 상태로 유지하더라도 예약은 유지되므로, 두 플러그인이 동일한 패키지 이름을 조용히 주장할 수 없습니다. 중복되었거나 비어 있거나 공백을 포함하는 이름은 예외를 발생시킵니다. 설치 프로그램 실패 시 자식 fiber가 폐기되고 예약이 원자적으로 해제됩니다. 서비스는 모든 등록 fiber를 소유하고, 반환된 disposer 역시 동반 fiber에 속합니다. 어느 쪽을 언로드해도 리스너, 추적 상태 및 예약이 제거되므로 동반 구성 요소는 보존된 상태 없이 다시 로드하고 동일한 이름을 다시 등록할 수 있습니다.

## 동반 구성 요소 계약

모든 워크스페이스 패키지는 `./invariant` 동반 구성 요소를 소유합니다([패키지 계약](../../packages/AGENTS.md)). 게시와 등록은 빠짐없이 이루어지지만, 단언은 의도적으로 합성하지 않습니다. 동반 구성 요소는 패키지가 관찰 가능한 이벤트 또는 변경 가능한 데이터 관계를 소유하는 경우에만 검사를 설치합니다. 그렇지 않으면 `No runtime invariant:`로 시작하고 검사할 수 없는 이유를 패키지별로 설명하는 선행 주석이 있는 빈 설치 프로그램을 내보냅니다. `pnpm run verify-package-invariants`는 생성된 마커, 설명 없는 빈 설치 프로그램, 리포터를 생략하거나 무시하는 비어 있지 않은 설치 프로그램, 잘못된 등록 이름, 불완전한 내보내기·게시·의존성·번들 연결을 기계적으로 거부합니다([기계 규칙 Agent Note](../../.agents/notes/implemented/architecture/2026-07-19-package-invariant-runtime-contracts.md)). 실행 가능한 동반 구성 요소의 카탈로그와 표준 구성은 [패키지 README](../../packages/runtime-diagnostics/invariants/README.md)에 있습니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`가 소스에서 생성했으며(doc-sync에서 `pnpm run verify-cordis-catalog`로 최신 상태를 확인하고, `pnpm run gen-cordis-catalog`로 다시 생성) 이 섹션은 페이지의 두 언어 버전에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxinvariants--invariantregistry"></a>

### `ctx.invariants` — `InvariantRegistry`

전역 및 정규식 기반 선택을 지원하는 패키지 소유 불변성 레지스트리입니다.

```ts cordis-catalog
/**
 * Register one package's invariant installer. The package name is reserved
 * even when filtering disables its checks. Enabled installers run in a child
 * fiber; failure disposes that fiber and releases the reservation.
 * @param packageName - full npm package name that owns the contribution.
 * @param installer - listener or startup-check installer for the child context.
 * @returns an effect-scoped disposer for the registration.
 */
register(packageName: string, installer: InvariantInstaller): () => void
```

소스: [`packages/runtime-diagnostics/invariants/src/index.ts:94`](../../packages/runtime-diagnostics/invariants/src/index.ts)
<!-- END GENERATED cordis-surface -->
