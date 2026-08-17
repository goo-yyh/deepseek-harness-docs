# DeepSeek Harness 아키텍처

`packages/` 아래의 내용을 변경하기 전에 이 문서를 읽으세요. Cordis를 알고 있다고 가정합니다. 모른다면 [입문서](cordis-primer.md) 또는 [튜토리얼](cordis-tutorial/index.md)부터 시작하세요.

에이전트를 사용하여 코드베이스를 탐색하고 아키텍처를 이해하는 것을 권장합니다.

## Cordis

[Cordis](cordis-primer.md)는 dsh의 기반 프레임워크입니다. 플러그인은 공유 컨텍스트에 서비스, 타입이 지정된 이벤트, 되돌릴 수 있는 효과를 제공합니다. 모델 어댑터, 도구 레지스트리, 세션 로그, 에이전트 루프 자체를 포함하여 제품의 모든 부분이 플러그인이므로, 모든 부분을 설정으로 교체할 수 있습니다.

패치할 특권 코어는 없습니다. 다른 플러그인 옆에 플러그인을 마운트하여 dsh를 확장하며, 등록은 해당 플러그인이 언로드될 때 되돌아가는 효과입니다.

## 프로필과 번들

실행 중인 `dsh`은 부팅 시 정렬된 레이어에서 조합되는 플러그인 트리입니다.

**프로필** 은 Harness 홈에 저장되는 이름 있는 구성입니다. 쌓을 번들을 나열하고, 설치하는 트리 외부 플러그인을 보관하며, 사용자의 `cordis.patch.yml`을 유지합니다. `web` 및 `headless`은 템플릿으로 제공됩니다.

**번들** 은 Cordis 설정 행과 이를 마운트하는 코드의 배포 형식이므로, 삽입하는 모든 항목은 그 위 레이어에서 계속 패치할 수 있습니다.

각각은 자체 `package.json`에서 `dsh` 필드 아래에 선언됩니다. `dsh.profile`은 프로필의 번들을 나열하고, `dsh.bundle`은 번들의 패치 파일을 가리킵니다.

[`dsh-base`](../packages/bundle/base/README.md)은 모든 프로필의 첫 번째 레이어입니다. 모델 어댑터, 도구, 영속성, 샌드박스 및 승인 정책, 설정, 자격 증명, 텔레메트리를 제공합니다. [`dsh-web-app`](../packages/bundle/web-app/README.md)은 브라우저 애플리케이션을 추가하며, [`dsh-headless`](../packages/bundle/headless/README.md)은 서버가 전혀 없는 일회성 실행기를 추가합니다.

레이어는 빈 항목 목록에 다음 순서로 적용됩니다. 프로필에 나열된 순서의 각 번들, 프로필의 `cordis.patch.yml`, 홈 수준의 항목, 그리고 모든 `--patch` 오버레이입니다. 패치는 id로 행을 대상으로 지정하여 전체 설정을 교체하거나 새 행을 삽입합니다.

실제로 컴퓨터가 부팅하는 트리를 확인하려면 다음을 실행하세요.

```sh
dsh --profile web --dump-config
```

출력되는 모든 행은 자체 패치로 교체할 수 있습니다.

