# 스킬

[스킬 기능 제품군](../../packages/skill)에는 서비스 정의([dsh-skill](../../packages/skill/skill), `ctx.skills`), 로컬 서비스 제공자([dsh-skill-filesystem](../../packages/skill/skill-filesystem)), 선택적 패키지 배지 제공자([dsh-skill-badge](../../packages/skill/skill-badge)), 소비자([dsh-tool-skill](../../packages/skill/tool-skill))가 포함됩니다. 레지스트리는 호스트 및 범위별 계층에서 제공자 카탈로그를 병합합니다. 제공자는 로컬 또는 패키지된 스킬을 제공하고, 소비자는 초기 및 대체 카탈로그와 모델 대면 `skill` 도구를 소유합니다. 스킬은 세션 이벤트가 아닌 선택적 지침이므로 해당 어휘는 [core.md](core.md)가 아니라 여기에 있습니다.

출처: [`packages/skill/skill/src/index.ts`](../../packages/skill/skill/src/index.ts), [`packages/skill/skill-filesystem/src/index.ts`](../../packages/skill/skill-filesystem/src/index.ts), [`packages/skill/skill-badge/src/index.ts`](../../packages/skill/skill-badge/src/index.ts), [`packages/skill/tool-skill/src/index.ts`](../../packages/skill/tool-skill/src/index.ts).

## 제공자 레지스트리

`ctx.skills`는 로컬, 임베디드, 원격 또는 기타 제공자를 결합합니다. 등록은 동기식이며, 원격 초기화 및 검색은 대기되는 `list()`에서 수행해야 합니다. 제공자 객체, 옵션, 후보는 읽기 전용으로 빌려오며 의미 필드는 검증됩니다.

레지스트리는 [도구 레지스트리](tools.md)가 [dsh-scope](../../packages/core/scope)에 설정한 형태인 호스트+범위별 계층 구조입니다. 등록은 호출 컨텍스트 범위의 계층에 기록되므로 호스트 행과 리포지토리 플러그인은 전역 계층에 배치되는 반면, 에이전트 프리셋의 상시 구성으로 마운트된 플러그인은 해당 프리셋의 계층에 배치됩니다. 제공자 이름은 프로세스 전체가 아니라 계층별로 고유합니다. 읽기는 전역 계층과 보는 범위의 체인을 병합합니다. 가장 가까운 계층의 항목이 중복 스킬 이름에 대해 즉시 우선하며, 아래의 순위는 하나의 계층 내에서만 중복을 결정합니다. 검색 캐시는 확인된 범위 체인을 키로 사용하므로 범위의 부모를 다시 지정하면(빈 세션 재구성) 레지스트리 변경 없이 다음 읽기에서 반영됩니다.

하나의 계층 내에서 중복 이름은 순위, 제공자 순서, 로컬 순서에 따라 해결되며 요약은 이름순으로 정렬됩니다. 거부된 `list()`는 기록되고 불완전한 관찰에서 제외되는 반면, 명시적인 불완전 관찰은 결과를 캐시 가능하게 만들지 않으면서 사용할 수 있는 후보를 제공합니다. 잘못된 형식의 후보는 즉시 실패합니다. 각 제공자 팩토리는 등록 범위 제어를 받습니다. 이 제어의 `invalidate()`는 정확히 해당 등록이 활성 상태인 동안에만 완료된 카탈로그를 지우며, 해당 신호는 등록 실패 또는 폐기 시 중단됩니다. 진행 중인 검색은 제공자 세대가 변경되면 한 번 재시도합니다. 두 번째 변경이 발생하면 최신 후보를 불완전하고 캐시되지 않은 상태로 반환합니다. 제공자 및 런타임 변경은 필터링되지 않은 `skills/change` 무효화 이벤트를 발생시킵니다. 이 이벤트에는 차이가 없으므로 소비자는 자체 조회 옵션으로 `snapshot()`를 다시 가져옵니다.

`SkillProvider.list()`가 반환한 배열은 완전 검색의 축약형입니다. `SkillProviderObservation`를 사용하면 제공자는 관찰이 권위 있는 결과가 아니라고 보고하면서도 직접 로드 가능한 후보를 노출할 수 있습니다.

