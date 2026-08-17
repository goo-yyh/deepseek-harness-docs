# 사용자 상호작용

[dsh-user-questions](../../packages/interaction/user-questions)의 user-questions seam입니다. 도구 또는 권한 플러그인이 에이전트가 계속 진행하기 전에 사람의 응답이 필요할 때 사용하는 공급자 중립 어휘입니다. UI 표면은 활성 `UserQuestionProvider`을 제공하고, 호스트 런타임은 요청을 연결된 클라이언트로 전달합니다.

출처: [`packages/interaction/user-questions/src/index.ts`](../../packages/interaction/user-questions/src/index.ts)

## 질문 옵션

`AskUserQuestionOption`에는 선택 가능한 항목 하나가 포함됩니다. `label`은 사용자에게 표시되는 옵션 텍스트이면서 모델에 전달되는 선택값이기도 하며, `description`은 선택적 UI 도움말 텍스트입니다.

```ts type-equiv
/** One selectable answer offered to the user. */
interface AskUserQuestionOption {
  /** User-facing label. */
  label: string
  /** Optional extra context rendered by capable UIs. */
  description?: string
}
```

## 표현 의도

`AskUserQuestionIntent`은 알려진 결정 유형을 선택적으로 선언합니다. 의도를 추가할 수 있도록 `kind`에 태그로 지정됩니다. UI가 태그를 인식하지 못하면 일반 옵션 목록을 렌더링합니다. 의도는 표시 방식만 변경합니다. 이를 따르는 UI는 일반 UI가 전송하는 것과 동일한 옵션 레이블로 응답하므로 호출자는 어느 경우든 같은 응답 필드를 읽습니다. `approve`은 옵션 순서에 의존하지 않고 긍정 옵션의 이름을 지정합니다. `ask()`은 어떤 타입도 표현할 수 없는 두 가지 단언을 거부합니다. 즉, 자체 질문의 어떤 옵션에도 해당하지 않는 `approve`과 `detail`이 없는 질문의 의도입니다.

```ts type-equiv
/**
 * A caller-declared presentation intent: the question IS this kind of
 * decision, so a UI that recognises the tag may present it as such instead of as a
 * generic option list. Tagged so further intents can be added; a UI that does
 * not know a tag renders the generic flow, and the answer encoding is identical
 * either way — an intent changes presentation only, never the protocol.
 */
type AskUserQuestionIntent = {
  /** A plan submitted for review: `detail` is the plan markdown `ask()` requires, and the decision approves or declines it. */
  kind: 'plan-review'
  /**
   * The option label that approves the plan; every other option declines it.
   * Named rather than positional so no UI infers the verdict from option order.
   * An `approve` naming no option of its own question is rejected at `ask()`.
   */
  approve: string
}
```

## 질문 항목

`AskUserQuestionItem`은 요청 내의 질문 하나입니다. 호출자는 안정적인 `id`을 제공하며, 일괄 질문의 라우팅이 유지되도록 응답과 함께 다시 반환됩니다. 선택적 `detail`에는 공급자가 질문과 함께 렌더링하지만 선택 가능한 옵션 레이블에는 포함하지 않는 보조 텍스트가 들어갑니다.

```ts type-equiv
/** One question in a user-questions request. */
interface AskUserQuestionItem {
  /** Stable caller-provided question id, echoed in the answer. */
  id: string
  /** The question to display. */
  question: string
  /** Optional supporting detail rendered with the question but kept out of option labels. */
  detail?: string
  /** Optional short heading/group label. */
  header?: string
  /** Optional choices the UI can render as a menu. */
  options?: AskUserQuestionOption[]
  /** Whether more than one option may be selected. Defaults to single-select. */
  multiSelect?: boolean
  /** Optional presentation intent for capable UIs; absent asks for the generic option list. */
  intent?: AskUserQuestionIntent
}
```

## 질문 요청

`AskUserQuestionRequest`은 패키지 간 요청입니다. `questions`은 배열이므로 UI는 응답마다 안정적인 id를 유지하면서 관련 프롬프트를 하나의 흐름으로 표시할 수 있습니다. `agent`이 있으면 정확한 활성 호출자를 의미하며, 상호작용 seam은 활성 레지스트리가 해당 인스턴스를 런타임 루트로 식별하는 경우에만 이를 허용합니다.

