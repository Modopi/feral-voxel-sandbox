// Global settings (docs/ARCHITECTURE.md §4): one stored record and one form, shown by the launcher
// and by the in-game menu. The game session applies the values to its view; the launcher only edits them.
export const SETTINGS_KEY = "feral.settings";
const FIELDS = [
  { id: "quality", label: "그래픽", type: "select", value: "balanced",
    options: [["low", "절전 · 짧은 시야"], ["balanced", "균형 · 권장"], ["high", "고품질 · 넓은 시야"]] },
  { id: "sensitivity", label: "시점 감도", type: "range", min: 30, max: 180, value: 80 },
  { id: "fov", label: "시야각", type: "range", min: 60, max: 100, value: 82 },
  { id: "sound", label: "도구 소리", type: "checkbox", value: true },
  { id: "leftHand", label: "왼손 조작", type: "checkbox", value: false },
  { id: "showRadar", label: "미니맵·좌표", type: "checkbox", value: false },
  { id: "showEvents", label: "주변 사건 알림", type: "checkbox", value: false },
];
export function readSettings(storage = localStorage) {
  try {
    return JSON.parse(storage.getItem(SETTINGS_KEY) || "null");
  } catch {
    return null;
  }
}
/** Builds the settings controls (ids quality, sensitivity, fov, sound, leftHand, showRadar, showEvents) once. */
export function mountSettings(root) {
  if (!root || root.querySelector("#quality")) return;
  for (const f of FIELDS) {
    const label = document.createElement("label");
    label.className = "setting";
    label.append(f.label + " ");
    let input;
    if (f.type === "select") {
      input = document.createElement("select");
      for (const [value, text] of f.options) input.append(new Option(text, value, false, value === f.value));
    } else {
      input = document.createElement("input");
      input.type = f.type;
      if (f.type === "range") Object.assign(input, { min: f.min, max: f.max, value: f.value });
      else input.checked = f.value;
    }
    input.id = f.id;
    label.append(input);
    root.append(label);
  }
}
/** Puts the stored values into the controls; returns whether a stored record existed. */
export function loadSettingsForm(storage = localStorage) {
  const s = readSettings(storage);
  if (!s) return false;
  const $ = (id) => document.getElementById(id);
  $("quality").value = s.quality || "balanced";
  $("sensitivity").value = s.sensitivity || 80;
  $("fov").value = s.layoutVersion === 2 ? s.fov || 82 : 82;
  $("sound").checked = s.sound !== false;
  $("leftHand").checked = !!s.leftHand;
  $("showRadar").checked = !!s.showRadar;
  $("showEvents").checked = !!s.showEvents;
  return true;
}
export function persistSettings(storage = localStorage) {
  const $ = (id) => document.getElementById(id);
  storage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      layoutVersion: 2,
      quality: $("quality").value,
      sensitivity: $("sensitivity").value,
      fov: $("fov").value,
      sound: $("sound").checked,
      leftHand: $("leftHand").checked,
      showRadar: $("showRadar").checked,
      showEvents: $("showEvents").checked,
    }),
  );
}
