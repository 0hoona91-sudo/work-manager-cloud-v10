import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const serviceWorker = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");

function extractLastFunction(name) {
  const matcher = new RegExp(`function\\s+${name}\\s*\\(`, "g");
  let found = null;
  for (let match; (match = matcher.exec(html));) found = match.index;
  assert.notEqual(found, null, `${name} 함수를 찾을 수 없습니다.`);
  const asyncStart = html.lastIndexOf("async ", found);
  const start = asyncStart >= 0 && /^async\s+$/.test(html.slice(asyncStart, found)) ? asyncStart : found;
  const bodyMatch = /\)\s*\{/.exec(html.slice(found));
  assert.ok(bodyMatch, `${name} 함수 본문을 찾을 수 없습니다.`);
  const open = found + bodyMatch.index + bodyMatch[0].lastIndexOf("{");
  let depth = 0;
  let mode = "code";
  let escaped = false;
  for (let index = open; index < html.length; index += 1) {
    const char = html[index];
    const next = html[index + 1];
    if (mode === "line-comment") {
      if (char === "\n") mode = "code";
      continue;
    }
    if (mode === "block-comment") {
      if (char === "*" && next === "/") { mode = "code"; index += 1; }
      continue;
    }
    if (mode !== "code") {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if ((mode === "single" && char === "'") || (mode === "double" && char === '"') || (mode === "template" && char === "`")) mode = "code";
      continue;
    }
    if (char === "/" && next === "/") { mode = "line-comment"; index += 1; }
    else if (char === "/" && next === "*") { mode = "block-comment"; index += 1; }
    else if (char === "'") mode = "single";
    else if (char === '"') mode = "double";
    else if (char === "`") mode = "template";
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error(`${name} 함수의 닫는 괄호를 찾을 수 없습니다.`);
}

const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
for (const [index, source] of inlineScripts.entries()) {
  assert.doesNotThrow(() => new vm.Script(source, { filename: `index-inline-${index + 1}.js` }), `인라인 스크립트 ${index + 1} 문법이 유효해야 합니다.`);
}

const statusContext = vm.createContext({ todayISO: () => "2026-09-15" });
vm.runInContext(extractLastFunction("effectiveStatus"), statusContext);
assert.equal(statusContext.effectiveStatus({ status: "done", deadline: "2026-09-01" }), "done", "저장 상태 완료는 과거 기한초과보다 우선해야 합니다.");
assert.equal(statusContext.effectiveStatus({ status: "overdue", actualComplete: "2026-09-14", deadline: "2026-09-01" }), "done", "실제완료일이 있으면 기존 기한초과 저장값보다 완료가 우선해야 합니다.");
assert.equal(statusContext.effectiveStatus({ status: "planned", deadline: "2026-09-01" }), "overdue", "미완료 과거 업무는 계속 기한초과여야 합니다.");

let releaseSave;
const renders = [];
const completionSandbox = {
  todayISO: () => "2026-09-15",
  recalcLinks: () => renders.push("links"),
  renderTaskTable: () => renders.push("tasks"),
  renderHome: () => renders.push("home"),
  saveState: () => new Promise((resolve) => { releaseSave = resolve; }),
  closeModal: () => renders.push("close"),
  toast: () => {},
  openChecklist: () => {},
};
const completionContext = vm.createContext(completionSandbox);
vm.runInContext(["canCompleteTaskV18", "applyTaskStatusFieldsV18", "persistTaskStatusV18"].map(extractLastFunction).join("\n"), completionContext);
const overdueTask = { id: "overdue", status: "overdue", deadline: "2026-09-01", actualComplete: null, checklist: [] };
const pendingSave = completionContext.persistTaskStatusV18(overdueTask, "done", { closeAfter: true });
assert.equal(overdueTask.status, "done", "기한초과 업무 완료 시 저장값을 즉시 done으로 바꿔야 합니다.");
assert.equal(overdueTask.actualComplete, "2026-09-15", "완료 처리 시 실제완료일을 저장해야 합니다.");
assert.deepEqual(renders.slice(0, 3), ["links", "tasks", "home"], "목록 이동과 HOME 집계는 클라우드 응답 전에 즉시 갱신해야 합니다.");
releaseSave();
await pendingSave;
assert.equal(renders.filter((item) => item === "tasks").length, 1, "성공 저장 뒤 같은 목록을 불필요하게 다시 렌더링하지 않아야 합니다.");

const sortSandbox = {
  window: { v34TableSort: { task: { key: "name", direction: "asc" }, db: { key: "period", direction: "asc" } } },
  isMobileUiV17: () => false,
  effectiveStatus: (task) => task.actualComplete || task.status === "done" ? "done" : task.status,
};
const sortContext = vm.createContext(sortSandbox);
vm.runInContext([
  "desktopTableSortEnabledV34", "stableSortV34", "compareSortValueV34", "taskSortValuesV34", "compareTaskRowsV34", "sortTaskRowsV34",
  "dbPeriodSortValuesV34", "dbGroupSortValuesV34", "compareDbGroupsV34", "sortDbRowsV34",
].map(extractLastFunction).join("\n"), sortContext);

const taskRows = [{ id: "b", name: "나" }, { id: "a1", name: "가" }, { id: "a2", name: "가" }];
assert.deepEqual(Array.from(sortContext.sortTaskRowsV34(taskRows), (task) => task.id), ["a1", "a2", "b"], "업무 정렬은 동률 행의 기존 순서를 지키는 stable sort여야 합니다.");
sortSandbox.window.v34TableSort.task.direction = "desc";
assert.deepEqual(Array.from(sortContext.sortTaskRowsV34(taskRows), (task) => task.id), ["b", "a1", "a2"], "같은 열은 내림차순으로 토글할 수 있어야 합니다.");

const root10 = { id: "m10", name: "10월 업무", cycle: "monthly", cycleMonths: [10] };
const root2 = { id: "m2", name: "2월 업무", cycle: "monthly", cycleMonths: [2] };
const dbRows = [
  { ref: "root|m10", root: root10 }, { ref: "step|m10|0", root: root10 },
  { ref: "root|m2", root: root2 }, { ref: "step|m2|0", root: root2 },
];
assert.deepEqual(Array.from(sortContext.sortDbRowsV34(dbRows), (row) => row.ref), ["root|m2", "step|m2|0", "root|m10", "step|m10|0"], "진행월은 숫자 의미순이며 연계 단계는 부모와 붙어 있어야 합니다.");
assert.ok(sortContext.dbPeriodSortValuesV34({ cycle: "quarterly", quarter: 2 })[0] < sortContext.dbPeriodSortValuesV34({ cycle: "quarterly", quarter: 4 })[0], "분기는 1~4분기 의미순으로 비교해야 합니다.");
assert.ok(sortContext.dbPeriodSortValuesV34({ cycle: "half", half: "first" })[0] < sortContext.dbPeriodSortValuesV34({ cycle: "half", half: "second" })[0], "반기는 상반기 다음 하반기 순서여야 합니다.");
sortSandbox.isMobileUiV17 = () => true;
assert.deepEqual(Array.from(sortContext.sortTaskRowsV34(taskRows), (task) => task.id), ["b", "a1", "a2"], "모바일 compact 목록에는 데스크톱 정렬을 적용하지 않아야 합니다.");

assert.match(html, /@media\(max-width:620px\)[\s\S]*home-annual-date-v32 \.home-date-card-v12\{flex:0 0 auto!important;height:auto!important;min-height:0!important/, "모바일 세로 flex에서 270px basis가 높이로 적용되지 않아야 합니다.");
for (const token of ["TASK_SORT_HEADERS_V34", "DB_SORT_HEADERS_V34", "ondblclick", "aria-sort", "▲", "▼"]) assert.ok(html.includes(token), `${token} 데스크톱 정렬 구현이 있어야 합니다.`);
const v34Source = html.slice(html.lastIndexOf("APP V34 — compact HOME / completion priority / desktop sorting"));
assert.doesNotMatch(v34Source, /\bgetDocs\b|\bonSnapshot\b|\bsetDoc\b|\bupdateDoc\b|\brunTransaction\b|\bsaveState\b|\bensureAutoSchedules/, "V34 UI/정렬 계층이 Firestore 호출이나 Rolling 실행을 추가하면 안 됩니다.");
assert.match(serviceWorker, /work-manager-v10-shell-2026-09-15-38/, "이번 수정의 최신 서비스워커 캐시를 사용해야 합니다.");
assert.match(html, /navigator\.serviceWorker\.register\('\.\/sw\.js\?v=20260915-38'\)/, "이번 수정의 서비스워커 URL을 등록해야 합니다.");

console.log("PASS mobile HOME date, overdue completion, and desktop table sorting regression");
