# Cookbook: 확장 플러그인 형태

Harness 확장을 위한 참조 패턴입니다. 스니펫에서는 import와 헬퍼 구현을 생략했으며, 그대로 복사하여 붙여 넣을 수 있는 완전한 예제가 아닙니다. 구체적인 작성 경로는 [패키지 체크리스트](adding-a-package.md), [첫 번째 도구 튜토리얼](../user/develop/basic/tool.md), [도구 레퍼런스](adding-a-tool.md), [LLM 어댑터 가이드](adding-an-llm-adapter.md)를 참조하세요. 시스템 및 확장 지점 맵은 [아키텍처](../architecture.md)에서 다룹니다.

## 도구 플러그인

도구는 `ctx.tools`에 등록됩니다. 주석이 지정된 `defineTool` 예제(형식이 지정된 `execute` 인수, 결과 구성, `run_in_background` 패턴)는 [adding-a-tool.md](adding-a-tool.md)에 있으며, 이 가이드가 도구 정의의 신뢰할 수 있는 기준입니다. 원시 JSON-Schema `ToolDefinition`도 `ctx.tools.register()`에서 직접 허용됩니다(MCP에서 제공되는 도구가 이 방식으로 전달됨). `defineTool`는 자사 도구를 위한 형식화된 헬퍼입니다.

## 훅 플러그인(권한 게이트 예시)

이 권한 게이트는 훅 플러그인의 한 예입니다. 호출을 허용하거나 거부하기 위해 `tools/pre-execute` 게이트에서 형식화된 결정을 반환합니다. 샌드박스, 권한 및 계획 모드 플러그인은 이 확장 지점을 사용할 수 있습니다. 훅 플러그인은 다른 확장 지점을 가로챌 수 있으며 본질적으로 권한 게이트는 아닙니다. "네이티브 훅"은 가로채기 지점에 있는 일반 Cordis 플러그인으로, 외부 프로토콜이 필요하지 않습니다.

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

declare function isAllowed(exec: ToolExecution): Promise<boolean>

export const name = 'permission-gate'

export function apply(ctx: Context) {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (!(await isAllowed(exec))) {
      return { kind: 'deny', reason: 'Denied by policy.' }
    }
    return next()
  })
}
```

이 워터폴은 재정렬 가능한 정책 계층입니다. 불변 조건에 단조적인 최종 거부가 필요하면 `ctx.tools.guard()`를 사용하고, 플러그인이 실제 디스패치 수명 주기를 감싸야 하면 `tools/execute`를 사용하며(timeouts/retries/metrics, 교체할 수 있는 것은 `exec.signal`뿐임), 명시적인 결과 변환에는 `tools/post-execute`를, 불변인 최종 결과를 범위 내에서 관찰하려면 `tools/result`를 사용합니다. 선택 규칙은 [도구 추가 가이드](adding-a-tool.md#execution-policy-and-observation)에 설명되어 있습니다.

## UI 플러그인

UI 플러그인은 `session/event` 피드(`assistant/chunk`로 제공되는 어시스턴트 토큰 스트림과 turn/step 경계 및 도구 활동)를 렌더링하고, `agent.followup()` / `agent.steer()`를 통해 입력을 다시 전달합니다. 기본 제공 Web Client에 비즈니스 행을 제공하는 브라우저 플러그인은 대신 `ConversationNodeDefinition` 및 키가 지정된 Chat 렌더러를 등록합니다. [Conversation Node 가이드](adding-a-conversation-node.md)를 따르세요.

```ts
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

declare function render(text: string): void
declare function onUserInput(handler: (text: string) => void): void

export const name = 'my-ui'
export const inject = ['agents']