```ts type-equiv
/** Provider candidates plus whether the current discovery is authoritative. */
interface SkillProviderObservation {
  /** Candidates available from the current provider discovery. */
  readonly candidates: readonly SkillCandidate[]
  /** Whether discovery completed and these candidates may be cached. */
  readonly complete: boolean
}
```

```ts type-equiv
/** Provider interface for one source of skills, such as local directories or a remote registry. */
interface SkillProvider {
  /** Unique provider name in the `ctx.skills` registry. */
  readonly name: string
  /**
   * List available skill candidates for the current lookup context. Provider
   * plugins register synchronously during `apply()`; remote initialization,
   * authentication, and discovery are awaited inside this method. Implementations
   * should settle promptly when `options.signal` aborts.
   * @param options - lookup options; `cwd` selects workspace-sensitive skills and `signal` cancels work.
   * @returns provider candidates as a complete-array shorthand, or an explicit
   *   observation when usable candidates came from incomplete discovery.
   */
  readonly list: (options: SkillLookupOptions) => Promise<readonly SkillCandidate[] | SkillProviderObservation>
  /**
   * Load a complete skill body for a previously listed candidate.
   * @param candidate - the winning candidate originally returned by this provider.
   * @param options - lookup options; `cwd` selects workspace-sensitive skills and `signal` cancels work.
   * @returns the full skill body, or `undefined` if it is no longer loadable.
   */
  readonly get: (candidate: SkillCandidate, options: SkillLookupOptions) => Promise<SkillDefinition | undefined>
}
```

```ts type-equiv
/** Registration-scoped lifecycle and invalidation capability borrowed by one provider. */
interface SkillProviderControl {
  /** Aborts if registration fails or when the exact provider registration is disposed. */
  readonly signal: AbortSignal
  /** Invalidate completed catalogs and notify consumers only while the exact registration remains active. */
  readonly invalidate: () => void
}
```

## 로컬 검색 우선순위

제공되는 로컬 제공자는 다음 순위로 루트를 검사합니다.

| 순위 | 소스 | 루트 |
|---|---|---|
| 100 | `project-dsh` | `<projectRoot>/.dsh/skills` |
| 200 | `project-agents` | `<projectRoot>/.agents/skills` |
| 300 | `custom` | `Config.customSkillDirs` |
| 400 | `user-dsh` | `<dshHome>/skills` |
| 500 | `user-agents` | `<agentsHome>/skills` |
| 600 | `bundled` | `Config.bundledSkillDir` 구성된 경우 |

프로젝트 루트는 `.git`를 포함하는 가장 가까운 상위 디렉터리입니다. 그러한 디렉터리가 없으면 현재 cwd를 사용합니다. `ctx.fs`를 사용할 수 있으면 git 루트 탐색은 원격 또는 샌드박스 워크스페이스가 호스트 파일 시스템 경계로 폴백하지 않도록 파일 시스템 서비스를 통해 `.git`를 검사합니다. 사용자 DSH 루트는 해당 `.system` 하위를 건너뜁니다. 로컬 제공자는 내장 시스템 스킬을 생성하지 않습니다. 배포는 구성된 번들 루트 또는 전용 제공자를 통해 패키지된 스킬을 제공합니다.

`dsh-skill-badge`는 `BUNDLED_SKILL_RANK`에 불변 `bundled` 후보 하나를 등록하고, `resourceBase`를 통해 해당 패키지 자산 디렉터리를 노출합니다. 제공되는 CLI는 플러그인을 비활성화된 상태로 선언하므로 해당 구성 행을 활성화하려면 명시적으로 선택해야 합니다.

Chokidar는 기존 루트에서 직접 번들/플랫 항목의 추가 및 제거와 직접 스킬 항목 변경을 감시합니다. 누락된 루트는 Chokidar가 연결될 수 있을 때까지 가장 가까운 기존 상위 디렉터리에서 누락된 경로 세그먼트를 한 번에 하나씩 따라갑니다. 번들 아래의 리소스 파일은 카탈로그 변경이 아닙니다. 모델 대면 `write` 및 `edit` 관찰은 대상이 카탈로그와 관련된 경우 제공자를 동기식으로 무효화하며, 호스트 감시자는 IDE, Git, 셸 및 외부 프로세스 변경을 처리합니다. 감시자 실패 시 직접 로드에서 읽을 수 있는 후보를 숨기지 않고 현재 관찰을 불완전하게 만듭니다. 프로젝트 범위 감시자는 구성된 제한된 LRU를 사용합니다.

