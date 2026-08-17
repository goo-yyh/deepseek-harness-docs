# 서비스 및 종속성

서비스는 한 플러그인이 다른 플러그인에 노출하는 기능입니다. `inject`는 플러그인에 필요한 서비스를 선언합니다.

## 서비스란 무엇인가요?

Harness에서 `tools`, `llm`, `agents`는 서비스입니다. 각각은 `ctx`에 마운트되는 이름 있는 기능입니다.

```ts ignore-check
ctx.tools    // ToolRuntime service
ctx.llm      // LLM service
ctx.agents   // Agent service
```

모든 플러그인은 다른 플러그인이 사용할 서비스를 제공할 수 있습니다.

## 서비스 사용

기존 서비스를 사용하려면 `inject`를 선언합니다.

```ts ignore-check
export const inject = ['tools']

export function apply(ctx: Context) {
  // ctx.tools exists and is ready here.
  ctx.tools.register(/* ... */)
}
```

`apply`가 실행될 때 `inject`가 선언한 모든 서비스가 준비되어 있습니다. 서비스가 준비되지 않은 경우 플러그인은 실행되지 않고 대기합니다.

## 서비스 제공

### Service 확장

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

export default class MetricsService extends Service {
  static inject = ['llm']  // A service may depend on other services.

  constructor(ctx: Context) {
    super(ctx, 'metrics')  // 'metrics' is the service name.
  }

  // Public service method.
  record(event: string, value: number) {
    // ...
  }
}
```

이 플러그인을 로드한 후 소비자는 `ctx.metrics`로 서비스에 액세스합니다.

```ts ignore-check
export const inject = ['metrics']

export function apply(ctx: Context) {
  ctx.metrics.record('tool_call', 1)
}
```

### 유형 선언

TypeScript 선언 병합을 사용하여 `ctx.metrics`의 유형을 지정합니다.

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    metrics: MetricsService
  }
}

export default class MetricsService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'metrics')
  }

  record(event: string, value: number) { /* ... */ }
}
```

## 종속성 동작

### 필수 및 선택적 종속성

```ts ignore-check
// Required: the plugin does not load while the service is absent.
export const inject = ['tools']

// Optional: omit inject and query with ctx.get() at the use site.
export function apply(ctx: Context) {
  const metrics = ctx.get('metrics')
  metrics?.record('plugin_loaded', 1)
}
```

### 서비스가 사라지는 경우

애플리케이션이 실행되는 동안 필수 서비스가 사라지는 경우(예: 해당 제공자가 언로드되는 경우)는 다음과 같습니다.

1. 종속 플러그인은 자동으로 해제됩니다.
2. 서비스가 다시 제공되면 다시 로드됩니다.

이렇게 하면 플러그인이 더 이상 존재하지 않는 서비스를 호출하는 것을 방지할 수 있습니다.

## 서비스 격리

`cordis.yml`는 서비스를 격리하여 별도의 플러그인 그룹이 동일한 서비스의 별도 인스턴스를 보도록 할 수 있습니다.

```yaml
- id: group-a
  name: '@deepseek-ai/cordis-plugin-group'
  group: true
  isolate:
    shell: true
  config:
    - name: '@deepseek-ai/dsh-bash-local'
      config:
        timeoutMs: 5000
    - name: './src/plugin-a.ts'

- id: group-b
  name: '@deepseek-ai/cordis-plugin-group'
  group: true
  isolate:
    shell: true
  config:
    - name: '@deepseek-ai/dsh-bash-local'
      config:
        timeoutMs: 60000
    - name: './src/plugin-b.ts'
```

`plugin-a`와 `plugin-b`는 각각 자체 그룹의 Bash 인스턴스를 보며, 그룹 간에는 영향이 없습니다.

## 기본 제공 Harness 서비스

리포지토리는 서비스 이름, 공개 메서드 및 소스 위치를 각 서비스의 [하위 시스템 페이지](../../../subsystems/core.md)에 생성합니다. 플러그인을 개발할 때는 생성된 영역과 서비스의 TypeScript 인터페이스를 사용하고, 별도의 정적 목록은 유지하지 마세요.

## 다음 단계

- [이벤트 시스템](./events.md) — 긴밀한 결합 없이 플러그인 간에 통신합니다
- [기능 계층화](../practice/) — 서비스를 기능 인터페이스로 사용합니다
