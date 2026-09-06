import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  getRedirectResult,
  onAuthStateChanged,
  reauthenticateWithPopup,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  collection,
  deleteField,
  doc,
  getDocs,
  increment,
  initializeFirestore,
  limit,
  onSnapshot,
  orderBy,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { appConfig, firebaseConfig } from "./firebase-config.js?v=20260905-1";

const SCHEMA_VERSION = 11;
const DATA_COLLECTIONS = [
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
const LIVE_COLLECTIONS = [...DATA_COLLECTIONS, "changeLogs"];
const ENTITY_LABELS = {
  tasks: "수행업무",
  checklistItems: "체크리스트",
  taskLinks: "업무 연계규칙",
  templates: "업무 DB",
  linkedRules: "DB 연계규칙",
  manualBlocks: "업무 매뉴얼",
  owners: "담당자",
  categories: "업무분류",
  holidays: "휴일",
  settings: "설정",
  meta: "시스템",
  generatedKeys: "중복방지 키",
};

let firebaseApp;
let auth;
let db;
let currentUser;
let driveAccessToken = "";
let driveFolderId = "";
let stateRef;
let recordMaps = makeRecordMaps();
let shadowMaps = makeRecordMaps();
let active = false;
let saving = false;
let queuedState = null;
let queuedResolvers = [];
let queuedVersion = 0;
let unsubscribeAll = [];
let remoteApplyTimer = 0;
let renderRemote = null;
let localOnly = false;
let needsInitialUpload = false;
let lastSyncAt = null;
const driveObjectUrls = new Map();

function makeRecordMaps() {
  return Object.fromEntries(LIVE_COLLECTIONS.map((name) => [name, new Map()]));
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function plain(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function validFirebaseConfig() {
  return Boolean(
    firebaseConfig?.apiKey &&
      firebaseConfig?.projectId &&
      !String(firebaseConfig.apiKey).startsWith("__") &&
      !String(firebaseConfig.projectId).startsWith("__"),
  );
}

function docId(...parts) {
  return parts.map((part) => encodeURIComponent(String(part ?? ""))).join("~");
}

function stableKeyId(key) {
  const bytes = new TextEncoder().encode(String(key));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `auto-${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}

function withoutSyncFields(data) {
  const out = { ...data };
  delete out.revision;
  delete out.updatedAt;
  delete out.createdAt;
  return plain(out);
}

function mapClone(maps) {
  const next = makeRecordMaps();
  for (const name of LIVE_COLLECTIONS) {
    for (const [id, value] of maps[name] || []) next[name].set(id, clone(value));
  }
  return next;
}

function replaceState(target, source) {
  const localApiKey = target.settings?.holidayApiKey || "";
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, clone(source));
  target.tasks ||= [];
  target.templates ||= [];
  target.holidays ||= [];
  target.categories ||= [];
  target.owners ||= [];
  target.settings ||= {};
  target.selectedCategories ||= [];
  target.changeLogs ||= [];
  target.settings.holidayApiKey = localApiKey || target.settings.holidayApiKey || "";
}

function emptyState(user) {
  const ownerName = String(user?.displayName || "담당자").trim() || "담당자";
  const categories = ["소방", "시설", "행정", "교육", "회계", "인사", "복지", "기타"];
  const palette = ["#A8D5BA", "#F6C7A5", "#FFD8A8", "#D9C5EA", "#B8D9EA", "#F2B8C6", "#F4E5A3", "#C8D4CB"];
  return {
    tasks: [],
    templates: [],
    holidays: [],
    categories,
    owners: [ownerName],
    selectedCategories: [],
    changeLogs: [],
    settings: {
      homeView: "gantt",
      ganttScale: "day",
      calendarMonth: new Date().toISOString().slice(0, 7),
      homeLayout: "split",
      autoHorizonMonths: 12,
      suppressedAutoKeys: [],
      taskListCategories: [],
      uiTheme: "mint",
      categoryColors: Object.fromEntries(categories.map((name, index) => [name, palette[index]])),
      ownerProfiles: { [ownerName]: { mark: "📋", color: "#CDEFD8" } },
      holidayApiKey: "",
    },
  };
}

function serializeState(state) {
  const maps = makeRecordMaps();
  for (const task of state.tasks || []) {
    const { checklist = [], link = null, ...taskFields } = task;
    maps.tasks.set(task.id, plain({ ...taskFields, id: task.id }));
    checklist.forEach((item, order) => {
      const itemId = item.id || docId("check", task.id, order, item.text || "");
      maps.checklistItems.set(docId("task", task.id, itemId),
        plain({ id: itemId, parentType: "task", parentId: task.id, order, text: item.text || "", done: Boolean(item.done) }));
    });
    if (link) maps.taskLinks.set(task.id, plain({ id: task.id, taskId: task.id, ...link }));
    if (task.generatedKey) {
      maps.generatedKeys.set(stableKeyId(task.generatedKey),
        plain({ generatedKey: task.generatedKey, taskId: task.id }));
    }
  }

  for (const template of state.templates || []) {
    const { checklist = [], linkedSteps = [], methodBlocks = [], photos, method, ...templateFields } = template;
    maps.templates.set(template.id, plain({ ...templateFields, id: template.id }));
    checklist.forEach((text, order) => {
      maps.checklistItems.set(docId("template", template.id, order),
        plain({ parentType: "template", parentId: template.id, order, text: String(text || ""), done: false }));
    });
    linkedSteps.forEach((step, order) => {
      const { checklist: stepChecks = [], methodBlocks: stepBlocks = [], ...stepFields } = step;
      const ruleId = docId(template.id, order);
      maps.linkedRules.set(ruleId, plain({ id: ruleId, rootTemplateId: template.id, order, ...stepFields }));
      stepChecks.forEach((text, checkOrder) => {
        maps.checklistItems.set(docId("linkedRule", ruleId, checkOrder),
          plain({ parentType: "linkedRule", parentId: ruleId, order: checkOrder, text: String(text || ""), done: false }));
      });
      stepBlocks.forEach((block, blockOrder) => {
        const id = block.id || docId("step-block", ruleId, blockOrder);
        const { data, objectUrl, ...safeBlock } = block;
        maps.manualBlocks.set(docId("linkedRule", ruleId, id),
          plain({ ...safeBlock, id, parentType: "linkedRule", parentId: ruleId, order: blockOrder }));
      });
    });
    methodBlocks.forEach((block, order) => {
      const id = block.id || docId("block", template.id, order);
      const { data, objectUrl, ...safeBlock } = block;
      maps.manualBlocks.set(docId("template", template.id, id),
        plain({ ...safeBlock, id, parentType: "template", parentId: template.id, order }));
    });
  }

  const categoryColors = state.settings?.categoryColors || {};
  (state.categories || []).forEach((name, order) => {
    maps.categories.set(docId(name), plain({ name, order, color: categoryColors[name] || "#A8D5BA" }));
  });
  const ownerProfiles = state.settings?.ownerProfiles || {};
  (state.owners || []).forEach((name, order) => {
    maps.owners.set(docId(name), plain({ name, order, ...(ownerProfiles[name] || {}) }));
  });
  (state.holidays || []).forEach((holiday) => maps.holidays.set(holiday.id, plain({ ...holiday, id: holiday.id })));

  const settings = clone(state.settings || {});
  delete settings.categoryColors;
  delete settings.ownerProfiles;
  delete settings.holidayApiKey;
  maps.settings.set("main", plain({ ...settings, selectedCategories: state.selectedCategories || [] }));
  maps.meta.set("schema", plain({ schemaVersion: SCHEMA_VERSION, app: "work-manager-cloud-v10" }));
  // 자동생성 잠금은 업무가 삭제되어도 남겨 두어 다른 기기가 같은 회차를 되살리지 못하게 한다.
  for (const [id, value] of shadowMaps.generatedKeys || []) {
    if (!maps.generatedKeys.has(id)) maps.generatedKeys.set(id, clone(value));
  }
  return maps;
}

function deserializeState(maps, localSettings = {}) {
  const settingsDoc = clone(maps.settings.get("main") || {});
  const selectedCategories = settingsDoc.selectedCategories || [];
  delete settingsDoc.selectedCategories;
  const categories = [...maps.categories.values()].sort((a, b) => (a.order || 0) - (b.order || 0));
  const owners = [...maps.owners.values()].sort((a, b) => (a.order || 0) - (b.order || 0));
  const checklistByParent = new Map();
  for (const item of maps.checklistItems.values()) {
    const key = `${item.parentType}:${item.parentId}`;
    if (!checklistByParent.has(key)) checklistByParent.set(key, []);
    checklistByParent.get(key).push(item);
  }
  for (const items of checklistByParent.values()) items.sort((a, b) => (a.order || 0) - (b.order || 0));
  const blocksByParent = new Map();
  for (const block of maps.manualBlocks.values()) {
    const key = `${block.parentType}:${block.parentId}`;
    if (!blocksByParent.has(key)) blocksByParent.set(key, []);
    blocksByParent.get(key).push(block);
  }
  for (const blocks of blocksByParent.values()) blocks.sort((a, b) => (a.order || 0) - (b.order || 0));

  const tasks = [...maps.tasks.values()].map((task) => ({
    ...task,
    checklist: (checklistByParent.get(`task:${task.id}`) || []).map((item) => ({ id: item.id, text: item.text, done: Boolean(item.done) })),
    link: maps.taskLinks.has(task.id) ? omit(maps.taskLinks.get(task.id), ["id", "taskId"]) : null,
  }));
  const rulesByTemplate = new Map();
  for (const rule of maps.linkedRules.values()) {
    if (!rulesByTemplate.has(rule.rootTemplateId)) rulesByTemplate.set(rule.rootTemplateId, []);
    rulesByTemplate.get(rule.rootTemplateId).push(rule);
  }
  for (const rules of rulesByTemplate.values()) rules.sort((a, b) => (a.order || 0) - (b.order || 0));
  const templates = [...maps.templates.values()].map((template) => {
    const linkedSteps = (rulesByTemplate.get(template.id) || []).map((rule) => {
      const ruleId = rule.id;
      return {
        ...omit(rule, ["id", "rootTemplateId", "order"]),
        checklist: (checklistByParent.get(`linkedRule:${ruleId}`) || []).map((item) => item.text),
        methodBlocks: (blocksByParent.get(`linkedRule:${ruleId}`) || []).map(cleanBlock),
      };
    });
    return {
      ...template,
      checklist: (checklistByParent.get(`template:${template.id}`) || []).map((item) => item.text),
      linkedSteps,
      methodBlocks: (blocksByParent.get(`template:${template.id}`) || []).map(cleanBlock),
      method: "",
      photos: [],
    };
  });
  const logs = [...maps.changeLogs.values()]
    .sort((a, b) => String(b.clientTime || "").localeCompare(String(a.clientTime || "")))
    .slice(0, 300);
  return {
    tasks,
    templates,
    holidays: [...maps.holidays.values()],
    categories: categories.map((item) => item.name),
    owners: owners.map((item) => item.name),
    selectedCategories,
    changeLogs: logs,
    settings: {
      ...settingsDoc,
      categoryColors: Object.fromEntries(categories.map((item) => [item.name, item.color || "#A8D5BA"])),
      ownerProfiles: Object.fromEntries(owners.map((item) => [item.name, { mark: item.mark || "📋", color: item.color || "#CDEFD8" }])),
      holidayApiKey: localSettings.holidayApiKey || "",
    },
  };
}

function cleanBlock(block) {
  return omit(block, ["parentType", "parentId", "order"]);
}

function omit(value, keys) {
  const out = { ...(value || {}) };
  for (const key of keys) delete out[key];
  return out;
}

function cloudHasData(maps) {
  return ["tasks", "templates", "categories", "owners", "holidays"].some((name) => maps[name].size > 0);
}

function ensureShell() {
  if (document.getElementById("cloudGate")) return;
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<div class="cloud-gate" id="cloudGate" role="dialog" aria-modal="true" aria-labelledby="cloudGateTitle">
      <div class="cloud-gate-card">
        <div class="cloud-gate-mark">✓</div>
        <h1 id="cloudGateTitle">업무관리시스템</h1>
        <p id="cloudGateText">클라우드 연결을 준비하고 있습니다.</p>
        <div id="cloudGateActions"></div>
        <div class="cloud-gate-error" id="cloudGateError" aria-live="polite"></div>
      </div>
    </div>`,
  );
  const side = document.querySelector(".side");
  side?.insertAdjacentHTML(
    "beforeend",
    `<div class="cloud-account" id="cloudAccount">
      <div><span class="sync-dot" id="syncDot"></span><span id="syncText">연결 중</span></div>
      <div class="cloud-user" id="cloudUser"></div>
      <button class="cloud-signout" id="cloudSignOut" type="button">로그아웃</button>
    </div>`,
  );
}

function gate(text, actions = "", error = "") {
  ensureShell();
  const root = document.getElementById("cloudGate");
  root.classList.remove("hidden");
  document.getElementById("cloudGateText").textContent = text;
  document.getElementById("cloudGateActions").innerHTML = actions;
  document.getElementById("cloudGateError").textContent = error;
}

function hideGate() {
  document.getElementById("cloudGate")?.classList.add("hidden");
}

function setSyncStatus(kind, text) {
  const dot = document.getElementById("syncDot");
  const label = document.getElementById("syncText");
  if (dot) dot.dataset.state = kind;
  if (label) label.textContent = text;
}

function waitForAuthState(authInstance) {
  return new Promise((resolve, reject) => {
    const off = onAuthStateChanged(authInstance, (user) => {
      off();
      resolve(user);
    }, reject);
  });
}

async function authenticate() {
  let redirectResult = null;
  try {
    redirectResult = await getRedirectResult(auth);
    const credential = redirectResult && GoogleAuthProvider.credentialFromResult(redirectResult);
    if (credential?.accessToken) driveAccessToken = credential.accessToken;
  } catch (error) {
    console.warn("redirect sign-in", error);
  }
  let user = auth.currentUser || (await waitForAuthState(auth));
  if (user) return user;

  gate(
    "내 Google 계정으로 로그인하면 모든 기기에서 같은 업무를 실시간으로 사용할 수 있습니다.",
    `<button class="cloud-google-btn" id="cloudGoogleLogin" type="button"><span>G</span> Google로 로그인</button>`,
  );
  return new Promise((resolve, reject) => {
    document.getElementById("cloudGoogleLogin").onclick = async () => {
      const button = document.getElementById("cloudGoogleLogin");
      button.disabled = true;
      document.getElementById("cloudGateError").textContent = "";
      const provider = makeGoogleProvider();
      try {
        const result = await signInWithPopup(auth, provider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (credential?.accessToken) driveAccessToken = credential.accessToken;
        resolve(result.user);
      } catch (error) {
        if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(error?.code)) {
          await signInWithRedirect(auth, provider);
          return;
        }
        button.disabled = false;
        if (error?.code === "auth/popup-closed-by-user") {
          document.getElementById("cloudGateError").textContent = "로그인 창이 닫혔습니다. 다시 눌러 로그인해 주세요.";
          return;
        }
        document.getElementById("cloudGateError").textContent = `로그인하지 못했습니다. ${friendlyError(error)}`;
      }
    };
  });
}

function makeGoogleProvider() {
  const provider = new GoogleAuthProvider();
  provider.addScope("https://www.googleapis.com/auth/drive.file");
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

function friendlyError(error) {
  const code = error?.code || "";
  if (code.includes("unauthorized-domain")) return "이 주소가 Firebase 승인 도메인에 아직 등록되지 않았습니다.";
  if (code.includes("network")) return "인터넷 연결을 확인해 주세요.";
  if (code.includes("permission-denied")) return "이 계정에는 데이터 접근 권한이 없습니다.";
  if (code.includes("popup-blocked")) return "브라우저가 Google 권한 창을 막았습니다. 주소창의 팝업 차단 표시에서 이 사이트의 팝업을 허용한 뒤 다시 눌러 주세요.";
  if (code.includes("popup-closed-by-user")) return "Google 권한 창이 닫혔습니다. 다시 눌러 권한 승인을 완료해 주세요.";
  return error?.message || "잠시 후 다시 시도해 주세요.";
}

async function loadAllCollections() {
  setSyncStatus("syncing", "데이터 불러오는 중");
  const maps = makeRecordMaps();
  await Promise.all(DATA_COLLECTIONS.map(async (name) => {
    const snap = await getDocs(collection(db, name));
    snap.forEach((entry) => maps[name].set(entry.id, withoutSyncFields(entry.data())));
  }));
  try {
    const logsSnap = await getDocs(query(collection(db, "changeLogs"), orderBy("clientTime", "desc"), limit(300)));
    logsSnap.forEach((entry) => maps.changeLogs.set(entry.id, withoutSyncFields(entry.data())));
  } catch (error) {
    if (error?.code !== "permission-denied") console.warn("change history", error);
  }
  return maps;
}

function chooseInitialState(legacyState, user) {
  if (!legacyState?.tasks || !legacyState?.templates) return Promise.resolve(emptyState(user));
  gate(
    `이 브라우저에서 기존 v10 데이터 ${legacyState.tasks.length}개 업무와 ${legacyState.templates.length}개 DB 항목을 찾았습니다.`,
    `<button class="cloud-google-btn" id="cloudMigrate" type="button">기존 v10 데이터를 클라우드로 옮기기</button>
     <button class="cloud-secondary-btn" id="cloudStartEmpty" type="button">빈 클라우드로 시작</button>`,
  );
  return new Promise((resolve) => {
    document.getElementById("cloudMigrate").onclick = () => {
      needsInitialUpload = true;
      resolve(clone(legacyState));
    };
    document.getElementById("cloudStartEmpty").onclick = () => {
      needsInitialUpload = true;
      resolve(emptyState(user));
    };
  });
}

export async function bootstrapCloud({ state, legacyState = null } = {}) {
  stateRef = state;
  ensureShell();
  if (new URLSearchParams(location.search).has("local-preview")) {
    localOnly = true;
    replaceState(stateRef, legacyState || emptyState(null));
    hideGate();
    setSyncStatus("offline", "로컬 미리보기");
    return controller();
  }
  if (!validFirebaseConfig()) {
    gate("클라우드 설정값이 아직 연결되지 않았습니다.", "", "배포 설정을 완료한 뒤 다시 접속해 주세요.");
    throw new Error("Firebase configuration is incomplete.");
  }

  firebaseApp = initializeApp(firebaseConfig);
  auth = getAuth(firebaseApp);
  await setPersistence(auth, browserLocalPersistence);
  db = initializeFirestore(firebaseApp, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  currentUser = await authenticate();
  const configuredUid = String(appConfig.ownerUid || "");
  document.getElementById("cloudUser").textContent = currentUser.email || currentUser.displayName || "Google 계정";
  if (!configuredUid || configuredUid.startsWith("__")) {
    gate(
      "최초 보안 설정을 마치려면 이 계정의 Firebase UID를 앱 설정과 보안규칙에 한 번 등록해야 합니다.",
      `<div style="display:grid;gap:9px;text-align:left">
        <label for="cloudOwnerUid" style="font-size:12px;font-weight:800;color:#526158">내 Firebase UID</label>
        <input id="cloudOwnerUid" readonly style="width:100%;box-sizing:border-box;border:1px solid #cddbd1;border-radius:12px;padding:12px;background:#f7faf8;font:600 13px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace">
        <button class="cloud-secondary-btn" id="cloudCopyOwnerUid" type="button">UID 복사</button>
      </div>`,
      "UID는 비밀번호나 인증코드가 아닌 계정 식별값입니다.",
    );
    const field = document.getElementById("cloudOwnerUid");
    const copyButton = document.getElementById("cloudCopyOwnerUid");
    field.value = currentUser.uid;
    copyButton.onclick = async () => {
      field.select();
      try {
        await navigator.clipboard.writeText(currentUser.uid);
      } catch {
        document.execCommand("copy");
      }
      copyButton.textContent = "복사됨";
    };
    throw new Error("Firebase owner UID is not configured.");
  }
  if (configuredUid && !configuredUid.startsWith("__") && currentUser.uid !== configuredUid) {
    await signOut(auth);
    gate("이 업무관리시스템에 등록된 Google 계정이 아닙니다.", "", "다른 계정으로 로그인해 주세요.");
    throw new Error("Unauthorized account.");
  }
  document.getElementById("cloudSignOut").onclick = async () => {
    await signOut(auth);
    location.reload();
  };
  gate("클라우드 데이터를 불러오는 중입니다.");
  recordMaps = await loadAllCollections();
  shadowMaps = mapClone(recordMaps);
  if (cloudHasData(recordMaps)) {
    replaceState(stateRef, deserializeState(recordMaps, stateRef.settings || {}));
  } else {
    const initial = await chooseInitialState(legacyState, currentUser);
    replaceState(stateRef, initial);
    needsInitialUpload = true;
  }
  hideGate();
  setSyncStatus(navigator.onLine ? "online" : "offline", navigator.onLine ? "동기화 준비" : "오프라인");
  window.addEventListener("online", () => setSyncStatus("online", "온라인"));
  window.addEventListener("offline", () => setSyncStatus("offline", "오프라인 · 변경 대기"));
  return controller();
}

function controller() {
  return {
    get user() { return currentUser; },
    get mode() { return localOnly ? "local" : "cloud"; },
    hasDriveAccess() { return localOnly || Boolean(driveAccessToken); },
    stableTaskId: stableKeyId,
    activate,
    save,
    importState,
    createImageBlock,
    hydrateImages,
    ensureDriveAccess,
    flush,
  };
}

async function activate({ onRemote } = {}) {
  renderRemote = onRemote || null;
  active = true;
  if (localOnly) return;
  subscribeRealtime();
  if (needsInitialUpload || queuedState) {
    const snapshot = queuedState || clone(stateRef);
    queuedState = null;
    needsInitialUpload = false;
    await save(snapshot, { reason: "초기 클라우드 데이터 구성" });
  } else {
    setSyncStatus(navigator.onLine ? "online" : "offline", navigator.onLine ? "최신 상태" : "오프라인");
  }
}

function subscribeRealtime() {
  unsubscribeAll.forEach((off) => off());
  unsubscribeAll = [];
  for (const name of LIVE_COLLECTIONS) {
    const source = name === "changeLogs"
      ? query(collection(db, name), orderBy("clientTime", "desc"), limit(300))
      : collection(db, name);
    const off = onSnapshot(source, { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.metadata.hasPendingWrites) return;
      const target = recordMaps[name];
      snapshot.docChanges().forEach((change) => {
        if (change.type === "removed") target.delete(change.doc.id);
        else target.set(change.doc.id, withoutSyncFields(change.doc.data()));
      });
      if (!snapshot.metadata.fromCache) {
        lastSyncAt = new Date();
        setSyncStatus("online", "최신 상태");
      }
      scheduleRemoteApply();
    }, (error) => {
      console.error(`Realtime ${name}`, error);
      setSyncStatus("error", friendlyError(error));
    });
    unsubscribeAll.push(off);
  }
}

function scheduleRemoteApply() {
  clearTimeout(remoteApplyTimer);
  remoteApplyTimer = setTimeout(() => {
    if (saving || queuedState) return scheduleRemoteApply();
    shadowMaps = mapClone(recordMaps);
    replaceState(stateRef, deserializeState(recordMaps, stateRef.settings || {}));
    renderRemote?.();
  }, 120);
}

async function save(snapshot, metadata = {}) {
  if (localOnly || !active) {
    queuedState = clone(snapshot);
    return;
  }
  queuedState = clone(snapshot);
  const targetVersion = ++queuedVersion;
  return new Promise((resolve, reject) => {
    queuedResolvers.push({ targetVersion, resolve, reject });
    if (!saving) void flushQueue(metadata);
  });
}

async function flush() {
  if (queuedState && !saving) void flushQueue({ reason: "수동 동기화" });
  while (saving || queuedState) await new Promise((resolve) => setTimeout(resolve, 25));
}

async function flushQueue(metadata = {}) {
  if (saving || !queuedState) return;
  saving = true;
  setSyncStatus("syncing", navigator.onLine ? "저장 중" : "오프라인 저장 중");
  const snapshot = queuedState;
  const snapshotVersion = queuedVersion;
  queuedState = null;
  try {
    await ensureImageUploads(snapshot);
    const nextMaps = serializeState(snapshot);
    const changes = diffMaps(shadowMaps, nextMaps);
    if (changes.length) {
      if (navigator.onLine) {
        try {
          await commitOnlineChunks(changes, nextMaps, metadata);
        } catch (error) {
          if (!["unavailable", "deadline-exceeded", "failed-precondition"].includes(error?.code)) throw error;
          await commitOfflineChunks(changes, nextMaps, metadata);
        }
      } else await commitOfflineChunks(changes, nextMaps, metadata);
      shadowMaps = mapClone(nextMaps);
      for (const name of DATA_COLLECTIONS) recordMaps[name] = new Map(nextMaps[name]);
      lastSyncAt = new Date();
    }
    setSyncStatus(navigator.onLine ? "online" : "offline", navigator.onLine ? "저장됨" : "오프라인 · 전송 대기");
    const done = queuedResolvers.filter(({ targetVersion }) => targetVersion <= snapshotVersion);
    queuedResolvers = queuedResolvers.filter(({ targetVersion }) => targetVersion > snapshotVersion);
    done.forEach(({ resolve }) => resolve());
  } catch (error) {
    console.error("Cloud save", error);
    setSyncStatus("error", friendlyError(error));
    const done = queuedResolvers.filter(({ targetVersion }) => targetVersion <= snapshotVersion);
    queuedResolvers = queuedResolvers.filter(({ targetVersion }) => targetVersion > snapshotVersion);
    done.forEach(({ reject }) => reject(error));
    window.dispatchEvent(new CustomEvent("cloud-sync-error", { detail: friendlyError(error) }));
  } finally {
    saving = false;
    if (queuedState) void flushQueue(metadata);
  }
}

function diffMaps(beforeMaps, afterMaps) {
  const changes = [];
  for (const name of DATA_COLLECTIONS) {
    const before = beforeMaps[name] || new Map();
    const after = afterMaps[name] || new Map();
    for (const [id, next] of after) {
      const previous = before.get(id);
      if (!previous) changes.push({ collection: name, id, type: "create", before: null, after: next, fields: Object.keys(next) });
      else {
        const fields = changedFields(previous, next);
        if (fields.length) changes.push({ collection: name, id, type: "update", before: previous, after: next, fields });
      }
    }
    for (const [id, previous] of before) {
      if (!after.has(id)) changes.push({ collection: name, id, type: "delete", before: previous, after: null, fields: [] });
    }
  }
  return changes;
}

function changedFields(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...keys].filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]));
}