## 스킬 식별자

스킬 이름은 kebab-case(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)입니다. 로컬 제공자는 디렉터리 번들(`<name>/SKILL.md`)과 플랫 Markdown 파일(`<name>.md`)을 허용합니다. 중첩된 재귀 `**/SKILL.md` 검색은 지원되지 않습니다.

```ts type-equiv
/** Origin bucket for a skill contribution. The value is prompt-visible metadata, not precedence by itself. */
type SkillSource = 'project-dsh' | 'project-agents' | 'runtime' | 'user-dsh' | 'user-agents' | 'custom' | 'bundled' | (string & {})
```

## 요약, 후보 및 완전한 정의

`SkillSummary`는 레지스트리의 호출 중립적 요약 형태입니다. 소비자는 렌더링할 항목과 필드를 선택하며, 모델 세션 카탈로그는 모델 호출 가능 `name` 및 `description`만 사용하고 본문이나 절대 파일 경로는 사용하지 않습니다. `SkillInvocationPolicy`는 독립적인 두 호출 제어를 양의 부울값으로 정규화하며, 임의의 frontmatter를 도메인 모델로 전환하지 않은 채 모든 확인된 요약, 후보 및 정의에 이를 포함합니다.

```ts type-equiv
/** Invocation controls shared by skill discovery consumers. */
interface SkillInvocationPolicy {
  /** Whether model-facing catalogs and loaders include this skill. */
  readonly modelInvocable: boolean
  /** Whether human-facing command catalogs and loaders include this skill. */
  readonly userInvocable: boolean
}
```

```ts type-equiv
/** Invocation-neutral skill metadata returned by `ctx.skills.list()`. */
interface SkillSummary {
  /** Kebab-case identifier used to address the skill. */
  readonly name: string
  /** Short routing description shown by discovery consumers. */
  readonly description: string
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** Resolved model and user invocation controls. */
  readonly invocation: SkillInvocationPolicy
  /** Discovery source that produced this winning skill. */
  readonly source: SkillSource
  /** Provider that owns this skill body. */
  readonly provider: string
  /** Provider-specific base for relative resources. */
  readonly resourceBase?: SkillResourceBase
}
```

`ctx.skills.list()`는 네 가지 정책 조합을 모두 유지합니다. `isModelInvocable(skill)` 및 `isUserInvocable(skill)`는 해당하는 필수 필드를 읽습니다. 모델 전용 skill은 `{ modelInvocable: true, userInvocable: false }`를 설정하고, 사용자 전용 skill은 `{ modelInvocable: false, userInvocable: true }`를 설정하며, 두 필드를 모두 `false`로 설정하면 신뢰할 수 있는 `ctx.skills.get()` 호출자만 skill을 사용할 수 있습니다. 로컬 provider는 정확한 kebab-case frontmatter 키인 `disable-model-invocation` 및 `user-invocable`를 읽고, 생략된 필드는 `true`로 기본 설정하며, 파싱된 모든 skill을 이 정규화된 정책으로 투영합니다.

`SkillCatalogSnapshot`는 권위 있는 부재와 일시적인 provider 실패 또는 탐색 중 계속 변경된 카탈로그를 구분합니다. `skills`에는 해당 관찰에서 수집한 정렬된 호출 중립적 요약이 포함되며, `complete`는 등록된 모든 provider가 동시 카탈로그 수정 없이 완료된 경우에만 true입니다. 불완전한 스냅샷은 캐시되지 않으므로 각 소비자는 마지막으로 정상인 필터링 카탈로그를 유지하고 재시도할 수 있습니다.

```ts type-equiv
/** One catalog observation plus whether discovery completed within a stable catalog revision. */
interface SkillCatalogSnapshot {
  /** Sorted invocation-neutral summaries collected in this observation. */
  readonly skills: SkillSummary[]
  /** Whether every registered provider completed without a concurrent catalog revision. */
  readonly complete: boolean
}
```

`SkillCandidate`는 provider에서 레지스트리로 전달되는 형태입니다. `locator`는 불투명한 provider 상태이며, 레지스트리는 이를 저장하고 우선권을 얻은 provider의 `get()`에 다시 전달할 뿐입니다.

