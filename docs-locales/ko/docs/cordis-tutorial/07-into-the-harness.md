# 7. Harness에 연결하기

이 장에서는 모델이 호출할 수 있는 도구를 harness의 `tools` 서비스에 등록하고, harness 도구 파이프라인을 통해 실행한 다음 결과 이벤트를 관찰합니다. 키 없이 작동하며 모델을 호출하지 않습니다.

## 도구 플러그인

`tmp/cordis-tutorial`에 `greet-tool.ts`를 만듭니다:

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { CallId } from '@deepseek-ai/dsh-llm'

export const name = 'greet-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet the named person.',
    parameters: {
      name: { type: 'string', required: true, description: 'Who to greet' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `Hello, ${args.name}!`
    },
  }))

  // Drive one call through the real execution pipeline, standing in for
  // the model. CallId brands the correlation id a provider would issue.
  void (async () => {
    const result = await ctx.tools.execute({
      callId: CallId('demo-1'),
      name: 'greet',
      arguments: { name: 'Cordis' },
      signal: new AbortController().signal,
    })
    console.log('tool replied:', JSON.stringify(result.content))
  })()
}
```

여기의 모든 패턴은 앞선 장에서 다뤘습니다. `inject: ['tools']`([3장](03-services.md))는 도구 레지스트리가 존재할 때까지 플러그인을 유지합니다. `ctx.tools.register(...)`는 등록 해제 disposer를 플러그인에 연결하므로([2장](02-lifecycle-and-effects.md)), 언로드하면 도구 등록이 해제됩니다. `defineTool`는 `parameters` 사양을 모델에 표시되는 JSON Schema로 변환하고, `args`의 타입을 추론하며, `execute`가 실행되기 전에 모델이 제공한 인수를 검증합니다. 도구는 `output.schema`가 선언한 표준 값을 반환합니다. `output.render`는 Native 및 영속적인 결과 콘텐츠를 별도로 생성합니다.

## 관찰자 플러그인

harness의 `tools/result` 이벤트를 통해 앱의 모든 도구 호출을 관찰하는 별도 플러그인인 `tool-logger.ts`를 만듭니다:

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'tool-logger'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.on('tools/result', (exec, result) => {
    const text = result.content
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('')
    console.log(`[tool-logger] ${exec.name} -> ${text}`)
  })
}
```

`import type {} from '@deepseek-ai/dsh-tools'` 줄은 패키지의 선언 병합을 가져와 `'tools/result'` 및 해당 페이로드에 타입을 지정합니다. 이는 패키지 규모에서 4장의 `stats.ts` import와 같은 방식입니다.

## 구성 및 실행

```yaml
- name: '@deepseek-ai/dsh-system-prompt'
- name: '@deepseek-ai/dsh-tools'
- name: './tool-logger.ts'
- name: './greet-tool.ts'
```

도구가 시스템 프롬프트에 스키마를 기여하므로 `@deepseek-ai/dsh-tools`는 `systemPrompt` 서비스를 주입하며, 따라서 구성에도 해당 provider를 나열합니다. 이를 생략하면 [6장](06-composition-and-hmr.md)에서 설명한 대로 tools 플러그인은 PENDING 상태로 남습니다.

```sh
node --import tsx ../../vendor/cordis/bin.js
```

```
[tool-logger] greet -> Hello, Cordis!
tool replied: [{"type":"text","text":"Hello, Cordis!"}]
```

로거가 먼저 실행되었습니다. `tools/result`는 `execute`의 promise가 호출자에게 resolve되기 전에 결과 구체화의 일부로 emit됩니다. 두 플러그인은 서로의 존재를 알지 못합니다. 레지스트리 서비스와 이벤트가 이들을 연결합니다.

## 여기서 완전한 에이전트까지

실제 에이전트는 이 구성에 더 많은 플러그인을 추가한 것입니다. LLM 어댑터, 에이전트 루프, 영속성, 진입점이 포함됩니다. [examples/headless-agent/cordis.yml](../../examples/headless-agent/cordis.yml)를 비교해 보세요. 이제 그 안의 모든 항목을 읽을 수 있습니다. 해당 파일의 복사본에 `greet-tool.ts`를 추가하세요.

다음 단계:

- [도구 만들기](../user/develop/basic/tool.md) — 프레젠테이션과 더 풍부한 스키마를 포함한 `defineTool`의 추가 내용입니다.
- [3계층 기능 설계](../user/develop/practice/index.md) — harness가 교체 가능한 기능을 구조화하는 방식입니다.
- [하위 시스템 페이지](../subsystems/core.md)의 생성된 `cordis-surface` 영역 — 주입하고 수신할 수 있는 모든 항목을 각각의 소유 페이지에서 확인할 수 있습니다.
- [아키텍처](../architecture.md) — 이 플러그인이 속한 시스템 맵입니다.