```ts type-equiv
/** Request for a human answer. */
interface AskUserQuestionRequest {
  /** Questions to display. */
  questions: AskUserQuestionItem[]
  /** Exact live calling agent, when the request came from an agent tool call. */
  agent?: Agent
  /** Abort signal for the owning tool/step. */
  signal?: AbortSignal
}
```

## 응답

공급자는 질문 id마다 하나의 응답 항목을 반환합니다. `selected`에는 선택된 옵션 레이블이 들어가며, 사용자가 입력한 경우 `custom`에는 자유 형식의 "기타" 응답이 들어갑니다. 단일 선택 질문에서는 `custom`이 선택된 항목을 재정의하고 `selected`은 비어 있습니다. 다중 선택 질문에서는 `custom`이 `selected`의 레이블을 보완할 수 있습니다. UI는 비어 있는 `selected`과 `custom`이 없는 항목을 사용하여, 그 외에는 완료된 일괄 처리에서 건너뛴 질문을 보존할 수도 있습니다.

```ts type-equiv
/** Answer to one question. */
interface AskUserQuestionAnswerItem {
  /** The answered question id. */
  id: string
  /** Selected option labels. May accompany custom text for a multi-select question. */
  selected: string[]
  /** Optional free-text "Other" answer. */
  custom?: string
}
```

```ts type-equiv
/** The human's answer. */
interface AskUserQuestionAnswer {
  /** Structured answers keyed by question id. */
  answers: AskUserQuestionAnswerItem[]
}
```

## 공급자

컨텍스트에서는 공급자 하나만 활성화할 수 있습니다. 공급자 등록은 effect에 연결되므로 HMR/정리 시 활성 UI가 제거됩니다.

```ts type-equiv
/** UI-side provider for user questions. */
interface UserQuestionProvider {
  ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
}
```

## 오류

`UserQuestionError`은 `HarnessError`을 확장하므로, `ctx.tools.execute()`은 `EMPTY_QUESTIONS`, `NO_PROVIDER`, `ASK_ABORTED` 또는 UI 측 취소와 같은 모델 대면 도구 실패에 대해 `{ name, code }`을 보존합니다.

```ts type-equiv
/** Stable error taxonomy for user-questions failures. */
class UserQuestionError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'UserQuestionError'
  }
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`이 소스에서 생성했으며(doc-sync에서 `pnpm run verify-cordis-catalog`으로 최신 상태를 검증하고, `pnpm run gen-cordis-catalog`으로 다시 생성) 이 섹션은 페이지의 두 언어 버전에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에서 정의하며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxuserquestions--userquestionservice"></a>

### `ctx.userQuestions` — `UserQuestionService`

`ctx.userQuestions`: 활성 UI 공급자 하나와 `ask()` API입니다.

```ts cordis-catalog
/**
 * Register the UI provider. Only one provider may be active in a context.
 *
 * @param provider UI-side implementation that collects answers.
 * @returns Disposer that unregisters this provider.
 */
registerProvider(provider: UserQuestionProvider): () => void

/**
 * Ask the active UI provider and wait for the user's answer.
 *
 * When a caller supplies an agent, human interaction is valid only for the
 * exact live runtime root. Runtime ownership, not durable session lineage,
 * decides this boundary: an owned child has no human answerer and would
 * block forever, while a lineage-bearing session resumed as a new runtime
 * root may ask normally.
 *
 * @param request Questions, owner agent, and abort signal.
 * @returns The answer chosen or typed by the human.
 * @throws {UserQuestionError} code `CALLER_NOT_LIVE` when a supplied
 *   agent is not the registry's exact live instance, or `DELEGATED_CALLER`
 *   when that live agent is owned by another agent.
 */
async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
```

출처: [`packages/interaction/user-questions/src/index.ts:51`](../../packages/interaction/user-questions/src/index.ts)
<!-- END GENERATED cordis-surface -->
