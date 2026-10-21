# README UI 캡처 출처

README의 전후 비교는 실제 서비스 화면을 사용한다. 이미지의 색·문구·배치를 합성하거나 수정하지 않았다. 모든 이미지 크기는 1280 × 800이다.

## 변경 전

UI 브랜치 분기 기준 커밋 `e8d39c3ae7d3dc9e71a0519507dab614324aad5d`에 보존된 PNG 원본을 그대로 복사했다. 그 커밋을 새로 실행해 캡처한 화면은 아니며, 원본 캡처 날짜는 확인하지 않았다.

| 문서용 파일 | 기준 커밋의 원본 |
| --- | --- |
| [home-before.png](home-before.png) | `shots/home-paths-desktop.png` |
| [age-before.png](age-before.png) | `shots/02-input-desktop.png` |
| [results-before.png](results-before.png) | `shots/03-results-desktop.png` |

변경 전 결과는 과거 입력·판정 화면의 수원시 어르신 사례다. 현재 예시와 데이터 버전·입력 조건이 완전히 같지는 않으므로 건수나 판정 성능 비교에 사용하지 않는다.

## 변경 후

- 캡처일: **2026-10-20 20:44 KST**.
- 대상: [공개 ChatGPT Sites](https://bokji-jinwoo-ui.nutmeg-frog-5006.chatgpt.site).
- 배포 소스: `a7d2ec63adad023824f0a1cdaf01df19d1e893f3`. README 수정으로 앱을 재배포하지 않았다.
- 환경: Chrome headless, viewport 1280 × 800, deviceScaleFactor 1, 한국어, Asia/Seoul.
- 새 브라우저 세션에서 로그인·인증 헤더 없이 촬영했다. 스크롤 위치는 페이지 상단이다.
- 모션 감소 설정으로 정지 화면을 캡처했다. 나침반의 회전·커서 추적 동작을 검증한 영상은 아니다.
- 위치는 **수원시의 테스트 좌표**를 브라우저에 지정했다. 사용자의 실제 위치를 사용하지 않았다.
- 음성은 시작 전 대기 화면만 캡처했다. 마이크 녹음이나 실제 음성 전사는 실행하지 않았다.
- 단일 브라우저에서 순차 캡처하고 종료했다. 로컬 서버 실행·빌드·전체 회귀 검사는 하지 않았다.

| 파일 | 진입 경로·상태 |
| --- | --- |
| [home-after.png](home-after.png) | `/` · 첫 화면 |
| [location-after.png](location-after.png) | `/ask` · 본인 선택 후 추정 지역 확인 |
| [age-after.png](age-after.png) | `/ask` · 수원시 확인 후 첫 나이 질문, 답변 전 |
| [voice-after.png](voice-after.png) | `/situation` · 음성 입력 시작 버튼이 활성화된 대기 화면 |
| [results-after.png](results-after.png) | `/results?example=suwon-senior`로 진입 · 예시 적용 후 주소는 `/results` |

## 확인 범위

이미지 8장을 직접 확인했고, 변경 전 3장은 기준 커밋의 원본과 바이트가 일치함을 확인했다. 현재 캡처는 각 화면의 표시 완료와 글꼴 로딩을 기다린 뒤 저장했다. README의 이미지 링크를 누르면 보정하지 않은 원본 PNG를 볼 수 있다.
