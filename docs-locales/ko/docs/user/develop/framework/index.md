# 플러그인과 수명 주기

이 페이지에서는 Cordis 플러그인 모델과 수명 주기 상태 머신을 설명합니다.

## Fiber 상태 머신

로드된 모든 플러그인은 다음 상태를 갖는 **Fiber**  범위를 소유합니다.

```
PENDING → LOADING → ACTIVE
                 ↘ FAILED
ACTIVE → UNLOADING → DISPOSED
```

| 상태 | 의미 |
|------|------|
| PENDING | 선언되었지만 필수 종속성이 준비되지 않았습니다 |
| LOADING | 종속성이 준비되었으며 `apply`가 실행 중입니다 |
| ACTIVE | 플러그인이 실행 중입니다 |
| FAILED | `apply`에서 오류가 발생했습니다 |
| UNLOADING | 플러그인을 언로드하고 리소스를 해제하고 있습니다 |
| DISPOSED | 플러그인이 완전히 언로드되었습니다 |

## 종속성 기반 로딩

`inject`를 사용하는 플러그인은 로드되기 전에 모든 필수 서비스를 기다립니다.

```ts ignore-check
export const inject = ['tools', 'llm']

export function apply(ctx: Context) {
  // ctx.tools and ctx.llm are ready here.
}
```

예를 들어 제공자 교체 중에 필수 서비스가 사라지면 플러그인은 자동으로 언로드되고(ACTIVE → DISPOSED), 서비스가 다시 나타나면 다시 로드됩니다.

## 자동 정리

`ctx`를 통해 수행한 모든 등록은 플러그인이 언로드될 때 취소됩니다.

```ts ignore-check
export function apply(ctx: Context) {
  // Event listener: removed automatically on unload.
  ctx.on('some-event', handler)

  // Custom resource: the returned disposer runs on unload.
  ctx.effect(() => {
    const connection = createConnection()
    return () => connection.close()
  })
}
```

프레임워크는 이러한 모든 작업을 추적하고 해제합니다.
- `ctx.on(event, handler)` — 이벤트 리스너
- `ctx.tools.register(tool)` — 도구 등록
- `ctx.llm.registerAdapter(names, adapter)` — LLM 어댑터 등록
- `ctx.effect(() => cleanup)` — 사용자 지정 리소스

언로드 중에는 등록의 역순으로 disposer 호출이 시작되지만, 여러 비동기 disposer는 동시에 실행되며 직렬 완료를 보장하지 않습니다. 순서에 의존하는 정리는 하나의 `ctx.effect()`에서 반환하는 disposer에 넣고, այնտեղ에서 단계를 직렬로 await하세요.

## 중첩된 컨텍스트

`ctx.plugin()`는 부모 컨텍스트를 상속하지만 독립적인 수명 주기를 갖는 하위 Fiber를 생성합니다.

```ts ignore-check
export function apply(ctx: Context) {
  // Register a child plugin.
  ctx.plugin(childPlugin)

  // The child has its own Fiber and unloads with its parent.
}
```

## 해제 의미론

플러그인 인스턴스를 조기에 중지하려면 다음을 수행합니다.

```ts
import type { Context } from '@deepseek-ai/cordis'

declare const ctx: Context
declare function myPlugin(ctx: Context): void

const fiber = ctx.plugin(myPlugin)

// Dispose it manually later.
await fiber.dispose()
```

`dispose`는 다음을 보장합니다.
1. 플러그인이 소유한 모든 등록이 제거됩니다.
2. 하위 플러그인이 재귀적으로 언로드됩니다.
3. 모든 비동기 정리가 완료된 후 반환된 promise가 이행됩니다.

## 핫 교체(HMR)

`@deepseek-ai/cordis-plugin-hmr`가 `cordis.yml`에서 로드된 경우, 플러그인 소스 파일을 편집하면 다음이 수행됩니다.

1. 기존 플러그인을 언로드하고 해당 등록을 정리합니다.
2. 새 코드를 로드합니다.
3. 새 `apply`를 실행합니다.

플러그인 등록은 자체적으로 정리되므로 핫 교체 후에는 이전 인스턴스의 등록이 남지 않습니다.

## 수명 주기 예제

```ts ignore-check
export function apply(ctx: Context) {
  console.log('plugin loading')

  ctx.effect(() => {
    console.log('effect registered')
    return () => console.log('effect cleaned up')
  })
}
```

로딩 시 다음이 출력됩니다.
```
plugin loading
effect registered
```

언로드 시 다음이 출력됩니다.
```
effect cleaned up
```

## 다음 단계

- [서비스와 종속성](./service.md) — 다른 플러그인에 기능을 노출합니다
- [이벤트 시스템](./events.md) — 플러그인 간에 통신합니다
- [Cordis 튜토리얼](../../../cordis-tutorial/index.md) — Cordis 런타임에서 동일한 수명 주기, 서비스 및 이벤트를 단계별로 구성합니다
