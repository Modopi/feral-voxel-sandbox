// The game screen every map shares (docs/UNIFIED-GAME.md): notifications, controls, movement buttons,
// settings, pause menu, field HUD and the ledger window. Moved from the island/frontier game so all
// maps use the same code; one module keeps the update package under the native file limit.
import { uiIcon } from "./ui-art.js";
import { mountCharacterPortrait } from "./character-portrait.js";
import { STANCES } from "./physics.js";
const $ = (id) => document.getElementById(id);

// ---- Notifications ----
export function createNotifier(el, { translate = (text) => text } = {}) {
  const queue = [];
  let timer = 0,
    current = "";
  function show(text) {
    el.textContent = current = text;
    el.classList.add("show");
    clearTimeout(timer);
    timer = setTimeout(next, queue.length ? 2600 : 3200);
  }
  function next() {
    if (queue.length) show(queue.shift());
    else {
      current = "";
      el.classList.remove("show");
    }
  }
  function notify(text, { queue: wait = false } = {}) {
    const message = translate(text);
    if (!message) return;
    if (!wait || (!current && !queue.length)) show(message);
    else if (queue.at(-1) !== message && current !== message) {
      queue.push(message);
      if (queue.length > 6) queue.shift();
    }
  }
  notify.busy = () => !!current;
  notify.pending = () => [...queue];
  return notify;
}
// The discovery banner for a newly found place, shared by every map.
let discoveryTimer = 0;
export function showDiscovery(count, name) {
  const el = document.getElementById("discovery");
  el.querySelector("span").textContent = `FIELD NOTE / ${String(count).padStart(2, "0")}`;
  el.querySelector("strong").textContent = name;
  el.classList.add("show");
  clearTimeout(discoveryTimer);
  discoveryTimer = setTimeout(() => el.classList.remove("show"), 4800);
}

