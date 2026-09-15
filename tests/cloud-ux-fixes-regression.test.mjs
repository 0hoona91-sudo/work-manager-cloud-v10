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
  const open = html.indexOf("{", found);
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
      if (char === "*" && next === "/") {
        mode = "code";
        index += 1;
      }
      continue;
    }
    if (mode !== "code") {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if ((mode === "single" && char === "'") || (mode === "double" && char === '"') || (mode === "template" && char === "`")) mode = "code";
      continue;
    }
    if (char === "/" && next === "/") {
      mode = "line-comment";
      index += 1;
    } else if (char === "/" && next === "*") {
      mode = "block-comment";
      index += 1;
    } else if (char === "'") mode = "single";
    else if (char === '"') mode = "double";
    else if (char === "`") mode = "template";
    else if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return html.slice(found, index + 1);
  }
  throw new Error(`${name} 함수의 닫는 괄호를 찾을 수 없습니다.`);
}

const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
for (const [index, source] of inlineScripts.entries()) {
  assert.doesNotThrow(() => new vm.Script(source, { filename: `index-inline-${index + 1}.js` }), `인라인 스크립트 ${index + 1} 문법이 유효해야 합니다.`);
}

const tasks = [
  { id: "planned", status: "planned" },
  { id: "progress", status: "progress" },
  { id: "hold", status: "hold" },
  { id: "done-status", status: "done" },
  { id: "done-actual", status: "planned", actualComplete: "2026-09-14" },
];
const filterSandbox = {
  window: { v25HomeFocusKey: "", v33TaskView: "active" },
  taskListVisibleV33Base: () => tasks,
  effectiveStatus(task) {
    return task.actualComplete || task.status === "done" ? "done" : task.status;
  },
};
const filterContext = vm.createContext(filterSandbox);
vm.runInContext(`${extractLastFunction("currentTaskViewV33")}\n${extractLastFunction("taskListVisibleV33")}`, filterContext);
assert.deepEqual(Array.from(filterContext.taskListVisibleV33(), (task) => task.id), ["planned", "progress", "hold"], "진행 보기는 완료가 아닌 기존 업무만 표시해야 합니다.");
filterSandbox.window.v33TaskView = "completed";
assert.deepEqual(Array.from(filterContext.taskListVisibleV33(), (task) => task.id), ["done-status", "done-actual"], "완료 보기는 기존 완료 판정 업무만 표시해야 합니다.");
filterSandbox.window.v25HomeFocusKey = "today";
assert.deepEqual(Array.from(filterContext.taskListVisibleV33(), (task) => task.id), ["planned", "progress", "hold"], "HOME 집중보기는 항상 진행 업무 범위를 사용해야 합니다.");

const syncSandbox = {
  state: {
    settings: { suppressedAutoKeys: [] },
    tasks: [{
      id: "manual-occurrence",
      dbAuto: true,
      autoSourceTemplateId: "template-1",
      generatedKey: "dbauto:template-1:2026-09-30",
      start: "2026-09-15",
      end: "2026-09-15",
      deadline: "2026-09-15",
      status: "planned",
      unconfirmed: false,
      manualOverride: false,
      scheduleOverride: true,
      checklist: [],
    }],
  },
  templateOccurrenceSpecsV5: () => [{ key: "dbauto:template-1:2026-09-30", planned: "2026-09-30" }],
  effectiveStatus: (task) => task.status,
  todayISO: () => "2026-09-14",
  preserveChecklistV5: (current) => current,
  addDays: (value) => value,
  ensureDbLinkedChildrenV5: () => {},
  taskFromDbTemplateV5: () => { throw new Error("기존 회차를 다시 만들면 안 됩니다."); },
};
const syncContext = vm.createContext(syncSandbox);
vm.runInContext(extractLastFunction("syncTemplateScheduleV5"), syncContext);
syncContext.syncTemplateScheduleV5({ id: "template-1", autoSchedule: true, cycle: "monthly", dayRule: "unknown", checklist: [] }, "2026-09-01", "2026-09-30", "pending");
assert.equal(syncSandbox.state.tasks[0].start, "2026-09-15", "scheduleOverride 회차의 사용자가 정한 날짜를 템플릿 동기화가 덮어쓰면 안 됩니다.");
assert.equal(syncSandbox.state.tasks[0].unconfirmed, false, "수동 확정 회차에 템플릿의 일정 미정 상태를 다시 주입하면 안 됩니다.");

