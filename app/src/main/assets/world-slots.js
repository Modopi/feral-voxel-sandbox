// World list, world settings and the save vault (docs/ARCHITECTURE.md §4–5). The launcher creates and edits
// worlds; a game session only reads its world and records when it was last played. Save keys never move.
import { VERSION } from "./version.js";
export const CATALOG = "feral.worlds.v1";
export const CONFIG_VERSION = 1;
const TYPES = ["island", "machine", "frontier", "expedition"];

// What each world setting means. `when` says whether it can change after the world exists:
// settings that shape generated terrain or the starting state are fixed once the world is made.
export const RULES = {
  survival: { label: "생존", help: "체력과 식량이 줄고 피해를 받습니다. 끄면 평화 규칙입니다.", when: "always" },
  sandbox: { label: "샌드박스", help: "관찰·물·불·산·개체 생성 도구, 캔 자원으로 블록 쌓기", when: "always" },
  startStructures: { label: "시작 건축물", help: "출발지 주변에 첫 건축물을 둡니다", when: "create" },
  starterKit: { label: "시작 소지품", help: "돌 곡괭이·목재·돌·씨앗을 받고 시작합니다", when: "create" },
  dropOnDeath: { label: "사망 시 소지품 남김", help: "쓰러진 자리에 소지품을 남기고, 그곳에 다시 가면 요정이 돌려줍니다. 끄면 소지품을 지닌 채 깨어납니다.", when: "always" },
};

// Presets are default world settings. `rules` holds only what that world's game session actually reads,
// so the launcher never shows a switch the game ignores. `engine` is read by the session router alone,
// until the frontier and the machine field move onto the one runtime (docs/ROADMAP.md).
export const PRESETS = {
  expedition: {
    name: "FERAL 탐험", summary: "연구 · 던전 · 자유 제작", engine: "runtime", terrain: "infinite",
    description: "끝없이 이어지는 세계입니다. 출발지에서 멀어질수록 위험해집니다.",
    rules: { survival: true, sandbox: false, startStructures: true, dropOnDeath: true },
  },
  island: {
    name: "기본 탐험 맵", summary: "복셀 섬 · 생태 관찰", engine: "runtime", terrain: "island",
    description: "160 × 160 m의 섬입니다. 다섯 장소를 탐험하고 생태의 변화를 관찰합니다.",
    rules: { survival: false, sandbox: true, starterKit: true, dropOnDeath: true },
  },
  frontier: {
    name: "첫 신호", summary: "야영지 성장 · 신호망 복원 · 자유 원정", engine: "frontier", terrain: "frontier",
    description: "지역을 오가며 마을과 협력하고 세 신호를 복원하는 원정입니다. 아직 통합 전이라 바꿀 수 있는 설정이 없습니다.",
    rules: {},
  },
  machine: {
    name: "기계 시험장", summary: "BETA · 기계 조립 시험", engine: "machine", terrain: "machine-field",
    description: "격자에 차체·모터·바퀴를 조립해 달려 보는 시험장입니다. 아직 통합 전이라 바꿀 수 있는 설정이 없습니다.",
    rules: {},
  },
};

export const DEFAULTS = [
  { id: "default", name: "기본 탐험 맵", type: "island", seed: 63026 },
  { id: "frontier", name: "개척 원정", type: "frontier", seed: 63026 },
  { id: "beta", name: "기계 베타 맵", type: "machine", seed: 63026 },
];

/** The world settings for a list entry: the stored settings, or the preset defaults for worlds made before 0.15. */
export function worldConfig(w) {
  const preset = PRESETS[w.type];
  const stored = w.config;
  if (stored !== undefined) {
    if (!stored || stored.configVersion !== CONFIG_VERSION)
      throw Error(`“${w.name}”의 월드 설정을 읽을 수 없습니다. 더 새로운 게임 버전에서 만든 월드일 수 있습니다.`);
    if (stored.preset !== w.type || stored.seed !== w.seed) throw Error(`“${w.name}”의 월드 설정이 목록과 맞지 않습니다.`);
  }
  const rules = {};
  for (const [key, value] of Object.entries(preset.rules)) {
    const saved = stored?.rules?.[key];
    rules[key] = typeof saved === "boolean" ? saved : value;
  }
  return { configVersion: CONFIG_VERSION, preset: w.type, seed: w.seed, terrain: { generator: preset.terrain }, rules };
}

