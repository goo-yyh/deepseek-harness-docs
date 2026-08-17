# Cookbook: 워크스페이스 패키지 추가

새 `@deepseek-ai/dsh-<name>` 패키지를 위한 파일별 체크리스트입니다. 이 체크리스트는 bash 및 adapter 패키지를 템플릿으로 하여 검증됩니다. 이들과 차이가 생기면 여기에서 수정합니다.

## 1. 패키지 만들기

```
packages/<group>/<pkg>/
  package.json     # copy from packages/core/tools, adjust name/description/deps
  tsconfig.json    # extends ../../../tsconfig.base.json, rootDir src,
                   # outDir lib/types, references: ../../../vendor/cosmokit,
                   # ../../../vendor/cordis (+ ../../../vendor/schemastery if
                   # you use Config, + ../../<group>/<dep> for each dsh dep)
  src/index.ts     # service default export or plugin (name/inject/apply/Config)
  README.md        # service API, events, extension points, design notes,
                   # + gated Model Experience context blocks or short form
                   # + the gated "Known Limitations and Deferred Work" section
                   # (or a whitelist entry in scripts/verify-package-readme-limitations.ts)
```

패키지 역할과 일치하는 기존 그룹(`core`, `llm`, `bash`, `compact`, `subagent`, `todo`, `session-persistence`, `ui`, `util` 또는 `support`)을 선택합니다. 새 그룹도 허용되지만, 이는 순수 컨테이너입니다. `package.json`도 없고 소스 파일도 없으며, 패키지는 그 바로 한 단계 아래에 위치해야 합니다.

package.json 불변 조건(`pnpm run constraints` / `scripts/check-workspace-constraints.ts`에서 강제됨): `private: true`, 루트 `package.json`와 일치하는 `version`, `type: module`, `main: "lib/index.js"`, `types: "lib/types/index.d.ts"`, `exports["."].types: "./lib/types/index.d.ts"`, 그리고 peerDependencies와 devDependencies 모두에 동일한 범위로 포함되는 `exports["."].default: "./lib/index.js"` 및 `@deepseek-ai/cordis`입니다. 모든 dsh 피어 의존성은 devDependencies에도 반영합니다. `@deepseek-ai/schemastery`는 런타임 검증기이므로 `dependencies`에 넣고 agent-loop와 일치시킵니다. `files` 목록에는 정확히 `lib/index.js`, `lib/invariant.js`, `lib/types/**/*.d.ts` 및 게이트에서 인식하는 패키지별 런타임 아티팩트가 포함됩니다. 런타임 내보내기가 생성 트리를 가리키는 패키지에는 `lib/types/**/*.js`도 포함합니다. `src`, 선언 맵, JS 맵 또는 오래된 루트 선언 파일을 게시하지 마세요. 패키지 `bin`가 있는 CLI 앱 패키지는 `files`에서 `lib/index.js` 바로 뒤에 `lib/bin.js`을 포함합니다.

패키지 내부 상대 import는 소스에서 명시적 `.ts` 지정자를 사용합니다(예: `export * from './types.ts'`). 컴파일러는 생성된 JS에서 이를 `.js`로 다시 작성하고, 선언에는 명시적 `.ts` 지정자를 남깁니다. 표준 NodeNext/Node16 TypeScript 소비자는 이를 같은 위치의 `.d.ts` 파일로 해석합니다.

## 2. 루트 구성에 등록하기