const v9Source = html.slice(html.indexOf("APP V9 — 일정 무결성 / 중복 방지"), html.indexOf("APP V10 —", html.indexOf("APP V9 — 일정 무결성 / 중복 방지")));
assert.match(v9Source, /manualDateChanged=requestedStart!==oldStart[\s\S]*if\(manualDateChanged\)un=false/, "상세폼에서 날짜를 직접 바꾸면 해당 회차의 일정 미정을 해제해야 합니다.");
assert.match(v9Source, /t\.start=newStart[\s\S]*t\.unconfirmed=false;t\.manualOverride=true;t\.scheduleOverride=true/, "인라인 날짜 변경은 일정 미정을 해제하고 두 보호 플래그를 저장해야 합니다.");
const syncSource = extractLastFunction("syncTemplateScheduleV5");
assert.match(syncSource, /!old\.manualOverride&&!old\.scheduleOverride/, "템플릿 동기화 삭제 판단에서 두 수동 일정 보호값을 모두 존중해야 합니다.");
assert.match(syncSource, /if\(!root\.manualOverride&&!root\.scheduleOverride\)\{[\s\S]*root\.unconfirmed=t\.dayRule==='unknown'/, "보호되지 않은 자동 회차에만 템플릿 날짜와 일정 미정을 적용해야 합니다.");

const dateSource = extractLastFunction("upgradeDateInputV20");
assert.match(dateSource, /createElement\('button'\)[\s\S]*date-picker-button-v33/, "공통 날짜 입력은 보이는 달력 아이콘을 실제 버튼으로 만들어야 합니다.");
assert.match(dateSource, /typeof picker\.showPicker==='function'[\s\S]*picker\.showPicker\(\)[\s\S]*picker\.click\(\)/, "Chrome·Edge showPicker와 안전한 fallback을 모두 제공해야 합니다.");
assert.match(dateSource, /input\.type='text'[\s\S]*normalizeCompactDateV20/, "YYYY-MM-DD와 YYYYMMDD 직접 입력 경로를 유지해야 합니다.");
assert.match(html, /\.date-picker-button-v33\{position:absolute;right:2px;top:2px;bottom:2px[\s\S]*width:40px/, "보이는 달력 버튼 전체가 충분한 실제 클릭 영역이어야 합니다.");

const v33Source = html.slice(html.lastIndexOf("APP V33 — Cloud UX preferences / task views / date safeguards"));
assert.match(v33Source, /workManagerCloudUiPreferencesV33/, "메뉴·HOME 개인설정을 하나의 브라우저 설정 객체로 관리해야 합니다.");
assert.match(v33Source, /localStorage\.getItem[\s\S]*localStorage\.setItem/, "UI 설정은 Firestore가 아닌 localStorage에서 읽고 저장해야 합니다.");
assert.doesNotMatch(v33Source, /\bgetDocs\b|\bonSnapshot\b|\bsetDoc\b|\bupdateDoc\b|\brunTransaction\b|\bsaveState\b|\bensureAutoSchedules/, "V33 UX 계층이 Firestore read/write/listener 또는 Rolling 실행을 추가하면 안 됩니다.");
assert.match(v33Source, /navVisibility:\{tasks:true,db:true,holidays:true,history:true\}/, "기존 사용자는 모든 메뉴가 보이는 기본값을 유지해야 합니다.");
for (const label of ["진행(예정) 업무", "완료된 업무", "화면 구성", "HOME과 설정/백업은 항상 표시됩니다."]) assert.ok(v33Source.includes(label), `${label} UI가 있어야 합니다.`);
for (const section of ["gantt", "calendar", "overdue", "period"]) assert.match(v33Source, new RegExp(`${section}:\\{selector:`), `HOME ${section} 영역을 접고 펼 수 있어야 합니다.`);
for (const key of ["today", "overdue", "week", "urgent"]) assert.match(v33Source, new RegExp(`homeSummaryCards:[\\s\\S]*${key}:true`), `HOME ${key} 카드는 기본 표시여야 합니다.`);
assert.match(v33Source, /homeSummaryPanelV33" hidden/, "요약카드 표시 설정은 기본 닫힘 inline 패널이어야 합니다.");
assert.match(html, /home-focus-preferences-v33\{grid-template-columns:repeat\(auto-fit/, "남은 요약카드는 빈 자리 없이 자동 재배치되어야 합니다.");
assert.match(html, /grid-template-columns:repeat\(var\(--nav-count-v33,7\)/, "모바일 하단 메뉴는 실제 표시 항목 수에 맞춰 재배치되어야 합니다.");

assert.match(html, /ROLLING_AUTO_MONTHS_V24=12/, "Rolling 12개월 기능을 유지해야 합니다.");
assert.match(html, /APP V29 — impact preview \/ trash \/ template versions/, "휴지통·버전·영향 미리보기 계층을 유지해야 합니다.");
assert.match(html, /APP V30 — template attachments \/ clone draft/, "Drive 관련자료와 업무DB 복제를 유지해야 합니다.");
assert.match(serviceWorker, /work-manager-v10-shell-2026-09-15-38/, "최신 Cloud UX 서비스워커 캐시를 사용해야 합니다.");
assert.match(html, /navigator\.serviceWorker\.register\('\.\/sw\.js\?v=20260915-38'\)/, "최신 서비스워커 URL을 등록해야 합니다.");

console.log("PASS Cloud UX preferences, task views, and date safeguards regression");