```ts type-equiv
/** Provider catalog entry used by the registry to merge and later load skills. */
interface SkillCandidate extends SkillSummary {
  /** Lower ranks win duplicate skill names before provider registration order is considered. */
  readonly rank: number
  /** Opaque provider-owned handle passed back to `provider.get()`. */
  readonly locator: unknown
  /** Absolute file path when the provider has one. */
  readonly path?: string
  /** Parsed optional metadata object from provider-specific skill frontmatter. */
  readonly metadata?: Readonly<Record<string, unknown>>
}
```

`SkillDefinition`는 `ctx.skills.get()`가 반환하고 `skill` 도구가 사용하는 완전한 파싱 결과입니다. `resourceBase`는 로컬, URL 또는 provider 관리 skill에 대한 상대 리소스 안내를 렌더링하는 방법을 도구에 알려 줍니다.

```ts type-equiv
/** Optional provider-specific base used by loaded skill bodies to resolve relative resources. */
type SkillResourceBase =
  | { readonly kind: 'directory'; readonly path: string }
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'opaque'; readonly description: string }
```

```ts type-equiv
/** Complete parsed skill definition, including the body loaded by `ctx.skills.get()`. */
interface SkillDefinition extends SkillSummary {
  /** Markdown instruction body after any provider-specific metadata removal. */
  readonly content: string
  /** Absolute file path when the skill came from disk. */
  readonly path?: string
  /** Parsed optional metadata object from frontmatter. */
  readonly metadata?: Readonly<Record<string, unknown>>
}
```

런타임 skill 입력에서는 호출 제어 및 provider 레이블을 생략할 수 있습니다. 레지스트리는 두 기본값을 한 번 확인한 다음 provider와 동일한 완전한 정의 형태와 선행 우선 수집 순서를 사용합니다. 반환된 disposer는 기여 항목을 제거하고 탐색 캐시를 무효화합니다.

```ts type-equiv
/** Runtime skill contribution accepted by `ctx.skills.register()`. */
type SkillRegistration = Omit<SkillDefinition, 'invocation' | 'provider'> & {
  /** Invocation controls; omission permits both model and user surfaces. */
  readonly invocation?: SkillInvocationPolicy
  /** Provider label; omission uses the registry-owned runtime provider. */
  readonly provider?: string
}
```

## 조회 및 구성

provider가 워크스페이스 로컬 skill을 노출할 수 있으므로 skill 조회는 cwd에 민감하며, 선택적 signal은 호출자를 위해 provider 작업을 취소합니다. 레지스트리 읽기는 `SkillViewOptions`를 통해 조회 범위도 수신합니다. 소비자는 호출 agent를 전달하며, 이는 자체 범위 키입니다. 레지스트리는 계층 선택에 `scope`를 사용하고, provider는 동일하게 빌린 옵션 객체에서 자신의 `SkillLookupOptions` 계약만 읽습니다. 취소는 캐시 적중을 포함하여 카탈로그 선택 전후에 검사되며, 탐색과 전체 정의 로딩 모두와 경합합니다. git root를 찾지 못하면 로컬 provider는 제공된 cwd 자체를 프로젝트 root로 취급합니다.

전체 정의는 레지스트리에서 캐시되지 않습니다. 각 `get()`는 선택된 후보와 함께 우선권을 얻은 provider를 호출하므로 로컬 provider는 현재 본문을 다시 읽습니다. 이름이 더 이상 해당 후보와 일치하지 않는 정의는 거부되며, 정확한 provider를 무효화하여 재탐색합니다.

```ts type-equiv
/** Caller context used for cwd-sensitive and abortable provider work. */
interface SkillLookupOptions {
  /** Workspace selector for the current lookup. */
  readonly cwd?: string | undefined
  /** Abort discovery or loading work for the current caller. */
  readonly signal?: AbortSignal | undefined
}
```

```ts type-equiv
/**
 * Registry read options: provider lookup context plus the viewing scope.
 * The registry consumes `scope` to select layers; providers receive the same
 * borrowed options object and read only their {@link SkillLookupOptions}
 * contract from it.
 */
interface SkillViewOptions extends SkillLookupOptions {
  /** Viewing scope (the calling agent); omitted reads the global layer alone. */
  readonly scope?: ScopeKey | undefined
}
```

