# 1. 첫 번째 플러그인

여기에서 사용하는 로더 설정에서 Cordis 플러그인 모듈은 `apply` 함수를 이름 내보내기로 제공합니다. Cordis가 이를 로드하면 플러그인이 제공하는 모든 항목을 등록하는 `ctx` 객체인 **컨텍스트** 와 함께 `apply`를 호출합니다.

## 플러그인 작성

`tmp/cordis-tutorial` 디렉터리에서([설정](index.md#setup) 참고) `hello.ts`를 생성합니다.

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'hello'

export function apply(ctx: Context) {
  console.log('hello from my first plugin')
}
```

`name` 내보내기는 선택적 표시 메타데이터이며, 진단 정보에서 플러그인에 레이블을 지정합니다.

## 앱 구성

이 튜토리얼의 실행기는 설정으로 애플리케이션을 조립합니다. `cordis.yml`를 생성합니다.

```yaml
- name: './hello.ts'
```

이 파일은 플러그인 항목 목록입니다. `name`은 상대 경로나 npm 패키지 이름인 모듈 지정자이며, 로더는 모든 항목을 마운트합니다. 항목은 동시에 시작되므로 목록 위치는 어떤 플러그인이 먼저 로드되는지 보장하지 않습니다. 순서는 파일 내 위치가 아니라 서비스 종속성(`inject`, [3장](03-services.md))에서 결정됩니다.

## 실행

```sh
node --import tsx ../../vendor/cordis/bin.js
```

예상 출력:

```
hello from my first plugin
```

실행 중인 항목이 더 이상 없으면 프로세스는 자동으로 종료됩니다. 수행된 작업은 다음과 같습니다.

1. 실행기는 루트 `Context`를 생성하고 **Loader**  플러그인을 마운트했습니다.
2. Loader는 `cordis.yml`를 읽고 `./hello.ts`를 확인한 뒤 자식 플러그인으로 마운트했습니다.
3. Cordis가 사용자의 `apply(ctx)`를 호출했습니다.

파일에는 프레임워크 부트스트랩 코드가 없습니다. 플러그인은 자신이 제공하는 항목을 설명하고, `cordis.yml`가 애플리케이션을 구성합니다. 예를 들어 [`dsh` 기반](../../packages/bundle/base/cordis.patch.yml)은 배포 오버레이가 패치하는 더 긴 플러그인 구성입니다.

## 나머지 두 가지 플러그인 형태

함수는 가장 일반적인 형태이지만, Cordis는 세 가지를 허용합니다.

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

// 1. Function plugin (what you just wrote).
export function apply(ctx: Context) {}

// 2. Object plugin: an object with an `apply` method.
export const objectPlugin = {
  name: 'object-plugin',
  apply(ctx: Context) {},
}

// 3. Class plugin: a Service subclass (covered in chapter 3).
export class MyService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'myTutorialService')
  }
}
```

서비스를 노출해야 할 때까지는 함수 형태를 사용합니다. 클래스 형태가 필요한 경우는 [3장](03-services.md)에서 다룹니다.

## 의도적으로 오류 내기

`apply`에서 예외를 발생시키도록 합니다.

```ts ignore-check
export function apply(ctx: Context) {
  throw new Error('apply exploded')
}
```

다시 실행하면 프로세스가 사용자의 오류와 함께 종료됩니다. 로드에 실패한 플러그인은 건너뛰는 항목이 아니라 명확하게 실패하는 항목입니다.

초기에 알아 둘 만한 한 가지 주의사항이 있습니다. 모듈을 **확인할 수 없는**  설정 항목(오타가 있는 경로나 패키지 이름)은 프로세스를 중단하는 대신 Cordis 로거 서비스를 통해 보고됩니다. 부팅 시에는 콘솔 내보내기가 감시하기 전에 이 보고가 유실될 수 있습니다. 새로 추가한 항목이 아무 작업도 하지 않는 것처럼 보이면 먼저 철자를 확인하세요.

다음: [수명 주기와 효과](02-lifecycle-and-effects.md) — 플러그인이 언로드될 때 발생하는 일입니다.
