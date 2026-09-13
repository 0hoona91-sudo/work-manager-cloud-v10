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

const context = vm.createContext({
  console,
  Date,
  Number,
  String,
  Array,
  Object,
  Math,
  todayISO: () => "2026-09-13",
  addDays: () => { throw new Error("당일 마무리에서 날짜 계산을 호출하면 안 됩니다."); },
  addBusinessDays: () => { throw new Error("당일 마무리에서 근무일 계산을 호출하면 안 됩니다."); },
  shiftWorkday: () => { throw new Error("당일 마무리에서 휴일 보정을 호출하면 안 됩니다."); },
});
vm.runInContext(`${extractLastFunction("taskEndRuleV32")}\n${extractLastFunction("taskWorkTypeV32")}\n${extractLastFunction("calcEnd")}`, context);

assert.deepEqual(
  JSON.parse(JSON.stringify(context.taskEndRuleV32({ start: "2026-09-13", end: "2026-09-13" }))),
  { type: "same", date: "2026-09-13", days: 0, includeHolidays: false, shift: "keep" },
  "같은 날인 기존 업무는 당일 마무리로 안전하게 표시해야 합니다.",
);
assert.equal(context.taskEndRuleV32({ start: "2026-09-13", end: "2026-09-18" }).type, "date", "모드 메타데이터가 없는 기간업무는 기존 종료일을 보존하는 직접 날짜로 표시해야 합니다.");
assert.deepEqual(
  JSON.parse(JSON.stringify(context.taskEndRuleV32({ start: "2026-09-13", endRule: { type: "after", days: 4, includeHolidays: true, shift: "next" } }))),
  { type: "after", date: "2026-09-13", days: 4, includeHolidays: true, shift: "next" },
  "저장된 N일 종료 규칙을 그대로 다시 열어야 합니다.",
);
assert.equal(context.taskEndRuleV32({ start: "2026-09-13", end: "2026-09-20", endType: "after", endAfterDays: 7 }).type, "after", "기존 종료 모드 별칭도 읽어야 합니다.");
assert.equal(context.calcEnd("2026-09-13", { type: "same", shift: "prev" }), "2026-09-13", "당일 마무리는 휴일 보정 없이 시작일과 같아야 합니다.");
assert.equal(context.taskWorkTypeV32({}, []), "single", "연계 단계가 없으면 단일업무여야 합니다.");
assert.equal(context.taskWorkTypeV32({}, ["", " 후속 업무 "]), "linked", "이름이 있는 연계 단계가 있으면 연계업무여야 합니다.");
assert.equal(context.taskWorkTypeV32({ link: { parentId: "root" } }, []), "linked", "기존 연계 자식 업무는 연계업무로 유지해야 합니다.");

const taskFormSource = extractLastFunction("taskFormHtml");
assert.doesNotMatch(taskFormSource, /task-kind-field-v20|<label>업무 형태<\/label>/, "수행업무 최상위 폼에서 업무 형태 선택을 노출하면 안 됩니다.");
assert.match(taskFormSource, /task-kind-state-v32[\s\S]*name="taskKind"[\s\S]*value="single"[\s\S]*value="linked"/, "기존 저장 경로용 업무 형태 상태는 숨김으로 유지해야 합니다.");
for (const marker of ["tfEndModeV32", "당일 마무리", "일 이후까지", "tfEndDate", "tfAfterDays", "tfIncludeHolidaysRowV32", "tfHolidayShiftRowV32"]) {
  assert.ok(taskFormSource.includes(marker), `종료일 UI에 ${marker} 요소가 있어야 합니다.`);
}
assert.match(taskFormSource, /id="tfEndType" hidden/, "기존 계산·저장 경로용 종료 유형은 숨김 상태로 유지해야 합니다.");
const endUiSource = extractLastFunction("setupTaskEndUiV32");
assert.match(endUiSource, /dateField\.hidden=false[\s\S]*afterField\.hidden=false/, "비선택 종료 방식의 라디오 설명은 숨기지 않아야 합니다.");
assert.match(endUiSource, /input\.disabled=mode!=='date'[\s\S]*input\.disabled=mode!=='after'/, "비선택 종료 방식은 설명을 유지하고 입력만 비활성화해야 합니다.");

