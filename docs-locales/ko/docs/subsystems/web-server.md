# HTTP 서버

[dsh-host-webserver](../../packages/host/webserver)는 GUI 호스트용 브라우저 HTTP 캐리어입니다. 단일 `node:http` 플러그인으로서 `ctx.webServer`, 명명된 라우트 레지스트리, index.html 변환 콜백, 그리고 플러그인이 소유할 수 있는 하나의 폴백 핸들러를 제공합니다. 이는 에이전트 루프의 일부도 기능 경계도 아니며, Harness 개념을 알지 못합니다. 다른 플러그인이 `/api` 브리지, 플러그인 번들, HMR 이벤트 스트림을 포함한 모든 기능 라우트를 등록합니다([계층화 참고 사항](../../.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md)). 브라우저에만 제공됩니다. Electron은 `file://`를 통해 빌드된 파일을 로드하고, 이 서버 대신 IPC 브리지를 통해 fetch 요청을 전송합니다.

출처: [`packages/host/webserver/src/index.ts`](../../packages/host/webserver/src/index.ts)

## 라우트

```ts type-equiv
/** Route match kind: 'exact' matches the pathname verbatim; 'prefix' p matches p and p/<anything>. */
type WebRouteKind = 'exact' | 'prefix'
```

```ts type-equiv
/** One named route registration. */
interface WebRoute {
  kind: WebRouteKind
  /** Absolute pathname, no trailing slash. */
  path: string
  /** Owns the full response lifecycle (may hold the response open, e.g. SSE). */
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}
```

매칭 순서는 고정되어 있습니다. 정확한 테이블, 가장 긴 일치 접두사, 등록된 폴백 순입니다. 등록 순서는 요청 처리에 영향을 주지 않습니다. 명명된 라우트는 서로 겹치지 않도록 구성되며, 폴백 자리에서는 명명된 라우트가 소유하지 않는 모든 요청에 응답합니다. 소유자는 하나뿐이며, 두 번째 등록은 예외를 발생시킵니다. 제공되는 Web 구성은 잠긴 의미 체계를 가진 SPA dist 서버인 [`dsh-host-frontend-static`](../../packages/host/frontend-static/src/index.ts)로 그 자리를 소유합니다. non-GET/HEAD는 405이고, dist 루트 밖으로의 순회는 403이며, 어떤 미스든 HTTP 200으로 `index.html`로 폴백합니다(SPA 라우팅). 알 수 없는 확장자는 octet-stream으로 제공합니다.

## 설정

```ts type-equiv
/** Gateway config: the listen address. */
interface Config {
  /** Listen host; the two supported values are loopback and all-interfaces. */
  host: '127.0.0.1' | '0.0.0.0'
  /** Listen port; zero requests an OS-assigned port. */
  port: number
}
```

`host`은 `127.0.0.1`(기본 방침)과 `0.0.0.0`(의도적인 네트워크 노출)만 허용합니다. TLS, 인증 또는 오리진 정책이 없으므로 루프백이 아닌 바인딩은 해당 네트워크에 서버를 노출합니다. dist 위치는 자리를 소유하는 프런트엔드 플러그인의 조립 방식에 따른 사실입니다.

## 서비스

`WebServer`(`ctx.webServer`)는 활성화 즉시 수신을 시작합니다. 수신 실패(EADDRINUSE…)는 초기화를 거부하며, 부팅 프로세스는 실패한 fiber를 보고합니다. `register(route)`은 명명된 라우트 하나를 추가하고 해당 disposer를 반환합니다. 라우트 패턴은 구성 수준의 계약이고 충돌은 잘못된 설정이므로 중복된 `(kind, path)`은 예외를 발생시킵니다. `tapIndex(transform)`은 모든 index 응답(`/` 및 각 SPA 폴백)에 등록 순서대로 적용되는 순수한 html-to-html 변환을 추가합니다. [dsh-client-modules](../../packages/client/modules)는 이를 사용해 부팅 매니페스트를 삽입합니다. `port`은 `config.port`이 0일 때 OS가 할당한 포트를 포함하여 수신 포트를 읽습니다.

처리 중 예외가 발생한 요청(`decodeURIComponent`에 도달하는 잘못된 %-이스케이프, 본문 중간에 연결을 끊는 클라이언트)은 경고로 기록되고 400으로 응답합니다. 이미 헤더가 전송된 경우에는 소켓을 파기하며, 프로세스를 종료하지는 않습니다. 핸들러가 응답을 열어 둔 채로 있을 수 있고(SSE) 이러한 연결은 저절로 종료되지 않으므로, 정리는 `close()`과 `closeAllConnections()`을 함께 사용합니다. 강제 종료가 없으면 해제가 멈춥니다. 패키지는 출력하지 않습니다. URL 줄은 셸의 책임입니다. 개발 모드 번들 감시 파이프라인을 포함한 패키지별 운영 세부 정보는 [README](../../packages/host/webserver/README.md)에 있습니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`에서 소스로부터 생성되었습니다(doc-sync에서 `pnpm run verify-cordis-catalog`로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`로 다시 생성). 이 섹션은 페이지의 두 언어 버전에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxwebserver--webserver"></a>

### `ctx.webServer` — `WebServer`

브라우저 HTTP 캐리어 서비스입니다. 활성화하면 즉시 수신을 시작합니다. 구성된 명명된 라우트는 서로 달라야 하고, 폴백 핸들러는 소유자가 등록할 때까지 시작 중 아직 소유되지 않은 모든 요청에 404로 응답하므로 라우트 등록 순서는 요청에 영향을 주지 않습니다. 수신 실패는 초기화를 거부하며, 부팅 프로세스는 실패한 fiber를 보고합니다.

```ts cordis-catalog
/**
 * Register a named route. Duplicate (kind, path) throws — route patterns are
 * a composition-level contract, so a collision is a misconfiguration.
 * @param route - kind, path, and the owning handler.
 * @returns the disposer removing the route.
 */
register(route: WebRoute): () => void

/**
 * Register an exact-path HTTP upgrade route. Duplicate paths throw because
 * one socket can have only one protocol owner.
 * @param route - pathname and handler owning negotiation plus socket use.
 * @returns the disposer removing the route.
 */
registerUpgrade(route: WebUpgradeRoute): () => void

/**
 * Claim the fallback seat: the handler answering every request no named
 * route matches (the SPA dist server in the shipped Web composition). One
 * owner only — a second registration throws, because two fallbacks cannot
 * compose.
 * @param handler - owns the full response lifecycle of unmatched requests.
 * @returns the disposer releasing the seat.
 */
registerFallback(handler: WebRoute['handler']): () => void

/**
 * Register an index.html transform, applied by the fallback owner to every
 * index response ({@link applyIndexTaps}) in registration order.
 * @param transform - pure html-to-html function.
 * @returns the disposer removing the transform.
 */
tapIndex(transform: (html: string) => string): () => void

/**
 * Run an index.html body through the registered taps in registration order
 * — called by the fallback owner on every index response it renders.
 * @param html - the raw index.html body.
 * @returns the transformed body.
 */
applyIndexTaps(html: string): string
```

출처: [`packages/host/webserver/src/index.ts:59`](../../packages/host/webserver/src/index.ts)
<!-- END GENERATED cordis-surface -->
