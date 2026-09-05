import assert from "node:assert/strict";
import fs from "node:fs";

const cloud = fs.readFileSync(new URL("../js/cloud-sync.js", import.meta.url), "utf8");
const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.webmanifest", import.meta.url), "utf8"));
const serviceWorker = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");

for (const collection of [
  "tasks",
  "checklistItems",
  "taskLinks",
  "templates",
  "linkedRules",
  "manualBlocks",
  "owners",
  "categories",
  "holidays",
  "settings",
  "meta",
  "generatedKeys",
  "changeLogs",
]) {
  assert.match(cloud, new RegExp(`\\b${collection}\\b`), `${collection} 컬렉션 계약이 있어야 합니다.`);
}

assert.match(cloud, /runTransaction\(/, "문서 충돌 처리를 위한 Firestore 트랜잭션을 사용해야 합니다.");
assert.match(cloud, /persistentLocalCache/, "Firestore 영속 오프라인 캐시를 켜야 합니다.");
assert.match(cloud, /persistentMultipleTabManager/, "여러 탭이 같은 오프라인 캐시를 안전하게 공유해야 합니다.");
assert.match(cloud, /https:\/\/www\.googleapis\.com\/auth\/drive\.file/, "Drive 권한은 앱이 만든/연 파일로 제한해야 합니다.");
assert.doesNotMatch(cloud, /auth\/drive(?:["'])/, "전체 Google Drive 권한을 요청하면 안 됩니다.");
assert.match(cloud, /generatedKeys/, "생성 키 잠금 컬렉션이 있어야 합니다.");
assert.match(cloud, /changeLogs/, "문서 단위 변경이력 컬렉션이 있어야 합니다.");
assert.match(cloud, /id="cloudOwnerUid"/, "최초 로그인에서 소유자 UID를 확인할 수 있어야 합니다.");
assert.match(cloud, /UID는 비밀번호나 인증코드가 아닌 계정 식별값입니다/, "UID 안내가 비밀정보와 구분되어야 합니다.");

assert.match(rules, /function isOwner\(\)/, "소유자 검사 함수가 있어야 합니다.");
assert.match(rules, /request\.auth\.uid == '(?:__OWNER_UID__|[A-Za-z0-9_-]+)'/, "Firebase UID로 소유자를 제한해야 합니다.");
assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/s, "기본 거부 규칙이 있어야 합니다.");
assert.match(rules, /match \/generatedKeys\/\{(?:docId|id)\}/, "중복 방지 잠금 규칙이 있어야 합니다.");
assert.match(rules, /request\.resource\.data\.generatedKey == resource\.data\.generatedKey/, "생성 키 값이 같은 멱등 재전송만 허용해야 합니다.");
assert.match(rules, /request\.resource\.data\.taskId == resource\.data\.taskId/, "생성 키가 다른 업무로 바뀌면 안 됩니다.");
assert.match(rules, /allow delete: if false;/, "생성 키 잠금은 삭제할 수 없어야 합니다.");
assert.match(rules, /match \/changeLogs\/\{id\}[\s\S]*allow update, delete: if false;/, "변경이력은 수정·삭제할 수 없어야 합니다.");

assert.equal(manifest.display, "standalone", "PWA는 standalone 모드로 열려야 합니다.");
assert.ok(Array.isArray(manifest.icons) && manifest.icons.some((icon) => icon.sizes === "192x192"), "192px PWA 아이콘이 있어야 합니다.");
assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"), "512px PWA 아이콘이 있어야 합니다.");
assert.match(serviceWorker, /self\.addEventListener\("fetch"/, "서비스 워커가 오프라인 요청을 처리해야 합니다.");
for (const moduleName of ["firebase-app.js", "firebase-auth.js", "firebase-firestore.js"]) {
  assert.match(serviceWorker, new RegExp(moduleName.replace(".", "\\.")), `${moduleName}을 첫 설치 때 미리 캐시해야 합니다.`);
}
assert.match(serviceWorker, /cache\.addAll\(FIREBASE_MODULES\)\.catch/, "Firebase CDN 장애가 앱 셸 설치를 막으면 안 됩니다.");

console.log("PASS cloud/PWA contract: 30 assertions");
