import { currentWorld, saveKey } from "../world-slots.js";
import { readLayout } from "../hud-layout.js";
document.documentElement.dataset.uiTheme = readLayout(localStorage).theme;
const activeWorld = currentWorld(localStorage, "machine", location.search);
import * as T from "../vendor/three.module.js";
import {
  DT,
  TYPES,
  OBSTACLES,
  createLab,
  preset,
  evaluate,
  edit,
  damage,
  control,
  step,
  mine,
  serialize,
  restore,
} from "./model.js";
import { VERSION } from "../version.js";
const $ = (id) => document.getElementById(id),
  storage = saveKey(activeWorld);
let state = createLab(),
  driving = false,
  selected = null,
  revision = -1,
  accum = 0,
  last = 0,
  frames = 0,
  healthy = false,
  saveClock = 0,
  healthySince = 0;
preset(state);
try {
  const raw = localStorage.getItem(storage);
  if (raw) state = restore(raw);
} catch {
  $("status").textContent =
    "기계 저장을 읽지 못했습니다. 기본 설계로 시작합니다.";
}
const scene = new T.Scene();
scene.background = new T.Color(0x182e36);
scene.fog = new T.Fog(0x182e36, 35, 85);
const renderer = new T.WebGLRenderer({ canvas: $("scene"), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.shadowMap.enabled = true;
const camera = new T.PerspectiveCamera(48, 1, 0.1, 120);
scene.add(new T.HemisphereLight(0xc3eeff, 0x385247, 2.5));
const sun = new T.DirectionalLight(0xffe4b7, 3);
sun.position.set(10, 22, 8);
scene.add(sun);
const ground = new T.Mesh(
  new T.BoxGeometry(48, 0.3, 48),
  new T.MeshStandardMaterial({ color: 0x415851, roughness: 1 }),
);
ground.position.y = -0.4;
scene.add(ground);
const grid = new T.GridHelper(48, 48, 0x91aaa0, 0x526d63);
grid.position.y = -0.24;
scene.add(grid);
for (const o of OBSTACLES) {
  const m = new T.Mesh(
    new T.CylinderGeometry(o.r, o.r, 2, 8),
    new T.MeshStandardMaterial({ color: 0x9c7c65, roughness: 1 }),
  );
  m.position.set(o.x, 0.75, o.z);
  scene.add(m);
}
const ore = new T.Mesh(
  new T.BoxGeometry(2, 1, 2),
  new T.MeshStandardMaterial({ color: 0x6ee2a5, emissive: 0x174b32 }),
);
ore.position.set(-6, 0.25, 9);
scene.add(ore);
const vehicle = new T.Group();
scene.add(vehicle);
const geom = new T.BoxGeometry(0.47, 0.47, 0.47),
  wheelGeom = new T.CylinderGeometry(0.26, 0.26, 0.23, 10);
wheelGeom.rotateZ(Math.PI / 2);
const meshes = new Map();
const keys = new Set(),
  touch = new Set();
function clearInput() {
  keys.clear();
  touch.clear();
  control(state, {});
  accum = 0;
}
function save() {
  try {
    localStorage.setItem(storage, serialize(state));
    $("status").textContent = "시험장 저장 완료";
    return true;
  } catch {
    $("status").textContent = "저장 실패 · 저장 공간을 확인하세요";
    return false;
  }
}
function mode() {
  driving = !driving;
  clearInput();
  state.body.vx = state.body.vz = 0;
  document.body.classList.toggle("driving", driving);
  $("drive").hidden = !driving;
  $("mode").textContent = driving ? "← 정지·조립" : "주행 시작 →";
  revision = -1;
}
document.querySelector("header a").onclick = (e) => {
  if (!save()) e.preventDefault();
};
$("mode").onclick = mode;
$("save").onclick = save;
for (const [id, heavy] of [
  ["light", false],
  ["heavy", true],
])
  $(id).onclick = () => {
    preset(state, heavy);
    selected = null;
    revision = -1;
  };
$("layer").onchange = () => (revision = -1);
$("mine").onclick = () => {
  $("status").textContent = mine(state)
    ? "재료 +4"
    : "광맥 (−6, 9) 4m 이내에서 정지하세요.";
};
$("recover").onclick = () => {
  state.body = { x: 0, z: 5, yaw: 0, vx: 0, vz: 0 };
  clearInput();
};
window.addEventListener("keydown", (e) => {
  if (e.target.matches("select,input")) return;
  if (
    [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "Space",
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
    ].includes(e.code)
  ) {
    e.preventDefault();
    keys.add(e.code);
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", clearInput);
document.addEventListener("visibilitychange", () => {
  clearInput();
  if (document.hidden) save();
});
window.addEventListener("pagehide", save);
for (const button of document.querySelectorAll("[data-key]")) {
  button.onpointerdown = (e) => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    touch.add(button.dataset.key);
  };
  button.onpointerup =
    button.onpointercancel =
    button.onlostpointercapture =
      () => touch.delete(button.dataset.key);
}
function rebuild() {
  const f = evaluate(state),
    active = new Set(state.blueprint.map((p) => p.id));
  for (const [id, m] of meshes)
    if (!active.has(id)) {
      vehicle.remove(m);
      m.material.dispose();
      meshes.delete(id);
    }
  for (const p of state.blueprint) {
    let m = meshes.get(p.id);
    if (!m) {
      m = new T.Mesh(
        p.type === "wheel" ? wheelGeom : geom,
        new T.MeshStandardMaterial({ roughness: 0.7 }),
      );
      vehicle.add(m);
      meshes.set(p.id, m);
    }
    const hp = state.hp[p.id] / TYPES[p.type].hp;
    m.position.set(p.x * 0.5, p.y * 0.5, p.z * 0.5);
    m.material.color.setHex(hp === 0 ? 0x632e36 : TYPES[p.type].color);
    m.material.color.multiplyScalar(0.35 + 0.65 * hp);
    m.material.emissive.setHex(p.id === selected ? 0x375952 : 0);
    m.scale.setScalar(hp === 0 ? 0.65 : 1);
  }
  $("grid").replaceChildren();
  const layer = +$("layer").value;
  for (let z = -3; z <= 3; z++)
    for (let x = -3; x <= 3; x++) {
      const p = state.blueprint.find(
          (p) => p.x === x && p.y === layer && p.z === z,
        ),
        b = document.createElement("button");
      b.dataset.x = x;
      b.dataset.z = z;
      b.setAttribute(
        "aria-label",
        `${x},${layer},${z} ${p ? TYPES[p.type].label : "빈 칸"}`,
      );
      b.textContent = p
        ? { hull: "■", motor: "M", wheel: "○" }[p.type]
        : x === 0 && z === 0
          ? "+"
          : "·";
      if (p) {
        b.style.background =
          "#" + TYPES[p.type].color.toString(16).padStart(6, "0");
        b.style.color = "#fff";
        b.title = `${TYPES[p.type].label} ${state.hp[p.id].toFixed(0)} HP`;
        b.classList.toggle("dead", !state.hp[p.id]);
        b.classList.toggle("off", !f.connected.has(p.id));
      }
      if (x === 0 && z === 0 && layer === 0) b.classList.add("core");
      b.onclick = () => {
        if (driving) return;
        selected = p?.id;
        const tool = $("tool").value;
        const ok =
          tool === "damage"
            ? p && damage(state, p.id, 30)
            : edit(state, tool, x, layer, z, $("part").value);
        $("status").textContent = p
          ? `${TYPES[p.type].label} · ${Math.round(state.hp[p.id] || 0)} HP · ${evaluate(state).connected.has(p.id) ? "연결됨" : "기능 연결 끊김"}`
          : ok
            ? "구성 갱신"
            : "빈 칸·자원·부품 상태를 확인하세요.";
        revision = -1;
      };
      $("grid").append(b);
    }
  revision = state.revision;
}
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();
function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.min((now - (last || now)) / 1000, 0.1);
  last = now;
  if (document.hidden) return;
  if (driving) {
    const held = (k) => keys.has(k) || touch.has(k);
    control(state, {
      throttle:
        Number(held("KeyW") || held("ArrowUp")) -
        Number(held("KeyS") || held("ArrowDown")),
      steer:
        Number(held("KeyA") || held("ArrowLeft")) -
        Number(held("KeyD") || held("ArrowRight")),
      brake: held("Space"),
    });
    accum += elapsed;
    while (accum >= DT) {
      step(state);
      accum -= DT;
    }
  }
  if (revision !== state.revision) rebuild();
  const b = state.body,
    f = evaluate(state);
  vehicle.position.set(b.x, 0.25, b.z);
  vehicle.rotation.y = -b.yaw;
  const portrait = innerWidth < 600;
  const offset = new T.Vector3(
    driving ? 8 : 7,
    driving ? 9 : 10,
    driving ? 12 : 10,
  );
  camera.position.lerp(new T.Vector3(b.x, 0, b.z).add(offset), 0.09);
  camera.lookAt(b.x, portrait && !driving ? -3 : 0.3, b.z);
  ore.visible = state.ore > 0;
  const metrics = [
    ["속도", `${Math.hypot(b.vx, b.vz).toFixed(1)} m/s`],
    ["질량", `${f.mass} kg`],
    ["구동력", `${f.force.toFixed(0)} N`],
    [
      "접지 / 조향",
      `${(f.grip * 100).toFixed(0)} / ${(f.steering * 100).toFixed(0)}%`,
    ],
    ["재료 / 광맥", `${state.stock} / ${state.ore}`],
    ["연결 / 전체", `${f.connected.size} / ${state.blueprint.length}`],
    ["위치", `${b.x.toFixed(1)}, ${b.z.toFixed(1)}`],
    ["월드 시간", `${(state.tick * DT).toFixed(1)} s`],
  ];
  if (frames % 6 === 0) {
    $("metrics").innerHTML = metrics
      .map(([k, v]) => `<div>${k}<strong>${v}</strong></div>`)
      .join("");
    $("events").textContent = state.events.join(" · ");
    $("mine").disabled =
      Math.hypot(b.x + 6, b.z - 9) > 4 ||
      Math.hypot(b.vx, b.vz) > 0.2 ||
      state.ore === 0;
  }
  renderer.render(scene, camera);
  frames++;
  saveClock += elapsed;
  if (saveClock > 15) {
    saveClock = 0;
    save();
  }
  healthySince ||= now;
  if (!healthy && frames > 12 && now - healthySince > 3000) {
    healthy = true;
    window.AndroidApp?.runtimeHealthy?.(VERSION.versionCode);
  }
}
window.addEventListener("error", () => window.AndroidApp?.runtimeFailed?.());
window.FERAL_MACHINE = {
  get state() {
    return state;
  },
  evaluate: () => evaluate(state),
  mode: () => driving,
};
requestAnimationFrame(frame);

window.FeralNative={save, pause:()=>{if(driving)mode();clearInput();},back:()=>{if(save())location.href='worlds.html';}};
