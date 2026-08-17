# 6. 구성과 HMR

지금까지 만든 모든 기능은 플러그인이며, `cordis.yml`은(는) 애플리케이션의 플러그인 트리를 선택합니다. 이 장에서는 구성을 변경하고, 플러그인을 핫 리로드하며, 전혀 로드되지 않는 플러그인을 진단합니다.

## 엔트리는 이름 이상의 의미를 가집니다

구성 엔트리는 `name` 및 `config` 외에도 메타데이터를 허용합니다.

```yaml
- id: greeter          # stable identity for this entry
  name: './greeter.ts'
- id: consumer
  name: './consumer.ts'
  disabled: true       # keep the entry, skip mounting it
```

`id`은(는) 로더가 기존 엔트리의 수정과 제거 후 추가를 구분할 수 있도록 엔트리에 안정적인 ID를 부여합니다. `disabled: true`은(는) 엔트리를 삭제하지 않고 플러그인을 마운트 해제합니다. 다시 켜면 플러그인과 그 서비스에서 PENDING 상태인 모든 항목이 다시 로드됩니다.

그룹은 하나의 단위로 로드 및 언로드되는 엔트리 하위 목록을 중첩하며, `isolate`은(는) 그룹에 서비스 이름의 자체 인스턴스를 부여합니다. 즉, 두 그룹은 서로에게 영향을 주지 않고 각각 다르게 구성된 `shell` 제공자를 볼 수 있습니다. 자세한 내용은 [Cordis 입문서](../cordis-primer.md) 및 [서비스 격리 예제](../user/develop/framework/service.md#service-isolation)를 참조하세요.

## 핫 모듈 교체

언로드는 이펙트를 해제하고([2장](02-lifecycle-and-effects.md)), 로드는 종속성을 따르므로([3장](03-services.md)), HMR은 실행 중인 플러그인을 언로드한 뒤 로드하여 교체할 수 있습니다. `@deepseek-ai/cordis-plugin-hmr` 플러그인은 파일을 감시하고 저장 시 정확히 이를 수행합니다.

`tmp/cordis-tutorial`에서 `cordis.yml`을(를) 작성하세요.

```yaml
- id: logger
  name: '@deepseek-ai/cordis-plugin-logger-console'
- id: timer
  name: '@deepseek-ai/cordis-plugin-timer'
- id: hmr
  name: '@deepseek-ai/cordis-plugin-hmr'
  config:
    root: ['.']
- id: hello
  name: './hello.ts'
```

지원 플러그인 두 개가 목록에 추가되었습니다. HMR은 Cordis 로거 서비스를 통해 로그를 기록하므로 콘솔 내보내기가 없으면 해당 메시지를 볼 수 없으며, 디바운싱을 위해 `timer` 서비스를 `inject`합니다. `@deepseek-ai/cordis-plugin-timer`이 없으면 조용히 영원히 PENDING 상태에 머뭅니다. 이 침묵이 다음 절의 주제입니다.

HMR은 Loader의 네이티브 도우미를 통해 Node의 로더 내부 구조를 읽습니다. tsx에서 Cordis를 실행하세요.

```sh
node --import tsx ../../vendor/cordis/bin.js
```

이제 `hello.ts`을(를) 수정하세요. 로그 메시지를 변경한 다음 저장합니다.

```
hello from my first plugin
2026-07-22 15:44:36 [I] hmr watching [ '.' ]
2026-07-22 15:44:39 [I] hmr reload plugin at hello.ts
hello from my EDITED plugin
```

이전 인스턴스가 언로드되고(모든 이펙트가 되돌려짐), 새 코드가 로드된 후 `apply`이(가) 다시 실행되었습니다. Ctrl-C로 프로세스를 중지하세요. `cordis.yml` 자체를 편집해도 감지됩니다. 로더는 `id`을(를) 기준으로 엔트리를 비교하고 변경된 항목만 마운트, 마운트 해제 또는 재구성합니다. 따라서 위 엔트리에는 명시적인 `id`이(가) 있습니다. 이것이 없으면 읽을 때마다 생성된 ID를 받으므로, 구성 파일을 수정할 때마다 해당 줄 자체가 변경되지 않았더라도 제거 후 추가된 것으로 간주되어 다시 마운트됩니다.

## 전혀 로드되지 않는 플러그인 진단하기

종속성 기반 로딩의 반대 측면은 다음과 같습니다. `inject`이(가) 아무도 제공하지 않는 서비스의 이름을 지정한 플러그인은 아무것도 출력하지 않은 채 영원히 대기합니다. 오류는 아닙니다. 제공자는 나중에 마운트될 수 있으므로 PENDING은 정상적인 상태입니다.

상태를 직접 확인할 수 있습니다. 모든 컨텍스트는 플러그인 레지스트리를 열거할 수 있습니다. `diagnose.ts`을(를) 만드세요.

```ts
import { FiberState, type Context } from '@deepseek-ai/cordis'

export const name = 'diagnose'

export function apply(ctx: Context) {
  setTimeout(() => {
    for (const runtime of ctx.registry.values()) {
      for (const fiber of runtime.fibers) {
        if (fiber.state === FiberState.PENDING) {
          console.log(`${fiber.name} is PENDING — a required service is missing`)
        }
      }
    }
  }, 500)
}
```

그리고 충족할 수 없는 종속성을 가진 플러그인인 `needs-timer.ts`을(를) 만드세요.

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'needs-timer'
export const inject = ['timer']

export function apply(ctx: Context) {
  console.log('needs-timer loaded')
}
```

```yaml
- name: './needs-timer.ts'
- name: './diagnose.ts'
```

실행하세요(일반 `node --import tsx ../../vendor/cordis/bin.js`이며 Ctrl-C로 중지합니다).

```
needs-timer is PENDING — a required service is missing
```

`inject: ['timer']`에는 제공자가 없습니다. 목록에 `- name: '@deepseek-ai/cordis-plugin-timer'`을(를) 추가하면 플러그인이 로드됩니다. 플러그인이 아무 작업도 하지 않고 아무것도 보고하지 않으면 fiber 상태를 검사하세요. PENDING 필터 없이 반복하면 플러그인이 구성 파일 자체를 마운트하므로 로더 자체의 플러그인(Loader, Include)도 ACTIVE fiber로 표시됩니다.

다음: [하니스 내부로](07-into-the-harness.md) — 실제 harness 서비스를 대상으로 동일한 패턴을 적용합니다.