const dbFormSource = extractLastFunction("openDbForm");
assert.ok(dbFormSource.includes("자동생성 종료일 (비워두면 종료 없이 계속 생성)"), "업무DB 자동생성 종료일 설명을 간결하게 표시해야 합니다.");
assert.doesNotMatch(dbFormSource, /id="addMethodFile"|makeMethodFileBlock\(f/, "업무수행방법에서 신규 일반 파일 업로더를 제공하면 안 됩니다.");
assert.match(dbFormSource, /b\.type==='file'[\s\S]*methodFileHtmlV23/, "기존 수행방법 파일 블록은 계속 표시해야 합니다.");
assert.match(dbFormSource, /id="addMethodText"[\s\S]*id="addMethodImage"[\s\S]*id="addTemplateAttachmentV30"/, "수행방법 글·사진과 관련자료 업로더를 구분해 유지해야 합니다.");
assert.doesNotMatch(html, /폼 바깥 회색 영역에서도|자동 생성되는 수행업무의 기본 담당자입니다\./, "요청한 업무DB 설명 문구를 제거해야 합니다.");

const homeMarkup = html.slice(html.indexOf('<section id="homePage"'), html.indexOf('<section id="taskListPage"'));
const dbMarkup = html.slice(html.indexOf('<section id="dbPage"'), html.indexOf('<section id="holidayPage"'));
assert.match(homeMarkup, /home-annual-date-v32[\s\S]*id="openAnnualPlanV31"[\s\S]*id="homeTodayCardV12"/, "연간 업무 버튼은 HOME 날짜 영역 바로 왼쪽에 있어야 합니다.");
assert.doesNotMatch(dbMarkup, /openAnnualPlanV31/, "업무DB 화면에는 연간 업무 진입점을 중복 배치하면 안 됩니다.");
const annualUiSource = extractLastFunction("ensureAnnualPlanUiV31");
assert.match(annualUiSource, /homeAnnualDateV32[\s\S]*homeTodayCardV12/, "기존 연간 업무 버튼을 HOME 날짜 묶음에서 재사용해야 합니다.");
assert.doesNotMatch(annualUiSource, /db-register-tools/, "연간 업무 버튼을 업무DB 도구 영역에 다시 넣으면 안 됩니다.");
assert.match(html, /id="annualBackV31"[^>]*>HOME으로/, "연간 업무 화면의 복귀 동작을 HOME으로 안내해야 합니다.");
assert.match(html, /annualBackV31'\)\.onclick=\(\)=>showPage\('homePage'\)/, "연간 업무 뒤로가기는 HOME으로 돌아가야 합니다.");

assert.ok((html.match(/endRule:\{\.\.\.rule\}/g) || []).length >= 4, "일반·반복·DB 자동/수동 수행업무 저장 경로가 종료 규칙을 보존해야 합니다.");
assert.match(html, /Object\.prototype\.hasOwnProperty\.call\(work,'workType'\)/, "기존 workType 필드가 있는 수행업무만 호환 갱신해야 합니다.");
assert.match(html, /syncLinkedStepsForEditedV2\(t,\[\]\);t\.groupId=null/, "연계 단계를 모두 지운 저장은 기존 후속 단계만 정리하고 단일업무로 돌아가야 합니다.");

const v32Source = html.slice(html.lastIndexOf("APP V32 — input form / annual entry UX cleanup"));
assert.doesNotMatch(v32Source, /getDocs|onSnapshot|setDoc|updateDoc|runTransaction|saveState|createFileBlock|ensureAutoSchedules/, "UX 정리 계층은 Firestore·Drive·Rolling 호출을 추가하면 안 됩니다.");
assert.match(html, /ROLLING_AUTO_MONTHS_V24=12/, "Rolling 12개월 기능을 유지해야 합니다.");
assert.match(html, /APP V29 — impact preview \/ trash \/ template versions/, "휴지통과 버전 기능을 유지해야 합니다.");
assert.match(html, /APP V30 — template attachments \/ clone draft/, "관련자료와 업무DB 복제 기능을 유지해야 합니다.");
assert.match(html, /APP V31 — annual plan \/ category \/ month matrix/, "기존 연간 업무 계산·화면 기능을 유지해야 합니다.");
assert.match(html, /@media\(max-width:620px\)[\s\S]*home-annual-date-v32\{align-items:stretch;flex-direction:column\}/, "모바일 HOME 버튼과 날짜 영역은 가로 넘침 없이 세로 배치해야 합니다.");
assert.match(serviceWorker, /work-manager-v10-shell-2026-09-13-36/, "9.5단계 서비스워커 캐시 버전을 사용해야 합니다.");
assert.match(html, /navigator\.serviceWorker\.register\('\.\/sw\.js\?v=20260913-36'\)/, "9.5단계 서비스워커 URL을 등록해야 합니다.");

console.log("PASS stage 9.5 task/database input UX cleanup regression");
