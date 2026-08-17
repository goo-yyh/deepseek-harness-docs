# 모델 구성

이 가이드는 [루트 README](../../../README.md#run)를 통해 Web UI를 시작했다고 가정합니다. 서버를 다시 시작하지 않아도 다음 요청부터 모델 변경 사항이 적용됩니다.

## DeepSeek 구성

**Settings → Models**를 엽니다. DeepSeek 카드에는 API 키 필드가 하나 있습니다. 키를 입력하고 저장합니다.

![Models 페이지: DeepSeek 카드와 그 아래의 Add provider 및 사용자 지정 제공자 추가](providers-models-page.png)

키는 쓰기 전용입니다. 저장 후 페이지는 리터럴 시크릿이 아니라 마스킹된 설명자만 받습니다. 키는 `$DSH_HOME/.credentials.yaml`에 저장되고, 설정에는 자격 증명 참조만 유지됩니다.

## 카탈로그 제공자 추가

**Add provider**를 선택하고 Anthropic 또는 OpenAI 등의 제공자를 선택한 다음 API 키를 입력하여 저장합니다. 설치된 카탈로그가 엔드포인트, 프로토콜 및 모델 목록을 제공합니다.

네이티브 인증을 사용하는 제공자에는 대신 해당 네이티브 자격 증명이 필요합니다. Bedrock, Vertex, Azure, Codex는 각각 AWS 자격 증명 및 리전, ADC 프로젝트, `api-version`, OAuth를 사용합니다. API 키 필드만 채워서는 구성되지 않습니다.

## 사용자 지정 제공자 추가

회사 게이트웨이, 자체 호스팅 서버 또는 설치된 카탈로그에 없는 제공자에는 **사용자 지정 제공자 추가** 를 선택합니다. 소문자 Provider ID, 기본 URL, API 프로토콜, 자격 증명 및 하나 이상의 모델을 제공합니다.

![사용자 지정 제공자 양식: Provider ID, 표시 이름, 기본 URL, API 프로토콜 및 API 키](providers-custom-form.png)

Provider ID는 요청, 저장된 세션, 모델 기본값 및 자격 증명 참조에서 사용되므로 영구적입니다. 제공자 이름을 변경하려면 새 제공자를 추가하고 이전 제공자를 삭제합니다. 표시 이름, 기본 URL, 프로토콜, 자격 증명 및 모델은 계속 편집할 수 있습니다.

**Model catalog**에서 **Fetch available models** 를 선택하면 양식에 현재 표시된 기본 URL과 자격 증명을 조회합니다. 후보를 선택하면 초안이 업데이트되며, 저장하기 전까지 제공자는 저장되지 않습니다. 카탈로그 제공자는 네트워크 요청 없이 설치된 카탈로그를 사용합니다.

### 이미지 입력

직접 입력한 모델은 허용하는 모달리티를 엔드포인트에 물어볼 수 없으므로 달리 명시되지 않는 한 텍스트 전용으로 처리됩니다. 이러한 모델에 이미지를 첨부하면 전송 전에 모델 이름과 함께 거부됩니다.

따라서 사용자 지정 제공자의 비전 모델에는 한 줄이 필요합니다. 양식에는 이를 위한 필드가 없으므로 `input`에서 모델에 `$DSH_HOME/settings.yaml`를 추가합니다.

```yaml
llm-pi-ai:
  providers:
    my-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://gateway.example/v1
      models:
        - id: legacy-chat
        - id: vision-preview
          input: [text, image]
```

`input`는 `text` 및 `image`를 허용하며 해당 모델에만 적용되므로 하나의 라우트가 두 종류를 모두 제공할 수 있습니다. 이를 생략하거나 같은 의미인 빈 목록을 작성하면 설치된 카탈로그가 해당 모델에 기록한 내용을 유지하며, 카탈로그에 설명되지 않은 모델에는 라우트의 `defaultInput`로 대체합니다.

직접 입력한 모든 모델이 이미지를 허용한다면 각각에 설정하는 대신 라우트에서 한 번만 대체 값을 설정합니다.

```yaml
llm-pi-ai:
  providers:
    vision-gateway:
      apiKeyEnv: GATEWAY_API_KEY
      api: openai-completions
      baseURL: https://vision.example/v1
      defaultInput: [text, image]
      models:
        - id: first-model
        - id: second-model
```

`defaultInput`는 재정의가 아닌 대체 값이며 기본값은 `[text]`입니다. 카탈로그 제공자에서는 카탈로그에 설명되지 않은 모델에만 적용되므로, 이미지를 지원하는 카탈로그 모델에서 이미지를 제거하지 않습니다. 이들 중 하나를 제한하려면 해당 모델의 `input`를 사용합니다. 카탈로그 제공자에는 이를 넣을 `models` 목록이 없으므로 모델 id를 키로 하여 `modelOverrides` 아래에 작성합니다.

```yaml
llm-pi-ai:
  providers:
    anthropic:
      modelOverrides:
        claude-sonnet-4-5:
          input: [text]
```

각 목록에는 최소 하나의 모달리티를 지정해야 합니다. 단, 모델 자체의 목록에서는 빈 목록이 생략한 것과 같은 의미입니다. 알 수 없는 모달리티는 어디에 작성하든 거부됩니다.

두 필드는 엔드포인트를 확인하는 것이 아니라 엔드포인트에 관한 주장을 명시합니다. 엔드포인트가 실제로 제공하지 않는 이미지를 모델이 선언해도 여기서는 감지되지 않으며, 대신 제공자가 요청을 거부합니다.

## 모델 선택

구성된 제공자가 모델 선택기에 표시됩니다. 모델을 선택하면 새 세션의 기본 모델로도 설정됩니다. 이미 요청을 전송한 세션은 자체 로그에 기록된 모델을 유지합니다.

저장된 기본값이 삭제된 제공자를 가리키면 작성기는 **Select model** 을 표시하고 다른 모델을 선택할 때까지 입력을 차단합니다.

## 문제 해결

- **`MISSING_CREDENTIAL`** — Models 페이지를 통해 제공자 키를 저장하거나 참조된 환경 변수를 제공합니다.
- **`UNKNOWN_MODEL`** — 구성된 모델을 선택하거나 사용자 지정 제공자에 누락된 모델을 추가합니다.
- **사용 가능한 모델 가져오기가 401을 반환함** — 키를 확인합니다. 모델 검색은 OpenAI 호환 `GET /models` 엔드포인트를 호출합니다. 이를 제공하지 않는 엔드포인트의 모델은 수동으로 입력합니다.
- **이미지가 전송 전에 거부됨** — 모델이 이미지 모달리티를 선언하지 않았습니다. 사용자 지정 제공자의 모델에 `input: [text, image]`를 지정합니다. DeepSeek 자체 chat-completions 라우트는 텍스트 전용이며 다르게 구성할 수 없습니다.
- **제공자가 이미지를 포함한 요청을 거부함** — 모델이 엔드포인트가 실제로 제공하지 않는 이미지를 선언합니다. 이를 부여한 목록, 즉 모델의 `image` 또는 라우트의 `input`에서 `defaultInput`를 제거한 뒤 새 세션을 시작합니다. 첨부된 이미지는 세션 로그에 남아 있으므로 세션이 이를 벗어날 때까지 같은 요청이 반복됩니다.

## 고급 구성

생성된 [플러그인 구성 카탈로그](../../config-catalog.md)에는 지원되는 모든 필드와 기본값이 나열됩니다. [`dsh-llm-pi-ai`](../../../packages/llm/llm-pi-ai/README.md) 및 [`dsh-llm-deepseek`](../../../packages/llm/llm-deepseek/README.md) 참조는 직접 `settings.yaml` 구성, 카탈로그 확인, 추론 제어, 자격 증명 및 어댑터 오류를 다룹니다.
