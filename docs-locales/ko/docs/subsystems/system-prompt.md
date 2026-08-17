# 시스템 프롬프트 조립

[system-prompt 패키지](../../packages/core/system-prompt)는 프롬프트 기여자와 하나의 조립 호출 간에 교환되는 데이터를 소유합니다. 패키지의 [README](../../packages/core/system-prompt/README.md)에는 등록, 순서 지정, 범위 지정 및 렌더링 동작이 문서화되어 있으며, 이 페이지에는 플러그인이 구현하거나 전달하는 정확한 패키지 간 타입을 기록합니다.

출처: [`packages/core/system-prompt/src/index.ts`](../../packages/core/system-prompt/src/index.ts).

## 조립 컨텍스트

`AssembleContext`는 하나의 조립이 확인하는 범위 계층을 식별하며, 해당 요청의 명시적 제어 신호를 포함할 수 있습니다. 이는 병합 확장이 가능합니다. `dsh-agent`는 선택 사항인 라이브 `agent` 필드를 추가하고, `assembleContextFor(agent, signal)`는 명시적 필드를 함께 설정합니다. 기본 조립에는 범위와 신호가 모두 없습니다.

```ts type-equiv
/** Merge-extensible context for one prompt assembly. */
interface AssembleContext {
  /**
   * Scope whose providers and waterfall listeners participate. When absent,
   * only global providers and subject-less listeners participate.
   */
  scope?: ScopeKey
  /** Explicit control signal for the turn that requested this assembly, when any. */
  signal?: AbortSignal
}
```

## 도구 제공자 결과

`ToolProviderResult.schemas`는 현재 조립에서 모델에 표시되는 집합입니다. `knownNames`는 구성된 이름의 오타와 이 범위에서 의도적으로 숨겨진 알려진 도구를 구별하는 데 사용되는 제공자의 제한 전 이름 공간입니다.

```ts type-equiv
/** Tool schemas visible in one assembly and their pre-restriction name set. */
interface ToolProviderResult {
  /** The schemas this provider contributes to THIS assembly. */
  readonly schemas: readonly ToolSchema[]
  /** The pre-restriction name universe for config validation (defaults to `schemas`' names). */
  readonly knownNames?: readonly string[]
}
```

## 프롬프트 섹션

`PromptSection`는 읽기 전용 동일 프로세스 등록 계약입니다. 텍스트는 정적일 수도 있고 현재 조립 컨텍스트에서 확인될 수도 있습니다. 하나의 유효한 `complete` 섹션은 협력적 조립 후 유일한 프롬프트 섹션이 됩니다.

```ts type-equiv
/** One contributed section of the system prompt (registry input). */
interface PromptSection {
  /** Unique name — a duplicate registration throws (see {@link SystemPrompt.section}). */
  readonly name: string
  /**
   * Sections are concatenated in ascending order. Convention: `-100` is the
   * harness identity, `0` the deployment persona, tool guidance uses 100–199;
   * other negative orders also render before the persona.
   */
  readonly order: number
  /**
   * Static text or a provider evaluated at each assembly with that assembly's
   * {@link AssembleContext}. The text may reference `{{variable}}`s — they are
   * interpolated later, by {@link renderPrompt}.
   */
  readonly text: string | ((context: AssembleContext) => string)
  /**
   * Treat this contribution as the complete system prompt. Assembly still
   * runs the cooperative waterfall so tools, contexts, and variables can be
   * resolved, then restores this exact section as the sole prompt section.
   * More than one effective complete section makes assembly fail.
   */
  readonly complete?: boolean
}
```

## 동적 프롬프트 컨텍스트

`PromptContext`는 `PromptSection`에 대응하는 캐시 안전한 항목입니다. 조립은 이러한 기여를 확인하고 순서를 지정하며, agent-loop는 유지된 모델 기록 뒤에 완전한 현재 스냅샷을 변경되었거나 압축으로 제거된 경우에만 기록합니다.

```ts type-equiv
/** Dynamic model context materialized as a durable user-role snapshot. */
interface PromptContext {
  /** Unique name — a duplicate registration throws (see {@link SystemPrompt.context}). */
  readonly name: string
  /** Contexts are joined in ascending order. */
  readonly order: number
  /** Static text or a provider evaluated for each assembly. Empty text contributes nothing. */
  readonly text: string | ((context: AssembleContext) => string)
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

소스에서 `scripts/gen-cordis-catalog.ts`로 생성되었습니다(doc-sync에서 `pnpm run verify-cordis-catalog`로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`로 다시 생성). 이 섹션은 페이지의 두 언어 측에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하며 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있고, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxsystemprompt--systemprompt"></a>

### `ctx.systemPrompt` — `SystemPrompt`

