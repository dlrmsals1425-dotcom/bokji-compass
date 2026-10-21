# ChatGPT Sites 배포

접속 주소: https://bokji-jinwoo-ui.nutmeg-frog-5006.chatgpt.site

2026-10-20 사용자 요청으로 공개(`public`) 상태로 변경했다. 링크로 누구나 접근할 수 있고, 로컬 서버를 켜 두지 않아도 서비스가 동작한다. 음성 API의 `OPENAI_API_KEY`는 Sites의 서버 비밀 설정으로 관리하며, 이 저장소에는 키가 없다.

## 저장소 구성

| 위치 | 용도 |
| --- | --- |
| 루트 `src/`, `public/`, `package.json` | 기존 Next.js 앱과 검사 |
| `sites/bokji-jinwoo-ui/` | 실제 배포한 Vinext/Cloudflare Worker 앱의 전체 소스 |

배포 폴더의 파일은 Sites 소스 커밋 `a7d2ec63adad023824f0a1cdaf01df19d1e893f3`에서 그대로 가져왔다. GitHub 루트의 UI 기준 커밋은 `81eae659e7a6a1fae0d90371d34b307611ab8ee8`이다. 데이터·이미지·폰트도 포함해 독립적으로 설치하고 빌드할 수 있으며, Git 메타데이터·비밀값·로그·의존성 설치 폴더·빌드 출력은 포함하지 않았다.

두 앱은 별도 실행 환경을 사용한다. 루트 타입 검사와 ESLint는 `sites/`를 제외하며, Sites 앱은 해당 폴더에서 자체 검사한다.

## 개발 및 게시

```bash
cd sites/bokji-jinwoo-ui
npm run install:ci
npx tsc --noEmit
npm run build
```

Sites 실행 환경에 맞춘 변경은 해당 폴더의 [DEPLOYMENT.md](../sites/bokji-jinwoo-ui/DEPLOYMENT.md)에 기록했다. GitHub 푸시만으로 Sites가 자동 재배포되지는 않는다. 수정 후에는 Sites 스킬의 소스 동기화·버전 저장·배포 절차로 게시한다.

`.openai/hosting.json`의 `project_id`는 기존 사이트 식별자다. 같은 서비스 갱신에는 이를 재사용하고 사이트를 다시 생성하지 않는다. 공유 권한이나 비밀값을 소스 파일에서 변경하지 않는다.

## 확인된 배포

- 배포 소스: `a7d2ec63adad023824f0a1cdaf01df19d1e893f3`
- 확인일: 2026-10-20
- 상태: `succeeded`, 환경 설정 revision 1
- 접근 범위: `public`, 접근 정책 revision 2. 공개 전환 후 인증 헤더·쿠키 없이 홈 HTTP 200과 서비스 본문을 확인했다.
- 타입 검사와 빌드, 데스크톱/모바일 화면 검사 12개 통과
- 게시 주소의 홈·질문·말로 찾기·복지 데이터·전국 경계·상세·음성 API 등 8개 경로 HTTP 200
- 음성 API 두 경로 모두 `available: true`. 이는 설정 확인이며 실제 사용자 마이크 전사를 시험한 결과는 아니다.

위 결과는 배포 당시 실행한 검사다. GitHub 소스 복사·푸시 단계에서는 파일 내용 일치와 루트 검사 범위, 비밀값 제외를 확인하며, 변경 없는 기능 검사를 재실행한 것으로 표시하지 않는다.
