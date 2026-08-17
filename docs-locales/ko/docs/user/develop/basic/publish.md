# 플러그지 패키징 및 설치

이전 튜토리얼에서는 `--patch` 오버레이를 통해 로컬 플러그인을 로드했습니다. 이 튜토리얼에서는 이를 설치 가능한 **번들**로 패키징하고, `dsh plugin add`를 사용하여 **프로필** 에 설치하며, 구성된 설정을 결정하는 계층 순서를 설명합니다. `dsh` CLI가 설치되어 있다고 가정합니다. 먼저 [플러그인 구성](./config.md)을 완료하세요.

대신 새 소스 체크아웃을 사용하려면 [소스에서 실행 섹션](../../../../README.md#run-from-source)을 완료하고, 이 튜토리얼의 `hello-plugin` 디렉터리를 저장소 루트에 유지한 다음, 나머지 `dsh ...` 명령을 그 위치에서 `pnpm dsh ...`로 실행하세요. 빌드 및 런처 동작은 [소스 실행](../../../../apps/cli/reference/README.md#source-execution)을 참조하세요.

## 두 가지 개념, 두 가지 매니페스트

설치는 두 가지 개념을 기반으로 합니다. 둘 다 `package.json`로 설명되지만, `dsh` 키 아래에 서로 다른 종류의 매니페스트를 가지며 서로 다른 질문에 답합니다.

- **번들** 은 구성 계층을 제공하는 npm 패키지입니다. 매니페스트에서 `dsh.bundle`를 선언하여 “이 패키지는 무엇을 제공하는가?”에 답합니다. 즉, 플러그인 행을 삽입하거나 재정의하는 패치 파일입니다.
- **프로필** 은 하나의 실행 가능한 구성을 설명하는 `$DSH_HOME/profiles/<name>` 아래의 디렉터리입니다. 매니페스트에서 `dsh.profile`를 선언하여 “어떤 번들이 이 설정을 어떤 순서로 구성하는가?”에 답합니다.

번들은 작성하고 배포하는 대상이며, 프로필은 사용자가 `dsh --profile <name>`로 부팅하는 대상입니다. 둘을 겸하는 것은 없습니다.

### 번들 매니페스트

패키지 디렉터리를 만드세요.

```sh
mkdir -p hello-plugin
```

```
hello-plugin/
├── package.json       # declares dsh.bundle
├── cordis.patch.yml   # the layer applied when a profile lists this bundle
└── index.js           # plugin modules the patch rows reference
```

`hello-plugin/package.json`를 만드세요.

```json
{
  "name": "dsh-hello-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

플러그인 진입점이 포함된 `hello-plugin/index.js`를 만드세요.

```js
export const name = 'hello-plugin'

export function apply() {
  console.log('[hello-plugin] plugin loaded!')
}
```

`hello-plugin/cordis.patch.yml`를 만드세요. 패치는 작성해 온 `--patch` 오버레이와 같은 YAML 배열이지만, Node 해석이 설치된 코드를 찾을 수 있도록 플러그인 행에서는 상대 소스 경로 대신 패키지 이름을 참조합니다.

```yaml
- insert:
    - id: hello
      name: dsh-hello-plugin
```

`dsh.bundle` 선언이 없는 패키지도 설치되지만 일반 의존성으로만 설치됩니다. `dsh plugin`는 경고를 출력하고 어떤 계층도 활성화하지 않습니다. 플러그인 사용자가 활성화하는 패키지가 아니라 플러그인 패키지가 가져오는 라이브러리에는 이 패키지 형식을 사용하세요.

### 프로필 매니페스트

프로필 디렉터리에는 두 파일이 있습니다.

- `package.json` — 프로필의 트리 외부 플러그인 의존성(pnpm에서 관리)과 정렬된 `bundles` 목록이 포함된 `dsh.profile` 매니페스트입니다.
- `cordis.patch.yml` — 모든 번들 계층 뒤에 적용되는 사용자의 자체 패치 계층입니다.

프로필 매니페스트를 직접 작성할 필요는 없습니다. `dsh plugin`가 이를 만들고 유지 관리합니다. 다음 섹션에서 결과를 보여 줍니다.

## 프로필에 설치

`dsh plugin --profile <name> <args...>`는 프로필 디렉터리에서 pnpm으로 전달하므로 모든 pnpm 동사를 사용할 수 있습니다. `hello-plugin`를 포함하는 디렉터리에서 패키지 체크아웃을 설치하세요.

```sh
dsh plugin --profile demo add ./hello-plugin
```

처음 사용하면 프로필이 초기화되고(첫 번째 번들로 `@deepseek-ai/dsh-base` 사용), pnpm이 체크아웃을 연결하며, 패키지가 `dsh.bundle`를 선언하므로 `dsh`가 번들을 `dsh.profile.bundles`에 추가합니다.

```json
{
  "name": "dsh-profile-demo",
  "private": true,
  "dependencies": {
    "dsh-hello-plugin": "link:/path/to/hello-plugin"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "dsh-hello-plugin"
      ]
    }
  }
}
```

부팅하기 전에 계층을 확인한 다음 부팅하세요.

```sh
dsh --profile demo --dump-config   # shows a "# == dsh-hello-plugin" layer
dsh --profile demo
```

`dsh plugin --profile demo remove dsh-hello-plugin`는 의존성과 계층을 모두 제거합니다.

## 로드 순서

유효 구성은 빈 루트에 다음을 순서대로 적용하여 구성됩니다.

1. 프로필의 `dsh.profile.bundles` 목록에 이름이 지정된 각 번들 패치(목록 순서대로) — 먼저 `@deepseek-ai/dsh-base`, 그다음 추가된 순서대로 설치된 각 번들입니다.
2. 프로필 자체의 `cordis.patch.yml`입니다.
3. 홈 수준의 `$DSH_HOME/cordis.patch.yml` — 모든 프로필이 공유하는 머신 로컬 기본 설정입니다.
4. argv 순서에 따른 각 `--patch <path>` 오버레이입니다.

앱 인수는 또 다른 패치 계층이 아닙니다. 표면 번들은 아래에 설명된 일반 앱 소유 서비스를 통해 이를 해석할 수 있습니다.

나중 계층이 행별로 우선하며, 패치는 키를 깊이 병합하는 대신 행 전체의 `config` 값을 교체합니다. 번들 작성자에게는 두 가지 결과가 있습니다.

- 패치는 `id`를 통해 이전 계층의 행을 재정의할 수 있습니다. [`dsh-web-app` 번들](../../../../packages/bundle/web-app/cordis.patch.yml)이 `dsh-base` 행을 재정의하는 방식과 같지만, 변경된 키뿐 아니라 행에 필요한 모든 키를 다시 명시해야 합니다.
- 사용자는 패키지를 건드리지 않고 프로필의 `cordis.patch.yml`에서 행을 재정의할 수 있으므로, 사용자가 유지할 가능성이 높은 구성 기본값을 선호하고 나머지는 스키마가 담당하게 하세요.

내장 번들 이름은 항상 dsh 설치 자체에서 해석됩니다. pnpm은 트리 외부 패키지만 관리하므로 번들은 `@deepseek-ai/dsh-base`가 존재하며 최신 상태임을 전제로 할 수 있습니다.

## 표면 번들에 자체 명령줄 제공

실행 가능한 앱을 정의하는 번들은 일반 공급자 플러그인을 마운트합니다.

```yaml
- id: hello-startup
  name: 'dsh-hello-plugin/startup'
