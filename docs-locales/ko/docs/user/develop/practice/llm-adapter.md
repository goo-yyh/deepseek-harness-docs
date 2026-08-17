# LLM 어댑터

이 가이드에서는 새 LLM 제공업체를 Harness에 연결하는 방법을 설명합니다.

## 개요

LLM 어댑터는 `LlmAdapter`를 확장하고 `stream()`를 구현하며, Harness의 제공업체 중립적 요청을 제공업체 API 호출로 변환하고 응답을 다시 Harness 청크로 변환합니다.

## 최소 구현

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

class MyAdapter extends LlmAdapter {
  private apiKey: string

  constructor(apiKey: string) {
    super()
    this.apiKey = apiKey
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // 1. Convert options.messages to the provider format.
    // 2. Call the streaming API.
    // 3. Convert the response into StreamChunk values.
  }
}

export interface Config {
  apiKey: string
  providers: string[]
}

export const Config: Schema<Config> = Schema.object({
  apiKey: Schema.string().required(),
  providers: Schema.array(Schema.string()).required(),
})

export const name = 'my-llm-adapter'
export const inject = ['llm']

export function apply(ctx: Context, config: Config) {
  const adapter = new MyAdapter(config.apiKey)
  ctx.llm.registerAdapter(config.providers, adapter)
}
```

## StreamChunk 프로토콜

`stream()`는 이 프로토콜을 사용하여 청크를 생성합니다.

```ts
import { CallId, type StreamChunk } from '@deepseek-ai/dsh-llm'

async function* exampleChunks(): AsyncIterable<StreamChunk> {
  // 1. Start each content block with block-start.
  yield { type: 'block-start', index: 0, blockType: 'text' }

  // 2. Stream text through text-delta.
  yield { type: 'text-delta', index: 0, text: 'Hello' }
  yield { type: 'text-delta', index: 0, text: ' world' }

  // 3. End each content block with block-end and the complete block.
  yield {
    type: 'block-end',
    index: 0,
    block: { type: 'text', text: 'Hello world' },
  }

  // 4. Tool-call block.
  yield { type: 'block-start', index: 1, blockType: 'tool-call' }
  yield {
    type: 'tool-call-delta',
    index: 1,
    id: CallId('call-123'),
    name: 'bash',
    argumentsDelta: '{"command":"ls"}',
  }
  yield {
    type: 'block-end',
    index: 1,
    block: {
      type: 'tool-call',
      id: CallId('call-123'),
      name: 'bash',
      arguments: '{"command":"ls"}',
    },
  }

  // 5. Token usage.
  yield { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } }

  // 6. Finish reason.
  yield { type: 'finish', reason: { kind: 'stop' } }
  // Alternatively, { kind: 'tool-calls' } requests tool execution.
}
```

### 주요 규칙

- 각 `block-start`에는 대응하는 `block-end`가 있습니다.
- `index`는 0부터 증가하며 콘텐츠 블록 순서를 식별합니다.
- `tool-call-delta`는 한 번에 또는 여러 청크에 걸쳐 `argumentsDelta`에 원시 JSON 텍스트를 담습니다.
- `finish`는 마지막 청크입니다.
- `finish`보다 먼저 `usage`를 내보냅니다.

## GenerateOptions

`stream()`는 내보낸 `GenerateOptions` 타입을 받습니다. 여기에는 모델, 어댑터 소유의 추론 노력 ID, 대화 기록, 시스템 프롬프트, 도구 스키마, 생성 매개변수, 중지 시퀀스 및 중단 신호가 포함됩니다. `@deepseek-ai/dsh-llm`에서 내보낸 TypeScript 타입을 권위 있는 기준으로 취급합니다. 지원되는 필드를 제공업체 API에 매핑합니다. 제공업체가 필드를 지원할 수 없으면 조용히 삭제하지 말고 안정적인 코드와 함께 `LlmError`를 발생시킵니다.

`resolveModel(provider, model, signal?)`를 재정의하여 정확한 제공업체/모델 식별자와 선택적 `context` 및 `reasoning` 메타데이터를 한 번의 조회로 반환합니다. 추론 메타데이터에는 순서가 지정된 불투명 ID와 표시 이름, 그리고 선택적 구성 기본값이 포함됩니다. 업스트림 기능 API가 이를 반환할 때 `off`를 포함하여 어댑터의 권위 있는 선택 가능 목록을 유지하고, 해당 값을 코어 열거형으로 승격하지 마십시오. 비동기 조회에서는 선택적 신호를 준수하여 취소와 폐기가 안정 상태에 도달하도록 합니다. 서비스는 집계를 검증하고 `stream()` 전에 지원되지 않는 명시적 노력을 거부합니다. `reasoning`를 생략하면 해당 모델에는 선택 가능한 추론 노력 기능이 없음을 의미합니다.

## 어댑터 등록

```ts ignore-check
ctx.llm.registerAdapter(['my-provider'], adapter)
```

첫 번째 인수는 어댑터가 처리하는 제공업체 경로를 나열합니다. `GenerateOptions.provider`는 등록된 어댑터를 선택하는 반면, `GenerateOptions.model`는 수명 주기 등록 없이 어댑터 소유의 모델 ID를 전달합니다. 어댑터가 선택기에 모델 선택지를 알릴 수 있으면 `listModels()`를 재정의합니다.

## cordis.yml에서 사용하기

```yaml
- id: my-llm
  name: './src/my-llm-adapter.ts'
  config:
    apiKey: !!js process.env.MY_API_KEY
    providers:
      - my-provider

- id: agent-loop
  name: '@deepseek-ai/dsh-agent-loop'
  config:
    agents:
      - id: main
        provider: my-provider
        model: my-model-v1
```

## 참조 구현

리포지토리에는 완전한 구현이 포함되어 있습니다.

- `packages/llm/llm-deepseek/` — OpenAI 호환 형식을 사용하는 DeepSeek API 어댑터
- `packages/llm/llm-pi-ai/` — 서로 다른 API 형식을 사용하는 Pi AI 어댑터

서로 다른 제공업체 SDK에서 동일한 harness 계약이 구현된 방식을 보려면 함께 제공되는 두 어댑터를 비교하십시오.

## 오류 처리

어댑터는 전송 및 프로토콜 실패를 안정적인 코드를 갖는 `LlmError` 값으로 발생시킵니다. 에이전트 루프는 진단과 정책을 위해 오류와 코드를 보존하며, 일반 `Error`를 자동으로 변환하지 않습니다. 모든 제공업체 HTTP 요청은 `attributionHeaders()`도 병합하고 `options.signal`를 전달해야 합니다.

```ts
import {
  attributionHeaders,
  LlmAdapter,
  LlmError,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

class HttpAdapter extends LlmAdapter {
  constructor(private readonly endpoint: string) {
    super()
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...attributionHeaders(),
      },
      body: JSON.stringify({ model: options.model, messages: options.messages }),
      ...options.signal ? { signal: options.signal } : {},
    })
    if (!response.ok) {
      throw new LlmError(`Provider API error: ${response.status}`, 'PROVIDER_HTTP_ERROR')
    }
    // A real adapter parses the response and emits the complete chunk sequence.
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
```
