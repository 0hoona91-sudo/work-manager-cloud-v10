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

const sandbox = {
  Date,
  String,
  Number,
  Array,
  state: { tasks: [], templates: [] },
  ownerForDbRefV8() { return "나영훈"; },
  effectiveStepSourceV6(step, root) {
    const referenced = step.templateId ? sandbox.state.templates.find(item => item.id === step.templateId) : null;
    return {
      name: step.name || referenced?.name || "연계업무",
      category: step.category || referenced?.category || root?.category || "",
      owner: step.owner || referenced?.owner || root?.owner || "",
      checklist: step.checklist?.length ? step.checklist : referenced?.checklist || [],
      notes: step.notes || referenced?.notes || "",
      methodBlocks: step.methodBlocks?.length ? step.methodBlocks : referenced?.methodBlocks || [],
    };
  },
  todayISO() { return "2026-09-12"; },
};
const context = vm.createContext(sandbox);
for (const name of [
  "normalizeSearchV27",
  "searchValueV27",
  "checklistSearchTextV27",
  "methodSearchTextV27",
  "matchingSearchLabelsV27",
  "taskTemplateSourceV27",
  "taskSearchFieldsV27",
  "taskMatchesUnifiedSearchV27",
  "dbSearchFieldsV27",
  "dbRowMatchesUnifiedSearchV27",
  "taskLinkedToDbRefV27",
  "isPastDbTaskV27",
  "dbHistoryTasksV27",
  "historyDateV27",
  "historyScheduleV27",
]) vm.runInContext(extractLastFunction(name), context);

sandbox.state.templates = [{
  id: "tpl-fire",
  name: "소방 작동점검 수검",
  category: "소방",
  owner: "나영훈",
  keywords: "FIRE REPORT",
  notes: "매월 제출 업무",
  checklist: ["점검 결과 확인"],
  methodBlocks: [{ type: "text", text: "관할 소방서 방문 제출" }],
  linkedSteps: [{
    name: "조치요청 회신",
    category: "소방",
    checklist: ["이행 완료 보고서 제출"],
    methodBlocks: [{ type: "text", text: "보완자료 준비" }],
  }],
}];
const task = {
  id: "task-fire",
  name: "작동점검 결과 제출",
  category: "소방",
  owner: "나영훈",
  notes: "방수 구역 메모",
  relatedDocumentTitle: "정기감사 자료 제출 요청",
  checklist: [{ text: "관할기관 제출", done: false }],
  autoSourceTemplateId: "tpl-fire",
  start: "2026-09-12",
  end: "2026-09-12",
  deadline: "2026-09-12",
};

assert.equal(context.normalizeSearchV27("  FIRE   Report  "), "fire report", "앞뒤·중복 공백과 영문 대소문자를 정규화해야 합니다.");
for (const [query, label] of [
  ["작동점검", "업무명"],
  ["소방", "대분류"],
  ["정기감사", "관련 공문"],
  ["방수 구역", "메모"],
  ["관할기관", "체크리스트"],
  ["소방서 방문", "업무방법"],
  ["report", "키워드"],
]) {
  assert.equal(context.taskMatchesUnifiedSearchV27(task, query), true, `${label} 부분일치 검색이 되어야 합니다.`);
  assert.ok(Array.from(context.matchingSearchLabelsV27(context.taskSearchFieldsV27(task), query)).includes(label), `${label} 일치 이유를 표시해야 합니다.`);
}
assert.equal(context.taskMatchesUnifiedSearchV27(task, "없는 검색어"), false);

const rootRow = { kind: "root", ref: "root|tpl-fire", root: sandbox.state.templates[0], name: "소방 작동점검 수검", category: "소방", cycle: "매월", notes: "매월 제출 업무" };
const stepRow = { kind: "step", ref: "step|tpl-fire|0", root: sandbox.state.templates[0], step: sandbox.state.templates[0].linkedSteps[0], name: "조치요청 회신", category: "소방", cycle: "2단계 · 상위업무 연계", notes: "" };
for (const query of ["소방 작동", "fire report", "소방서 방문", "점검 결과"]) assert.equal(context.dbRowMatchesUnifiedSearchV27(rootRow, query), true, `업무DB에서 ${query} 검색이 되어야 합니다.`);
assert.equal(context.dbRowMatchesUnifiedSearchV27(rootRow, "조치요청"), true, "루트 업무DB도 연계업무명으로 검색되어야 합니다.");
assert.equal(context.dbRowMatchesUnifiedSearchV27(stepRow, "이행 완료"), true, "연계 단계 체크리스트로 검색되어야 합니다.");
assert.equal(context.dbRowMatchesUnifiedSearchV27(stepRow, "보완자료"), true, "연계 단계 업무방법으로 검색되어야 합니다.");
assert.ok(Array.from(context.matchingSearchLabelsV27(context.dbSearchFieldsV27(stepRow), "조치요청")).includes("연계업무"), "연계업무 일치 이유를 구분해야 합니다.");

