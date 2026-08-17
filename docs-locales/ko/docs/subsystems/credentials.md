# 사용자 자격 증명

[dsh-credentials](../../packages/credentials/credentials)의 자격 증명 경계는 비밀 정보를 구성에서 분리합니다. 설정 섹션과 `cordis.yml` 항목은 *참조* (환경 변수 이름)를 전달하고, [dsh-credentials-local](../../packages/credentials/credentials-local) 등의 제공자는 값을 소유하며, 소비자는 작업마다 참조를 한 번 확인합니다. LLM 어댑터는 모델 요청마다 한 번 확인하므로 순환된 자격 증명은 재시작 없이 바로 다음 요청에 적용됩니다. 모든 제공자에는 경계 전체에 적용되는 규칙이 하나 있습니다. 저장된 값이 비어 있으면 모든 곳에서 없는 값으로 취급됩니다.

소스: [`packages/credentials/credentials/src/index.ts`](../../packages/credentials/credentials/src/index.ts)

## 식별자

참조는 하나의 자격 증명을 POSIX 스타일 환경 변수 이름으로 지정합니다. 브랜드는 호출자가 패키지나 프로세스 사이에서 전달되는 다른 문자열과 자격 증명 참조를 혼용하지 못하게 하며, 생성 시 셸 식별자 구문을 검증합니다.

```ts type-equiv
/** Nominal reference to one credential: a POSIX-style environment-variable name. */
type CredentialRef = Branded<'CredentialRef'>
```

## 확인

`resolve(ref)`은 제공자가 정의한 소스 계층과 함께 값을 반환하며, 구성되지 않은 경우에는 `undefined`을 반환합니다. 소비자는 각 작업에서 다시 확인하고 작업 간에는 절대 캐시하지 않습니다. 이 작업별 읽기가 즉시 업데이트 메커니즘입니다.

```ts type-equiv
/** One resolved credential value and the source layer that supplied it. */
interface ResolvedCredential {
  /** The non-empty secret value. */
  value: string
  /** Provider-defined source layer id (the local provider uses `env`, `file`, `project-env`, and `user-env`). */
  source: string
}
```

## 설명

`describe(ref)`은 값을 절대 노출하지 않고 구성 화면에 다음 정보를 제공합니다. 참조가 확인되는지, 어느 계층에서 확인되는지, 그리고 `set`이 현재 성공하는지입니다. 로컬 제공자는 실행 중인 프로세스 환경에서 제공된 참조를 `writable: false`으로 보고합니다. 쓰기는 성공한 것처럼 보이지만 확인은 계속 가려진 값을 반환할 수 있으므로, 경계는 이를 거부하고 UI는 처음부터 해당 참조를 읽기 전용으로 렌더링할 수 있습니다.

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

## 변경 커밋

`credentials/updated (ref)`은 제공자가 관리하는 소스에 변경이 커밋된 후 발생합니다. 즉, `set`, `unset` 또는 저장소에서 감지된 외부 편집 후에 발생합니다. 주변 프로세스 환경 변경은 관찰할 수 없으므로 이벤트도 발생하지 않습니다. 소비자는 이벤트가 필요하지 않습니다(작업마다 다시 확인함). 이 이벤트는 "구성됨" 배지를 새로 고치는 구성 화면을 위해 존재합니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`에서 소스를 기반으로 생성됩니다(문서 동기화에서 `pnpm run verify-cordis-catalog`으로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`으로 다시 생성). 이 섹션은 페이지의 두 언어 영역에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [개요](../cordis-primer.md#dispatch-modes)에서 정의하며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxcredentials--credentialprovider-abstract-seam"></a>

### `ctx.credentials` — `CredentialProvider` (추상 경계)

추상 자격 증명 서비스입니다. 제공자는 각자의 소스 계층에서 네 가지 작업을 구현합니다. 이들 모두에는 경계 전체에 적용되는 규칙이 하나 있습니다. 저장된 값이 비어 있으면 모든 곳에서 없는 값으로 취급됩니다. 즉, `resolve`은 이를 건너뛰고 `describe`은 구성되지 않은 것으로 보고하므로, 빈 값은 구성된 비밀 정보로 위장되지 않습니다.

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

소스: [`packages/credentials/credentials/src/index.ts:60`](../../packages/credentials/credentials/src/index.ts)

<a id="credentials-events"></a>

### `credentials/*` 이벤트

<a id="credentialsupdated--emit"></a>

#### `credentials/updated` — 발생

제공자가 관리하는 자격 증명 소스에 커밋된 변경입니다. 즉, `set`, `unset` 또는 저장소에서 감지된 외부 편집입니다. 주변 프로세스 환경 변경은 관찰할 수 없으므로 이벤트도 발생하지 않습니다. 동기 throw와 비동기 거부를 포함한 리스너 실패는 커밋된 작업의 결과를 바꾸지 않고 격리되어 기록됩니다. 단, `INVARIANT`로 코딩된 실패는 모든 리스너가 실행된 후 다시 throw됩니다. 이 재throw는 동기 리스너에서만 발생자에게 도달하므로, 이 이벤트의 불변성 검사는 비동기 함수여서는 안 됩니다.

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

소스: [`packages/credentials/credentials/src/types.ts:29`](../../packages/credentials/credentials/src/types.ts)
<!-- END GENERATED cordis-surface -->
