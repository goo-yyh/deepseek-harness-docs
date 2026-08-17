# 권한 프리셋

[dsh-permission-presets](../../packages/interaction/permission-presets) (`ctx.permissionPresets`, `PermissionPresetService`)의 권한 프리셋 계층은 독립적인 두 적용 제어 항목인 [샌드박스 모드](sandbox.md) (`sandbox/mode`)와 [승인 정책](approval.md) (`approval/policy`)을 클라이언트가 하나의 권한 선택기로 제공하는 이름 있는 프리셋으로 묶습니다. 이는 에이전트 루프 핵심부의 일부가 아닌 선택적 기능 하나이며, 적용 자체는 담당하지 않습니다. 실행, 프롬프트 서술, 재생은 계속해서 각 제어 항목의 fold를 읽고, 프리셋 전환은 의도만 기록한 뒤 각 제어 항목의 표준 setter를 통해 값을 씁니다. [패키지 README](../../packages/interaction/permission-presets/README.md)는 구성 상태와 제한 사항을 다루며, [샌드박스 전환 설계](../../.agents/notes/implemented/feature/2026-07-06-sandbox.md)는 그 근거를 다룹니다.

출처: [`packages/interaction/permission-presets/src/index.ts`](../../packages/interaction/permission-presets/src/index.ts)

## 프리셋 테이블

프리셋은 하나의 샌드박스/승인 번들과 선택적 클라이언트 표시를 매핑하는 테이블 키입니다. 기본 테이블은 `workspace-write` (`workspace-write` + `ask`) 및 `danger-full-access` (`danger-full-access` + `never`)을 제공합니다.

```ts type-equiv
/** One preset's sandbox/approval bundle and optional client presentation. */
interface PresetSpec {
  /** The `sandbox/mode` value the preset writes through. */
  sandbox: SandboxMode
  /** The `approval/policy` value the preset writes through. */
  approval: ApprovalPolicy
  /** The display label a client shows for this preset; the raw table key when omitted. */
  name?: string
  /** One user-facing sentence on what the preset means; omitted when not configured. */
  description?: string
}
```

```ts type-equiv
/** The {@link PermissionPresetService} config: preset table and composition default. */
interface Config {
  /**
   * The preset table: name → knob bundle. Defaults to `workspace-write`
   * (workspace-write + ask) and `danger-full-access` (danger-full-access +
   * never). The name `custom` is reserved for the derived not-a-preset state.
   */
  presets?: Record<string, PresetSpec>
  /**
   * Default for new sessions. When omitted, the preset matching the composed
   * sandbox and approval defaults is used.
   */
  defaultPreset?: string
}
```

서비스에는 격리를 제공하는 `ctx.shell` 실행기와 `ctx.approval`이 필요하며, 잘못된 구성은 플러그인 로드 시 실패합니다. 이름이 `custom`인 테이블 항목은 예외를 발생시킵니다(이 이름은 파생된 프리셋 아님 상태를 위해 예약되어 있음). 또한 격리를 제공하지 않는 bash 실행기(`sandboxMode` 기능 사실 없음) 위에 구성하면 프리셋이 샌드박스 모드를 묶으므로 예외가 발생합니다.

## 현재 프리셋과 파생된 `custom`

`current(events)`은 자체 이벤트만이 아니라 제어 항목에서 유효 프리셋을 파생합니다. 세션의 유효 샌드박스 모드(실행기에 구성된 모드로 대체)와 유효 승인 정책(승인 서비스 구성으로 대체한 후 `ask`으로 대체)을 fold하고, 여전히 일치하는 기록된 선택을 우선한 다음 선언 순서상 첫 번째로 일치하는 테이블 항목을 선택하며, 그렇지 않으면 `CUSTOM_PRESET` (`'custom'`)을 반환합니다. `custom`은 파생 전용입니다. 클라이언트는 이를 현재 값으로 표시할 수 있지만, 전환 대상이나 이벤트 페이로드가 되지는 않습니다.

`names`은 테이블 선언 순서에 따라 전환 가능한 프리셋을 나열합니다. `optionOf(name)`은 테이블 키(레이블은 키로 대체됨) 또는 `custom`에 대해 클라이언트가 렌더링할 옵션을 만들며, 다른 이름에 대해서는 예외를 발생시킵니다.

