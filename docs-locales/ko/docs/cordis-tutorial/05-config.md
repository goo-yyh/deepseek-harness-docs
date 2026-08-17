# 5. 설정

각 `cordis.yml` 항목에는 `config` 블록을 포함할 수 있으며, 플러그인은 `apply`가 실행되기 전에 이를 검증하는 스키마를 선언합니다. 잘못된 설정은 정확한 오류와 함께 로드를 실패시킵니다. 플러그인은 불완전하게 설정된 상태로 시작하지 않습니다.

## 설정 가능한 플러그인

`tmp/cordis-tutorial`에 `config-demo.ts`를 만듭니다.

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'config-demo'

export interface Config {
  greeting: string
  targets: string[]
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  targets: Schema.array(String).default(['world']),
})

export function apply(ctx: Context, config: Config) {
  for (const target of config.targets) {
    console.log(`${config.greeting}, ${target}!`)
  }
}
```

내보낸 `Config`는 동일한 이름의 TypeScript 인터페이스이자 런타임 스키마입니다. 소비자는 타입을 받고 Cordis는 검증기를 받습니다. 이 리포지토리는 스키마에 [Schemastery](https://github.com/shigma/schemastery)를 사용합니다. Cordis 자체는 모든 [Standard Schema](https://standardschema.dev/) 검증기를 허용하므로, `Config`로 내보낸 일반 객체는 작동하지 않습니다.

다음과 같이 설정합니다.

```yaml
- name: './config-demo.ts'
  config:
    targets: ['alpha', 'beta']
```

실행합니다.

```
Hello, alpha!
Hello, beta!
```

`greeting`가 생략되었으므로 스키마 기본값이 이를 채웁니다. `apply`는 항상 완전하고 검증된 설정을 받습니다.

## 명확하게 실패시키기

이제 잘못된 값을 입력해 보겠습니다.

```yaml
- name: './config-demo.ts'
  config:
    targets: 'not-an-array'
```

```
ValidationError: invalid config:
  - $.targets expected array but got not-an-array (at targets)
```

플러그인의 fiber는 FAILED 상태가 되며, 이 튜토리얼의 실행기는 오류를 출력한 뒤 상태 1로 종료합니다. 플러그인은 사용할 수 없는 리소스나 provider를 지정하는 스키마상 유효한 설정도 해당 참조를 확인할 수 있게 되는 즉시 거부해야 합니다.

## 계산된 설정값

이 리포지토리에서 사용하는 로더는 로드 시점에 계산해야 하는 설정값을 위해 `!!js` 태그를 지원합니다.

```yaml
- name: './config-demo.ts'
  config:
    greeting: !!js process.env.DEMO_GREETING ?? 'Hello'
```

`!!js`는 `config` 내부와 항목의 `disabled` 필드에서만 작동합니다. `disabled: !!js ...`는 모든 마운트 결정 시 로더 컨텍스트에 대해 평가되므로(이 리포지토리의 확장), 행은 플랫폼이나 환경에 따라 스스로를 게이트할 수 있습니다. 다른 메타데이터(`name`, `id`, `inject`, ...)는 표현식이 일반적인 truthy 데이터가 되는 정적 상태로 유지됩니다. [로더 설정](../cordis-primer.md#loader-configuration)을 참조하세요.

다음: [구성과 HMR](06-composition-and-hmr.md) — `cordis.yml`를 애플리케이션으로 다룹니다.
