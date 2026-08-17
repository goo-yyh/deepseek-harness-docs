# 도구 작성 참조

모델이 호출하는 도구가 충족해야 하는 계약을 설명합니다. 순서대로 첫 번째 도구를 만들려면 [도구 만들기](../user/develop/basic/tool.md)를 따르세요. `packages/shell/tool-bash`는 프로덕션 수준의 3개 패키지 예제입니다.

## 최소 형태

```ts
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'my-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'read_file',
    description: 'Read a file from disk.',          // what the model sees
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path' },
      limit: { type: 'number' },                     // optional by default
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      // args is TYPED from the schema: { path: string; limit?: number }
      // exec carries immutable identity + token; signal is the operational field
      return readFile(args.path, { encoding: 'utf8', signal: exec.signal })
    },
  }))
}
```

등록은 이펙트 기반입니다. 플러그인 fiber를 dispose하면 도구 등록이 해제됩니다. 스키마는 자동으로 시스템 프롬프트 구성에 반영됩니다.

## execute() 계약 규칙

- **인수는 자동으로 검증됩니다.** `defineTool`는 `execute`가 실행되기 전에 통합된 `ParameterSchemaSpec`에 대해 모델이 생성한 `arguments`를 검증합니다(타입, 필수 키, 리터럴 제약, 정확히 하나인 유니온, 중첩 값 — [런타임 인수 검증](../../.agents/notes/implemented/architecture/2026-06-11-runtime-arg-validation.md)). 따라서 `execute` 내부에서 인수는 `InferArgs`와 일치합니다. 명시적 객체 노드는 `additionalProperties: true | false`를 선언하며, 암시적 매개변수 루트는 열려 있습니다. 비어 있지 않은 문자열, 양수 또는 필드 간 규칙처럼 DSL로 표현할 수 없는 제약은 여전히 직접 확인해야 합니다. 직접 등록한 원시 JSON-Schema 도구는 자체 입력 검증을 담당합니다.
- **등록은 읽기 전용 정의를 빌려 사용합니다.** 타입이 지정된 동일 프로세스 기여는 직렬화 경계가 아닙니다. 등록 후에는 해당 스키마를 변경하거나 콜백을 교체하지 마세요. `schemas()`는 명시적인 모델 대상 프로젝션만 구체화합니다. 도구를 핫 스왑하려면 소유 이펙트를 dispose하고 대체 도구를 등록하세요. 콜백 클로저 안의 변경 가능한 상태는 일반 플러그인 상태로 유지됩니다.
- **실행 ID는 보호됩니다.** 레지스트리는 `arguments`를 재귀 패스 한 번으로 분리된 무손실 JSON으로 구체화하고, 정책이 시작되기 전에 그 값을 동결한 뒤 불투명한 `exec.token`를 할당합니다. `callId`, `name`, `arguments`, `agent`, `token`, 필수 호출자 소유 `signal` 및 선택적 상위 전송 `parent` 토큰은 디스패치 전반에 걸쳐 불변으로 유지됩니다. `parent`는 ID 전용이며, 활성 외부 실행을 노출하지 않습니다. `args`는 읽기 전용 입력으로 취급하세요. 디스패치 주변 래퍼만 변경 가능한 뷰를 받으며, 기한을 적용하기 위해 필수 `exec.signal`를 교체하고 복원할 수는 있지만 제거할 수는 없습니다.
- **하나의 표준 JSON 값을 선언하고 반환하세요.** `output.schema`는 `ValueSchemaSpec`를 사용하며 객체, 배열, 스칼라 또는 null 루트를 가질 수 있습니다. `execute`는 추론된 값만 반환합니다. 레지스트리는 이를 무손실 JSON으로 스냅샷하고 검증 및 동결한 다음 `output.render(args, value)`에 전달합니다. 본문에서 콘텐츠 블록을 반환하거나 호출자가 ID와 필드를 얻기 위해 산문을 파싱하게 하지 마세요.
- **예외를 던지거나 잘못된 값을 반환하면 `isError`가 됩니다.** 레지스트리는 observer가 실행되기 전에 예외를 포착하고 스키마, renderer, 메타데이터 프로젝터 및 무손실 JSON 실패를 격리합니다. 인프라 실패에는 예외를 던지세요. 0이 아닌 프로세스 종료처럼 Native renderer가 이상적이지 않은 상태를 설명하는 경우에도 성공한 도메인 결과는 표준 값으로 표현하세요.
- **`exec.signal`를 준수하세요.** 신호가 발생하면 진행 중인 작업을 취소하세요.
- **`presentationMeta`로 영속적인 카드 데이터를 프로젝션하세요(선택 사항).** `output.presentationMeta(args, value)`는 동일한 표준 값에서 재생 가능한 JSON을 파생합니다. 코어는 이를 `tool/result`에 영속화하고 `presentResult`에 전달합니다. 따라서 `write`/`edit` 적용 hunk처럼 결과 시점의 사실이 필요한 카드는 표준 값을 영속화하지 않고도 재생 후 유지됩니다. 중첩된 Code 디스패치에는 카드가 없으므로 프로젝터가 건너뛰어집니다.
- **비동기 알림에는 `exec.agent`를 사용하세요.** `agent.inject({ content, source: { kind: 'plugin', plugin: '<name>' } })`는 다음 모델 요청이 확인하는 영속적인 컨텍스트를 추가합니다. 이는 깨우기 신호가 아닙니다(유휴 에이전트는 유휴 상태로 유지됩니다). dispose된 에이전트에 대비하세요(try/catch).

