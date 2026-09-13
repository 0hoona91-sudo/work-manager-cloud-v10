import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const serviceWorker = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]);
assert.ok(inlineScripts.length, "index.html의 앱 스크립트를 찾을 수 있어야 합니다.");
for (const [index, source] of inlineScripts.entries()) new vm.Script(source, { filename: `index-inline-${index + 1}.js` });

function extractLastFunction(name) {
  const matcher = new RegExp(`function\\s+${name}\\s*\\(`, "g");
  let found = null;
  for (let match; (match = matcher.exec(html));) found = match.index;
  assert.notEqual(found, null, `${name} 함수가 있어야 합니다.`);
  const open = html.indexOf("{", found);
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
  throw new Error(`${name} 함수의 끝을 찾을 수 없습니다.`);
}

const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dateOf = value => {
  if (!value) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day, 12);
};
const addDays = (value, amount) => {
  const date = dateOf(value);
  date.setDate(date.getDate() + Number(amount || 0));
  return iso(date);
};
const state = { tasks: [], templates: [], owners: ["담당자"], holidays: [], settings: { suppressedAutoKeys: [] } };
const sandbox = {
  Date, String, Number, Array, Map, Set, Math,
  state,
  window: { cloudSync: { stableTaskId: key => `stable-${String(key).replace(/[^a-z0-9]/gi, "-")}` } },
  todayISO() { return "2026-09-13"; },
  rollingAutoTargetV24() { return "2027-09-30"; },
  dateOf,
  iso,
  addDays,
  addBusinessDays: addDays,
  endOfMonth(year, month) { return iso(new Date(year, month, 0, 12)); },
  shiftWorkday(value) { return value; },
  v5MaxDate(a, b) { return !a ? b : !b ? a : a > b ? a : b; },
  v5MinDate(a, b) { return !a ? b : !b ? a : a < b ? a : b; },
  v5MonthStart(value) { return `${String(value).slice(0, 7)}-01`; },
  fmtDate(value) { return value ? String(value).replaceAll("-", "/") : "-"; },
  periodFromDate(value) { return String(value).slice(0, 7); },
  stableGeneratedTaskId(key) { return sandbox.window.cloudSync.stableTaskId(key); },
  stableGeneratedCheckId(taskId, index) { return `${taskId}-c${index + 1}`; },
  effectiveStatus(task) { return task.actualComplete || task.status === "done" ? "done" : task.status || "planned"; },
  preserveChecklistV5(oldChecks, newTexts) {
    const old = new Map((oldChecks || []).map(check => [check.text, check]));
    return (newTexts || []).map((text, index) => ({ id: old.get(text)?.id || `c-${index}`, text, done: !!old.get(text)?.done }));
  },
  calcByModeV6(base, amount) { return addDays(base, amount); },
};
const context = vm.createContext(sandbox);
for (const name of [
  "monthsForTemplate",
  "templateDateForMonth",
  "templateOccurrenceSpecsV5",
  "taskFromDbTemplateV5",
  "effectiveStepSourceV6",
  "ensureDbLinkedChildrenV5",
  "recalcNewDbChainV24",
  "validIsoDateV28",
  "hasTemplateManualV28",
  "templateWeekdaysV28",
  "rollingBoundsV28",
  "expectedRollingSpecsV28",
  "healthIssueV28",
  "autoSourceTemplateIdV28",
  "inspectDbHealthV28",
  "applyMissingDbRepairV28",
]) vm.runInContext(extractLastFunction(name), context);

function healthyTemplate(overrides = {}) {
  return {
    id: "tpl-monthly",
    name: "월간 소방점검",
    category: "소방",
    owner: "담당자",
    autoSchedule: true,
    activeFrom: "2026-09-01",
    activeUntil: "",
    cycle: "monthly",
    cycleMonths: [],
    dayRule: "exact",
    exactDay: 15,
    holidayShift: "keep",
    durationDays: 1,
    deadlineOffset: 2,
    checklist: ["점검표 확인"],
    methodBlocks: [{ type: "text", text: "현장을 확인한다." }],
    linkedSteps: [{ name: "결과 제출", category: "소방", owner: "담당자", checklist: ["제출 확인"], dynamic: true, startOffset: 1, startMode: "calendar", startHolidayShift: "keep", limitDays: 0, limitMode: "calendar", limitHolidayShift: "keep" }],
    ...overrides,
  };
}

function generateExpected(template) {
  state.templates = [template];
  state.tasks = [];
  for (const spec of context.expectedRollingSpecsV28(template, "2026-09-13")) {
    const root = context.taskFromDbTemplateV5(template, spec);
    state.tasks.push(root);
    const before = new Set(state.tasks.map(task => task.id));
    context.ensureDbLinkedChildrenV5(root, template, "health-repair");
    const created = state.tasks.filter(task => !before.has(task.id));
    context.recalcNewDbChainV24(root, new Set(created.map(task => task.id)));
  }
}