export function listWorlds(store) {
  const raw = store.getItem(CATALOG);
  if (!raw) return DEFAULTS.map((w) => ({ ...w }));
  const rows = JSON.parse(raw);
  if (
    !Array.isArray(rows) ||
    rows.some(
      (w) =>
        !w ||
        !/^[-\w]+$/.test(w.id) ||
        !TYPES.includes(w.type) ||
        typeof w.name !== "string" ||
        !Number.isSafeInteger(w.seed),
    ) ||
    new Set(rows.map((w) => w.id)).size !== rows.length
  )
    throw Error("월드 목록을 읽을 수 없습니다.");
  return rows;
}
/** One world with its settings, or null. */
export function findWorld(store, id) {
  const w = listWorlds(store).find((w) => w.id === id);
  return w ? { ...w, config: worldConfig(w) } : null;
}
export function saveKey(w) {
  return w.id === "default"
    ? "feral.world.v1"
    : w.id === "beta"
      ? "feral.machine.v1"
      : `feral.slot.${w.id}`;
}
/** Whether the world has a save under any of its keys (worlds on the one runtime keep two generations). */
export function hasSave(store, w) {
  const key = saveKey(w);
  return [key, key + ".a", key + ".b"].some((k) => store.getItem(k));
}
// Every world opens the one game session page; the launcher is index.html.
export function worldURL(w) {
  return `play.html?world=${encodeURIComponent(w.id)}`;
}
export function currentWorld(store, type, search) {
  const id = new URLSearchParams(search).get("world");
  const w = id
    ? listWorlds(store).find(
        (w) =>
          w.id === id &&
          (Array.isArray(type) ? type.includes(w.type) : w.type === type),
      )
    : DEFAULTS.find((w) => w.type === (Array.isArray(type) ? type[0] : type));
  if (!w)
    throw Error("이 월드를 찾을 수 없습니다. 런처에서 다시 선택하세요.");
  return { ...w, config: worldConfig(w) };
}
function cleanName(name) {
  name = String(name ?? "").trim().slice(0, 40);
  if (!name) throw Error("월드 이름을 입력하세요.");
  return name;
}
function checkRules(type, rules, when) {
  const out = {};
  for (const [key, value] of Object.entries(rules ?? {})) {
    if (!(key in PRESETS[type].rules)) throw Error(`이 월드에서 쓸 수 없는 설정입니다: ${RULES[key]?.label ?? key}`);
    if (when === "always" && RULES[key].when !== "always") throw Error(`만든 뒤에는 바꿀 수 없는 설정입니다: ${RULES[key].label}`);
    if (typeof value !== "boolean") throw Error(`설정 값이 올바르지 않습니다: ${RULES[key].label}`);
    out[key] = value;
  }
  return out;
}
export function createWorld(store, name, type, seed = 63026, rules = {}) {
  if (!TYPES.includes(type)) throw Error("잘못된 월드 유형");
  name = cleanName(name);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647)
    throw Error("시드는 0~2147483647 정수입니다.");
  const rows = listWorlds(store),
    w = { id: "w" + globalThis.crypto.randomUUID(), name, type, seed, createdAt: Date.now() };
  w.config = worldConfig({ ...w, config: { configVersion: CONFIG_VERSION, preset: type, seed, rules: checkRules(type, rules, "create") } });
  rows.push(w);
  store.setItem(CATALOG, JSON.stringify(rows));
  return w;
}
/** Launcher edits: the name and the settings that may change after creation. */
export function updateWorld(store, id, { name, rules } = {}) {
  const rows = listWorlds(store),
    w = rows.find((w) => w.id === id);
  if (!w) throw Error("월드를 찾을 수 없습니다.");
  const config = worldConfig(w);
  if (name !== undefined) w.name = cleanName(name);
  w.config = { ...config, rules: { ...config.rules, ...checkRules(w.type, rules, "always") } };
  store.setItem(CATALOG, JSON.stringify(rows));
  return { ...w };
}
export function renameWorld(store, id, name) {
  return updateWorld(store, id, { name });
}
/** A session may only record when the world was last played. */
export function touchWorld(store, id, now = Date.now()) {
  const rows = listWorlds(store),
    w = rows.find((w) => w.id === id);
  if (!w) return;
  w.lastPlayedAt = now;
  store.setItem(CATALOG, JSON.stringify(rows));
}
export function deleteWorld(store, id) {
  const rows = listWorlds(store),
    w = rows.find((w) => w.id === id);
  if (!w) throw Error("월드를 찾을 수 없습니다.");
  // 목록 갱신 성공 뒤 해당 월드 데이터만 제거
  store.setItem(CATALOG, JSON.stringify(rows.filter((w) => w.id !== id)));
  store.removeItem(saveKey(w));
  // Worlds on the one runtime keep two save generations next to the original key.
  if (w.type === "expedition" || w.type === "island") {
    store.removeItem(saveKey(w) + ".a");
    store.removeItem(saveKey(w) + ".b");
  }
}

