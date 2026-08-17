# 플러그인 설정

`cordis.yml`를 통해 제공되는 설정을 허용합니다.

## Config 타입 정의

`Config` 타입과 같은 이름의 Schemastery 스키마를 내보냅니다. 기본값은 스키마 필드에 직접 지정합니다.

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'my-plugin'

export interface Config {
  greeting: string
  maxRetries: number
  verbose?: boolean
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  maxRetries: Schema.number().default(3),
  verbose: Schema.boolean().default(false),
})

export function apply(ctx: Context, config: Config) {
  console.log(config.greeting)  // User value or schema default.
}
```

삽입된 로컬 플러그인 행에 설정을 추가합니다. `scratch-plugin/cordis.yml`:

```yaml
- insert:
    - id: hello
      name: './src/my-plugin.ts'
      config:
        greeting: 'Hi there'
        maxRetries: 5
```

플러그인을 로드할 때 Cordis는 내보낸 스키마를 사용하여 설정을 검증하고 기본값을 채웁니다. 일반 객체를 `Config`로 내보내지 마세요. 이는 Cordis에 필요한 Standard Schema 인터페이스를 구현하지 않습니다.

## 스키마 검증

Schemastery를 사용하여 더 엄격한 검증을 표현합니다.

```ts
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'

export const name = 'validated-plugin'

export interface Config {
  apiKey: string
  timeout: number
  mode: 'fast' | 'accurate'
}

export const Config = Schema.object({
  apiKey: Schema.string().required(),
  timeout: Schema.number().default(30000),
  mode: Schema.union(['fast', 'accurate']).default('fast'),
})

export function apply(ctx: Context, config: Config) {
  // config is validated and type-safe.
}
```

스키마는 플러그인을 로드하는 동안 실행됩니다. 잘못된 설정은 실행 가능한 오류 메시지와 함께 로드에 실패하게 합니다.

## 설계 원칙

### 조정 가능한 값을 하드코딩하지 않기

Harness는 **두 배포 환경에서 서로 다르게 설정할 수 있는 모든 항목이 설정 필드여야 한다고 요구합니다**.

```ts
// Wrong: hardcoded timeout.
const TIMEOUT = 30000

// Correct: configurable.
export interface Config {
  timeoutMs: number  // Defaults to 30000.
}
```

코드를 수정하지 않고 `cordis.yml`가 값을 변경할 수 있는지가 기준입니다.

### 잘못된 설정은 명확하게 실패시키기

잘못된 설정이 플러그인을 로드하는 동안 실패하도록 스키마에 자체 완결적인 제약 조건을 표현합니다. 서비스 또는 등록된 리소스에 대한 참조에는 의존성 주입이 필요합니다. [서비스 튜토리얼](../framework/service.md)에서 이 계약을 소개합니다.

## HMR과 함께 작업하기

설정을 수정하면 플러그인이 핫 리플레이스됩니다. 프레임워크는 기존 인스턴스를 언로드하고 새 인스턴스를 로드합니다. 등록은 효과이며 스스로 정리되므로, 교체 후에도 기존 인스턴스의 등록이 남지 않습니다.

## 다음 단계

- [플러그인 패키징 및 설치](./publish.md) — 플러그인을 설치 가능한 패키지로 배포합니다
- [플러그인 및 수명 주기](../framework/) — 전체 플러그인 수명 주기를 이해합니다
- [서비스 및 의존성](../framework/service.md) — 다른 플러그인에 서비스를 제공합니다