| 파일 | 변경 사항 |
|---|---|
| `tsconfig.base.json` | 기존 그룹은 수정하지 않습니다. 새 그룹은 `@deepseek-ai/dsh-*` 와일드카드에 `./packages/<group>/*/src` 후보를 추가합니다. |
| `tsconfig.host.json`(Host 패키지) 또는 `tsconfig.client.json`(Client 패키지) | `references`에 `{ "path": "./packages/<group>/<pkg>" }`을 추가합니다. 일반 패키지는 정확히 하나의 집계에만 속하며, 둘 모두에 속하지 않습니다. `api/remotes`은 Host가 이후 단계에서 Client가 소비하는 계약을 생성하므로 리포지토리별 분리를 사용합니다. 새 패키지에서 이를 복사하면 안 됩니다([레이아웃](../development.md#typescript-project-layout)). |
| `knip.json` | 리포지토리 검색에서 이미 다루지 않는 진입점이 패키지에 있을 때만 수정합니다. |

`packages/client/*` 패키지는 추가로 `tsconfig.base.json` 대신 `tsconfig.base.client.json`을 확장합니다. 또한 클라이언트 플러그인 패키지는 package.json에 `dsh.client`을 선언하고, `./client`을 내보내며, 공유 tsdown 프리셋(`packages/client/tsdown.client.ts`)을 호출합니다. 클라이언트 측 계약은 [packages/client/AGENTS.md](../../packages/client/AGENTS.md)을 참조하세요.

글롭 또는 패키지 매니페스트 검색으로 자동 처리되므로 수정할 필요가 없습니다. 루트 `package.json` 워크스페이스, `scripts/publint-all.ts`, `tsdown.config.ts`, `.oxlintrc.json`, `scripts/check-workspace-constraints.ts`입니다.

## 3. 패키지 토폴로지 결정하기

교체 가능한 기능의 경우, 서비스 정의 / 서비스 제공자 / 소비자 역할이 독립적으로 발전한다면 이를 패키지로 분리합니다(문서 docs/architecture.md의 § “기능 경계”를 참조하세요. shell 3종 구성이 템플릿입니다). 단일 목적 플러그인은 하나의 패키지로 유지합니다.

### 존재하는 역할 이름 정하기

안정적인 현재 책임의 이름을 정합니다. 첫 번째 구현, 가능한 향후 확장 또는 Cordis 기본 클래스의 이름을 사용하지 마세요. 인터페이스 패키지는 기능의 이름을 정합니다. 구현 패키지는 이를 구별하는 메커니즘, 프로토콜, 환경 또는 공급업체를 추가합니다. 동일 호스트 실행이 계약의 일부일 때만 `local`을 사용합니다.

하나의 엔진, 런타임, 정책, 컨트롤러, 리졸버, 저장소 또는 현재 구성을 나타낼 때는 단수 `ctx` 키를 사용합니다. 레지스트리 또는 여러 이름 있는 멤버를 소유하는 서비스에는 복수 키를 사용합니다. 클래스 역할과 키의 수는 일치해야 합니다. 호환되지 않는 호스트 및 클라이언트 선언에 하나의 Cordis `Context` 키를 재사용하지 마세요. TypeScript 선언 병합은 별도의 런타임 컨텍스트를 사용하더라도 두 측면을 모두 인식합니다. 자연스러운 복수형이 이미 다른 측면에 속한다면 역할 접미사를 추가합니다.

| 용어 | 사용 시점 | 사용하지 않아야 할 경우 |
|---|---|---|
| `Controller` | 명령 또는 사용자 의도를 받아 기존 도메인 또는 프레젠테이션 상태 하나를 변경할 때 사용합니다. | 임의의 작업을 실행하거나, 제공자 집합을 소유하거나, 표시용 값 변환만 수행하는 경우에는 사용하지 않습니다. |
| `Store` | 하나의 데이터 집합을 소유하며 주로 해당 데이터에 대한 CRUD, 스냅샷 또는 구독 작업을 제공할 때 사용합니다. | 상태 머신을 검증하거나, 권한을 조정하거나, 작업을 디스패치하거나, 제공자 우선순위를 소유하는 경우에는 사용하지 않습니다. 맵이 있다고 해서 클래스가 store가 되는 것은 아닙니다. |
| `Directory` | 검색 또는 선택을 위해 항목과 메타데이터를 노출할 때 사용합니다. | 생산자가 임의의 구현을 등록하거나 호출자가 이를 통해 작업을 실행하는 경우에는 사용하지 않습니다. |
| `Presenter` | 도메인 값 또는 도구 인수를 렌더링 의도로 순수하게 변환할 때 사용합니다. | I/O를 수행하거나, 구독하거나, 상태를 변경하거나, 수명 주기를 소유하는 경우에는 사용하지 않습니다. |
| `Registry` | 조회, 중복 또는 우선순위 규칙, 수명, 해제를 포함하여 이름이 지정된 등록의 동적 집합을 소유할 때 사용합니다. | 주요 계약이 디스패치, 실행, 취소, 정책 또는 오케스트레이션인 경우에는 사용하지 않습니다. |
| `Runtime` | 호출 전반에 걸쳐 실시간 작업을 실행하고 디스패치, 취소, 제공자 조정 또는 작업 수명 주기를 소유할 때 사용합니다. | 레코드만 저장하거나, 카탈로그를 반환하거나, 하나의 값을 확인하거나, 설정을 보관하는 경우에는 사용하지 않습니다. |
| `Resolver` | 해당 답변의 수명 주기를 소유하지 않고 제공된 입력에서 하나의 답을 계산하거나 찾을 때 사용합니다. | 변경 가능한 컬렉션이나 장기 실행을 소유하는 경우에는 사용하지 않습니다. |
| `Binder` | 선언된 인터페이스 하나를 호출자 컨텍스트 또는 수명 주기에 연결하고 바인딩된 값을 반환할 때 사용합니다. | 값을 컬렉션으로 소유하거나, 도메인 상태를 제어하거나, 데이터만 변환하는 경우에는 사용하지 않습니다. |
| `Engine` | 도메인 알고리즘 또는 상태 기반 실행 모델을 구현할 때 사용합니다. | 제공자만 선택하거나 프로토콜 경계를 넘어 전달하는 경우에는 사용하지 않습니다. |
| `Policy` | 허용, 선택, 제한 또는 관찰 대상을 결정할 때 사용합니다. | 결정이 허용하는 메커니즘을 수행하는 경우에는 사용하지 않습니다. |
| `Executor` | 하나의 기능에서 명시적 요청 또는 확인된 사양 하나를 실행할 때 사용합니다. | 광범위한 애플리케이션 수명 주기나 제공자 카탈로그를 소유하는 경우에는 사용하지 않습니다. |
| `Gateway` | 프로세스, 네트워크, RPC 또는 API 경계를 어댑트할 때 사용합니다. | 동일 프로세스 서비스를 등록하거나 메타데이터만 저장하는 경우에는 사용하지 않습니다. |
| `Provider` | 기능 정의 하나의 구현을 제공할 때 사용합니다. 여러 개가 존재할 수 있으면 메커니즘 또는 공급업체 한정자를 추가합니다. | 기능 정의, 제공자 레지스트리 또는 소비자 런타임인 경우에는 사용하지 않습니다. |
| `Backend` | 정의된 인터페이스 뒤에서 교체 가능한 하위 수준 영속성, 전송 또는 실행을 구현할 때 사용합니다. | 사용자 대상 서비스이거나 반환된 실시간 리소스 참조인 경우에는 사용하지 않습니다. |
| `Handle` | 하나의 실시간 리소스를 가리키며 해당 리소스를 제어하거나 관찰할 때 사용합니다. | 전체 리소스 풀을 생성하고 관리하는 경우에는 사용하지 않습니다. |
| `Config` | 확인된 설정 값 하나 또는 엄격히 제한된 레코드 하나와 그 업데이트 계약을 소유할 때 사용합니다. | 일반 컬렉션을 저장하거나, 작업을 실행하거나, 관련 없는 설정을 노출하는 경우에는 사용하지 않습니다. |
| `Service` | 위의 어떤 역할로도 정확히 설명할 수 없는 응집도 높은 도메인 서비스를 소유할 때 사용합니다. | 클래스가 Cordis `Service`를 확장하기 때문에만 이름이 존재하는 경우에는 사용하지 않습니다. |

지원되는 Python 및 TypeScript SDK에서 사용하는 JSON-RPC 클라이언트/서버 프로토콜에만 `SDK`를 사용합니다. DeepSeek Harness 자체는 SDK 프로젝트가 아니라 에이전트 하니스입니다. 표준 제품 표기는 `Typert`를 사용하며, `TypeRT` 또는 `typeRT`는 사용하지 마세요.

## 4. 패키지 README 작성

패키지별 서비스 API, 설정, 이벤트, 확장 지점, 설계 메모를 먼저 배치합니다. 제한 사항 섹션에는 이 패키지가 소유하는 지속적인 소비자 공백과 자명하지 않은 유지 관리자 제약을 기록합니다. 일반적인 정리는 해당 소스의 TODO 또는 Agent Note에 남깁니다. 간접적인 Model Experience 문장에서는 이 패키지의 기여를 노출하는 소비자를 언급할 수 있지만, 해당 소비자의 구현을 다시 설명해서는 안 됩니다. 패키지 README는 다음 표준 순서로 마무리합니다.

````markdown
## Model Experience

### Request context and condition

#### What the model sees

The exact data-dependent fields, an anchored generated-catalog link, or an introduction to the verbatim literal below.

##### Verbatim text for this field, when needed

```markdown
Stable system-prompt prose of any length, or another long non-generated literal, copied exactly from source.
```

#### Token effect

Fixed, conditional, retained, replaced, capped, or zero-direct token effect.

#### KV Cache effect

Append-only, prefix-stable, replacing, or independent behavior, including the exact conditions that may invalidate reuse.

## Known Limitations and Deferred Work

- **Consumer-visible gap** — exact missing operation or case, its consequence, and any maintainer constraint.
````

구현을 바탕으로 Model Experience를 작성합니다. 직접적, 조건부, 상한 적용, 수명 또는 보조 모델 컨텍스트 항목마다 H3 하나를 사용하고, 위에 표시된 순서의 H4 필드 세 개와 각 항목 아래의 산문 단락 하나를 둡니다. 패키지가 소유하는 안정적인 텍스트를 인용합니다. 시스템 프롬프트 산문은 이를 소개하는 필드(일반적으로 `What the model sees`) 아래에 제목이 있는 H5와 `markdown` 펜스를 사용해 배치합니다. 다른 짧은 리터럴은 이름이 지정된 플레이스홀더와 함께 인라인으로 유지하고, 다른 긴 리터럴은 같은 중첩 형식을 사용합니다. 데이터 종속 또는 제공자 소유 텍스트만 요약합니다. 도구 스키마 항목은 생성된 [도구 카탈로그](../tool-catalog.md)의 앵커 섹션에 연결하고, այնտեղ 없는 차이점만 설명합니다. 범위 지정으로 한쪽이 숨겨질 수 있을 때는 프롬프트와 스키마 항목을 분리합니다. `KV Cache effect`에서는 추가 전용 증가, 안정적인 반복 접두사, 이전 요청 토큰의 대체, 독립적인 모델 요청을 구분한 다음 재사용을 무효화할 수 있는 패키지 소유 변경 사항을 명시합니다. “무효화하지 않음”은 패키지가 이미 재사용 가능한 접두사를 보존한다는 뜻이며, 제공자의 캐시 사용 가능 여부와 축출은 패키지 계약 범위 밖입니다. [산문 표준](../../.agents/skills/dsh-prose-standard/SKILL.md)은 완전성과 소유권을 규정하고, 검증기는 필수 섹션 구조를 강제합니다.

컨텍스트 효과가 없거나 소비자 소유 경로가 하나인 패키지는 [`SENTENCE_MODEL_EXPERIENCE`](../../scripts/verify-package-readme-model-experience.ts)에서 감사된 `None, as ` 또는 `Indirectly, through ` 문장을 사용한 뒤, `KV Cache effect` H4와 비어 있지 않은 단락 하나를 추가합니다. 모델 비종속 일반 패키지는 대신 `NO_MODEL_EXPERIENCE_SECTION`에 포함될 수 있습니다. 어느 경우에도 다른 패키지의 작업 설명으로 확장하지 마세요. 제한 사항 [허용 목록](../../scripts/verify-package-readme-limitations.ts)은 별개입니다. [Model Experience Agent Note](../../.agents/notes/implemented/process/2026-07-12-package-model-experience-contract.md)에는 근거를 기록합니다.

## 5. 검증

```sh
pnpm install        # registers the workspace
pnpm run doc-sync
pnpm run constraints && pnpm run typecheck && pnpm run lint
pnpm run build && pnpm run hygiene
```

새 패키지에 필요한 동작별 검사와 커버리지는 [리포지토리 테스트 정책](../testing.md)을 따릅니다.
