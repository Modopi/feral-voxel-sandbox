import { SIZE, B, clamp, hash } from "./world.js";
const makePart = (
  name,
  offset,
  dims,
  cell,
  color,
  role = "body",
  parent = 0,
  leg = false,
) => ({
  name,
  offset,
  dims,
  cell,
  color,
  role,
  parent,
  leg,
  count: dims[0] * dims[1] * dims[2],
});
function species(name, cell, color, predator = false, small = false) {
  const leg = small ? 0.25 : 0.5,
    body = small ? 0.4 : 0.78,
    head = small ? 0.57 : 1.08,
    ear = small ? 0.78 : 1.45,
    s = small ? 0.55 : 1;
  return {
    name,
    cell,
    color,
    predator,
    s,
    parts: [
      makePart(
        "몸통",
        [0, body, 0],
        [4, 2, small ? 5 : 4],
        cell,
        color,
        "core",
        -1,
      ),
      makePart(
        "머리",
        [0, head, -0.53 * s],
        [2, 2, 2],
        cell,
        predator ? 0xd4a273 : 0xa4c899,
        "head",
      ),
      ...[
        [-0.35, leg, -0.32],
        [0.35, leg, -0.32],
        [-0.35, leg, 0.32],
        [0.35, leg, 0.32],
      ].map((p, i) =>
        makePart(
          ["왼쪽 앞다리", "오른쪽 앞다리", "왼쪽 뒷다리", "오른쪽 뒷다리"][i],
          [p[0] * s, p[1], p[2] * s],
          [1, 2, 1],
          cell,
          predator ? 0x705148 : 0x537767,
          "leg",
          0,
          true,
        ),
      ),
      makePart(
        "꼬리",
        [0, body, 0.65 * s],
        [1, 1, 2],
        cell,
        predator ? 0xe7bc88 : 0x6f9c85,
        "tail",
      ),
      ...[-1, 1].map((x, i) =>
        makePart(
          i ? "오른쪽 귀" : "왼쪽 귀",
          [x * 0.18 * s, ear, -0.53 * s],
          [1, small ? 1 : 2, 1],
          0.125,
          predator ? 0x6b4842 : 0xd8d4aa,
          "ear",
          1,
        ),
      ),
    ],
  };
}
// The two physical voxel resolutions are 0.25 m and 0.125 m.
export const SPECIES = [
  species("이끼사슴", 0.25, 0x769e80),
  species("구리여우", 0.25, 0xbe7952, true),
  species("청금딱정", 0.125, 0x4d9ead, false, true),
];
export function cellPosition(p, index) {
  const [x, y, z] = p.dims,
    ix = index % x,
    iy = ((index / x) | 0) % y,
    iz = (index / (x * y)) | 0;
  return [
    (ix + 0.5 - x / 2) * p.cell,
    (p.leg ? iy + 0.5 - y : iy + 0.5 - y / 2) * p.cell,
    (iz + 0.5 - z / 2) * p.cell,
  ];
}
export function pose(e, p, pi, time) {
  const swing = p.leg
    ? Math.sin(
        e.phase + time * e.speed * 5.6 + (pi === 3 || pi === 4 ? Math.PI : 0),
      ) *
      0.42 *
      e.moving
    : 0;
  return { angle: swing, offset: p.offset };
}
export function toWorld(e, p, pi, v, time) {
  const a = pose(e, p, pi, time).angle,
    c = Math.cos(a),
    s = Math.sin(a),
    cy = Math.cos(e.yaw),
    sy = Math.sin(e.yaw);
  const x = v[0] + p.offset[0],
    y = v[1] * c - v[2] * s + p.offset[1],
    z = v[1] * s + v[2] * c + p.offset[2];
  return [e.x + x * cy + z * sy, e.y + y, e.z - x * sy + z * cy];
}
export function toLocal(e, p, pi, v, time) {
  const dx = v[0] - e.x,
    dz = v[2] - e.z,
    c = Math.cos(e.yaw),
    s = Math.sin(e.yaw),
    x = dx * c - dz * s - p.offset[0],
    z = dx * s + dz * c - p.offset[2],
    y = v[1] - e.y - p.offset[1],
    a = pose(e, p, pi, time).angle;
  return [
    x,
    y * Math.cos(a) + z * Math.sin(a),
    -y * Math.sin(a) + z * Math.cos(a),
  ];
}
export function occupied(e, pi, j) {
  return !(e.lost & (1 << pi)) && (!e.damage[pi] || e.damage[pi][j] !== 0);
}
export class Ecology {
  constructor(world) {
    this.world = world;
    this.entities = [];
    this.nextId = 1;
    this.spatial = new Map();
    this.cursor = 0;
    this.tick = 0;
    this.birthBudget = 0;
    this.debris = [];
    this.onVoxel = null;
    this.onDeath = () => {};
  }
  spawn(type, x, z) {
    if (this.entities.length >= 3200) return null;
    const w = this.world;
    const e = {
      id: this.nextId++,
      type,
      x: clamp(x, 2, SIZE - 3),
      z: clamp(z, 2, SIZE - 3),
      y: 0,
      yaw: w.random() * Math.PI * 2,
      phase: w.random() * 7,
      moving: 1,
      speed: type === 1 ? 2.2 : type === 2 ? 0.7 : 1.2,
      hp: [48, 72, 32][type],
      maxHP: [48, 72, 32][type],
      energy: 60 + w.random() * 40,
      age: w.random() * 60,
      lost: 0,
      damage: {},
      targetX: x,
      targetZ: z,
      lastThink: 0,
      fear: 0,
      dead: false,
      behavior: "배회",
      fedUntil: 0,
      breedAt: 0,
      angryUntil: 0,
      biteAt: 0,
      dy: 0,
    };
    e.y = w.surface(e.x, e.z);
    this.entities.push(e);
    return e;
  }
  populate(n = 420) {
    for (let i = 0; i < n; i++) {
      let x = 8 + this.world.random() * (SIZE - 16),
        z = 8 + this.world.random() * (SIZE - 16);
      if (Math.hypot(x - 77.5, z - 84.5) < 6) {
        x = 30 + this.world.random() * 30;
        z = 35 + this.world.random() * 25;
      }
      if (this.world.surface(x, z) <= 9) {
        x = 20 + this.world.random() * 57;
      }
      this.spawn(i % 12 === 0 ? 1 : i % 7 === 0 ? 2 : 0, x, z);
    }
    for (let i = 0; i < 8; i++)
      this.spawn(i === 3 ? 1 : 0, 70 + i * 1.8, 66 + this.world.random() * 5);
    this.rehash();
  }
  rehash() {
    this.spatial.clear();
    for (const e of this.entities)
      if (!e.dead) {
        const key = (e.x >> 3) + "," + (e.z >> 3);
        let a = this.spatial.get(key);
        if (!a) this.spatial.set(key, (a = []));
        a.push(e);
      }
  }
  nearby(x, z, r = 8) {
    const a = [];
    for (let zz = (z - r) >> 3; zz <= (z + r) >> 3; zz++)
      for (let xx = (x - r) >> 3; xx <= (x + r) >> 3; xx++) {
        const list = this.spatial.get(xx + "," + zz);
        if (list)
          for (const e of list)
            if ((e.x - x) ** 2 + (e.z - z) ** 2 < r * r) a.push(e);
      }
    return a;
  }
  hurt(e, amount, cause = "체력 소진") {
    if (e.dead || !Number.isFinite(amount) || amount <= 0) return;
    e.hp = Math.max(0, e.hp - amount);
    if (e.hp <= 0) this.kill(e, cause);
  }
  kill(e, cause = "체력 소진") {
    if (e.dead) return;
    e.dead = true;
    e.hp = 0;
    e.deathCause = cause;
    e.energy = 0;
    this.world.reactions.deaths++;
    this.onDeath(e);
    const i = clamp(e.x | 0, 0, SIZE - 1) + clamp(e.z | 0, 0, SIZE - 1) * SIZE;
    this.world.nutrients[i] = clamp(this.world.nutrients[i] + 0.35, 0, 1);
    this.world.event(
      SPECIES[e.type].name + " 사망 · " + cause + " → 토양 영양분",
      [e.x, e.y, e.z],
    );
  }
  legs(e) {
    let n = 0;
    for (let i = 2; i < 6; i++) if (!(e.lost & (1 << i))) n++;
    return n;
  }
  feed(e, inv, time) {
    if (e.dead || e.type === 1) return "이 동물은 씨앗을 먹지 않습니다.";
    const player = this.context?.player;
    if (player && Math.hypot(e.x - player.x, e.z - player.z) > 3)
      return "3m 안에서 먹이를 주세요.";
    if (e.age < 25) return "어린 동물은 자연스럽게 성장합니다.";
    if (time < (e.breedAt || 0) || time < (e.fedUntil || 0))
      return "먹이를 충분히 먹었습니다. 잠시 기다리세요.";
    if (!inv.take("seed", 1)) return "씨앗이 필요합니다.";
    e.energy = clamp(e.energy + 25, 0, 150);
    e.hp = Math.min(e.maxHP, e.hp + 4);
    e.fedUntil = time + 45;
    e.behavior = "번식 준비";
    const mate = this.entities.find(
      (o) =>
        o !== e &&
        !o.dead &&
        o.type === e.type &&
        o.age >= 25 &&
        (o.fedUntil || 0) > time &&
        (o.breedAt || 0) <= time &&
        Math.hypot(o.x - e.x, o.z - e.z) < 5,
    );
    if (mate && this.entities.filter((o) => !o.dead).length < 3200) {
      const child = this.spawn(e.type, (e.x + mate.x) / 2, (e.z + mate.z) / 2);
      if (child) {
        child.age = 0;
        child.behavior = "성장 중";
        e.fedUntil = mate.fedUntil = 0;
        e.breedAt = mate.breedAt = time + 90;
        this.world.reactions.births++;
        return SPECIES[e.type].name + " 새끼 탄생 · 부모는 90초 휴식";
      }
    }
    return "먹이 −1 · 근처의 같은 종에게도 먹이를 주세요.";
  }
  think(e, dt) {
    const w = this.world;
    e.age += dt;
    e.behavior = e.age < 25 ? "성장 중" : "배회";
    e.energy -= dt * (e.type === 1 ? 0.33 : 0.13);
    if (e.hp <= 0 || e.energy <= 0 || e.lost & 3) {
      this.kill(
        e,
        e.lost & 1
          ? "몸통 파괴"
          : e.lost & 2
            ? "머리 파괴"
            : e.hp <= 0
              ? "체력 소진"
              : "굶주림",
      );
      return;
    }
    let dx = e.targetX - e.x,
      dz = e.targetZ - e.z;
    const i = clamp(e.x | 0, 0, SIZE - 1) + clamp(e.z | 0, 0, SIZE - 1) * SIZE,
      food = w.plants[i];
    const near = this.nearby(e.x, e.z, 9);
    let prey = null,
      danger = null,
      dist = 100;
    for (const o of near) {
      if (o === e || o.dead) continue;
      const d = (o.x - e.x) ** 2 + (o.z - e.z) ** 2;
      if (e.type === 1 && o.type === 0 && d < dist) {
        prey = o;
        dist = d;
      } else if (e.type !== 1 && o.type === 1) danger = o;
    }
    if (danger) {
      e.behavior = "포식자 회피";
      e.targetX = clamp(e.x + (e.x - danger.x) * 3, 2, SIZE - 3);
      e.targetZ = clamp(e.z + (e.z - danger.z) * 3, 2, SIZE - 3);
      e.fear = 3;
    } else if (prey) {
      e.behavior = "사냥";
      e.targetX = prey.x;
      e.targetZ = prey.z;
      if (dist < 1.9) {
        this.hurt(prey, dt * 18, "포식자 공격");
        e.energy = clamp(e.energy + dt * 8, 0, 150);
        if (prey.energy <= 0) this.kill(prey);
      }
    } else if (e.type !== 1 && food > 0.15 && !(e.lost & 2) && e.fear <= 0) {
      e.behavior = "풀뜯기";
      const bite = Math.min(food, dt * 0.1);
      w.plants[i] -= bite;
      e.energy = clamp(e.energy + bite * 30, 0, 150);
      w.reactions.grazed += bite;
      e.moving = 0.15;
    }
    if (!danger && !prey && (dx * dx + dz * dz < 2 || w.random() < dt * 0.15)) {
      let best = -100,
        bx = e.x,
        bz = e.z;
      for (let k = 0; k < 5; k++) {
        let x = clamp(e.x + (w.random() - 0.5) * 20, 2, SIZE - 3),
          z = clamp(e.z + (w.random() - 0.5) * 20, 2, SIZE - 3),
          h = w.surface(x, z),
          score =
            e.type === 1
              ? w.random()
              : w.plants[(x | 0) + (z | 0) * SIZE] + w.random() * 0.4;
        if (h <= 9) score -= 3;
        if (Math.abs(h - e.y) > 2) score -= 4;
        if (score > best) {
          best = score;
          bx = x;
          bz = z;
        }
      }
      e.targetX = bx;
      e.targetZ = bz;
    }
    const ctx = this.context,
      player = ctx?.player,
      time = w.time;
    if (player) {
      const distance = Math.hypot(player.x - e.x, player.z - e.z),
        night = (8 + time / 60) % 24 >= 19 || (8 + time / 60) % 24 < 6;
      if (
        e.type === 1 &&
        distance < 10 &&
        (night || time < (e.angryUntil || 0))
      ) {
        e.behavior = night ? "야간 사냥" : "반격";
        e.targetX = player.x;
        e.targetZ = player.z;
        if (
          distance < 1.8 &&
          Math.abs(player.y - e.y) < 1.5 &&
          time >= (e.biteAt || 0)
        ) {
          const origin = { x: e.x, y: e.y + 0.65, z: e.z },
            dx = player.x - e.x,
            dy = player.y + 0.7 - origin.y,
            dz = player.z - e.z,
            len = Math.hypot(dx, dy, dz);
          if (
            !w.raycast(origin, { x: dx / len, y: dy / len, z: dz / len }, len)
          ) {
            ctx.hurt?.(8);
            e.biteAt = time + 1;
          }
        }
      } else if (e.type !== 1 && e.fear > 0 && distance < 9) {
        e.behavior = "도망";
        e.targetX = clamp(e.x + (e.x - player.x) * 3, 2, SIZE - 3);
        e.targetZ = clamp(e.z + (e.z - player.z) * 3, 2, SIZE - 3);
      } else if (
        e.type !== 1 &&
        !danger &&
        ctx.held === "seed" &&
        distance < 7 &&
        distance > 1.7
      ) {
        e.behavior = "씨앗 따라가기";
        e.targetX = player.x;
        e.targetZ = player.z;
      }
    }
    const burn = w.burning.has(w.index(e.x | 0, (e.y - 1) | 0, e.z | 0)),
      f = w.fluids.get(w.index(e.x | 0, e.y | 0, e.z | 0));
    if (burn || f?.a > 0.1) {
      this.hurt(e, dt * 10, burn ? "화상" : "산성 피해");
      e.fear = 3;
      e.targetX = clamp(e.x + (w.random() - 0.5) * 12, 2, SIZE - 3);
      e.targetZ = clamp(e.z + (w.random() - 0.5) * 12, 2, SIZE - 3);
    }
    e.fear = Math.max(0, e.fear - dt);
    if (e.lost & 2) e.energy -= dt * 1.5;
    if (
      e.energy > 125 &&
      e.age > 25 &&
      this.birthBudget > 0 &&
      this.entities.length < 3200 &&
      (e.breedAt || 0) <= w.time &&
      near.some(
        (o) =>
          o !== e &&
          !o.dead &&
          o.type === e.type &&
          o.age > 25 &&
          o.energy > 125 &&
          (o.breedAt || 0) <= w.time,
      )
    ) {
      const child = this.spawn(
        e.type,
        e.x + (w.random() - 0.5) * 3,
        e.z + (w.random() - 0.5) * 3,
      );
      if (child) {
        child.age = 0;
        e.energy -= 50;
        e.breedAt = w.time + 90;
        w.reactions.births++;
        this.birthBudget--;
      }
    }
  }
  update(dt, camera, time) {
    this.tick++;
    if (this.tick % 8 === 0) this.rehash();
    this.birthBudget = Math.min(3, this.birthBudget + dt * 0.15);
    // Movement is integrated for every entity; distant decisions run at a lower rate.
    for (const e of this.entities) {
      if (e.dead) continue;
      e.px = e.x;
      e.py = e.y;
      e.pz = e.z;
      const d2 = (e.x - camera.x) ** 2 + (e.z - camera.z) ** 2,
        interval = d2 < 900 ? 0.25 : d2 < 3600 ? 1 : 3;
      if (time - e.lastThink >= interval) {
        this.think(e, Math.min(time - e.lastThink, 3.2));
        e.lastThink = time;
      }
      const dx = e.targetX - e.x,
        dz = e.targetZ - e.z,
        l = Math.hypot(dx, dz),
        legs = this.legs(e);
      e.moving = l > 1 ? 1 : 0.08;
      const speed =
        e.speed *
        (legs / 4) ** 1.5 *
        (e.fear > 0 ? 1.55 : 1) *
        (e.lost & 1 ? 0 : 1);
      if (l > 1 && speed > 0) {
        const nx = clamp(e.x + (dx / l) * speed * dt, 1, SIZE - 2),
          nz = clamp(e.z + (dz / l) * speed * dt, 1, SIZE - 2),
          h = this.world.surface(nx, nz);
        if (
          h - e.y <= 1.2 &&
          !this.world.get(nx | 0, (e.y + 0.8) | 0, nz | 0)
        ) {
          e.x = nx;
          e.z = nz;
        } else {
          e.targetX = e.x - dz * 2;
          e.targetZ = e.z + dx * 2;
        }
        const angle = Math.atan2(-dx, -dz),
          diff = Math.atan2(Math.sin(angle - e.yaw), Math.cos(angle - e.yaw));
        e.yaw += diff * Math.min(1, dt * 7);
      }
      const h = this.world.surface(e.x, e.z);
      if (e.y > h) {
        e.dy -= dt * 12;
        e.y = Math.max(h, e.y + e.dy * dt);
      } else {
        e.y = h;
        e.dy = 0;
      }
    }
    if (this.tick % 150 === 0)
      this.entities = this.entities.filter((e) => !e.dead);
    for (const d of this.debris) {
      d.life -= dt;
      d.vy -= dt * 10;
      d.x += d.vx * dt;
      d.z += d.vz * dt;
      d.y += d.vy * dt;
      d.rx += dt * 3;
      const h = this.world.surface(d.x, d.z);
      if (d.y < h + 0.1) {
        d.y = h + 0.1;
        d.vy *= -0.2;
        d.vx *= 0.8;
        d.vz *= 0.8;
      }
    }
    this.debris = this.debris.filter((d) => d.life > 0);
  }
  ray(origin, dir, max = 8, time = 0) {
    let hit = null,
      best = max;
    for (const e of this.nearby(origin.x, origin.z, max + 2)) {
      if (e.dead) continue;
      const ex = e.x - origin.x,
        ey = e.y + 0.9 - origin.y,
        ez = e.z - origin.z,
        along = ex * dir.x + ey * dir.y + ez * dir.z;
      if (
        along < -0.5 ||
        along > best + 1.8 ||
        ex * ex + ey * ey + ez * ez - along * along > 4
      )
        continue;
      const sp = SPECIES[e.type];
      for (
        let t = Math.max(0.05, along - 2);
        t < Math.min(best, along + 2);
        t += 0.035
      ) {
        const pt = [
          origin.x + dir.x * t,
          origin.y + dir.y * t,
          origin.z + dir.z * t,
        ];
        for (let pi = 0; pi < sp.parts.length; pi++) {
          if (e.lost & (1 << pi)) continue;
          const p = sp.parts[pi],
            v = toLocal(e, p, pi, pt, time),
            ix = Math.floor(v[0] / p.cell + p.dims[0] / 2),
            iy = Math.floor(
              v[1] / p.cell + (p.leg ? p.dims[1] : p.dims[1] / 2),
            ),
            iz = Math.floor(v[2] / p.cell + p.dims[2] / 2);
          if (
            ix < 0 ||
            iy < 0 ||
            iz < 0 ||
            ix >= p.dims[0] ||
            iy >= p.dims[1] ||
            iz >= p.dims[2]
          )
            continue;
          const j = ix + iy * p.dims[0] + iz * p.dims[0] * p.dims[1];
          if (occupied(e, pi, j)) {
            best = t;
            hit = { entity: e, part: pi, voxel: j, point: pt, distance: t };
            break;
          }
        }
        if (hit?.entity === e) break;
      }
    }
    return hit;
  }
  emitDebris(d) {
    if (this.onVoxel) this.onVoxel(d);
    else this.debris.push(d);
  }
  detach(e, pi, time) {
    if (e.lost & (1 << pi)) return;
    const p = SPECIES[e.type].parts[pi];
    e.lost |= 1 << pi;
    for (let j = 0; j < p.count; j++)
      if (!e.damage[pi] || e.damage[pi][j]) {
        if (this.debris.length >= 350) break;
        const v = toWorld(e, p, pi, cellPosition(p, j), time);
        this.emitDebris({
          x: v[0],
          y: v[1],
          z: v[2],
          vx: (this.world.random() - 0.5) * 2,
          vy: 1 + this.world.random() * 2,
          vz: (this.world.random() - 0.5) * 2,
          rx: 0,
          life: 7,
          cell: p.cell,
          color: p.color,
        });
      }
    for (let k = 0; k < SPECIES[e.type].parts.length; k++)
      if (SPECIES[e.type].parts[k].parent === pi) this.detach(e, k, time);
    if (p.role === "core" || p.role === "head")
      this.kill(e, p.role === "core" ? "몸통 파괴" : "머리 파괴");
    this.world.event(SPECIES[e.type].name + " · " + p.name + " 분리", [
      e.x,
      e.y,
      e.z,
    ]);
  }
  damageHit(hit, time, radius = 0.28, damage = 12) {
    if (hit.entity.dead) return 0;
    const e = hit.entity,
      pi = hit.part,
      p = SPECIES[e.type].parts[pi];
    if (!e.damage[pi]) e.damage[pi] = new Uint8Array(p.count).fill(1);
    const v = toLocal(e, p, pi, hit.point, time),
      dam = e.damage[pi];
    let removed = 0;
    for (let j = 0; j < p.count; j++) {
      const q = cellPosition(p, j);
      if (
        dam[j] &&
        (j === hit.voxel ||
          Math.hypot(q[0] - v[0], q[1] - v[1], q[2] - v[2]) < radius)
      ) {
        dam[j] = 0;
        removed++;
        if (this.debris.length < 350) {
          const w = toWorld(e, p, pi, q, time);
          this.emitDebris({
            x: w[0],
            y: w[1],
            z: w[2],
            vx: (this.world.random() - 0.5) * 4,
            vy: 2,
            vz: (this.world.random() - 0.5) * 4,
            life: 5,
            rx: 0,
            cell: p.cell,
            color: p.color,
          });
        }
      }
    }
    // Remove disconnected islands from the largest remaining voxel component.
    let largest = [],
      seen = new Uint8Array(p.count);
    const nx = p.dims[0],
      ny = p.dims[1],
      nz = p.dims[2];
    for (let j = 0; j < p.count; j++)
      if (dam[j] && !seen[j]) {
        const stack = [j],
          component = [];
        seen[j] = 1;
        while (stack.length) {
          const a = stack.pop(),
            x = a % nx,
            y = ((a / nx) | 0) % ny,
            z = (a / (nx * ny)) | 0;
          component.push(a);
          for (const [dx, dy, dz] of [
            [1, 0, 0],
            [-1, 0, 0],
            [0, 1, 0],
            [0, -1, 0],
            [0, 0, 1],
            [0, 0, -1],
          ]) {
            const xx = x + dx,
              yy = y + dy,
              zz = z + dz,
              b = xx + yy * nx + zz * nx * ny;
            if (
              xx >= 0 &&
              yy >= 0 &&
              zz >= 0 &&
              xx < nx &&
              yy < ny &&
              zz < nz &&
              dam[b] &&
              !seen[b]
            ) {
              seen[b] = 1;
              stack.push(b);
            }
          }
        }
        if (component.length > largest.length) largest = component;
      }
    const keep = new Set(largest);
    for (let j = 0; j < dam.length; j++)
      if (dam[j] && !keep.has(j)) {
        dam[j] = 0;
        removed++;
        const w = toWorld(e, p, pi, cellPosition(p, j), time);
        this.emitDebris({
          x: w[0],
          y: w[1],
          z: w[2],
          vx: 0,
          vy: 1,
          vz: 0,
          life: 5,
          rx: 0,
          cell: p.cell,
          color: p.color,
        });
      }
    if (removed)
      this.hurt(
        e,
        damage * (p.role === "head" ? 1.5 : 1),
        p.role === "head" ? "머리 치명타" : "공격 피해",
      );
    e.fear = 6;
    e.angryUntil = time + 12;
    e.targetX = clamp(e.x + (this.world.random() - 0.5) * 16, 2, SIZE - 3);
    e.targetZ = clamp(e.z + (this.world.random() - 0.5) * 16, 2, SIZE - 3);
    if (largest.length < Math.max(1, p.count * 0.38)) this.detach(e, pi, time);
    if (e.energy <= 0) this.kill(e);
    return removed;
  }
  stats() {
    const counts = [0, 0, 0];
    let injured = 0;
    for (const e of this.entities)
      if (!e.dead) {
        counts[e.type]++;
        if (e.lost || Object.keys(e.damage).length) injured++;
      }
    return { counts, total: counts.reduce((a, b) => a + b, 0), injured };
  }
  save() {
    return {
      nextId: this.nextId,
      entities: this.entities
        .filter((e) => !e.dead)
        .map((e) => ({
          ...e,
          damage: Object.fromEntries(
            Object.entries(e.damage).map(([k, v]) => [k, Array.from(v)]),
          ),
        })),
    };
  }
  load(s) {
    this.nextId = s.nextId;
    this.entities = s.entities.map((e) => ({
      ...e,
      maxHP: [48, 72, 32][e.type],
      hp: Number.isFinite(e.hp)
        ? clamp(e.hp, 0, [48, 72, 32][e.type])
        : [48, 72, 32][e.type],
      damage: Object.fromEntries(
        Object.entries(e.damage).map(([k, v]) => [
          k,
          (() => {
            const n = SPECIES[e.type].parts[k]?.count || v.length;
            if (n === v.length) return new Uint8Array(v);
            const intact = v.filter(Boolean).length / v.length,
              arr = new Uint8Array(n).fill(1);
            arr.fill(0, 0, Math.round(n * (1 - intact)));
            return arr;
          })(),
        ]),
      ),
    }));
    this.rehash();
  }
}
