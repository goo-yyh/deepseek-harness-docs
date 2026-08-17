# 2. 수명 주기와 효과

Cordis 플러그인은 설정 편집, 핫 리로드, 명시적 해제 또는 필수 서비스 손실로 언로드될 수 있습니다. Cordis API를 통해 만든 등록은 효과이며, 소유 플러그인이 언로드되면 취소됩니다. 해당 API 외부에서 관리되는 리소스는 `ctx.effect()`로 래핑해야 합니다.

## 효과

Cordis가 아직 관리하지 않는 리소스(타이머, 연결, 감시자)는 `ctx.effect()`로 래핑하고 disposer를 반환합니다.

`tmp/cordis-tutorial`에 `lifecycle.ts`를 만듭니다.

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'lifecycle-demo'

function heartbeat(ctx: Context) {
  console.log('heartbeat plugin loading')
  ctx.effect(() => {
    const timer = setInterval(() => console.log('tick'), 200)
    return () => {
      clearInterval(timer)
      console.log('heartbeat cleaned up')
    }
  })
}

export function apply(ctx: Context) {
  // Mount a child plugin and keep its fiber to dispose it later.
  const fiber = ctx.plugin(heartbeat)
  // The demo timer is itself an effect: if THIS plugin is unloaded first,
  // the pending callback is cancelled instead of firing on a dead app.
  ctx.effect(() => {
    const timer = setTimeout(async () => {
      await fiber.dispose()
      console.log('disposed')
      process.exit(0)
    }, 700)
    return () => clearTimeout(timer)
  })
}
```

`cordis.yml`가 이를 가리키게 합니다.

```yaml
- name: './lifecycle.ts'
```

실행하면(`node --import tsx ../../vendor/cordis/bin.js`) 다음 결과를 얻습니다.

```
heartbeat plugin loading
tick
tick
tick
heartbeat cleaned up
disposed
```

다음 세 가지에 유의하세요.

- `ctx.plugin(heartbeat)`는 **코드에서**  함수를 플러그인으로 마운트합니다. 이는 YAML 로더가 각 설정 항목에 수행하는 작업과 같습니다. 함수 플러그인에는 `apply` 메서드가 필요하지 않습니다. Cordis는 함수를 직접 호출하며 해당 이름은 진단 목적으로만 사용합니다. `apply` 메서드는 객체 형식인 `ctx.plugin({ apply(ctx) { /* ... */ } })`에만 필요합니다. 이 호출은 로드된 플러그인 인스턴스 하나의 런타임 핸들인 **fiber**를 반환합니다.
- 효과 본문은 로드 중에 실행되고, 반환하는 disposer는 언로드 중에 실행됩니다. 플러그인 수명 동안 사용하는 리소스의 disposer를 직접 호출할 필요는 없습니다.
- `fiber.dispose()`는 비동기 disposer를 포함한 모든 플러그인 정리가 끝난 후 완료되며, 마운트한 모든 자식 플러그인을 재귀적으로 언로드합니다.

## fiber 상태 머신

로드된 각 플러그인 인스턴스는 다음 상태를 거치는 fiber를 소유합니다.

```
PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED
                 ↘ FAILED
```

- **PENDING** — 선언되었지만 필수 서비스(3장)를 아직 사용할 수 없습니다.
- **LOADING / ACTIVE** — `apply`가 실행 중이거나 완료되었습니다.
- **FAILED** — `apply` 또는 설정 검증에서 예외가 발생했습니다.
- **UNLOADING / DISPOSED** — disposer가 실행 중이거나 모든 항목이 해제되었습니다.

[6장](06-composition-and-hmr.md)에서 PENDING을 다시 만나게 됩니다. 여기서는 "내 플러그인은 왜 아무것도 출력하지 않나요?"에 대한 일반적인 답입니다.

## 이미 효과인 항목

내장 등록 API는 이미 효과이므로 `ctx.effect()`를 직접 작성하는 경우는 드뭅니다.

- `ctx.on(event, listener)` — 언로드 시 리스너가 제거됩니다([4장](04-events.md)).
- `ctx.plugin(child)` — 자식은 부모와 함께 해제됩니다.
- 서비스 등록은 효과입니다. `ctx.tools.register(...)` 같은 Harness 레지스트리도 반환된 disposer를 호출 플러그인에 연결하므로 자동으로 해제됩니다([7장](07-into-the-harness.md)).

Cordis가 관리하지 않는 리소스는 `ctx.effect()` 내부에서 획득하고 이를 해제하는 disposer를 반환하세요. 그러면 Cordis가 핫 리로드를 포함한 언로드 과정에서 해당 해제를 호출합니다.

순서와 관련해 한 가지 주의할 점이 있습니다. disposer는 등록의 역순으로 시작하지만, 여러 **비동기**  disposer는 동시에 실행됩니다. 정리 단계가 순차적으로 실행되어야 한다면 하나의 disposer에 유지하고 그 안에서 await하세요.

다음: [서비스](03-services.md) — 플러그인이 기능을 공유하는 방법입니다.
