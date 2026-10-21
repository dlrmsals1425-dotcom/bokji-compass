@AGENTS.md

# 복지나침반 작업 시작 전에 읽을 것
- 로컬 실행·음성 연결 요청은 `AGENTS.md`의 API 키 확인/요청 절차와 `docs/TEAM_VOICE_SETUP.md`를 먼저 따른다. 현재 음성 방식은 OpenAI STT이며 아래 과거 인수 문서보다 `docs/VOICE.md`가 우선이다.
- `docs/CLAUDE_CODE_HANDOFF.md`: 인수 문서(작업 규칙, 구조, 남은 할 일)
- `docs/HANDOFF-ADDENDUM.md`: 47bc438 이후 바뀐 것. 인수 문서와 다르면 이 문서가 우선
- `main`에 직접 푸시하지 말 것(푸시하면 곧바로 프로덕션에 배포됨). 브랜치를 만들고 PR로 올린다
- `DATA_GO_KR_SERVICE_KEY` 값은 출력·로그·커밋에 넣지 않는다
- `OPENAI_API_KEY`도 출력·로그·커밋에 넣지 않고 각 팀원 PC의 `.env.local`에서 사용한다. 이미 설정돼 있으면 다시 요청하지 않는다.
