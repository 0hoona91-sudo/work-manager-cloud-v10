import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

function extractLastFunction(name) {
  const matcher = new RegExp(`function\\s+${name}\\s*\\(`, "g");
  let found = null;
  for (let match; (match = matcher.exec(html));) found = match.index;
  assert.notEqual(found, null, `index.html에 ${name} 함수가 있어야 합니다.`);

  const open = html.indexOf("{", found);
  assert.notEqual(open, -1, `${name} 함수 본문을 찾을 수 없습니다.`);
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
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (
        (mode === "single" && char === "'") ||
        (mode === "double" && char === '"') ||
        (mode === "template" && char === "`")
      ) {
        mode = "code";
      }
      continue;
    }
    if (char === "/" && next === "/") {
      mode = "line-comment";
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      mode = "block-comment";
      index += 1;
      continue;
    }
    if (char === "'") mode = "single";
    else if (char === '"') mode = "double";
    else if (char === "`") mode = "template";
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return html.slice(found, index + 1);
    }
  }
  throw new Error(`${name} 함수의 닫는 괄호를 찾을 수 없습니다.`);
}

let idSequence = 0;
const sandbox = {
  console,
  Math,
  Date,
  Set,
  Map,
  Number,
  String,
  Array,
  JSON,
  GANTT_FILTER_CYCLES_V13: ["weekly", "monthly", "quarterly", "half"],
  V5_PALETTE: ["#9BC8A8"],
  ROLLING_AUTO_MONTHS_V24: 12,
  saveCalls: [],
  state: {},
  window: {
    cloudSync: {
      stableTaskId(key) {
        return `stable:${key}`;
      },
    },
  },
  clone(value) {
    return JSON.parse(JSON.stringify(value));
  },
  uid(prefix) {
    idSequence += 1;
    return `${prefix}-qa-${idSequence}`;
  },
  saveState(metadata = {}) {
    sandbox.saveCalls.push(metadata);
  },
  todayISO() {
    return "2026-09-05";
  },
  iso(value) {
    if (!value) return "";
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
  esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  },
  endOfMonth(year, month) {
    return sandbox.iso(new Date(year, month, 0, 12));
  },
};
const context = vm.createContext(sandbox);

const functions = [
  "isHoliday",
  "shiftWorkday",
  "addBusinessDays",
  "effectiveStatus",
  "normalizeCompactDateV20",
  "recurrenceDatesV2",
  "cloneOccurrenceV2",
  "preserveOccurrenceV3",
  "periodFromDate",
  "monthsForTemplate",
  "templateDateForMonth",
  "v5AddMonths",
  "v5MonthStart",
  "v5MaxDate",
  "v5MinDate",
  "v5EnsureSettings",
  "templateOccurrenceSpecsV5",
  "preserveChecklistV5",
  "stableGeneratedTaskId",
  "stableGeneratedCheckId",
  "taskFromDbTemplateV5",
  "effectiveStepSourceV6",
  "ensureDbLinkedChildrenV5",
  "calcByModeV6",
  "recalcLinks",
  "syncTemplateScheduleV5",
  "rollingAutoTargetV24",
  "recalcNewDbChainV24",
  "appendMissingTemplateOccurrencesV24",
  "v5DefaultAutoRange",
  "ensureAutoSchedulesV5",
  "stageSourceV10",
  "initialStageScheduleV10",
  "createManualDbChainV10",
  "isCanonicalDbKeyV9",
  "dedupeGeneratedKeysV9",
  "taskStepChecksV11",
  "normalizeTaskStepLinkV12",
  "createLinkedStepsV2",
  "detachDeletedDbHistoryV12",
  "removeDbTemplatesV12",
  "ensureGanttFilterSettingsV13",
  "ganttFilterBoundsV13",
  "ganttRepeatCycleV13",
  "ganttCycleVisibleV13",
  "canCompleteTaskV18",
  "applyTaskStatusFieldsV18",
  "statusSelectV18",
  "v21DueLabel",
];
for (const name of functions) vm.runInContext(extractLastFunction(name), context);

assert.equal(context.normalizeCompactDateV20("20260910"), "2026-09-10", "8자리 날짜를 ISO 날짜로 자동 변환해야 합니다.");
assert.equal(context.normalizeCompactDateV20("2026.9.7"), "2026-09-07", "점 구분 날짜도 같은 형식으로 정리해야 합니다.");
assert.equal(context.normalizeCompactDateV20("20260230"), "", "존재하지 않는 날짜를 정상 날짜로 받아들이면 안 됩니다.");
assert.equal(context.v21DueLabel("2026-09-05"), "오늘", "대시보드의 오늘 마감 표시는 날짜와 일치해야 합니다.");
assert.equal(context.v21DueLabel("2026-09-08"), "D-3", "대시보드의 가까운 마감일까지 남은 일수를 표시해야 합니다.");
assert.deepEqual(
  Array.from(context.recurrenceDatesV2("2026-09-10", "2027-09-30", "quarterly", [], [1, 4, 7, 10])),
  ["2026-10-10", "2027-01-10", "2027-04-10", "2027-07-10"],
  "분기 반복업무는 사용자가 고른 실시 월만 생성해야 합니다.",
);
assert.deepEqual(
  Array.from(context.recurrenceDatesV2("2026-09-10", "2026-09-20", "weekly", [1, 4], [])),
  ["2026-09-10", "2026-09-14", "2026-09-17"],
  "주간 반복업무는 선택한 요일만 생성해야 합니다.",
);

const completionSample = {
  status: "planned",
  actualComplete: null,
  checklist: [{ id: "finish-1", text: "결과 확인", done: false }],
};
assert.equal(context.canCompleteTaskV18(completionSample), false, "남은 체크항목이 있으면 업무 완료를 막아야 합니다.");
completionSample.checklist[0].done = true;
assert.equal(context.canCompleteTaskV18(completionSample), true, "모든 체크항목이 끝나면 업무 완료가 가능해야 합니다.");
context.applyTaskStatusFieldsV18(completionSample, "done");
assert.equal(completionSample.status, "done", "완료 처리 시 업무 상태를 done으로 저장해야 합니다.");
assert.equal(completionSample.actualComplete, "2026-09-05", "완료 처리 시 실제 완료일을 함께 저장해야 합니다.");
context.applyTaskStatusFieldsV18(completionSample, "planned");
assert.equal(completionSample.actualComplete, null, "완료 상태를 해제하면 실제 완료일도 제거해야 합니다.");