레지스트리는 자체 탐색 캐시 한도만 소유합니다. 로컬 provider는 파일 시스템 root(`dshHome`, `agentsHome`, `customSkillDirs` 및 선택적 `bundledSkillDir`/`DSH_BUNDLED_SKILL_DIR`)와 watcher 활성화, 폴링, 안정성, symlink 및 프로젝트 용량 제어를 소유합니다. 소비자는 카탈로그 설명 한도를 소유합니다. 정확한 기본값과 검증은 생성된 [구성 카탈로그](../config-catalog.md)에 있습니다.

```ts type-equiv
/** Skill registry configuration. */
interface Config {
  /** Maximum number of completed cwd/provider catalogs kept in memory. */
  readonly collectCacheMaxEntries?: number
}
```

## 세션 카탈로그 및 도구 계약

`dsh-tool-skill`는 비어 있지 않은 완전한 뷰를 관찰하는 활성 세션의 첫 번째 `agent/pre-step`에서 초기의 영속적인 사용자 역할 `<system-reminder>`를 주입합니다. 카탈로그에는 정렬된 skill `name`와 정규화되고 XML 이스케이프된 `description`만 포함되며, 본문, 경로, 소스, provider 및 라우팅 힌트는 생략됩니다. 검색은 `SkillLookupOptions`를 통해 단계의 중단 신호를 전달합니다. `catalogDescriptionMaxLength`는 설명 범위에 대한 소비자 설정이며, 기본값은 `500`이고 정수 최솟값은 `3`입니다.

이후 각 모델 단계 전에 소비자는 완전한 스냅샷에서 `<available_skills>` 태그 사이에 정확히 렌더링된 항목에 정확한 도구 가시성을 적용하고 이를 다이제스트합니다. 플러그인에서 제공된 최신 인식 가능한 가시 카탈로그 메시지의 동일한 항목에서 비교 기준선을 도출합니다. 다이제스트가 변경되면 `agent.inject()`를 통해 영속적인 전체 대체 항목을 추가하며, 모든 skill을 삭제하면 명시적인 빈 대체 항목을 추가합니다. 불완전한 스냅샷은 마지막으로 정상인 모델 뷰를 유지합니다. 압축으로 모든 이전 카탈로그 메시지가 숨겨지면 다음 완전한 스냅샷이 현재 카탈로그를 다시 설정합니다. 이전 카탈로그가 없는 빈 뷰는 아무것도 내보내지 않습니다. 이러한 카탈로그 메시지는 World State가 아니라 세션 기록입니다.

모델용 `skill({ name })` 도구는 kebab-case 이름을 검증하고, 호출 중립적 카탈로그에서 요약을 찾은 뒤, `isModelInvocable`가 접근을 허용하지 않으면 로드하기 전에 거부합니다. 그런 다음 호출 에이전트 cwd에 대한 완전한 정의를 다시 읽고 콘텐츠를 반환하기 전에 정책을 재확인합니다. 확인할 수 없는 skill은 알 수 없거나 더 이상 사용할 수 없는 것으로 보고하며, `<skill_content name="...">`, `<skill_resources>` 및 `<skill_instructions>`가 포함된 도구 결과를 반환합니다. `resourceBase`는 명시적으로 참조된 스크립트, 참조 자료 및 자산만 필요할 때 해석합니다. 로드된 결과는 skill 디렉터리를 열거하지 않습니다. 따라서 본문만 수정하면 카탈로그 메시지를 생성하거나 이전 도구 결과를 다시 작성하지 않고 이후 도구 호출만 변경됩니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`에서 소스로부터 생성되었습니다(문서 동기화에서 `pnpm run verify-cordis-catalog`로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`로 다시 생성). 이 섹션은 페이지의 두 언어 영역에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에서 정의되며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxskills--skillregistry"></a>

### `ctx.skills` — `SkillRegistry`