export function apply(ctx: Context) {
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'assistant/chunk' && event.data.chunk.type === 'text-delta') {
      render(event.data.chunk.text)
    }
  })
  onUserInput(text => ctx.agents.get(SessionId('client-session'))?.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })))
}
```

## 외부 프로토콜 드라이버

*프로토콜 드라이버* 는 wire 피어를 `ctx.agents`에 맞게 어댑트하며, UI 또는 자동화 클라이언트에 서비스를 제공할 수 있습니다. stdio 드라이버는 stdout을 소유하고, 팩토리를 통해 에이전트를 생성하거나 재개하며, 프로토콜 요청을 `followup()` 또는 `cancel()`에 매핑합니다. 저수준 프롬프트 요청은 영속적인 대기열 등록 영수증을 반환하며, `MessageId`와 `turn/end`를 연관 지어 결과를 획득하지 않습니다. 전체 에이전트 상태는 별도로 게시하세요. 자동화 메서드는 영수증부터 다음 유휴 상태까지 기다린 후 명시적으로 소유한 해당 구간을 요약할 수 있지만, UI는 일반적으로 종료되지 않는 이벤트 스트림을 계속 관찰합니다. 정리가 정지 상태에 도달하도록 `AgentHandle.dispose()`로 에이전트를 종료하세요.

[`packages/acp/acp`](../../packages/acp/acp)은 자동화 전용의 동작 예제입니다. Agent Client Protocol JSON-RPC stdio를 통해 새 텍스트 세션을 노출하고, 확정된 어시스턴트 텍스트를 내보내며, 소유한 에이전트에 대해 일회성 머신 권한 응답기를 등록합니다. [README](../../packages/acp/acp/README.md)에는 정확한 메서드, 이벤트 순서 및 수명 주기 계약이 정의되어 있습니다.

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-protocol-bridge'
export const inject = ['agents', 'sessions', 'sessionPersistence']

export function apply(ctx: Context) {
  // Stream every logged assistant text/reasoning delta out to the client.
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'assistant/chunk') {
      const chunk = event.data.chunk
      if (chunk.type === 'text-delta') {
        // sendToClient({ kind: 'message_chunk', text: chunk.text })
      }
    }
  })
  // Inbound "prompt": create/resume an agent, feed it, and return its enqueue receipt.
  // Whole-agent status is a separate notification; no turn end belongs to this prompt.
  // Teardown reaches quiescence via AgentHandle.dispose() (stop + await exit).
}
```

## 실행 가능한 연결 구성

실행 가능한 리프는 `examples/*/cordis.yml`에서 플러그인 트리를 로드합니다. 루트 `demo:*` 스크립트와 해당 리프 디렉터리가 신뢰할 수 있는 인벤토리입니다. 제품 `dsh` 런처는 Web 및 일회성 헤드리스 실행을 소유하고, ACP 리프는 [`@deepseek-ai/dsh-acp-demo`](../../packages/examples/acp-demo)를 사용하며, JSON-RPC 리프는 [`@deepseek-ai/dsh-sdk-jsonrpc-demo`](../../packages/examples/jsonrpc-demo)를 사용합니다. 헤드리스 스냅샷 리프는 [`@deepseek-ai/dsh-agent-spine-demo`](../../packages/examples/agent-spine-demo) 및 JSONL 영속성을 명시적으로 마운트한 다음, 배포된 앱 패키지가 아니라 예제 소유의 테스트 픽스처를 통해 이를 구동합니다.

## 기능 → 메커니즘 맵

모든 제품 기능은 문서화된 확장 지점의 리스너에 매핑됩니다. 이는 검증 가능하게 만든 마이크로커널의 주장입니다([마이크로커널 Agent Note](../../.agents/notes/implemented/architecture/2026-06-11-microkernel-event-taxonomy.md)). 어떤 행도 루프를 수정하지 않습니다.

`system-prompt/assemble`은 전문가용 협력형 전체 어셈블리 변환입니다. 반환된 어셈블리가 권위 있으므로, 리스너 작성자는 활성 Code Mode 및 구조화된 출력 프로토콜 기여를 보존할 책임이 있습니다. 프레젠테이션, 조회 및 실행 전반에서 일관성을 유지해야 하는 도구 필터링에는 `ctx.tools.restrict()`를 사용하는 것이 좋습니다.

