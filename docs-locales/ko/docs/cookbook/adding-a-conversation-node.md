# Web Client 대화 노드 추가

이 튜토리얼에서는 Web Client Chat 뷰에 비즈니스 소유 행 하나를 추가합니다. 완성된 플러그인은 영속적인 Session 이벤트 패밀리를 하나의 Context로 연관 짓고, 비즈니스 State를 점진적으로 구축하며, 타입이 지정된 Step 데이터를 게시하고, Session 창이나 다른 렌더링된 노드를 탐색하지 않고 키가 지정된 Chat Node를 렌더링합니다. Host가 이미 이벤트를 기록하고 클라이언트 플러그인이 Web 번들에 구성되어 있다고 가정합니다. 외부 Host 측 UI와 Trajectory 같은 추가 뷰 대상은 이 튜토리얼의 범위에 포함되지 않습니다.

[Conversation Node 조립 결정](../../.agents/notes/implemented/architecture/2026-08-09-client-conversation-node-assembly.md)에는 근거와 전체 엔진 모델이 포함되어 있습니다. 이 가이드에서는 구현 경로를 다룹니다.

## 1. 재생 가능한 이벤트 패밀리 설계

Definition을 작성하기 전에 안정적인 비즈니스 id 하나를 선택합니다. 동일한 Node에 기여하는 모든 이벤트는 해당 id를 포함하거나 자체 페이로드에서 독립적으로 이를 파생해야 합니다. 클라이언트는 업데이트를 “가장 최근에 완료되지 않은” Context에 할당해서는 안 됩니다.

검토 작업의 이벤트 계약은 다음과 같을 수 있습니다.

| 이벤트 | 역할 | 필요한 영속적 사실 |
|---|---|---|
| `review/start` | 고유한 시작 | `reviewId`, Turn/Step 좌표, 제목 |
| `review/progress` | 업데이트 | 동일한 `reviewId`, 좌표, 재생 가능한 진행 상태 |
| `review/end` | 업데이트 | 동일한 `reviewId`, 좌표, 최종 요약 |

프로세스 경계 전반에서 생산자 소유의 브랜드 id 타입을 사용합니다. `SessionEventMap` 병합과 페이로드 타입은 생산자의 타입 전용 내보내기에 두고, 클라이언트 패키지에서 부수 효과를 위해 해당 내보내기를 가져옵니다. 각 `(kind, id)`에는 시작 이벤트가 최대 하나만 있을 수 있습니다. 단일 이벤트 비즈니스는 `event.seq` 같은 이벤트의 안정적인 식별자를 Definition 로컬 id로 사용할 수 있습니다.

점진적 이벤트가 지원됩니다. 생산자가 저렴하게 생성할 수 있다면 전체 값 체크포인트를 우선 사용하세요. 시작 이벤트가 로드된 창 밖에 있을 때도 유용하기 때문입니다. 각 델타는 안정적인 id를 포함해야 하며, 오름차순 로그 `seq`로 재생될 때 결정적인 State를 생성해야 합니다. 라이브 전용 메모리에 의존해서는 안 됩니다. 현재 히스토리 창에 업데이트만 포함되어 있으면 조립기는 보류 중인 Context를 유지하고, 이전 페이지에서 시작 이벤트가 제공될 때까지 State를 구축하지 않습니다. 시작 이벤트가 로드되기 전에 제품에서 렌더링해야 한다면, 종료 또는 체크포인트 이벤트는 Definition이 해당 결과를 직접 구축할 수 있도록 충분한 전체 대체 상태를 포함해야 합니다. 관련 없는 이벤트를 탐색하여 이를 복구하지 마세요.

## 2. Definition 및 타입이 지정된 Chat 페이로드 구현

이 예제에서는 전체 관계를 확인할 수 있도록 생산자 선언과 클라이언트 기여를 하나의 블록에 둡니다. 패키지 패밀리에서는 브랜드 id와 `SessionEventMap` 선언을 이벤트 생산자와 함께 두고, Definition, Chat 데이터 병합, 렌더러는 클라이언트 플러그인에 둡니다.

