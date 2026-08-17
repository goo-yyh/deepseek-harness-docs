# 3. 서비스

**서비스** 는 하나의 플러그인이 제공하고 다른 플러그인이 `ctx`을 통해 사용하는 이름 있는 기능입니다. Harness에서 `ctx.tools`, `ctx.llm`, `ctx.agents`은 서비스입니다. 소비자는 제공자를 가져오는 대신 `'tools'`과 같은 기능의 이름을 지정하므로, 소비자를 변경하지 않고도 설정에서 제공자를 선택할 수 있습니다.

## 서비스 제공

`greeter.ts`에 `tmp/cordis-tutorial`을 만듭니다.

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    greeter: GreeterService
  }
}

export class GreeterService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'greeter')
  }

  greet(who: string) {
    return `Hello, ${who}!`
  }
}

export const name = 'greeter'

export function apply(ctx: Context) {
  ctx.plugin(GreeterService)
}
```

두 가지 요소가 함께 작동합니다.

- **런타임**: `super(ctx, 'greeter')`은 인스턴스를 `greeter`이라는 이름으로 등록합니다. 이후 모든 플러그인은 `ctx.greeter`으로 이에 접근할 수 있습니다. 등록은 이펙트이므로 제공자를 언로드하면 서비스가 제거됩니다.
- **컴파일 시간**: `declare module '@deepseek-ai/cordis'` 블록은 TypeScript 선언 병합입니다. 이는 `greeter`을 `Context` 인터페이스에 추가하여 `ctx.greeter`이 어디서나 타입 검사를 통과하게 합니다. 코드는 생성하지 않습니다. 이것이 없어도 서비스는 런타임에서 계속 작동하지만, 소비자는 타입 안전성을 잃습니다.

`Service` 하위 클래스 자체가 플러그인(1장에서 소개한 클래스 형식)이므로, `ctx.plugin(GreeterService)`은 다른 플러그인과 마찬가지로 이를 마운트합니다.

## `inject`으로 서비스 사용

`consumer.ts`을 만듭니다.

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'consumer'
export const inject = ['greeter']

export function apply(ctx: Context) {
  console.log(ctx.greeter.greet('world'))
}
```

`inject`은 이 플러그인에 필요한 서비스를 나열합니다. Cordis는 나열된 모든 서비스가 존재할 때까지 플러그인을 PENDING 상태로 유지하므로, `apply` 내부에서는 `ctx.greeter`이 준비되었음이 보장됩니다. `cordis.yml`의 로드 순서는 중요하지 않습니다. 플러그인 시작 시점은 파일 순서가 아니라 의존성이 결정합니다.

구성하고 실행합니다.

```yaml
- name: './greeter.ts'
- name: './consumer.ts'
```

```
Hello, world!
```

`cordis.yml`의 두 줄을 바꾸고 다시 실행해 보세요. 출력은 동일합니다. `./greeter.ts`을 완전히 제거해 보세요. 소비자는 PENDING 상태로 유지되고 아무것도 출력하지 않습니다. 충돌도 부분 실행도 없습니다. PENDING fiber는 Node의 이벤트 루프를 유지하지 않으므로, 실행 중인 다른 항목이 없는 구성은 아무 출력 없이 종료 코드 0으로 종료됩니다. [6장](06-composition-and-hmr.md)에서는 이 상태를 진단하는 방법을 설명합니다.

## 로드 후에도 추적되는 의존성

`inject`은 일회성 부팅 검사가 아닙니다. 앱 실행 중 필수 서비스가 사라지면(제공자가 언로드되었거나 핫 교체된 경우) 모든 종속 플러그인도 언로드되며, 서비스가 돌아오면 다시 로드됩니다. 이펙트([2장](02-lifecycle-and-effects.md))와 결합하면 실행 중인 소비자가 사용할 수 없는 서비스에 대한 참조를 유지하지 않도록 방지합니다. 의존성이 사라지면 소비자 자체의 등록도 되돌려집니다.

이것이 서비스 교체가 설정에서 작동하는 이유이기도 합니다. `dsh-bash-local` 항목을 언로드하고 다른 `shell` 제공자를 마운트하면, `'shell'`을 주입하는 모든 플러그인이 새 구현에 맞춰 깔끔하게 다시 시작됩니다.

## 선택적 의존성

`inject`은 필수 요구 사항에 사용합니다. 플러그인이 없어도 동작할 수 있는 기능이라면 `inject`을 생략하고 사용하는 위치에서 확인합니다.

```ts ignore-check
export function apply(ctx: Context) {
  // undefined when no provider is loaded; the plugin still runs.
  const greeter = ctx.get('greeter')
  console.log(greeter?.greet('maybe') ?? 'no greeter available')
}
```

## 이름 지정

서비스 이름은 애플리케이션마다 하나의 평면 네임스페이스에 존재합니다. 고유한 접두사 또는 네임스페이스를 사용해 자체 서비스를 구분하세요(Harness는 `tools` 및 `llm`과 같은 일반 이름을 사용합니다). [하위 시스템 페이지](../subsystems/core.md)의 생성된 `cordis-surface` 영역에는 Harness가 등록하는 모든 이름이 나열됩니다.

다음: [이벤트](04-events.md) — 공유 서비스를 사용하지 않는 통신.