skill provider의 계층형 레지스트리이며, tools 레지스트리가 설정한 호스트+범위별 형태입니다. 등록은 호출 컨텍스트 범위(scopeOf)의 계층에 기록됩니다. 호스트 행과 리포지터리 플러그인은 전역 계층에 위치하며, 에이전트 프리셋의 상시 구성으로 마운트된 플러그인은 해당 프리셋의 계층에 위치합니다. 읽기는 전역 계층을 조회 범위의 체인과 병합합니다. 가장 가까운 계층의 항목이 중복 이름을 즉시 우선하며, 순위 순서는 하나의 계층 내에서만 중복 항목을 결정합니다. 정렬된 호출 중립적 요약을 노출하고 필요에 따라 전체 skill 본문을 로드합니다.

```ts cordis-catalog
/**
 * Register a borrowed same-process provider synchronously during plugin
 * apply, into the calling context's layer: a scoped context (an agent
 * preset's standing mount) registers for that scope alone, an unscoped
 * context registers globally. Duplicate names within one layer and reserved
 * names throw; remote initialization belongs in `list()`. Fiber disposal
 * unregisters the provider and invalidates catalog caches.
 * @param create - synchronous factory receiving this registration's lifecycle and invalidation control.
 * @returns the exact Cordis effect disposer that unregisters this provider;
 *   composite effects may yield it directly to preserve teardown ordering.
 */
registerProvider(create: (control: SkillProviderControl) => SkillProvider): () => void

/**
 * Register a borrowed readonly runtime skill into the calling context's
 * layer. Project entries outrank runtime entries, which outrank user
 * entries, within one layer. Same-name runtime entries in one layer are
 * first-wins; a duplicate logs a warning and receives a no-op disposer so
 * it cannot remove the winner.
 * @param skill - the skill definition input; omitted invocation and provider fields receive defaults.
 * @returns the exact Cordis effect disposer, preserving composite teardown order and invalidating caches.
 */
register(skill: SkillRegistration): () => void

/**
 * List invocation-neutral skill summaries for a workspace. Consumers apply
 * model or user invocation policy at their operational boundary. Lookup
 * options and provider candidates are readonly same-process values borrowed
 * throughout discovery.
 * @param options - view options; `scope` selects the viewing agent's layers, `cwd` selects project roots, and `signal` cancels discovery.
 * @returns all sorted winning summaries.
 */
async list(options: SkillViewOptions = {}): Promise<SkillSummary[]>

/**
 * Observe the current invocation-neutral catalog and whether discovery completed within a stable revision.
 * Incomplete observations are never cached, allowing consumers to retain last-good state and
 * retry on their next request boundary.
 * @param options - view options; `scope` selects the viewing agent's layers, `cwd` selects project roots, and `signal` cancels discovery.
 * @returns sorted summaries plus discovery-completeness state.
 */
async snapshot(options: SkillViewOptions = {}): Promise<SkillCatalogSnapshot>

/**
 * Load and validate the winning candidate, passing its opaque discovery locator back to the
 * provider. Cancellation is rechecked after selection, including cache hits, and raced against
 * loading so an uncooperative provider cannot hang the caller.
 * @param name - kebab-case skill name.
 * @param options - view options; `scope` selects the viewing agent's layers,
 *   `cwd` selects workspace-sensitive skills, and `signal` cancels work.
 * @returns the full skill, including body content, or `undefined`.
 */
async get(name: string, options: SkillViewOptions = {}): Promise<SkillDefinition | undefined>
```

소스: [`packages/skill/skill/src/index.ts:357`](../../packages/skill/skill/src/index.ts)

<a id="skills-events"></a>

### `skills/*` 이벤트

<a id="skillschange--emit"></a>

#### `skills/change` — 내보내기

skill provider, 런타임 기여 요소 또는 provider 기반 카탈로그가 변경되었을 수 있습니다. 이는 필터링되지 않은 무효화 알림입니다. 소비자는 자체 조회 옵션을 위해 카탈로그를 다시 가져옵니다. 리스너 실패는 격리되며 레지스트리 변경을 거부할 수 없습니다.

```ts cordis-catalog
/**
 * A skill provider, runtime contribution, or provider-backed catalog may
 * have changed. This is an unfiltered invalidation notification; consumers
 * refetch the catalog for their own lookup options. Listener failures are
 * contained and cannot veto the registry mutation.
 * @mode emit
 */
'skills/change'(): void
```

소스: [`packages/skill/skill/src/index.ts:297`](../../packages/skill/skill/src/index.ts)
<!-- END GENERATED cordis-surface -->