const pendingStatusHtml = context.statusSelectV18({
  id: "pending-1",
  name: "미완료 업무",
  status: "planned",
  deadline: "2026-09-10",
});
assert.ok(!pendingStatusHtml.includes('value="done"'), "미완료 업무의 목록 상태 선택기에 완료 경로가 중복되면 안 됩니다.");
const doneStatusHtml = context.statusSelectV18({
  id: "done-1",
  name: "완료 업무",
  status: "done",
  actualComplete: "2026-09-05",
});
assert.ok(doneStatusHtml.includes('<option value="done" selected>완료</option>'), "완료된 업무는 현재 완료 상태를 표시해야 합니다.");
assert.ok(!html.includes('id="openHolidaySetting"'), "설정 화면에 하단 메뉴와 중복되는 휴일 이동 버튼이 없어야 합니다.");
assert.ok(!html.includes('id="openTaskSetting"'), "설정 화면에 하단 메뉴와 중복되는 업무 이동 버튼이 없어야 합니다.");
assert.ok(!html.includes('id="openDbSetting"'), "설정 화면에 하단 메뉴와 중복되는 DB 이동 버튼이 없어야 합니다.");
assert.ok(!html.includes("간트 숨기기") && !html.includes("달력 숨기기"), "HOME 패널에 상단 배치 선택기와 중복되는 숨기기 버튼이 없어야 합니다.");
assert.match(extractLastFunction("ganttCategoryFilterHtmlV5"), /return\s+''/, "간트 내부의 중복 대분류 필터를 생성하면 안 됩니다.");