function patchFor(change) {
  const patch = {};
  for (const field of change.fields) patch[field] = Object.hasOwn(change.after || {}, field) ? plain(change.after[field]) : deleteField();
  return patch;
}

function changeBundleKey(change, maps) {
  const data = change.after || change.before || {};
  if (change.collection === "tasks") return `task:${change.id}`;
  if (change.collection === "taskLinks") return `task:${data.taskId || change.id}`;
  if (change.collection === "generatedKeys") return `task:${data.taskId || change.id}`;
  if (change.collection === "checklistItems" && data.parentType === "task") return `task:${data.parentId}`;
  if (change.collection === "templates") return `template:${change.id}`;
  if (change.collection === "linkedRules") return `template:${data.rootTemplateId || change.id}`;
  if (["checklistItems", "manualBlocks"].includes(change.collection) && data.parentType === "template") return `template:${data.parentId}`;
  if (["checklistItems", "manualBlocks"].includes(change.collection) && data.parentType === "linkedRule") {
    const rule = maps.linkedRules.get(data.parentId) || shadowMaps.linkedRules.get(data.parentId);
    return `template:${rule?.rootTemplateId || data.parentId}`;
  }
  return `${change.collection}:${change.id}`;
}

function chunkChanges(changes, maps, maxWrites = 320) {
  const bundles = new Map();
  for (const change of changes) {
    const key = changeBundleKey(change, maps);
    if (!bundles.has(key)) bundles.set(key, []);
    bundles.get(key).push(change);
  }
  const chunks = [];
  let current = [];
  for (const bundle of bundles.values()) {
    if (current.length && current.length + bundle.length > maxWrites) {
      chunks.push(current);
      current = [];
    }
    if (bundle.length > maxWrites) {
      for (let index = 0; index < bundle.length; index += maxWrites) chunks.push(bundle.slice(index, index + maxWrites));
    } else current.push(...bundle);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function commitOnlineChunks(changes, maps, metadata) {
  const chunks = chunkChanges(changes, maps);
  for (let index = 0; index < chunks.length; index++) {
    await commitTransaction(chunks[index], maps, { ...metadata, reason: chunks.length > 1 ? `${metadata.reason || "데이터 변경"} (${index + 1}/${chunks.length})` : metadata.reason });
  }
}

async function commitOfflineChunks(changes, maps, metadata) {
  const chunks = chunkChanges(changes, maps);
  for (let index = 0; index < chunks.length; index++) {
    await commitOfflineBatch(chunks[index], maps, { ...metadata, reason: chunks.length > 1 ? `${metadata.reason || "데이터 변경"} (${index + 1}/${chunks.length})` : metadata.reason });
  }
}

async function commitTransaction(changes, nextMaps, metadata) {
  const writeChanges = changes.filter((change) => change.collection !== "generatedKeys");
  const generatedCreates = changes.filter((change) => change.collection === "generatedKeys" && change.type === "create");
  await runTransaction(db, async (transaction) => {
    const snapshots = new Map();
    for (const change of [...writeChanges, ...generatedCreates]) {
      const ref = doc(db, change.collection, change.id);
      snapshots.set(`${change.collection}/${change.id}`, await transaction.get(ref));
    }
    const skippedTaskIds = new Set();
    for (const lockChange of generatedCreates) {
      const snap = snapshots.get(`generatedKeys/${lockChange.id}`);
      if (snap.exists()) {
        const remoteTaskId = snap.data().taskId;
        if (remoteTaskId && remoteTaskId !== lockChange.after.taskId) skippedTaskIds.add(lockChange.after.taskId);
      }
    }
    for (const change of writeChanges) {
      if (belongsToSkippedTask(change, skippedTaskIds)) continue;
      const ref = doc(db, change.collection, change.id);
      const snap = snapshots.get(`${change.collection}/${change.id}`);
      if (change.type === "delete") {
        transaction.delete(ref);
        continue;
      }
      if (!snap.exists() || change.type === "create") {
        transaction.set(ref, { ...plain(change.after), revision: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
      } else {
        transaction.update(ref, { ...patchFor(change), revision: Number(snap.data().revision || 0) + 1, updatedAt: serverTimestamp() });
      }
    }
    for (const change of changes.filter((item) => item.collection === "generatedKeys")) {
      if (change.type !== "create") continue;
      const snap = snapshots.get(`generatedKeys/${change.id}`);
      if (!snap.exists()) transaction.set(doc(db, "generatedKeys", change.id), { ...plain(change.after), createdAt: serverTimestamp() });
    }
    if (writeChanges.length) {
      const logRef = doc(collection(db, "changeLogs"));
      transaction.set(logRef, makeLog(writeChanges, metadata));
    }
  });
}

function belongsToSkippedTask(change, taskIds) {
  if (!taskIds.size) return false;
  if (change.collection === "tasks") return taskIds.has(change.id);
  return taskIds.has(change.after?.parentId) || taskIds.has(change.before?.parentId) || taskIds.has(change.after?.taskId) || taskIds.has(change.before?.taskId);
}

async function commitOfflineBatch(changes, nextMaps, metadata) {
  const batch = writeBatch(db);
  const writeChanges = changes.filter((change) => change.collection !== "generatedKeys");
  const allowedChanges = changes.filter((change) => change.collection !== "generatedKeys" || change.type === "create");
  for (const change of allowedChanges) {
    const ref = doc(db, change.collection, change.id);
    if (change.type === "delete") batch.delete(ref);
    else if (change.type === "create") batch.set(ref, { ...plain(change.after), revision: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    else batch.set(ref, { ...patchFor(change), revision: increment(1), updatedAt: serverTimestamp() }, { merge: true });
  }
  if (writeChanges.length) batch.set(doc(collection(db, "changeLogs")), makeLog(writeChanges, metadata));
  await batch.commit();
}

function makeLog(changes, metadata = {}) {
  const summaries = changes.slice(0, 80).map((change) => ({
    collection: change.collection,
    entity: ENTITY_LABELS[change.collection] || change.collection,
    entityId: change.id,
    action: change.type,
    fields: change.fields.slice(0, 30),
    label: change.after?.name || change.after?.text || change.before?.name || change.before?.text || "",
  }));
  return {
    actorUid: currentUser?.uid || "offline",
    actorEmail: currentUser?.email || "",
    clientTime: new Date().toISOString(),
    serverTime: serverTimestamp(),
    reason: metadata.reason || inferReason(summaries),
    changeCount: changes.length,
    changes: summaries,
    schemaVersion: SCHEMA_VERSION,
  };
}

function inferReason(summaries) {
  const entities = [...new Set(summaries.map((item) => item.entity))];
  return `${entities.slice(0, 3).join(" · ")} 변경`;
}

async function importState(incoming, { replace = false } = {}) {
  if (!incoming?.tasks || !incoming?.templates) throw new Error("올바른 v10 백업 파일이 아닙니다.");
  const next = clone(incoming);
  next.settings ||= {};
  next.settings.holidayApiKey = stateRef.settings?.holidayApiKey || next.settings.holidayApiKey || "";
  if (!replace) {
    const current = clone(stateRef);
    next.tasks = mergeById(current.tasks || [], next.tasks || []);
    next.templates = mergeById(current.templates || [], next.templates || []);
    next.holidays = mergeById(current.holidays || [], next.holidays || []);
    next.categories = [...new Set([...(current.categories || []), ...(next.categories || [])])];
    next.owners = [...new Set([...(current.owners || []), ...(next.owners || [])])];
    next.settings = { ...(current.settings || {}), ...(next.settings || {}) };
  }
  await ensureImageUploads(next, true);
  replaceState(stateRef, next);
  await save(stateRef, { reason: replace ? "백업 전체 복원" : "v10 백업 병합 가져오기" });
  renderRemote?.();
}

function mergeById(current, incoming) {
  const map = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

async function ensureDriveAccess() {
  if (driveAccessToken) return driveAccessToken;
  if (!currentUser) throw new Error("Google 로그인이 필요합니다.");
  let result;
  try {
    result = await reauthenticateWithPopup(currentUser, makeGoogleProvider());
  } catch (error) {
    throw new Error(friendlyError(error), { cause: error });
  }
  const credential = GoogleAuthProvider.credentialFromResult(result);
  driveAccessToken = credential?.accessToken || "";
  if (!driveAccessToken) throw new Error("Google Drive 권한을 확인하지 못했습니다.");
  return driveAccessToken;
}

async function ensureDriveFolder() {
  if (driveFolderId) return driveFolderId;
  const token = await ensureDriveAccess();
  const marker = appConfig.driveAppMarker || "work-manager-v10";
  const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and appProperties has { key='workManagerApp' and value='${marker.replaceAll("'", "\\'")}' }`;
  const listUrl = new URL("https://www.googleapis.com/drive/v3/files");
  listUrl.searchParams.set("q", q);
  listUrl.searchParams.set("spaces", "drive");
  listUrl.searchParams.set("fields", "files(id,name)");
  const listed = await driveFetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
  const files = await listed.json();
  if (files.files?.[0]?.id) return (driveFolderId = files.files[0].id);
  const created = await driveFetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: appConfig.driveFolderName || "업무관리시스템_매뉴얼사진",
      mimeType: "application/vnd.google-apps.folder",
      appProperties: { workManagerApp: marker },
    }),
  });
  const folder = await created.json();
  driveFolderId = folder.id;
  return driveFolderId;
}

async function createImageBlock(file, id = `mb-${Date.now().toString(36)}`) {
  if (!file?.type?.startsWith("image/")) throw new Error("이미지 파일만 첨부할 수 있습니다.");
  const folderId = await ensureDriveFolder();
  const token = driveAccessToken;
  const metadataResponse = await driveFetch("https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,size", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `${new Date().toISOString().replaceAll(":", "-")}_${file.name}`,
      mimeType: file.type,
      parents: [folderId],
      appProperties: { workManagerApp: appConfig.driveAppMarker || "work-manager-v10", kind: "manual-photo" },
    }),
  });
  const metadata = await metadataResponse.json();
  try {
    await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(metadata.id)}?uploadType=media`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": file.type },
      body: file,
    });
  } catch (error) {
    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(metadata.id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    } catch {}
    throw error;
  }
  const objectUrl = URL.createObjectURL(file);
  driveObjectUrls.set(metadata.id, objectUrl);
  return { id, type: "image", driveFileId: metadata.id, name: file.name, mimeType: file.type, size: file.size, caption: "", data: objectUrl };
}

async function ensureImageUploads(state, allowPrompt = false) {
  const pending = [];
  for (const template of state.templates || []) {
    for (const block of template.methodBlocks || []) if (block.type === "image" && !block.driveFileId && String(block.data || "").startsWith("data:")) pending.push(block);
    for (const step of template.linkedSteps || []) {
      for (const block of step.methodBlocks || []) if (block.type === "image" && !block.driveFileId && String(block.data || "").startsWith("data:")) pending.push(block);
    }
  }
  if (!pending.length) return;
  if (!driveAccessToken && !allowPrompt) throw new Error("사진을 Google Drive에 저장하려면 Drive 연결 버튼을 먼저 눌러 주세요.");
  await ensureDriveAccess();
  for (const block of pending) {
    const blob = await (await fetch(block.data)).blob();
    const file = new File([blob], block.name || `manual-${Date.now()}.${mimeExtension(blob.type)}`, { type: blob.type || block.mimeType || "image/jpeg" });
    const uploaded = await createImageBlock(file, block.id);
    Object.assign(block, uploaded);
  }
}

function mimeExtension(type) {
  return ({ "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[type] || "jpg");
}

async function hydrateImages(root = document) {
  const images = [...root.querySelectorAll("img[data-drive-file]")];
  for (const image of images) {
    const fileId = image.dataset.driveFile;
    if (!fileId) continue;
    if (driveObjectUrls.has(fileId)) {
      image.src = driveObjectUrls.get(fileId);
      image.classList.remove("drive-image-pending");
      continue;
    }
    const load = async () => {
      image.classList.add("drive-image-loading");
      try {
        await ensureDriveAccess();
        const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
          headers: { Authorization: `Bearer ${driveAccessToken}` },
        });
        const objectUrl = URL.createObjectURL(await response.blob());
        driveObjectUrls.set(fileId, objectUrl);
        image.src = objectUrl;
        image.classList.remove("drive-image-pending");
      } catch (error) {
        image.title = friendlyError(error);
        image.classList.add("drive-image-pending");
      } finally {
        image.classList.remove("drive-image-loading");
      }
    };
    image.onclick = load;
    image.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") void load();
    };
    if (driveAccessToken) void load();
  }
}

async function driveFetch(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 401) driveAccessToken = "";
  if (!response.ok) {
    let message = `Google Drive ${response.status}`;
    try {
      const body = await response.json();
      message = body?.error?.message || message;
    } catch {}
    throw new Error(message);
  }
  return response;
}

window.addEventListener("beforeunload", () => unsubscribeAll.forEach((off) => off()));
