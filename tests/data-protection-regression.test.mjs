import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const cloud = fs.readFileSync(new URL("../js/cloud-sync.js", import.meta.url), "utf8");
const serviceWorker = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]);
for (const [index, source] of inlineScripts.entries()) new vm.Script(source, { filename: `index-inline-${index + 1}.js` });

function extractLastFunction(name) {
  const matcher = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`, "g");
  let found = null;
  for (let match; (match = matcher.exec(html));) found = match.index;
  assert.notEqual(found, null, `${name} 함수가 있어야 합니다.`);
  const argsOpen = html.indexOf("(", found);
  let argsDepth = 0;
  let argsClose = -1;
  for (let index = argsOpen; index < html.length; index += 1) {
    if (html[index] === "(") argsDepth += 1;
    else if (html[index] === ")" && --argsDepth === 0) { argsClose = index; break; }
  }
  const open = html.indexOf("{", argsClose);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = open; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return html.slice(found, index + 1);
  }
  throw new Error(`${name} 함수의 끝을 찾지 못했습니다.`);
}

let saveCount = 0;
const state = { tasks: [], templates: [], settings: { suppressedAutoKeys: [] } };
const sandbox = {
  Date, String, Number, Array, Object, Map, Set, Math, JSON,
  state,
  clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); },
  todayISO() { return "2026-09-13"; },
  v5DefaultAutoRange() { return ["2026-09-13", "2027-09-30"]; },
  effectiveStatus(task) { return task.actualComplete || task.status === "done" ? "done" : task.status || "planned"; },
  recalcLinks() {},
  syncTemplateScheduleV5() {
    const normal = state.tasks.find(task => task.id === "root-normal");
    const child = state.tasks.find(task => task.id === "child-normal");
    if (normal) normal.start = normal.end = normal.deadline = "2026-10-20";
    if (child) child.start = child.end = child.deadline = "2026-10-21";
    if (normal) {
      state.tasks.push({ id: "root-new", autoSourceTemplateId: "tpl-1", generatedKey: "dbauto:tpl-1:new", start: "2026-11-20", end: "2026-11-20", deadline: "2026-11-20", status: "planned" });
      state.tasks.push({ id: "child-new", autoSourceTemplateId: "tpl-1", parentAutoRootId: "root-new", generatedKey: "dbchain:dbauto:tpl-1:new:2", start: "2026-11-21", end: "2026-11-21", deadline: "2026-11-21", status: "planned", link: { parentId: "root-new", dynamic: true } });
    }
  },
  async saveState() { saveCount += 1; },
};
const context = vm.createContext(sandbox);
for (const name of [
  "archiveCloneV29",
  "sameValueV29",
  "normalizedLinkedScheduleV29",
  "templateScheduleSignatureV29",
  "scheduleAffectingTemplateChangeV29",
  "taskScheduleShapeV29",
  "previewTemplateImpactV29",
  "taskIdsForDbDeletionV29",
  "restoreConnectionFieldsV29",
  "restoreTemplateTrashV29",
  "restoreTaskTrashV29",
]) vm.runInContext(extractLastFunction(name), context);

const template = {
  id: "tpl-1", name: "월간 점검", category: "시설", owner: "담당자", autoSchedule: true,
  activeFrom: "2026-01-01", activeUntil: "", applyPolicy: "pending", cycle: "monthly", cycleMonths: [],
  dayRule: "exact", exactDay: 10, holidayShift: "keep", durationDays: 0, deadlineOffset: 0,
  checklist: ["확인"], methodBlocks: [{ id: "mb-1", type: "image", driveFileId: "drive-1", data: "blob:temporary", objectUrl: "blob:temporary" }],
  linkedSteps: [{ name: "결과 제출", dynamic: true, startOffset: 1, startMode: "calendar", startHolidayShift: "keep", limitDays: 0, limitMode: "calendar", limitHolidayShift: "keep" }],
};
state.templates = [template];
state.tasks = [
  { id: "root-normal", autoSourceTemplateId: "tpl-1", generatedKey: "dbauto:tpl-1:normal", start: "2026-10-10", end: "2026-10-10", deadline: "2026-10-10", status: "planned" },
  { id: "child-normal", autoSourceTemplateId: "tpl-1", parentAutoRootId: "root-normal", generatedKey: "dbchain:dbauto:tpl-1:normal:2", start: "2026-10-11", end: "2026-10-11", deadline: "2026-10-11", status: "planned", link: { parentId: "root-normal", dynamic: true } },
  { id: "root-done", autoSourceTemplateId: "tpl-1", generatedKey: "dbauto:tpl-1:done", start: "2026-09-10", end: "2026-09-10", deadline: "2026-09-10", status: "done", actualComplete: "2026-09-10" },
  { id: "root-manual", autoSourceTemplateId: "tpl-1", generatedKey: "dbauto:tpl-1:manual", start: "2026-12-22", end: "2026-12-22", deadline: "2026-12-22", status: "planned", manualOverride: true, scheduleOverride: true },
];
const untouched = JSON.stringify({ tasks: state.tasks, templates: state.templates });
const draft = { ...template, exactDay: 20 };
assert.equal(context.scheduleAffectingTemplateChangeV29(template, { ...template, name: "월간 점검 오탈자 수정" }), false, "업무명만 바꾸면 일정 영향 경고 대상이 아니어야 합니다.");
assert.equal(context.scheduleAffectingTemplateChangeV29(template, draft), true, "반복일 변경은 영향 미리보기 대상이어야 합니다.");
const impact = context.previewTemplateImpactV29(template, draft);
assert.equal(impact.autoTasks, 2, "기존 변경 회차와 신규 회차를 자동업무 영향으로 계산해야 합니다.");
assert.equal(impact.linkedTasks, 2, "기존 변경 단계와 신규 단계를 연계업무 영향으로 계산해야 합니다.");
assert.equal(impact.completedProtected, 1, "완료업무 보호 건수를 표시해야 합니다.");
assert.equal(impact.manualProtected, 1, "manualOverride 보호 건수를 표시해야 합니다.");
assert.equal(saveCount, 0, "영향 미리보기는 저장하면 안 됩니다.");
assert.equal(JSON.stringify({ tasks: state.tasks, templates: state.templates }), untouched, "영향 미리보기 후 메모리 데이터도 그대로여야 합니다.");

const archivedTemplate = context.archiveCloneV29(template);
assert.equal(archivedTemplate.methodBlocks[0].driveFileId, "drive-1", "Drive 연결 ID는 snapshot에 남겨야 합니다.");
assert.equal("data" in archivedTemplate.methodBlocks[0], false, "임시 사진 데이터는 버전마다 복제하면 안 됩니다.");
assert.equal("objectUrl" in archivedTemplate.methodBlocks[0], false, "임시 object URL은 snapshot에 저장하면 안 됩니다.");

state.tasks = [
  { id: "db-root", autoSourceTemplateId: "tpl-delete" },
  { id: "db-child", parentAutoRootId: "db-root", link: { parentId: "db-root" } },
  { id: "unrelated", templateId: "tpl-other" },
];
assert.deepEqual([...context.taskIdsForDbDeletionV29(new Set(["tpl-delete"]))].sort(), ["db-child", "db-root"], "업무DB 삭제 snapshot은 연결된 수행업무만 포함해야 합니다.");

const savedTemplate = { id: "tpl-restore", name: "복원 DB", category: "안전", owner: "담당자", linkedSteps: [], checklist: ["확인"], methodBlocks: [{ type: "text", text: "방법" }] };
const savedPending = { id: "pending-1", name: "미완료 업무", autoSourceTemplateId: "tpl-restore", templateId: "tpl-restore", status: "planned", start: "2026-10-01" };
const savedDone = { id: "done-1", name: "완료 업무", autoSourceTemplateId: "tpl-restore", templateId: "tpl-restore", status: "done", actualComplete: "2026-09-01", start: "2026-09-01", notes: "사용자 메모" };
const dbTrash = { id: "trash-db", name: "복원 DB", snapshot: { templates: [savedTemplate], tasks: [savedPending, savedDone], inbound: [] } };
state.templates = [];
state.tasks = [{ id: "done-1", name: "완료 업무", status: "done", actualComplete: "2026-09-01", start: "2026-09-01", notes: "삭제 뒤 유지된 메모", archivedSourceDeleted: true, archivedSourceTrashId: "trash-db" }];
await context.restoreTemplateTrashV29(dbTrash);
assert.equal(state.templates[0].id, "tpl-restore", "업무DB ID를 유지해 복원해야 합니다.");
assert.ok(state.tasks.some(task => task.id === "pending-1"), "삭제된 미완료 수행업무를 함께 복원해야 합니다.");
const restoredDone = state.tasks.find(task => task.id === "done-1");
assert.equal(restoredDone.autoSourceTemplateId, "tpl-restore", "보존된 완료 이력의 업무DB 연결을 복원해야 합니다.");
assert.equal(restoredDone.notes, "삭제 뒤 유지된 메모", "휴지통에 있는 동안의 완료업무 내용은 덮어쓰지 않아야 합니다.");
assert.equal(restoredDone.actualComplete, "2026-09-01", "완료일을 유지해야 합니다.");

const beforeConflict = JSON.stringify({ templates: state.templates, tasks: state.tasks });
await assert.rejects(context.restoreTemplateTrashV29(dbTrash), /같은 ID의 업무DB/, "동일 ID가 있으면 복원을 중단해야 합니다.");
assert.equal(JSON.stringify({ templates: state.templates, tasks: state.tasks }), beforeConflict, "충돌 복원은 기존 데이터를 바꾸면 안 됩니다.");

state.tasks = [];
state.templates = [{ id: "tpl-task", autoSchedule: false }];
state.settings = { suppressedAutoKeys: ["dbauto:tpl-task:2026-10"] };
await context.restoreTaskTrashV29({
  id: "trash-task", name: "수행업무", snapshot: {
    tasks: [{ id: "task-restore", name: "수행업무", generatedKey: "dbauto:tpl-task:2026-10", autoSourceTemplateId: "tpl-task", manualOverride: true, start: "2026-10-20" }],
    suppressedKeys: ["dbauto:tpl-task:2026-10"], templateFlags: [{ id: "tpl-task", autoSchedule: true }],
  },
});
assert.equal(state.tasks[0].id, "task-restore", "수행업무 원래 ID를 복원해야 합니다.");
assert.equal(state.tasks[0].manualOverride, true, "manualOverride 값을 그대로 복원해야 합니다.");
assert.deepEqual(Array.from(state.settings.suppressedAutoKeys), [], "복원한 자동 회차의 삭제 억제키만 해제해야 합니다.");
assert.equal(state.templates[0].autoSchedule, true, "반복 전체 삭제 때 중지한 자동생성을 함께 복원해야 합니다.");

assert.match(html, /id="trashOpenV29">휴지통<\/button>/, "설정 화면에 휴지통 진입점이 있어야 합니다.");
assert.match(html, /id="templateVersionsV29">이전 버전<\/button>/, "업무DB 화면에 이전 버전 진입점이 있어야 합니다.");
assert.match(extractLastFunction("previewTemplateImpactV29"), /syncTemplateScheduleV5[\s\S]*recalcLinks/, "영향 미리보기는 실제 반복·연계 일정 계산 함수를 재사용해야 합니다.");
assert.doesNotMatch(extractLastFunction("previewTemplateImpactV29"), /saveState|saveTemplateVersion|saveTrashEntry/, "미리보기 계산은 write 경로를 호출하면 안 됩니다.");
assert.match(extractLastFunction("decorateDbProtectionV29"), /dirty[\s\S]*saveTemplateVersionSnapshotV29[\s\S]*originalSave/, "실제 변경 저장 직전에만 이전 snapshot을 기록해야 합니다.");
assert.match(extractLastFunction("applyTemplateVersionRestoreV29"), /saveTemplateVersionSnapshotV29\(current,'버전 복원 직전'\)[\s\S]*syncTemplateScheduleV5[\s\S]*recalcLinks/, "버전 복원 직전 현재 상태를 보존하고 기존 일정 로직을 적용해야 합니다.");
assert.match(html, /TEMPLATE_VERSION_LIMIT_V29=10/, "업무DB 버전은 최근 10개로 제한해야 합니다.");
assert.match(cloud, /const TEMPLATE_VERSION_LIMIT = 10/, "클라우드 저장에서도 버전 10개 제한을 적용해야 합니다.");
assert.match(cloud, /name === "meta"[\s\S]*where\(documentId\(\), "==", "schema"\)/, "초기 meta listener는 schema 한 건만 읽어야 합니다.");
assert.match(cloud, /async function listTrashEntries[\s\S]*getDocs\(query\(collection\(db, "meta"\), where\("recordType"/, "휴지통은 실제 열 때 일회성 조회해야 합니다.");
assert.match(cloud, /async function listTemplateVersions[\s\S]*where\("versionTemplateId"/, "버전은 선택한 업무DB만 일회성 조회해야 합니다.");
assert.doesNotMatch(cloud.slice(cloud.indexOf("function controller()"), cloud.indexOf("async function activate")), /onSnapshot/, "보조 기능용 새 listener를 controller에 만들면 안 됩니다.");
assert.match(rules, /match \/meta\/\{id\}[\s\S]*allow read, create, update, delete: if isOwner\(\)/, "현재 인증 소유자만 기존 meta 보조 문서를 사용할 수 있어야 합니다.");
assert.match(html, /effectiveStatus\(old\)!=='done'[\s\S]*!old\.manualOverride/, "완료업무와 manualOverride 루트 삭제 보호를 유지해야 합니다.");
assert.match(html, /effectiveStatus\(x\)!=='done'&&!x\.manualOverride&&!x\.scheduleOverride/, "완료·수동 연계업무 삭제 보호를 유지해야 합니다.");
assert.match(serviceWorker, /work-manager-v10-shell-2026-09-13-34/, "9단계 서비스워커 캐시에서도 데이터 보호 기능을 유지해야 합니다.");
assert.match(html, /cloud-sync\.js\?v=20260913-33/, "새 클라우드 동기화 모듈 URL을 사용해야 합니다.");

console.log("PASS stage 7 impact preview, trash restore, and template version regression");