const homeMarkup = html.slice(html.indexOf('<section id="homePage"'), html.indexOf('<section id="taskListPage"'));
const homeToolbarMarkup = homeMarkup.slice(homeMarkup.indexOf('<div class="card toolbar home-toolbar-v3">'), homeMarkup.indexOf('<div id="kpis"'));
const ganttTitleMarkup = homeMarkup.slice(homeMarkup.indexOf('gantt-panel-title-v20'), homeMarkup.indexOf('<div class="panel-body"><div id="ganttView"'));
assert.ok(!homeToolbarMarkup.includes('id="ganttMonthRangeV13"'), "간트 범위 선택기가 HOME 공통 조작부에 남으면 안 됩니다.");
assert.ok(ganttTitleMarkup.includes('id="ganttMonthRangeV13"'), "간트 범위 선택기는 간트차트 제목 영역에 있어야 합니다.");
assert.ok(ganttTitleMarkup.includes('data-gantt-cycle-v13="weekly"'), "간트 반복업무 토글도 간트차트 제목 영역에 있어야 합니다.");
assert.match(homeToolbarMarkup, /legacy-home-period-v20" hidden/, "기존 기간 선택값은 호환용 숨김 필드로만 남겨야 합니다.");
assert.ok(!homeMarkup.includes("간트 + 달력 동시 HOME"), "HOME 제목 아래의 기능 나열 문구를 표시하면 안 됩니다.");
assert.ok(html.includes("간트·달력 대분류"), "대분류가 간트와 달력 모두에 적용됨을 표시해야 합니다.");

const taskFormSource = extractLastFunction("taskFormHtml");
assert.ok(taskFormSource.includes("<label>시작일</label>"), "첫 업무 시작일은 시작일로 간결하게 표시해야 합니다.");
assert.ok(taskFormSource.includes("<label>종료일</label><select id=\"tfEndType\""), "종료 방식 선택기의 제목은 종료일이어야 합니다.");
assert.ok(taskFormSource.includes('id="tfEndDateField"><input type="date"'), "날짜 직접 선택 칸에 종료일 제목을 중복 표시하면 안 됩니다.");
assert.ok(taskFormSource.includes('type="hidden" id="tfDeadline"'), "사용자가 입력하는 별도 마감일 필드는 제거해야 합니다.");
assert.ok(taskFormSource.includes("종료일이 휴일이면"), "휴일 보정 문구는 종료일 기준으로 표시해야 합니다.");
assert.ok(taskFormSource.includes('id="tfRepeatDetailsV20"'), "반복 세부 설정은 반복업무 체크 뒤에 조건부로 표시해야 합니다.");
assert.ok(taskFormSource.includes("윗단계 업무 일정 연계"), "후속 단계 일정 연계 문구를 명확하게 표시해야 합니다.");
assert.ok(html.includes('class="month-picks-v20"'), "월간 이상 반복업무에 1~12월 선택기를 제공해야 합니다.");
assert.ok(html.includes("include.disabled=!enabled") && html.includes("shift.disabled=!enabled"), "시작 후 N일이 아니면 휴일 계산 옵션을 비활성화해야 합니다.");
assert.ok(!extractLastFunction("modal").includes("classList.contains('modal-wrap')"), "팝업 바깥을 눌러도 작성 폼이 닫히면 안 됩니다.");
assert.ok(!extractLastFunction("renderHome").includes("renderSettings()"), "HOME을 그릴 때 설정 화면 전체를 다시 그리면 안 됩니다.");
assert.ok(!extractLastFunction("ensureV7Ui").includes("addEventListener('pointerup'"), "설정 버튼의 pointer 이벤트가 화면 이동마다 누적되면 안 됩니다.");
assert.ok(html.includes("sb.onpointerup=null"), "설정 버튼은 중복 pointer 경로 없이 click 한 경로만 사용해야 합니다.");
assert.ok(html.includes("grid-template-columns:repeat(7,minmax(44px,1fr))"), "반복 요일은 일곱 개 열로 가지런히 배치해야 합니다.");
assert.ok(html.includes("function enhanceDateInputsV20"), "동적으로 생성되는 모든 날짜 입력도 8자리 입력 보정을 받아야 합니다.");

for (const title of ["수행 업무 목록", "업무 데이터베이스", "휴일 DB", "변경이력", "설정 / 백업"]) {
  const heading = html.indexOf(`<h2>${title}</h2>`);
  assert.notEqual(heading, -1, `${title} 제목이 있어야 합니다.`);
  assert.ok(!html.slice(heading, heading + 180).includes('<div class="muted">'), `${title} 바로 아래 설명 문구를 표시하면 안 됩니다.`);
}

const linkedTemplate = {
  id: "qa-template-linked-4",
  category: "시설",
  name: "[QA] 1단계 현장점검",
  owner: "QA담당",
  urgent: true,
  checklist: ["현장 확인", "결과 기록"],
  notes: "4단계 일정 검증",
  durationDays: 0,
  deadlineOffset: 0,
  linkedSteps: [
    {
      name: "[QA] 2단계 검토",
      category: "시설",
      owner: "QA담당",
      checklist: ["검토자 확인"],
      dynamic: true,
      basis: "actualEnd",
      startOffset: 1,
      startMode: "business",
      startHolidayShift: "next",
      workType: "single",
      limitDays: 0,
      limitMode: "calendar",
      limitHolidayShift: "next",
    },
    {
      name: "[QA] 3단계 승인",
      category: "행정",
      owner: "QA검토자",
      checklist: ["승인 여부 기록"],
      dynamic: true,
      basis: "actualEnd",
      startOffset: 2,
      startMode: "calendar",
      startHolidayShift: "next",
      workType: "single",
      limitDays: 0,
      limitMode: "calendar",
      limitHolidayShift: "next",
    },
    {
      name: "[QA] 4단계 통보",
      category: "행정",
      owner: "QA검토자",
      checklist: ["통보 완료"],
      dynamic: true,
      basis: "actualEnd",
      startOffset: 1,
      startMode: "business",
      startHolidayShift: "next",
      workType: "single",
      limitDays: 0,
      limitMode: "calendar",
      limitHolidayShift: "next",
    },
  ],
};

const completedHistory = {
  id: "qa-history",
  name: "완료된 과거 이력",
  status: "done",
  actualComplete: "2026-08-31",
  start: "2026-08-31",
  end: "2026-08-31",
  deadline: "2026-08-31",
  checklist: [{ id: "qa-history-check", text: "보존 확인", done: true }],
};

context.state = {
  tasks: [completedHistory],
  templates: [linkedTemplate],
  holidays: [{ id: "qa-holiday", date: "2026-09-07", reason: "회사휴무" }],
  categories: ["시설", "행정"],
  owners: ["QA담당", "QA검토자"],
  settings: { suppressedAutoKeys: [] },
};

assert.equal(context.addBusinessDays("2026-09-04", 1), "2026-09-08", "주말과 회사휴무를 건너뛰어야 합니다.");

const chainResult = context.createManualDbChainV10(linkedTemplate, 0, 3, "2026-09-04");
assert.equal(chainResult.count, 4, "1→2→3→4 업무를 정확히 네 건 만들어야 합니다.");
const chainTasks = context.state.tasks.filter((task) => task.groupId === chainResult.groupId).sort((a, b) => a.step - b.step);
assert.deepEqual(
  Array.from(chainTasks, (task) => task.start),
  ["2026-09-04", "2026-09-08", "2026-09-10", "2026-09-11"],
  "연계업무 날짜가 근무일/달력일 규칙대로 계산되어야 합니다.",
);
assert.equal(chainTasks[0].checklist.length, 2, "DB 체크리스트가 수행업무에 복사되어야 합니다.");
assert.equal(chainTasks[2].owner, "QA검토자", "단계별 담당자가 유지되어야 합니다.");

const idsBeforeMove = chainTasks.map((task) => task.id);
chainTasks[0].start = "2026-09-08";
chainTasks[0].end = "2026-09-08";
chainTasks[0].deadline = "2026-09-08";
context.recalcLinks();
assert.deepEqual(
  Array.from(chainTasks, (task) => task.start),
  ["2026-09-08", "2026-09-09", "2026-09-11", "2026-09-14"],
  "1단계 이동 시 기존 2·3·4단계가 연쇄 재계산되어야 합니다.",
);
context.recalcLinks();
assert.deepEqual(chainTasks.map((task) => task.id), idsBeforeMove, "재계산이 기존 문서 ID를 바꾸면 안 됩니다.");
assert.equal(context.state.tasks.filter((task) => task.groupId === chainResult.groupId).length, 4, "날짜 재계산으로 중복업무가 생기면 안 됩니다.");
assert.equal(context.state.tasks.find((task) => task.id === "qa-history")?.actualComplete, "2026-08-31", "완료된 과거 이력이 보존되어야 합니다.");

context.state = {
  tasks: [
    { id: "qa-link-root", step: 1, start: "2026-09-10", end: "2026-09-10", deadline: "2026-09-10", status: "planned" },
    { id: "qa-link-normal", step: 2, start: "2026-09-01", end: "2026-09-01", deadline: "2026-09-01", status: "planned", link: { parentId: "qa-link-root", dynamic: true, basis: "start", startOffset: 1, startMode: "calendar", startHolidayShift: "keep", workType: "single", limitDays: 0, limitMode: "calendar", limitHolidayShift: "keep" } },
    { id: "qa-link-manual", step: 2, start: "2026-10-01", end: "2026-10-01", deadline: "2026-10-01", status: "planned", manualOverride: true, link: { parentId: "qa-link-root", dynamic: true, basis: "start", startOffset: 2, startMode: "calendar", startHolidayShift: "keep", workType: "single", limitDays: 0, limitMode: "calendar", limitHolidayShift: "keep" } },
    { id: "qa-link-schedule", step: 2, start: "2026-10-02", end: "2026-10-02", deadline: "2026-10-02", status: "planned", scheduleOverride: true, link: { parentId: "qa-link-root", dynamic: true, basis: "start", startOffset: 3, startMode: "calendar", startHolidayShift: "keep", workType: "single", limitDays: 0, limitMode: "calendar", limitHolidayShift: "keep" } },
    { id: "qa-link-done", step: 2, start: "2026-08-31", end: "2026-08-31", deadline: "2026-08-31", status: "done", actualComplete: "2026-08-31", link: { parentId: "qa-link-root", dynamic: true, basis: "start", startOffset: 4, startMode: "calendar", startHolidayShift: "keep", workType: "single", limitDays: 0, limitMode: "calendar", limitHolidayShift: "keep" } },
  ],
  holidays: [],
  settings: {},
};
context.recalcLinks();
assert.equal(context.state.tasks.find((task) => task.id === "qa-link-normal").start, "2026-09-11", "정상 연계업무는 상위 일정 변경을 따라가야 합니다.");
assert.equal(context.state.tasks.find((task) => task.id === "qa-link-manual").start, "2026-10-01", "사용자가 직접 고정한 연계일정은 자동 재계산으로 덮어쓰면 안 됩니다.");
assert.equal(context.state.tasks.find((task) => task.id === "qa-link-schedule").start, "2026-10-02", "일정 예외처리된 연계업무는 자동 재계산으로 덮어쓰면 안 됩니다.");
assert.equal(context.state.tasks.find((task) => task.id === "qa-link-done").start, "2026-08-31", "완료된 연계업무의 과거 일정은 자동 재계산으로 이동하면 안 됩니다.");

const repeatTemplate = {
  id: "qa-template-repeat",
  category: "행정",
  name: "[QA] 월간 반복 보고",
  owner: "QA검토자",
  urgent: false,
  cycle: "monthly",
  cycleMonths: [],
  dayRule: "exact",
  exactDay: 15,
  holidayShift: "prev",
  checklist: ["자료 취합", "보고 완료"],
  notes: "",
  autoSchedule: true,
  activeFrom: "2026-09-01",
  activeUntil: "2026-09-30",
  applyPolicy: "pending",
  durationDays: 0,
  deadlineOffset: 0,
  linkedSteps: [],
};
context.state = {
  tasks: [JSON.parse(JSON.stringify(completedHistory))],
  templates: [repeatTemplate],
  holidays: [],
  categories: ["행정"],
  owners: ["QA검토자"],
  settings: { suppressedAutoKeys: [] },
};
assert.equal(context.syncTemplateScheduleV5(repeatTemplate, "2026-09-01", "2026-09-30"), 1, "첫 동기화에서 한 회차를 만들어야 합니다.");
assert.equal(context.syncTemplateScheduleV5(repeatTemplate, "2026-09-01", "2026-09-30"), 0, "같은 범위 재동기화는 새 업무를 만들면 안 됩니다.");
const autoRoots = context.state.tasks.filter((task) => task.generatedKey === "dbauto:qa-template-repeat:M:2026-09");
assert.equal(autoRoots.length, 1, "같은 generatedKey는 한 건만 존재해야 합니다.");
const autoId = autoRoots[0].id;
autoRoots[0].start = "2026-09-16";
autoRoots[0].end = "2026-09-16";
autoRoots[0].deadline = "2026-09-16";
autoRoots[0].manualOverride = true;
context.syncTemplateScheduleV5(repeatTemplate, "2026-09-01", "2026-09-30");
assert.equal(context.state.tasks.filter((task) => task.generatedKey === autoRoots[0].generatedKey).length, 1, "회차 날짜 변경 뒤에도 중복 자동업무가 생기면 안 됩니다.");
assert.equal(autoRoots[0].id, autoId, "날짜 변경 뒤 자동업무 문서 ID가 유지되어야 합니다.");

context.state.tasks.push({
  ...JSON.parse(JSON.stringify(autoRoots[0])),
  id: "qa-duplicate-planned",
  status: "planned",
  actualComplete: null,
  manualOverride: false,
});
autoRoots[0].status = "done";
autoRoots[0].actualComplete = "2026-09-16";
assert.equal(context.dedupeGeneratedKeysV9(), 1, "중복 generatedKey 복구가 중복 한 건을 제거해야 합니다.");
assert.equal(context.state.tasks.find((task) => task.id === autoId)?.status, "done", "중복 복구 시 완료 이력을 우선 보존해야 합니다.");

assert.deepEqual(
  Array.from(context.v5DefaultAutoRange()),
  ["2026-09-05", "2027-09-30"],
  "DB 반복업무는 오늘부터 12개월 뒤가 속한 월말까지만 확보해야 합니다.",
);
assert.doesNotMatch(extractLastFunction("ensureAutoSchedulesV5"), /syncTemplateScheduleV5\(/, "접속 시 Rolling 보충이 기존 전체 동기화 함수를 호출하면 안 됩니다.");
assert.doesNotMatch(extractLastFunction("appendMissingTemplateOccurrencesV24"), /splice\(|state\.tasks\s*=|\.status\s*=|\.checklist\s*=/, "미래 보충 함수가 기존 업무를 삭제하거나 상태·체크리스트를 덮어쓰면 안 됩니다.");

const rollingTemplate = {
  id: "qa-rolling-template",
  category: "주거복지",
  name: "[QA] Rolling 월간업무",
  owner: "QA담당자",
  urgent: true,
  cycle: "monthly",
  cycleMonths: [],
  dayRule: "exact",
  exactDay: 15,
  holidayShift: "keep",
  checklist: ["원본 확인"],
  notes: "원본 비고",
  autoSchedule: true,
  activeFrom: "2026-09-01",
  activeUntil: "",
  durationDays: 0,
  deadlineOffset: 0,
  linkedSteps: [
    { name: "2단계 검토", category: "", owner: "", checklist: ["2단계 확인"], startOffset: 1, startMode: "business", startHolidayShift: "next" },
    { name: "3단계 보고", category: "", owner: "", checklist: ["3단계 확인"], startOffset: 2, startMode: "calendar", startHolidayShift: "keep" },
  ],
};
context.state = {
  tasks: [],
  templates: [rollingTemplate],
  holidays: [],
  categories: ["소방", "주거복지"],
  owners: ["QA담당자"],
  settings: { suppressedAutoKeys: [] },
};
sandbox.saveCalls.length = 0;
assert.equal(context.ensureAutoSchedulesV5(), 13, "첫 실행은 현재 월부터 다음 해 같은 월까지 필요한 월간 회차만 생성해야 합니다.");
let rollingRoots = context.state.tasks.filter((task) => task.autoSourceTemplateId === rollingTemplate.id && !task.parentAutoRootId);
assert.equal(rollingRoots.length, 13, "Rolling 최초 범위에 동일 원본의 루트 회차가 월별 한 건씩 있어야 합니다.");
assert.equal(rollingTemplate.autoGeneratedThrough, "2027-09-30", "원본 DB에 마지막 확보 범위를 기록해야 합니다.");
assert.equal(new Set(rollingRoots.map((task) => task.generatedKey)).size, rollingRoots.length, "원본 ID와 예정일 기반 키가 회차마다 고유해야 합니다.");
assert.ok(rollingRoots.every((task) => task.category === "주거복지" && task.owner === "QA담당자"), "신규 루트 회차가 원본 대분류와 담당자를 상속해야 합니다.");
const firstRollingRoot = rollingRoots.find((task) => task.generatedKey === "dbauto:qa-rolling-template:M:2026-09");
const firstRollingChildren = context.state.tasks.filter((task) => task.parentAutoRootId === firstRollingRoot.id).sort((a, b) => a.step - b.step);
assert.equal(firstRollingChildren.length, 2, "Rolling 회차마다 2·3단계 연계업무를 생성해야 합니다.");
assert.ok(firstRollingChildren.every((task) => task.category === "주거복지" && task.owner === "QA담당자"), "연계 단계도 원본 대분류와 담당자를 이어받아야 합니다.");
assert.equal(firstRollingChildren[1].link.parentId, firstRollingChildren[0].id, "3단계는 같은 회차의 2단계를 상위업무로 연결해야 합니다.");

firstRollingRoot.name = "사용자가 수정한 업무명";
firstRollingRoot.owner = "사용자 지정 담당자";
firstRollingRoot.status = "done";
firstRollingRoot.actualComplete = "2026-09-18";
firstRollingRoot.manualOverride = true;
firstRollingRoot.checklist[0].done = true;
const protectedRoot = JSON.stringify(firstRollingRoot);
const countBeforeRepeat = context.state.tasks.length;
assert.equal(context.ensureAutoSchedulesV5(), 0, "같은 달에 자동 보충을 다시 실행해도 새 회차가 없어야 합니다.");
assert.equal(context.state.tasks.length, countBeforeRepeat, "같은 범위를 여러 번 검사해도 업무 수가 늘면 안 됩니다.");
assert.equal(JSON.stringify(firstRollingRoot), protectedRoot, "완료·직접수정·체크리스트 진행상태를 자동 보충이 덮어쓰면 안 됩니다.");

context.todayISO = () => "2026-10-05";
assert.equal(context.ensureAutoSchedulesV5(), 1, "다음 달 접속 시 새로 열린 마지막 한 달의 회차만 추가해야 합니다.");
rollingRoots = context.state.tasks.filter((task) => task.autoSourceTemplateId === rollingTemplate.id && !task.parentAutoRootId);
assert.equal(rollingRoots.length, 14, "다음 달 Rolling 보충 뒤에는 루트 회차가 한 건만 늘어야 합니다.");
assert.equal(rollingTemplate.autoGeneratedThrough, "2027-10-31", "다음 달 목표 월말까지 확보 표시를 전진시켜야 합니다.");
assert.equal(context.ensureAutoSchedulesV5(), 0, "같은 다음 달 범위를 재실행해도 중복 생성되면 안 됩니다.");
assert.equal(JSON.stringify(firstRollingRoot), protectedRoot, "다음 달 보충 후에도 기존 완료·수정 업무는 그대로여야 합니다.");

const finiteTemplate = {
  ...JSON.parse(JSON.stringify(rollingTemplate)),
  id: "qa-finite-template",
  name: "[QA] 종료일 있는 반복업무",
  linkedSteps: [],
  autoGeneratedThrough: "",
  activeUntil: "2027-03-20",
};
context.todayISO = () => "2026-09-05";
context.state = {
  tasks: [],
  templates: [finiteTemplate],
  holidays: [],
  categories: ["주거복지"],
  owners: ["QA담당자"],
  settings: { suppressedAutoKeys: [] },
};
assert.equal(context.ensureAutoSchedulesV5(), 7, "종료일이 있으면 종료일까지의 회차만 생성해야 합니다.");
assert.ok(context.state.tasks.every((task) => task.start <= "2027-03-20"), "반복 종료일 이후 업무를 만들면 안 됩니다.");
assert.equal(finiteTemplate.autoGeneratedThrough, "2027-03-20", "종료일이 Rolling 목표보다 빠르면 종료일까지만 확보 표시해야 합니다.");
assert.equal(context.ensureAutoSchedulesV5(), 0, "종료된 반복 원본을 다시 검사해도 중복 회차가 없어야 합니다.");

const legacyTemplate = {
  ...JSON.parse(JSON.stringify(rollingTemplate)),
  id: "qa-legacy-rolling-template",
  name: "[QA] 기존 반복 원본",
  linkedSteps: [],
  autoGeneratedThrough: "",
};
context.state = {
  tasks: [],
  templates: [legacyTemplate],
  holidays: [],
  categories: ["주거복지"],
  owners: ["QA담당자"],
  settings: { suppressedAutoKeys: [] },
};
const legacyExisting = context.taskFromDbTemplateV5(legacyTemplate, {
  key: "dbauto:qa-legacy-rolling-template:M:2026-09",
  raw: "2026-09",
  planned: "2026-09-15",
});
legacyExisting.name = "기존 사용자가 바꾼 제목";
legacyExisting.status = "done";
legacyExisting.actualComplete = "2026-09-17";
legacyExisting.manualOverride = true;
legacyExisting.checklist[0].done = true;
context.state.tasks.push(legacyExisting);
const legacyProtected = JSON.stringify(legacyExisting);
assert.equal(context.ensureAutoSchedulesV5(), 12, "확보일 표식이 없는 기존 원본도 없는 미래 회차만 보충해야 합니다.");
assert.equal(JSON.stringify(legacyExisting), legacyProtected, "최초 Rolling 전환에서도 기존 완료·수정·체크상태가 보존되어야 합니다.");
assert.equal(context.state.tasks.filter((task) => task.generatedKey === legacyExisting.generatedKey).length, 1, "기존 원본의 같은 예정일 회차를 중복 생성하면 안 됩니다.");

const preservedStepChecks = context.taskStepChecksV11(
  {
    checklist: [
      { id: "draft-check-1", text: " 2단계 확인 ", done: false },
      "새 확인 항목",
      "   ",
    ],
  },
  {
    checklist: [{ id: "draft-check-1", text: "2단계 확인", done: true }],
  },
);
assert.equal(preservedStepChecks.length, 2, "연계 단계의 빈 체크항목만 제거해야 합니다.");
assert.equal(preservedStepChecks[0].done, true, "기존 연계 단계 체크리스트의 완료 상태를 보존해야 합니다.");
assert.equal(preservedStepChecks[1].done, false, "새 연계 단계 체크항목은 미완료로 시작해야 합니다.");

const manualRoot = {
  id: "qa-manual-root",
  groupId: "qa-manual-group",
  step: 1,
  category: "시설",
  name: "A업무 1단계",
  owner: "QA담당",
  start: "2026-09-05",
  end: "2026-09-05",
  deadline: "2026-09-05",
  checklist: [],
};
context.state = { tasks: [manualRoot], templates: [], holidays: [], settings: {} };
const manualChildren = context.createLinkedStepsV2(manualRoot, [
  {
    name: "A업무 2단계",
    category: "시설",
    owner: "QA담당",
    checklist: [{ id: "qa-c2", text: "2단계 확인", done: false }],
    link: { dynamic: true, basis: "actualEnd", startOffset: 1, startMode: "business", startHolidayShift: "next" },
  },
  {
    name: "A업무 3단계",
    category: "행정",
    owner: "QA검토자",
    checklist: [{ id: "qa-c3", text: "3단계 승인", done: false }],
    link: { dynamic: true, basis: "end", startOffset: 2, startMode: "calendar", startHolidayShift: "next" },
  },
]);
assert.equal(manualChildren.length, 2, "업무등록의 2·3단계가 빈 단계 처리 없이 모두 생성되어야 합니다.");
assert.equal(context.state.tasks.length, 3, "1단계와 2·3단계가 모두 업무목록 상태에 남아야 합니다.");
assert.deepEqual(Array.from(manualChildren, (task) => task.name), ["A업무 2단계", "A업무 3단계"], "저장 직전 복사한 단계명이 유지되어야 합니다.");
assert.equal(manualChildren[0].checklist[0].text, "2단계 확인", "2단계 체크리스트를 함께 저장해야 합니다.");
assert.equal(manualChildren[1].link.parentId, manualChildren[0].id, "3단계는 생성된 2단계 문서를 부모로 연결해야 합니다.");

context.state = {
  tasks: [
    { id: "qa-db-pending", name: "삭제할 미완료 업무", status: "planned", autoSourceTemplateId: "qa-delete-template", templateId: "qa-delete-template" },
    { id: "qa-db-done", name: "보존할 완료 업무", status: "done", actualComplete: "2026-09-01", dbManualRootTemplateId: "qa-delete-template", templateId: "qa-delete-template" },
  ],
  templates: [{ id: "qa-delete-template", name: "삭제 대상 DB", linkedSteps: [] }],
  holidays: [],
  settings: {},
};
const deleteResult = context.removeDbTemplatesV12(["qa-delete-template"]);
assert.equal(deleteResult.removed, 1, "DB 삭제 시 연결된 미완료 수행업무를 삭제해야 합니다.");
assert.equal(deleteResult.preserved, 1, "DB 삭제 시 완료된 과거 이력을 보존해야 합니다.");
assert.equal(context.state.templates.length, 0, "선택한 업무 DB 문서가 삭제되어야 합니다.");
assert.equal(context.state.tasks.length, 1, "완료 이력만 수행업무에 남아야 합니다.");
assert.equal(context.state.tasks[0].archivedSourceDeleted, true, "보존 이력은 삭제된 DB와 분리해 표시해야 합니다.");

context.state = {
  settings: { ganttMonthRangeV13: 3, ganttVisibleCyclesV13: ["monthly", "quarterly", "half"] },
  tasks: [
    { id: "weekly-root", groupId: "weekly-group", step: 1, repeat: { cycle: "weekly" } },
    { id: "weekly-child", groupId: "weekly-group", step: 2, parentSeriesId: "weekly-series", repeat: null },
    { id: "weekly-series-root", groupId: "weekly-group", step: 1, seriesId: "weekly-series", repeat: { cycle: "weekly" } },
    { id: "monthly-root", step: 1, repeat: { cycle: "monthly" } },
    { id: "yearly-root", step: 1, repeat: { cycle: "yearly" } },
    { id: "plain-task", step: 1, repeat: null },
  ],
};
assert.deepEqual(Array.from(context.ganttFilterBoundsV13("2026-09-07")), ["2026-06-07", "2026-12-07"], "간트 범위는 오늘 기준 앞뒤 선택 개월을 함께 적용해야 합니다.");
assert.equal(context.ganttCycleVisibleV13(context.state.tasks[0]), false, "끈 주간 반복업무는 간트에서 제외해야 합니다.");
assert.equal(context.ganttCycleVisibleV13(context.state.tasks[1]), false, "주간 반복업무의 연계 단계도 함께 제외해야 합니다.");
assert.equal(context.ganttCycleVisibleV13(context.state.tasks[3]), true, "켜진 월간 반복업무는 간트에 표시해야 합니다.");
assert.equal(context.ganttCycleVisibleV13(context.state.tasks[4]), true, "필터 대상이 아닌 연간 반복업무는 계속 표시해야 합니다.");
assert.equal(context.ganttCycleVisibleV13(context.state.tasks[5]), true, "비반복 업무는 계속 표시해야 합니다.");
context.state.settings.ganttVisibleCyclesV13.push("weekly");
assert.equal(context.ganttCycleVisibleV13(context.state.tasks[1]), true, "주간 토글을 다시 켜면 연계 단계까지 복원해야 합니다.");

const repeatWithDocument = {
  id: "document-repeat-root",
  name: "반복 공문 업무",
  start: "2026-09-07",
  end: "2026-09-07",
  deadline: "2026-09-07",
  relatedDocumentTitle: "9월 공문",
  checklist: [],
};
const freshDocumentOccurrence = context.cloneOccurrenceV2(repeatWithDocument, "2026-10-07", "document-series", 2, { cycle: "monthly", holidayShift: "keep" });
assert.equal(freshDocumentOccurrence.relatedDocumentTitle, "", "새 반복 회차에는 이전 회차의 공문 제목을 복사하면 안 됩니다.");
const preservedDocumentOccurrence = context.preserveOccurrenceV3(freshDocumentOccurrence, repeatWithDocument);
assert.equal(preservedDocumentOccurrence.relatedDocumentTitle, "9월 공문", "기존 회차를 다시 계산할 때 입력한 공문 제목은 보존해야 합니다.");

for (const marker of ["data-scategory", "data-sowner", "data-sworktype", "data-slimit", "data-scheck", "data-scheckadd"]) {
  assert.ok(html.includes(marker), `업무목록 연계 단계 폼에 ${marker} 입력 항목이 있어야 합니다.`);
}
assert.ok(html.includes("s.name=name.value"), "단계 추가 전 현재 업무명을 즉시 임시 상태에 보존해야 합니다.");
assert.ok(html.includes("steps[i].checklist[j].text=el.value"), "단계 추가 전 현재 체크리스트 입력값을 즉시 임시 상태에 보존해야 합니다.");
assert.ok(html.includes("(x.step||1)>(parent.step||1)"), "중간 단계 수정 시 앞 단계 업무를 삭제 대상으로 잡으면 안 됩니다.");
assert.ok(html.includes('class="step-check-editor root-check-editor-v12"'), "1단계 체크리스트가 후속 단계와 같은 행 구조를 사용해야 합니다.");
assert.ok(html.includes('id="dbDeleteSelected"'), "업무 DB 목록에 선택 삭제 버튼이 있어야 합니다.");
assert.ok(html.includes("bindDbSingleDeleteV12"), "업무 DB 단건 삭제도 연결된 수행업무 정리 규칙을 사용해야 합니다.");
assert.ok(html.includes('id="homeTodayCardV12"'), "HOME에 오늘 날짜 카드가 있어야 합니다.");
assert.ok(!html.includes("api.weatherapi.com"), "외부 날씨 API 호출이 남아 있으면 안 됩니다.");
assert.ok(!html.includes('id="weatherApiKeyV12"'), "날씨 API 키 입력 화면이 남아 있으면 안 됩니다.");
assert.ok(!html.includes("navigator.geolocation"), "앱이 위치 권한을 요청하면 안 됩니다.");
assert.ok(html.includes("bindDrivePhotoAuthorizationV12"), "사진 선택 전에 Drive 권한을 사용자 클릭으로 요청해야 합니다.");
assert.ok(html.includes('id="ganttMonthRangeV13"'), "HOME에 1~12개월 간트 범위 선택기가 있어야 합니다.");
for (const cycle of ["weekly", "monthly", "quarterly", "half"]) {
  assert.ok(html.includes(`data-gantt-cycle-v13="${cycle}"`), `${cycle} 반복업무 간트 토글이 있어야 합니다.`);
}
assert.ok(html.includes("ganttWindowV4=function(){return ganttFilterBoundsV13()}"), "간트 축도 선택한 오늘 전후 범위를 사용해야 합니다.");
assert.ok(html.includes("ganttTasksV13Base(a,b).filter(task=>ganttCycleVisibleV13(task))"), "기간과 반복주기 필터를 한 목록에 함께 적용해야 합니다.");
assert.ok(html.includes('id="relatedDocumentTitleV15"'), "체크리스트 팝업에 선택 입력 가능한 관련 공문 제목 칸이 있어야 합니다.");
assert.ok(html.includes("t.relatedDocumentTitle"), "관련 공문 제목을 업무목록 검색 대상으로 포함해야 합니다.");
assert.ok(html.includes("gantt-menu-fixed-v15"), "모바일 간트 대분류 메뉴를 다른 카드 위에 고정 표시해야 합니다.");
assert.ok(html.includes("touch-action:pan-y"), "모바일 대분류 메뉴가 세로 손가락 스크롤을 허용해야 합니다.");
assert.ok(html.includes("height:calc(100dvh - 16px)"), "모바일 업무 폼 높이는 실제 브라우저 표시영역을 따라야 합니다.");
assert.ok(html.includes("task-form-modal-v15"), "업무 신규작성·수정 모달에 전용 모바일 스크롤 클래스를 적용해야 합니다.");
assert.ok(html.includes("viewport-fit=cover, interactive-widget=resizes-content"), "모바일 안전영역과 키보드 리사이즈를 지원해야 합니다.");
assert.ok(html.includes("function isTaskFormMobileV16()"), "휴대폰과 iPad를 별도로 감지해야 합니다.");
assert.ok(html.includes("navigator.userAgentData?.mobile===true"), "화면 폭 외에 모바일 브라우저 신호를 사용해야 합니다.");
assert.ok(html.includes("/Macintosh/i.test(ua)&&touchPoints>1"), "데스크톱 UA를 쓰는 iPad도 감지해야 합니다.");
assert.ok(html.includes("task-form-wrap-v16.task-form-mobile-v16"), "모바일 업무 폼은 시각 뷰포트 전체를 사용해야 합니다.");
assert.ok(html.includes("grid-template-rows:auto minmax(0,1fr) auto"), "모바일 업무 폼의 머리글·본문·하단 버튼을 분리해야 합니다.");
assert.ok(html.includes("visualViewport?.addEventListener('resize',sync"), "주소창과 키보드 변화 시 폼 크기를 다시 계산해야 합니다.");
assert.ok(html.includes('id="app-v17-mobile-style"'), "앱 전체 모바일 전용 스타일이 있어야 합니다.");
assert.ok(html.includes("grid-template-columns:repeat(6,minmax(0,1fr))"), "모바일 하단 메뉴에 전체 화면 이동 버튼을 표시해야 합니다.");
assert.ok(html.includes("function decorateTaskCardsV17()"), "수행업무 표를 모바일 카드 목록으로 바꿔야 합니다.");
assert.ok(html.includes("function decorateDbCardsV17()"), "업무 DB 표를 모바일 카드 목록으로 바꿔야 합니다.");
assert.ok(html.includes("word-break:keep-all"), "모바일 업무명이 한 글자씩 쪼개지지 않아야 합니다.");
assert.ok(html.includes('grid-template-areas:"title title" "category owner"'), "모바일 카드에서 업무명이 전체 너비를 사용해야 합니다.");
assert.ok(html.includes("function decorateHistoryCardsV17()"), "변경이력도 모바일 카드로 표시해야 합니다.");
assert.ok(html.includes("ensureMobileAccountCardV17"), "모바일 설정 화면에 계정과 로그아웃 조작을 제공해야 합니다.");
assert.ok(html.includes(".mobile-ui-v17 .calendar-card-v3 .calendar{min-width:700px"), "모바일 달력은 글자가 찌그러지지 않도록 가로 스크롤해야 합니다.");
assert.ok(html.includes('id="app-v18-completion-mobile-style"'), "모바일 완료 흐름 전용 스타일이 있어야 합니다.");
assert.ok(html.includes(".mobile-ui-v17 .app-modal-wrap-v18{z-index:3200"), "팝업이 모바일 하단 메뉴보다 위에 표시되어야 합니다.");
assert.ok(html.includes("app-modal-open-v18 .side{visibility:hidden"), "팝업이 열리면 중복되는 하단 메뉴를 숨겨야 합니다.");
assert.ok(html.includes("height:auto!important;max-height:calc(100dvh - 16px)"), "짧은 체크리스트 팝업에 불필요한 빈 공간을 만들지 않아야 합니다.");
assert.ok(html.includes("아래 ‘업무 완료’를 눌러 마무리하세요"), "체크 완료와 업무 완료가 별도 단계임을 안내해야 합니다.");
assert.ok(html.includes("await persistTaskStatusV18(t,'done',{closeAfter:true})"), "체크리스트 완료 버튼이 공통 상태 저장 경로를 사용해야 합니다.");
assert.ok(html.includes("const renderTaskTableV18Base=renderTaskTable"), "업무목록 상태 변경도 공통 완료 저장 경로로 다시 연결해야 합니다.");
assert.ok(html.includes('id="app-v21-navy-dashboard-style"'), "A 구조와 B 네이비 색상의 V21 디자인 계층이 있어야 합니다.");
assert.ok(html.includes('body[data-v7-theme="navy"]'), "네이비 프로 팔레트를 전역 테마로 제공해야 합니다.");
assert.ok(html.includes('grid-template-columns:220px minmax(0,1fr)'), "PC에서는 왼쪽 업무 내비게이션과 본문 구조를 사용해야 합니다.");
assert.ok(html.includes('<button type="button" class="v21-side-brand" id="v21SideBrand"'), "왼쪽 제품 식별 영역은 HOME 이동 버튼이어야 합니다.");
assert.ok(html.includes("sideBrand.onclick=()=>showPage('homePage')"), "업무관리 로고를 누르면 HOME으로 이동해야 합니다.");
assert.ok(html.includes('id="homeHeroV21"'), "HOME에 오늘 업무와 월간 진행률을 묶은 요약 영역이 있어야 합니다.");
assert.ok(html.includes('id="homeHeroAddTaskV21"'), "대시보드 요약에서 업무 작성으로 바로 이동할 수 있어야 합니다.");
assert.ok(html.includes("body.app-v21 .cloud-gate"), "로그인 화면도 네이비 제품 톤과 일치해야 합니다.");
assert.ok(html.includes("body.app-v21 .home-hero-v21{"), "요약 카드는 공통 흰색 카드보다 높은 우선순위로 네이비 배경을 유지해야 합니다.");
assert.ok(html.includes("state.settings.designV21Applied=true"), "기존 사용자에게 네이비 디자인을 한 번만 기본 적용해야 합니다.");
assert.ok(html.includes("body.app-v21.mobile-ui-v17 .home-hero-v21"), "모바일에서 요약 영역을 한 열 구조로 재배치해야 합니다.");
assert.ok(html.includes("body.app-v21.mobile-ui-v17 .side"), "V21에서도 모바일 고정 하단 메뉴 스타일을 유지해야 합니다.");
assert.ok(html.includes("category:$('#dfCat')?.value||t.category"), "새 연계 단계는 현재 1단계 대분류를 이어받아야 합니다.");
assert.ok(html.includes("owner:$('#dfOwner')?.value||t.owner||''"), "새 연계 단계는 현재 1단계 담당자를 이어받아야 합니다.");
assert.ok(html.includes("category:rootCategory,owner:$('#dfOwner')?.value||t.owner||'',name,cycle:cyc"), "업무 DB 저장 시 담당자를 첫 저장 경로에서 함께 보존해야 합니다.");
assert.ok(!html.includes("const beforeIds=new Set(state.templates.map(x=>x.id))"), "업무 DB 한 번 저장으로 클라우드 저장을 두 번 실행하면 안 됩니다.");
assert.ok(html.includes("repairLinkedInheritanceV23"), "기존 기본 대분류·미지정 담당자 오류를 한 번 복구해야 합니다.");
assert.ok(html.includes('id="addMethodFile"'), "업무 DB 폼에 양식 파일 첨부 입력이 있어야 합니다.");
assert.ok(html.includes("makeMethodFileBlock"), "업무 DB 파일을 Drive 블록으로 생성해야 합니다.");
assert.ok(html.includes("data-drive-download"), "업무 DB 상세에서 첨부파일을 내려받을 수 있어야 합니다.");
assert.ok(html.includes('id="app-v23-theme-drive-style"'), "V23 테마·Drive 첨부 스타일이 있어야 합니다.");
for (const theme of ["navy","mint","peach","lavender","sky","cream"]) {
  assert.ok(html.includes(`body.app-v21[data-v7-theme="${theme}"]`), `${theme} 톤이 사이드바·요약 카드 색상까지 정의해야 합니다.`);
}
assert.ok(html.includes("background:linear-gradient(122deg,var(--v23-hero-start)"), "HOME 요약 카드는 선택한 디자인 톤 변수를 사용해야 합니다.");

assert.match(
  html,
  /next==='done'&&t\.checklist\?\.length&&!t\.checklist\.every\(c=>c\.done\)/,
  "체크리스트 미완료 상태의 완료 변경 차단 로직이 있어야 합니다.",
);
assert.match(
  html,
  /renderGantt\(ganttTasks,a,b\);renderCalendar\(monthTasks,ca,cb\)/,
  "HOME 갱신 시 간트와 달력이 함께 렌더링되어야 합니다.",
);
assert.match(
  html,
  /첫 업무 날짜를 이동하고 연계업무를 다시 계산했습니다/,
  "1단계 인라인 날짜 변경 후 연계 재계산 경로가 있어야 합니다.",
);

console.log("PASS v10 business regression");
