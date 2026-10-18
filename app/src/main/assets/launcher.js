// The launcher (docs/ARCHITECTURE.md §2–5): landing, world list, world settings, global settings and updates.
// It never starts the game engine; a world opens the game session page. World settings are made and changed here.
import {
  listWorlds,
  worldConfig,
  hasSave,
  createWorld,
  updateWorld,
  deleteWorld,
  worldURL,
  restoreFromVault,
  syncVault,
  PRESETS,
  RULES,
} from "./world-slots.js";
import { mountSettings, loadSettingsForm, persistSettings } from "./settings.js";
import { initUpdates } from "./updates.js";
import { worldArt } from "./ui-art.js";
import { readLayout } from "./hud-layout.js";
import { VERSION } from "./version.js";

document.documentElement.dataset.uiTheme = readLayout(localStorage).theme;
const $ = (id) => document.getElementById(id);
const VIEWS = ["landing", "worldsView", "settingsView", "updatesView"];
let editing = null,
  deleting = null;

/** Shows an error where the person is looking: the open dialog, else the current view's status line. */
function run(fn) {
  try {
    return fn();
  } catch (e) {
    const dialog = document.querySelector("dialog[open]");
    if (dialog) {
      let line = dialog.querySelector(".dialogError");
      if (!line) {
        line = document.createElement("p");
        line.className = "dialogError";
        line.setAttribute("role", "status");
        dialog.append(line);
      }
      line.textContent = e.message;
    } else ($("worldsView").hidden ? $("launcherStatus") : $("status")).textContent = e.message;
  }
}
function show(view) {
  for (const v of VIEWS) $(v).hidden = v !== view;
  if (view === "landing") drawLanding();
  if (view === "worldsView") drawWorlds();
}
// Saves kept in the vault come back before anything reads them (docs/ARCHITECTURE.md §4).
const vault = { available: true, restored: [], newer: [], error: null };
const restoring = restoreFromVault()
  .then((result) => {
    if (!result) vault.available = false;
    else Object.assign(vault, result);
    if (vault.restored.length) $("launcherStatus").textContent = `이전 게임 버전의 저장 ${vault.restored.length}개를 가져왔습니다.`;
  })
  .catch((e) => {
    vault.error = e.message;
    console.warn("저장 보관함을 읽지 못했습니다", e);
  })
  .finally(() => {
    drawLanding();
    if (!$("worldsView").hidden) drawWorlds();
  });
function play(w) {
  restoring.finally(() => (location.href = worldURL(w)));
}

// ---- Landing ----
function lastPlayed() {
  return listWorlds(localStorage)
    .filter((w) => w.lastPlayedAt)
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)[0];
}
function drawLanding() {
  run(() => {
    const w = lastPlayed();
    $("continueWorld").hidden = !w;
    if (w) {
      $("continueName").textContent = w.name;
      $("continueWorld").onclick = () => play(w);
    }
  });
}

