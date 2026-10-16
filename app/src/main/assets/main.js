import { World, B, SIZE, HEIGHT, COLORS, clamp } from "./world.js";
import { Ecology, SPECIES } from "./entities.js";
import { View, T } from "./render.js";
const $ = (id) => document.getElementById(id),
  storageKey = "feral.world.v1";
const tools = [
  ["◈", "관찰", "관찰 렌즈", "생태와 신체 상태 읽기"],
  ["⌁", "펄스", "복셀 펄스", "개체의 복셀을 정밀하게 깎기"],
  ["⌑", "채굴", "지형 절삭기", "조준한 1 m 블록 제거"],
  ["▣", "건축", "흙 블록", "조준한 표면에 1 m 블록 놓기"],
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
    y: world.surface(77, 84) + 0.02,
    yaw: -0.5,
    pitch: -0.08,
    vy: 0,
    flying: false,
  });
  $("flyBtn").classList.remove("enabled");
}
function collision(x, y, z) {
  const r = 0.27;
  for (const xx of [x - r, x + r])
    for (const zz of [z - r, z + r])
      for (const yy of [y + 0.05, y + 0.85, y + 1.64])
        if (world.get(Math.floor(xx), Math.floor(yy), Math.floor(zz)))
          return true;
  return false;
}
function movement(dt) {
  let forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0) - joy.y,
    side = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0) + joy.x;
  const l = Math.max(1, Math.hypot(forward, side));
  forward /= l;
  side /= l;
  const speed = (keys.has("ShiftLeft") ? 7.3 : 4.5) * (player.flying ? 1.8 : 1),
    s = Math.sin(player.yaw),
    c = Math.cos(player.yaw),
    dx = (-s * forward + c * side) * speed * dt,
    dz = (-c * forward - s * side) * speed * dt;
  if (player.flying) {
    player.x += dx;
    player.z += dz;
    player.y +=
      ((keys.has("Space") || keys.has("KeyE") ? 1 : 0) -
        (keys.has("KeyQ") ? 1 : 0) +
        Math.sin(player.pitch) * forward) *
      speed *
      dt;
    player.y = clamp(player.y, 1, HEIGHT + 12);
    player.vy = 0;
  } else {
    for (const [axis, delta] of [
      ["x", dx],
      ["z", dz],
    ]) {
      const xx = axis === "x" ? player.x + delta : player.x,
        zz = axis === "z" ? player.z + delta : player.z;
      if (!collision(xx, player.y, zz)) player[axis] += delta;
      else if (player.grounded && !collision(xx, player.y + 1.01, zz)) {
        player[axis] += delta;
        player.y += 1.01;
      }
    }
    if (keys.has("Space") && player.grounded) {
      player.vy = 6.8;
      player.grounded = false;
    }
    player.vy -= dt * 18;
    const ny = player.y + player.vy * dt;
    if (!collision(player.x, ny, player.z)) {
      player.y = ny;
      player.grounded = false;
    } else {
      if (player.vy < 0) {
        player.y = Math.ceil(ny - 0.05) + 0.001;
        player.grounded = true;
      }
      player.vy = 0;
    }
  }
  player.x = clamp(player.x, 0.5, SIZE - 0.5);
  player.z = clamp(player.z, 0.5, SIZE - 0.5);
  if (player.y < 0.5) home();
  view.camera.position.set(player.x, player.y + 1.66, player.z);
  view.camera.rotation.set(player.pitch, player.yaw, 0, "YXZ");
  if (Math.abs(forward) + Math.abs(side) > 0.1 && player.grounded) {
    walkSound += dt;
    if (walkSound > 0.43) {
      sound("step");
      walkSound = 0;
    }
  }
  return Math.abs(forward) + Math.abs(side);
}
function blockRay(max = 8) {
  const o = view.camera.position,
    d = new T.Vector3();
  view.camera.getWorldDirection(d);
  let prev = null,
    lastCell = "";
  for (let t = 0.05; t < max; t += 0.035) {
    const x = Math.floor(o.x + d.x * t),
      y = Math.floor(o.y + d.y * t),
      z = Math.floor(o.z + d.z * t),
      key = x + "," + y + "," + z;
    if (key === lastCell) continue;
    lastCell = key;
    const b = world.get(x, y, z);
    if (b)
      return {
        x,
        y,
        z,
        b,
        distance: t,
        prev,
        point: [o.x + d.x * t, o.y + d.y * t, o.z + d.z * t],
      };
    prev = [x, y, z];
  }
  return null;
}
function target() {
  const block = blockRay(9),
    d = new T.Vector3();
  view.camera.getWorldDirection(d);
  const ent = eco.ray(
    view.camera.position,
    d,
    Math.min(9, block?.distance || 9),
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
      const e = ent.entity,
        p = SPECIES[e.type].parts[ent.part];
      toast(
        SPECIES[e.type].name +
          " · " +
          p.name +
          " · 에너지 " +
          Math.round(e.energy) +
          " · 다리 " +
          eco.legs(e) +
          "/4",
      );
    } else if (block) {
      const f = world.fluids.get(world.index(block.x, block.y + 1, block.z));
      toast(
        "식생 " +
          Math.round(world.plants[block.x + block.z * SIZE] * 100) +
          "% · 토양 " +
          Math.round(world.nutrients[block.x + block.z * SIZE] * 100) +
          "%" +
          (f ? " · 용액 산도 " + Math.round((f.a / f.v) * 100) + "%" : ""),
      );
    } else toast("가까운 생명이나 지표를 조준하세요.");
    sound("scan");
    return;
  }
  if (selected === 1) {
    sound("pulse");
    if (ent) {
      const n = eco.damageHit(ent, world.time);
      event(
        SPECIES[ent.entity.type].name +
          " · " +
          SPECIES[ent.entity.type].parts[ent.part].name +
          " −" +
          n +
          " voxel",
        ent.point,
      );
    } else if (block) {
      world.set(block.x, block.y, block.z, 0);
    }
    return;
  }
  if (!block) {
    toast("9 m 이내의 표면을 조준하세요.");
    return;
  }
  const [x, y, z] = block.prev || [block.x, block.y + 1, block.z];
  if (selected === 2) {
    world.set(block.x, block.y, block.z, 0);
    sound("pulse");
  }
  if (selected === 3) {
    if (!collisionBlockPlayer(x, y, z)) {
      world.set(x, y, z, B.DIRT);
      sound("step");
    } else toast("플레이어와 겹치는 곳에는 놓을 수 없습니다.");
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
        const yy = world.surface(xx, zz) - 1;
        if ([B.DIRT, B.ASH, B.GRASS].includes(world.get(xx, yy, zz))) {
          world.set(xx, yy, zz, B.GRASS);
          world.plants[xx + zz * SIZE] = 1;
          world.nutrients[xx + zz * SIZE] = 1;
        }
      }
    toast("이 땅에 다시 풀이 자랍니다.");
    sound("scan");
  }
  if (selected === 8) {
    const type = world.random() < 0.13 ? 1 : world.random() < 0.15 ? 2 : 0;
    eco.spawn(type, x + 0.5, z + 0.5);
    eco.rehash();
    toast(SPECIES[type].name + " 생성");
    sound("scan");
  }
  view.environment(world.time, true);
}
function collisionBlockPlayer(x, y, z) {
  return (
    Math.abs(player.x - x - 0.5) < 0.8 &&
    Math.abs(player.z - z - 0.5) < 0.8 &&
    y < player.y + 1.7 &&
    y + 1 > player.y
  );
}
function setFlying() {
  player.flying = !player.flying;
  player.vy = 0;
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
  if (paused) {
    document.exitPointerLock?.();
    updatePanels();
  } else last = performance.now();
}
function start(load = false) {
  if (!ready) return;
  try {
    if (load) {
      const s = JSON.parse(localStorage.getItem(storageKey));
      if (s && s.version === 1) {
        world = new World(s.world.seed);
        world.generate();
        world.load(s.world);
        eco = new Ecology(world);
        eco.load(s.eco);
        view.world = world;
        world.event = event;
        playTime = s.playTime || 0;
        Object.assign(player, s.player);
        discovered = new Set(s.discovered || []);
        $("flyBtn").classList.toggle("enabled", player.flying);
      } else home();
    } else home();
    running = true;
    paused = false;
    $("titleScreen").classList.add("hidden");
    $("hud").classList.remove("hidden");
    $("pauseScreen").classList.add("hidden");
    if (!load) toast("이끼사슴을 찾아 관찰해 보세요. 1~9 도구 선택");
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
      version: 1,
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
function frame(now) {
  requestAnimationFrame(frame);
  if (!view) return;
  const realDt = Math.max(0.001, (now - last) / 1000 || 0.016),
    dt = Math.min(0.08, realDt);
  last = now;
  fpsFrames++;
  fpsTime += realDt;
  if (fpsTime > 1) {
    fps = fpsFrames / fpsTime;
    fpsTime = 0;
    fpsFrames = 0;
    if (running && !paused) {
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
      $("loadStatus").textContent = "오프라인 월드 준비 완료 · 가로 화면 권장";
      if (localStorage.getItem(storageKey)) {
        $("continueBtn").classList.remove("hidden");
        $("startBtn").querySelector("span").textContent = "새로운 탐험";
      }
      refreshAPI();
    }
  }
  let moving = 0;
  if (running && !paused && ready) {
    playTime += dt;
    world.time += dt;
    simAccum += dt;
    flowAccum += dt;
    saveTimer += dt;
    hudTimer += dt;
    actionCooldown -= dt;
    moving = movement(dt);
    if (actionHeld && actionCooldown <= 0) {
      use();
      actionCooldown = selected === 1 ? 0.18 : selected === 2 ? 0.16 : 0.45;
    }
    if (simAccum >= 1 / 30) {
      eco.update(simAccum, view.camera.position, world.time);
      simAccum = 0;
    }
    if (flowAccum > 0.13) {
      world.fluidStep(view.quality === "low" ? 240 : 480);
      world.chemistryStep(flowAccum);
      world.ecosystemStep(flowAccum);
      flowAccum = 0;
    }
    if (hudTimer > 0.35) {
      const { block, ent } = target();
      if (ent) {
        $("target").innerHTML =
          `<b>${SPECIES[ent.entity.type].name}</b> · ${SPECIES[ent.entity.type].parts[ent.part].name}<br>${SPECIES[ent.entity.type].cell * 100} cm 복셀 · 다리 ${eco.legs(ent.entity)}/4`;
        view.highlight.visible = false;
      } else if (block) {
        const names = [
          "",
          "풀밭",
          "흙",
          "암석",
          "모래",
          "나무",
          "잎",
          "광석",
          "현무암",
          "용암",
          "재",
        ];
        $("target").innerHTML =
          (names[block.b] || "블록") + " · " + block.distance.toFixed(1) + " m";
        view.highlight.visible = selected > 1;
        view.highlight.position.set(
          block.x + 0.5,
          block.y + 0.5,
          block.z + 0.5,
        );
      } else {
        $("target").textContent = "";
        view.highlight.visible = false;
      }
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
  // Keep paused geometry intact while avoiding simulation or GPU work in background.
  if (!paused) {
    view.entities(eco, world.time);
    view.environment(world.time);
    view.draw(world.time, dt, moving);
  }
  if (window.FERAL) window.FERAL.ready = ready;
}
function refreshAPI() {
  window.FERAL = {
    version: "0.1",
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
      Object.assign(player, { x, y: y - 1.66, z, yaw, pitch, vy: 0 });
      movement(0.001);
    },
  };
}
$("startBtn").onclick = () => start(false);
$("continueBtn").onclick = () => start(true);
$("menuBtn").onclick = () => pause(true);
$("resumeBtn").onclick = $("backToGame").onclick = () => pause(false);
$("saveBtn").onclick = () => save();
$("homeBtn").onclick = () => {
  home();
  pause(false);
};
$("flyBtn").onclick = setFlying;
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
    } else canvas.requestPointerLock?.();
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
  if (e.code === "Escape") {
    pause();
    return;
  }
  if (!running || paused) return;
  keys.add(e.code);
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
try {
  world = new World();
  world.generate();
  world.event = event;
  eco = new Ecology(world);
  eco.populate(420);
  view = new View(canvas, world);
  view.camera.position.set(85, 25, 98);
  view.camera.lookAt(74, 13, 58);
  const settings = JSON.parse(localStorage.getItem("feral.settings") || "null");
  if (settings) {
    $("quality").value = settings.quality || "balanced";
    $("sensitivity").value = settings.sensitivity || 80;
    $("fov").value = settings.fov || 76;
    $("sound").checked = settings.sound !== false;
    $("leftHand").checked = !!settings.leftHand;
    sensitivity = $("sensitivity").value / 100;
    soundEnabled = $("sound").checked;
    document.body.classList.toggle("leftHand", $("leftHand").checked);
    view.qualitySet($("quality").value);
    view.camera.fov = +$("fov").value;
    view.camera.updateProjectionMatrix();
  }
  refreshAPI();
  requestAnimationFrame(frame);
} catch (e) {
  reportError(e);
}
