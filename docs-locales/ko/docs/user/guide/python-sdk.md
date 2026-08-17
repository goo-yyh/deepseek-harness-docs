# Python SDK 시작하기

이 튜토리얼은 Web UI를 프로그래밍 방식으로 대체하는 방법입니다. 배포된 Python SDK를 설치하고, 저장소에 포함된 에이전트 구성을 실행하며, 자체 프로그램에서 동일한 API를 호출하는 방법을 보여 줍니다.

## 사전 요구 사항

- Python 3.10 이상
- Git
- Linux x64, Linux arm64 또는 arm64의 macOS 14 이상
- DeepSeek 호환 API 엔드포인트 및 자격 증명
- 에이전트가 수정할 수 있는 격리된 워크스페이스

## SDK 설치

실행 가능한 예제를 위해 저장소를 복제하고, 가상 환경을 만든 다음, 동일 버전의 번들 런타임과 함께 SDK를 설치합니다.

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
python -m venv .venv
. .venv/bin/activate
python -m pip install deepseek-harness-sdk
```

설치된 런타임에는 시스템 Node.js가 필요하지 않습니다. 런타임 또는 wheel을 소스에서 빌드해야 하는 저장소 기여자는 [Python 기여자 워크플로](../../../python/development.md)를 사용해야 합니다.

## 저장소에 포함된 예제 실행

환경에 자격 증명을 설정합니다. 모델이 기본 DeepSeek 엔드포인트 대신 OpenAI 호환 프록시에서 제공되는 경우에는 `DEEPSEEK_BASE_URL`도 설정합니다.

```sh
export DEEPSEEK_API_KEY=sk-your-key-here
# export DEEPSEEK_BASE_URL=http://127.0.0.1:8000/v1
# export DSH_MODEL=deepseek-v4-flash
# export DSH_SYSTEM_PROMPT='You are a helpful software engineer assistant.'
```

격리된 워크스페이스와 세션 디렉터리를 대상으로 작업 하나를 실행합니다.

```sh
python examples/jsonrpc-agent/minimal.py \
  --workspace /absolute/path/to/workspace \
  --session-root /absolute/path/to/sessions \
  --session-id example-001 \
  "Inspect the repository and fix the failing tests."
```

스크립트는 최종 어시스턴트 응답을 출력합니다. 세션 디렉터리에는 구성된 모델 요청과 도구 호출이 포함된 JSONL 로그가 저장됩니다.

## 자체 프로그램에서 SDK 사용

저장소에 포함된 예제는 다음 SDK 호출을 감싼 간단한 래퍼입니다.

```python
from pathlib import Path

from deepseek_harness import DeepSeekHarness

config = Path("examples/jsonrpc-agent/minimal.cordis.yml").resolve()
workspace = Path("/absolute/path/to/workspace").resolve()
sessions = Path("/absolute/path/to/sessions").resolve()

with DeepSeekHarness(
    provider="deepseek-official",
    model="deepseek-v4-flash",
    max_tokens=49_152,
    cwd=str(workspace),
    session_root=str(sessions),
    cordis=str(config),
) as harness:
    result = harness.run(
        "Inspect the repository and fix the failing tests.",
        session_id="example-001",
    )

print(result.final_response)
```

`DeepSeekHarness`는 번들 런타임을 지연 시작하고 컨텍스트 관리자가 종료될 때까지 재사용합니다. 동일한 harness와 세션 ID를 재사용하면 작업 디렉터리, 내보낸 변수, 셸 함수를 포함하여 세션이 소유한 Bash 프로세스가 유지됩니다. 독립적인 작업에는 새 세션 ID를 사용하고, 다음 호출이 동일한 영속 대화를 계속해야 할 때만 ID를 재사용합니다.

## 예제 구성 이해하기

| 속성 | 값 |
|---|---|
| 시스템 프롬프트 | `DSH_SYSTEM_PROMPT`, 없으면 `You are a helpful software engineer assistant.` |
| `minimal.py`의 모델 | `--model`, 그다음 `DSH_MODEL`, 그다음 `deepseek-v4-flash` |
| 모델 대상 도구 | 영속적인 `bash` 및 `str_replace_editor`만 |
| Bash 시간 제한 | 300초 |
| 편집기 출력 제한 | 16,000자 |
| 컨텍스트 압축 | 비활성화됨 |
| 파일 시스템 | 최소 로컬 백엔드이며, 절대 편집기 경로는 런타임 프로세스에서 볼 수 있는 모든 경로를 지정할 수 있습니다 |
| 세션 영속성 | `DSH_SESSION_ROOT` 아래의 비압축 JSONL |

이 구성에는 harness ID, 워크스페이스 프롬프트 텍스트, skills, 일회성 Bash, 작업 도구, 압축 및 그 밖의 모든 모델 대상 플러그인이 포함되지 않습니다. 샌드박스 정책 정보는 시스템 프롬프트에 추가되지 않고 런타임 사용자 컨텍스트로 기록됩니다.

## 워크스페이스 및 세션 ID 선택

`cwd`는 에이전트가 사용할 수 있는 워크스페이스를 선택하고, `session_root`는 세션 로그와 상태를 저장합니다. 독립적인 작업에는 새 세션 ID를 사용하고, 다음 호출이 동일한 대화와 영속 셸 상태를 계속해야 할 때만 ID를 재사용합니다.

이 구성은 `danger-full-access`를 사용합니다. 일회용 체크아웃 또는 컨테이너 안에서만 실행하세요. Bash와 편집기는 런타임 프로세스에 허용된 모든 경로를 수정할 수 있습니다. 영속 PTY 백엔드에는 POSIX 터미널 기반 환경이 필요하므로 이 구성은 Windows 에이전트를 지원하지 않습니다.

[`jsonrpc-agent` 예제 참조](../../../examples/jsonrpc-agent/README.md)에서 정확한 구성을 다룹니다. [Python SDK 참조](../../../python/sdk/README.md)에서는 수명 주기, 결과, 알림, 런타임 선택 및 구성을 다루며, [Cordis 입문서](../../cordis-primer.md)에서는 구성 구문을 다룹니다.
