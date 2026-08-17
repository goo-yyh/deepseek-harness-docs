# 세션 로컬 Schedule

Schedule은 원래 활성 Session으로 일반적인 이후 대화 턴으로 돌아오는 영속적 알림을 관리합니다. [영속적 Schedule Agent Note](../../.agents/notes/implemented/feature/2026-08-05-durable-web-schedule.md)는 영속성 및 수명 주기 결정을 담당하고, [대화형 전달](../../.agents/notes/implemented/simplification/2026-08-09-conversational-schedule-delivery.md)은 수신 확인 없음 경계를 담당하며, [명시적 시간대 경계](../../.agents/notes/implemented/simplification/2026-08-09-explicit-schedule-time-zone.md)는 브라우저 로컬 해석을 담당하고, [범위가 정해진 고정 비율 Schedule](../../.agents/notes/implemented/simplification/2026-08-09-bounded-fixed-rate-schedule.md)은 반복을 담당합니다. 이 페이지는 [`packages/schedule/schedule/src/types.ts`](../../packages/schedule/schedule/src/types.ts)의 영속적 및 모델 대면 형태를 기록합니다. [패키지 README](../../packages/schedule/schedule/README.md)는 구성, 도구 동작, 정확한 알림 구성 방식을 담당합니다.

## 영속적 레코드

