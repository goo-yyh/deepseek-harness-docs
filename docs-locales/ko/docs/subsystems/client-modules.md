# 클라이언트 모듈

웹 플러그인 테이블은 [dsh-client-modules](../../packages/client/modules)에 포함된 클라이언트 모듈 시스템의 Node 측 구현으로, `ctx.clientModules`(`ClientModuleRegistry`)로 제공됩니다. 호스트 Loader의 항목을 스캔하여 `dsh.client`를 선언한 패키지를 찾고, `window.__DSH_BOOT__` 항목 그래프를 구성하며, 각 번들을 `/plugins/<id>/client.js`에서 제공하고, 인덱스 렌더에 연결하여 부트 매니페스트를 주입합니다. 이는 하나의 서비스가 제공하는 네 가지 기능입니다. 에이전트 루프의 핵심 부분이 아니라 웹 GUI 스택의 선택적 기능이며, [dsh-host-webserver](../../packages/host/webserver)의 소비자입니다. [web-server.md](web-server.md)에 설명된 캐리어는 이 서비스가 등록하는 접두사 경로와 인덱스 연결 지점을 제공합니다. 동일한 패키지의 브라우저 측(`ctx.modules`, 이 번들을 가져와 구체화하는 지연 CJS 모듈 테이블)은 여기서가 아니라 [패키지 README](../../packages/client/modules/README.md)에 문서화된 커널 기능입니다.

출처: [`packages/client/modules/src/client/manifest.ts`](../../packages/client/modules/src/client/manifest.ts)

## 전달 구조

그래프는 Node 측과 브라우저 측 사이에서 사용하는 유일한 전달 원본입니다. 호스트는 스캔된 패키지에서 `WebBootEntry` 행을 구성하고, 그래프를 `<head>`의 첫 번째 스크립트로 주입합니다(`window.__DSH_BOOT__`이며, 플러그인이 제어하는 문자열이 script 요소 밖으로 벗어나지 못하도록 `<`를 이스케이프합니다). 셸은 어떤 항목을 부팅하기 전에 이를 파싱합니다. 유효한 매니페스트가 없는 페이지는 부팅할 수 없습니다. 브라우저 측 파서는 그래프가 없거나 잘못된 경우 명확하게 예외를 발생시킵니다.

```ts type-equiv
/**
 * One composed client entry pushed by the host (a graph row). Wire
 * single source: the host node half (package root) produces this same shape.
 * `immediately` marks stage-one prefetch; `inject` is informational graph
 * metadata (the authoritative edges live in each package's `dsh.client`
 * declaration and reach fibers through entry creation).
 */
interface WebBootEntry {
  /** Entry name == package name. */
  id: string
  /** Bundle endpoint, '/plugins/<id>/client.js?rev=<rev>'. */
  url: string
  /** Bundle content hash (cache-busting consistency anchor). */
  rev: string
  /** Package-name dependency edges, informational (preflight display / HMR diffing). */
  inject?: string[]
  /** Stage-one prefetch mark: load the script for factory registration during module-face boot. */
  immediately?: boolean
}
```

```ts type-equiv
/** The composed client entry graph the host injects as `window.__DSH_BOOT__`. */
interface WebBootGraph {
  /** Consistency anchor over the whole graph (content + bundle hashes). */
  rev: string
  /** Composed entries; order carries no semantics (activation order is fiber inject waiting). */
  entries: WebBootEntry[]
}
```

각 행의 `rev`는 번들의 콘텐츠 해시이며 캐시 무효화 쿼리로 URL에 포함됩니다. 그래프 `rev`는 구성된 행을 해싱하므로 행이 하나라도 변경되면 함께 변경됩니다. `immediately`는 1단계 사전 가져오기 계층을 표시합니다(모듈 측 부팅 중 가져오고 실행하며 등록만 수행함). 지연 행은 처음 가져올 때 로드됩니다.

## 스캔

패키지는 package.json에서 `dsh.client`(`platform: 'web'`, 선택적 `inject` 에지, 선택적 `immediately`)를 선언하고 빌드된 번들을 `exports["./client"]`에서 내보내어 테이블에 참여합니다. 패키지 확인은 구성 트리의 `ctx.baseUrl`, 즉 구성된 모든 플러그지를 종속성으로 선언하는 cordis.yml 디렉터리에 고정되며, 이 기준점이 설정되지 않으면 생성 시 예외가 발생합니다.

스캔은 패키지별 증분 방식으로 수행되며 전체 재스캔 경로는 없습니다. 모든 cordis `internal/plugin` 발생(파이버 생성 또는 폐기)은 해당 파이버의 항목 이름을 변경 대상으로 표시하고, 마이크로태스크 플러시가 각 변경 대상 이름을 활성 Loader 항목과 조정합니다. 활성화 단계는 현재 모든 항목으로 동일한 변경 대상 집합을 초기화하고 동기적으로 플러시하므로, 첫 스캔과 안정 상태는 동일한 구현을 공유하지만 실패 처리 방식은 반대입니다. 활성화 시 이미 로드된 항목 중 잘못된 선언이나 누락된 번들은 모든 손상된 패키지를 나열하는 하나의 명확한 `AggregateError`로 집계됩니다. 파이버는 실패하고 부팅의 명확한 실패 검사에서 이를 보고합니다. 안정 상태에서는 손상된 패키지가 경고를 기록하며 다른 패키지에 영향을 주지 않아야 합니다.

