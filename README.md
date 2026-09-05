# 업무관리시스템 Cloud v10

기존 단일 HTML v10의 UI와 업무 규칙을 유지하면서 Firebase Authentication·Cloud Firestore·Google Drive·PWA를 연결한 무설치 정적 웹앱이다. GitHub Pages에서 그대로 서비스하며 빌드 도구, Node.js, Firebase CLI가 필요 없다.

## 사용 주소

<https://0hoona91-sudo.github.io/work-manager-cloud-v10/>

회사 PC에서는 위 주소를 Chrome 또는 Edge로 열고 Google 로그인만 하면 된다. 저장소를 내려받거나 프로그램을 설치할 필요가 없다.

## 배포 구성

- GitHub Pages: 정적 파일 배포
- Firebase Authentication: Google 로그인
- Cloud Firestore: 문서별 실시간 동기화와 오프라인 캐시
- Google Drive API (`drive.file`): 앱이 만든 업무 매뉴얼 사진만 접근
- Service Worker + Web App Manifest: PWA 설치와 앱 셸 오프라인 캐시

실제 Firebase 공개 설정은 `js/firebase-config.js`, 접근 제어는 `firestore.rules`에 있다. Firestore 규칙은 지정한 Firebase Authentication UID 한 명만 허용한다.

최초 배포에서 `ownerUid`가 아직 비어 있으면 본인 Google 로그인 직후 앱이 UID를 표시한다. 그 값을 `js/firebase-config.js`와 `firestore.rules`에 동일하게 넣고 Rules를 게시하면 다른 Google 계정은 차단된다. UID는 비밀번호나 인증코드가 아니다.

구조와 데이터 이전 방법은 `docs/FIRESTORE_SCHEMA.md`, `docs/MIGRATION.md`를 참고한다.
