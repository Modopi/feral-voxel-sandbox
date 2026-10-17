import { InventoryUI } from "./inventory-ui.js";
import { HudEditor } from "./hud-editor.js";
import {
  DEFAULT_EDIT_SIZE,
  EDIT_GRID_VERSION,
  restoreEditGrid,
  editSizeLabel,
} from "./edit-grid.js";
import { itemArt } from "./item-art.js";
import {
  GEAR,
  activeGear,
  gearId,
  spendGear,
  miningWork,
  MiningProgress,
} from "./equipment.js";
const miningProgress = new MiningProgress();
let nextStrike = 0;
import { currentWorld, saveKey } from "./world-slots.js";
const activeWorld = currentWorld(
  localStorage,
  ["island", "frontier"],
  location.search,
);
import { Frontier } from "./frontier/model.js";
import { frontierWorld } from "./frontier/terrain.js";
import { FrontierView } from "./frontier/view.js";
let frontierState = null,
  frontierUI = null,
  regionCache = {};
import { World, B, SIZE, HEIGHT, COLORS, clamp } from "./world.js";
import { Ecology, SPECIES } from "./entities.js";
import { View, T } from "./render.js";
import { VERSION } from "./version.js";
import { initUpdates } from "./updates.js";
import {
  CharacterController,
  FIXED_DT,
  EYE_HEIGHT,
  bodyHeight,
  STANCES,
  BODY_RADIUS,
} from "./physics.js";
import {
  Inventory,
  Pickups,
  ITEMS,
  RECIPES,
  resourceForBlock,
} from "./inventory.js";
let inventory = new Inventory(),
  loot = new Pickups(),
  controller,
  miningSize = DEFAULT_EDIT_SIZE,
  buildSize = DEFAULT_EDIT_SIZE,
  buildMaterial = "dirt",
  bagUI = null,
  hudEditor = null,
  physicsAccum = 0,
  physicsTick = 0,
  lastInventoryRevision = -1,
  collectedMessage = 0;
const $ = (id) => document.getElementById(id),
  storageKey = saveKey(activeWorld);

let world,
  eco,
  view,
  ready = false,
  running = false,
  paused = false,
  selected = 0,
  playTime = 0,
  simAccum = 0,
  flowAccum = 0,
  saveTimer = 0,
  hudTimer = 0,
  last = 0,
  fpsFrames = 0,
  fpsTime = 0,
  fps = 0,
  frameTimes = [],
  discovered = new Set(),
  toastTimer = 0,
  eventTimer = 0,
  sensitivity = 0.8,
  soundEnabled = true,
  audio,
  useHeld = false,
  useCooldown = 0,
  actionHeld = false,
  actionCooldown = 0,
  walkSound = 0,
  benchmarkStart = 0,
  benchmarkSamples = [],
  resetOnReturn = false,
  sprintLatched = false;
const keys = new Set(),
  joy = { x: 0, y: 0, id: null },
  look = { id: null, x: 0, y: 0 };
