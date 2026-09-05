// Firebase Console에서 발급되는 웹앱 공개 설정입니다. 비밀번호나 비밀키가 아닙니다.
export const firebaseConfig = {
  apiKey: "__FIREBASE_API_KEY__",
  authDomain: "__FIREBASE_AUTH_DOMAIN__",
  projectId: "__FIREBASE_PROJECT_ID__",
  storageBucket: "__FIREBASE_STORAGE_BUCKET__",
  messagingSenderId: "__FIREBASE_MESSAGING_SENDER_ID__",
  appId: "__FIREBASE_APP_ID__",
};

export const appConfig = {
  // 배포 직전 최초 로그인에서 확인한 Firebase Authentication UID로 고정합니다.
  ownerUid: "__OWNER_UID__",
  driveFolderName: "업무관리시스템_매뉴얼사진",
  driveAppMarker: "work-manager-cloud-v10",
};
