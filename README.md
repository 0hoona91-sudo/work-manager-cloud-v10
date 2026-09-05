# 업무관리시스템 Cloud v10

기존 단일 HTML v10의 UI와 업무 규칙을 유지하면서 Firebase Authentication·Cloud Firestore·Google Drive·PWA를 연결한 무설치 정적 웹앱이다. GitHub Pages에서 그대로 서비스하며 빌드 도구, Node.js, Firebase CLI가 필요 없다.

## 배포 구성

- GitHub Pages: 정적 파일 배포
- Firebase Authentication: Google 로그인
- Cloud Firestore: 문서별 실시간 동기화와 오프라인 캐시
- Google Drive API (`drive.file`): 앱이 만든 업무 매뉴얼 사진만 접근
- Service Worker + Web App Manifest: PWA 설치와 앱 셸 오프라인 캐시

실제 Firebase 공개 설정은 `js/firebase-config.js`, 접근 제어는 `firestore.rules`에 있다. Firestore 규칙은 지정한 Firebase Authentication UID 한 명만 허용한다.

구조와 데이터 이전 방법은 `docs/FIRESTORE_SCHEMA.md`, `docs/MIGRATION.md`를 참고한다.