const player = {
  x: 77.5,
  y: 16,
  z: 84.5,
  yaw: -0.5,
  pitch: -0.08,
  vy: 0,
  grounded: false,
  flying: false,
};
const eventLog = [];
function toast(s) {
  $("toast").textContent = s;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2600);
}
function reportError(err) {
  window.FeralUpdates?.failed();
  console.error(err);
  $("errorScreen").classList.remove("hidden");
  $("errorText").textContent =
    String(err?.message || err) +
    " · Android System WebView를 업데이트한 뒤 다시 실행해 주세요.";
}
window.addEventListener("error", (e) => reportError(e.error || e.message));
window.addEventListener("unhandledrejection", (e) => reportError(e.reason));
function sound(kind) {
  if (!soundEnabled) return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    const o = audio.createOscillator(),
      g = audio.createGain();
    o.type = kind === "pulse" ? "sawtooth" : "sine";
    o.frequency.setValueAtTime(
      kind === "pulse"
        ? 190
        : kind === "water"
          ? 550
          : kind === "step"
            ? 75
            : 780,
      audio.currentTime,
    );
    o.frequency.exponentialRampToValueAtTime(
      kind === "pulse" ? 55 : kind === "step" ? 40 : 250,
      audio.currentTime + 0.14,
    );
    g.gain.setValueAtTime(kind === "step" ? 0.015 : 0.035, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.16);
    o.connect(g);
    g.connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.17);
  } catch {}
}
function event(s, p) {
  if (p && Math.hypot(p[0] - player.x, p[2] - player.z) > 35) return;
  eventLog.unshift(s);
  eventLog.length = Math.min(3, eventLog.length);
  $("events").replaceChildren(
    ...eventLog.map((s) => {
      const d = document.createElement("div");
      d.textContent = s;
      return d;
    }),
  );
  clearTimeout(eventTimer);
  eventTimer = setTimeout(() => {
    $("events").textContent = "";
    eventLog.length = 0;
  }, 6000);
}
function heldItem() {
  return inventory.slots[inventory.selectedSlot]?.id || null;
}
function syncHeld() {
  const id = heldItem();
  selected =
    GEAR[id]?.slot === "weapon"
      ? 1
      : GEAR[id]?.slot === "tool"
        ? 2
        : ITEMS[id]?.block
          ? 3
          : id === "seed"
            ? 7
            : 0;
  if (GEAR[id]) inventory.equipment[GEAR[id].slot] = id;
  if (ITEMS[id]?.block) buildMaterial = id;
  miningProgress.reset();
  updateToolLabel();
  renderHotbar();
}
function selectHotbar(n) {
  inventory.select(n);
  syncHeld();
}
// Compatibility for simulation fixtures and existing developer controls.
function selectTool(n) {
  const id =
    n === 1
      ? inventory.equipment.weapon
      : n === 2
        ? inventory.equipment.tool
        : n === 3
          ? buildMaterial
          : n === 7
            ? "seed"
            : null;
  const index = inventory.slots.findIndex((s) => s?.id === id);
  if (index >= 0) {
    if (index >= 9) inventory.move(index, inventory.selectedSlot);
    selectHotbar(index < 9 ? index : inventory.selectedSlot);
  } else {
    selected = n;
    updateToolLabel();
  }
}
function renderHotbar() {
  const bar = $("hotbar");
  bar.replaceChildren();
  for (let i = 0; i < 9; i++) {
    const stack = inventory.slots[i],
      id = stack?.id,
      b = document.createElement("button");
    b.className = "slot" + (inventory.selectedSlot === i ? " selected" : "");
    b.dataset.hotbar = i;
    b.setAttribute(
      "aria-label",
      `핫바 ${i + 1} · ${id ? ITEMS[id].name + " " + stack.count + "개" : "빈 칸"}`,
    );
    b.setAttribute("aria-pressed", String(inventory.selectedSlot === i));
    b.innerHTML =
      `<span class="num">${i + 1}</span>` +
      (id
        ? itemArt(id) +
          (stack.count > 1 ? `<b class="stackCount">${stack.count}</b>` : "") +
          (GEAR[id]?.durability
            ? `<progress class="durability" max="${GEAR[id].durability}" value="${inventory.wear[id] || 0}"></progress>`
            : "")
        : "");
    b.onclick = () => selectHotbar(i);
    bar.append(b);
  }
}
bagUI = new InventoryUI({
  get inventory() {
    return inventory;
  },
  get frontier() {
    return !!frontierState;
  },
  craft,
  toast,
  changed: syncHeld,
  renderHotbar,
});
renderHotbar();
function home() {
  Object.assign(player, {
    x: 77.5,
    z: 84.5,
    y: world.surface(77.5, 84.5),
    yaw: -0.5,
    pitch: -0.1,
    vy: 0,
    flying: false,
    grounded: true,
    stance: "stand",
  });
  controller?.reset();
  $("flyBtn").classList.remove("enabled");
}
function toggleStance(stance) {
  if (!running || paused || frontierState?.riding) return;
  sprintLatched = false;
  const target = player.stance === stance ? "stand" : stance;
  controller.requestStance(target);
  controller.updateStance(target);
  if (player.stanceBlocked)
    toast("천장이 낮아 일어설 수 없습니다. 밖으로 이동하세요.");
  updateMovementHud();
}
let movementHudSignature = "";
function updateMovementHud() {
  const signature = [
    frontierState?.riding,
    frontierState?.airborne,
    player.stance,
    player.stanceBlocked,
    player.sprinting,
    sprintLatched,
  ].join(":");
  if (signature === movementHudSignature) return;
  movementHudSignature = signature;
  const riding = !!frontierState?.riding,
    flying = !!frontierState?.airborne;
  document.body.classList.toggle("piloting", riding);
  for (const [id, stance] of [
    ["crouchBtn", "crouch"],
    ["crawlBtn", "crawl"],
  ]) {
    $(id).classList.toggle("enabled", !riding && player.stance === stance);
    $(id).setAttribute(
      "aria-pressed",
      String(!riding && player.stance === stance),
    );
    $(id).hidden = riding;
  }
  $("sprintBtn").classList.toggle(
    "enabled",
    sprintLatched || !!player.sprinting,
  );
  $("sprintBtn").setAttribute(
    "aria-pressed",
    String(sprintLatched || !!player.sprinting),
  );
  $("sprintBtn").hidden = riding;
  $("descendBtn").hidden = !flying;
  $("jumpBtn").querySelector("small").textContent = flying
    ? "상승"
    : riding
      ? "제동"
      : "점프";
  $("jumpBtn").setAttribute(
    "aria-label",
    flying ? "상승 · 기수 올리기" : riding ? "제동" : "점프",
  );
  $("movementState").textContent = riding
    ? flying
      ? "비행 조종"
      : "차량 조종"
    : player.stanceBlocked
      ? "천장 낮음"
      : player.sprinting
        ? "달리기"
        : STANCES[player.stance || "stand"].label;
}
function inputState() {
  return {
    forward: (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0) - joy.y,
    side: (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0) + joy.x,
    jump: keys.has("Space"),
    up: keys.has("KeyE"),
    down: keys.has("KeyQ"),
    sprint: keys.has("ShiftLeft") || keys.has("ShiftRight") || sprintLatched,
  };
}
function renderCamera(alpha) {
  const p = controller.render(alpha);
  view.camera.position.set(p.x, p.y, p.z);
  view.camera.rotation.set(player.pitch, player.yaw, 0, "YXZ");
  view.camera.updateMatrixWorld(true);
}
function blockRay(max = 6.5) {
  const d = new T.Vector3();
  view.camera.getWorldDirection(d);
  return world.raycast(view.camera.position, d, max);
}
function bindDrops() {
  world.event = event;
  eco.onVoxel = (d) => loot.spawn("bio", 1, d.x, d.y, d.z, d);
  eco.onDeath = (e) => {
    if (e.type !== 2)
      loot.spawn("meat", e.type === 0 ? 2 : 1, e.x, e.y + 0.35, e.z);
    loot.spawn(
      e.type === 2 ? "crystal" : "essence",
      e.type === 1 ? 3 : 1,
      e.x,
      e.y + 0.3,
      e.z,
    );
    loot.spawn("bio", e.type === 1 ? 8 : 4, e.x + 0.15, e.y + 0.3, e.z);
  };
  loot.onCollect = (id, n) => {
    if (world.time - collectedMessage > 0.3) {
      toast("수집 +" + n + " " + ITEMS[id].name);
      collectedMessage = world.time;
    }
  };
}
function updateToolLabel() {
  const id = heldItem(),
    g = GEAR[id];
  $("toolName").textContent = id ? ITEMS[id].name : "빈 손";
  $("toolHelp").textContent = g?.durability
    ? `내구 ${inventory.wear[id] || 0}/${g.durability}`
    : ITEMS[id]?.block
      ? `보유 ${inventory.count(id)} · 설치 ${buildSize === 1 ? 8 : 1}조각`
      : "선택한 아이템 사용";
  $("rangeBtn").textContent =
    (selected === 3 ? "설치 " : "채굴 ") +
    editSizeLabel(selected === 3 ? buildSize : miningSize) +
    " ↻";
  $("rangeBtn").classList.toggle("hidden", selected !== 2 && selected !== 3);
  $("actBtn").firstChild.textContent = "⚒";
  $("actBtn").querySelector("small").textContent = "공격·캐기";
  $("useBtn").querySelector("small").textContent = ITEMS[id]?.block
    ? `놓기 ×${buildSize === 1 ? 8 : 1}`
    : id === "food" || id === "medicine"
      ? "먹기"
      : id === "seed"
        ? "먹이·심기"
        : "상호작용";
  if (ITEMS[id]?.machinePart) {
    $("useBtn").querySelector("small").textContent = "붙이기";
    $("toolHelp").textContent = "0.5m 부품 · 면에 붙이기";
  }
  if (id === "wrench") {
    $("actBtn").querySelector("small").textContent = "부품 회수";
    $("useBtn").querySelector("small").textContent = "고정 전환";
    $("toolHelp").textContent = "공격: 회수 · 사용: 고정/해제";
  }
  if (id === "iron")
    $("useBtn").querySelector("small").textContent = "부품 수리";
  view?.setHeldItem(id);
  $("hint").textContent = "1–9 아이템 · I 가방";
}
function cycleRange() {
  if (selected === 3) buildSize = buildSize === 1 ? 0.5 : 1;
  else {
    const sizes = inventory.unlocks.has("hammer") ? [0.5, 1, 2] : [0.5, 1];
    miningSize = sizes[(sizes.indexOf(miningSize) + 1) % sizes.length];
    if (selected !== 2) selectTool(2);
  }
  miningProgress.reset();
  updateToolLabel();
  sound("scan");
}
function refreshInventory() {
  bagUI?.render();
  $("bagCount").textContent = inventory.slots.filter(Boolean).length;
  lastInventoryRevision = inventory.revision;
}
function craft(id) {
  const ok = inventory.craft(id);
  toast(
    ok
      ? RECIPES.find((r) => r.id === id).name + " 제작 완료 · 빈 슬롯에 보관"
      : "재료·빈 칸 또는 선행 연구를 확인하세요.",
  );
  if (ok) sound("scan");
  frontierState?.provisionMachine(inventory);
  refreshInventory();
  syncHeld();
  return ok;
}
function openBag() {
  pause(true);
  document.querySelector('[data-tab="bag"]').click();
  refreshInventory();
}
function buildTarget(hit) {
  if (!hit) return null;
  const n = buildSize === 1 ? 2 : 1;
  let start;
  if (n === 1)
    start = [
      hit.hx + hit.normal[0],
      hit.hy + hit.normal[1],
      hit.hz + hit.normal[2],
    ];
  else {
    const p = hit.point.map((v, i) => v + hit.normal[i] * 0.01);
    start = p.map((v) => Math.floor(v) * 2);
  }
  return { start, n, size: buildSize };
}
function intersectsPlayer(start, size) {
  const a = start.map((v) => v * 0.5);
  return (
    a[0] < player.x + BODY_RADIUS &&
    a[0] + size > player.x - BODY_RADIUS &&
    a[2] < player.z + BODY_RADIUS &&
    a[2] + size > player.z - BODY_RADIUS &&
    a[1] < player.y + bodyHeight(player) &&
    a[1] + size > player.y
  );
}
function harvest(hit, size) {
  const r = world.mine(hit, size);
  if (!r.removed) {
    toast("기반암과 용암은 채굴할 수 없습니다.");
    return false;
  }
  const p = hit.point.map((v, i) => v + hit.normal[i] * 0.2);
  for (const [b, n] of r.counts) {
    const item = resourceForBlock(b);
    if (item) loot.spawn(item, n, ...p);
    if (b === B.GRASS && n >= 4) loot.spawn("seed", 1, ...p);
  }
  view.rebuild(5);
  sound("pulse");
  return true;
}
function target() {
  const range = selected === 1 ? activeGear(inventory, "weapon").range : 6.5;
  const block = blockRay(range),
    d = new T.Vector3();
  view.camera.getWorldDirection(d);
  const ent = eco.ray(
    view.camera.position,
    d,
    Math.min(range, block?.distance || range),
    world.time,
  );
  return { block, ent };
}
function use(intent = "selected") {
  if (!running || paused) return;
  const held = heldItem();
  const aimed = target();
  if (
    intent !== "secondary" &&
    GEAR[held]?.durability &&
    !inventory.wear[held]
  ) {
    toast("도구가 부서졌습니다. 가방에서 수리하거나 다른 아이템을 선택하세요.");
    return;
  }
  if (frontierUI?.assemblyUse(intent, held, aimed.block, aimed.ent?.distance)) {
    syncHeld();
    return;
  }
  if (intent === "secondary") {
    if (["food", "medicine"].includes(held)) {
      if (world.time < nextStrike) return;
      nextStrike = world.time + 0.5;
      toast(
        frontierState
          ? frontierState.consume(held, inventory)
          : "개척 원정에서 사용하는 보급품입니다.",
      );
      syncHeld();
      return;
    }
    if (held === "seed" && aimed.ent) {
      if (world.time < nextStrike) return;
      nextStrike = world.time + 0.5;
      toast(eco.feed(aimed.ent.entity, inventory, world.time));
      syncHeld();
      return;
    }
    if (!ITEMS[held]?.block && held !== "seed") {
      frontierUI?.interact();
      return;
    }
  }
  let action = selected;
  if (intent === "primary")
    action =
      aimed.ent || (GEAR[held]?.slot === "weapon" && frontierUI?.bossTarget())
        ? 1
        : 2;
  if (world.time < nextStrike) return;
  nextStrike =
    world.time +
    (action === 1
      ? activeGear(inventory, "weapon").cooldown
      : action === 2
        ? 0.18
        : 0.3);
  if (GEAR[held]?.slot === "weapon" && frontierUI?.use(action)) {
    updateToolLabel();
    return;
  }
  const { block, ent } = target();
  view.toolKick = 1;
  if (action === 0) {
    if (ent) {
      const e = ent.entity;
      toast(
        SPECIES[e.type].name +
          " · " +
          SPECIES[e.type].parts[ent.part].name +
          ` · 체력 ${Math.ceil(e.hp)}/${e.maxHP} · 머리·몸통 파괴 또는 HP 0이면 사망 · 에너지 ` +
          Math.round(e.energy) +
          " · 다리 " +
          eco.legs(e) +
          "/4",
      );
    } else if (block)
      toast(
        "지형 " +
          (world.subcells.has(world.index(block.x, block.y, block.z))
            ? "0.5"
            : "1") +
          " m · 거리 " +
          block.distance.toFixed(2) +
          ` m · 플레이어 ${bodyHeight(player)} m`,
      );
    else toast("6.5 m 이내의 생명이나 지표를 관찰하세요.");
    sound("scan");
    return;
  }
  if (action === 1) {
    if (ent && ent.distance <= (GEAR[held]?.range || 3)) {
      const g =
          GEAR[held]?.slot === "weapon"
            ? activeGear(inventory, "weapon")
            : {
                damage: GEAR[held]?.slot === "tool" ? 6 : 4,
                range: 3,
                radius: 0.12,
                cooldown: 0.5,
              },
        before = ent.entity.hp;
      if (GEAR[held]?.slot === "weapon" && !spendGear(inventory, "weapon")) {
        toast("화살이 필요합니다. 가방에서 제작하세요.");
        return;
      }
      eco.damageHit(
        ent,
        world.time,
        g === GEAR.pulse && inventory.unlocks.has("pulse") ? 0.3 : g.radius,
        g === GEAR.pulse && inventory.unlocks.has("blade") ? 24 : g.damage,
      );
      const e = ent.entity;
      toast(
        e.dead
          ? `${SPECIES[e.type].name} 처치 · ${e.deathCause}`
          : `피해 ${Math.ceil(before - e.hp)} · 체력 ${Math.ceil(e.hp)}/${e.maxHP}${ent.part === 1 ? " · 머리 치명타" : ""}`,
      );
      document.getElementById("crosshair")?.animate(
        [
          { transform: "scale(1.7)", color: "#ffbc87" },
          { transform: "scale(1)", color: "#fff" },
        ],
        { duration: 220 },
      );
      sound("pulse");
      updateToolLabel();
      updateAim();
    } else if (block) toast("대상에 더 가까이 다가가세요.");
    return;
  }
  if (!block) {
    toast("6.5 m 이내의 표면을 조준하세요.");
    return;
  }
  if (action === 2 && block.distance > 6.5) {
    toast("6.5m 안에서 채굴하세요.");
    return;
  }
  const outward = block.point.map((v, i) => v + block.normal[i] * 0.06),
    [x, y, z] = outward.map(Math.floor);
  if (action === 2) {
    const g =
      GEAR[held]?.slot === "tool" ? activeGear(inventory, "tool") : GEAR.pick;
    const key = `${block.hx},${block.hy},${block.hz}:${miningSize}:${gearId(inventory, "tool")}`;
    if (
      miningProgress.strike(key, world.time, miningWork(block.b, miningSize, g))
    ) {
      if (harvest(block, miningSize) && GEAR[held]?.slot === "tool")
        spendGear(inventory, "tool");
      miningProgress.reset();
    } else {
      sound("step");
      updateAim();
    }
  }
  if (action === 3) {
    const r = buildTarget(block),
      cost = r.n ** 3;
    if (inventory.count(buildMaterial) < cost) {
      toast(
        ITEMS[buildMaterial].name + " " + cost + "개 필요 · 가방에서 재료 확인",
      );
      return;
    }
    if (intersectsPlayer(r.start, r.size)) {
      toast("캐릭터와 겹치는 곳에는 설치할 수 없습니다.");
      return;
    }
    if (world.placeCells(r.start, r.size, ITEMS[buildMaterial].block)) {
      inventory.take(buildMaterial, cost);
      view.rebuild(5);
      sound("step");
    } else toast("빈 공간을 조준하세요.");
  }
  if (action === 4) {
    world.pour(x, y, z, 5, 0);
    sound("water");
  }
  if (action === 5) {
    world.ignite(block.x, block.y, block.z);
    sound("pulse");
  }
  if (action === 6) {
    world.pour(x, y, z, 3, 0.95);
    sound("water");
  }
  if (action === 7) {
    if (!inventory.take("seed", 1)) {
      toast("씨앗이 필요합니다. 풀을 채굴하거나 섬유로 제작하세요.");
      return;
    }
    for (
      let zz = Math.max(0, block.z - 2);
      zz <= Math.min(SIZE - 1, block.z + 2);
      zz++
    )
      for (
        let xx = Math.max(0, block.x - 2);
        xx <= Math.min(SIZE - 1, block.x + 2);
        xx++
      ) {
        const yy = Math.floor(world.surface(xx + 0.25, zz + 0.25) - 0.01);
        if ([B.DIRT, B.ASH, B.GRASS].includes(world.get(xx, yy, zz))) {
          world.set(xx, yy, zz, B.GRASS);
          world.plants[xx + zz * SIZE] = 1;
          world.nutrients[xx + zz * SIZE] = 1;
        }
      }
    toast("씨앗 −1 · 식생 복원");
    sound("scan");
  }
  if (action === 8) {
    const type = world.random() < 0.13 ? 1 : world.random() < 0.15 ? 2 : 0;
    eco.spawn(type, x + 0.5, z + 0.5);
    eco.rehash();
    toast(SPECIES[type].name + " 생성");
    sound("scan");
  }
  updateToolLabel();
  view.environment(world.time, true);
}
function setFlying() {
  if (frontierUI) {
    frontierUI.toggleFlight();
    return;
  }
  player.flying = !player.flying;
  player.vy = 0;
  controller?.reset();
  $("flyBtn").classList.toggle("enabled", player.flying);
  toast(
    player.flying ? "비행 · 위아래를 보며 이동 / ↑ 상승" : "걷기 · 중력 활성",
  );
}
function stopInput() {
  keys.clear();
  sprintLatched = false;
  joy.x = joy.y = 0;
  joy.id = null;
  look.id = null;
  actionHeld = false;
  useHeld = false;
  miningProgress.reset();
  $("knob").style.transform = "";
}
function pause(force) {
  if (!running) return;
  paused = force ?? !paused;
  stopInput();
  $("pauseScreen").classList.toggle(
    "hidden",
    !paused || hudEditor?.editing === true,
  );
  document.body.classList.toggle("menuOpen", paused);
  if (!paused) frontierUI?.close();
  if (paused) {
    document.exitPointerLock?.();
    updatePanels();
    refreshInventory();
  } else {
    last = performance.now();
    physicsAccum = 0;
    controller.reset(true);
    fpsFrames = 0;
    fpsTime = 0;
  }
}
function start(load = false) {
  if (!ready) return;
  try {
    if (load) {
      const s = JSON.parse(localStorage.getItem(storageKey));
      if (s && [1, 2].includes(s.version)) {
        world = makeWorld(s.world.seed);
        world.load(s.world);
        eco = new Ecology(world);
        if (s.eco) eco.load(s.eco);
        else eco.populate(100);
        inventory = new Inventory();
        if (s.inventory) inventory.load(s.inventory);
        loot = new Pickups();
        if (s.loot) loot.load(s.loot);
        ({ miningSize, buildSize } = restoreEditGrid(
          s,
          inventory.unlocks.has("hammer"),
        ));
        buildMaterial = ITEMS[s.buildMaterial]?.block
          ? s.buildMaterial
          : "dirt";
        view.world = world;
        world.event = event;
        playTime = s.playTime || 0;
        Object.assign(player, s.player);
        discovered = new Set(s.discovered || []);
        if (s.enterRegion) home();
        $("flyBtn").classList.toggle("enabled", player.flying);
      } else home();
    } else home();
    controller = new CharacterController(world, player);
    controller.recover();
    physicsAccum = 0;
    physicsTick = 0;
    syncHeld();
    nextStrike = 0;
    miningProgress.reset();
    bindDrops();
    renderCamera(1);
    updateToolLabel();
    refreshInventory();
    running = true;
    paused = false;
    document.body.classList.remove("menuOpen");
    frontierUI?.resetScene();
    $("titleScreen").classList.add("hidden");
    $("hud").classList.remove("hidden");
    hudEditor?.apply();
    $("pauseScreen").classList.add("hidden");
    if (!load)
      toast(
        frontierState
          ? "원정 장부에서 목적지 확인 · 강변 야영지로 이동하세요"
          : "아이템 선택 → 공격·캐기 / 놓기·사용 · 가방에서 제작",
      );
    sound("scan");
    last = performance.now();
    if (!window.AndroidApp)
      document.documentElement
        .requestFullscreen?.()
        .then(() => screen.orientation?.lock?.("landscape"))
        .catch(() => {});
    refreshAPI();
  } catch (e) {
    toast("저장을 읽지 못했습니다. 새 탐험을 시작할 수 있습니다.");
    console.error(e);
  }
}
function makeWorld(seed) {
  if (frontierState) return frontierWorld(seed, frontierState.info);
  const w = new World(seed);
  w.generate();
  return w;
}
function travel(dx, dz) {
  if (!frontierState || !running) return false;
  const before = frontierState.save(),
    beforeInventory = JSON.parse(JSON.stringify(inventory.save()));
  const runtime = {
    riding: frontierState.riding,
    airborne: frontierState.airborne,
  };
  const oldKey = frontierState.key;
  const error = frontierState.move(dx, dz, inventory, player);
  if (error) {
    toast(error);
    frontierUI?.feedback(error);
    return false;
  }
  const destination = regionCache[frontierState.key];
  const cache = {
    ...regionCache,
    [oldKey]: {
      world: world.save(),
      eco: eco.save(),
      loot: loot.save(),
      discovered: [...discovered],
    },
  };
  delete cache[frontierState.key];
  const state = {
    version: 2,
    campaign: frontierState.save(),
    regionCache: cache,
    inventory: inventory.save(),
    editGridVersion: EDIT_GRID_VERSION,
    miningSize,
    buildMaterial,
    buildSize,
    playTime,
    world: destination?.world || { seed: frontierState.info.seed },
    eco: destination?.eco,
    loot: destination?.loot,
    discovered: destination?.discovered || [],
    enterRegion: true,
    player: { ...player, flying: false },
  };
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    frontierState = Frontier.load(before);
    Object.assign(frontierState, runtime);
    inventory.load(beforeInventory);
    const message =
      "지역 저장 실패 · 공간을 확보하세요. 이동과 식량 소비를 취소했습니다.";
    toast(message);
    frontierUI?.feedback(message);
    return false;
  }
  running = false; // Prevent beforeunload from overwriting the committed destination.
  location.reload();
  return true;
}
function save(quiet = false) {
  if (!running || !world) return false;
  try {
    const s = {
      version: 2,
      ...(frontierState ? { campaign: frontierState.save(), regionCache } : {}),
      inventory: inventory.save(),
      loot: loot.save(),
      editGridVersion: EDIT_GRID_VERSION,
      miningSize,
      buildMaterial,
      buildSize,
      world: world.save(),
      eco: eco.save(),
      player,
      playTime,
      discovered: [...discovered],
    };
    const str = JSON.stringify(s);
    localStorage.setItem(storageKey, str);
    $("saveState").textContent =
      "SAVED " +
      new Date().toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
      });
    if (!quiet) toast("탐험을 저장했습니다.");
    return true;
  } catch (e) {
    $("saveState").textContent = "SAVE FAILED";
    toast("저장 공간이 부족합니다. 개체 수를 줄인 뒤 다시 저장하세요.");
    return false;
  }
}
function map() {
  const canvas = $("map"),
    ctx = canvas.getContext("2d"),
    scale = 150 / SIZE;
  ctx.fillStyle = "#2a4d3d";
  ctx.fillRect(0, 0, 150, 150);
  for (let z = 0; z < SIZE; z += 3)
    for (let x = 0; x < SIZE; x += 3) {
      const h = world.surface(x, z),
        p = world.plants[x + z * SIZE];
      ctx.fillStyle =
        h <= 9
          ? "#4c7f84"
          : x > 125 && z < 90
            ? "#a29567"
            : p < 0.4
              ? "#667654"
              : "#55764e";
      ctx.fillRect(x * scale, z * scale, 3, 3);
    }
  for (const e of eco.entities) {
    if (e.dead) continue;
    ctx.fillStyle =
      e.type === 1 ? "#df9e76" : e.type === 2 ? "#72b8c3" : "#bed39a";
    ctx.fillRect(e.x * scale, e.z * scale, 1.4, 1.4);
  }
  for (const p of world.landmarks) {
    ctx.strokeStyle = discovered.has(p.name) ? "#ebce8a" : "#8fa17d";
    ctx.strokeRect(p.x * scale - 2, p.z * scale - 2, 4, 4);
  }
  ctx.save();
  ctx.translate(player.x * scale, player.z * scale);
  ctx.rotate(player.yaw);
  ctx.fillStyle = "#ffe4a7";
  ctx.beginPath();
  ctx.moveTo(0, -5);
  ctx.lineTo(3, 4);
  ctx.lineTo(0, 2);
  ctx.lineTo(-3, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  $("coords").textContent = (player.x | 0) + " / " + (player.z | 0);
}
function discover() {
  let closest = world.landmarks[0],
    d = 1e9;
  for (const p of world.landmarks) {
    const dist = Math.hypot(player.x - p.x, player.z - p.z);
    if (dist < d) {
      d = dist;
      closest = p;
    }
    if (dist < 13 && !discovered.has(p.name)) {
      discovered.add(p.name);
      $("discovery").querySelector("span").textContent =
        "FIELD NOTE / 0" + discovered.size;
      $("discovery").querySelector("strong").textContent = p.name;
      $("discovery").classList.add("show");
      setTimeout(() => $("discovery").classList.remove("show"), 4800);
      sound("scan");
    }
  }
  $("biome").textContent = closest.name;
}
function updatePanels() {
  refreshInventory();
  if (!world) return;
  const s = eco.stats(),
    r = world.reactions,
    g = view.stats();
  $("foundCount").textContent = discovered.size + " / 5";
  $("elapsed").textContent =
    Math.floor(playTime / 60) +
    ":" +
    String(playTime % 60 | 0).padStart(2, "0");
  $("seedValue").textContent = world.seed;
  for (const [id, n] of [
    ["herbCount", s.counts[0]],
    ["predCount", s.counts[1]],
    ["beetleCount", s.counts[2]],
    ["grazed", r.grazed.toFixed(1)],
    ["birthDeath", r.births + " / " + r.deaths],
    ["reactionCount", r.dissolved + " / " + r.burned],
    ["visibleCount", g.visibleEntities || 0],
    ["triangleCount", g.triangles.toLocaleString()],
    [
      "benchFps",
      benchmarkSamples.length
        ? (
            benchmarkSamples.reduce((a, b) => a + b, 0) /
            benchmarkSamples.length
          ).toFixed(1)
        : fps.toFixed(0),
    ],
  ])
    $(id).textContent = n;
}
function setPopulation(n = 3000) {
  const live = eco.stats().total;
  for (let i = live; i < n; i++) {
    let x = 5 + world.random() * (SIZE - 10),
      z = 5 + world.random() * (SIZE - 10);
    if (world.surface(x, z) < 10) x = 20 + world.random() * 50;
    eco.spawn(i % 12 === 0 ? 1 : i % 7 === 0 ? 2 : 0, x, z);
  }
  eco.rehash();
  benchmarkStart = world.time;
  benchmarkSamples = [];
  $("benchmarkText").textContent =
    "3,000 개체 배치 완료. 탐험을 재개하면 프레임을 수집합니다.";
  toast("3,000 개체 실험 시작 · FPS는 기기별로 달라집니다.");
}
function fixedStep(input = inputState()) {
  world.time += FIXED_DT;
  controller.obstructed = (p, h) =>
    frontierUI?.motion.physics?.characterObstructed(p, h);
  const vehicleInput = frontierUI?.beforeStep(input, FIXED_DT);
  let moving = 0;
  if (frontierState?.riding) {
    controller.eye = EYE_HEIGHT;
    controller.previous = {
      x: player.x,
      y: player.y,
      z: player.z,
      offset: 0,
      eye: EYE_HEIGHT,
    };
  } else moving = controller.step(FIXED_DT, vehicleInput || input);
  frontierUI?.afterStep(FIXED_DT);
  updateMovementHud();
  if (player.y < 0.25) home();
  eco.context = {
    player,
    held: heldItem(),
    hurt: (amount) => {
      if (frontierState) {
        frontierState.damagePlayer(amount, inventory);
        toast("포식자 공격 −" + amount + " · 거리를 벌리세요");
      }
    },
  };
  physicsTick++;
  if (physicsTick % 2 === 0) eco.update(FIXED_DT * 2, player, world.time);
  loot.update(FIXED_DT, world, player, inventory);
  flowAccum += FIXED_DT;
  if (flowAccum >= 0.133333) {
    world.fluidStep(view.quality === "low" ? 240 : 480);
    world.chemistryStep(flowAccum);
    world.ecosystemStep(flowAccum);
    flowAccum = 0;
  }
  if (moving > 0.1 && player.grounded) {
    walkSound += FIXED_DT;
    if (walkSound > 0.46) {
      sound("step");
      walkSound = 0;
    }
  }
  return moving;
}
function updateAim() {
  const { block, ent } = target();
  if (frontierUI?.assemblyAim(heldItem(), block, ent?.distance)) return;
  const aimAction = actionHeld && !ent ? 2 : selected;
  if (ent) {
    const e = ent.entity;
    view.worldUI.set("focus", {
      title: `${SPECIES[e.type].name} · ${SPECIES[e.type].parts[ent.part].name}`,
      detail: `HP ${Math.ceil(e.hp)} / ${e.maxHP} · ${e.behavior || "배회"}`,
      hint: `지지 다리 ${eco.legs(e)}/4 · HP 0 / 머리·몸통 파괴 시 사망`,
      value: Math.ceil(e.hp),
      max: e.maxHP,
      color: e.type === 1 ? "#efb484" : "#b4ddbe",
      maxDistance:
        selected === 1 ? activeGear(inventory, "weapon").range + 1 : 8,
      follow: () =>
        e.dead
          ? null
          : {
              x: e.x,
              y: e.y + (e.bodyPose?.drop || 0) + 1.25 * SPECIES[e.type].s,
              z: e.z,
            },
    });
    view.highlight.visible = false;
  } else if (block) {
    const names = [
      "",
      "풀밭",
      "흙",
      "돌",
      "모래",
      "원목",
      "잎",
      "광석",
      "현무암",
      "용암",
      "재",
      "목재",
    ];
    const ratio =
      world.time - miningProgress.last < 0.6 &&
      miningProgress.key ===
        `${block.hx},${block.hy},${block.hz}:${miningSize}:${gearId(inventory, "tool")}`
        ? miningProgress.ratio
        : 0;
    view.worldUI.set("focus", {
      title: names[block.b] || "블록",
      detail:
        aimAction === 2
          ? `채굴 ${Math.floor(ratio * 100)}% · ${activeGear(inventory, "tool").name}`
          : `${block.distance.toFixed(1)} m`,
      hint:
        aimAction === 2
          ? "공격 · 캐기를 길게 누르세요"
          : aimAction === 3
            ? "사용으로 블록 설치"
            : "도구를 들고 상호작용",
      value: ratio,
      max: aimAction === 2 ? 1 : 0,
      color: "#e5d6a1",
      position: {
        x: block.hx * 0.5 + 0.25 + block.normal[0] * 0.33,
        y: block.hy * 0.5 + 0.25 + block.normal[1] * 0.33,
        z: block.hz * 0.5 + 0.25 + block.normal[2] * 0.33,
      },
      maxDistance: 8,
    });
    view.highlight.visible = aimAction === 2 || aimAction === 3;
    const r =
      aimAction === 3
        ? buildTarget(block)
        : world.miningRegion(block, miningSize);
    view.highlight.scale.setScalar(r.size + 0.006);
    view.highlight.position.set(...r.start.map((v) => v * 0.5 + r.size * 0.5));
    view.highlight.material.color.setHex(aimAction === 3 ? 0x9cdaa1 : 0xf5d78c);
  } else {
    view.worldUI.set("focus", null);
    view.highlight.visible = false;
  }
}
function frame(now) {
  requestAnimationFrame(frame);
  if (!view) return;
  const realDt = Math.max(0.001, (now - last) / 1000 || 0.016),
    dt = Math.min(0.15, realDt);
  last = now;
  if (running && !paused) {
    fpsFrames++;
    fpsTime += realDt;
    if (fpsTime > 1) {
      fps = fpsFrames / fpsTime;
      fpsFrames = 0;
      fpsTime = 0;
      $("fps").textContent = fps.toFixed(0) + " FPS";
      if (benchmarkStart) {
        benchmarkSamples.push(fps);
        if (benchmarkSamples.length > 60) benchmarkSamples.shift();
      }
    }
  }
  if (!ready) {
    view.rebuild(3);
    $("loadStatus").textContent =
      "지형 청크 준비 " + (100 - world.dirty.size) + " / 100";
    if (!world.dirty.size) {
      ready = true;
      $("startBtn").disabled = false;
      $("startBtn").querySelector("span").textContent = "탐험 시작";
      $("loadStatus").textContent = "월드 준비 완료 · 채굴·수집·제작";
      if (localStorage.getItem(storageKey)) {
        $("continueBtn").classList.remove("hidden");
        $("startBtn").querySelector("span").textContent = "새로운 탐험";
      }
      refreshAPI();
      if (new URLSearchParams(location.search).has("world"))
        start(!!localStorage.getItem(storageKey));
    }
  }
  let moving = 0;
  if (running && !paused && ready) {
    physicsAccum = Math.min(0.1333333, physicsAccum + dt);
    let steps = 0;
    while (physicsAccum >= FIXED_DT && steps++ < 8) {
      moving = fixedStep();
      physicsAccum -= FIXED_DT;
    }
    renderCamera(physicsAccum / FIXED_DT);
    playTime += dt;
    saveTimer += dt;
    hudTimer += dt;
    actionCooldown -= dt;
    useCooldown -= dt;
    if (useHeld && useCooldown <= 0) {
      use("secondary");
      useCooldown = 0.35;
    }
    if (actionHeld && actionCooldown <= 0) {
      use("primary");
      actionCooldown =
        selected === 1
          ? activeGear(inventory, "weapon").cooldown
          : selected === 2
            ? 0.2
            : 0.4;
    }
    if (hudTimer > 0.2) {
      updateAim();
      frontierUI?.hud();
      $("population").textContent =
        eco.stats().total.toLocaleString() + " 개체";
      const h = 8 + world.time / 60;
      $("worldTime").textContent =
        "DAY " +
        String(1 + Math.floor(h / 24)).padStart(2, "0") +
        " · " +
        String(Math.floor(h) % 24).padStart(2, "0") +
        ":" +
        String(Math.floor((h % 1) * 60)).padStart(2, "0");
      map();
      discover();
      if (inventory.revision !== lastInventoryRevision) {
        syncHeld();
        $("bagCount").textContent = inventory.slots.filter(Boolean).length;
        lastInventoryRevision = inventory.revision;
        updateToolLabel();
      }
      hudTimer = 0;
    }
    if (saveTimer > 30) {
      save(true);
      saveTimer = 0;
    }
    view.rebuild(2);
  } else if (!running) {
    const a = now * 0.000012;
    view.camera.position.set(85 + Math.sin(a) * 2, 25, 98);
    view.camera.lookAt(74, 13, 58);
  }
  if (!paused) {
    view.entities(
      eco,
      world.time,
      ((physicsTick % 2) + physicsAccum / FIXED_DT) / 2,
    );
    view.environment(world.time);
    view.pickups(loot, world.time);
    frontierUI?.draw();
    view.draw(world.time, dt, moving);
  }
  if (window.FERAL) window.FERAL.ready = ready;
  window.FeralUpdates?.frame(ready, now);
}
function refreshAPI() {
  window.FERAL = {
    version: VERSION.version,
    get frontier() {
      return frontierState;
    },
    get frontierUI() {
      return frontierUI;
    },
    travel,
    controller,
    inventory,
    loot,
    craft,
    cycleRange,
    openBag,
    get miningSize() {
      return miningSize;
    },
    get buildSize() {
      return buildSize;
    },
    get buildMaterial() {
      return buildMaterial;
    },
    fixedStep,
    renderCamera,
    ready,
    world,
    ecology: eco,
    view,
    player,
    start,
    pause,
    save,
    selectTool,
    selectHotbar,
    heldItem,
    use,
    setPopulation,
    stats: () => ({
      ...eco.stats(),
      ...view.stats(),
      fps,
      time: world.time,
      discovered: [...discovered],
      running,
      paused,
    }),
    setCamera: (x, y, z, yaw, pitch) => {
      Object.assign(player, { x, y: y - EYE_HEIGHT, z, yaw, pitch, vy: 0 });
      controller.reset();
      renderCamera(1);
    },
  };
}
$("startBtn").onclick = () => {
  if (localStorage.getItem(storageKey)) location.href = "worlds.html";
  else start(false);
};
$("continueBtn").onclick = () => start(true);
$("menuBtn").onclick = () => {
  pause(true);
  document.querySelector('[data-tab="world"]').click();
};
$("resumeBtn").onclick = $("backToGame").onclick = () => pause(false);
$("resumeWorld").onclick = () => pause(false);
$("worldListBtn").onclick = (e) => {
  if (!save(true)) e.preventDefault();
};
$("saveBtn").onclick = () => save();
$("homeBtn").onclick = () => {
  home();
  pause(false);
};
$("flyBtn").onclick = setFlying;
$("crouchBtn").onclick = () => toggleStance("crouch");
$("crawlBtn").onclick = () => toggleStance("crawl");
$("sprintBtn").onclick = () => {
  if (!running || paused || frontierState?.riding) return;
  if (player.stance !== "stand") {
    controller.requestStance("stand");
    controller.updateStance("stand");
    if (player.stanceBlocked) {
      toast("일어설 공간이 필요합니다.");
      return;
    }
  }
  sprintLatched = !sprintLatched;
  updateMovementHud();
};
$("inventoryBtn").onclick = openBag;
holdButton(
  $("useBtn"),
  () => {
    useHeld = true;
    use("secondary");
    useCooldown = 0.35;
  },
  () => {
    useHeld = false;
  },
);
$("rangeBtn").onclick = cycleRange;
$("newBtn").onclick = () => $("resetConfirm").classList.remove("hidden");
$("cancelReset").onclick = () => $("resetConfirm").classList.add("hidden");
$("confirmReset").onclick = () => {
  localStorage.removeItem(storageKey);
  location.reload();
};
$("herdBtn").onclick = () => {
  for (let i = 0; i < 24; i++)
    eco.spawn(
      i % 8 === 0 ? 1 : 0,
      clamp(player.x + (world.random() - 0.5) * 15, 2, SIZE - 3),
      clamp(player.z + (world.random() - 0.5) * 15, 2, SIZE - 3),
    );
  eco.rehash();
  updatePanels();
};
$("stressBtn").onclick = () => {
  setPopulation(3000);
  updatePanels();
};
for (const b of document.querySelectorAll("[data-tab]"))
  b.onclick = () => {
    $("pauseScreen").classList.toggle("inventoryMode", b.dataset.tab === "bag");
    $("panelTitle").textContent =
      b.dataset.tab === "bag" ? "가방 · 제작" : "탐험 메뉴";
    document
      .querySelectorAll("[data-tab]")
      .forEach((x) => x.classList.toggle("active", x === b));
    document
      .querySelectorAll("[data-panel]")
      .forEach((x) =>
        x.classList.toggle("hidden", x.dataset.panel !== b.dataset.tab),
      );
    updatePanels();
  };
function persistSettings() {
  localStorage.setItem(
    "feral.settings",
    JSON.stringify({
      layoutVersion: 2,
      quality: $("quality").value,
      sensitivity: $("sensitivity").value,
      fov: $("fov").value,
      sound: $("sound").checked,
      leftHand: $("leftHand").checked,
    }),
  );
}
$("quality").onchange = () => {
  view.qualitySet($("quality").value);
  persistSettings();
};
$("sensitivity").oninput = () => {
  sensitivity = $("sensitivity").value / 100;
  persistSettings();
};
$("fov").oninput = () => {
  view.camera.fov = +$("fov").value;
  view.camera.updateProjectionMatrix();
  persistSettings();
};
$("sound").onchange = () => {
  soundEnabled = $("sound").checked;
  persistSettings();
};
$("leftHand").onchange = () => {
  document.body.classList.toggle("leftHand", $("leftHand").checked);
  persistSettings();
  hudEditor?.apply();
};
function holdButton(el, on, off) {
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    on();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    el.addEventListener(type, (e) => {
      e.preventDefault();
      off();
    });
}
holdButton(
  $("actBtn"),
  () => {
    if (!paused) {
      actionHeld = true;
      use("primary");
      actionCooldown =
        selected === 1 ? activeGear(inventory, "weapon").cooldown : 0.2;
    }
  },
  () => (actionHeld = false),
);
holdButton(
  $("jumpBtn"),
  () => {
    if (player.stance !== "stand" && !frontierState?.riding)
      toggleStance(player.stance);
    else keys.add("Space");
  },
  () => keys.delete("Space"),
);
holdButton(
  $("descendBtn"),
  () => keys.add("KeyQ"),
  () => keys.delete("KeyQ"),
);
$("stick").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  e.stopPropagation();
  joy.id = e.pointerId;
  $("stick").setPointerCapture(e.pointerId);
  stickMove(e);
});
function stickMove(e) {
  if (e.pointerId !== joy.id) return;
  const r = $("stick").getBoundingClientRect(),
    dx = e.clientX - r.x - r.width / 2,
    dy = e.clientY - r.y - r.height / 2,
    m = Math.max(35, Math.hypot(dx, dy));
  joy.x = dx / m;
  joy.y = dy / m;
  $("knob").style.transform = `translate(${joy.x * 30}px,${joy.y * 30}px)`;
}
$("stick").addEventListener("pointermove", stickMove);
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  $("stick").addEventListener(type, (e) => {
    if (e.pointerId === joy.id) {
      joy.id = null;
      joy.x = joy.y = 0;
      $("knob").style.transform = "";
    }
  });
