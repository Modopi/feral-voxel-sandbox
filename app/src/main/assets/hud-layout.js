export const LAYOUT_KEY = "feral.ui.layout.v1";
export const HUD_ELEMENTS = {
  stick: "이동 스틱", actBtn: "공격 · 채굴", useBtn: "사용 · 설치", jumpBtn: "점프",
  flyBtn: "비행", rangeBtn: "편집 크기", hotbar: "아이템 핫바", vitals: "체력 · 포만",
  inventoryBtn: "가방 버튼", menuBtn: "메뉴 버튼", journalBtn: "지도 버튼", statusBtn: "상태 버튼",
  interactBtn: "상호작용", toolLabel: "아이템 이름", waypoint: "목적지", toast: "알림",
};
export const OPTIONAL_HUD = new Set(["toolLabel", "waypoint", "toast"]);
export function readLayout(storage) {
  try { return cleanLayout(JSON.parse(storage.getItem(LAYOUT_KEY))); }
  catch { return cleanLayout(null); }
}
const finite = (n, fallback) => typeof n === "number" && Number.isFinite(n) ? n : fallback;
export const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
export function cleanEntry(e) {
  return { x: clamp(finite(e?.x, 0.5), 0, 1), y: clamp(finite(e?.y, 0.5), 0, 1),
    scale: clamp(finite(e?.scale, 1), 0.65, 1.5), opacity: clamp(finite(e?.opacity, 1), 0.4, 1), hidden: e?.hidden === true };
}
export function cleanLayout(value) {
  const result = { version: 1, theme: value?.theme === "sand" ? "sand" : "slate", profiles: {} };
  if (value?.version !== 1) return result;
  for (const key of ["landscape-right", "landscape-left", "portrait-right", "portrait-left"]) {
    result.profiles[key] = {};
    for (const id of Object.keys(HUD_ELEMENTS)) if (value.profiles?.[key]?.[id]) {
      const entry = cleanEntry(value.profiles[key][id]);
      entry.hidden = OPTIONAL_HUD.has(id) && entry.hidden;
      result.profiles[key][id] = entry;
    }
  }
  return result;
}
export function layoutProfile(width, height, leftHand) {
  return `${width >= height ? "landscape" : "portrait"}-${leftHand ? "left" : "right"}`;
}
// Positions use the available travel area, preserving the screen edge when resized.
export function placement(entry, width, height, baseWidth, baseHeight, inset = 8) {
  const e = cleanEntry(entry);
  const minScale = Math.min(1, 36 / Math.max(1, Math.min(baseWidth, baseHeight)));
  const scale = Math.min(Math.max(minScale, e.scale), (width - 2 * inset) / Math.max(1, baseWidth), (height - 2 * inset) / Math.max(1, baseHeight));
  const w = baseWidth * scale, h = baseHeight * scale;
  return { left: inset + e.x * Math.max(0, width - 2 * inset - w), top: inset + e.y * Math.max(0, height - 2 * inset - h), width: w, height: h, scale };
}
