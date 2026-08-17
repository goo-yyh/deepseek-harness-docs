# 이벤트 시스템

이벤트는 Cordis 플러그인 간의 핵심 통신 메커니즘입니다. Harness는 느슨하게 결합된 확장 지점에 이를 폭넓게 사용합니다.

## 기본 사용법

### 이벤트 수신

```ts ignore-check
ctx.on('event-name', (payload) => {
  // Handle the event.
})
```

### 이벤트 발생

```ts ignore-check
ctx.emit('event-name', payload)
```

## 이벤트 모드

Cordis는 다양한 상호작용 계약을 위한 여러 이벤트 모드를 제공합니다.

### emit — 브로드캐스트

모든 리스너는 동기적으로 실행되며 반환값은 무시됩니다.

```ts ignore-check
// Emit
ctx.emit('my-plugin/ready', { id: 'worker-1' })

// Listen
ctx.on('my-plugin/ready', ({ id }) => {
  console.log(`${id} is ready`)
})
```

### bail — 단락

리스너는 순서대로 실행되며, `null`, `false` 또는 `undefined` 이외의 첫 번째 결과가 최종 결과가 됩니다.

```ts ignore-check
// Dispatch
const result = ctx.bail('some-check', input)

// Listen: a returned value stops later listeners.
ctx.on('some-check', (input) => {
  if (shouldBlock(input)) return 'blocked'
  // Return null, false, or undefined to continue to the next listener.
})
```

### serial — 순차 실행

리스너는 등록 순서대로 실행되며 비동기 결과는 대기합니다. `null`, `false` 또는 `undefined` 이외의 첫 번째 결과가 이후 실행을 중지합니다.

```ts ignore-check
await ctx.serial('setup-phase', context)
```

### waterfall — 파이프라인

각 리스너는 다운스트림 결과를 감싸 처리 체인을 구성할 수 있습니다. 리스너는 다운스트림에 위임하려면 **반드시 `next()`를 호출해야 합니다**. 호출을 생략하면 파이프라인이 단락됩니다.

```ts ignore-check
// Dispatch
const output = await ctx.waterfall('my-plugin/transform', input, async () => input)

// Listen: next() is mandatory.
ctx.on('my-plugin/transform', async (_input, next) => {
  const downstream = await next()
  return downstream.trim()
})
```

::: warning
waterfall 리스너는 **반드시 `next()`를 호출해야 합니다**. 이를 생략하면 의도적으로 파이프라인이 단락되어 가로채기 및 게이트웨이 동작을 구현할 수 있습니다.
:::

## 타입이 지정된 이벤트

Harness는 타입 안전 이벤트를 위해 TypeScript 선언 병합을 사용합니다.

```ts
import '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'my-plugin/ready': (payload: { id: string }) => void
    'my-plugin/check': (input: string) => boolean | undefined
    'my-plugin/transform': (input: string, next: () => Promise<string>) => Promise<string>
  }
}

// ctx.on('my-plugin/ready', ...) and ctx.emit('my-plugin/ready', ...)
// are now inferred correctly.
```

## Cordis 이벤트 및 세션 레코드

Harness Cordis 이벤트는 `namespace/action` 이름을 사용하며, `agent/step`, `agent/request`, `agent/request-error`, `tools/result` 및 `session/event`가 포함됩니다. [하위 시스템 페이지](../../../subsystems/core.md)의 생성된 `cordis-surface` 영역에는 전체 시그니처와 모드가 기록됩니다.

`turn/*`, `step/*`, `tool/call`, `tool/result` 및 `compaction/*`은 동일한 이름의 Cordis 이벤트가 아니라 영속적인 세션 이벤트 타입입니다. 이를 관찰하려면 `session/event`을 수신하고 `event.type`을 검사하세요.

## 이벤트 리스너는 이펙트입니다

`ctx.on()`으로 등록된 리스너는 해당 플러그인이 언로드되면 자동으로 제거됩니다.

```ts ignore-check
export function apply(ctx: Context) {
  // This listener is removed when the plugin disposes.
  ctx.on('tools/result', handler)
}
```

## 예시: 로깅 플러그인

이 플러그인은 도구 호출과 결과를 기록합니다.

```ts
import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-tools'

export const name = 'tool-logger'

export function apply(ctx: Context) {
  ctx.on('tools/result', (exec, result) => {
    console.log(`[tool] ${exec.name}(${JSON.stringify(exec.arguments)})`)
    const text = result.content
      .map(block => block.type === 'text' ? block.text : '')
      .join('')
    console.log(`[tool result] ${text.slice(0, 100)}`)
  })
}
```

## 다음 단계

- [기능 계층화](../practice/) — 기능 인터페이스 내에서 이벤트 이해하기
- [LLM 어댑터](../practice/llm-adapter.md) — 완전한 LLM 백엔드 구현하기
