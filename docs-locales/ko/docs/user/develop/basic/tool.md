# 도구 만들기

이 튜토리얼에서는 Web UI에 `greet` 도구를 추가합니다. 먼저 [첫 번째 플러그인](./)을 완료하고 해당 `scratch-plugin` 디렉터리를 유지하세요.

## 도구 플러그인 만들기

`scratch-plugin/src/my-plugin.ts`를 다음으로 바꾸세요:

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'greet-tool'
export const inject = ['tools']

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'greet',
    description: 'Greet someone by name.',
    parameters: {
      name: { type: 'string', required: true, description: 'The name to greet' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `Hello, ${args.name}!`
    },
  }))
}
```

`inject`는 Cordis가 도구 레지스트리를 기다리도록 합니다. `defineTool`는 `parameters`에서 `args`를 추론하고 검증합니다. `execute`는 `output.schema`에서 선언한 표준 값을 반환하고, `output.render`는 그 값을 모델용 콘텐츠로 변환합니다.

## 도구 실행 및 호출

실행 중이 아니라면 개발 명령을 다시 시작하세요:

```sh
pnpm dsh web --patch ./scratch-plugin/cordis.yml
```

`http://127.0.0.1:3080`을 열고 다음과 같이 요청하세요: `Use the greet tool to greet Ada.` 모델은 `greet`를 호출할 수 있으며, 도구 결과로 `Hello, Ada!`를 받습니다.

## 다음 단계

- [플러그인 설정](./config.md) — 인사말을 구성할 수 있도록 만드세요.
- [도구 작성 참조](../../../cookbook/adding-a-tool.md) — 중첩 스키마, 표준 값, 백그라운드 작업, 정책 훅, Code Mode 및 UI 카드를 찾아보세요.
- [기능 계층화](../practice/) — 교체 가능한 기능을 서비스 정의, 서비스 제공자 및 소비자 패키지로 분할하세요.
