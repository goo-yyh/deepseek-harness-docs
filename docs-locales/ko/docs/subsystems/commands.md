# 사용자 명령

[`dsh-commands`](../../packages/interaction/commands)의 사용자 명령 레지스트리 서비스입니다. 대화형 어댑터는 모델 메시지를 생성하지 않고 이를 사용하여 정확한 에이전트에 대해 플러그인 소유 명령을 검색하고 직접 실행합니다. [명령 Agent Note](../../.agents/notes/implemented/feature/2026-07-19-plugin-command-registration.md)는 디스패치와 수명 주기의 근거를 다루며, [패키지 README](../../packages/interaction/commands/README.md)는 구성과 제한 사항을 다룹니다.

소스: [`packages/interaction/commands/src/index.ts`](../../packages/interaction/commands/src/index.ts)

## 입력 메타데이터

서비스는 선택적 비구조화 입력 힌트 하나를 노출합니다. 명령 사용 가능 여부는 플러그인 구성에 따라 결정됩니다. 레지스트리를 사용하는 모든 어댑터는 모든 유효 정의를 확인합니다.

```ts type-equiv
/** Immutable metadata for a command's optional unstructured input. */
interface CommandInputDescriptor {
  /** Placeholder shown before the user supplies free-form input. */
  readonly hint: string
}
```

## 정의

`CommandDefinition`은(는) 플러그인에서 작성한 등록 항목입니다. 레지스트리는 분리된 유효 정의를 검증하고 고정합니다.

```ts type-equiv
/** Plugin-owned command registration. */
interface CommandDefinition {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Human-readable summary used in discovery UI. */
  readonly description: string
  /** Optional free-form input hint advertised to capable clients. */
  readonly input?: CommandInputDescriptor
  /**
   * Whether `command/run` records `rawInput`. Defaults to true. A command
   * whose domain event owns the payload sets this false to avoid duplicating
   * that payload in the session log.
   */
  readonly recordInput?: boolean
  /** Execute against the receiving agent without sending the command to the model. */
  readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>
}
```

## 호출 및 결과

어댑터가 취소를 담당하며 정확한 대상 에이전트를 전달합니다. `rawInput`은(는) 파싱된 이름 바로 뒤에서 시작하며 어댑터가 전달한 구분자와 접미사를 유지합니다. 결과는 도구 결과나 세션 이벤트가 아닌 직접적인 UI 결과입니다.

```ts type-equiv
/** Invocation passed to one registered command handler. */
interface CommandInvocation {
  /** Pairing id already written to this invocation's `command/run` event. */
  readonly commandId: CommandId
  /** Exact agent whose UI received the command. */
  readonly agent: Agent
  /** Exact text following the registered command name, including separator whitespace. */
  readonly rawInput: string
  /** Cancellation signal owned by the dispatching UI request. */
  readonly signal: AbortSignal
}
```

```ts type-equiv
/** Expected command outcome rendered directly by the dispatching UI. */
type CommandResult =
  | {
    readonly kind: 'success'
    readonly text?: string
    /** Earlier authoritative domain event that owns a richer presentation. */
    readonly sourceEventSeq?: number
  }
  | { readonly kind: 'error'; readonly text: string }
```

`sourceEventSeq`은(는) 선택 사항이며 성공 시에만 제공됩니다. 있으면 수신 세션 로그에서 이전의 명령이 아닌 이벤트를 지정합니다. `command/done`은(는) 동일한 참조를 유지하므로 클라이언트는 `text`을(를) 파싱하거나 인접 행에 의존하지 않고 명령 수명 주기를 해당 도메인 프로젝션과 결합할 수 있습니다.

## 검색 및 파싱 뷰

어댑터는 범위 확인 후 핸들러가 없는 불변 기술자를 받습니다. `parseCommand()`은(는) 레지스트리 확인 전에 `ParsedCommand`을(를) 반환합니다. 구문상 유효한 입력도 사용할 수 없는 명령을 지정할 수 있습니다.

```ts type-equiv
/** Handler-free immutable command view returned to UI adapters. */
interface CommandDescriptor {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Human-readable summary used in discovery UI. */
  readonly description: string
  /** Optional free-form input hint advertised to capable clients. */
  readonly input?: CommandInputDescriptor
}
```

