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

const scheduleContext = vm.createContext({
  fmtDate(value) { return value ? value.slice(5).replace("-", "/") : ""; },
});
vm.runInContext(extractLastFunction("compactTaskScheduleV26"), scheduleContext);
assert.equal(scheduleContext.compactTaskScheduleV26({ start: "2026-09-12", end: "2026-09-12" }), "09/12", "단일 일정은 날짜 하나만 보여야 합니다.");
assert.equal(scheduleContext.compactTaskScheduleV26({ start: "2026-09-12", end: "2026-09-16" }), "09/12 ~ 09/16", "기간 일정은 시작일과 종료일을 보여야 합니다.");
assert.equal(scheduleContext.compactTaskScheduleV26({}), "일정 미정", "날짜 없는 업무도 안전하게 표시해야 합니다.");

assert.match(html, /id="app-v26-mobile-compact-style"/, "4단계 모바일 전용 스타일이 있어야 합니다.");
assert.match(html, /\.mobile-ui-v17 #taskTableBody tr\{[\s\S]*grid-template-columns:44px minmax\(0,1fr\)/, "모바일 업무목록은 체크 영역과 본문으로 압축해야 합니다.");
assert.match(html, /#taskTableBody td:nth-child\(2\),[\s\S]*#taskTableBody td:nth-child\(n\+5\)\{display:none!important\}/, "모바일 업무목록의 상세 메타정보를 숨겨야 합니다.");
assert.match(html, /#taskTableBody td:nth-child\(3\)[\s\S]*border-radius:999px/, "대분류는 모바일 배지로 보여야 합니다.");
assert.match(html, /mobile-compact-schedule-v26/, "업무명 아래에 컴팩트 일정을 표시해야 합니다.");
assert.match(html, /#taskTableBody td:nth-child\(1\) input,[\s\S]*width:22px!important;height:22px!important/, "체크박스 자체 크기를 확보해야 합니다.");

assert.match(html, /\.mobile-ui-v17 #dbTableBody tr\{[\s\S]*grid-template-columns:44px minmax\(0,1fr\) auto/, "모바일 업무DB도 컴팩트 목록으로 바꿔야 합니다.");
for (const index of [5, 7, 8, 9]) assert.match(html, new RegExp(`#dbTableBody td:nth-child\\(${index}\\)`), `업무DB 상세 열 ${index}은 모바일 기본 목록에서 제외해야 합니다.`);
assert.match(html, /#dbTableBody td:nth-child\(6\)\{grid-area:cycle/, "업무DB 반복주기는 유지해야 합니다.");
assert.match(html, /#dbTableBody td:nth-child\(10\) \.btn[\s\S]*min-height:44px/, "업무DB 수정 버튼의 터치 높이를 유지해야 합니다.");

assert.match(html, /\.mobile-ui-v17 \.gantt-card-v3:not\(\.mobile-gantt-open-v26\)\{display:none!important\}/, "모바일 간트는 기본 접힘이어야 합니다.");
assert.match(html, /button\.textContent=open\?'간트 접기':'간트 보기'/, "간트 버튼 문구가 펼침 상태를 알려야 합니다.");
assert.match(html, /button\.setAttribute\('aria-expanded',String\(open\)\)/, "간트 펼침 상태를 접근성 속성으로 제공해야 합니다.");
assert.match(html, /if\(window\.v26MobileGanttOpen\)requestAnimationFrame\(\(\)=>\$\('#ganttSelected'\)\?\.click\(\)\)/, "펼친 간트는 기존 선택기간 이동 기능을 재사용해야 합니다.");
assert.match(html, /\.mobile-gantt-toggle-v26\{display:none\}[\s\S]*\.mobile-ui-v17 \.mobile-gantt-toggle-v26\{/, "토글은 기존 모바일 판정 화면에만 나타나야 합니다.");

const rowBinding = extractLastFunction("bindCompactRowOpenV26");
assert.match(rowBinding, /firstCell\?\.contains\(event\.target\)/, "체크박스 터치 영역은 별도로 처리해야 합니다.");
assert.match(rowBinding, /event\.target\.closest\('input,button,select,a,label'\)/, "체크박스와 행 열기 동작이 충돌하면 안 됩니다.");
assert.match(rowBinding, /row\.querySelector\(selector\)\?\.click\(\)/, "모바일 행 여백을 눌러도 기존 상세 진입을 재사용해야 합니다.");

const v26Sources = [
  "compactTaskScheduleV26",
  "bindCompactRowOpenV26",
  "decorateCompactTaskRowsV26",
  "decorateCompactDbRowsV26",
  "applyMobileGanttStateV26",
  "ensureMobileGanttToggleV26",
  "syncMobileLayoutV26",
].map(extractLastFunction).join("\n");
assert.doesNotMatch(v26Sources, /\bsaveState\b|\bonSnapshot\b|\bgetDocs\b|\bsetDoc\b|\bupdateDoc\b/, "4단계 UI 코드가 Firestore read/write를 추가하면 안 됩니다.");

assert.match(html, /const renderTaskTableV26Base=renderTaskTable;\s*renderTaskTable=function\(\)\{const result=renderTaskTableV26Base\(\);decorateCompactTaskRowsV26\(\);return result\}/, "기존 업무 렌더를 한 번만 재사용해야 합니다.");
assert.match(html, /const renderDbTableV26Base=renderDbTable;\s*renderDbTable=function\(\)\{const result=renderDbTableV26Base\(\);decorateCompactDbRowsV26\(\);return result\}/, "기존 업무DB 렌더를 한 번만 재사용해야 합니다.");
assert.match(html, /taskListVisibleV6[\s\S]*taskStatusFilter[\s\S]*taskListCategories/, "기존 검색·상태·대분류 필터 경로를 유지해야 합니다.");
assert.match(html, /HOME_FOCUS_META_V25/, "3단계 HOME 요약 기능을 유지해야 합니다.");
assert.match(html, /ROLLING_AUTO_MONTHS_V24=12/, "Rolling 12개월 기능을 유지해야 합니다.");
assert.match(serviceWorker, /work-manager-v10-shell-2026-09-12-29/, "4단계 배포 캐시 버전이어야 합니다.");

console.log("PASS mobile compact lists and collapsed HOME gantt regression");