구성 메커니즘은 [app-boot](../packages/boot/app-boot/README.md#profiles)에 있고, 설정 필드는 생성된 [설정 카탈로그](config-catalog.md)에 있습니다.

## 핵심 패키지

다음은 Cordis 트리에 기여하는 몇 가지 핵심 패키지입니다.

| 패키지 | 담당 항목 | `ctx` 키 |
|---|---|---|
| [`core/session`](subsystems/session.md) | 추가 전용 `SessionEvent` 로그 및 메모리 내 저장소 | `ctx.sessions` |
| [`core/system-prompt`](subsystems/system-prompt.md) | 프롬프트 섹션 및 도구 스키마 조립 | `ctx.systemPrompt` |
| [`core/tools`](subsystems/tools.md) | 범위가 지정된 도구 레지스트리 및 보호된 실행 파이프라인 | `ctx.tools` |
| [`core/agent`](subsystems/core.md) | `Agent` 인터페이스, 라이브 레지스트리 및 `agent/*` 이벤트 | `ctx.agents` |
| [`core/agent-loop`](subsystems/core.md) | 해당 인터페이스를 구현하는 기본 드라이버 | `ctx.agentLoop` |
| [`core/scope`](subsystems/scope.md) | 에이전트별 범위 등록 기본 요소 | 라이브러리, 키 없음 |
| [`llm/llm`](subsystems/llm-streaming.md) | 메시지 및 스트림 어휘와 어댑터 접점 | `ctx.llm` |

## 이벤트

이벤트는 확장 지점이며, 대부분의 변경에서 올바른 도메인을 선택하는 일이 첫 번째 결정입니다.

- **세션 이벤트** 는 로그에 추가되고 `session/event`을 통해 브로드캐스트되는 지속 가능한 사실입니다. 새로고침 후에도 사실이 남아야 할 때 사용하세요.
- **에이전트 이벤트** (`agent/*`)는 라이브 `Agent`을 전달합니다. 받은편지함, 단계, 상태, 요청, 검증, 계속 처리입니다. 진행 중인 작업을 관찰하거나 가로채려면 사용하세요.
- **기능 이벤트** 는 루프를 가져오지 않고 정책과 어댑터를 접점(`fs/*`, `tools/*`, `telemetry/*`)에 연결합니다.

[이벤트 맵](event-producer-consumer.md)에는 모든 이벤트의 생산자와 소비자가 나열되어 있습니다.

## 턴 흐름

**단계** 는 하나의 모델 요청과 이 요청이 호출하는 도구입니다. **턴** 은 0개 이상의 단계입니다. 첫 입력이 확보되기 전에 열리고, 더 이상 처리할 항목이 없으면 닫힙니다.

```text
turn/start
  claim next-step input plus one queued message
  assemble prompt sections + tool schemas
  -> agent/pre-step                   reject | enter(messages)
     reject, or a first enter rewritten empty -> close the turn with no step
     step/start
     append entered messages as user/message
     derive model history from the log
     agent/request -> llm/stream -> assistant/chunk* -> assistant/message
     tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
     step/end
     tools owe another request, or next-step input arrived -> claim -> next step
  -> agent/turn-stopping
turn/end
```

`turn/*`, `step/*`, `user/message`, `assistant/*` 및 `tool/*`은 지속 가능한 세션 이벤트이며, 나머지는 세 도메인에 걸친 라이브 확장 지점입니다. `agent/pre-step`, `agent/request`, `llm/stream` 및 세 개의 `tools/*` 이벤트는 리스너가 위임을 위해 `next()`을 호출해야 하는 폭포식 이벤트입니다. `agent/turn-stopping`은 직렬이며 `next()`이 없습니다.

입력은 하나의 받은편지함을 통해 드라이버에 도달합니다. 일부 메시지는 즉시 드라이버를 깨우며, 주입된 컨텍스트는 다른 메시지가 도착할 때까지 받은편지함에서 대기합니다.

`agent/pre-step`은 모델이 보는 내용을 결정합니다. 리스너는 확보된 메시지를 다시 작성하거나 완전히 거부할 수 있습니다. 거부되거나 비어 있는 첫 번째 확보도 단계를 전혀 사용하지 않은 지속 가능한 턴을 닫으므로, 로그에 시도가 기록됩니다. 각 단계는 플러그인이 등록한 프롬프트 섹션과 도구 스키마를 읽습니다.

세부 정보: [시퀀스 다이어그램](agent-lifecycle.md), [도구 파이프라인](tool-execution-pipeline.md) 및 [취소 및 오류 복구](subsystems/core.md#the-agent-handle)를 참조하세요.

## 세션 로그

세션 로그는 모델이 보는 컨텍스트의 원본입니다. `deriveMessages()`은 여기에서 모델 이력을 투영하고, 원시 `assistant/chunk` 이벤트는 재생과 UI 충실도를 보존합니다. 포크, 재개, 대화 기록, 텔레메트리 및 영속성은 모두 이 스트림에서 파생됩니다.

**모델에 표시되는 것은 기록됩니다.** 모델 요청에 도달하는 모든 항목은 로그에서 재구성할 수 있어야 하며, 런타임 불변 조건이 이를 보장합니다. 따라서 새 모델 표시 입력에는 새 세션 이벤트가 필요합니다. `SessionEventMap`을 확장하고 로그에서 렌더링하세요.

## 기능 접점

**접점** 은 교체 가능한 기능으로, 세 가지 역할이 있습니다. 인터페이스를 선언하는 **서비스 정의** , 이를 구현하는 **서비스 제공자** , 그리고 이를 사용하는 **소비자** 이며, 흔히 모델 지향 도구입니다. 패키지는 역할을 결합할 수 있지만 역할 하나만으로는 접점이 아닙니다. 기능을 추가하려면 세 가지 모두를 설계해야 합니다([기능 그래프](capability-seams.md)).

접점 덕분에 제공자 하나를 교체하면 전체 제품이 바뀝니다. 파일 시스템 및 하위 프로세스 제공자는 하나의 실행 세계를 공유하므로, 이를 원격 샌드박스로 지정하면 제공자 포크 없이 Bash, PTY 및 LSP가 함께 이동합니다. [하위 에이전트 제공자](subsystems/subagent.md)도 하나의 인터페이스 뒤에서 새 자식 에이전트부터 다른 제품의 위임된 턴까지 매우 다양하게 구성됩니다.

## 새 동작의 위치

새 동작은 문서화된 확장 지점에 연결됩니다. 루프 자체를 변경하면 이 맵이 업데이트됩니다.

| 목표 | 메커니즘 |
|---|---|
| 모델 제공자 추가 | `ctx.llm`에 어댑터 등록 |
| 모델 지향 기능 추가 | `ctx.tools`에 등록합니다. 해당 스키마는 프롬프트 구성에 포함됩니다. |
| 하나의 세션에 다른 기능 집합 제공 | 에이전트 프리셋을 구성합니다. 이때 서비스 행에는 `isolate` realm이 필요합니다. |
| 셸 실행 추가 | `ctx.shell` 백엔드를 등록합니다. 로컬 백엔드는 `ctx.subprocess`를 통해 프로세스를 생성합니다. |
| 영속적인 터미널 실행 추가 | `ctx.terminals` 백엔드와 `dsh-tool-terminal`를 등록합니다. |
| 사용자 명령 추가 | `ctx.commands`에 등록합니다. 모델 턴 없이 디스패치됩니다. |
| 백그라운드 작업 추가 | `ctx.jobs`에 등록합니다. `job_*` 도구로 이를 수집하거나 중지합니다. |
| 파일 시스템 액세스 또는 정책 추가 | `ctx.fs` 제공자를 등록하거나 `fs/*` 이벤트를 수신합니다. |
| 생성된 프로세스 격리 | `ctx.sandbox` 백엔드를 사용합니다. 소비자는 생성 전에 argv를 래핑합니다. |
| 요청, 도구 또는 턴 가로채기 | 해당 `agent/*` 또는 `tools/*` 이벤트를 사용합니다. `agent/turn-stopping`는 턴을 중지합니다. |
| 모델 지향 컨텍스트 추가 | `agent.inject()`를 호출합니다. 다음으로 허용되는 요청에 포함됩니다. |
| UI 또는 편집기 통합 추가 | `ctx.agents`를 구동하고 `session/event`에서 렌더링합니다. |
| Web Client Chat 노드 추가 | `ConversationNodeDefinition` 및 키가 지정된 렌더러를 등록합니다. |
| 지속 가능한 세션 상태 추가 | `SessionEventMap`를 확장하고 로그에서 렌더링 및 재생합니다. |
| 세션 제목 생성 | 유일한 `ctx.sessionTitle` 제공자를 등록합니다. |
| 동일 세션의 목표 관리 | `ctx.goals`를 사용하고 `agent/*`를 통해 계속합니다. |
| 실행 중인 세션 분기 | `ctx.sessions.fork(source, boundary?, childSessionId?)` |
| 등록을 하나의 에이전트로 범위 지정 | 해당 에이전트의 `agent.ctx`를 사용합니다. |

[확장 요리책](cookbook/extension-cookbook.md)은 기능을 역량에 매핑하고 [패키지](cookbook/adding-a-package.md), [도구](cookbook/adding-a-tool.md), [LLM 어댑터](cookbook/adding-an-llm-adapter.md) 및 [Chat 노드](cookbook/adding-a-conversation-node.md)를 위한 단계별 가이드의 색인을 제공합니다.