`ScheduleId`은 [브랜드가 지정된 ID](core.md#branded-ids)이며, 하나의 Session 내에서 고유하고 절대 재사용되지 않습니다. 버전 1은 양의 안전 정수 `after_seconds` 지연, 명시적인 절대 `at` 대상 또는 최소 5분의 안전 정수 `every_seconds` 간격을 지원합니다. 생성 시 모든 첫 번째 대상을 네 자리 연도의 RFC 3339 UTC `scheduledAt`로 정규화합니다. `after` 레코드는 제출된 지연을 유지하고, `at` 레코드는 결과 인스턴트만 저장하며, `every` 레코드는 고정 간격과 다음 대상을 유지합니다.

```ts type-equiv
/** Durable one-shot reminder created from a positive delay. */
interface AfterScheduleRecord {
  /** Session-local stable identity. */
  readonly id: ScheduleId
  /** Rule discriminator for a delayed one-shot reminder. */
  readonly kind: 'after'
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Positive safe-integer delay accepted at creation. */
  readonly afterSeconds: number
  /** Four-digit-year RFC 3339 UTC target. */
  readonly scheduledAt: string
}
```

```ts type-equiv
/** Durable one-shot reminder created from an absolute instant. */
interface AtScheduleRecord {
  /** Session-local stable identity. */
  readonly id: ScheduleId
  /** Rule discriminator for an absolute one-shot reminder. */
  readonly kind: 'at'
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Four-digit-year RFC 3339 UTC target. */
  readonly scheduledAt: string
}
```

```ts type-equiv
/** Durable fixed-rate reminder whose next target remains creation-anchor-aligned. */
interface EveryScheduleRecord {
  /** Session-local stable identity. */
  readonly id: ScheduleId
  /** Rule discriminator for a fixed-rate recurring reminder. */
  readonly kind: 'every'
  /** Trimmed reminder content supplied at creation. */
  readonly prompt: string
  /** Fixed safe-integer interval, never below five minutes. */
  readonly everySeconds: number
  /** Earliest anchor-aligned occurrence not yet dispatched. */
  readonly scheduledAt: string
}
```

```ts type-equiv
/** One-shot record variants that terminate on an id-only dispatch. */
type OneShotScheduleRecord = AfterScheduleRecord | AtScheduleRecord
```

```ts type-equiv
/** The v1 durable reminder record union. */
type ScheduleRecord = OneShotScheduleRecord | EveryScheduleRecord
```

## 절대 시간 입력

`at` 선택자는 엄격한 오프셋 포함 RFC 3339 문자열 또는 정확한 로컬 달력 객체 중 하나입니다. 로컬 형식은 도구 경계에서 해석을 명시적으로 유지합니다.

```ts type-equiv
/** Structured local-calendar input accepted by `schedule_create`. */
interface LocalAtInput {
  /** Four-digit ISO calendar date. */
  readonly date: string
  /** Local wall-clock time with optional one-to-three digit milliseconds. */
  readonly time: string
  /** Explicit UTC or IANA Area/Location zone. */
  readonly time_zone: string
}
```

```ts type-equiv
/** Absolute selector accepted by `schedule_create`. */
type AtInput = string | LocalAtInput
```

공식 Web 오버레이는 모든 프롬프트에 대해 브라우저의 IANA 영역을 샘플링합니다. 시간 컨텍스트는 열린 턴에 모호하지 않은 브라우저 영역이 하나 있을 때, 모델이 그 요청 로컬 영역에서 달리 한정되지 않은 자연어 날짜와 시간을 해석하도록 지시합니다. 출처가 혼합되었거나 누락된 경우에는 모델에 질문하도록 지시합니다. 이 지침은 영속적 Session 기본값이 아닙니다. 모델은 문자열 형식에서는 여전히 오프셋을, 로컬 형식에서는 `time_zone`을 전달해야 하며, Schedule은 브라우저, Session, 프로세스 또는 모델 컨텍스트를 읽지 않습니다.

Schedule은 잘못된 오프셋과 영역, 오프셋이 없는 문자열, 미래가 아닌 대상, 일광 절약 시간제 공백 내의 로컬 시간을 거부합니다. 일광 절약 시간제 중복에서는 첫 번째이자 더 이른 인스턴트를 선택합니다. 생성에 성공하면 정규화된 UTC `scheduledAt`만 저장하므로 재생은 주변 시간대 상태에 의존하지 않습니다.

## 고정 비율 입력 및 따라잡기

`every_seconds`은 생성 시간에 고정되는, 최소 300초의 레코드별 간격입니다. 이는 고정 비율 반복 전용입니다. 프로토콜에는 달력 또는 Cron 표현식, 반복 시간대, 공유 쿨다운 또는 레코드 간 허용 게이트가 없습니다.

Session이 여러 대상 시간에 걸쳐 비활성 상태이거나 사용 중이었던 경우, Every 레코드는 가장 최근의 기한 도래 발생 하나만 제공합니다. 디스패치는 누락된 간격을 열거, 영속화 또는 재생하지 않고 디스패치 결정 시간 이후 생성 앵커에 정렬된 첫 번째 대상으로 직접 진행합니다. 다음 대상이 네 자리 UTC 연도에 맞지 않으면 최종 디스패치가 레코드를 종료합니다.

서로 다른 여러 Every 레코드의 기한이 지났고 일회성이 기한에 도달하지 않은 경우, 각 레코드는 대상 및 생성 순서에 따라 동일한 후속 배치에 하나의 발생을 제공합니다. Every 레코드는 독립적인 상태를 유지하는 반면, 해당 허용 배치의 모든 디스패치는 같은 결정 시간을 사용합니다. 배치는 모델 턴 수를 제한하고, 5분 최소값은 각 레코드의 타이머 빈도를 제한합니다.

## 영속적 변경 및 재생

버전 1 `schedule/change` Session 이벤트는 유일한 영속적 Schedule 권한입니다. 생성은 전체 레코드를 저장하고 삭제는 ID만 사용하는 최종 전환입니다. 일회성 디스패치도 ID만 사용하는 최종 전환입니다. Every 디스패치는 가장 최근의 기한 도래 발생을 선택하는 데 사용된 벽시계 결정 시간을 전달하며, 일반적으로 활성 레코드를 종료하는 대신 진행시킵니다. 디스패치는 후속 작업이 동기적으로 대기열에 추가되었음을 의미하며, 모델 응답이 성공했거나 사용자가 읽었음을 의미하지는 않습니다.

```ts type-equiv
/** Creates one durable reminder record. */
interface ScheduleCreateChange {
  readonly version: 1
  readonly operation: 'create'
  readonly schedule: ScheduleRecord
}
```

```ts type-equiv
/** Deletes one currently active reminder. */
interface ScheduleDeleteChange {
  readonly version: 1
  readonly operation: 'delete'
  readonly id: ScheduleId
}
```

```ts type-equiv
/** Records that one active one-shot reminder entered the durable dispatch history. */
interface OneShotScheduleDispatchChange {
  readonly version: 1
  readonly operation: 'dispatch'
  readonly id: ScheduleId
}
```

```ts type-equiv
/** Records one fixed-rate decision and advances directly past missed occurrences. */
interface EveryScheduleDispatchChange {
  readonly version: 1
  readonly operation: 'dispatch'
  readonly id: ScheduleId
  /** Wall-clock decision time used to select the latest due occurrence. */
  readonly acceptedAt: string
}
```

```ts type-equiv
/** Durable dispatch shapes supported by the current rule set. */
type ScheduleDispatchChange = OneShotScheduleDispatchChange | EveryScheduleDispatchChange
```

```ts type-equiv
/** Strict version-1 durable Schedule mutation union. */
type ScheduleChange = ScheduleCreateChange | ScheduleDeleteChange | ScheduleDispatchChange
```

엄격한 디코더와 fold는 알 수 없는 버전, 추가 필드, 재사용된 id, 일회성 또는 Every 디스패치 형태의 불일치, 비활성 레코드에 대한 삭제 또는 디스패치 전환을 거부합니다. 일반 Session은 전체 이벤트 스트림을 fold합니다. 포크는 `SessionHeader.seedLength` 이후의 이벤트만 fold하므로, 상위 Session의 활성 리마인더를 채택하지 않고 기록을 유지합니다. `schedule/change` 선언과 소스 위치도 [영속성 카탈로그](../persistence-catalog.md#schedulechange--log-only)에 인덱싱됩니다.

## 활성 뷰 및 관리

도구 값은 영속 레코드와 현재 실제 시계에서 파생된 전달 상태를 결합합니다. `session-local`은 원래 Session이 활성 상태여야 함을 의미합니다. 외부 알림 채널이나 비활성 세션 스케줄러는 없습니다.

```ts type-equiv
/** Current delivery timing derived from the durable record and wall clock. */
type ScheduleState = 'scheduled' | 'overdue'
```

```ts type-equiv
/** Fixed v1 delivery boundary: the original session must be live. */
type ScheduleDeliveryMode = 'session-local'
```

```ts type-equiv
/** Complete model-facing view of one active reminder. */
type ScheduleView = ScheduleRecord & {
  /** Whether the target remains in the future. */
  readonly state: ScheduleState
  /** Reminder delivery never leaves the owning session. */
  readonly deliveryMode: ScheduleDeliveryMode
}
```

생성된 [도구 카탈로그](../tool-catalog.md#deepseek-aidsh-schedule)는 `schedule_create`, `schedule_list`, `schedule_delete`의 인수 및 결과 스키마를 관리합니다. 관리 호출은 하나의 Agent 범위 큐에서 기한이 지난 작업과 직렬화됩니다. 모든 읽기 또는 결정은 먼저 공유 Session 영속성 장벽을 기다립니다. 생성과 실제 삭제는 추가한 후 다시 기다립니다. 장벽 실패는 즉시 쓰기가 커밋되었는지 추측하는 대신 `persistence_uncertain`을 보고합니다. 그 밖의 안정적인 오류 코드는 `invalid_prompt`, `invalid_selector`, `invalid_rule`, `invalid_time_zone`, `not_future`, `time_out_of_range`, `frequency_too_high`, `corrupt_schedule_log` 및 `internal_error`입니다.

## 실시간 전달

프로세스 로컬 소유자는 영속 fold에서 가장 이른 타이머를 도출하고, 제한된 대기 후마다 실제 시계를 다시 읽습니다. 비활성 Session은 작업을 수행하지 않으며, 다시 열면 타이머를 재구성하고 과거의 대상 시점을 기한이 지난 상태로 만듭니다. 기한이 지난 일회성 작업은 우선순위를 가지며 한 번에 하나씩 다음 턴에 진입합니다. 기한이 지난 일회성 작업이 없으면, 기한이 지난 모든 Every 레코드가 앞서 설명한 단일 배치를 구성합니다.

기한이 지난 작업은 Agent가 완전히 유휴 상태가 될 때까지 기다린 후 상태를 다시 fold하고, 결정을 샘플링하고, `followup()` 하나를 대기열에 넣고, 해당 디스패치 변경 사항을 추가하기 전에 유지 관리 단계를 확보합니다. `steer()`은 호출하지 않으며 현재 턴을 중단하지도 않습니다.

승인된 일회성 또는 고정 속도 배치는 일반적인 다음 턴 하나를 시작하며, 일반 대화 기록을 통해서만 표시됩니다. Schedule에는 독립적인 영속 Web 영수증이나 브라우저 렌더러가 없습니다. 프레이밍 또는 동기식 큐 승인이 실패하면 디스패치는 기록되지 않고 리마인더는 활성 상태로 유지됩니다. 승인 후 영속 디스패치 전에 발생하는 짧은 충돌 구간에서는 복구 후 리마인더 내용이 반복될 수 있으므로, 이 경계는 정확히 한 번 전달이 아니라 최선 노력의 최소 한 번 전달입니다.
