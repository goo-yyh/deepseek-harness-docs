# 첫 번째 플러그인

이 튜토리얼에서는 최소한의 Harness 플러그인을 만들고 Web UI에 로드합니다. [소스에서 실행 경로](../../../../README.md#run-from-source)를 완료한 리포지토리 체크아웃에서 시작합니다.

## 로컬 프로젝트 만들기

리포지토리 루트에서 튜토리얼용 임시 프로젝트를 만듭니다.

```sh
mkdir -p scratch-plugin/src
```

## 플러그인이란?

Harness에서 플러그인은 `apply` 함수를 내보내는 TypeScript 모듈입니다. 프레임워크는 플러그인을 로드할 때 `apply`를 호출하고, 플러그인이 기능을 등록하는 데 사용하는 `ctx` 컨텍스트 객체를 전달합니다.

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-plugin'

export function apply(ctx: Context) {
  // Register capabilities here.
}
```

이것으로 설정이 완료됩니다.

## 플러그인 파일 만들기

`scratch-plugin/src/my-plugin.ts`를 만듭니다.

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello-plugin'

export function apply(ctx: Context) {
  // Required dependencies are ready before apply runs.
  console.log('[hello-plugin] plugin loaded!')
}
```

## cordis.yml에 등록하기

리포지토리 루트에서 `pwd`를 실행한 다음, 로컬 플러그인을 삽입하는 Web 오버레이로 `scratch-plugin/cordis.yml`를 만듭니다. 아래의 `/absolute/path/to/deepseek-harness`를 출력된 경로로 바꿉니다.

```yaml
- insert:
    - id: hello
      name: '/absolute/path/to/deepseek-harness/scratch-plugin/src/my-plugin.ts'
```

플러그인 경로는 절대 경로여야 합니다. 패치 파일은 설정을 추가하지만 로더가 모듈 경로를 확인하는 프로필 디렉터리는 변경하지 않습니다.

해당 오버레이로 Web UI를 시작합니다.

```sh
pnpm dsh web --patch ./scratch-plugin/cordis.yml
```

`http://127.0.0.1:3080`를 엽니다. 시작 중에 터미널에 `[hello-plugin] plugin loaded!`가 출력됩니다.

## 자동 정리

이벤트 리스너, 도구 또는 타이머처럼 `ctx`를 통해 등록한 모든 항목은 플러그인이 언로드될 때 정리됩니다. removeListener 또는 clearInterval을 수동으로 호출할 필요가 없습니다.

네트워크 연결처럼 명시적인 정리가 필요한 리소스에는 `ctx.effect()`를 사용하여 해당 disposer를 제공합니다.

```ts
import type { Context } from '@deepseek-ai/cordis'

export function apply(ctx: Context) {
  ctx.effect(() => {
    const timer = setInterval(() => {
      console.log('heartbeat')
    }, 5000)

    // The returned function runs when the plugin unloads.
    return () => clearInterval(timer)
  })
}
```

## 의존성 선언하기

플러그인이 `tools` 또는 `llm` 같은 다른 서비스를 사용한다면 `inject`에 선언합니다.

```ts ignore-check
import type { Context } from '@deepseek-ai/cordis'

export const name = 'my-tool-plugin'
export const inject = ['tools']

export function apply(ctx: Context) {
  // ctx.tools is ready here.
  ctx.tools.register(/* ... */)
}
```

프레임워크는 필요한 모든 서비스를 기다린 후 플러그인을 로드합니다.

## 세 가지 플러그인 형식

함수 모듈 외에도 플러그인은 객체 또는 클래스 형식을 사용할 수 있습니다.

### 객체 형식

```ts
import type { Context } from '@deepseek-ai/cordis'

export default {
  name: 'my-plugin',
  inject: ['tools'],
  apply(ctx: Context) {
    // ...
  },
}
```

### 클래스 형식

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

export default class MyService extends Service {
  static inject = ['tools']

  constructor(ctx: Context) {
    super(ctx, 'myService')
    // Perform synchronous initialization in the constructor.
  }
}
```

대부분의 경우 함수 형식이면 충분합니다. 플러그인이 다른 플러그인에 서비스를 제공하는 경우에는 클래스 형식을 사용하세요. [서비스 및 의존성](../framework/service.md)을 참고하세요.

## 다음 단계

- [도구 만들기](./tool.md) — 도구 정의 DSL을 알아봅니다.
- [플러그인 설정](./config.md) — 사용자 설정을 받습니다.
- [Cordis 튜토리얼](../../../cordis-tutorial/index.md) — API 키 없이 임시 디렉터리에서 구축하는 기반 플러그인 프레임워크입니다.
