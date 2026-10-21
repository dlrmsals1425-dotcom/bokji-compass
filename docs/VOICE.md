# 말로 찾기: OpenAI STT

/situation의 자유문장 입력에 음성 입력을 제공한다. 브라우저가 녹음한 음성을 Next 서버가 OpenAI에 전달하고 한국어 전사문을 돌려받는다. 사용자가 확인·수정하고 **입력칸에 넣기**를 눌러야 기존 글 뒤에 추가된다.

## 모델과 처리 흐름

- 필요한 기능은 **STT(음성 → 글)**다. 현재 모델은 [OpenAI gpt-transcribe](https://developers.openai.com/api/docs/models/gpt-transcribe)이며 POST /v1/audio/transcriptions에 파일, model, languages[]=ko, response_format=json을 전달한다.
- **브라우저 → 앱의 /api/voice/transcribe → OpenAI → 확인창** 순서다. 방문자는 모델이나 API 키를 설치하지 않는다. 키와 API 비용은 서비스를 운영하는 계정에서 관리한다.
- 사용자가 제시한 [Qwen3-TTS MLX 모델](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit)은 글 → 음성인 TTS이므로 이번 음성 입력에 사용하지 않는다.
- 이전 faster-whisper 자체 서버 코드는 실험 이력으로 보존했다. 현재 앱은 해당 서버를 호출하거나 오류 시 그쪽으로 전환하지 않는다.

## 사용자 동작

1. 음성 처리 안내에 동의하고 **음성 입력 시작**을 누른다.
2. 마이크 권한을 허용하고 사는 곳과 상황을 말한다.
3. 다 말하면 **말하기 완료**를 누른다. 중간 침묵을 종료 신호로 사용하지 않으며 실제 녹음 시작부터 최대 60초다.
4. 마이크를 끄고 서버에서 글로 변환한다. 실시간 자막 방식은 아니다.
5. 문장을 확인·수정한 뒤 **입력칸에 넣기**, 이어서 기존 **이 문장으로 아래 칸 채우기**를 사용한다.

기존 글 뒤에 공백으로 한 번만 붙인다. 합산 500자를 넘으면 자르지 않고 수정 안내를 표시한다. 취소·동의 철회·수동 수정·대상 변경·문장 해석·화면 이동·탭 숨김은 녹음과 미확인 초안을 폐기한다. 늦은 응답은 적용하지 않는다. 이미 OpenAI에 전송한 요청은 취소하더라도 처리나 과금이 발생할 수 있다.

## 데이터와 제한

- MediaRecorder와 getUserMedia를 지원하는 HTTPS 또는 localhost 계열 환경이 필요하다. WebM/Opus, MP4, Ogg 중 지원 형식을 고른다. 브라우저 Web Speech 서비스는 사용하지 않는다.
- 동의와 시작 후 서버의 키 설정 여부를 확인하고 마이크를 연다. GET 상태 확인은 유료 요청을 보내지 않으며 키의 유효성·잔액·모델 권한까지 보장하지는 않는다.
- 준비 대기 20초, 녹음 60초, 녹음 중지 정리 3초, 변환 대기 120초 제한이다. 서버의 OpenAI 요청 제한은 115초다.
- 앱은 음성·전사문을 메모리에서 처리하며 별도 파일·본문 로그로 보관하지 않는다. 응답은 no-store다. OpenAI로의 전송은 화면에 안내하고 [OpenAI 데이터 정책](https://developers.openai.com/api/docs/guides/your-data)을 링크한다. 배포 프록시/APM에서도 본문 수집을 켜지 않아야 앱의 보관 정책이 유지된다.
- OPENAI_API_KEY는 서버 환경변수로만 읽는다. NEXT_PUBLIC_ 접두사를 붙이거나 브라우저에 전달하지 않는다. 공급자 오류 본문을 클라이언트에 노출하지 않으며 유료 요청을 자동 재시도하지 않는다.
- 업로드 출처는 실제 Host로 확인하고 임의 X-Forwarded-Host는 사용하지 않는다. Next 내부 URL은 localhost로 정규화될 수 있다.
- 업로드 8MiB, 업로드 대기 15초, 웹 프로세스당 동시 요청 2개로 제한한다. 60초는 브라우저 녹음 제한이며 현재 Next 서버가 음성을 디코딩해 길이를 검증하지는 않는다. 이 제한은 분산 호출 횟수·사용자별 과금 제한이 아니다.
- 무음 결과·오류·권한 거절에서는 직접 입력을 유지한다. 모델의 빈 전사문은 422로 처리한다. 잡음·무음에서 잘못된 문장이 생성될 가능성은 있어 확인창에서 검토해야 한다.

## Windows 로컬 실행

[팀원·코딩 에이전트 실행 안내](TEAM_VOICE_SETUP.md): 루트 `AGENTS.md`에 키가 없을 때만 요청하고 설정된 키를 재사용하는 절차를 명시했다. `CLAUDE.md`에서도 이 안내를 참조한다. 실제 키는 팀원에게 별도로 전달하며 각 PC의 `.env.local`에서 읽는다.

bokji-voice / jinwoo에서 실행한다. .env.local에 다음 값을 직접 설정한다. 키는 Git에서 제외되며 채팅·화면 캡처·로그에 넣지 않는다.

~~~env
OPENAI_API_KEY=발급받은_프로젝트_API_키
~~~

~~~powershell
npm.cmd ci
npm.cmd run build
npm.cmd run start -- -p 3220 -H 127.0.0.1
~~~

[음성 화면](http://127.0.0.1:3220/situation). 키를 바꾸면 웹 서버를 재시작한다. Python·Whisper 설치와 8767 서버는 현재 앱 실행에 필요 없다. STT_SERVICE_URL / STT_SERVICE_TOKEN도 현재 웹 API에서는 사용하지 않는다.

## 서버에 옮길 때

Next 앱을 Node.js 실행 환경에 배포하고 배포 플랫폼의 비밀 환경변수에 OPENAI_API_KEY를 설정한다. 외부 HTTPS 연결로 api.openai.com에 접근할 수 있어야 한다. 웹이 서버에 배포되면 방문자는 이 PC나 로컬 모델에 의존하지 않는다. 현재 3220은 이 PC의 loopback 실행이며 공개 배포는 하지 않았다.

공개 운영 전 프록시·게이트웨이에서 사용자/IP별 호출 횟수와 업로드 크기·시간 제한을 설정한다. Origin 확인은 브라우저 간 요청을 걸러 내는 장치이며 인증이나 과금 남용 방지를 대체하지 않는다. 플랫폼의 업로드 한도가 8MiB보다 작거나 함수 실행 한도가 120초보다 짧다면 해당 한도도 적용된다. 실제 다중 사용자 부하는 미검증이다.

## 검증

2026-10-16 OpenAI 전환 코드에서 직접 실행했다. 아래 실연결은 사용자의 실제 발화 대신 합성 음성을 사용했다.

| 검사 | 결과 |
|---|---|
| 녹음/웹 API/문장/기존 parse 단위 | 118/118 (22 + 34 + 27 + 35) |
| 가짜 마이크/HTTP로 UI 흐름 검증 | 22/22 (데스크톱 18, 모바일 4), 19.2초 |
| lint / 전체 타입 / 프로덕션 빌드 | 통과 |
| 실제 Next → OpenAI, 합성 한국어 WAV | 10.13초 음성(3초 침묵 포함)을 약 2.09초에 변환 |
| 실제 Next → OpenAI, 2초 무음 WAV | HTTP 422, no_speech |
| 실제 Chromium MediaRecorder → Next → OpenAI → 확인·입력 | 1/1, 14.6초 (녹음 포함, 실행 전체 15.4초) |

합성 문장: “저는 수원시에 살고 있습니다. 지금 일자리를 찾고 있고 월세 지원이 필요합니다.” 수원·일자리·월세가 모두 유지됐고, 확인 전에는 입력칸이 바뀌지 않으며 확인 후에도 자동 해석하지 않는 것을 검사했다. 시간은 단일 샘플 측정값이며 일반적인 지연·정확도 평가가 아니다.

~~~powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test -- tests/unit/voice-recorder.test.ts tests/unit/voice-route.test.ts tests/unit/voice-text.test.ts tests/unit/parse.test.ts --maxWorkers=1
$env:E2E_BASE_URL='http://127.0.0.1:3220'
npm.cmd run e2e -- tests/e2e/voice.spec.ts --workers=1
# 수원·일자리·월세를 넣은 합성 WAV를 준비한 뒤, 실제 API 비용이 발생하는 검사:
py -3.13 scripts/smoke-stt.py logs/stt-korean.wav --skip-silence
$env:STT_TEST_WAV='logs/stt-korean.wav'
npm.cmd run e2e -- tests/e2e/voice-model.spec.ts --project=desktop-chromium --workers=1
~~~

**미검증:** 실제 사용자 마이크·말투·잡음별 정확도, 실제 휴대폰/Safari, 다중 사용자 부하, 공개 배포. 모바일 검사는 Chromium 에뮬레이션이다. 전체 앱 단위/E2E 통과를 주장하지 않는다.

## 변경 범위와 이전 실험

브라우저 SpeechRecognition의 빠른 종료를 피하기 위해 MediaRecorder와 완료 버튼을 도입했다. 자체 faster-whisper 모델을 시험한 뒤 사용자 요청으로 OpenAI gpt-transcribe로 전환했다. 질문 흐름·추천 알고리즘·데이터·/ask는 바꾸지 않는다. 기존 화면에는 음성 컨트롤과 필요한 개인정보 안내만 적용한다.

local-stt/, scripts/setup-stt.py, scripts/start-local-stt.ps1은 이전 자체 모델 실험이다. 다시 실행하더라도 현재 Next API와 자동 연결되지 않는다. 해당 버전의 111개 JS 단위·8개 Python 검사·Whisper 측정값은 Git 이력과 팀 인계 기록에 보존하며 현재 OpenAI 검증 결과와 구분한다.
