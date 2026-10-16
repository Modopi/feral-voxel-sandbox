import {currentWorld,saveKey} from "./world-slots.js";
const activeWorld=currentWorld(localStorage,"island",location.search);
import { World, B, SIZE, HEIGHT, COLORS, clamp } from "./world.js";
import { Ecology, SPECIES } from "./entities.js";
import { View, T } from "./render.js";
import { VERSION } from "./version.js";
import { initUpdates } from "./updates.js";
import {
  CharacterController,
  FIXED_DT,
  EYE_HEIGHT,
  BODY_HEIGHT,
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
  miningSize = 1,
  buildSize = 1,
  buildMaterial = "dirt",
  inspectedItem = "dirt",
  physicsAccum = 0,
  physicsTick = 0,
  lastInventoryRevision = -1,
  collectedMessage = 0;
const $ = (id) => document.getElementById(id),
  storageKey = saveKey(activeWorld);
const tools = [
  ["◈", "관찰", "관찰 렌즈", "생태와 신체 상태 읽기"],
  ["⌁", "펄스", "복셀 펄스", "개체의 복셀을 정밀하게 깎기"],
  ["⌑", "채굴", "곡괭이", "한 번에 1 m 블록 채굴 · B로 범위 변경"],
  ["▣", "건축", "블록 건축", "가방의 재료를 사용 · B로 크기 변경"],
  ["≈", "물", "물 분사기", "물을 붓고 흐름 만들기 · 소화"],
  ["♨", "불", "점화기", "풀과 나무에 불 붙이기"],
  ["⚗", "산", "산 용액", "흙·나무 부식 · 물에 희석"],
  ["✿", "씨앗", "생태 복원", "풀과 토양 영양분 복원"],
  ["⬡", "생명", "개체 생성", "바라보는 곳에 생명 추가"],
];
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
  actionHeld = false,
  actionCooldown = 0,
  walkSound = 0,
  benchmarkStart = 0,
  benchmarkSamples = [],
  resetOnReturn = false;
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
function selectTool(n) {
  selected = (n + tools.length) % tools.length;
  document
    .querySelectorAll(".slot")
    .forEach((b, i) => b.classList.toggle("selected", i === selected));
  $("toolName").textContent = tools[selected][2];
  $("toolHelp").textContent = tools[selected][3];
  $("actBtn").firstChild.textContent = tools[selected][0];
  updateToolLabel();
}
for (let i = 0; i < tools.length; i++) {
  const b = document.createElement("button");
  b.className = "slot";
  b.setAttribute("aria-label", tools[i][2]);
  b.innerHTML = `<span class="num">${i + 1}</span><span class="glyph">${tools[i][0]}</span><small>${tools[i][1]}</small>`;
  b.onclick = () => selectTool(i);
  $("hotbar").appendChild(b);
}
selectTool(0);
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
  });
  controller?.reset();
  $("flyBtn").classList.remove("enabled");
}
function inputState() {
  return {
    forward: (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0) - joy.y,
    side: (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0) + joy.x,
    jump: keys.has("Space"),
    up: keys.has("KeyE"),
    down: keys.has("KeyQ"),
    sprint: keys.has("ShiftLeft"),
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
  if (!$("rangeBtn")) return;
  const material = ITEMS[buildMaterial];
  $("rangeBtn").textContent =
    selected === 3
      ? "건축 " + buildSize + " m ↻"
      : "채굴 " + miningSize + " m ↻";
  $("rangeBtn").classList.toggle("hidden", selected !== 2 && selected !== 3);
  if (selected === 2) {
    $("toolName").textContent =
      (miningSize === 0.5
        ? "정밀 끌"
        : miningSize === 2
          ? "채굴 해머"
          : "곡괭이") +
      " · " +
      miningSize +
      " m";
    $("toolHelp").textContent =
      "한 번에 " +
      (miningSize === 0.5 ? "⅛" : miningSize === 2 ? "8" : "1") +
      " m³ · 바닥의 자원 자동 수집";
  } else if (selected === 3) {
    $("toolName").textContent = material.name + " · " + buildSize + " m";
    $("toolHelp").textContent =
      "보유 " +
      inventory.count(buildMaterial) +
      " · 설치 비용 " +
      (buildSize === 1 ? 8 : 1) +
      " 조각";
  }
  $("hint").textContent = "키 1.5 m · 지형 1 / 0.5 m";
}
function cycleRange() {
  if (selected === 3) buildSize = buildSize === 1 ? 0.5 : 1;
  else {
    const sizes = inventory.unlocks.has("hammer") ? [0.5, 1, 2] : [0.5, 1];
    miningSize = sizes[(sizes.indexOf(miningSize) + 1) % sizes.length];
    if (selected !== 2) selectTool(2);
  }
  updateToolLabel();
  sound("scan");
}
function refreshInventory() {
  if (!$("inventoryGrid")) return;
  const grid = $("inventoryGrid");
  grid.replaceChildren();
  for (const [id, item] of Object.entries(ITEMS)) {
    const b = document.createElement("button");
    b.className = "itemSlot" + (id === inspectedItem ? " equipped" : "");
    b.dataset.item = id;
    b.setAttribute("aria-pressed", String(id === inspectedItem));
    b.setAttribute("aria-label", item.name + " · " + inventory.count(id) + "개");
    b.innerHTML =
      '<span style="color:#' +
      item.color.toString(16).padStart(6, "0") +
      '">' +
      item.icon +
      "</span><b>" +
      inventory.count(id) +
      "</b><small>" +
      item.name +
      "</small>";
    b.title = item.block ? "눌러 건축 재료로 선택" : "제작 재료";
    b.onclick = () => {
      inspectedItem = id;
      if (item.block) {
        buildMaterial = id;
        selectTool(3);
        toast(item.name + " 건축 재료 선택");
      }
      refreshInventory();
      grid.querySelector(`[data-item="${id}"]`)?.focus({ preventScroll: true });
    };
    grid.append(b);
  }
  const item = ITEMS[inspectedItem];
  $("itemDetail").innerHTML = `<span class="detailGlyph">${item.icon}</span><div><h3>${item.name} <small>× ${inventory.count(inspectedItem)}</small></h3><p>${item.block ? (inspectedItem === buildMaterial ? "건축 재료 선택됨 · 탐험으로 돌아가 설치하세요." : "슬롯을 누르면 건축 재료로 선택합니다.") : "제작 재료 · 현장 제작 목록에서 사용처를 확인하세요."}</p></div>`;
  const recipes = $("recipeList");
  recipes.replaceChildren();
  for (const recipe of RECIPES) {
    const row = document.createElement("div");
    row.className = "recipe";
    const text = document.createElement("div");
    text.innerHTML =
      "<b>" +
      recipe.name +
      "</b><small>" +
      recipe.description +
      "</small><p>" +
      Object.entries(recipe.cost)
        .map(([id, n]) => ITEMS[id].name + " " + inventory.count(id) + "/" + n)
        .join(" · ") +
      "</p>";
    const button = document.createElement("button");
    button.className = "primary";
    button.textContent =
      recipe.unlock && inventory.unlocks.has(recipe.unlock) ? "보유" : "제작";
    button.disabled = !inventory.canCraft(recipe);
    button.onclick = () => craft(recipe.id);
    row.append(text, button);
    recipes.append(row);
  }
  $("bagTotal").textContent =
    Object.values(inventory.items).reduce((a, b) => a + b, 0) +
    " 조각 · 수집 " +
    loot.collected;
  $("bagCount").textContent = Object.values(inventory.items).reduce(
    (a, b) => a + b,
    0,
  );
  lastInventoryRevision = inventory.revision;
}
function craft(id) {
  const ok = inventory.craft(id);
  if (ok) {
    if (id === "hammer") {
      miningSize = 2;
      selectTool(2);
    }
    const recipe = RECIPES.find((r) => r.id === id);
    if (recipe.give) inspectedItem = Object.keys(recipe.give)[0];
    $("craftFeedback").textContent = recipe.name + " 제작 완료";
    toast(recipe.name + " 제작 완료");
    sound("scan");
  } else toast("제작 재료가 부족하거나 이미 보유한 도구입니다.");
  refreshInventory();
  updateToolLabel();
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
    a[1] < player.y + BODY_HEIGHT &&
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
  const block = blockRay(6.5),
    d = new T.Vector3();
  view.camera.getWorldDirection(d);
  const ent = eco.ray(
    view.camera.position,
    d,
    Math.min(6.5, block?.distance || 6.5),
    world.time,
  );
  return { block, ent };
}
function use() {
  if (!running || paused) return;
  const { block, ent } = target();
  view.toolKick = 1;
  if (selected === 0) {
    if (ent) {
      const e = ent.entity;
      toast(
        SPECIES[e.type].name +
          " · " +
          SPECIES[e.type].parts[ent.part].name +
          " · 에너지 " +
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
          " m · 플레이어 1.5 m",
      );
    else toast("6.5 m 이내의 생명이나 지표를 관찰하세요.");
    sound("scan");
    return;
  }
  if (selected === 1) {
    if (ent) {
      eco.damageHit(
        ent,
        world.time,
        inventory.unlocks.has("pulse") ? 0.3 : 0.18,
      );
      sound("pulse");
    } else if (block) harvest(block, 0.5);
    return;
  }
  if (!block) {
    toast("6.5 m 이내의 표면을 조준하세요.");
    return;
  }
  const outward = block.point.map((v, i) => v + block.normal[i] * 0.06),
    [x, y, z] = outward.map(Math.floor);
  if (selected === 2) harvest(block, miningSize);
  if (selected === 3) {
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
  if (selected === 4) {
    world.pour(x, y, z, 5, 0);
    sound("water");
  }
  if (selected === 5) {
    world.ignite(block.x, block.y, block.z);
    sound("pulse");
  }
  if (selected === 6) {
    world.pour(x, y, z, 3, 0.95);
    sound("water");
  }
  if (selected === 7) {
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
  if (selected === 8) {
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
  joy.x = joy.y = 0;
  joy.id = null;
  look.id = null;
  actionHeld = false;
  $("knob").style.transform = "";
}
function pause(force) {
  if (!running) return;
  paused = force ?? !paused;
  stopInput();
  $("pauseScreen").classList.toggle("hidden", !paused);
  document.body.classList.toggle("menuOpen", paused);
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
        world = new World(s.world.seed);
        world.generate();
        world.load(s.world);
        eco = new Ecology(world);
        eco.load(s.eco);
        inventory = new Inventory();
        if (s.inventory) inventory.load(s.inventory);
        loot = new Pickups();
        if (s.loot) loot.load(s.loot);
        miningSize =
          s.miningSize === 2 && inventory.unlocks.has("hammer")
            ? 2
            : s.miningSize === 0.5
              ? 0.5
              : 1;
        buildMaterial = ITEMS[s.buildMaterial]?.block
          ? s.buildMaterial
          : "dirt";
        buildSize = s.buildSize === 0.5 ? 0.5 : 1;
        view.world = world;
        world.event = event;
        playTime = s.playTime || 0;
        Object.assign(player, s.player);
        discovered = new Set(s.discovered || []);
        $("flyBtn").classList.toggle("enabled", player.flying);
      } else home();
    } else home();
    controller = new CharacterController(world, player);
    controller.recover();
    physicsAccum = 0;
    physicsTick = 0;
    bindDrops();
    renderCamera(1);
    updateToolLabel();
    refreshInventory();
    running = true;
    paused = false;
    $("titleScreen").classList.add("hidden");
    $("hud").classList.remove("hidden");
    $("pauseScreen").classList.add("hidden");
    if (!load) toast("곡괭이로 채굴 → 가까이 가서 수집 → 가방에서 제작");
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
function save(quiet = false) {
  if (!running || !world) return false;
  try {
    const s = {
      version: 2,
      inventory: inventory.save(),
      loot: loot.save(),
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
  const moving = controller.step(FIXED_DT, input);
  if (player.y < 0.25) home();
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
  if (ent) {
    $("target").innerHTML =
      "<b>" +
      SPECIES[ent.entity.type].name +
      "</b> · " +
      SPECIES[ent.entity.type].parts[ent.part].name +
      "<br>" +
      SPECIES[ent.entity.type].cell * 100 +
      " cm 복셀 · 다리 " +
      eco.legs(ent.entity) +
      "/4";
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
    $("target").textContent =
      (names[block.b] || "블록") + " · " + block.distance.toFixed(1) + " m";
    view.highlight.visible = selected === 2 || selected === 3;
    const r =
      selected === 3
        ? buildTarget(block)
        : world.miningRegion(block, miningSize);
    view.highlight.scale.setScalar(r.size + 0.006);
    view.highlight.position.set(...r.start.map((v) => v * 0.5 + r.size * 0.5));
    view.highlight.material.color.setHex(selected === 3 ? 0x9cdaa1 : 0xf5d78c);
  } else {
    $("target").textContent = "";
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
      if (new URLSearchParams(location.search).has("world")) start(!!localStorage.getItem(storageKey));
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
    if (actionHeld && actionCooldown <= 0) {
      use();
      actionCooldown =
        selected === 1
          ? 0.18
          : selected === 2
            ? miningSize === 2
              ? 0.65
              : 0.28
            : 0.4;
    }
    if (hudTimer > 0.2) {
      updateAim();
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
        $("bagCount").textContent = Object.values(inventory.items).reduce(
          (a, b) => a + b,
          0,
        );
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
    view.draw(world.time, dt, moving);
  }
  if (window.FERAL) window.FERAL.ready = ready;
  window.FeralUpdates?.frame(ready, now);
}
function refreshAPI() {
  window.FERAL = {
    version: VERSION.version,
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
$("startBtn").onclick = () => { if (localStorage.getItem(storageKey)) location.href="worlds.html"; else start(false); };
$("continueBtn").onclick = () => start(true);
$("menuBtn").onclick = () => {
  pause(true);
  document.querySelector('[data-tab="world"]').click();
};
$("resumeBtn").onclick = $("backToGame").onclick = () => pause(false);
$("worldListBtn").onclick = (e) => { if (!save(true)) e.preventDefault(); };
$("saveBtn").onclick = () => save();
$("homeBtn").onclick = () => {
  home();
  pause(false);
};
$("flyBtn").onclick = setFlying;
$("inventoryBtn").onclick = openBag;
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
    $("panelTitle").textContent = b.dataset.tab === "bag" ? "가방 · 제작" : "탐험 메뉴";
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
      actionCooldown = 0;
    }
  },
  () => (actionHeld = false),
);
holdButton(
  $("jumpBtn"),
  () => keys.add("Space"),
  () => keys.delete("Space"),
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
    if (document.pointerLockElement === canvas) {
      actionHeld = true;
      actionCooldown = 0;
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
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("keydown", (e) => {
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
  keys.add(e.code);
  if (e.code === "KeyB" && !e.repeat) cycleRange();
  if (e.code === "KeyF" && !e.repeat) setFlying();
  if (/^Digit[1-9]$/.test(e.code)) selectTool(+e.code.slice(-1) - 1);
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
window.addEventListener("resize", () => view?.resize());
window.FeralNative = {
  pause: () => {
    if (running) {
      save(true);
      pause(true);
    }
  },
  back: () => {
    if (running) pause();
  },
  save: () => save(true),
};
window.FeralUpdates = initUpdates({
  beforeApply: () => !running || save(true),
});
try {
  world = new World(activeWorld.seed);
  world.generate();
  world.event = event;
  eco = new Ecology(world);
  eco.populate(160);
  controller = new CharacterController(world, player);
  bindDrops();
  view = new View(canvas, world);
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
  selectTool(2);
  refreshAPI();
  requestAnimationFrame(frame);
} catch (e) {
  reportError(e);
}
