# 팀원의 로컬 실행과 음성 API 키

이 프로젝트를 로컬로 실행하거나 음성 입력을 연결해 달라는 요청을 받으면 아래 순서를 따른다. 문서 편집·코드 검토만 하는 작업에는 키를 요구하지 않는다. 음성 기능의 현재 기준은 `docs/VOICE.md`, 팀원 실행 안내는 `docs/TEAM_VOICE_SETUP.md`다. 과거 인수 문서의 "서버 API 없음" 설명보다 이 음성 안내를 우선한다.

1. 현재 프로젝트의 서버 환경변수와 루트 `.env.local`에 `OPENAI_API_KEY`가 설정되어 있는지 확인한다. 값 전체를 출력하지 않고 설정 여부만 확인한다. 빈 값이나 예시 문자열은 설정으로 간주하지 않는다. 다른 프로젝트·개인 설정에서 키를 찾지 않는다.
2. 키가 있으면 다시 요청하지 않고 그대로 사용한다. 키가 없으면 사용자에게 아래처럼 설정을 요청한다. 키를 기다리는 동안 의존성 설치와 일반 앱 검증은 진행할 수 있지만 음성 연결 완료로 보고하지 않는다.

   > 음성 인식에 사용할 OpenAI API 키가 필요합니다. 팀에서 별도로 받은 키 또는 본인 키를 설정해 주세요. 프로젝트 루트 `.env.local`에 `OPENAI_API_KEY=받은키`로 저장하면 됩니다. 키는 채팅에 붙이지 말고 파일에 직접 입력하거나 코딩 도구의 비밀 입력 기능을 사용해 주세요. 설정을 마치면 실행을 이어서 확인하겠습니다.

3. 사용자가 키 설정을 맡기거나 값을 제공했다면 `.env.local`의 `OPENAI_API_KEY` 항목에만 반영한다. 다른 환경값은 보존한다. 키를 응답·로그·소스·브라우저 번들에 복사하지 않는다. `.env.local`은 Git 제외 상태를 유지하며 강제로 추가하지 않는다. `NEXT_PUBLIC_` 접두사를 붙이지 않는다.
4. 키를 추가하거나 바꾼 뒤 이 프로젝트의 웹 서버를 시작/재시작한다. `GET /api/voice/transcribe`의 `available: true`는 설정 확인일 뿐 키 유효성·잔액·실제 인식 성공을 보장하지 않는다. 실제 연결을 시험할 때는 합성 음성을 사용하고 시험 범위를 보고한다.
5. 현재 모델은 서버의 `gpt-transcribe`다. 팀원의 브라우저는 자기 로컬 Next 서버를 호출하며 그 서버가 OpenAI를 호출한다. 공유 키를 쓰면 해당 키 소유자의 API 사용량으로 처리된다. 별도 Whisper 서버나 모델 설치는 필요 없다.
6. 이후 pull·merge에서 `.env.local`을 덮어쓰거나 매번 키를 다시 요청하지 않는다. 키가 없어졌거나 실제 인증 오류가 확인된 경우에만 재설정을 안내한다. 코드 갱신 뒤에는 개발 서버를 재시작하거나 프로덕션 빌드를 다시 만들어 적용한다.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
