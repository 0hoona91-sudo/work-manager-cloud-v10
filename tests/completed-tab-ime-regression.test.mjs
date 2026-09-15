import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function extractLastFunction(name) {
  const marker = `function ${name}(`;
  const start = html.lastIndexOf(marker);
  assert.notEqual(start, -1, `${name} 함수가 있어야 합니다.`);
  const brace = html.indexOf("{", start);
  let depth = 0, quote = "", escaped = false, templateDepth = 0;
  for (let index = brace; index < html.length; index++) {
    const char = html[index], next = html[index + 1];
    if (escaped) { escaped = false; continue; }
    if (quote) {
      if (char === "\\") { escaped = true; continue; }
      if (quote === "`" && char === "$" && next === "{") { templateDepth++; depth++; index++; continue; }
      if (char === quote && (!templateDepth || quote !== "`")) quote = "";
      else if (quote === "`" && char === "}" && templateDepth) { templateDepth--; depth--; }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") quote = char;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error(`${name} 함수의 닫는 괄호를 찾지 못했습니다.`);
}

function extractLastAssignedFunction(name) {
  const marker = `${name}=function(`;
  const start = html.lastIndexOf(marker);
  assert.notEqual(start, -1, `${name} 최종 대입 함수가 있어야 합니다.`);
  const offset = start + name.length + 1;
  const endMarker = name === "openChecklist" ? "\n};\n\nfunction syncChecklistProgressV35" : "\n};";
  const end = html.indexOf(endMarker, offset);
  assert.notEqual(end, -1, `${name} 최종 대입 함수의 끝을 찾지 못했습니다.`);
  return html.slice(offset, end + 2);
}

const tasks = [
  { id: "future-done", status: "done", deadline: "2026-10-01" },
  { id: "overdue-done", status: "done", actualComplete: "2026-09-15", deadline: "2026-09-01" },
  { id: "actual-done", status: "overdue", actualComplete: "2026-09-15", deadline: "2026-09-01" },
  { id: "overdue-open", status: "planned", deadline: "2026-09-01" },
  { id: "future-open", status: "progress", deadline: "2026-10-01" },
];
const filterSandbox = {
  window: { v33TaskView: "active", v25HomeFocusKey: "" },
  taskListVisibleV34Base: () => tasks,
  currentTaskViewV33: () => filterSandbox.window.v33TaskView,
  sortTaskRowsV34: (rows) => rows,
};
const filterContext = vm.createContext(filterSandbox);
vm.runInContext(`${extractLastFunction("isTaskCompletedV34")}\n${extractLastFunction("taskListVisibleV34")}`, filterContext);
assert.deepEqual(Array.from(filterContext.taskListVisibleV34(), task => task.id), ["overdue-open", "future-open"], "진행 탭은 완료되지 않은 업무만 표시해야 합니다.");
filterSandbox.window.v33TaskView = "completed";
assert.deepEqual(Array.from(filterContext.taskListVisibleV34(), task => task.id), ["future-done", "overdue-done", "actual-done"], "완료 탭은 날짜와 무관하게 완료 업무를 표시해야 합니다.");
tasks[0].status = "progress"; tasks[0].actualComplete = null;
assert.deepEqual(Array.from(filterContext.taskListVisibleV34(), task => task.id), ["overdue-done", "actual-done"], "완료 취소 업무는 완료 탭에서 즉시 빠져야 합니다.");
filterSandbox.window.v33TaskView = "active";
assert.ok(Array.from(filterContext.taskListVisibleV34(), task => task.id).includes("future-done"), "완료 취소 업무는 진행 탭으로 복귀해야 합니다.");
assert.match(html, /const taskListVisibleV34Base=taskListVisibleV33Base;/, "최종 V34 필터가 이전 보기 wrapper 결과에 의존하지 않아야 합니다.");

const sentence = "소방시설 작동기능점검 결과보고서 제출";
const task = { id: "task-1", name: "공문 테스트", status: "planned", relatedDocumentTitle: "", checklist: [{ id: "check-1", text: "제출", done: false }] };
const documentInput = { value: "", dataset: { relatedTaskV35: task.id } };
const checkbox = { dataset: { check: "check-1" }, checked: false };
const note = { textContent: "", classList: { toggle() {} } };
const complete = { disabled: true, textContent: "", onclick: null };
const edit = { onclick: null };
let modalCalls = 0, saveCalls = 0, completionCalls = 0;
const checklistSandbox = {
  state: { tasks: [task] },
  $: (selector) => ({
    "#relatedDocumentTitleV15": documentInput,
    "#checklistProgressV35": note,
    "#completeTask": complete,
    "[data-edit-task]": edit,
  })[selector] || null,
  $$: (selector) => selector === "[data-check]" ? [checkbox] : [],
  modal: () => { modalCalls++; }, esc: value => String(value ?? ""), fmtDate: value => value || "",
  canCompleteTaskV18: value => !value.checklist.length || value.checklist.every(item => item.done),
  effectiveStatus: value => value.actualComplete || value.status === "done" ? "done" : value.status,
  checklistMessageV18: (_task, checks, doneCount, allDone) => `${doneCount}/${checks.length}:${allDone}`,
  saveState: async () => { saveCalls++; }, clearTimeout: () => {},
  scheduleRelatedDocumentSaveV15: () => {}, toast: () => {}, openTaskForm: () => {},
  persistTaskStatusV18: async () => { completionCalls++; return true; },
};
const checklistContext = vm.createContext(checklistSandbox);
const finalOpenChecklist = extractLastAssignedFunction("openChecklist");
vm.runInContext(`let relatedDocumentSaveTimerV15=null,relatedDocumentDirtyV35=false,relatedDocumentComposingV35=false;\n${extractLastFunction("captureRelatedDocumentV15")}\n${extractLastFunction("flushRelatedDocumentV35")}\n${extractLastFunction("syncChecklistProgressV35")}\nopenChecklist=${finalOpenChecklist}`, checklistContext);
checklistContext.openChecklist(task.id);
documentInput.oncompositionstart();
documentInput.value = sentence;
documentInput.oninput({ isComposing: true });
assert.equal(task.relatedDocumentTitle, "", "한글 조합 중간 문자열은 저장하지 않아야 합니다.");
checkbox.checked = true;
await checkbox.onchange();
assert.equal(task.relatedDocumentTitle, sentence, "체크 직전에 IME 최종 문자열 전체를 반영해야 합니다.");
assert.equal(modalCalls, 1, "체크박스 변경으로 팝업 전체를 다시 만들면 안 됩니다.");
assert.equal(saveCalls, 1, "공문 최종값과 체크 상태는 한 번의 기존 저장으로 함께 반영해야 합니다.");
assert.equal(complete.disabled, false, "마지막 체크 후 기존 완료 버튼을 활성화해야 합니다.");
assert.equal(typeof complete.onclick, "function", "재렌더 없이 활성화된 완료 버튼도 작동해야 합니다.");
await complete.onclick();
assert.equal(completionCalls, 1, "업무 완료는 기존 공통 저장 경로를 사용해야 합니다.");

const checklistSource = finalOpenChecklist;
assert.match(checklistSource, /oncompositionstart/);
assert.match(checklistSource, /oncompositionend/);
assert.match(checklistSource, /event\.isComposing\|\|relatedDocumentComposingV35/);
assert.doesNotMatch(checklistSource, /openChecklist\(id\)/, "체크박스 변경 시 팝업 전체 재렌더를 호출하면 안 됩니다.");
assert.doesNotMatch(extractLastFunction("captureRelatedDocumentV15"), /\.trim\(/, "관련 공문 입력값에 trim을 적용하면 안 됩니다.");

console.log("completed tab + Korean IME regression: PASS");