// ---- World list ----
function when(time) {
  return new Date(time).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function rulesText(config) {
  return Object.entries(config.rules)
    .filter(([key]) => RULES[key].when === "always")
    .map(([key, on]) => `${RULES[key].label} ${on ? "켬" : "끔"}`)
    .join(" · ");
}
function drawWorlds() {
  const list = $("worlds");
  list.replaceChildren();
  let worlds = [];
  run(() => (worlds = listWorlds(localStorage)));
  for (const w of worlds) {
    const row = document.createElement("article"),
      info = document.createElement("div"),
      name = document.createElement("b"),
      desc = document.createElement("small"),
      glyph = document.createElement("span"),
      preset = PRESETS[w.type];
    let config = null,
      problem = "";
    try {
      config = worldConfig(w);
    } catch (e) {
      problem = e.message;
    }
    glyph.className = "worldGlyph";
    glyph.innerHTML = worldArt(w.type);
    glyph.setAttribute("aria-hidden", "true");
    name.textContent = w.name;
    desc.textContent = problem || [
      `${preset.name} · ${preset.summary}`,
      `시드 ${w.seed}`,
      rulesText(config),
      hasSave(localStorage, w) ? "저장 있음" : "새 월드",
      w.lastPlayedAt ? `마지막 플레이 ${when(w.lastPlayedAt)}` : "",
    ].filter(Boolean).join(" · ");
    info.append(name, desc);
    row.append(glyph, info);
    row.dataset.world = w.id;
    for (const [text, fn, ok] of [
      ["플레이", () => play(w), !problem],
      ["설정", () => openWorldDialog(w), !problem],
      ["삭제", () => confirmDelete(w), true],
    ]) {
      const b = document.createElement("button");
      b.textContent = text;
      b.disabled = !ok;
      b.onclick = () => run(fn);
      row.append(b);
    }
    list.append(row);
  }
  if (!list.childNodes.length) list.textContent = "월드가 없습니다. 아래에서 만들어 주세요.";
}

// ---- World settings dialog (create and edit share it) ----
function drawRules(type, values, mode) {
  const box = $("worldRules"),
    keys = Object.keys(PRESETS[type].rules);
  box.replaceChildren(Object.assign(document.createElement("legend"), { textContent: "월드 설정" }));
  if (!keys.length) {
    box.append(Object.assign(document.createElement("p"), { textContent: "이 맵은 아직 바꿀 수 있는 설정이 없습니다." }));
    return;
  }
  for (const key of keys) {
    const rule = RULES[key],
      fixed = mode === "edit" && rule.when !== "always",
      label = document.createElement("label"),
      input = document.createElement("input"),
      help = document.createElement("small");
    label.className = "setting ruleSetting";
    input.type = "checkbox";
    input.id = `rule-${key}`;
    input.dataset.rule = key;
    input.checked = values[key];
    input.disabled = fixed;
    help.textContent = rule.help + (rule.when === "create" ? " · 만든 뒤에는 바꿀 수 없습니다" : "");
    label.append(rule.label + " ", input, help);
    box.append(label);
  }
}
function openWorldDialog(w = null) {
  editing = w?.id ?? null;
  const dialog = $("worldDialog");
  dialog.querySelector(".dialogError")?.remove();
  $("worldDialogTitle").textContent = w ? "월드 설정" : "새로운 세계";
  $("worldSubmit").textContent = w ? "저장" : "월드 만들기";
  $("preset").replaceChildren(
    ...Object.entries(PRESETS).map(([type, p]) => new Option(`${p.name} · ${p.summary}`, type, false, type === (w?.type ?? "expedition"))),
  );
  $("preset").disabled = !!w;
  $("worldName").value = w?.name ?? "";
  $("worldSeed").value = w?.seed ?? 63026;
  $("worldSeed").disabled = !!w;
  const type = w?.type ?? $("preset").value;
  $("presetDescription").textContent = PRESETS[type].description;
  drawRules(type, w ? worldConfig(w).rules : PRESETS[type].rules, w ? "edit" : "create");
  dialog.showModal();
  if (!w) $("worldName").focus();
}
$("preset").onchange = () => {
  const type = $("preset").value;
  $("presetDescription").textContent = PRESETS[type].description;
  drawRules(type, PRESETS[type].rules, "create");
};
function chosenRules() {
  const rules = {};
  for (const input of $("worldRules").querySelectorAll("input[data-rule]:not(:disabled)")) rules[input.dataset.rule] = input.checked;
  return rules;
}
$("worldForm").onsubmit = (e) => {
  e.preventDefault();
  run(() => {
    if (editing) updateWorld(localStorage, editing, { name: $("worldName").value, rules: chosenRules() });
    else createWorld(localStorage, $("worldName").value, $("preset").value, Number($("worldSeed").value), chosenRules());
    syncVault();
    $("worldDialog").close();
    $("status").textContent = editing ? "월드 설정을 저장했습니다." : "월드를 만들었습니다. 플레이를 눌러 들어가세요.";
    drawWorlds();
  });
};
$("worldCancel").onclick = () => $("worldDialog").close();
$("newWorld").onclick = () => run(() => openWorldDialog());

function confirmDelete(w) {
  deleting = w.id;
  $("confirmText").textContent = `“${w.name}” 월드와 저장을 삭제할까요? 되돌릴 수 없습니다.`;
  $("confirm").showModal();
}
$("deleteYes").onclick = () =>
  run(() => {
    deleteWorld(localStorage, deleting);
    syncVault();
    $("confirm").close();
    drawWorlds();
  });
$("deleteNo").onclick = () => $("confirm").close();

// ---- Navigation ----
$("openWorlds").onclick = () => show("worldsView");
$("openSettings").onclick = () => show("settingsView");
$("openUpdates").onclick = () => show("updatesView");
for (const b of document.querySelectorAll(".launcherBack")) b.onclick = () => show("landing");
window.FeralNative = {
  save: () => true,
  pause: () => {},
  back: () => {
    const dialog = document.querySelector("dialog[open]");
    if (dialog) dialog.close();
    else if ($("landing").hidden) show("landing");
  },
};

// ---- Global settings and updates: the same parts the in-game menu uses ----
mountSettings($("settingsFields"));
loadSettingsForm();
for (const input of $("settingsFields").querySelectorAll("input,select"))
  input.oninput = input.onchange = () => {
    persistSettings();
    syncVault();
  };
window.FeralUpdates = initUpdates({ beforeApply: () => true, panel: $("updatesPanel") });
try {
  const status = window.AndroidApp?.updateStatus ? JSON.parse(window.AndroidApp.updateStatus()) : null;
  $("appVersion").textContent = status?.nativeVersion ? `앱 ${status.nativeVersion}` : "웹 미리보기";
} catch {
  $("appVersion").textContent = "";
}
show("landing");

// ---- Start check for the app ----
// The app treats a new game version as started once this reports healthy. The game session module is loaded
// (not run) first, so a version whose game files cannot load is still caught and rolled back.
const health = { sessionFiles: "checking", reported: false };
window.FeralLauncher = { ready: true, health, vault, restoring, version: VERSION.version };
(async () => {
  try {
    await import("./content-runtime/game.js");
    health.sessionFiles = "ok";
  } catch (e) {
    console.error(e);
    health.sessionFiles = "failed";
    $("launcherStatus").textContent = "게임 파일을 불러오지 못했습니다. 이전 게임 버전으로 되돌립니다.";
    window.AndroidApp?.runtimeFailed?.();
    return;
  }
  let frames = 0;
  const started = performance.now();
  const tick = (now) => {
    if (++frames >= 12 && now - started >= 3000 && !document.hidden) {
      health.reported = true;
      window.AndroidApp?.runtimeHealthy?.(VERSION.versionCode);
    } else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