const template = healthyTemplate();
generateExpected(template);
let report = context.inspectDbHealthV28("2026-09-13");
assert.equal(report.errors.length, 0, "정상 업무DB와 정상 Rolling 업무에 잘못된 오류가 없어야 합니다.");
assert.equal(report.warnings.length, 0, "정상 업무DB에 잘못된 경고가 없어야 합니다.");
assert.equal(report.infos.length, 0, "체크리스트와 업무방법이 있으면 참고 항목이 없어야 합니다.");
assert.equal(report.missingRoots.length, 0, "정상 Rolling 업무는 누락 0건이어야 합니다.");
const chainChild = state.tasks.find(task => task.parentAutoRootId);
const originalLinkParent = chainChild.link.parentId;
chainChild.link.parentId = state.tasks.find(task => !task.parentAutoRootId && task.id !== chainChild.parentAutoRootId).id;
report = context.inspectDbHealthV28("2026-09-13");
assert.ok(report.errors.some(item => item.code === "linked-parent-mismatch"), "명백히 잘못 연결된 연계업무 부모를 감지해야 합니다.");
chainChild.link.parentId = originalLinkParent;
const legacyLinkedRoot = state.tasks.find(task => !task.parentAutoRootId);
delete legacyLinkedRoot.autoSourceTemplateId;
report = context.inspectDbHealthV28("2026-09-13");
assert.equal(report.missingRoots.length, 0, "기존 templateId 연결도 실제 회차로 인식해야 합니다.");

state.templates = [healthyTemplate({ id: "tpl-ended", cycle: "yearly", cycleMonths: [12], activeUntil: "2026-10-01", linkedSteps: [] })];
state.tasks = [];
report = context.inspectDbHealthV28("2026-09-13");
assert.equal(report.errors.length, 0, "종료일 전에 다음 반복일이 없는 정상 업무DB를 설정 오류로 오판하면 안 됩니다.");

state.templates = [healthyTemplate({ id: "tpl-warning", autoSchedule: false, cycle: "none", category: "", owner: "", checklist: [], methodBlocks: [] })];
state.tasks = [];
report = context.inspectDbHealthV28("2026-09-13");
assert.deepEqual(Array.from(report.warnings, item => item.code).sort(), ["template-category", "template-owner"], "담당자와 대분류 누락을 경고로 감지해야 합니다.");
assert.deepEqual(Array.from(report.infos, item => item.code).sort(), ["checklist-empty", "manual-empty"], "체크리스트와 업무방법 누락은 참고로만 표시해야 합니다.");

state.templates = [
  healthyTemplate({ id: "tpl-weekly-bad", cycle: "weekly", weekdays: [], weekday: undefined }),
  healthyTemplate({ id: "tpl-monthly-bad", exactDay: null }),
  healthyTemplate({ id: "tpl-range-bad", autoSchedule: false, cycle: "none", activeFrom: "2027-02-01", activeUntil: "2027-01-01" }),
];
state.tasks = [];
report = context.inspectDbHealthV28("2026-09-13");
assert.ok(report.errors.some(item => item.code === "weekly-days"), "주간업무의 유효한 요일 누락을 감지해야 합니다.");
assert.ok(report.errors.some(item => item.code === "monthly-day"), "월간업무의 기준일 누락을 감지해야 합니다.");
assert.ok(report.errors.some(item => item.code === "active-range"), "명백히 잘못된 활성기간을 감지해야 합니다.");

generateExpected(template);
const specs = Array.from(context.expectedRollingSpecsV28(template, "2026-09-13"));
const missingRootKey = specs[2].key;
const missingRoot = state.tasks.find(task => task.generatedKey === missingRootKey);
state.tasks = state.tasks.filter(task => task.id !== missingRoot.id && task.parentAutoRootId !== missingRoot.id);

const missingLinkRoot = state.tasks.find(task => task.generatedKey === specs[3].key);
state.tasks = state.tasks.filter(task => task.generatedKey !== `dbchain:${missingLinkRoot.generatedKey}:2`);

const completedRoot = state.tasks.find(task => task.generatedKey === specs[0].key);
completedRoot.status = "done";
completedRoot.actualComplete = "2026-09-14";
const manualChild = state.tasks.find(task => task.parentAutoRootId === completedRoot.id);
manualChild.manualOverride = true;
manualChild.scheduleOverride = true;
manualChild.start = "2026-10-22";
manualChild.end = "2026-10-23";
manualChild.deadline = "2026-10-24";
manualChild.notes = "사용자 메모 보존";
manualChild.relatedDocumentTitle = "기존 공문";
manualChild.checklist[0].done = true;

const duplicateSource = state.tasks.find(task => task.generatedKey === specs[1].key);
state.tasks.push({ ...structuredClone(duplicateSource), id: "duplicate-root" });
report = context.inspectDbHealthV28("2026-09-13");
assert.equal(report.missingRoots.length, 1, "빠진 자동업무 회차를 정확히 1건 감지해야 합니다.");
assert.equal(report.missingRoots[0].key, missingRootKey, "누락은 generatedKey로 판정해야 합니다.");
assert.equal(report.missingLinks.length, 1, "빠진 연계단계를 정확히 1건 감지해야 합니다.");
assert.equal(report.duplicates.length, 1, "동일 generatedKey 중복을 의심 항목으로 감지해야 합니다.");

