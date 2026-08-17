# 세션 참조

구조화된 세션 간 참조 요청과 준비된 메시지 컨텍스트입니다. [패키지 계약](../../packages/context/session-reference)은 정식 URI, 현재 화면 프로젝션, 태그 안전 JSON 및 바이트 보존, 안정적인 오류, 신뢰할 수 없는 모델 프롬프트를 정의합니다. 호스트 어댑터는 UI 멘션 구문을 에이전트 코어에 전달하는 대신 이러한 타입을 사용합니다.

출처: [`packages/context/session-reference/src/types.ts`](../../packages/context/session-reference/src/types.ts)

## 입력 및 후보

`SessionReferenceInput`은 호스트 독립적인 선택 항목입니다. id가 권한 있는 값이며, label은 스냅샷에 포함되는 표시 메타데이터입니다.

```ts type-equiv
/** One source session selected by a host. */
interface SessionReferenceInput {
  /** Opaque source session identity. */
  sessionId: SessionId
  /** Optional user-facing mention label. */
  label?: string
}
```

`SessionReferenceCandidate`은 호스트용 탐색 출력입니다. label은 존재하는 경우 최신 세션 제목을 사용하지만, 필터링은 여전히 세션 id와 cwd만 검색하며 트랜스크립트 텍스트는 절대 검색하지 않습니다.

```ts type-equiv
/** One host-facing candidate from exact session metadata. */
interface SessionReferenceCandidate {
  /** Opaque source session identity. */
  sessionId: SessionId
  /** Latest log-backed title, falling back to the opaque session id. */
  label: string
  /** Source session working directory, when recorded. */
  cwd?: string
  /** Source session creation time in Unix epoch milliseconds. */
  createdAt: number
}
```

## 준비된 메시지

준비 과정은 읽기 쉬운 현재 메시지 콘텐츠를 보존하고 집계된 컨텍스트를 최대 하나 반환합니다.

```ts type-equiv
/** Direct message content and optional referenced-session context. */
interface PreparedReferencedMessage {
  /** Readable message content after host mention tokens are removed. */
  content: ContentBlock[]
  /** Aggregated untrusted snapshot, absent when the message has no references. */
  additionalContext?: UserMessage
}
```

## 오류

`SessionReferenceError.code`은 잘못된 설정 또는 입력, 자체 참조, 개수 제한, 소스 읽기 실패, 예산 실패 및 취소를 구분합니다. 호스트 프로토콜은 프롬프트 바이트를 검사하지 않고 이 코드를 자체 오류 엔벨로프에 매핑합니다.

```ts type-equiv
/** Stable failure codes exposed to host adapters. */
type SessionReferenceErrorCode =
  | 'SESSION_REFERENCE_INVALID_CONFIG'
  | 'SESSION_REFERENCE_INVALID_REFERENCE'
  | 'SESSION_REFERENCE_SELF_REFERENCE'
  | 'SESSION_REFERENCE_TOO_MANY'
  | 'SESSION_REFERENCE_READ_FAILED'
  | 'SESSION_REFERENCE_BUDGET_EXCEEDED'
  | 'SESSION_REFERENCE_CANCELLED'
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`이 소스에서 생성했으며(doc-sync에서 `pnpm run verify-cordis-catalog`으로 최신 상태를 확인하고, `pnpm run gen-cordis-catalog`으로 다시 생성) 이 섹션은 페이지의 두 언어 측면에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxsessionreferenceresolver--sessionreferenceresolver"></a>

### `ctx.sessionReferenceResolver` — `SessionReferenceResolver`

불변 세션 간 메시지 컨텍스트를 준비하는 정확 읽기 소비자입니다.

```ts cordis-catalog
/**
 * List reference candidates, ranked by working-directory affinity.
 * @param agent - target agent; self is excluded and its cwd drives ranking.
 * @param query - optional case-insensitive session-id/cwd/title substring.
 * @param limit - optional positive result cap.
 * @param signal - optional cancellation boundary for host autocomplete teardown.
 * @returns candidates labeled by latest title or, when absent, session id.
 */
async listCandidates( agent: Agent, query: string = '', limit: number = this.config.candidateLimit, signal?: AbortSignal, ): Promise<SessionReferenceCandidate[]>

/**
 * Snapshot all references before enqueue and return one aggregated durable context.
 * @param agent - target agent; references to it are rejected.
 * @param content - already host-normalized readable message content.
 * @param references - structured source sessions in mention order.
 * @param signal - optional cancellation boundary for host request teardown.
 * @returns detached content and optional referenced-session context.
 */
async prepare( agent: Agent, content: ContentBlock[], references: SessionReferenceInput[], signal?: AbortSignal, ): Promise<PreparedReferencedMessage>
```

타입: [Agent](core.md) · [ContentBlock](llm-streaming.md)

출처: [`packages/context/session-reference/src/index.ts:70`](../../packages/context/session-reference/src/index.ts)
<!-- END GENERATED cordis-surface -->