```

플러그인은 `inject = ['cmdlineArgs']`를 내보내고, 자체 commander 프로그램으로 [`@deepseek-ai/dsh-cmdline`](../../../../packages/boot/cmdline/README.md)의 `parseCmdline`를 호출하며, 프로그램의 action에서 앱 소유 서비스를 제공합니다. 런처는 런처 플래그 뒤의 동일한 불변 인수를 모든 플러그인에 전달하므로, 앱별 플래그는 런처 변경이 필요 없고 여러 플러그인이 스냅샷을 파싱할 수 있습니다. Loader 행에는 런처 마커나 특수 종류가 필요하지 않습니다.

이러한 인수로 구성된 행은 공급자의 서비스를 주입하고 자체 `!!js` 옵션에서 이를 읽으며, 그 옆의 배포 값을 대체 값으로 사용합니다.

```yaml
- id: my-app
  name: '@example/my-app'
  inject: [myAppStartup]
  config:
    port: !!js ctx.myAppStartup.port ?? 8080
```

`--help`에서는 공급자가 서비스를 게시하지 않으므로 해당 행은 활성화되지 않습니다. Loader는 구성을 한 번 마운트하고 각 행의 일반 주입을 기다린 후에만 해당 행의 `!!js` 구성을 주입된 컨텍스트에 대해 평가합니다.

## GitHub에서 설치: 빌드 스크립트 주의점

레지스트리에 게시할 필요는 없습니다. 사용자는 git 호스트에서 직접 설치할 수 있습니다.

```sh
dsh plugin --profile demo add github:you/hello-plugin
```

하지만 git 설치는 **빌드된 아티팩트가 아닌 소스**를 가져옵니다. `build` 스크립트는 실행되지 않으므로 TypeScript 패키지는 `lib/` 출력 없이 도착하여 로드에 실패합니다. 양쪽에서 각각 한 가지씩, 두 가지가 수행되어야 합니다.

- **작성자** 는 git 설치 후 pnpm이 실행하는 `prepare` 스크립트를 제공해야 합니다. 이 스크립트는 소스에서 게시된 진입점을 자체적으로 빌드해야 하며, 인접한 모노레포 체크아웃과 같은 개발 전용 컨텍스트를 가정해서는 안 됩니다. [turtle-ui](https://github.com/deepseek-harness/turtle-ui)가 작동하는 예입니다. 이 패키지의 `prepare`는 프로젝트 참조나 형식 검사 없이 `src/`를 트랜스파일하는 전용 tsdown 구성을 실행합니다.
- **사용자** 는 빌드를 허용 목록에 추가합니다. pnpm ≥10은 명시적으로 허용되기 전까지 git 의존성의 `prepare` 스크립트 실행을 거부하므로 첫 번째 `add`가 실패합니다. `dsh`가 해결 방법을 안내합니다. pnpm이 출력한 정확한 패키지 키를 프로필의 `pnpm-workspace.yaml`에 복사하세요.

  ```yaml
  allowBuilds:
    dsh-hello-plugin: true
  ```

  그런 다음 `add`를 다시 실행하세요.

이 권한의 의미를 분명히 이해해야 합니다. 즉, **설치 시점에 머신에서 패키지의 코드를 실행할 수 있는 권한**이며, 에이전트가 실행되는 모든 샌드박스 외부에서 이루어집니다. 소스를 신뢰할 수 있는 패키지만 허용하고 커밋(`github:you/hello-plugin#<sha>`)을 고정하여 이후 푸시로 실행되는 내용이 조용히 변경되지 않도록 하세요.

사용자에게 이 권한을 요청하지 않으려면 빌드된 아티팩트를 대신 배포하세요. 어느 방식도 빌드 권한이 필요하지 않습니다.

- **npm에 게시** : `lib/`을(를) `pnpm publish` 시점에 빌드하면 `dsh plugin add your-package`이(가) 사전 빌드된 코드를 설치합니다.
- **tarball 배포** : `pnpm pack`에서 배포하며, 사용자는 `dsh plugin add ./hello-plugin-0.1.0.tgz`을(를) 실행합니다.

## 다음 단계

- [플러그인 및 수명 주기](../framework/) — 전체 플러그인 수명 주기
- [CLI 동작 참조](../../../../apps/cli/reference/README.md) — 정확한 계층 우선순위, 플래그 및 프로필 메커니즘
