import { components, massProperties } from "../structure.js";
import { validPose } from "./assembly-state.js";
// 표현 계층에서 독립된 기계 데이터와 고정 시간 시뮬레이션
export const DT = 1 / 60;
export const TYPES = Object.freeze({
  cannon: { label: "포탑", mass: 28, hp: 70, cost: 8, color: 0xc2a178 },
  rotor: { label: "회전익", mass: 14, hp: 50, cost: 10, color: 0x9ac9ce },
  hull: { label: "차체", mass: 12, hp: 100, cost: 1, color: 0x8ca7a2 },
  motor: { label: "모터", mass: 22, hp: 80, cost: 6, color: 0xffbf58 },
  wheel: { label: "바퀴", mass: 8, hp: 60, cost: 3, color: 0x34404c },
});
export const OBSTACLES = [
  { x: 0, z: -10, r: 2 },
  { x: 10, z: 5, r: 2.5 },
  { x: -10, z: -5, r: 1.8 },
];
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const key = (x, y, z) => `${x},${y},${z}`;
export function createLab() {
  return {
    schema: 1,
    nextId: 1,
    blueprint: [],
    hp: {},
    stock: 60,
    ore: 80,
    tick: 0,
    body: { x: 0, z: 5, yaw: 0, vx: 0, vz: 0 },
    command: { throttle: 0, steer: 0, brake: false },
    events: [],
    revision: 0,
  };
}
export function message(s, text) {
  s.events.unshift(text);
  s.events.length = Math.min(5, s.events.length);
}
export function edit(s, kind, x, y, z, type = "hull") {
  if (Math.hypot(s.body.vx, s.body.vz) > 0.12) return false;
  if (
    ![x, y, z].every(Number.isInteger) ||
    Math.abs(x) > 3 ||
    y < 0 ||
    y > 2 ||
    Math.abs(z) > 3
  )
    return false;
  const p = s.blueprint.find((p) => p.x === x && p.y === y && p.z === z);
  if (kind === "add") {
    if (p || !TYPES[type] || s.stock < TYPES[type].cost) return false;
    const part = { id: `p${s.nextId++}`, x, y, z, type };
    s.blueprint.push(part);
    s.hp[part.id] = TYPES[type].hp;
    s.stock -= TYPES[type].cost;
  } else if (kind === "remove" && p) {
    // 손상된 부품 해체 시 자원 증식 방지
    s.stock += Math.floor((TYPES[p.type].cost * s.hp[p.id]) / TYPES[p.type].hp);
    s.blueprint = s.blueprint.filter((a) => a !== p);
    delete s.hp[p.id];
  } else if (kind === "repair" && p && s.hp[p.id] < TYPES[p.type].hp) {
    const cost = Math.max(
      1,
      Math.ceil(TYPES[p.type].cost * (1 - s.hp[p.id] / TYPES[p.type].hp)),
    );
    if (s.stock < cost) return false;
    s.stock -= cost;
    s.hp[p.id] = TYPES[p.type].hp;
  } else return false;
  s.revision++;
  return true;
}
export function evaluate(s) {
  const alive = s.blueprint.filter((p) => s.hp[p.id] > 0);
  const group =
    components(alive).find((g) =>
      g.some((p) => p.type === "hull" && p.x === 0 && p.y === 0 && p.z === 0),
    ) || [];
  const connected = new Set(group.map((p) => p.id));
  let weapons = 0,
    lift = 0;
  let mass = 0,
    power = 0,
    left = 0,
    right = 0,
    wheels = 0,
    radius = 0.5;
  for (const p of s.blueprint) {
    if (!s.hp[p.id]) continue;
    mass += TYPES[p.type].mass;
    radius = Math.max(radius, Math.hypot(p.x * 0.5, p.z * 0.5) + 0.36);
    if (!connected.has(p.id)) continue;
    const health = s.hp[p.id] / TYPES[p.type].hp;
    if (p.type === "cannon") weapons += health;
    if (p.type === "rotor") lift += health;
    if (p.type === "motor") power += health * 600;
    if (p.type === "wheel" && p.y === 0) {
      wheels += health;
      if (p.x < 0) left += health;
      if (p.x > 0) right += health;
    }
  }
  const grip = Math.min(1, wheels / 4),
    steering = Math.min(1, left, right);
  return {
    ...massProperties(
      alive.map((p) => ({
        x: p.x * 0.5,
        y: p.y * 0.5 + 0.25,
        z: p.z * 0.5,
        mass: TYPES[p.type].mass,
        size: 0.5,
      })),
    ),
    weapons,
    lift,
    mass: Math.max(1, mass),
    power,
    grip,
    steering,
    left,
    right,
    radius,
    connected,
    force: power * grip,
  };
}
export function damage(s, id, amount) {
  if (!Number.isFinite(amount) || amount <= 0 || !(id in s.hp)) return false;
  s.hp[id] = Math.max(0, s.hp[id] - amount);
  s.revision++;
  return true;
}
export function control(s, c) {
  s.command = {
    throttle: clamp(Number(c.throttle) || 0, -1, 1),
    steer: clamp(Number(c.steer) || 0, -1, 1),
    brake: !!c.brake,
  };
}
export function step(s) {
  const f = evaluate(s),
    b = s.body,
    c = s.command;
  const forward = b.vx * Math.sin(b.yaw) - b.vz * Math.cos(b.yaw);
  // 속도 의존 조향과 좌우 바퀴 손상에 따른 편향
  b.yaw +=
    (c.steer * f.steering + clamp(f.right - f.left, -1, 1) * 0.22) *
    clamp(forward / 3, -1, 1) *
    DT;
  const drag = c.brake ? 8 : 0.65;
  b.vx +=
    ((Math.sin(b.yaw) * c.throttle * f.force) / f.mass - drag * b.vx) * DT;
  b.vz +=
    ((-Math.cos(b.yaw) * c.throttle * f.force) / f.mass - drag * b.vz) * DT;
  b.x += b.vx * DT;
  b.z += b.vz * DT;
  function hit(nx, nz, penetration) {
    b.x += nx * penetration;
    b.z += nz * penetration;
    const impact = -(b.vx * nx + b.vz * nz);
    if (impact <= 0) return;
    b.vx += nx * impact;
    b.vz += nz * impact;
    if (impact < 1) return;
    let target,
      dist = Infinity;
    for (const p of s.blueprint) {
      if (!s.hp[p.id]) continue;
      const px = p.x * Math.cos(b.yaw) + p.z * Math.sin(b.yaw),
        pz = -p.x * Math.sin(b.yaw) + p.z * Math.cos(b.yaw);
      const d = px * nx + pz * nz;
      if (d < dist) {
        dist = d;
        target = p;
      }
    }
    if (target) {
      damage(s, target.id, impact * 12);
      message(s, `${TYPES[target.type].label} 충돌 · ${impact.toFixed(1)} m/s`);
    }
  }
  for (const o of OBSTACLES) {
    const dx = b.x - o.x,
      dz = b.z - o.z,
      d = Math.hypot(dx, dz),
      r = o.r + f.radius;
    if (d < r) hit(d > 1e-6 ? dx / d : 1, d > 1e-6 ? dz / d : 0, r - d);
  }
  for (const axis of ["x", "z"]) {
    const limit = 23 - f.radius;
    if (Math.abs(b[axis]) > limit) {
      const sign = Math.sign(b[axis]);
      hit(
        axis === "x" ? -sign : 0,
        axis === "z" ? -sign : 0,
        Math.abs(b[axis]) - limit,
      );
    }
  }
  s.tick++;
}
export function mine(s) {
  if (
    Math.hypot(s.body.x + 6, s.body.z - 9) > 4 ||
    Math.hypot(s.body.vx, s.body.vz) > 0.2 ||
    s.ore <= 0
  )
    return false;
  const n = Math.min(4, s.ore);
  s.ore -= n;
  s.stock += n;
  message(s, `광맥 채굴 +${n}`);
  return true;
}
export function preset(s, heavy = false) {
  s.blueprint = [];
  s.hp = {};
  s.stock = 60;
  s.ore = 80;
  s.nextId = 1;
  s.body = { x: 0, z: 5, yaw: 0, vx: 0, vz: 0 };
  control(s, {});
  for (let z = -1; z <= 1; z++) edit(s, "add", 0, 0, z);
  edit(s, "add", 0, 1, 0, "motor");
  for (const x of [-1, 1])
    for (const z of [-1, 1]) edit(s, "add", x, 0, z, "wheel");
  if (heavy)
    for (let z = -2; z <= 2; z++)
      for (const x of [-1, 0, 1]) edit(s, "add", x, 1, z);
  s.revision++;
  message(
    s,
    heavy ? "중량 설계 불러옴 · 자원 초기화" : "경량 설계 불러옴 · 자원 초기화",
  );
}
export function serialize(s) {
  return JSON.stringify(s);
}
export function restore(raw) {
  const a = JSON.parse(raw),
    s = createLab();
  if (a.schema !== 1 || !Array.isArray(a.blueprint) || a.blueprint.length > 147)
    throw Error("지원하지 않는 기계 저장");
  const ids = new Set(),
    positions = new Set();
  for (const p of a.blueprint) {
    const k = key(p.x, p.y, p.z);
    if (
      !TYPES[p.type] ||
      !/^p\d+$/.test(p.id) ||
      ids.has(p.id) ||
      positions.has(k) ||
      ![p.x, p.y, p.z].every(Number.isInteger) ||
      Math.abs(p.x) > (a.assembly ? 16 : 3) ||
      p.y < (a.assembly ? -16 : 0) ||
      p.y > (a.assembly ? 16 : 2) ||
      Math.abs(p.z) > (a.assembly ? 16 : 3) ||
      !Number.isFinite(a.hp?.[p.id]) ||
      a.hp[p.id] < 0 ||
      a.hp[p.id] > TYPES[p.type].hp
    )
      throw Error("손상된 부품 저장");
    ids.add(p.id);
    positions.add(k);
  }
  for (const n of ["stock", "ore", "tick", "nextId"])
    if (!Number.isSafeInteger(a[n]) || a[n] < 0)
      throw Error("손상된 월드 저장");
  for (const n of ["x", "z", "yaw", "vx", "vz"])
    if (!Number.isFinite(a.body?.[n])) throw Error("손상된 역학 저장");
  if (
    Math.abs(a.body.x) > 24 ||
    Math.abs(a.body.z) > 24 ||
    a.stock > 10000 ||
    a.ore > 80 ||
    a.nextId <= Math.max(0, ...[...ids].map((id) => +id.slice(1)))
  )
    throw Error("저장 범위 오류");
  Object.assign(s, {
    blueprint: a.blueprint,
    hp: a.hp,
    body: a.body,
    stock: a.stock,
    ore: a.ore,
    tick: a.tick,
    nextId: a.nextId,
  });
  if (a.pose) s.pose = validPose(a.pose);
  if (a.assembly) s.assembly = true;
  if (a.fragments) {
    if (!Array.isArray(a.fragments) || a.fragments.length > 147)
      throw Error("조립체 조각 범위 오류");
    s.fragments = a.fragments.map((f) => {
      if (!f.pose || !f.assembly) throw Error("조립체 조각의 위치가 없습니다.");
      return restore(JSON.stringify({ ...f, fragments: undefined }));
    });
    if (
      [s, ...s.fragments].reduce(
        (n, f) => n + f.blueprint.filter((p) => f.hp[p.id] > 0).length,
        0,
      ) > 147
    )
      throw Error("전체 부품 수 범위 오류");
  }
  return s;
}
