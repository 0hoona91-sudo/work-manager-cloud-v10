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
  "periodFromDate",
  "monthsForTemplate",
  "templateDateForMonth",
  "v5MonthStart",
  "v5MaxDate",
  "v5MinDate",
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
  "stageSourceV10",
  "initialStageScheduleV10",
  "createManualDbChainV10",
  "isCanonicalDbKeyV9",
  "dedupeGeneratedKeysV9",
  "taskStepChecksV11",
];
for (const name of functions) vm.runInContext(extractLastFunction(name), context);

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

for (const marker of ["data-scategory", "data-sowner", "data-sworktype", "data-slimit", "data-scheck", "data-scheckadd"]) {
  assert.ok(html.includes(marker), `업무목록 연계 단계 폼에 ${marker} 입력 항목이 있어야 합니다.`);
}
assert.ok(html.includes("s.name=name.value"), "단계 추가 전 현재 업무명을 즉시 임시 상태에 보존해야 합니다.");
assert.ok(html.includes("steps[i].checklist[j].text=el.value"), "단계 추가 전 현재 체크리스트 입력값을 즉시 임시 상태에 보존해야 합니다.");

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

console.log("PASS v10 business regression: 28 assertions");
