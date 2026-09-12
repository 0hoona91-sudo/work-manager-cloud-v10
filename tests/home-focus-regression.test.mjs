import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
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
  Array,
  state: { tasks: [], settings: { taskListCategories: ["다른 분류"] } },
  window: { v25HomeFocusKey: "" },
  controls: {
    "#taskSearch": { value: "일치하지 않는 검색어" },
    "#taskStatusFilter": { value: "done" },
  },
  $(selector) {
    return sandbox.controls[selector] || null;
  },
  todayISO: () => "2026-09-09",
  iso(value) {
    if (typeof value === "string") return value.slice(0, 10);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  },
  dateOf(value) {
    if (!value) return null;
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12);
  },
  addDays(value, amount) {
    const date = sandbox.dateOf(value);
    date.setDate(date.getDate() + Number(amount || 0));
    return sandbox.iso(date);
  },
  effectiveStatus(task) {
    if (task.actualComplete || task.status === "done") return "done";
    if (task.status === "hold") return "hold";
    const due = task.deadline || task.end || task.start;
    if (due && due < sandbox.todayISO()) return "overdue";
    return task.status || "planned";
  },
  taskMatchesRange(task, start, end) {
    const taskStart = task.start;
    const taskEnd = task.end || task.start;
    return Boolean(taskStart && taskEnd && taskStart <= end && taskEnd >= start);
  },
};
const context = vm.createContext(sandbox);
for (const name of ["homeFocusWeekBoundsV25", "taskMatchesHomeFocusV25", "homeFocusTasksV25"]) {
  vm.runInContext(extractLastFunction(name), context);
}
vm.runInContext(extractLastFunction("taskListVisibleV6"), context);

sandbox.state.tasks = [
  { id: "today", start: "2026-09-09", end: "2026-09-09", deadline: "2026-09-09", status: "planned" },
  { id: "spanning", start: "2026-09-08", end: "2026-09-10", deadline: "2026-09-10", status: "progress", urgent: true },
  { id: "today-done", start: "2026-09-09", end: "2026-09-09", deadline: "2026-09-09", status: "done", actualComplete: "2026-09-09", urgent: true },
  { id: "actual-done", start: "2026-09-09", end: "2026-09-09", deadline: "2026-09-09", status: "planned", actualComplete: "2026-09-09" },
  { id: "overdue", start: "2026-09-01", end: "2026-09-01", deadline: "2026-09-08", status: "planned" },
  { id: "week-past", start: "2026-09-07", end: "2026-09-07", deadline: "2026-09-07", status: "planned" },
  { id: "week-sunday", start: "2026-09-13", end: "2026-09-13", deadline: "2026-09-13", status: "planned" },
  { id: "next-week", start: "2026-09-14", end: "2026-09-14", deadline: "2026-09-14", status: "planned" },
  { id: "urgent-future", start: "2026-09-20", end: "2026-09-20", deadline: "2026-09-20", status: "planned", urgent: true },
  { id: "hold-old", start: "2026-09-01", end: "2026-09-01", deadline: "2026-09-01", status: "hold" },
];

assert.deepEqual(Array.from(context.homeFocusWeekBoundsV25()), ["2026-09-07", "2026-09-13"], "이번 주는 기존 간트와 같은 월요일~일요일이어야 합니다.");
assert.deepEqual(Array.from(context.homeFocusTasksV25("today"), task => task.id), ["today", "spanning"], "오늘을 지나는 미완료 업무만 분류해야 합니다.");
assert.deepEqual(Array.from(context.homeFocusTasksV25("overdue"), task => task.id), ["overdue", "week-past"], "기존 기한초과 판정과 완료 제외를 그대로 사용해야 합니다.");
assert.deepEqual(Array.from(context.homeFocusTasksV25("week"), task => task.id), ["today", "spanning", "week-past", "week-sunday"], "다음 주와 완료 업무를 이번 주에 포함하면 안 됩니다.");
assert.deepEqual(Array.from(context.homeFocusTasksV25("urgent"), task => task.id), ["spanning", "urgent-future"], "긴급 미완료 업무만 분류해야 합니다.");
assert.equal(context.taskMatchesHomeFocusV25(sandbox.state.tasks.at(-1), "overdue"), false, "보류 업무는 기존 정책대로 자동 기한초과로 바꾸면 안 됩니다.");
sandbox.window.v25HomeFocusKey = "today";
assert.deepEqual(Array.from(context.taskListVisibleV6(), task => task.id), ["spanning", "today"], "집중보기에서는 이전 검색·상태·대분류 필터 때문에 카드 건수가 누락되면 안 됩니다.");
sandbox.window.v25HomeFocusKey = "";

for (const label of ["오늘 업무", "기한초과", "이번 주", "긴급 업무"]) {
  assert.ok(html.includes(`label:'${label}'`), `HOME에 ${label} 집중보기가 있어야 합니다.`);
}
assert.match(html, /home-focus-grid-v25\{grid-template-columns:repeat\(4,minmax\(140px,1fr\)\)/, "PC에서는 네 요약카드를 한 줄로 배치해야 합니다.");
assert.match(html, /max-width:900px\)[\s\S]*home-focus-grid-v25\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, "모바일·태블릿에서는 두 열로 줄여야 합니다.");
assert.match(extractLastFunction("openHomeFocusV25"), /showPage\('taskListPage'\)/, "요약카드는 기존 업무목록으로 이동해야 합니다.");
assert.match(extractLastFunction("openHomeFocusV25"), /history\.pushState/, "모바일 뒤로가기로 HOME에 복귀할 수 있어야 합니다.");
assert.match(extractLastFunction("taskListVisibleV6"), /taskMatchesHomeFocusV25/, "집중보기는 기존 업무목록 렌더 경로에서 필터링해야 합니다.");
assert.match(html, /onRemote:\(\)=>\{renderCategoryMulti\(\);renderHome\(\);renderTaskTable\(\)/, "기존 실시간 동기화 시 HOME 건수와 집중목록을 함께 다시 계산해야 합니다.");
assert.match(html, /const renderHomeV25Base=renderHome;\s*renderHome=function\(\)\{const result=renderHomeV25Base\(\);renderHomeFocusV25\(\);return result\}/, "기존 HOME 렌더를 한 번만 호출한 뒤 요약을 계산해야 합니다.");

const focusSources = ["homeFocusWeekBoundsV25", "taskMatchesHomeFocusV25", "homeFocusTasksV25", "renderHomeFocusV25", "openHomeFocusV25", "renderTaskFocusV25"]
  .map(extractLastFunction)
  .join("\n");
assert.doesNotMatch(focusSources, /\bsaveState\b|\bonSnapshot\b|\bgetDocs\b/, "HOME 요약·집중보기 자체가 Firestore read/write를 만들면 안 됩니다.");

console.log("PASS HOME summary/focus regression");