```ts type-equiv
/** Syntactically valid slash command before registry resolution. */
interface ParsedCommand {
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Exact text following the command name. */
  readonly rawInput: string
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

`scripts/gen-cordis-catalog.ts`로 소스에서 생성되었습니다(doc-sync에서 `pnpm run verify-cordis-catalog`로 최신 상태를 검증하며, `pnpm run gen-cordis-catalog`로 다시 생성). 이 섹션은 페이지의 두 언어 버전에서 바이트 단위로 동일합니다. 시그니처 블록은 `ts cordis-catalog` 펜스를 사용하고 원본 소스 JSDoc을 유지합니다. 디스패치 모드는 [입문서](../cordis-primer.md#dispatch-modes)에 정의되어 있으며, 프레임워크에서 상속된 `ctx` API는 [cordis-api/inherited.md](../cordis-api/inherited.md)에 있습니다.

<a id="ctxcommands--commandruntime"></a>

### `ctx.commands` — `CommandRuntime`

사용자 명령 레지스트리입니다. 일반 컨텍스트의 정의는 전역이며, 에이전트 컨텍스트의 명령 주입 하위 항목을 통해 등록된 정의는 해당 에이전트에서 전역 정의보다 우선합니다.

```ts cordis-catalog
/**
 * Register a global or calling-agent-scoped command.
 * @param definition - discovery metadata and direct UI handler.
 * @returns the exact effect disposer that unregisters this definition.
 */
register(definition: CommandDefinition): () => void

/**
 * List the effective immutable command descriptors for one agent.
 * @param agent - exact receiving agent and scoped-layer key.
 * @returns name-sorted descriptors after scoped shadowing.
 */
@Remote list(agent: Agent): readonly CommandDescriptor[]

/**
 * Resolve one effective command definition.
 * @param agent - exact receiving agent and scoped-layer key.
 * @param name - command name without a slash.
 * @returns the scoped shadow or global definition.
 */
find(agent: Agent, name: string): CommandDefinition | undefined

/**
 * Parse and execute a known command without sending it to the model.
 *
 * A resolved command's lifecycle is logged: `command/run` is appended
 * before the handler is invoked and `command/done` after settlement (a
 * thrown or aborted handler settles as `kind: 'error'`). Both are direct
 * log-only appends — no turn wraps them, and persistence drains them at
 * ordinary checkpoints. Admission misses (syntax or unknown name) log
 * nothing — they never entered a handler. A `command/run` append failure
 * fails the execution loud; a `command/done` append failure on the
 * handler-failure path is contained so the handler's own error stays the
 * reported failure.
 *
 * @param agent - exact receiving agent.
 * @param line - complete slash-command line.
 * @param signal - cancellation signal owned by the UI request.
 * @returns the settled execution (result + lifecycle pairing id), or
 *   `undefined` when syntax or name does not resolve.
 */
@Remote async execute( agent: Agent, line: string, signal: AbortSignal, ): Promise<CommandExecution | undefined>
```

타입: [Agent](core.md)

소스: [`packages/interaction/commands/src/index.ts:225`](../../packages/interaction/commands/src/index.ts)

<a id="commands-events"></a>

### `commands/*` 이벤트

<a id="commandschange--emit"></a>

#### `commands/change` — 발생

명령이 등록되었거나 등록 해제되었습니다. 전역 또는 범위 지정 변경이 모든 UI 뷰에 영향을 줄 수 있으므로 이는 필터링되지 않은 레지스트리 알림입니다. 관찰자 실패는 격리되며 레지스트리 변경을 거부할 수 없습니다.

```ts cordis-catalog
/**
 * A command was registered or unregistered. This is an unfiltered registry
 * notification because a global or scoped change may affect any UI view.
 * Observer failures are contained and cannot veto the registry mutation.
 * @mode emit
 */
'commands/change'(): void
```

소스: [`packages/interaction/commands/src/types.ts:72`](../../packages/interaction/commands/src/types.ts)
<!-- END GENERATED cordis-surface -->
