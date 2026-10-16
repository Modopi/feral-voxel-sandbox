import { B, clamp } from "./world.js";
import { solidAt } from "./physics.js";
export const ITEMS = {
  dirt: { name: "흙 조각", icon: "▣", color: 0x9b7654, block: B.DIRT },
  stone: { name: "돌 조각", icon: "◆", color: 0x99a5a7, block: B.STONE },
  wood: { name: "원목 조각", icon: "▥", color: 0x9f7849, block: B.WOOD },
  sand: { name: "모래", icon: "▨", color: 0xd9c586, block: B.SAND },
  fiber: { name: "식물 섬유", icon: "❧", color: 0x8eaf65 },
  crystal: { name: "광석 결정", icon: "◇", color: 0x77c9ca },
  bio: { name: "생체 복셀", icon: "⬡", color: 0xb7c996 },
  essence: { name: "생명 정수", icon: "✧", color: 0xe2c26e },
  plank: { name: "목재 조각", icon: "▤", color: 0xc5a071, block: B.PLANK },
  seed: { name: "씨앗", icon: "✿", color: 0x98bf68 },
  resin: { name: "생체 수지", icon: "◉", color: 0xe4bc75 },
};
export const RECIPES = [
  {
    id: "planks",
    name: "목재 조각 × 4",
    description: "건축과 도구에 쓰는 가공 목재",
    cost: { wood: 2 },
    give: { plank: 4 },
  },
  {
    id: "seeds",
    name: "씨앗 × 3",
    description: "식생 복원 도구의 소모 재료",
    cost: { fiber: 2 },
    give: { seed: 3 },
  },
  {
    id: "resin",
    name: "생체 수지 × 2",
    description: "몹에서 모은 복셀로 만드는 접착 재료",
    cost: { bio: 6 },
    give: { resin: 2 },
  },
  {
    id: "hammer",
    name: "2 m 채굴 해머",
    description: "한 번에 1 m³의 여덟 배를 채굴",
    cost: { stone: 12, plank: 4, resin: 2 },
    unlock: "hammer",
  },
  {
    id: "pulse",
    name: "강화 복셀 펄스",
    description: "생체 복셀 파괴 반경 0.18 → 0.30 m",
    cost: { crystal: 5, resin: 3, essence: 1 },
    unlock: "pulse",
  },
];
export function resourceForBlock(b) {
  return b === B.DIRT || b === B.GRASS || b === B.ASH
    ? "dirt"
    : b === B.STONE || b === B.BASALT
      ? "stone"
      : b === B.WOOD
        ? "wood"
        : b === B.LEAF
          ? "fiber"
          : b === B.ORE
            ? "crystal"
            : b === B.SAND
              ? "sand"
              : b === B.PLANK
                ? "plank"
                : null;
}
export class Inventory {
  constructor(starter = true) {
    this.items = starter ? { dirt: 16, wood: 4, stone: 4, seed: 4 } : {};
    this.unlocks = new Set();
    this.revision = 0;
  }
  count(id) {
    return this.items[id] || 0;
  }
  add(id, n) {
    if (!ITEMS[id] || n <= 0) return 0;
    const add = Math.min(Math.floor(n), 9999 - this.count(id));
    if (add > 0) {
      this.items[id] = this.count(id) + add;
      this.revision++;
    }
    return add;
  }
  take(id, n) {
    if (this.count(id) < n) return false;
    this.items[id] -= n;
    this.revision++;
    return true;
  }
  canCraft(recipe) {
    return (
      !(recipe.unlock && this.unlocks.has(recipe.unlock)) &&
      Object.entries(recipe.cost).every(([id, n]) => this.count(id) >= n) &&
      Object.entries(recipe.give || {}).every(
        ([id, n]) => this.count(id) + n <= 9999,
      )
    );
  }
  craft(id) {
    const r = RECIPES.find((r) => r.id === id);
    if (!r || !this.canCraft(r)) return false;
    for (const [k, n] of Object.entries(r.cost)) this.take(k, n);
    for (const [k, n] of Object.entries(r.give || {})) this.add(k, n);
    if (r.unlock) this.unlocks.add(r.unlock);
    this.revision++;
    return true;
  }
  save() {
    return { items: this.items, unlocks: [...this.unlocks] };
  }
  load(s) {
    this.items = {};
    for (const [k, n] of Object.entries(s?.items || {}))
      if (ITEMS[k] && Number.isFinite(n))
        this.items[k] = clamp(Math.floor(n), 0, 9999);
    this.unlocks = new Set(
      (s?.unlocks || []).filter((k) => ["hammer", "pulse"].includes(k)),
    );
    this.revision++;
  }
}
export class Pickups {
  constructor() {
    this.items = [];
    this.nextId = 1;
    this.collected = 0;
    this.onCollect = () => {};
    this.revision = 0;
  }
  spawn(kind, count, x, y, z, options = {}) {
    if (!ITEMS[kind] || count <= 0) return;
    let nearby = this.items.find(
      (d) =>
        d.kind === kind &&
        d.life > 0 &&
        (d.x - x) ** 2 + (d.z - z) ** 2 + (d.y - y) ** 2 < 0.6 ** 2,
    );
    if (nearby) {
      nearby.count += count;
      nearby.life = 240;
      return nearby;
    }
    if (this.items.length >= 600) {
      nearby = this.items.find((d) => d.kind === kind && d.life > 0);
      if (nearby) {
        nearby.count += count;
        return nearby;
      }
      return null;
    }
    const phase = this.nextId * 2.399963,
      cell = options.cell || 0.15,
      d = {
        id: this.nextId++,
        kind,
        count,
        x,
        y,
        z,
        vx: options.vx ?? Math.sin(phase) * 0.5,
        vy: options.vy ?? 1.2,
        vz: options.vz ?? Math.cos(phase) * 0.5,
        cell,
        color: options.color || ITEMS[kind].color,
        rx: options.rx || 0,
        life: 240,
        settled: false,
      };
    this.items.push(d);
    this.revision++;
    return d;
  }
  update(dt, world, player, inventory) {
    for (const d of this.items) {
      d.life -= dt;
      if (d.life <= 0) continue;
      const dx = player.x - d.x,
        dy = player.y + 0.65 - d.y,
        dz = player.z - d.z,
        dist = Math.hypot(dx, dy, dz);
      if (dist < 1.55) {
        const n = inventory.add(d.kind, d.count);
        d.count -= n;
        if (n) {
          this.collected += n;
          this.onCollect(d.kind, n);
          this.revision++;
        }
        if (d.count <= 0) {
          d.life = 0;
          continue;
        }
      }
      if (!d.settled || !solidAt(world, d.x, d.y - d.cell * 0.5 - 0.015, d.z)) {
        d.settled = false;
        d.vy = Math.max(-12, d.vy - dt * 12);
        const dyStep = d.vy * dt,
          steps = Math.max(1, Math.ceil(Math.abs(dyStep) / 0.08));
        for (let k = 0; k < steps; k++) {
          const ny = d.y + dyStep / steps;
          if (solidAt(world, d.x, ny - d.cell * 0.5, d.z)) {
            if (d.vy < 0) {
              d.y = Math.ceil((ny - d.cell * 0.5) * 2) * 0.5 + d.cell * 0.5;
              d.settled = true;
            }
            d.vy = 0;
            break;
          }
          d.y = ny;
        }
        const nx = d.x + d.vx * dt,
          nz = d.z + d.vz * dt;
        if (!solidAt(world, nx, d.y, nz)) {
          d.x = nx;
          d.z = nz;
        }
        d.vx *= Math.exp(-dt * 3);
        d.vz *= Math.exp(-dt * 3);
        d.rx += dt;
      }
      if (d.y < 0.1 || d.x < 0 || d.z < 0 || d.x >= 160 || d.z >= 160)
        d.life = 0;
    }
    this.items = this.items.filter((d) => d.life > 0 && d.count > 0);
  }
  save() {
    return {
      items: this.items,
      nextId: this.nextId,
      collected: this.collected,
    };
  }
  load(s) {
    this.items = (s?.items || [])
      .filter(
        (d) =>
          ITEMS[d.kind] &&
          [d.x, d.y, d.z, d.count, d.life].every(Number.isFinite),
      )
      .slice(0, 600);
    this.nextId = s?.nextId || 1;
    this.collected = s?.collected || 0;
  }
}