## 장기 실행 작업

프로듀서 구성으로 `run_in_background`를 게이트한 다음 `ctx.jobs.start({ kind, label, owner: exec.agent, run })`를 통해 등록하세요. 레지스트리는 프로듀서 본문 전에 사전 중단된 호출을 거부합니다. 런타임은 `run()`가 작업을 시작하기 전에 소유권과 task-controller 가용성을 검증한 후 ID, 세션 펜스, 일반 제어 도구, 알림 및 소유자 정리를 제공합니다. 성공한 백그라운드 분기는 `{ kind: 'background', jobId }`와 같은 타입 지정 표준 핸들을 반환합니다. Native renderer는 `started background job bash-1` 같은 사람이 읽는 산문을 유지할 수 있지만, Code Mode는 ID를 복구하기 위해 그 산문을 절대 파싱해서는 안 됩니다.

프로듀서는 동기식 `cancel`, 리소스 정리 후 완료되는 reject되지 않는 `done`, 그리고 출력이 제한된 형식을 사용하는 선택적 소비형 `readOutput`를 제공합니다. 사전 중단된 호출은 성공 출력 스키마를 충족할 수 있는 ID의 작업이 존재하지 않으므로 실패입니다. `ctx.jobs.start()`가 ID를 게시한 후에는 `exec.signal` 대신 작업 소유 취소 신호를 사용하세요. 이후 외부 호출 취소는 호출 대기를 중단하지만 게시된 작업을 종료하지 않습니다. `job_kill`, 소유자 dispose 및 서비스 해제가 그 수명을 담당합니다. 포그라운드 작업은 `exec.signal`에 계속 결합됩니다. 스트림 프로듀서는 [백그라운드 작업 런타임 Agent Note](../../.agents/notes/implemented/architecture/2026-06-20-generic-long-running-tool-runtime.md) 및 `dsh-tool-bash`를 참조하세요.

## 실행 정책 및 관찰

