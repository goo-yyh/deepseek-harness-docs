# Cordis 튜토리얼

Cordis는 DeepSeek Harness의 기반이 되는 플러그인 프레임워크입니다. 도구, LLM 어댑터, 파일 액세스, 에이전트 루프 자체를 포함한 모든 기능이 공유 컨텍스트에 마운트되는 플러그인인 작은 런타임입니다. 이 튜토리얼에서는 Cordis를 실습으로 익힙니다. 각 장은 이 저장소 안의 스크래치 디렉터리에서 빌드하는 실행 가능한 예제이며, 마지막에는 실제 harness 서비스에 연결된 플러그인을 완성합니다.

대상 독자는 에이전트 개발자입니다. TypeScript를 깊이 있게 알 필요는 없습니다. 아래의 [TypeScript 참고 사항](#typescript-notes)에서 낯설 수 있는 구문을 설명하며, 모든 장에서 정확한 명령과 예상 출력을 보여 줍니다.

둘러보기 대신 간결한 개념 참고 자료가 필요하다면 [Cordis 입문서](../cordis-primer.md)를 읽어 보세요. 포괄적인 API 참고 자료는 생성된 `cordis-surface` 영역의 [하위 시스템 페이지](../subsystems/core.md)와 [Cordis 핵심 API](../cordis-api/context.md) 페이지에 있습니다.

아래 런처가 아니라 `cordis.yml`에서 로드되고 Web UI에서 구동되는 harness 자체용 플러그인을 작성하려면 [첫 Harness 플러그인](../user/develop/basic/index.md)부터 시작하세요.

## 설정

종속성이 설치된 이 저장소의 복제본이 필요합니다. [개발 가이드](../development.md#setup-tutorial)에 필수 조건이 나와 있습니다. 이 튜토리얼에는 API 키가 필요하지 않으며, 모든 예제는 키 없이 실행됩니다.

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
```

각 장에서 작업할 스크래치 디렉터리를 만듭니다. `tmp/`는 gitignore 처리되므로, 여기에 작성하는 내용은 버전 관리에 영향을 주지 않습니다.

```sh
mkdir -p tmp/cordis-tutorial
cd tmp/cordis-tutorial
```

모든 장에서는 이 디렉터리에서 동일한 명령을 실행합니다.

```sh
node --import tsx ../../vendor/cordis/bin.js
```

이 단일 파일 런처([vendor/cordis/bin.js](../../vendor/cordis/bin.js) 참조)는 루트 `Context`를 만들고 Loader 플러그인을 마운트한 다음, 현재 디렉터리에서 `./cordis.yml`를 로드하도록 지시합니다. 다른 모든 사항, 즉 존재하는 플러그인과 설정 방식은 곧 작성할 해당 YAML 파일에서 결정됩니다. `--import tsx` 플래그를 사용하면 빌드 단계 없이 Node가 설정이 가리키는 TypeScript 파일을 실행할 수 있습니다.

## 장

1. [첫 플러그인](01-first-plugin.md) — 플러그인은 함수이며, 로더가 이를 마운트합니다.
2. [수명 주기와 효과](02-lifecycle-and-effects.md) — Cordis가 관리하는 등록은 플러그인이 언로드될 때 해제됩니다.
3. [서비스](03-services.md) — `ctx`에서 기능을 노출하고 `inject`로 이에 의존합니다.
4. [이벤트](04-events.md) — 형식화된 이벤트, 브로드캐스트 디스패치, 워터폴 단락 처리입니다.
5. [구성](05-config.md) — `cordis.yml`의 검증된 설정과 잘못된 입력에 대한 명시적 실패입니다.
6. [구성과 HMR](06-composition-and-hmr.md) — 플러그인 트리로서의 설정 파일, 핫 리로드, 그리고 전혀 로드되지 않는 플러그인 진단입니다.
7. [harness로 연결하기](07-into-the-harness.md) — 실제 harness 서비스에 모델 호출 가능 도구를 등록합니다.

<a id="typescript-notes"></a>

## TypeScript 참고 사항

예제에서는 일반적인 최신 JavaScript 외에 세 가지 TypeScript 기능을 사용합니다.

- **형식 주석** 은 런타임 동작을 바꾸지 않고 값을 설명합니다. `ctx: Context`는 `ctx`에 Cordis 컨텍스트 API가 있음을, `who: string`는 텍스트를 받음을, `string[]`는 문자열 배열을 의미합니다.
- **`import type { Context } from '@deepseek-ai/cordis'`** 은 형식 정보만 가져옵니다. 런타임에는 사라지므로, 주석에만 `Context`가 필요한 플러그인 파일은 런타임 종속성을 추가하지 않습니다.
- **선언 병합** (`declare module '@deepseek-ai/cordis' { ... }`)은 Cordis가 이미 선언한 인터페이스에 항목을 추가합니다. 예를 들어 새 `ctx.greeter` 속성이나 이벤트 이름의 형식에 적용됩니다. 런타임 연결은 생성하지 않으며, 플러그인이 별도로 서비스를 제공하거나 이벤트를 발생시킵니다. 3장에서 이 패턴을 자세히 보여 줍니다.

5장에서는 구성 객체의 필드를 설명하기 위해 `interface`도 사용하고, 스키마가 검증하는 객체 필드를 지정하기 위해 `Schema<Config>`와 같은 제네릭 형식을 사용합니다. 표시된 대로 이러한 선언을 복사할 수 있으며, 주변 텍스트에서 각각이 연결하는 대상을 설명합니다.
