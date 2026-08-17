# 코드 런타임

코드 실행 경계는 호스트가 제공하는 비동기 바인딩에 대해 모델이 작성한 프로그램 하나를 실행하고, 해당 프로그램이 출력하고 반환한 내용을 보고하는 [기능 경계](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md)이며, 그 서비스 정의는 [dsh-code-runtime](../../packages/code-runtime/code-runtime), `ctx.codeRuntime`입니다. 코드 실행은 에이전트 루프의 핵심 부분이 아닌 **선택적 기능 하나**이므로, 관련 용어는 [core.md](core.md)가 아니라 여기에 있습니다. 백엔드는 서비스의 읽기 전용 설명자인 실행 기반과 소스 언어에 따라 달라집니다. 워커 스레드 서비스 제공자와 도구 레지스트리 소비자는 [Code Mode 기반](../../.agents/notes/implemented/feature/2026-06-15-code-mode.md) 및 [타입이 지정된 반환 계약](../../.agents/notes/implemented/feature/2026-07-20-code-mode-typed-tool-returns.md)에서 정의됩니다.

출처: [`packages/code-runtime/code-runtime/src/types.ts`](../../packages/code-runtime/code-runtime/src/types.ts)

## 실행: 요청 입력, 결과 출력

`CodeRunRequest`에는 **런타임이 처리하는 모든 항목** 이 담깁니다. "패키지 경계에서는 명시적인 것이 암묵적인 것보다 우선한다"는 규칙에 따라 기본값(시간 예산, 출력 상한)은 구현의 검증된 설정이며, `run()` 내부에 숨겨진 `??`가 아닙니다:

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

결과는 오류를 **필드**로 보고하며, `run()`의 거부로 보고하지 않습니다. 실패한 프로그램을 보고하는 일은 예외 경로가 아니라 호출자의 책임입니다(실패 시 resolve하는 `ShellExecutor.run`의 계약과 일치함):

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

## 바인딩: 프로그램 전역 객체로서의 호스트 함수

각 `CodeBindingNamespace`은 프로그램 내부에서 비동기 호출 가능 항목으로 구성된 전역 객체 하나가 됩니다(Code Mode 소비자는 `tools` 하나를 전달합니다). 인수와 해결값은 손실 없는 JSON이어야 하며 경계 수준의 바이트 상한 없이 경계를 통과합니다. 런타임은 이를 구조화된 복제를 통해 연결할 수 있습니다. 네임스페이스는 런타임이 소비자의 이름을 알 필요 없이 프로그램에 표시되는 오류 클래스를 선언할 수 있습니다. 런타임은 실제 생성자를 주입하고 거부된 호출을 그 인스턴스로 변환합니다. 런타임은 바인딩 이름도 신뢰할 수 없는 입력으로 처리합니다(`__proto__`은 프로토타입 충돌이 아닌 일반적인 자체 속성입니다):

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

## 캡처된 출력과 실패 분류 체계

로그는 발생 순서대로 된 일반 문자열입니다. 런타임은 프로그램의 콘솔 및 스트림 출력을 캡처하지만, 소비자는 텍스트만 렌더링하므로 채널 및 콘솔 메서드 메타데이터는 이 경계의 일부가 아닙니다. 구현은 직렬화된 외부 로그 배열과 완료 값 또는 실패 메시지 페이로드에 상한을 둡니다. 고정된 결과 엔벌로프 구문과 소비자 표시 공백은 이 가변 페이로드 원장의 일부가 아닙니다. 오버플로는 인밴드 값 대체가 아니라 명시적 실패입니다.

실패 종류는 **서로 독립적으로 보고되는 결과** 입니다([방어 패턴](../defensive-patterns.md)에 따름). 예산 만료는 예외가 아니고, 중단은 타임아웃이 아니며, 기반 환경의 종료(예: OOM)는 그 어느 것도 아닙니다:

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

## 서비스

`CodeRuntime` (`ctx.codeRuntime`, 추상 — [`packages/code-runtime/code-runtime/src/index.ts`](../../packages/code-runtime/code-runtime/src/index.ts)에 정의됨)는 `run(request)`와 읽기 전용 설명자 두 개로 구성됩니다. `language`(프로그램을 작성해야 하는 언어 — `'typescript'` 및 `'python'`은 잘 알려진 값이고, `dsh-tools`이 이를 제공하며, 게시된 백엔드를 가진 것은 `'typescript'`뿐입니다. 언어별 표현을 생성하는 소비자는 이 값을 기준으로 분기하고, 표현할 수 없는 값에서는 명확하게 실패해야 합니다) 및 `isolation`(실행 기반 환경 — `'worker-thread'`, `'process'`, `'container'`; 진단용 레이블이며, **보안 보장을 의미하지는 않습니다**)입니다. 구현은 실행을 서로 격리해야 하며(실행 간 상태 없음), 안정 상태가 될 때까지 폐기해야 합니다. 즉, 진행 중인 실행은 해제 완료 전에 종료되고 대기되어야 합니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`에서 소스로부터 생성됩니다(문서 동기화에서 `pnpm run verify-cordis-catalog`로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`로 다시 생성합니다). 이 섹션은 페이지의 두 언어 버전에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하며 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [개요](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxcoderuntime--coderuntime-abstract-seam"></a>

### `ctx.codeRuntime` — `CodeRuntime` (추상 심)

`ctx.codeRuntime` 구현 하나를 등록합니다. 프로그램, 예산, 중단 및 기반 환경 실패는 CodeRunResult에서 해결되며, 서비스 정의 계약의 잘못된 사용만 거부됩니다. 구현은 구조적 복제가 가능한 바인딩을 브리지하고, 선언된 각 네임스페이스 거부 클래스를 구체화하며, 프로그램을 적대적인 피어로 취급하고, 실행을 서로 격리하며, 폐기 중 진행 중인 실행을 종료하고 대기합니다.

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

출처: [`packages/code-runtime/code-runtime/src/index.ts:102`](../../packages/code-runtime/code-runtime/src/index.ts)
<!-- END GENERATED cordis-surface -->
