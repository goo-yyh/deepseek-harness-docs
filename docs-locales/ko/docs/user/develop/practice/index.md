# 세 가지 역할의 기능 설계

이 페이지는 세 가지 역할의 기능 패턴에 대한 개념 참조와 하나의 기능을 구축하는 고급 튜토리얼의 두 부분으로 구성됩니다. 먼저 [기본 플러그인 경로](../basic/) 및 [서비스 튜토리얼](../framework/service.md)을 완료하세요.

## 개념 참조

Bash 실행처럼 교체 가능한 제공자가 필요할 만큼 일반적인 기능의 경우, Harness는 **서비스 정의**, **서비스 제공자**, **소비자**의 세 역할을 분리합니다. 역할을 독립적으로 발전시키거나 교체해야 하는 경우에는 별도의 패키지에 배치하고, 그렇지 않은 경우 패키지가 둘 이상의 역할을 소유할 수 있습니다. 완전한 기능이 추상 경계입니다. 개별 역할은 추상 경계가 아닙니다.

## Bash 예시

Bash 실행 기능은 다음으로 구성됩니다.

- **서비스 정의** (`dsh-shell`) — Cordis 서비스와 Bash 요청 및 결과 타입을 정의합니다.
- **서비스 제공자** (`dsh-bash-local`) — 로컬 머신에서 명령을 실행합니다.
- **소비자** (`dsh-tool-bash`) — 기능을 모델이 호출할 수 있는 도구로 노출합니다.

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│  dsh-shell   │────▶│  dsh-bash-local  │     │ dsh-tool-bash│
│(definition) │     │    (provider)     │     │(consumer/tool)│
└─────────────┘     └──────────────────┘     └──────────────┘
       ▲                                            │
       └────────────────────────────────────────────┘
                    inject: ['shell']
```

## 분리의 이점

### 제공자 교체

하나의 서비스 정의에는 `cordis.yml`을 통해 선택되는 여러 제공자가 있을 수 있습니다.

```yaml
# Local execution
- name: '@deepseek-ai/dsh-bash-local'

# Replace this row with another package that provides the same service.
```

제공자가 바뀌어도 서비스 정의와 도구는 변경되지 않습니다.

### 독립적 발전

- 호출자가 계약에 의존하기 시작한 후에는 서비스 정의가 거의 변경되지 않습니다.
- 서비스 제공자는 성능과 보안을 독립적으로 개선할 수 있습니다.
- 소비자는 기능을 모델에 제시하는 방식을 변경할 수 있습니다.

### 의존성 분리

- 서비스 제공자는 서비스 정의에 의존합니다.
- 소비자는 서비스 정의에 의존합니다.
- 서비스 제공자와 소비자는 **서로 의존하지 않습니다**.

[기능 추상 경계 참조](../../../capability-seams.md)에서 현재 내장된 제품군과 패키지 링크를 관리합니다.

## 튜토리얼: 세 가지 역할의 기능 개발

### 1단계: 서비스 정의 작성

```ts ignore-check
// packages/my-cap/my-cap/src/index.ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    myCap: MyCapService
  }
}

export abstract class MyCapService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'myCap')
  }

  /** Execute the capability. */
  abstract execute(request: MyCapRequest): Promise<MyCapResult>
}

export interface MyCapRequest {
  input: string
}

export interface MyCapResult {
  output: string
}
```

### 2단계: 서비스 제공자 작성

```ts ignore-check
// packages/my-cap/my-cap-local/src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import { MyCapService, type MyCapRequest, type MyCapResult } from '@deepseek-ai/dsh-my-cap'

class MyCapLocal extends MyCapService {
  async execute(request: MyCapRequest): Promise<MyCapResult> {
    // Local provider behavior.
    return { output: request.input.toUpperCase() }
  }
}

export const name = 'my-cap-local'

export function apply(ctx: Context) {
  ctx.plugin(MyCapLocal)
}
```

### 3단계: 소비자 작성

```ts ignore-check
// packages/my-cap/tool-my-cap/src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-my-cap'
export const inject = ['tools', 'myCap']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'my_cap',
    description: 'Execute my capability.',
    parameters: {
      input: { type: 'string', required: true },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const result = await ctx.myCap.execute({ input: args.input })
      return result.output
    },
  }))
}
```

### cordis.yml에서 구성하기

```yaml
- name: '@deepseek-ai/dsh-my-cap-local'
- name: '@deepseek-ai/dsh-tool-my-cap'
```

## 설계 고려 사항

- **성급하게 분리하지 마세요** — 역할을 독립적으로 발전시켜야 할 때에만 별도의 패키지를 사용하세요. 단순한 도구 플러그인에는 필요하지 않습니다.
- **서비스 정의는 Request/Result 타입을 소유합니다** — 서비스 제공자와 소비자는 서비스 정의 패키지에만 의존합니다.
- **명시적인 방식이 암시적인 방식보다 낫습니다** — `run()` 내부에 `?? default` 표현식을 숨기기보다 명시적인 `resolve(request): Spec` 단계에서 기본값을 확인하세요.

## 다음 단계

- [LLM 어댑터](./llm-adapter.md) — LLM 제공자를 구현합니다
