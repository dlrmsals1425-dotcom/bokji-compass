# 복지나침반 운영 배포

운영 주소는 **https://bokji-compass.vercel.app** 이다. 2026-10-20 사용자가 이 주소를 배포 대상으로 확인했다. `https://goyang-welfare.vercel.app`은 별도 사이트이므로 이 작업의 배포 대상으로 사용하지 않는다.

코드 수정과 검토는 **https://github.com/dlrmsals1425-dotcom/bokji** 에서 진행한다. 이 저장소는 GitHub의 fork 네트워크에 속하지 않는 독립 저장소이므로, 여기의 PR 병합만으로 다른 계정이 관리하는 운영 프로젝트가 자동 갱신된다고 가정하지 않는다.

## 배포 권한과 연결 확인

운영 Vercel 프로젝트를 볼 수 있는 계정에서 다음을 확인한다.

1. 프로젝트의 Domains에 `bokji-compass.vercel.app`이 연결되어 있는지 확인한다.
2. Settings → Git에서 실제 연결 저장소와 Production Branch를 확인한다.
3. 프로젝트의 환경변수는 그대로 유지한다. 서식 다운로드와 HWPX 작성에 데이터 수집용 API 키를 추가할 필요는 없다. 기존 음성 입력 설정은 `docs/VOICE.md`를 따른다.

`vercel.json`은 `main`의 Git 배포만 허용한다. `**: false`와 `main: true` 중 명시적 허용이 적용되므로 다른 작업 브랜치의 배포를 함께 켜지 않는다. 실제 자동 배포에는 운영 프로젝트의 Git 연결도 필요하다. 동작 기준은 [Vercel Git 배포 설정 문서](https://vercel.com/docs/project-configuration/git-configuration)에 따른다.

## 운영 관리자가 변경 사항을 가져오기

운영 프로젝트가 이 작업 저장소를 직접 사용한다면 병합된 `main` 커밋으로 배포한다.

다른 저장소를 사용한다면, **그 운영 저장소의 깨끗한 로컬 checkout**에서 실제 원격 주소와 현재 브랜치를 먼저 확인하고 다음 명령으로 작업 저장소의 main을 가져올 수 있다. 충돌이나 검증 실패가 발생하면 해결하기 전에는 push하지 않는다.

```sh
git remote -v
git status --short
git switch main
git pull --ff-only origin main
git fetch https://github.com/dlrmsals1425-dotcom/bokji.git main
git merge --no-ff FETCH_HEAD -m "Merge reviewed welfare forms and HWPX writer"
npm ci
npm run build
git push origin main
```

이 방식은 실제 관리자의 Git 신원으로 병합 커밋을 만든다. 기존 커밋의 작성자를 바꾸거나 다른 사람의 신원을 흉내 낼 필요는 없다. 공개된 서식 원본과 `public/forms`도 함께 가져오며, 복지 자료를 다시 수집하거나 `npm run pipeline`을 실행하지 않는다.

Git 연결 없이 CLI로 배포하는 경우에는 먼저 올바른 계정의 **기존** `bokji-compass` 프로젝트에 연결되었는지 확인한다. 같은 이름의 새 프로젝트를 만들어 기존 운영 배포를 대신했다고 보고하지 않는다.

```sh
vercel link --yes --project bokji-compass
vercel --prod --yes
```

## 배포 완료 확인

- Vercel 배포가 READY이고 Production으로 지정됐는지 확인한다.
- 배포의 Git SHA와 운영 도메인이 의도한 커밋·주소인지 대조한다.
- 운영 주소에서 `/forms`와 혜택 상세를 열고 실제 원본 다운로드의 SHA를 확인한다.
- `/forms/write/rule-3211495?program=n.welfare100-livelihood-benefit`에서 작성 버튼과 단계별 입력을 확인한다.
- 가상 정보로 생성한 HWPX를 열어 입력 내용과 원본 서식이 유지되는지 확인한다. 운영 시험에 실제 주민등록번호나 금융정보를 사용하지 않는다.

저장소 병합, 빌드 통과, Vercel 배포 성공, 운영 주소 반영을 각각 구분해서 보고한다. 권한이 없어 운영 배포를 확인하지 못했다면 배포 완료로 표시하지 않는다.