```ts ignore-check
import { createElement } from 'react'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type {
  ClientContext, ConversationLocation, ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

type ReviewId = Branded<'ReviewId'>

interface ReviewStartData {
  readonly reviewId: ReviewId
  readonly turn: number
  readonly step: number
  readonly title: string
}

interface ReviewProgressData {
  readonly reviewId: ReviewId
  readonly turn: number
  readonly step: number
  readonly completed: number
}

interface ReviewEndData {
  readonly reviewId: ReviewId
  readonly turn: number
  readonly step: number
  readonly summary: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Opens one durable review job.
     * @mode emit
     * @param data - stable identity, location, and initial display state.
     */
    'review/start': ReviewStartData
    /**
     * Records replayable progress for one review job.
     * @mode emit
     * @param data - stable identity, location, and latest progress.
     */
    'review/progress': ReviewProgressData
    /**
     * Closes one review job with its final summary.
     * @mode emit
     * @param data - stable identity, location, and final display state.
     */
    'review/end': ReviewEndData
  }
}

interface ReviewChatData {
  readonly title: string
  readonly completed: number
  readonly status: 'running' | 'completed'
  readonly summary?: string
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'review-job': ReviewChatData
  }
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationStepDataMap {
    'review-job': ReviewChatData
  }
}

interface ReviewState extends ReviewChatData {
  readonly turn: number
  readonly step: number
}

function locationOf(context: ConversationNodeContext): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

function viewData(state: ReviewState): ReviewChatData {
  return {
    title: state.title,
    completed: state.completed,
    status: state.status,
    ...state.summary === undefined ? {} : { summary: state.summary },
  }
}

const reviewDefinition: ConversationNodeDefinition<ReviewState> = {
  kind: 'review-job',
  target: 'chat',
  match: (event) => {
    if (event.type === 'review/start') {
      return { id: String(event.data.reviewId), role: 'start' }
    }
    if (event.type === 'review/progress' || event.type === 'review/end') {
      return { id: String(event.data.reviewId), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'review/start') throw new Error('review-job requires review/start')
    return {
      turn: match.event.data.turn,
      step: match.event.data.step,
      title: match.event.data.title,
      completed: 0,
      status: 'running',
    }
  },
  update: (context, match) => {
    if (match.event.type === 'review/progress') {
      return { ...context.state, completed: match.event.data.completed }
    }
    if (match.event.type === 'review/end') {
      return { ...context.state, completed: 100, status: 'completed', summary: match.event.data.summary }
    }
    return context.state
  },
  publication: match => match.event.type === 'review/progress'
    ? 'animation-frame'
    : 'immediate',
  buildLocationData: (context, scope) => {
    if (scope !== 'step' || context.state === undefined) return null
    return {
      kind: 'step',
      turn: context.state.turn,
      step: context.state.step,
      key: 'review-job',
      value: viewData(context.state),
    }
  },
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'review-job',
      id: context.id,
      target: 'chat',
      anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
      location: locationOf(context),
      visibility: 'visible',
      data: viewData(context.state),
    }
  },
}

function ReviewNodeView({ node }: ChatNodeViewProps<'review-job'>) {
  const text = node.data.summary ?? `${node.data.title}: ${node.data.completed}%`
  return createElement('p', null, text)
}

export const inject = ['conversationEvents', 'slots']

export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(reviewDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'review-job',
  }, ReviewNodeView))
}
```

`match(event)`는 폴드가 아니라 식별자 추출기입니다. 현재 이벤트만 받아 Definition 로컬 id와 수명 주기 역할을 반환합니다. 일치한 후 어셈블러는 `(kind, id)`로 Context를 찾아 `start`를 한 번 호출하거나 현재 State와 함께 `update`를 호출합니다. 두 함수는 엔진이 채택하는 State를 반환합니다. 새 불변 값을 반환하는 방식을 권장하지만, 동일한 객체를 변경하고 반환하는 함수도 동일한 채택 의미를 가집니다.

`buildLocationData(context, scope)`는 선택적으로 Definition 소유 데이터를 엔진 소유 Turn 또는 Step에 게시합니다. 선언 병합을 사용하여 각 키에 정확한 값 타입을 부여합니다. 같은 Location의 다른 Node는 Session을 받거나 `snapshot.chat.nodes`를 검색하지 않고도 `useTurnData(key)`와 같은 제한된 슬롯 훅을 통해 해당 값을 사용할 수 있습니다.

`target`와 `buildViewNode(context)`는 대상 소유 렌더링 기여 하나를 선언하며 함께 나타나야 합니다. `context.key`는 React 측 식별자로 유지하고, `anchorSeq`는 지속 가능한 정렬 근거에서 선택하며, 렌더러 준비가 된 데이터만 반환합니다. 대상 Node가 게시된 후에는 동일한 키를 계속 반환합니다. `null`로 철회하는 대신, 일시적으로 표시 흐름에서 벗어나야 할 때는 `visibility: 'hidden'`를 사용합니다.

## 3. 시작 시에만 이전 비즈니스 Context 쿼리

일부 Definition에는 다른 비즈니스 종류의 가장 최근 이전 State가 필요합니다. `start`는 `ConversationContextReader`를 받습니다. Context 컬렉션을 받거나 이벤트를 검색하는 대신 այնտեղ에서 `reader.previous<State>(kind)`를 호출합니다. 리더는 현재 시작 `seq` 이전에 시작된 가장 가까운 Context를 읽기 전용 데이터로 반환합니다.