const beforeExisting = new Map(state.tasks.map(task => [task.id, JSON.stringify(task)]));
const repair = context.applyMissingDbRepairV28(report);
assert.equal(repair.rootCreated, 1, "누락된 루트 회차만 1건 생성해야 합니다.");
assert.equal(repair.linkedCreated, 2, "새 회차의 연계단계와 기존 회차에서 빠진 단계만 생성해야 합니다.");
for (const [id, before] of beforeExisting) assert.equal(JSON.stringify(state.tasks.find(task => task.id === id)), before, `기존 업무 ${id}는 복구 중 변경되면 안 됩니다.`);
assert.equal(completedRoot.status, "done", "완료 상태를 보존해야 합니다.");
assert.equal(completedRoot.actualComplete, "2026-09-14", "실제 완료일을 보존해야 합니다.");
assert.equal(manualChild.start, "2026-10-22", "manualOverride 일정을 보존해야 합니다.");
assert.equal(manualChild.notes, "사용자 메모 보존", "기존 메모를 보존해야 합니다.");
assert.equal(manualChild.relatedDocumentTitle, "기존 공문", "관련 공문을 보존해야 합니다.");
assert.equal(manualChild.checklist[0].done, true, "기존 체크리스트 진행률을 보존해야 합니다.");
report = context.inspectDbHealthV28("2026-09-13");
assert.equal(report.missingRoots.length, 0, "복구 후 자동업무 누락이 0건이어야 합니다.");
assert.equal(report.missingLinks.length, 0, "복구 후 연계업무 누락이 0건이어야 합니다.");
assert.equal(report.duplicates.length, 1, "중복 의심 업무는 자동 삭제하지 않아야 합니다.");

assert.match(html, /id="dbHealthCheckV28">업무DB 점검<\/button>/, "설정 화면에 수동 업무DB 점검 버튼이 있어야 합니다.");
assert.match(extractLastFunction("expectedRollingSpecsV28"), /templateOccurrenceSpecsV5/, "기존 반복일 계산 엔진을 재사용해야 합니다.");
assert.match(extractLastFunction("applyMissingDbRepairV28"), /taskFromDbTemplateV5[\s\S]*ensureDbLinkedChildrenV5[\s\S]*recalcNewDbChainV24/, "기존 루트·연계 생성 및 일정 계산 함수를 재사용해야 합니다.");
assert.doesNotMatch(extractLastFunction("inspectDbHealthV28"), /saveState|onSnapshot|getDocs|getDoc|setDoc|updateDoc|runTransaction|collection\s*\(/, "점검 함수는 read 전용이며 Firestore 호출이나 저장을 하면 안 됩니다.");
assert.doesNotMatch(extractLastFunction("applyMissingDbRepairV28"), /saveState|onSnapshot|getDocs|getDoc|setDoc|updateDoc|runTransaction|collection\s*\(/, "메모리 복구 계산은 직접 Firestore를 호출하면 안 됩니다.");
const v28Start = html.indexOf("APP V28 — manual DB health / missing repeat repair");
const v28End = html.indexOf("</script>", v28Start);
const v28Source = html.slice(v28Start, v28End);
assert.ok(v28Start > 0 && v28End > v28Start, "6단계 코드 범위를 찾을 수 있어야 합니다.");
assert.doesNotMatch(v28Source, /onSnapshot|getDocs|getDoc|setDoc|updateDoc|runTransaction|collection\s*\(/, "6단계는 새 조회·listener를 직접 만들지 않아야 합니다.");
assert.doesNotMatch(v28Source, /setTimeout|setInterval/, "건강검진은 자동·백그라운드 실행되면 안 됩니다.");
assert.match(v28Source, /button\.onclick=\(\)=>openDbHealthInspectionV28\(\)/, "건강검진은 사용자의 버튼 클릭으로만 열려야 합니다.");
assert.match(extractLastFunction("restoreMissingDbTasksV28"), /saveState[\s\S]*reason:/, "명시적 복구 시에만 기존 저장 경로를 사용해야 합니다.");
assert.match(html, /policy==='health-repair'/, "복구 전용 기존업무 보존 정책이 있어야 합니다.");
assert.match(html, /ROLLING_AUTO_MONTHS_V24=12/, "Rolling 12개월 기능을 유지해야 합니다.");
assert.match(html, /APP V27 — unified search \/ DB task history/, "통합검색과 과거 수행이력을 유지해야 합니다.");
assert.match(html, /APP V26 — mobile compact lists/, "모바일 컴팩트 화면을 유지해야 합니다.");
assert.match(html, /HOME_FOCUS_META_V25/, "HOME 요약을 유지해야 합니다.");
assert.match(serviceWorker, /work-manager-v10-shell-2026-09-13-31/, "6단계 배포 캐시 버전이어야 합니다.");
assert.match(html, /navigator\.serviceWorker\.register\('\.\/sw\.js\?v=20260913-31'\)/, "6단계 서비스워커 URL을 등록해야 합니다.");

console.log("PASS manual DB health and missing repeat repair regression");