// ---- Controls ----
export function createInput({ canControl, isEditing = () => false, rotateLook }) {
  const keys = new Set(),
    holds = new Set(),
    joy = { x: 0, y: 0, id: null },
    look = { id: null, x: 0, y: 0 };
  let knob = null;
  function holdButton(el, on, off) {
    let pointer = null;
    const cancel = () => {
      if (!pointer) return;
      const id = pointer.id;
      pointer = null;
      el.classList.remove("held");
      off();
      if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
    };
    holds.add(cancel);
    el.addEventListener("pointerdown", (e) => {
      if (!canControl() || isEditing() || pointer || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
      el.classList.add("held");
      on();
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId !== pointer?.id) return;
      e.preventDefault();
      rotateLook(e.clientX - pointer.x, e.clientY - pointer.y);
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      el.addEventListener(type, (e) => {
        if (e.pointerId !== pointer?.id) return;
        e.preventDefault();
        cancel();
      });
  }
  function bindStick(stick, knobElement) {
    knob = knobElement;
    const move = (e) => {
      if (e.pointerId !== joy.id) return;
      const r = stick.getBoundingClientRect(),
        dx = e.clientX - r.x - r.width / 2,
        dy = e.clientY - r.y - r.height / 2,
        m = Math.max(35, Math.hypot(dx, dy));
      joy.x = dx / m;
      joy.y = dy / m;
      knob.style.transform = `translate(${joy.x * 30}px,${joy.y * 30}px)`;
    };
    stick.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      joy.id = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      move(e);
    });
    stick.addEventListener("pointermove", move);
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      stick.addEventListener(type, (e) => {
        if (e.pointerId === joy.id) {
          joy.id = null;
          joy.x = joy.y = 0;
          knob.style.transform = "";
        }
      });
  }
  // Touch drags look around; a mouse locks the pointer, left button is primary and right is secondary.
  function bindCanvas(canvas, { primary, secondary, wheel, lockFailed }) {
    canvas.addEventListener("pointerdown", (e) => {
      if (!canControl()) return;
      if (e.pointerType === "mouse") {
        if (e.button === 2) {
          secondary();
          return;
        }
        if (document.pointerLockElement === canvas) primary(true);
        else canvas.requestPointerLock?.()?.catch?.(() => lockFailed?.());
        return;
      }
      look.id = e.pointerId;
      look.x = e.clientX;
      look.y = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!canControl()) return;
      let dx = 0,
        dy = 0;
      if (e.pointerType === "mouse" && document.pointerLockElement === canvas) {
        dx = e.movementX;
        dy = e.movementY;
      } else if (e.pointerId === look.id) {
        dx = e.clientX - look.x;
        dy = e.clientY - look.y;
        look.x = e.clientX;
        look.y = e.clientY;
      }
      rotateLook(dx, dy);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
      canvas.addEventListener(type, (e) => {
        if (e.pointerType === "mouse") primary(false);
        if (e.pointerId === look.id) look.id = null;
      });
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (!canControl()) return;
        e.preventDefault();
        wheel(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false },
    );
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  // Bag, menu and text-field rules are common; everything else goes to the map's onKey.
  function bindKeyboard({ isRunning, toggleBag, togglePause, onKey }) {
    window.addEventListener("keydown", (e) => {
      if (isEditing()) return;
      if (
        e.code !== "Escape" &&
        e.target.closest?.("input, textarea, select, [contenteditable=true]")
      )
        return;
      if (e.target.closest?.("#frontierPanel") && e.code !== "Escape") return;
      if (["Space", "Tab", "ArrowUp", "ArrowDown"].includes(e.code))
        e.preventDefault();
      if (["KeyI", "Tab"].includes(e.code) && isRunning() && !e.repeat) {
        toggleBag();
        return;
      }
      if (e.code === "Escape") {
        togglePause();
        return;
      }
      if (!canControl()) return;
      onKey(e);
    });
    window.addEventListener("keyup", (e) => keys.delete(e.code));
  }
  function stop() {
    for (const cancel of holds) cancel();
    keys.clear();
    joy.x = joy.y = 0;
    joy.id = null;
    look.id = null;
    if (knob) knob.style.transform = "";
  }
  // Movement axes from keys and the stick: forward is +1, right is +1.
  function axes() {
    return {
      forward: (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0) - joy.y,
      side: (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0) + joy.x,
    };
  }
  return { keys, joy, look, holdButton, bindStick, bindCanvas, bindKeyboard, stop, axes };
}

// ---- Movement buttons ----
let signature = "";
/** riding: controlling a vehicle; flying: vertical control (jump rises, descend lowers); brake: show the brake button. */
export function showMovementState({ riding = false, flying = false, freeFlying = false, brake = false, stance = "stand", stanceBlocked = false, sprinting = false, sprintLatched = false }) {
  const next = [riding, flying, freeFlying, brake, stance, stanceBlocked, sprinting, sprintLatched].join(":");
  if (next === signature) return;
  signature = next;
  document.body.classList.toggle("piloting", riding);
  document.body.classList.toggle("freeFlying", freeFlying);
  for (const [id, posture] of [
    ["crouchBtn", "crouch"],
    ["crawlBtn", "crawl"],
  ]) {
    $(id).classList.toggle("enabled", !riding && stance === posture);
    $(id).setAttribute("aria-pressed", String(!riding && stance === posture));
    $(id).hidden = riding;
  }
  $("sprintBtn").classList.toggle("enabled", sprintLatched || sprinting);
  $("sprintBtn").setAttribute("aria-pressed", String(sprintLatched || sprinting));
  $("sprintBtn").hidden = riding;
  $("descendBtn").hidden = !flying;
  $("brakeBtn").hidden = !brake;
  $("jumpBtn").querySelector("small").textContent = flying ? "상승" : riding ? "제동" : "점프";
  $("jumpBtn").setAttribute("aria-label", flying ? "상승 · 기수 올리기" : riding ? "제동" : "점프");
  $("movementState").textContent = riding
    ? flying
      ? "비행 조종"
      : "차량 조종"
    : stanceBlocked
      ? "천장 낮음"
      : sprinting
        ? "달리기"
        : STANCES[stance || "stand"].label;
}
// Crouch and crawl buttons toggle back to standing; the controller refuses when the ceiling is low.
export function changeStance(controller, player, stance, notify) {
  const target = player.stance === stance ? "stand" : stance;
  controller.requestStance(target);
  controller.updateStance(target);
  if (player.stanceBlocked) notify("천장이 낮아 일어설 수 없습니다. 밖으로 이동하세요.");
}
// Sprint latches only while standing; returns the new latch state.
export function changeSprint(controller, player, latched, notify) {
  if (player.stance !== "stand") {
    controller.requestStance("stand");
    controller.updateStance("stand");
    if (player.stanceBlocked) {
      notify("일어설 공간이 필요합니다.");
      return latched;
    }
  }
  return !latched;
}

// ---- Sandbox tools (개발·생태 tab) ----
export const SANDBOX_TOOLS = { 0: ["관찰 렌즈", "생명·지형 정보 읽기"], 4: ["물 붓기", "조준한 곳에 물 추가"], 5: ["불 붙이기", "조준한 칸에 불 붙이기"], 6: ["산 붓기", "조준한 곳에 산 추가"], 8: ["개체 생성", "조준한 곳에 동물 1마리"] };

// ---- Settings ----
export const SETTINGS_KEY = "feral.settings";
export function readSettings(storage = localStorage) {
  try {
    return JSON.parse(storage.getItem(SETTINGS_KEY) || "null");
  } catch {
    return null;
  }
}
function persist() {
  localStorage.setItem(
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
// view needs qualitySet(q) and a perspective camera. Returns live values the map reads each frame.
export function initSettings({ view, onRadar = () => {}, onLeftHand = () => {} }) {
  const state = { sensitivity: 0.8, sound: true };
  const settings = readSettings();
  if (settings) {
    $("quality").value = settings.quality || "balanced";
    $("sensitivity").value = settings.sensitivity || 80;
    $("fov").value = settings.layoutVersion === 2 ? settings.fov || 82 : 82;
    $("sound").checked = settings.sound !== false;
    $("leftHand").checked = !!settings.leftHand;
    $("showRadar").checked = !!settings.showRadar;
    $("showEvents").checked = !!settings.showEvents;
    document.body.classList.toggle("showRadar", $("showRadar").checked);
    document.body.classList.toggle("showEvents", $("showEvents").checked);
    state.sensitivity = $("sensitivity").value / 100;
    state.sound = $("sound").checked;
    document.body.classList.toggle("leftHand", $("leftHand").checked);
    view.qualitySet($("quality").value);
    view.camera.fov = +$("fov").value;
    view.camera.updateProjectionMatrix();
  }
  $("quality").onchange = () => {
    view.qualitySet($("quality").value);
    persist();
  };
  $("sensitivity").oninput = () => {
    state.sensitivity = $("sensitivity").value / 100;
    persist();
  };
  $("fov").oninput = () => {
    view.camera.fov = +$("fov").value;
    view.camera.updateProjectionMatrix();
    persist();
  };
  $("sound").onchange = () => {
    state.sound = $("sound").checked;
    persist();
  };
  for (const id of ["showRadar", "showEvents"])
    $(id).onchange = () => {
      document.body.classList.toggle(id, $(id).checked);
      persist();
      if (id === "showRadar") onRadar();
    };
  $("leftHand").onchange = () => {
    document.body.classList.toggle("leftHand", $("leftHand").checked);
    persist();
    onLeftHand();
  };
  return state;
}

// ---- Pause menu, background saving, error screen ----
export function bindMenuTabs(onSelect = () => {}) {
  for (const b of document.querySelectorAll("[data-tab]"))
    b.onclick = () => selectTab(b.dataset.tab, onSelect);
}
export function selectTab(tab, onSelect = () => {}) {
  $("pauseScreen").classList.toggle("inventoryMode", tab === "bag");
  $("panelTitle").textContent = tab === "bag" ? "가방 · 제작" : "탐험 메뉴";
  document
    .querySelectorAll("[data-tab]")
    .forEach((x) => x.classList.toggle("active", x.dataset.tab === tab));
  document
    .querySelectorAll("[data-panel]")
    .forEach((x) => x.classList.toggle("hidden", x.dataset.panel !== tab));
  onSelect(tab);
}
export function showPauseScreen(paused, editing = false) {
  $("pauseScreen").classList.toggle("hidden", !paused || editing);
  document.body.classList.toggle("menuOpen", paused);
  if (paused) document.exitPointerLock?.();
}
// Saving and pausing when the app goes to the background works the same on every map.
export function bindBackground({ onHide, onUnload, onBlur }) {
  window.addEventListener("blur", () => {
    onBlur?.();
    onHide();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) onHide();
  });
  window.addEventListener("beforeunload", onUnload);
  window.addEventListener("pagehide", onUnload);
}
// The error screen for failures after the world started, shared by every map.
export function showError(err) {
  window.FeralUpdates?.failed();
  console.error(err);
  $("errorScreen").classList.remove("hidden");
  $("errorText").textContent =
    String(err?.message || err) +
    " · Android System WebView를 업데이트한 뒤 다시 실행해 주세요.";
}
export function installErrorScreen() {
  window.addEventListener("error", (e) => showError(e.error || e.message));
  window.addEventListener("unhandledrejection", (e) => showError(e.reason));
}

// ---- Field HUD ----
const pips = (kind) =>
  `<div class="pipTrack ${kind}" aria-hidden="true">${"<i><b></b></i>".repeat(10)}</div>`;
export function fillPips(track, value) {
  const amount = Math.ceil(Math.max(0, Math.min(100, value)) / 5);
  if (track.dataset.amount === String(amount)) return;
  track.dataset.amount = amount;
  [...track.children].forEach((pip, i) => {
    pip.firstChild.style.width = `${Math.min(2, Math.max(0, amount - i * 2)) * 50}%`;
  });
}
export function mountFieldHUD({ onJournal, onStatus, onInteract, journalLabel = "원정 지도" }) {
  const hud = document.createElement("div");
  hud.id = "frontierHUD";
  hud.innerHTML = `<div id="vitals"><span id="healthText" class="srOnly"></span><meter id="health" class="srOnly" min="0" max="100" value="100" aria-label="체력"></meter>${pips("hearts")}<b id="levelHUD"></b>${pips("hunger")}<small id="hungerText" class="srOnly"></small><progress id="experienceHUD" max="80" value="0" aria-label="다음 레벨 경험치"></progress></div>
      <div id="waypoint"></div><div id="frontierActions"><button id="journalBtn" aria-label="${journalLabel}"><span aria-hidden="true">▧</span><small>지도</small></button><button id="statusBtn" aria-label="캐릭터 상태"><span aria-hidden="true">♟</span><small>상태</small></button><button id="interactBtn">상호작용 <small>R</small></button></div>`;
  $("hud").append(hud);
  $("journalBtn").onclick = onJournal;
  $("statusBtn").onclick = onStatus;
  $("interactBtn").onclick = onInteract;
  $("journalBtn").querySelector("span").innerHTML = uiIcon("map");
  $("statusBtn").querySelector("span").innerHTML = uiIcon("person");
  return hud;
}
// Current objective button; it opens the journey page of the game window.
export function mountJourney(onClick) {
  const button = document.createElement("button");
  button.id = "journeyHUD";
  button.setAttribute("aria-label", "여정과 현재 목표");
  button.innerHTML = "<b></b><small></small>";
  button.onclick = onClick;
  $("frontierHUD").append(button);
  return button;
}
export function setJourney(button, title, detail, ready = false) {
  if (button.firstChild.textContent !== title) button.firstChild.textContent = title;
  if (button.lastChild.textContent !== detail) button.lastChild.textContent = detail;
  button.classList.toggle("ready", ready);
}
export function setVitals({ hp, maxHp, food, level = "", xp = 0, xpMax = 80, healthText, foodText, hurt = false }) {
  $("healthText").textContent = healthText;
  $("health").max = maxHp;
  $("health").value = hp;
  fillPips($("vitals").querySelector(".hearts"), (hp / maxHp) * 100);
  fillPips($("vitals").querySelector(".hunger"), food);
  $("levelHUD").textContent = level;
  $("experienceHUD").max = xpMax;
  $("experienceHUD").value = xp;
  $("hungerText").textContent = foodText;
  $("vitals").classList.toggle("hurt", hurt);
}
// Screen-relative arrow, name and distance to a destination.
export function waypointText(player, target) {
  const dx = target.x - player.x,
    dz = target.z - player.z;
  const angle = Math.atan2(
    Math.cos(player.yaw) * dx - Math.sin(player.yaw) * dz,
    -Math.sin(player.yaw) * dx - Math.cos(player.yaw) * dz,
  );
  const arrow =
    Math.abs(angle) < 0.5 ? "↑" : Math.abs(angle) > 2.5 ? "↓" : angle > 0 ? "→" : "←";
  return `${arrow} ${target.name} · ${Math.round(Math.hypot(dx, dz))} m`;
}

// ---- Character sheet (the frontier's status page, shared by every map) ----
const escapeHTML = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Portrait, equipped slots, meters, combat stats, effects, quick actions, milestones and the log.
 * `button(label, onClick, id)` makes the ledger's buttons; each action is {label, short, id, art|icon, count, disabled, onClick}. */
export function renderCharacterSheet(root, sheet, button) {
  const { name = "개척자", level = 1, state = "", figureLabel = "개척자 · 끌어 회전", armored = false, slots = [], meters = [], stats = [], effects = "", actions = [], milestones = [], log = [], logTitle = "원정 기록", portrait = {} } = sheet;
  root.innerHTML = `<div class="characterSheet"><div class="characterFigure"><div class="characterStage ${armored ? "armored" : ""}"><span>${escapeHTML(figureLabel)}</span></div><div class="equippedSlots">${slots.map((s) => `<div class="${s.className ?? ""}" title="${escapeHTML(s.title ?? s.label)}">${s.art}<small>${escapeHTML(s.label)}</small></div>`).join("")}</div></div>
      <div class="characterStats"><div class="characterName"><h3>${escapeHTML(name)} <small>LV.</small> ${level}</h3><span>${escapeHTML(state)}</span></div>
      ${meters.map((m) => `<div class="statMeter ${m.kind}"><label>${escapeHTML(m.label)} <b>${escapeHTML(m.text)}</b></label><progress max="${m.max}" value="${m.value}"></progress></div>`).join("\n      ")}
      <dl class="combatStats">${stats.map(([term, value]) => `<div><dt>${escapeHTML(term)}</dt><dd>${escapeHTML(value)}</dd></div>`).join("")}</dl>
      <p class="activeEffects">${effects || "음식·강장제의 효과가 여기에 표시됩니다."}</p>
      <div id="supplies" class="supplySlots"></div></div></div>
      <div class="milestoneStrip">${milestones.map(([icon, count, label]) => `<span>${icon} <b>${count}</b> ${escapeHTML(label)}</span>`).join("")}</div>
      <details class="expeditionLog"><summary>${escapeHTML(logTitle)} <span>${log.length}</span></summary><ol>${log.map((t) => `<li>${escapeHTML(t)}</li>`).join("") || "<li>첫 원정을 시작했습니다.</li>"}</ol></details>`;
  mountCharacterPortrait(root.querySelector(".characterStage"), { armored, ...portrait });
  const supplies = root.querySelector("#supplies");
  for (const a of actions) {
    const b = button(a.label, a.onClick, a.id);
    b.setAttribute("aria-label", a.label);
    b.innerHTML = a.art
      ? `${a.art}<b class="supplyCount">${a.count ?? ""}</b><small>${escapeHTML(a.short)}</small>`
      : `<b aria-hidden="true">${a.icon}</b><small>${escapeHTML(a.short)}</small>`;
    b.disabled = !!a.disabled;
    supplies.append(b);
  }
  return root.querySelector(".characterSheet");
}

// ---- Map page (the frontier's map: a map on the left, destinations on the right) ----
/** `map` is HTML or an element; each destination is {name, distance, id, onSelect}. */
export function renderMapPage(root, { title, subtitle = "", map = "", footer = "", destinations = [] }, button) {
  root.innerHTML = `<div class="mapLayout"><div class="regionMap"><h3>${escapeHTML(title)}</h3><small>${escapeHTML(subtitle)}</small><div class="mapBody"></div><p>${footer}</p></div><div class="destinationList"><h3>목적지 표시</h3><div id="destinations"></div><p>목적지를 선택하면 탐험 화면에 방향과 거리를 표시합니다.</p></div></div>`;
  const body = root.querySelector(".mapBody");
  if (typeof map === "string") body.innerHTML = map;
  else if (map) body.append(map);
  for (const d of destinations) root.querySelector("#destinations").append(button(`${d.name} · ${Math.round(d.distance)} m`, d.onSelect, d.id));
}

// ---- Ledger window ----
export class GameWindow {
  /** tabs: [{id, label, ariaLabel, icon}], titles: {tab: title}. */
  constructor({ tabs, titles, initial, label = "원정 장부", canOpen = () => true, onOpen = () => {}, onClose = () => {}, render = () => {} }) {
    this.tabs = tabs;
    this.titles = titles;
    this.canOpen = canOpen;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.renderTab = render;
    this.tab = initial ?? tabs[0].id;
    const panel = document.createElement("section");
    panel.id = "frontierPanel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "frontierTitle");
    panel.innerHTML = `<div class="gameWindow"><header><h2 id="frontierTitle"></h2><button id="frontierClose" aria-label="${label} 닫기">×</button></header>
      <nav aria-label="${label} 메뉴">${tabs.map((t) => `<button data-frontier-tab="${t.id}" aria-label="${t.ariaLabel || t.label}"><b aria-hidden="true">${uiIcon(t.icon)}</b><span>${t.label}</span></button>`).join("")}</nav>
      <div id="frontierContent"></div><p id="frontierFeedback" role="status" aria-live="polite"></p></div>`;
    document.body.append(panel);
    this.panel = panel;
    $("frontierClose").onclick = () => this.onClose();
    panel
      .querySelectorAll("[data-frontier-tab]")
      .forEach((b) => (b.onclick = () => this.open(b.dataset.frontierTab)));
    panel.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const buttons = [
        ...panel.querySelectorAll("button, select, summary"),
      ].filter((e) => !e.disabled && e.offsetParent);
      const first = buttons[0],
        last = buttons.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    });
  }
  get content() {
    return $("frontierContent");
  }
  get isOpen() {
    return !this.panel.hidden;
  }
  open(tab = this.tab) {
    if (!this.canOpen()) return;
    this.onOpen();
    $("pauseScreen").classList.add("hidden");
    this.panel.hidden = false;
    this.tab = tab;
    this.panel.dataset.page = tab;
    $("frontierTitle").textContent = this.titles[tab];
    this.panel.querySelectorAll("[data-frontier-tab]").forEach((b) => {
      b.classList.toggle("active", b.dataset.frontierTab === tab);
      b.setAttribute("aria-pressed", String(b.dataset.frontierTab === tab));
    });
    this.feedback("");
    this.render();
    this.content.scrollTop = 0;
    $("frontierClose").focus({ preventScroll: true });
  }
  close() {
    this.panel.hidden = true;
  }
  render() {
    this.renderTab(this.tab, this.content);
  }
  feedback(message) {
    $("frontierFeedback").textContent = message;
  }
  button(label, fn, id) {
    const b = document.createElement("button");
    b.textContent = label;
    if (id) b.id = id;
    b.onclick = () => {
      const result = fn();
      if (typeof result === "string") this.feedback(result);
    };
    return b;
  }
}
