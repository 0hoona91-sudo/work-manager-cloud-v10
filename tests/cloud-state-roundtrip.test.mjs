import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { TextEncoder } from "node:util";

const source = fs.readFileSync(new URL("../js/cloud-sync.js", import.meta.url), "utf8");

function extractFunction(name) {
  const matcher = new RegExp(`function\\s+${name}\\s*\\(`, "g");
  let start = null;
  for (let match; (match = matcher.exec(source));) start = match.index;
  assert.notEqual(start, null, `${name} 함수를 찾을 수 없습니다.`);
  const signatureEnd = source.indexOf(") {", start);
  assert.notEqual(signatureEnd, -1, `${name} 함수 시그니처를 찾을 수 없습니다.`);
  const open = signatureEnd + 2;
  let depth = 0;
  let mode = "code";
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
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
      else if (
        (mode === "single" && char === "'") ||
        (mode === "double" && char === '"') ||
        (mode === "template" && char === "`")
      ) mode = "code";
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
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${name} 함수가 닫히지 않았습니다.`);
}

const collections = [
  "tasks",
  "checklistItems",
  "taskLinks",
  "templates",
  "linkedRules",
  "manualBlocks",
  "owners",
  "categories",
  "holidays",
  "settings",
  "meta",
  "generatedKeys",
];
const sandbox = {
  console,
  Map,
  Set,
  Object,
  JSON,
  String,
  TextEncoder,
  SCHEMA_VERSION: 11,
  DATA_COLLECTIONS: collections,
  LIVE_COLLECTIONS: [...collections, "changeLogs"],
  btoa(value) {
    return Buffer.from(value, "binary").toString("base64");
  },
  deleteField() {
    return Symbol.for("firestore-delete-field");
  },
};
const context = vm.createContext(sandbox);
for (const name of [
  "makeRecordMaps",
  "clone",
  "plain",
  "docId",
  "stableKeyId",
  "mapClone",
  "replaceState",
  "cleanBlock",
  "omit",
  "serializeState",
  "deserializeState",
  "cloudHasData",
  "changedFields",
  "diffMaps",
  "patchFor",
  "mergeById",
]) vm.runInContext(extractFunction(name), context);
context.shadowMaps = context.makeRecordMaps();
context.shadowMaps.generatedKeys.set("auto-old-lock", { generatedKey: "old:key", taskId: "old-task" });

const state = {
  tasks: [{
    id: "task-1",
    category: "시설",
    name: "점검",
    owner: "홍길동",
    status: "planned",
    start: "2026-09-08",
    end: "2026-09-08",
    deadline: "2026-09-08",
    generatedKey: "dbauto:tpl-1:M:2026-09",
    checklist: [{ id: "check-1", text: "현장 확인", done: false }],
    link: { parentId: "task-0", dynamic: true, basis: "end", startOffset: 1, startMode: "business" },
  }],
  templates: [{
    id: "tpl-1",
    category: "시설",
    name: "월간 점검",
    owner: "홍길동",
    cycle: "monthly",
    checklist: ["사전 준비"],
    linkedSteps: [{
      name: "결과 보고",
      category: "행정",
      owner: "김담당",
      checklist: ["보고 확인"],
      startOffset: 1,
      startMode: "business",
      methodBlocks: [{ id: "step-image", type: "image", driveFileId: "drive-step", data: "blob:must-not-save" }],
    }],
    methodBlocks: [{ id: "root-image", type: "image", driveFileId: "drive-root", objectUrl: "blob:local-only", data: "data:image/png;base64,local-only" }],
    photos: ["legacy-photo"],
    method: "legacy method",
  }],
  holidays: [{ id: "holiday-1", date: "2026-09-07", reason: "회사휴무" }],
  categories: ["시설", "행정"],
  owners: ["홍길동", "김담당"],
  selectedCategories: ["시설"],
  changeLogs: [],
  settings: {
    homeView: "gantt",
    categoryColors: { 시설: "#75B798", 행정: "#F1B77A" },
    ownerProfiles: {
      홍길동: { mark: "🔧", color: "#CDEFD8" },
      김담당: { mark: "📋", color: "#FFE0C2" },
    },
    holidayApiKey: "local-secret-that-must-not-sync",
  },
};

const maps = context.serializeState(state);
assert.equal(maps.tasks.size, 1);
assert.equal(maps.checklistItems.size, 3, "업무·DB·연계단계 체크리스트가 각각 문서가 되어야 합니다.");
assert.equal(maps.taskLinks.size, 1);
assert.equal(maps.templates.size, 1);
assert.equal(maps.linkedRules.size, 1);
assert.equal(maps.manualBlocks.size, 2);
assert.equal(maps.categories.size, 2);
assert.equal(maps.owners.size, 2);
assert.equal(maps.holidays.size, 1);
assert.equal(maps.settings.size, 1);
assert.equal(maps.meta.size, 1);
assert.equal(maps.generatedKeys.size, 2, "현재 자동생성 키와 과거 잠금키를 함께 보존해야 합니다.");

const taskDoc = maps.tasks.get("task-1");
assert.ok(!Object.hasOwn(taskDoc, "checklist"), "업무 문서에 체크리스트 배열을 중복 저장하면 안 됩니다.");
assert.ok(!Object.hasOwn(taskDoc, "link"), "업무 문서에 연계규칙을 중복 저장하면 안 됩니다.");
for (const block of maps.manualBlocks.values()) {
  assert.ok(!Object.hasOwn(block, "data"), "base64/blob 사진 데이터를 Firestore에 저장하면 안 됩니다.");
  assert.ok(!Object.hasOwn(block, "objectUrl"), "로컬 object URL을 Firestore에 저장하면 안 됩니다.");
  assert.ok(block.driveFileId, "사진 블록에는 Drive 파일 ID만 남아야 합니다.");
}
const settingsDoc = maps.settings.get("main");
assert.ok(!Object.hasOwn(settingsDoc, "holidayApiKey"), "외부 API 키를 Firestore에 동기화하면 안 됩니다.");
assert.ok(!Object.hasOwn(settingsDoc, "categoryColors"));
assert.ok(!Object.hasOwn(settingsDoc, "ownerProfiles"));
assert.equal(maps.meta.get("schema").schemaVersion, 11);

const roundTrip = context.deserializeState(maps, { holidayApiKey: "device-only" });
assert.equal(roundTrip.tasks[0].checklist[0].text, "현장 확인");
assert.equal(roundTrip.tasks[0].link.parentId, "task-0");
assert.equal(roundTrip.templates[0].linkedSteps[0].name, "결과 보고");
assert.equal(roundTrip.templates[0].linkedSteps[0].checklist[0], "보고 확인");
assert.equal(roundTrip.templates[0].methodBlocks[0].driveFileId, "drive-root");
assert.equal(roundTrip.settings.holidayApiKey, "device-only");
assert.equal(roundTrip.settings.categoryColors.시설, "#75B798");
assert.equal(roundTrip.settings.ownerProfiles.홍길동.mark, "🔧");
assert.deepEqual(Array.from(roundTrip.selectedCategories), ["시설"]);

const changed = JSON.parse(JSON.stringify(state));
changed.tasks[0].status = "progress";
changed.tasks[0].checklist[0].done = true;
const changedMaps = context.serializeState(changed);
const diffs = context.diffMaps(maps, changedMaps);
assert.equal(diffs.length, 2, "상태와 체크 변경은 전체 state가 아니라 해당 두 문서만 갱신해야 합니다.");
assert.deepEqual(Array.from(diffs.find((item) => item.collection === "tasks").fields), ["status"]);
assert.deepEqual(Array.from(diffs.find((item) => item.collection === "checklistItems").fields), ["done"]);
assert.equal(context.cloudHasData(maps), true);

console.log("PASS cloud state round-trip: 36 assertions");