```ts type-equiv
/** The select-option shape a presentation layer advertises for one preset (or for the derived `custom` state). */
interface PresetOption {
  /** Stable option value: the table key, or `custom`. */
  value: string
  /** The display label. */
  name: string
  /** One user-facing sentence on what the value means; omitted when not configured. */
  description?: string
}
```

## 전환과 `permission/preset` 이벤트

`set(session, name)`은 프리셋을 확인하고(알 수 없는 이름은 예외 발생), `name`이 이미 유효 프리셋이 아닌 경우에만 로그 전용 `permission/preset` 이벤트를 추가합니다. 그런 다음 해당 제어 항목의 유효 값이 변경될 때에만 각자의 setter를 통해 각 제어 항목에 값을 씁니다. 즉, [dsh-sandbox-policy](../../packages/sandbox/sandbox-policy)의 `setSandboxMode` 및 [dsh-user-approval](../../packages/interaction/user-approval)의 `setApprovalPolicy`입니다. 선택 이벤트는 같은 turn에서 제어 항목 이벤트보다 먼저 발생하며, 유효 프리셋을 다시 선택해도 아무것도 추가되지 않습니다.

`permission/preset`은 내구성 있는 로그 전용 사용자 의도입니다. 모델 트랜스크립트에는 포함되지 않습니다(제어 항목 이벤트가 소비자를 통해 모델에 표시되는 결과를 담당함). 두 프리셋이 하나의 번들을 공유할 때 `current()`이 사용자가 선택한 프리셋을 보존할 수 있도록 존재합니다. `effectivePermissionPreset(events)`은 마지막 이벤트를 fold하며, 재생에는 따라잡기 상태가 필요하지 않습니다. 전체 이벤트 선언은 [영속성 로그 이벤트 카탈로그](../persistence-catalog.md)에 있고, 메서드 시그니처는 생성된 [서비스 카탈로그](#ctxpermissionpresets--permissionpresetservice)에 있습니다.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`이 소스에서 생성했습니다(doc-sync에서 `pnpm run verify-cordis-catalog`으로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`으로 다시 생성). 이 섹션은 페이지의 두 언어 버전에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` fence를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxpermissionpresets--permissionpresetservice"></a>

### `ctx.permissionPresets` — `PermissionPresetService`

배포 환경의 권한 프리셋과 해당 쓰기 경로를 담당합니다. 격리를 제공하는 `ctx.shell` 실행기와 `ctx.approval`이 필요합니다. 일치하지 않는 제어 항목 값은 오류가 아니라 CUSTOM_PRESET으로 보고됩니다.

```ts cordis-catalog
/**
 * Resolve the preset matching the effective knob values. A still-matching
 * last selection wins shared-bundle ties; otherwise the first table match
 * wins, or {@link CUSTOM_PRESET} when no entry matches.
 * @param events - the session's events in log order.
 * @returns the effective preset name, or `custom` when nothing matches.
 */
current(events: readonly SessionEvent[]): string

/**
 * Build the whole select value for one folded knob state: every table
 * option in declaration order, `custom` appended exactly while derived.
 * @param state - the folded knob overrides.
 * @returns the `permissions` projection payload.
 */
selectFor(state: KnobState): PermissionSelect

/**
 * Resolve a preset's knob bundle.
 * @param name - the preset name to resolve.
 * @returns the configured bundle.
 * @throws when `name` is not in the table.
 */
resolve(name: string): PresetSpec

/**
 * Build the client option for a table entry or {@link CUSTOM_PRESET}. A
 * missing label falls back to the table key.
 * @param name - a table key, or `custom`.
 * @returns the option a client renders.
 * @throws when `name` is neither a table key nor `custom`.
 */
optionOf(name: string): PresetOption

/**
 * Record a changed preset, then update each changed knob through its own
 * setter. Selecting the effective preset again appends nothing.
 * @param session - the session the switch belongs to.
 * @param name - the preset to switch to; unknown names throw.
 */
set(session: Session, name: string): void
```

유형: [Session](session.md) · [SessionEvent](session.md)

출처: [`packages/interaction/permission-presets/src/index.ts:159`](../../packages/interaction/permission-presets/src/index.ts)
<!-- END GENERATED cordis-surface -->