const canvas = $("world");
canvas.addEventListener("pointerdown", (e) => {
  if (!running || paused) return;
  if (e.pointerType === "mouse") {
    if (e.button === 2) {
      use("secondary");
      return;
    }
    if (document.pointerLockElement === canvas) {
      actionHeld = true;
      use("primary");
      actionCooldown =
        selected === 1 ? activeGear(inventory, "weapon").cooldown : 0.2;
    } else
      canvas
        .requestPointerLock?.()
        ?.catch?.(() => toast("클릭 후 마우스 시점을 사용할 수 있습니다."));
    return;
  }
  look.id = e.pointerId;
  look.x = e.clientX;
  look.y = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!running || paused) return;
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
  player.yaw -= dx * 0.003 * sensitivity;
  player.pitch = clamp(player.pitch - dy * 0.003 * sensitivity, -1.48, 1.48);
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  canvas.addEventListener(type, (e) => {
    if (e.pointerType === "mouse") actionHeld = false;
    if (e.pointerId === look.id) look.id = null;
  });
canvas.addEventListener(
  "wheel",
  (e) => {
    if (!running || paused) return;
    e.preventDefault();
    selectHotbar((inventory.selectedSlot + (e.deltaY > 0 ? 1 : 8)) % 9);
  },
  { passive: false },
);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("keydown", (e) => {
  if (hudEditor?.editing) return;
  if (e.target.closest?.("#frontierPanel") && e.code !== "Escape") return;
  if (["Space", "Tab", "ArrowUp", "ArrowDown"].includes(e.code))
    e.preventDefault();
  if (["KeyI", "Tab"].includes(e.code) && running && !e.repeat) {
    if (paused) pause(false);
    else openBag();
    return;
  }
  if (e.code === "Escape") {
    pause();
    return;
  }
  if (!running || paused) return;
  if (frontierUI && !e.repeat && frontierUI.key(e.code)) return;
  if (!e.repeat && (e.code === "KeyC" || e.code === "KeyZ")) {
    toggleStance(e.code === "KeyC" ? "crouch" : "crawl");
    return;
  }
  if (
    !e.repeat &&
    e.code === "Space" &&
    player.stance !== "stand" &&
    !frontierState?.riding
  ) {
    toggleStance(player.stance);
    return;
  }
  keys.add(e.code);
  if (e.code === "KeyB" && !e.repeat) cycleRange();
  if (e.code === "KeyF" && !e.repeat) setFlying();
  if (/^Digit[1-9]$/.test(e.code)) selectHotbar(+e.code.slice(-1) - 1);
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => {
  if (running) {
    save(true);
    pause(true);
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && running) {
    save(true);
    pause(true);
  }
});
window.addEventListener("beforeunload", () => {
  if (running) save(true);
});
window.addEventListener("blur", stopInput);
window.addEventListener("resize", () => view?.resize());
window.FeralNative = {
  pause: () => {
    if (running) {
      save(true);
      pause(true);
    }
  },
  back: () => {
    if (hudEditor?.editing) hudEditor.cancel();
    else if (running) pause();
  },
  save: () => save(true),
};
window.FeralUpdates = initUpdates({
  beforeApply: () => !running || save(true),
});
try {
  if (activeWorld.type === "frontier") {
    const old = JSON.parse(localStorage.getItem(storageKey) || "null");
    frontierState = old?.campaign
      ? Frontier.load(old.campaign)
      : new Frontier(activeWorld.seed);
    regionCache = old?.regionCache || {};
    if (!old) {
      inventory.add("food", 8);
      inventory.add("medicine", 2);
      inventory.add("fiber", 6);
      inventory.add("wood", 8);
      inventory.add("stone", 8);
      inventory.add("crystal", 2);
    }
    document.body.classList.add("frontier");
  }
  world = makeWorld(frontierState ? frontierState.info.seed : activeWorld.seed);
  world.event = event;
  eco = new Ecology(world);
  eco.populate(160);
  controller = new CharacterController(world, player);
  bindDrops();
  view = new View(canvas, world);
  if (frontierState)
    frontierUI = new FrontierView({
      get model() {
        return frontierState;
      },
      get world() {
        return world;
      },
      get inventory() {
        return inventory;
      },
      player,
      view,
      pause,
      toast,
      home,
      travel,
      openBag,
      save,
      get running() {
        return running;
      },
      get paused() {
        return paused;
      },
    });
  view.camera.position.set(85, 25, 98);
  view.camera.lookAt(74, 13, 58);
  const settings = JSON.parse(localStorage.getItem("feral.settings") || "null");
  if (settings) {
    $("quality").value = settings.quality || "balanced";
    $("sensitivity").value = settings.sensitivity || 80;
    $("fov").value = settings.layoutVersion === 2 ? settings.fov || 82 : 82;
    $("sound").checked = settings.sound !== false;
    $("leftHand").checked = !!settings.leftHand;
    sensitivity = $("sensitivity").value / 100;
    soundEnabled = $("sound").checked;
    document.body.classList.toggle("leftHand", $("leftHand").checked);
    view.qualitySet($("quality").value);
    view.camera.fov = +$("fov").value;
    view.camera.updateProjectionMatrix();
  }
  hudEditor = new HudEditor({
    open: () => {
      pause(true);
      frontierUI?.close();
      $("pauseScreen").classList.add("hidden");
    },
    close: () => {
      stopInput();
      pause(true);
      document.querySelector('[data-tab="settings"]').click();
    },
  });
  $("editHudBtn").onclick = () => hudEditor.open();
  $("editHudShortcut").onclick = () => hudEditor.open();
  syncHeld();
  refreshAPI();
  requestAnimationFrame(frame);
} catch (e) {
  reportError(e);
}