배포 정책을 도구에 내장하지 않는 것이 좋습니다. 확장 가능한 allow/deny/ask 정책에는 `tools/pre-execute`를 사용하고([권한 게이트 예제](extension-cookbook.md#a-hook-plugin-permission-gate-example)), 이후 리스너가 되돌릴 수 없는 최종 단조 거부에는 `ctx.tools.guard()`를, 기한·재시도·메트릭 수집으로 디스패치를 감싸려면 `tools/execute`를, 프레젠테이션 콘텐츠 또는 반환 값을 교체하거나 결과를 차단하거나 모델 대상 컨텍스트를 첨부하려면 `tools/post-execute`를, 불변 정규화 결과를 관찰하려면 `tools/result`를 사용하세요. 콘텐츠를 교체해도 `value`에 대한 프로그래밍 방식 액세스는 유지됩니다. 기밀성 정책은 값을 차단하거나 교체합니다. 샌드박싱 구현은 도구의 executor 구현 내부에서도 실행할 수 있습니다. [`dsh-tools` README](../../packages/core/tools/README.md#extension-points)는 각 확장 지점의 입력, 순서, 반환 값 및 실패 동작을 정의합니다.

## Code Mode에서 도구를 자동으로 사용할 수 있습니다

[Code Mode](../../packages/core/tools/README.md)에서는 표시되는 등록 도구를 추가 통합 없이 모두 `await tools.<name>(args)`로 사용할 수 있습니다. 생성된 `ToolArgsMap` 및 `ToolOutputMap`는 동일한 스키마에서 정확한 인수 및 표준 반환 타입을 파생하며, 호출은 일반 실행 파이프라인에 다시 진입합니다. 성공한 호출은 렌더링된 Native 콘텐츠가 아니라 정책 처리 후 최종 표준 JSON 값으로 resolve됩니다. 실패한 호출은 실제 `ToolCallError`와 함께 reject됩니다. 프로그램은 내부 오류 코드나 실패 유니온이 아니라 해당 값의 `name`, `toolName` 및 사람이 읽을 수 있는 `message`만 검사할 수 있습니다.

`output.schema`를 유용한 프로그래밍 방식 API로 설계하세요. 핸들과 필드를 직접 반환하고, 그것이 정직한 값인 경우 scalar/array/null 루트를 허용하며, 사람이 읽을 설명은 `output.render`에 유지하세요. 중간 값은 실행 로컬 값이며 영속화되거나 프롬프트에 맞춰 잘리지 않고 바이트 상한도 없으므로, 생성자의 정직한 획득 한계와 프로세스 메모리는 여전히 중요합니다. 구성 가능한 출력 상한과 모델 대면 스필 파이프라인을 통과하는 것은 외부 `run_code` 로그/결과뿐입니다.

## 도구가 UI에 렌더링되는 방식

도구의 `output.render`는 모델 대면 콘텐츠를 반환합니다. **UI 카드** 는 순수한 프레젠테이션 프로젝션과 선택적 `presentCall` / `presentResult` 메서드를 통해 선언되는 별도의 관심사입니다. 이를 정규 값과 함께 설계하세요. UI 프레젠테이션이 없는 도구는 일반 카드(제목 = 도구 이름, 입력 = 원시 인수)로 대체됩니다.

두 메서드는 모두 **`card` 태그가 지정된 렌더링 의도** 를 반환합니다. 도구의 작업에 맞는 카드 종류를 선택하세요.

- `presentCall(args)` → `ToolCallView`(PENDING 카드):
  - `{ card: 'generic', title, kind?, rawInput?, content?, locations? }` — 기본값입니다. 아이콘에는 `kind`(`read`/`search`/…)을 설정하고, 도구가 건드리는 파일에는 `locations: [{ path, line? }]`을 설정하면 지원되는 편집기가 해당 파일을 따라가거나 바로 이동합니다.
  - `{ card: 'terminal', title, description?, cwd? }` — 호출 자체가 셸 명령입니다. `title`는 명령이고, `description`는 터미널 카드 위에 렌더링됩니다. (tool-bash.)
  - `{ card: 'diff', title, diffs, locations? }` — 호출이 파일을 생성하거나 수정합니다. `diffs: [{ path, oldText, newText }]`(새 파일의 경우 `oldText: null`)은 인라인 diff 카드로 렌더링됩니다. (tool-fs `write`/`edit`.)
- `presentResult(args, { content, isError, meta? })`는 완료된 카드를 반환합니다.
  - `generic`은 선택적 제목과 콘텐츠를 제공합니다.
  - `terminal`은 원시 출력과 선택적 종료 메타데이터를 제공합니다. 각 UI는 지원되는 보기 또는 대체 보기를 렌더링합니다.
  - `diff`는 적용된 헝크를 제공합니다. 이는 흔히 `output.presentationMeta`에서 파생되며, 재생 시 이를 재현할 수 있도록 영속화된 `result.meta`에 보관됩니다. 완료된 보기가 대기 중 카드를 대체하므로 변경 도구는 diff 결과를 유지합니다.
  - `search`는 영속화된 `result.meta`에서 재구성된 검색 결과를 제공합니다. 파일별로 그룹화된 일치 항목(`shape: 'matches'`, grep) 또는 평면 경로 목록(`shape: 'paths'`, glob)에 `truncated`/`total`를 더해 UI가 상한에 걸린 결과를 완전한 결과로 표시하지 않게 합니다. 보기에는 결과 텍스트가 없으며(검색 카드가 없는 UI는 원시 결과 콘텐츠로 대체됨), `search` 호출 보기도 없습니다. 일치 항목은 `execute` 이후에만 존재하므로 검색 호출의 대기 상태는 일반 카드로 유지됩니다. (tool-fs-search `grep`/`glob`.)
  - `web`는 `result.meta`에서 파생된 완료된 웹 검색을 제공합니다. 이는 `kind: 'search' | 'fetch'`(구조화된 검색 소스 또는 가져오기 요약)로 구분됩니다. 본문 사본은 포함하지 않으므로 `web` 기능이 없는 UI는 원시 결과 콘텐츠로 대체됩니다. (tool-web `web_search`/`web_fetch`.)

엄격한 규칙(위반하면 문제가 발생합니다):

- **순수성.** 이들은 실시간 스트리밍 중과 세션 로그 REPLAY 시 모두 실행되므로 `args`(+ 결과)의 순수 함수여야 합니다. I/O 금지, 세션 상태 읽기 금지, 시계/난수 사용 금지입니다. diff는 인수에서 파생됩니다(호출 시점 프레젠터에는 이전 파일 콘텐츠가 없으므로 `write`는 `oldText: null`를 사용합니다). 세션 컨텍스트는 도구가 아니라 UI 어댑터가 제공합니다. `presentCall` 내부에서 파일의 이전 콘텐츠나 작업 디렉터리가 필요하다고 생각되면 멈추세요. 그것은 프레젠터가 아니라 영속적 결과 메타데이터 또는 어댑터에 속합니다.
- **UI 전용 형식화는 모델 결과에 포함하지 않습니다.** 펜스 처리된 ` ```console ` 블록, diff, 상대 경로화된 경로 중 어느 것도 UI 제공만을 위해 정규 값이나 Native 콘텐츠에 속하지 않습니다. `output.render`는 모델 대면 산문을 담당하고, `presentationMeta`와 카드 프레젠터는 재생 가능한 UI 상태를 담당합니다. `terminal` 결과 보기는 원시 출력을 전달하며, 어댑터가 필요한 대체 프레이밍을 추가합니다.
- **`defineTool`는 표시 경로를 소프트 검증합니다.** 형식이 잘못되었거나 오래된 기록 인수는 래퍼가 예외를 발생시키는 대신 `undefined`(일반 대체값)를 반환하게 합니다. 표시는 재생 중에 절대 충돌해서는 안 됩니다.

중립적인 어휘는 `dsh-tools`에 있으며, 도구는 UI나 전송 타입을 절대 가져오지 않습니다. 호스트/클라이언트 런타임은 각 `card`를 자체 보기에 매핑합니다. 설계와 그 이유는 [렌더링 의도 유니온 Agent Note](../../.agents/notes/implemented/architecture/2026-07-02-tool-render-intent-union.md)에 있으며, `dsh-tool-fs`(일반/diff) 및 `dsh-tool-bash`(터미널)은 참조 구현입니다.

## 검증

[리포지토리 테스트 정책](../testing.md)과 소유 패키지의 테스트 문서를 따르세요. 배포되는 모델 또는 UI 가시 변경에는 그곳에 명시된 종합 커버리지가 필요합니다.