| 제품 기능 | 플러그인 메커니즘 |
|---|---|
| Hook 시스템(사용자 + 프로젝트 수준) | `agent/session-start`, `agent/pre-step`, `agent/request`, `tools/pre-execute`, `tools/post-execute` 및 `agent/turn-stopping`의 리스너입니다. 폭포식 흐름은 타입이 지정된 결정을 반환하며, `agent/turn-stopping`는 다른 단계를 조정할 수 있습니다. `dsh-hooks-claude-code` / `dsh-hooks-codex` 브리지는 Hook 구성 파일을 이러한 확장 지점에 매핑합니다. |
| `/goal` | `ctx.goals`는 영속 상태를 소유하고, `dsh-goal-round-driver`는 공개 `Agent`를 통해 동일 세션의 라운드를 예약하며, 별도의 명령/도구 생성자가 사람/모델 제어를 노출합니다. |
| `/loop` | `turn/end` 세션 이벤트에서 다음 반복을 `followup()`하거나, 강제로 계속 진행합니다. |
| 동적 워크플로 | `ctx.workflowEngine` + 워커 스레드 엔진 + `workflow` 도구입니다. 구조화된 프로세스 내 자식은 범위가 지정된 프롬프트/도구 등록, 단조 도구 가드, 최종 `tools/result` 커밋(포함하는 `run_code` 포함), 구조화된 출력 실행의 단조 `concludeTurn()` 마커로 출력을 강제합니다. |
| 대기열 + 조정 메시지 | 핵심 `Agent.followup()` / `Agent.steer()` |
| 컨텍스트 압축(자동 + 수동) | `ctx.compaction` 이음새 + `dsh-compaction-basic`입니다. 자동 압력은 직렬 `agent/pre-step`에서 실행되고, 표준 오버플로 복구는 `agent/request-error`에서 실행되며, 수동 호출자는 동일한 압축 서비스를 사용합니다([압축 Agent Note](../../.agents/notes/implemented/feature/2026-06-18-compaction-capability-seam.md)). |
| 시스템 프롬프트 구성 가능성 | 순서 지정 및 범위 로컬 섀도잉을 사용하는 `ctx.systemPrompt.section()`입니다. |
| AGENTS.md(루트) | 파일을 읽는 섹션 제공자입니다. |
| AGENTS.md(하위 디렉터리, 터치 시) + 파일 변경 알림 | 감시자 / 도구 결과 리스너의 `agent.inject()`입니다. |
| 기본 제공 도구 | `ctx.tools.register()`입니다. 스키마는 어셈블리에 자동으로 전달됩니다. `dsh-tool-*` 계열(bash, fs, web, subagent, todo)이 제공되는 예시입니다. |
| ToolSearch / 점진적 공개 | 표시되는 집합이 변경될 때 범위가 지정된 `ctx.tools.restrict()` 등록을 교체합니다. 레지스트리는 표시, 조회, 실행을 일치된 상태로 유지합니다. |
| 도구 마감 시간 / 재시도 / 메트릭 | `tools/execute`로 핵심 디스패치를 래핑합니다. 래퍼는 하나의 어휘적 수명 내에서 `exec.signal`를 교체하고, 위임하며, 정규화된 결과를 검사할 수 있습니다. |
| 최종 도구 결과 메트릭 / 감사 / 캡처 | `tools/result`로 변경 불가능한 권위 있는 결과를 관찰합니다. 플러그인이 결과를 변환하거나 컨텍스트를 연결해야 하는 경우에만 대신 `tools/post-execute`을 사용합니다. |
| 단조 종료 턴 정책 | 성공한 종료 도구에서 `ToolExecution.concludeTurn()`를 호출합니다. 동일 응답의 이후 도구 호출은 계속 가드할 수 있으며, 루프는 단계 후 중지됩니다. |
| 하위 프로세스 샌드박스(landlock / sandbox-exec) | `dsh-bash-sandbox`를 통해 `ctx.sandbox` 백엔드를 사용합니다. 기능 수준의 거부에는 `tools/pre-execute`를 사용합니다. |
| 권한 시스템 / AskUserQuestion | `tools/pre-execute`에서 `ask`를 반환하고 `ctx.approval`를 통해 응답합니다. 일반 사용자 질문에는 별도의 모델용 질문 도구를 등록합니다. |
| 계획 모드 | [`@deepseek-ai/dsh-plan-mode`](../../packages/plan/plan-mode/README.md) — 기록되는 `plan/mode` 상태, `plan:policy` 안내 섹션, `/plan [message]` 진입, `/plan off` 직접 종료 및 사용자가 검토하는 `exit_plan_mode` 종료입니다. 강제 적용은 독립적인 샌드박스/승인 축에 유지됩니다. |
| 하위 에이전트 위임 | `ctx.subagents` 제공자 레지스트리(`dsh-subagent-spawn-in-process`/`-fork`/`-acp`/`-codex`/`-claude-code`/`-dsh-sdk`) + 하나의 구성된 제공자를 모델에 노출하는 `dsh-tool-subagent`입니다. |
| MCP | 서버당 하나의 플러그인: 도구 검색 → `ctx.tools.register()` |
| 스킬 | 섹션 + 도구 등록, 호출 시 `inject()` 스킬 콘텐츠입니다. |
| 메모리 | 섹션 제공자 + 도구 |
| 예약 작업(cron) | 플러그인이 모델 호출 가능 예약 도구를 등록합니다. 타이머 실행 → 유휴 상태에서는 `followup(…, {source: {kind: 'cron', …}})` / 사용 중일 때는 `inject()` 알림입니다. |
| UI(GUI, CLI는 JSONL 출력) | `session/event`(assistant 청크, 경계, 도구 활동)를 수신합니다. 입력 → `followup()` |
| Web Client Chat 비즈니스 노드 | `ConversationNodeDefinition` 및 `conversation.chat.node` 키 기반 렌더러를 등록합니다. |
| SessionTelemetryBackend / 재생 가능한 추적 | `session/event` → JSONL, 재생 = `sessions.create(id, { seed })` |
| 모델 어댑터 | `registerAdapter`를 통한 `LlmAdapter` 하위 클래스(`dsh-llm-deepseek`, `dsh-llm-pi-ai`) |
| 플러그인 핫 리로드 | 모든 등록은 `ctx.effect`입니다 → 벤더 제공 HMR이 그대로 작동합니다. |
