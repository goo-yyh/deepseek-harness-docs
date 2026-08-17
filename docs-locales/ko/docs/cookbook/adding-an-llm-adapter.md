# Cookbook: LLM 어댑터 추가

새 모델 제공자를 연결하는 방법입니다. 참조 구현: `packages/llm/llm-deepseek`(직접 HTTP, `eventsource-parser`로 프레이밍된 SSE) 및 `packages/llm/llm-pi-ai`(LLM 라이브러리 래핑)입니다. 먼저 `packages/llm/llm/src/types.ts`의 `StreamChunk` 문서를 읽으세요. 두 어댑터가 검증한 프로토콜 규칙을 기록하고 있습니다.

## 구조

```ts ignore-check
class MyAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> { … }
}

export const name = 'llm-myprovider'
export const inject = ['llm']
export const Config: z<Config> = z.object({ apiKey: z.string(), … })

export function apply(ctx: Context, config: Config) {
  ctx.llm.registerAdapter(['my-provider'], new MyAdapter(…))
}
```

등록은 effect 기반(HMR 안전)이며, 제공자 라우트당 어댑터는 하나입니다. 중복 시 예외가 발생하며 다중 라우트 등록은 전부 성공하거나 전부 실패합니다. `options.provider`는 어댑터를 선택하고 `options.model`는 제공자 모델 id이므로, 동적 카탈로그 어댑터는 수명 주기 재구성 없이 새 모델을 제공할 수 있습니다. 시크릿은 cordis 네이티브 방식입니다. 환경 대체 값을 포함한 schemastery Config를 사용하고, `!!js process.env.MY_KEY`를 통해 cordis.yml에서 공급합니다. 코드에서 임의의 키 파일을 읽지 마세요.

## 프로토콜 의무 사항(두 구현에서 검증한 계약)

- `finish` 전에 `usage`를 내보내고, `finish` 이후에는 아무것도 내보내지 마세요. 견고한 방법은 제공자의 스트림 종료 마커까지 finish/usage를 버퍼링한 뒤 플러시하는 것입니다(후행 usage 전용 청크를 보내는 제공자를 처리합니다).
- 도구 호출 `arguments`는 처음부터 끝까지 RAW JSON 문자열이며, 스트림 조각은 `argumentsDelta`로 전송합니다. 제공자가 파싱된 객체를 반환하면 `block-end`에서 다시 문자열화하세요.
- 처음 나타난 스트림 순서대로 블록 `index`를 할당하고, 같은 블록의 모든 delta에 동일한 인덱스를 재사용하세요.
- 오류에는 승인된 경로가 정확히 두 가지 있습니다. `stream()`에서 THROW합니다(전송 및 프로토콜 실패 — 안정적인 코드와 함께 `LlmError`를 사용). 또는 `finish {kind: 'error' | 'aborted'}`로 스트림을 종료합니다(제공자의 대역 내 실패). 소비자는 두 경우를 모두 처리하므로 실패 클래스별로 선택하고 문서화하세요.
- `options.signal`를 준수하세요(fetch/SDK에 전달합니다).
- 제공자가 지원할 수 없는 `GenerateOptions` 필드(예: stop sequence를 지원하지 않는 제공자의 `stop` 목록)가 있으면, 이를 조용히 무시하지 말고 `LlmError(..., 'UNSUPPORTED')`를 throw하세요.
- 제공자가 후속 호출에서 응답 id, 서명 또는 기타 네이티브 메타데이터를 요구하면, 최소한의 무손실 JSON 프로젝션을 `finish.replayState`로 내보내세요. 히스토리를 재구성할 때 이를 검증하세요. `LlmRuntime`는 과거 제공자 라우트와 대상 제공자 라우트를 정확히 동일한 어댑터 인스턴스가 현재 소유할 때만 이를 전달합니다. 동일 모델, 모델 간 또는 제공자 간 복원이 적법한지는 어댑터가 결정합니다. 상태가 없을 때 제공자/모델 이름만으로 네이티브 재생을 추론하지 마세요.

제공자별 사고 모드 토글은 어댑터의 Config에 유지됩니다. 정확한 모델 메타데이터에는 제공자 중립적인 기능 추상 심 하나를 사용합니다. 제공자/모델 식별자와 선택적 `context` 및 `reasoning` 필드를 포함하여 `resolveModel()`를 구현하고, 존재할 때만 구성된 `defaultEffort`를 선언하며, 리졸버의 선택적 `AbortSignal`를 준수하세요. 추론 노력은 어댑터가 제공자 요청에 매핑하는 순서가 있는 불투명 id입니다. 지원되는 경우 어댑터 정의 `off`를 포함하여 어댑터의 권위 있는 선택 가능 목록을 보존하세요. 최종 wire 표기를 노출하거나 지원되지 않는 값을 제한하지 마세요. id가 wire 표현과 같을 필요는 없습니다.

## 구현 구조

wire 타입, 요청 직렬화, 전송 파싱, 청크 변환 및 어댑터 클래스를 별도의 책임으로 유지하세요. [`llm-deepseek`](../../packages/llm/llm-deepseek/README.md)가 참조 레이아웃입니다.

## 검증

어댑터 적용 범위, 실제 제공자 검사 및 게시된 엔트리 요구 사항을 담당하는 [리포지토리 테스트 정책](../testing.md)을 따르세요.
