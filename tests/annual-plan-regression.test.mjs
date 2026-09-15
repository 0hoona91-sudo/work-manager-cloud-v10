import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const serviceWorker = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
for (const [index, match] of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].entries()) {
  new vm.Script(match[1], { filename: `index-inline-${index + 1}.js` });
}

function extractLastFunction(name) {
  const matcher = new RegExp(`function\\s+${name}\\s*\\(`, "g");
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
const state = { templates: [], tasks: [], owners: ["담당자"], holidays: [], settings: { categoryColors: {} } };
function isHoliday(value) {
  const date = dateOf(value);
  return date.getDay() === 0 || date.getDay() === 6 || state.holidays.some(item => item.date === value);
}
function shiftWorkday(value, direction = "next") {
  if (direction === "keep" || !isHoliday(value)) return value;
  const date = dateOf(value);
  const step = direction === "prev" ? -1 : 1;
  for (let count = 0; count < 40; count += 1) {
    date.setDate(date.getDate() + step);
    const next = iso(date);
    if (!isHoliday(next)) return next;
  }
  return value;
}
const sandbox = {
  Date, String, Number, Array, Object, Map, Set, Math, JSON, console,
  state,
  window: { cloudSync: { stableTaskId: key => `stable-${String(key).replace(/[^a-z0-9]/gi, "-")}` } },
  dateOf, iso, addDays, shiftWorkday,
  endOfMonth(year, month) { return iso(new Date(year, month, 0, 12)); },
  v5MaxDate(a, b) { return !a ? b : !b ? a : a > b ? a : b; },
  v5MinDate(a, b) { return !a ? b : !b ? a : a < b ? a : b; },
  v5MonthStart(value) { return `${String(value).slice(0, 7)}-01`; },
  stableGeneratedTaskId(key) { return sandbox.window.cloudSync.stableTaskId(key); },
  stableGeneratedCheckId(taskId, index) { return `${taskId}-c${index + 1}`; },
  periodFromDate(value) { return String(value).slice(0, 7); },
  fmtDate(value) { return value ? String(value).replaceAll("-", "/") : "-"; },
};
const context = vm.createContext(sandbox);
for (const name of [
  "templatePeriodLabel",
  "monthsForTemplate",
  "templateDateForMonth",
  "templateOccurrenceSpecsV5",
  "taskFromDbTemplateV5",
  "annualPlanEntriesV31",
  "annualRepeatLabelV31",
  "annualOccurrenceTextV31",
  "annualMatrixCountV31",
]) vm.runInContext(extractLastFunction(name), context);

function template(overrides = {}) {
  return {
    id: "tpl-monthly",
    category: "소방",
    name: "월간 점검",
    owner: "담당자",
    autoSchedule: true,
    activeFrom: "2026-01-01",
    activeUntil: "",
    cycle: "monthly",
    cycleMonths: [],
    quarter: 1,
    half: "first",
    weekdays: [3],
    weekday: 3,
    dayRule: "exact",
    exactDay: 4,
    holidayShift: "keep",
    durationDays: 2,
    deadlineOffset: 3,
    checklist: [],
    ...overrides,
  };
}

let entries = context.annualPlanEntriesV31(2026, [template()]);
assert.equal(entries.length, 12, "매월 업무DB는 해당 연도 12개월에 한 번씩 표시해야 합니다.");
assert.deepEqual(Array.from(entries, entry => entry.month), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
assert.equal(entries[0].occurrences[0].start, "2026-01-04", "기존 반복일 계산의 시작일을 사용해야 합니다.");
assert.equal(entries[0].occurrences[0].end, "2026-01-06", "기존 durationDays 계산을 사용해야 합니다.");
assert.equal(entries[0].occurrences[0].deadline, "2026-01-07", "기존 deadlineOffset 계산을 사용해야 합니다.");

entries = context.annualPlanEntriesV31(2026, [template({ id: "tpl-weekly", name: "주간 순회", cycle: "weekly", weekdays: [1, 4], activeFrom: "2026-09-01", activeUntil: "2026-09-30", holidayShift: "keep" })]);
assert.equal(entries.length, 1, "주간업무는 같은 달에 업무DB 한 종류로 요약해야 합니다.");
assert.equal(entries[0].occurrences.length, 8, "주간업무의 실제 예정 회차는 기존 계산 결과를 모두 유지해야 합니다.");
assert.equal(context.annualMatrixCountV31(entries, 9, "소방"), 1, "월×대분류 건수는 회차가 아니라 업무DB 종류 수여야 합니다.");
assert.match(context.annualRepeatLabelV31(entries[0].template), /매주 월\/목요일/, "복수 요일을 사람이 읽기 쉽게 표시해야 합니다.");

entries = context.annualPlanEntriesV31(2026, [template({ id: "tpl-months", cycleMonths: [3, 6, 9, 12] })]);
assert.deepEqual(Array.from(entries, entry => entry.month), [3, 6, 9, 12], "특정 월 업무는 설정된 월에만 표시해야 합니다.");

entries = context.annualPlanEntriesV31(2026, [template({ id: "tpl-from", activeFrom: "2026-07-15", exactDay: 20 })]);
assert.deepEqual(Array.from(entries, entry => entry.month), [7, 8, 9, 10, 11, 12], "activeFrom 이전 월은 제외해야 합니다.");
entries = context.annualPlanEntriesV31(2026, [template({ id: "tpl-until", activeUntil: "2026-06-30" })]);
assert.deepEqual(Array.from(entries, entry => entry.month), [1, 2, 3, 4, 5, 6], "activeUntil 이후 월은 제외해야 합니다.");

entries = context.annualPlanEntriesV31(2026, [template({ id: "tpl-quarter", cycle: "quarterly", cycleMonths: [], quarter: 2 })]);
assert.deepEqual(Array.from(entries, entry => entry.month), [6], "기존 분기 기준월 계산을 재사용해야 합니다.");
entries = context.annualPlanEntriesV31(2026, [template({ id: "tpl-half", cycle: "half", cycleMonths: [], half: "second" })]);
assert.deepEqual(Array.from(entries, entry => entry.month), [12], "기존 반기 기준월 계산을 재사용해야 합니다.");

entries = context.annualPlanEntriesV31(2026, [template({ id: "tpl-holiday", cycleMonths: [9], exactDay: 13, holidayShift: "next" })]);
assert.equal(entries[0].occurrences[0].start, "2026-09-14", "holidayShift는 기존 근무일 이동 계산과 같아야 합니다.");

entries = context.annualPlanEntriesV31(2026, [template({ id: "tpl-off", autoSchedule: false }), template({ id: "tpl-none", cycle: "none" })]);
assert.equal(entries.length, 0, "자동일정 계산 대상이 아닌 업무DB의 일정을 임의 생성하면 안 됩니다.");

assert.match(html, /home-annual-date-v32[\s\S]*id="openAnnualPlanV31"[\s\S]*id="homeTodayCardV12"/, "HOME 날짜 왼쪽에 연간 업무 진입점이 있어야 합니다.");
assert.match(html, /data-annual-view-v31="months"[\s\S]*data-annual-view-v31="categories"[\s\S]*data-annual-view-v31="matrix"/, "월별·대분류별·월×대분류 보기를 제공해야 합니다.");
assert.match(html, /data-annual-db-v31/, "연간표 업무명에서 기존 업무DB 상세로 이동할 수 있어야 합니다.");
assert.match(html, /건수는 수행업무 회차 수가 아니라 해당 월에 발생하는 업무DB 종류 수/, "월×대분류 건수 기준을 화면에 명시해야 합니다.");
assert.match(html, /@media\(max-width:760px\)[\s\S]*annual-month-grid-v31[\s\S]*grid-template-columns:minmax\(0,1fr\)/, "모바일은 월별 목록을 한 열로 표시해야 합니다.");
assert.match(html, /annual-matrix-scroll-v31\{overflow:auto/, "모바일 월×대분류 표는 필요한 경우 가로 스크롤을 허용해야 합니다.");

const annualSource = html.slice(html.lastIndexOf("APP V31 — annual plan / category / month matrix"), html.lastIndexOf("APP V32 — input form / annual entry UX cleanup"));
assert.doesNotMatch(annualSource, /saveState|onSnapshot|getDocs|getDoc|setDoc|updateDoc|runTransaction|collection\s*\(|state\.tasks|syncTemplateSchedule|ensureAutoSchedules/, "연간계획은 저장·tasks 조회·Rolling 실행 경로를 호출하면 안 됩니다.");
assert.match(extractLastFunction("annualPlanEntriesV31"), /templateOccurrenceSpecsV5[\s\S]*taskFromDbTemplateV5/, "기존 반복일과 업무 일정 계산 함수를 재사용해야 합니다.");
assert.match(html, /ROLLING_AUTO_MONTHS_V24=12/, "Rolling 12개월 기능을 유지해야 합니다.");
assert.match(html, /APP V30 — template attachments \/ clone draft/, "자료 첨부와 업무DB 복제를 유지해야 합니다.");
assert.match(html, /APP V29 — impact preview \/ trash \/ template versions/, "휴지통과 버전복원을 유지해야 합니다.");
assert.match(html, /HOME_FOCUS_META_V25/, "HOME 요약을 유지해야 합니다.");
assert.match(serviceWorker, /work-manager-v10-shell-2026-09-15-38/, "최신 Cloud UX 서비스워커 캐시를 사용해야 합니다.");
assert.match(html, /navigator\.serviceWorker\.register\('\.\/sw\.js\?v=20260915-38'\)/, "최신 Cloud UX 서비스워커 URL을 등록해야 합니다.");

console.log("PASS stage 9 annual plan and category matrix regression");