패키지 메타데이터는 부정적 판정인 “클라이언트 패키지가 아님”을 포함하여 이름별로 캐시되며 만료되지 않습니다. 플러그인 집합 변경 사항은 재시작 후에 적용됩니다. 파이버를 재시작하면 해당 행과 rev는 그대로 재사용되며, 번들 콘텐츠 변경은 `rebuilt()`를 통해서만 그래프에 반영됩니다.

## 번들 경로와 인덱스 연결 지점

`GET`/`HEAD /plugins/<id>/client.js`는 `no-cache`와 함께 등록된 번들을 디스크에서 제공합니다(일관성의 기준은 HTTP 캐싱이 아니라 rev 쿼리입니다). 다른 메서드는 405를 반환합니다. 알 수 없는 id 또는 아직 빌드되지 않아 번들을 읽을 수 없는 등록 행은 캐리어의 SPA 대체 기능이 JavaScript 대신 HTML을 제공하지 않도록 명확한 404를 반환합니다. 인덱스 연결 지점은 매 인덱스 렌더 시 현재 그래프를 주입하므로, 새로고침은 항상 활성 구성으로 부팅됩니다.

## 서비스

`ClientModuleRegistry`(`ctx.clientModules`, [`packages/client/modules/src/index.ts`](../../packages/client/modules/src/index.ts)에 정의됨)는 읽기 기능과 재빌드 기능을 노출하며, 시그니처는 생성된 [서비스 카탈로그](#ctxclientmodules--clientmoduleregistry)에 있습니다. `graph()`는 현재 구성된 그래프(변경 사이에 안정적인 객체)를 반환하고, `clientPath(id)`는 번들의 절대 경로를 반환합니다. `rebuilt(id)`는 번들 콘텐츠가 그래프에 도달하는 유일한 진입점입니다. 파일을 다시 해싱하며 실제 rev 변경이 있을 때만 그래프를 재구성하고 알립니다. `onRebuilt`는 변경된 번들마다 새 rev와 함께 발생하며, `onGraphChanged`는 그래프를 재구성한 모든 플러시 후에 발생합니다(행 추가 또는 제거, 혹은 재빌드된 rev 변경). 이는 풀 모델이므로 리스너는 `graph()`를 다시 읽습니다. 두 알림 경로 모두 리스너 예외를 포함하므로 예외를 던지는 구독자 하나가 이후 구독자를 건너뛰거나 플러시를 유발한 작업을 종료할 수 없습니다.

개발 환경에서 [dsh-client-hmr](../../packages/client/hmr/README.md)는 레지스트리의 감시 드라이버입니다. Node 측은 동기적으로 캡처한 기준선에서 모든 그래프 행의 번들을 stat 폴링하고, 변경 시 `rebuilt(id)`를 호출하며, `onGraphChanged`를 통해 감시 집합을 다시 동기화하고, SSE를 통해 rev 변경을 브라우저 측에 브로드캐스트합니다. 프로덕션 그래프에서는 HMR 행이 완전히 제외되며 모듈 호스트 자체는 파일을 감시하지 않습니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`가 소스에서 생성합니다(doc-sync에서 `pnpm run verify-cordis-catalog`로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`로 다시 생성합니다). 이 섹션은 페이지의 두 언어 측에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxclientmodules--clientmoduleregistry"></a>

### `ctx.clientModules` — `ClientModuleRegistry`

웹 플러그인 테이블 서비스: 증분 `dsh.client` 스캔 + 전달 구조 구성 + 번들 경로 + 인덱스 연결 지점. 생성 시 활성화 스캔을 동기적으로 실행합니다. 이미 로드된 항목 중 잘못된 선언이나 누락된 번들은 하나의 명확한 예외로 집계됩니다(FAILED 파이버, 부팅 활성화 감사에서 보고됨).

```ts cordis-catalog
/**
 * Current composed entry graph (stable object between changes).
 * @returns the graph served as `window.__DSH_BOOT__`.
 */
graph(): WebBootGraph

/**
 * Absolute path of an entry's client bundle.
 * @param id - entry id (package name).
 * @returns the path, or undefined for an unknown id.
 */
clientPath(id: string): string | undefined

/**
 * Re-hash one bundle (the HMR watch's registration hook — the only entry
 * point through which bundle content changes reach the graph).
 * @param id - entry id (package name).
 * @returns the new rev, or undefined for an unknown id.
 */
rebuilt(id: string): string | undefined

/**
 * Subscribe to bundle rebuilds; fires only when the re-hash changed the rev.
 * @param listener - receives the entry id and its new bundle rev.
 * @returns the unsubscriber.
 */
onRebuilt(listener: (id: string, rev: string) => void): () => void

/**
 * Fires after any flush that recomposed the graph (row added/removed, or a
 * rebuilt rev change). Pull model: listeners re-read {@link graph}.
 * @param listener - notified with no payload.
 * @returns the unsubscriber.
 */
onGraphChanged(listener: () => void): () => void
```

소스: [`packages/client/modules/src/index.ts:184`](../../packages/client/modules/src/index.ts)
<!-- END GENERATED cordis-surface -->