어셈블러는 해당 종속성을 기록합니다. 이후 더 오래된 prepend가 더 가까운 선행 항목을 제공하거나, 이전에 알 수 없던 윈도우 간격을 닫거나, 선행 State를 수정하면 `start`부터 종속 Context를 다시 실행하고 해당 업데이트를 오름차순 `seq`으로 재생합니다. 쿼리된 Definition은 유용한 State를 작성할 책임이 있습니다. 리더는 비즈니스별 쿼리 메서드를 노출하지 않으며 다른 Context에 대한 변경 권한도 부여하지 않습니다.

## 4. 세 가지 수집 경로 이해하기

기록은 한 번에 한 페이지씩 끝에서부터 역방향으로 요청할 수 있지만, 수락된 모든 페이지는 State 재생 전에 오름차순 `seq`으로 정규화됩니다.

| 경로 | 엔진 작업 | Definition에 표시되는 동작 |
|---|---|---|
| 열기, 재동기화 또는 간격 복구 시 교체 | 로드된 윈도우를 다시 빌드하고, 각 Definition에 대해 모든 이벤트를 한 번씩 일치시킨 후, 시작된 각 Context를 재생합니다 | `start`, 그 뒤 업데이트를 오름차순 `seq`으로 재생합니다. 보류 중인 업데이트 전용 Context는 State 없이 유지됩니다 |
| 이전 페이지 하나 prepend | 새로 추가된 이전 이벤트만 일치시키고, `(kind, id)`로 Context에 병합하며, 기존 키 지정 노드를 유지하고, 영향을 받은 Context와 종속성만 재생합니다 | 새로 발견된 시작은 수집된 업데이트를 활성화하며, 변경된 Location 또는 선행 항목은 Context를 다시 실행할 수 있습니다 |
| 실시간 이벤트 하나 append | 각 Definition의 `match`를 한 번 호출하고, 키로 일치한 Context를 조회하여 해당 Context만 업데이트합니다 | 시작 후 일치 이벤트마다 `update` 하나와 요청된 게시 하나가 수행되며, 기존 Context 검색은 없습니다 |

등록된 Definition이 `D`개일 때, 들어오는 이벤트 하나는 현재 이벤트 일치를 `D`번 수행하고 일치 후 상수 시간으로 Context 키를 조회합니다. Definition 코드는 이 특성을 유지해야 합니다. 일반 append 경로에서 전체 이벤트 윈도우, 모든 Context, `context.matches` 또는 렌더링된 Node 컬렉션을 순회하지 마세요. 누적된 사실에는 State를 사용하고, 같은 Turn/Step 공유에는 Location 데이터를 사용하며, 인덱싱된 선행 항목 종속성에는 `reader.previous()`를 사용합니다.

`publication`는 변경된 State가 구체화되는 시점을 제어합니다. 구조적 또는 종료 변경에는 `immediate`를 사용하고, 고빈도 표시 델타에는 `animation-frame`를 사용하며, State 변경이 이후 게시만 제공할 때는 `none`를 사용합니다. 엔진은 여전히 로그 순서대로 모든 업데이트를 적용합니다. 주기는 뷰 게시만 병합합니다.

## 5. 재생, 페이지네이션 및 렌더링 검증하기

다음 결과를 확립하는 집중 테스트를 추가합니다.

1. 교체를 통해 전달된 완전한 윈도우는 예상한 최종 State, Location 데이터, Node 페이로드 및 `anchorSeq`를 생성합니다.
2. 업데이트 전용 꼬리 부분은 보류 상태로 유지되며, 고유한 시작을 prepend하면 완전한 교체와 동일한 결과를 생성합니다.
3. 초기 기록 뒤에 실시간 append를 수행하면 결합된 윈도우를 재생한 것과 동일한 결과를 생성합니다.
4. 이전 페이지를 prepend하면 데이터가 변경되지 않은 기존 키 지정 Node 값을 교체하지 않고 더 이른 행을 추가합니다.
5. 반복되는 표시 델타는 `context.key`를 보존하며, 요청된 경우 애니메이션 프레임당 최대 한 번 게시합니다.
6. 키 지정 렌더러는 `node.data`와 제한된 Location 훅만 사용합니다. Session 이벤트 윈도우, Context 또는 Chat Node를 검색하지 않습니다.

스트리밍 및 중단에는 [`packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts`](../../packages/client/ui-conversation/src/client/conversation-nodes/assistant.ts)를 사용하고, 선행 항목 쿼리에는 [`inbox.ts`](../../packages/client/ui-conversation/src/client/conversation-nodes/inbox.ts)와 [`message.ts`](../../packages/client/ui-conversation/src/client/conversation-nodes/message.ts)를 사용하며, 자체 Node를 생성하지 않고 Turn 데이터를 게시하는 Definition에는 [`packages/client/ui-deliverables`](../../packages/client/ui-deliverables)를 사용합니다.
