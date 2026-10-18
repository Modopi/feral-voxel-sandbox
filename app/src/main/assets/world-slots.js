// 기존 저장 키를 그대로 연결하는 월드 목록과 템플릿 레지스트리
export const CATALOG = "feral.worlds.v1";
export const DEFAULTS = [
  { id: "default", name: "기본 탐험 맵", type: "island", seed: 63026 },
  { id: "frontier", name: "개척 원정", type: "frontier", seed: 63026 },
  { id: "beta", name: "기계 베타 맵", type: "machine", seed: 63026 },
];
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
        !["island", "machine", "frontier", "expedition"].includes(w.type) ||
        typeof w.name !== "string" ||
        !Number.isSafeInteger(w.seed),
    ) ||
    new Set(rows.map((w) => w.id)).size !== rows.length
  )
    throw Error("월드 목록을 읽을 수 없습니다.");
  return rows;
}
export function saveKey(w) {
  return w.id === "default"
    ? "feral.world.v1"
    : w.id === "beta"
      ? "feral.machine.v1"
      : `feral.slot.${w.id}`;
}
// Every world opens the one game screen, except the machine test field until it moves there.
export function worldURL(w) {
  return `${w.type === "machine" ? "machine" : "index"}.html?world=${encodeURIComponent(w.id)}`;
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
    throw Error("이 월드를 찾을 수 없습니다. 월드 목록에서 다시 선택하세요.");
  return w;
}
export function createWorld(store, name, type, seed = 63026) {
  if (!["island", "machine", "frontier", "expedition"].includes(type))
    throw Error("잘못된 월드 유형");
  name = name.trim().slice(0, 40);
  if (!name) throw Error("월드 이름을 입력하세요.");
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647)
    throw Error("시드는 0~2147483647 정수입니다.");
  const rows = listWorlds(store),
    w = { id: "w" + globalThis.crypto.randomUUID(), name, type, seed };
  rows.push(w);
  store.setItem(CATALOG, JSON.stringify(rows));
  return w;
}
export function renameWorld(store, id, name) {
  const rows = listWorlds(store),
    w = rows.find((w) => w.id === id);
  name = name.trim().slice(0, 40);
  if (!w || !name) throw Error("이름을 확인하세요.");
  w.name = name;
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