sandbox.state.tasks = [
  { id: "root-sep", autoSourceTemplateId: "tpl-fire", start: "2026-09-04", end: "2026-09-04", status: "done", actualComplete: "2026-09-05" },
  { id: "root-aug", autoSourceTemplateId: "tpl-fire", start: "2026-08-04", end: "2026-08-04", status: "done", actualComplete: "2026-08-04" },
  { id: "root-manual", dbManual: true, dbManualRootTemplateId: "tpl-fire", dbManualSourceStage: 0, start: "2026-07-04", end: "2026-07-04", status: "planned" },
  { id: "root-direct", templateId: "tpl-fire", start: "2026-06-04", end: "2026-06-04", status: "done" },
  { id: "root-future", autoSourceTemplateId: "tpl-fire", start: "2026-10-04", end: "2026-10-04", status: "planned" },
  { id: "step-auto", autoSourceTemplateId: "tpl-fire", parentAutoRootId: "root-aug", step: 2, start: "2026-08-10", end: "2026-08-10", status: "done" },
  { id: "step-manual", dbManual: true, dbManualRootTemplateId: "tpl-fire", dbManualSourceStage: 1, manualOverride: true, start: "2026-08-20", end: "2026-08-20", status: "planned" },
  { id: "unrelated", templateId: "tpl-other", start: "2026-09-01", end: "2026-09-01", status: "done" },
];
assert.deepEqual(Array.from(context.dbHistoryTasksV27("root|tpl-fire", "2026-09-12"), item => item.id), ["root-sep", "root-aug", "root-manual", "root-direct"], "루트 업무DB 이력은 정확한 연결 필드와 최신 예정일순을 사용해야 합니다.");
assert.deepEqual(Array.from(context.dbHistoryTasksV27("step|tpl-fire|0", "2026-09-12"), item => item.id), ["step-manual", "step-auto"], "연계 단계 이력은 원본 단계 번호로 구분해야 합니다.");
assert.equal(context.taskLinkedToDbRefV27(sandbox.state.tasks.find(item => item.id === "step-auto"), "root|tpl-fire"), false, "연계 단계를 루트 이력으로 잘못 연결하면 안 됩니다.");
assert.equal(context.isPastDbTaskV27(sandbox.state.tasks.find(item => item.id === "root-future"), "2026-09-12"), false, "미완료 미래업무는 과거이력에서 제외해야 합니다.");
assert.equal(sandbox.state.tasks.find(item => item.id === "step-manual").start, "2026-08-20", "수동 수정 일정은 조회 과정에서 변경되면 안 됩니다.");
assert.equal(context.historyScheduleV27({ start: "2026-08-04", end: "2026-08-06" }), "2026.08.04 ~ 2026.08.06");

assert.match(html, /id="unifiedSearchV27"[^>]*aria-live="polite"[^>]*hidden/, "기존 업무 검색 아래에 통합검색 결과 영역이 있어야 합니다.");
assert.match(html, /\[수행업무\][\s\S]*\[업무DB\]/, "수행업무와 업무DB 결과를 구분해야 합니다.");
assert.match(html, /UNIFIED_SEARCH_BATCH_V27=10/, "통합검색은 종류별 최근 10건씩 먼저 렌더링해야 합니다.");
assert.match(html, /DB_HISTORY_BATCH_V27=10/, "과거 수행이력은 최근 10건부터 보여야 합니다.");
assert.match(html, /id="dbHistoryMoreV27"/, "과거 수행이력 더 보기가 있어야 합니다.");
assert.match(extractLastFunction("renderDbHistoryV27"), /openChecklist\(button\.dataset\.dbHistoryTaskV27\)/, "과거이력은 기존 수행업무 상세를 열어야 합니다.");
assert.match(html, /data-unified-db-v27[\s\S]*openDbDetailV6/, "업무DB 검색결과는 기존 업무DB 상세를 열어야 합니다.");
assert.match(html, /taskListVisibleV6=taskListVisibleV27/, "기존 업무목록 검색·필터 렌더 경로를 확장해야 합니다.");
assert.match(html, /dbVisibleRowsV10=function\(\)[\s\S]*dbRowMatchesUnifiedSearchV27/, "기존 업무DB 검색 경로를 확장해야 합니다.");

const v27Start = html.indexOf("APP V27 — unified search / DB task history");
const v27End = html.indexOf("APP V28 — manual DB health / missing repeat repair", v27Start);
const v27Source = html.slice(v27Start, v27End);
assert.ok(v27Start > 0 && v27End > v27Start, "5단계 코드 범위를 찾을 수 있어야 합니다.");
assert.doesNotMatch(v27Source, /\bsaveState\b|\bonSnapshot\b|\bgetDocs\b|\bsetDoc\b|\bupdateDoc\b|\brunTransaction\b|\bcollection\s*\(/, "통합검색·과거이력 자체가 Firestore read/write/listener를 추가하면 안 됩니다.");
assert.match(v27Source, /state\.tasks/, "이미 동기화된 수행업무 상태를 재사용해야 합니다.");
assert.match(v27Source, /state\.templates/, "이미 동기화된 업무DB 상태를 재사용해야 합니다.");
assert.match(html, /ROLLING_AUTO_MONTHS_V24=12/, "Rolling 12개월 기능을 유지해야 합니다.");
assert.match(html, /HOME_FOCUS_META_V25/, "HOME 요약 기능을 유지해야 합니다.");
assert.match(html, /APP V26 — mobile compact lists/, "모바일 컴팩트 UI를 유지해야 합니다.");
assert.match(serviceWorker, /work-manager-v10-shell-2026-09-13-31/, "6단계 배포 캐시에서도 통합검색·과거이력이 유지되어야 합니다.");
assert.match(html, /navigator\.serviceWorker\.register\('\.\/sw\.js\?v=20260913-31'\)/, "새 서비스워커 URL을 등록해야 합니다.");

console.log("PASS unified search and DB task history regression");