// ---- Save vault (docs/ARCHITECTURE.md §4): saves follow the player across game versions ----
// When a version is picked in the app's version list, the app (0.3.3) keeps each build's `feral.*` storage
// apart, so a build that never ran starts with empty storage. The vault keeps the latest complete copy of all
// `feral.*` keys in IndexedDB, which the app never swaps. The launcher brings that copy back when this build's
// storage is empty or older; every save copies changes in. The copy is taken and replaced as a whole, so two
// builds' storage never mix. A copy written under a newer save schema is never taken or overwritten here.
export const VAULT_KEY = "feral.vault.v1";
const META = "@meta";
/** A short content hash for change detection (cyrb53 and length). */
export function saveHash(text) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + ":" + text.length;
}
function savedKeys(store) {
  const keys = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k?.startsWith("feral.") && k !== VAULT_KEY) keys.push(k);
  }
  return keys;
}
/** Which vault copy this storage last matched: {savedAt, schema, code}, or null for storage the vault never saw. */
function stampOf(store) {
  try {
    const s = JSON.parse(store.getItem(VAULT_KEY) || "null");
    return s && Number.isFinite(s.savedAt) ? s : null;
  } catch {
    return null;
  }
}
const stamp = (store, meta) => store.setItem(VAULT_KEY, JSON.stringify({ savedAt: meta.savedAt, schema: meta.schema, code: meta.code }));
/** Launcher start: take the vault copy when this storage is empty or older than it. */
export async function reconcileVault(store, backend, schema) {
  const meta = await backend.get(META);
  if (!meta) return { restored: [], kept: "empty-vault" };
  if (meta.schema > schema) return { restored: [], kept: "newer-schema", from: meta.code };
  const keys = savedKeys(store),
    mine = stampOf(store);
  // Storage the vault never saw (a build before 0.15) is where the player left off, so it stays and is copied in.
  if (keys.length && !(mine && meta.savedAt > mine.savedAt)) return { restored: [], kept: mine ? "current" : "unvaulted" };
  const rows = (await backend.getAll()).filter((r) => r.key !== META && r.key.startsWith("feral.") && r.key !== VAULT_KEY && typeof r.value === "string");
  const before = Object.fromEntries(keys.map((k) => [k, store.getItem(k)]));
  try {
    for (const k of keys) store.removeItem(k);
    for (const r of rows) store.setItem(r.key, r.value);
    stamp(store, meta);
  } catch (e) {
    // A full storage must not leave half of each copy behind.
    for (const k of savedKeys(store)) store.removeItem(k);
    for (const [k, v] of Object.entries(before)) store.setItem(k, v);
    throw e;
  }
  return { restored: rows.map((r) => r.key), kept: null, from: meta.code };
}
/** After a save: copy changed keys and drop keys deleted here, as one new complete copy. */
export async function mirrorVault(store, backend, schema, code, now = Date.now()) {
  const meta = await backend.get(META);
  if (meta && meta.schema > schema) return { written: [], removed: [], skipped: "newer-schema" };
  const mine = stampOf(store);
  // Storage behind the vault (another build saved later) must not overwrite it; the launcher restores it first.
  if (meta && mine && meta.savedAt > mine.savedAt) return { written: [], removed: [], skipped: "behind" };
  const known = meta?.hashes ?? {},
    hashes = {},
    puts = [];
  for (const key of savedKeys(store)) {
    const value = store.getItem(key);
    hashes[key] = saveHash(value);
    if (known[key] !== hashes[key]) puts.push({ key, value });
  }
  const removed = Object.keys(known).filter((k) => !(k in hashes));
  if (!puts.length && !removed.length) {
    if (meta && !mine) stamp(store, meta);
    return { written: [], removed: [] };
  }
  const next = { key: META, savedAt: Math.max(now, (meta?.savedAt ?? 0) + 1), schema, code, hashes };
  await backend.apply([...puts, next], removed);
  stamp(store, next);
  return { written: puts.map((p) => p.key), removed };
}
/** The IndexedDB vault, or null where IndexedDB is unavailable. */
export function indexedVault(name = "feral-vault") {
  if (typeof indexedDB === "undefined") return null;
  let db = null;
  const open = () =>
    (db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("keys", { keyPath: "key" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  const run = async (mode, work) => {
    const tx = (await open()).transaction("keys", mode);
    return new Promise((resolve, reject) => {
      const request = work(tx.objectStore("keys"));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  };
  return {
    get: (key) => run("readonly", (s) => s.get(key)),
    getAll: () => run("readonly", (s) => s.getAll()).then((rows) => rows ?? []),
    apply: (puts, removes) =>
      run("readwrite", (s) => {
        for (const p of puts) s.put(p);
        for (const k of removes) s.delete(k);
      }),
  };
}
let vaultBackend, syncing = null, again = false;
function backend() {
  if (vaultBackend === undefined) vaultBackend = indexedVault();
  return vaultBackend;
}
/** Background copy after a save; calls during a running copy are folded into one more run. */
export function syncVault(store = globalThis.localStorage) {
  const b = backend();
  if (!b || !store) return Promise.resolve(null);
  if (syncing) {
    again = true;
    return syncing;
  }
  syncing = mirrorVault(store, b, VERSION.saveSchema, VERSION.versionCode)
    .catch((e) => {
      console.warn("저장 보관함에 복사하지 못했습니다", e);
      return null;
    })
    .finally(() => {
      syncing = null;
      if (again) {
        again = false;
        syncVault(store);
      }
    });
  return syncing;
}
/** Launcher start: bring the vault copy back when needed, then copy what is here. Null without a vault. */
export async function restoreFromVault(store = globalThis.localStorage) {
  const b = backend();
  if (!b) return null;
  const result = await reconcileVault(store, b, VERSION.saveSchema);
  await syncVault(store);
  return result;
}