각 모델 단계 전에 조립되는 프롬프트 입력을 위한 레지스트리 서비스입니다.

```ts cordis-catalog
/**
 * Register an ordered prompt section in the calling context's scope. A scoped
 * section shadows a global section with the same name; duplicates within one
 * layer and non-finite orders throw. Registration and disposal emit
 * `system-prompt/change`.
 * @param section - the section to register.
 * @returns the exact Cordis effect disposer.
 */
section(section: PromptSection): () => void

/**
 * Register ordered dynamic context in the calling context's scope. Scoped
 * entries shadow global entries with the same name.
 * @param context - the context contribution to register.
 * @returns the exact Cordis effect disposer.
 */
context(context: PromptContext): () => void

/**
 * Suppress every dynamic runtime-context contribution in the calling
 * context's scope without changing the services that own or enforce those
 * facts. Multiple suppressors remain independently disposable.
 * @returns the exact Cordis effect disposer.
 */
suppressRuntimeContext(): () => void

/**
 * Register a tool-schema provider in the calling context's scope. Global and
 * matching scoped providers both contribute; returning the reserved
 * {@link TOOL_ORDER_REST} name makes assembly fail.
 * @param provider - evaluated for each assembly with its context.
 * @returns the exact Cordis effect disposer.
 */
tools(provider: (context: AssembleContext) => ToolProviderResult): () => void

/**
 * Register a prompt variable in the calling context's scope. Scoped values
 * shadow globals; invalid or duplicate names throw. A provider may return
 * `undefined`, but rendering a section that references that value then fails.
 * @param name - the `[a-z][a-z0-9_]*` reference name.
 * @param provider - evaluated for each assembly.
 * @returns the exact Cordis effect disposer.
 */
variable(name: string, provider: (context: AssembleContext) => string | undefined): () => void

/**
 * Assemble global and scoped providers, detach tool parameters, apply
 * canonical ordering, then run the assembly waterfall. Scoped sections and
 * variables shadow globals. The returned waterfall value is authoritative
 * except that an effective complete section is restored afterwards as the
 * sole prompt section.
 * @param context - the optional scope and plugin-defined assembly fields.
 * @returns the post-waterfall assembly with any complete prompt enforced.
 */
async assemble(context: AssembleContext = {}): Promise<PromptAssembly>
```

출처: [`packages/core/system-prompt/src/index.ts:338`](../../packages/core/system-prompt/src/index.ts)

<a id="system-prompt-events"></a>

### `system-prompt/*` 이벤트

<a id="system-promptassemble--waterfall"></a>

#### `system-prompt/assemble` — 워터폴

조립된 섹션, 컨텍스트, 도구 및 변수에 대한 전문가 워터폴입니다. 범위 필터링된 디스패치(`@deepseek-ai/dsh-scope`)에서는 범위가 지정된 리스너가 해당 범위의 조립만 수신합니다. 반환 값이 권한 있는 값입니다. 제공된 신호는 이 명시적 조립 요청만 제어하며 이후 턴을 제어하기 위해 유지해서는 안 됩니다. 등록된 완전한 섹션은 이 워터폴 후에 복원되므로 리스너는 해당 범위의 시스템 프롬프트에 추가하거나 이를 대체할 수 없습니다.

```ts cordis-catalog
/**
 * Expert waterfall over the assembled sections, contexts, tools, and variables.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): scoped listeners
 * receive only that scope's assemblies. The returned value is authoritative.
 * A supplied signal controls only this explicit assembly request and must not
 * be retained to control later turns. A registered complete section is
 * restored after this waterfall, so listeners cannot add to or replace
 * that scope's system prompt.
 * @param assembly - the mutable assembly built from registered providers.
 * @param context - the caller's per-assembly context.
 * @mode waterfall
 */
'system-prompt/assemble'(this: Scoped<SystemPrompt>, assembly: PromptAssembly, context: AssembleContext, next: () => Promise<PromptAssembly>): Promise<PromptAssembly>
```

유형: [Scoped](scope.md)

소스: [`packages/core/system-prompt/src/index.ts:31`](../../packages/core/system-prompt/src/index.ts)

<a id="system-promptchange--emit"></a>

#### `system-prompt/change` — 발생

프롬프트 제공자가 변경될 때 발생합니다. 전역 변경은 모든 범위에 영향을 미치므로 이 레지스트리 알림은 필터링되지 않습니다.

```ts cordis-catalog
/**
 * Emitted when any prompt provider changes. This registry notification is
 * unfiltered because a global change affects every scope.
 * @mode emit
 */
'system-prompt/change'(): void
```

소스: [`packages/core/system-prompt/src/index.ts:37`](../../packages/core/system-prompt/src/index.ts)
<!-- END GENERATED cordis-surface -->
