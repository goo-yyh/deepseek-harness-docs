# 하위 시스템

DeepSeek Harness의 하위 시스템마다 하나의 페이지를 제공합니다. 각 페이지에서는 하위 시스템의 개념, 이동하는 데이터 구조, 그리고 `ctx` 서비스 또는 이벤트 범위가 이를 지원하는 경우 서비스 및 이벤트 참조를 담은 생성된 **Cordis API**  섹션을 설명합니다. 이 폴더는 [architecture.md](../architecture.md)를 보완하며, 이 문서는 하위 시스템 전반의 *동작* (서비스 맵, session/turn/step 수명 주기, 이벤트 분류 체계)을 설명합니다. 여기의 각 페이지는 하나의 하위 시스템에 대한 용어와 연결 방식을 참조로 제공합니다.

| 페이지 | 담당 내용 |
|---|---|
| [core.md](core.md) | `packages/core`가 에이전트 루프를 제어하는 방식: 패키지별 루프 설명, 에이전트 생성 및 소유권(`AgentHandle`), `Agent` 핸들의 delivery/cancellation/interception 계약, 리포지토리 전체의 타입 패턴(`…Map → derived-union`, 브랜디드 ID) |
| [llm-streaming.md](llm-streaming.md) | `packages/llm` 대화 타입 — `Message`/`ContentBlock`, 조합된 모델 요청, `StreamChunk` 와이어 프로토콜 및 어댑터 계약, `BlockAssembler`, `LlmAdapter` 공급자 계약 |
| [token-meter.md](token-meter.md) | 소비된 로그 수정본을 포함한 불변 스칼라 및 위치 재생 측정값 |
| [scope.md](scope.md) | 범위가 지정된 등록 식별자, 디스패치 전달자, 그리고 소유된 `Scope` 컨텍스트 |
| [typert.md](typert.md) | Remote 호출 기술자, 조회/Context 선언, Typert 레지스트리, Host 게이트웨이/Client API 경계 |
| [goal.md](goal.md) | 영속된 목표 식별자, 수명 주기 스냅샷, 활성화, 변경 레코드 및 라운드 귀속 |
| [schedule.md](schedule.md) | 세션 로컬 알림 레코드, 지속 가능한 전환, 활성 뷰 및 일반 대화 전달 |
| [commands.md](commands.md) | 사용자 명령 레지스트리 서비스: 정의, 어댑터 검색, 직접 호출, 결과 및 구문 분석 뷰 |
| [session.md](session.md) | 전체 `SessionEventMap` 변형 카탈로그, `TurnTrigger`/`TurnEndReason`, `deriveMessages()`, 실행 인클로저 및 독립 이벤트 |
| [persistence.md](persistence.md) | 영속성 추상 접점: `SessionPersistence`, JSONL + SQLite 백엔드, `session/flush`, 충돌 복구, `SessionHeader` |
| [settings.md](settings.md) | 사용자 설정 추상 접점: `SettingsNamespace` 등록, 계층형 확인(기본값 → 구성 `base` → 사용자 문서), 소유자 범위, 핫 커밋 |
| [credentials.md](credentials.md) | 자격 증명 추상 접점: 구성의 `CredentialRef` 참조(값은 제외), 작업별 확인, UI 안전 `CredentialInfo`, 공급자 소스 계층 |
| [session-query.md](session-query.md) | 논리 레코드, 제한된 정확한 이벤트 읽기, 관계 추적, 의미 필터/문서 및 전문 검색 결과 페이지 |
| [feedback.md](feedback.md) | 수명 주기에 연결된 메시지별 피드백 레코드, 낙관적 버전, 사이드카 영속성 및 Host Remote 계약 |
| [session-title.md](session-title.md) | 지속 가능한 제목 스냅샷, 인용된 소스 메시지 seq 및 비동기 공급자 계약 |
| [session-reference.md](session-reference.md) | 구조화된 세션 간 참조: `SessionReferenceInput`/`Candidate`, 준비된 메시지 컨텍스트, 안정적인 오류 분류 체계 |
| [system-prompt.md](system-prompt.md) | 조립별 컨텍스트, 도구 공급자 결과, 프롬프트 섹션 및 협력적 조립 |
| [tools.md](tools.md) | `ToolDefinition` 전체 필드, 스키마 DSL, `ToolExecution`/`ToolResult`, 도구 표시 UI 타입 및 보호된 실행 파이프라인 |
| [user-questions.md](user-questions.md) | UI 기반 사용자 질문/답변 추상 접점: `AskUserQuestionRequest`, 답변/옵션 용어, 공급자 API, 오류 분류 체계 |
| [approval.md](approval.md) | 일회성 사용자 승인 추상 접점: `ApprovalRequest`, `ApprovalOutcome`, 세션별 정책, 감사 이벤트 및 응답자 계약 |
| [attachment.md](attachment.md) | 지속 가능한 이미지 식별자 및 메타데이터, 검증 입력, 검증된 읽기 및 `AttachmentStore` 추상 접점 |
| [shell.md](shell.md) | bash 실행기 추상 접점: `ShellExecRequest`/`Spec`, `ShellRunResult`, 백그라운드 `ShellProcess` 핸들 |
| [subprocess.md](subprocess.md) | 하위 프로세스 추상 접점: 완전히 명시적인 `SubprocessSpawnSpec`, 오프셋 기반 출력 리더, 분류되지 않은 `SubprocessOutcome` 및 관리되는 `DSH_*` 환경 용어 |
| [terminal.md](terminal.md) | 영구 터미널 ID, 백엔드/세션 계약, 전송 준비 상태, 제한된 읽기 및 소유자에게 표시되는 스냅샷 |
| [sandbox.md](sandbox.md) | 세션별 정책 확인 및 프로세스 격리 추상 접점: 파일 효과 모드, 실행/공급자 정책, `ConfinedArgv`, 강제 적용 및 실패 폐쇄 오류 |
| [code-runtime.md](code-runtime.md) | 코드 실행 추상 접점: `CodeRunRequest`/`Result`, 바인딩 네임스페이스, 캡처된 로그, `CodeRunFailure` 분류 체계 |
| [extensions.md](extensions.md) | 버전이 지정된 동적 Cordis Plugins 및 Packages, Host/Client 활성화, 승인, 런타임 검사 및 수명 주기 해제 |
| [filesystem.md](filesystem.md) | 파일 시스템 추상 접점: `FsTarget`, read/write/edit 결과, 관찰된 파일 상태, `FsErrorCode` |
| [lsp.md](lsp.md) | LSP 탐색 추상 접점: `LspQueryRequest`/`Result`, `LspProvider`/`Service`, 네 가지 작업, `LspError` |
| [skills.md](skills.md) | 스킬 서비스: 검색 우선순위, `SkillSummary`/`SkillDefinition`, 세션 접두사 카탈로그, 모델 대상 `skill` 로딩 |
| [compaction.md](compaction.md) | 압축 추상 접점: `compaction/*` 세션 이벤트, `CompactionResult`, `CompactionEngine` 인터페이스 |
| [subagent.md](subagent.md) | 하위 에이전트 추상 접점: 명명된 공급자 레지스트리, `SubagentStartRequest`/`Result`/`Run`, 시작 시점과 런타임 간 기능 분리 |
| [web.md](web.md) | 웹 액세스 추상 접점: `WebSearchRequest`/`Result`, `WebFetchRequest`/`Result`, `WebFetchBody`, 공급자 가용성, `WebError` |
| [spill.md](spill.md) | 스필 저장소 추상 접점: `SaveTextSpill`, `SpillOwner`/`SpillSource`, `SpillRef`, 브랜디드 `SpillLocator` |
| [workflow.md](workflow.md) | 워크플로 추상 접점: `WorkflowStartRequest`, `WorkflowMeta`, `WorkflowRun`/`Result`, `workflow/*` 이벤트 페이로드, `WorkflowError` 치명성 |
| [jobs.md](jobs.md) | 백그라운드 작업 런타임: 브랜디드 `JobId`, 생산자 계약, 소비자 뷰 및 `ctx.jobs` 서비스 동작 |
| [permission-presets.md](permission-presets.md) | 권한 사전 설정 계층: `PresetSpec`/`PresetOption`, 파생된 `custom` 상태, 로그 전용 `permission/preset` 이벤트 |
| [plan.md](plan.md) | 계획 모드: 로그 전용 `plan/mode` 상태, 보류 중인 선택 플러시, `PlanModeConfig`, `exit_plan_mode` 검토 흐름 |
| [invariants.md](invariants.md) | 런타임 불변 조건 레지스트리: 선택 `Config`, `InvariantInstaller`/`InvariantFailure`, 빈 동반 항목 계약 |
| [web-server.md](web-server.md) | HTTP 전달자: `WebRouteKind`/`WebRoute`, 일치 순서, 획득 가능한 폴백 자리, 인덱스 탭 |
| [storage.md](storage.md) | 저장소 하위 시스템: 백엔드 계약(`StorageBackend`), `StorageForms`, `DomainSpec`/`Domain`, `domain/changed` |
| [workspace.md](workspace.md) | 워크스페이스 레지스트리: `Workspace`/`WorkspaceId`, 등록 및 확인, 세션 `cwd` 관계 |
| [client-modules.md](client-modules.md) | 웹 플러그인 테이블: `dsh.client` 선언, `WebBootGraph` 와이어 구성, 번들 경로 및 인덱스 탭 |
| [session-projection.md](session-projection.md) | 프로젝션 추상 접점: `SessionProjectionMap`, 순수한 `ProjectionDefinition` 단위, `ProjectionSnapshot`의 일관된 절단, 변경 피드 |
| [session-telemetry.md](session-telemetry.md) | 아웃바운드 세션 보고 기능 추상 접점: `SessionTelemetryRecord`/`SessionTelemetrySeverity`, `SessionTelemetrySink` 계약 및 `session-telemetry/record` 삭제 워터폴 |

> 이 페이지의 타입 선언과 해당 JSDoc은 소스와 동등하며 `pnpm run verify-type-equiv`로 드리프트를 검사합니다([development.md](../development.md#documenting-types-verbatim-ts-type-equiv) 참고). 일반 블록은 완전한 선언을 유지하고, `public-api` 블록은 본문이 제거된 공개 클래스 선언을 유지합니다. Cordis 서비스와 이벤트는 각 페이지에서 생성된 **Cordis API**  섹션을 사용합니다.
