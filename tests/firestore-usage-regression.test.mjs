import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../js/cloud-sync.js", import.meta.url), "utf8");

function extractFunction(name) {
  const matcher = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`, "g");
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
const registrations = [];
let remoteApplyCount = 0;
let unsubscribeCount = 0;
let automaticId = 0;

const sandbox = {
  console,
  Map,
  Set,
  Object,
  JSON,
  String,
  Date,
  Promise,
  DATA_COLLECTIONS: collections,
  LIVE_COLLECTIONS: [...collections, "changeLogs"],
  CHANGE_LOG_LIMIT: 300,
  SCHEMA_VERSION: 11,
  ENTITY_LABELS: Object.fromEntries([...collections, "changeLogs"].map((name) => [name, name])),
  coreReadyPromise: null,
  historyListenerStarted: false,
  historyReadyPromise: null,
  unsubscribeAll: [],
  active: false,
  localOnly: false,
  navigator: { onLine: true },
  lastSyncAt: null,
  currentUser: { uid: "qa-user", email: "qa@example.com" },
  stateRef: { changeLogs: [] },
  db: { name: "qa-db" },
  setSyncStatus() {},
  friendlyError(error) { return error?.message || "error"; },
  scheduleRemoteApply() { remoteApplyCount += 1; },
  collection(_db, name) { return { kind: "collection", name }; },
  orderBy(field, direction) { return { kind: "orderBy", field, direction }; },
  limit(count) { return { kind: "limit", count }; },
  query(base, ...clauses) { return { kind: "query", name: base.name, clauses }; },
  onSnapshot(snapshotSource, options, onNext, onError) {
    const registration = { source: snapshotSource, options, onNext, onError, closed: false };
    registrations.push(registration);
    return () => {
      if (!registration.closed) unsubscribeCount += 1;
      registration.closed = true;
    };
  },
  doc(...args) {
    if (args.length === 1) return { path: `${args[0].name}/auto-${++automaticId}` };
    return { path: `${args[1]}/${args[2]}` };
  },
  serverTimestamp() { return "SERVER_TIME"; },
  deleteField() { return "DELETE_FIELD"; },
};
const context = vm.createContext(sandbox);
for (const name of [
  "plain",
  "clone",
  "withoutSyncFields",
  "makeRecordMaps",
  "applySnapshotChanges",
  "subscribeRealtime",
  "loadChangeLogs",
  "stopRealtime",
  "patchFor",
  "belongsToSkippedTask",
  "makeLog",
  "inferReason",
  "commitTransaction",
]) vm.runInContext(extractFunction(name), context);

context.recordMaps = context.makeRecordMaps();
const readyOne = context.subscribeRealtime();
const readyTwo = context.subscribeRealtime();
assert.equal(readyOne, readyTwo, "초기화가 반복되어도 같은 준비 Promise를 재사용해야 합니다.");
assert.equal(registrations.length, collections.length, "핵심 컬렉션마다 listener는 한 개만 등록해야 합니다.");
assert.ok(registrations.every((entry) => entry.source.name !== "changeLogs"), "변경이력은 첫 화면에서 선조회하면 안 됩니다.");

function snapshot({ fromCache = false, pending = false, changes = [] } = {}) {
  return {
    metadata: { fromCache, hasPendingWrites: pending },
    docChanges() { return changes; },
  };
}
function added(id, data) {
  return { type: "added", doc: { id, data: () => data } };
}
function modified(id, data) {
  return { type: "modified", doc: { id, data: () => data } };
}

for (const registration of registrations) {
  const changes = registration.source.name === "tasks"
    ? [added("task-1", { id: "task-1", name: "점검", revision: 1 })]
    : [];
  registration.onNext(snapshot({ changes }));
}
const onlineReady = await readyOne;
assert.equal(onlineReady.serverConfirmed, true, "온라인 첫 로그인은 서버 응답을 확인한 뒤 열려야 합니다.");
assert.equal(context.recordMaps.tasks.get("task-1").name, "점검", "최초 listener 스냅샷으로 업무를 구성해야 합니다.");

context.active = true;
const taskListener = registrations.find((entry) => entry.source.name === "tasks");
taskListener.onNext(snapshot({ changes: [modified("task-1", { id: "task-1", name: "점검 변경", revision: 2 })] }));
assert.equal(context.recordMaps.tasks.get("task-1").name, "점검 변경", "외부 변경을 기존 listener가 반영해야 합니다.");
assert.equal(remoteApplyCount, 1, "실제 데이터 변경은 화면 반영을 한 번 예약해야 합니다.");
taskListener.onNext(snapshot());
assert.equal(remoteApplyCount, 1, "메타데이터만 바뀐 스냅샷은 재렌더링을 예약하면 안 됩니다.");

const historyReadyOne = context.loadChangeLogs();
const historyReadyTwo = context.loadChangeLogs();
assert.equal(historyReadyOne, historyReadyTwo, "변경이력 로딩 중에도 같은 요청을 재사용해야 합니다.");
assert.equal(registrations.length, collections.length + 1, "변경이력 화면을 반복 열어도 listener를 하나만 사용해야 합니다.");
const historyListener = registrations.at(-1);
assert.equal(historyListener.source.name, "changeLogs");
assert.equal(historyListener.source.clauses.find((item) => item.kind === "limit")?.count, 300, "변경이력은 최근 300건으로 제한해야 합니다.");
historyListener.onNext(snapshot({ changes: [added("log-1", { clientTime: "2026-09-11T00:00:00.000Z", reason: "업무 수정" })] }));
await historyReadyOne;
assert.equal(context.recordMaps.changeLogs.size, 1, "요청 후 변경이력을 실시간 상태에 반영해야 합니다.");
assert.equal(context.stateRef.changeLogs[0].reason, "업무 수정", "백업 직전에도 지연 로드한 변경이력을 사용할 수 있어야 합니다.");

context.stopRealtime();
assert.equal(unsubscribeCount, collections.length + 1, "로그아웃·종료 시 등록된 listener를 모두 해제해야 합니다.");

context.navigator.onLine = false;
context.recordMaps = context.makeRecordMaps();
const offlineStart = registrations.length;
const offlineReadyPromise = context.subscribeRealtime();
const offlineListeners = registrations.slice(offlineStart);
for (const registration of offlineListeners) registration.onNext(snapshot({ fromCache: true }));
const offlineReady = await offlineReadyPromise;
assert.equal(offlineReady.serverConfirmed, false, "오프라인에서는 모든 캐시 스냅샷이 준비되면 서버를 기다리지 않아야 합니다.");
context.stopRealtime();

function makeTransaction(existingPaths = new Set(), dataByPath = new Map()) {
  const calls = { get: [], set: [], update: [], delete: [] };
  return {
    calls,
    transaction: {
      async get(ref) {
        calls.get.push(ref.path);
        return { exists: () => existingPaths.has(ref.path), data: () => ({ revision: 2, ...(dataByPath.get(ref.path) || {}) }) };
      },
      set(ref, data) { calls.set.push({ path: ref.path, data }); },
      update(ref, data) { calls.update.push({ path: ref.path, data }); },
      delete(ref) { calls.delete.push(ref.path); },
    },
  };
}

let currentTransaction;
context.runTransaction = async (_db, callback) => callback(currentTransaction.transaction);

currentTransaction = makeTransaction();
await context.commitTransaction([
  { collection: "tasks", id: "manual-new", type: "create", before: null, after: { id: "manual-new", name: "새 업무" }, fields: ["id", "name"] },
], null, { reason: "업무 작성" });
assert.equal(currentTransaction.calls.get.length, 0, "일반 신규 문서는 결과에 영향 없는 선조회를 하지 않아야 합니다.");
assert.ok(currentTransaction.calls.set.some((call) => call.path === "tasks/manual-new"));
assert.ok(currentTransaction.calls.set.some((call) => call.path.startsWith("changeLogs/")), "실제 변경에는 로그를 남겨야 합니다.");

currentTransaction = makeTransaction(new Set(["tasks/task-1"]));
await context.commitTransaction([
  { collection: "tasks", id: "task-1", type: "update", before: { status: "planned" }, after: { status: "progress" }, fields: ["status"] },
], null, { reason: "상태 변경" });
assert.deepEqual(currentTransaction.calls.get, ["tasks/task-1"], "수정 문서는 충돌 확인을 위해 한 번 읽어야 합니다.");
assert.equal(currentTransaction.calls.update.length, 1);

currentTransaction = makeTransaction(new Set(["tasks/task-1"]), new Map([["tasks/task-1", { status: "progress" }]]));
await context.commitTransaction([
  { collection: "tasks", id: "task-1", type: "update", before: { status: "planned" }, after: { status: "progress" }, fields: ["status"] },
], null, { reason: "상태 변경" });
assert.deepEqual(currentTransaction.calls.get, ["tasks/task-1"], "경합 중 같은 값인지 확인하는 read는 유지해야 합니다.");
assert.equal(currentTransaction.calls.update.length, 0, "원격 문서가 이미 같은 값이면 update를 반복하면 안 됩니다.");
assert.equal(currentTransaction.calls.set.length, 0, "실제 반영 필드가 없으면 changeLogs도 쓰면 안 됩니다.");

currentTransaction = makeTransaction(new Set(["generatedKeys/lock-1"]));
const rollingChanges = [
  { collection: "tasks", id: "auto-task", type: "create", before: null, after: { id: "auto-task" }, fields: ["id"] },
  { collection: "checklistItems", id: "auto-check", type: "create", before: null, after: { parentType: "task", parentId: "auto-task" }, fields: ["parentType", "parentId"] },
  { collection: "generatedKeys", id: "lock-1", type: "create", before: null, after: { taskId: "auto-task", generatedKey: "dbauto:tpl:M:2026-09" }, fields: ["taskId", "generatedKey"] },
];
await context.commitTransaction(rollingChanges, null, { reason: "Rolling" });
assert.deepEqual(currentTransaction.calls.get, ["generatedKeys/lock-1"], "자동생성 경합은 잠금 문서만 읽어야 합니다.");
assert.equal(currentTransaction.calls.set.length, 0, "이미 확보된 회차는 업무·잠금·변경로그를 다시 쓰면 안 됩니다.");

currentTransaction = makeTransaction();
await context.commitTransaction(rollingChanges, null, { reason: "Rolling" });
assert.deepEqual(currentTransaction.calls.get, ["generatedKeys/lock-1"], "새 Rolling 회차도 생성 잠금만 먼저 읽어야 합니다.");
assert.ok(currentTransaction.calls.set.some((call) => call.path === "tasks/auto-task"), "잠금이 비어 있으면 Rolling 업무를 생성해야 합니다.");
assert.ok(currentTransaction.calls.set.some((call) => call.path === "checklistItems/auto-check"), "새 Rolling 체크리스트를 함께 생성해야 합니다.");
assert.ok(currentTransaction.calls.set.some((call) => call.path === "generatedKeys/lock-1"), "새 Rolling 생성키 잠금을 함께 기록해야 합니다.");
assert.ok(currentTransaction.calls.set.some((call) => call.path.startsWith("changeLogs/")), "실제 Rolling 보충에는 변경로그를 남겨야 합니다.");

console.log("PASS Firestore usage regression: single initial listeners and change-only writes");
