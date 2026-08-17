# 4. 이벤트

서비스는 직접 호출을 지원하고, **이벤트** 를 사용하면 플러그인이 어떤 플러그인이 수신하는지 알지 못한 채 어떤 사실을 알릴 수 있습니다. Harness는 도구 결과, 모델 요청, 승인 결정과 같은 상호작용에 이벤트를 사용합니다.

## 선언, 발생, 수신

항목을 세고 변경될 때마다 알리는 서비스인 `stats.ts`를 `tmp/cordis-tutorial`에 생성합니다.

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    stats: StatsService
  }
  interface Events {
    'stats/report'(name: string, count: number): void
  }
}

export class StatsService extends Service {
  private counts = new Map<string, number>()

  constructor(ctx: Context) {
    super(ctx, 'stats')
  }

  bump(name: string) {
    const next = (this.counts.get(name) ?? 0) + 1
    this.counts.set(name, next)
    this.ctx.emit('stats/report', name, next)
  }
}

export const name = 'stats'

export function apply(ctx: Context) {
  ctx.plugin(StatsService)
}
```

`interface Events` 병합은 3장의 `interface Context` 병합에 대응하는 이벤트 시스템 기능입니다. 이벤트 이름과 리스너 시그니처를 선언하므로 `ctx.emit` 및 `ctx.on`가 완전히 타입 지정됩니다. `namespace/action` 명명 규칙은 평면적인 이벤트 네임스페이스를 읽기 쉽게 유지합니다.

`reporter.ts`를 생성합니다.

```ts ignore-check
import type { Context } from '@deepseek-ai/cordis'
import type {} from './stats.ts'

export const name = 'reporter'
export const inject = ['stats']

export function apply(ctx: Context) {
  ctx.on('stats/report', (name, count) => {
    console.log(`[stats] ${name} -> ${count}`)
  })
  ctx.stats.bump('tool_call')
  ctx.stats.bump('tool_call')
  ctx.stats.bump('prompt')
}
```

`import type {} from './stats.ts'` 줄은 런타임에 아무것도 가져오지 않습니다. TypeScript가 선언 병합을 인식하도록 존재합니다. 조합하고 실행합니다.

```yaml
- name: './stats.ts'
- name: './reporter.ts'
```

```
[stats] tool_call -> 1
[stats] tool_call -> 2
[stats] prompt -> 1
```

`ctx.on()`는 effect이므로 리스너는 플러그인과 함께 사라집니다. 수동으로 `removeListener`를 관리할 필요가 전혀 없습니다.

## 디스패치 모드

`emit`는 다섯 가지 디스패치 모드 중 하나입니다. 이벤트가 어떤 모드를 사용하는지는 계약의 일부이며, 리스너가 값을 반환할 수 있는지, 동시에 실행할 수 있는지, 서로를 단락할 수 있는지를 결정합니다.

| 모드 | 호출 | 의미 |
|---|---|---|
| emit | `ctx.emit(name, ...args)` | 동기식 브로드캐스트입니다. 반환된 Promise와 값은 기다리거나 수집하지 않습니다. |
| parallel | `await ctx.parallel(name, ...args)` | 모든 리스너가 동시에 실행되며 함께 대기됩니다. |
| serial | `await ctx.serial(name, ...args)` | 리스너가 순서대로 실행되고 대기됩니다. 처음으로 `null`/`false`/`undefined`가 아닌 값을 반환한 리스너가 이기며 나머지는 중단됩니다. |
| bail | `ctx.bail(name, ...args)` | serial의 동기식 버전입니다. |
| waterfall | `ctx.waterfall(name, ...args, next)` | 주변 미들웨어입니다. 아래를 참조하세요. |

모든 harness 이벤트는 소유한 [하위 시스템 페이지](../subsystems/core.md)의 생성된 레퍼런스에 모드를 문서화합니다.

## Waterfall: 변환 또는 단락

Waterfall은 가로채기를 구현하는 모드입니다. 각 리스너는 인수와 `next()` 연속 함수를 받습니다. `next()`가 반환하는 값을 변환하거나, `next()`를 호출하지 않고 반환하여 나머지 체인을 단락할 수 있습니다. 이는 Cordis 문서에서 veto라고 부르는 기능입니다. `waterfall-demo.ts`를 생성합니다.

```ts
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'demo/transform'(input: string, next: () => Promise<string>): Promise<string>
  }
}

export const name = 'waterfall-demo'

export function apply(ctx: Context) {
  // Listener 1: wrap the downstream result.
  ctx.on('demo/transform', async (input, next) => {
    const downstream = await next()
    return downstream.toUpperCase()
  })

  // Listener 2: short-circuit when it owns the decision.
  ctx.on('demo/transform', async (input, next) => {
    if (input.includes('blocked')) return '** blocked **'
    return next()
  })

  void (async () => {
    console.log(await ctx.waterfall('demo/transform', 'hello', async () => 'hello'))
    console.log(await ctx.waterfall('demo/transform', 'blocked words', async () => 'blocked words'))
  })()
}
```

`cordis.yml`가 이 파일만 가리키도록 설정하고 실행합니다.

```
HELLO
** BLOCKED **
```

두 번째 줄을 살펴보겠습니다. 리스너 1이 먼저 실행되어 `next()`를 호출하고, 이 호출이 리스너 2를 실행합니다. 리스너 2는 `blocked`를 확인한 뒤 `next()`를 호출하지 않고 반환합니다. 따라서 가장 안쪽 기본값(`ctx.waterfall`에 전달한 함수)은 실행되지 않으며, 리스너 1은 돌아오는 과정에서 대체 메시지를 대문자로 변환합니다.

따라야 할 원칙은 다음과 같습니다. **관찰 또는 주석 추가만 하는 waterfall 리스너는 반드시 `next()`를 호출해야 합니다**. 이를 호출하지 않고 반환하는 것은 의도적인 단락입니다. 로깅 리스너에서 `next()`를 빼먹으면 이후의 모든 대상에 대한 기본 동작이 조용히 사라집니다. 이는 이 리포지터리의 상시 규칙입니다([waterfall 의미 체계](../cordis-primer.md#cordis-waterfall-semantics)).

Harness는 협력하는 플러그인이 감싸거나 응답할 수 있는 결정에 waterfall을 사용합니다. [`agent/request`](../subsystems/core.md#agentrequest--waterfall)를 사용하면 플러그인이 모델 호출 설정을 대체할 수 있고, [`approval/request`](../subsystems/approval.md#approvalrequest--waterfall)를 사용하면 정책이 사용자 대신 응답할 수 있습니다.

다음: [설정](05-config.md) — `cordis.yml`의 플러그인 옵션입니다.
