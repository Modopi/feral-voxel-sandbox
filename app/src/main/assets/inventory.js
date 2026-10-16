import { GEAR } from "./equipment.js";
import { B, clamp } from "./world.js";
import { solidAt } from "./physics.js";
export const ITEMS = {
  arrow: { name: "화살", icon: "➶", color: 0xd5c59a },
  food: { frontier: true, name: "야전 식량", icon: "◒", color: 0xd9b76c },
  iron: { frontier: true, name: "합금", icon: "▰", color: 0xb8c4cf },
  knowledge: { frontier: true, name: "연구 기록", icon: "▱", color: 0x9bdad0 },
  relic: { frontier: true, name: "유적 핵", icon: "✦", color: 0xffce7a },
  medicine: { frontier: true, name: "회복약", icon: "+", color: 0xb7d78c },
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
    id: "arrows",
    name: "화살 × 12",
    description: "활·석궁 한 발당 1개 소비",
    cost: { stone: 2, wood: 2, fiber: 1 },
    give: { arrow: 12 },
  },
  ...Object.entries(GEAR)
    .filter(([, g]) => g.cost)
    .map(([id, g]) => ({
      id,
      name: g.name,
      description:
        g.slot === "weapon"
          ? `피해 ${g.damage} · 사거리 ${g.range}m · ${g.cooldown}초 · 내구 ${g.durability}${g.ammo ? " · 화살 필요" : ""}`
          : `${g.affinity === "rock" ? "돌·광석" : g.affinity === "wood" ? "나무" : "흙·모래"} 채굴 ${g.power}배 · 내구 ${g.durability}`,
      cost: g.cost,
      unlock: id,
      frontier: g.frontier,
    })),
  {
    id: "food",
    name: "야전 식량 × 3",
    description: "원정 중 허기를 회복",
    cost: { fiber: 2, seed: 1 },
    give: { food: 3 },
    frontier: true,
  },
  {
    id: "iron",
    name: "합금 × 3",
    description: "기계 조립과 무기 제작",
    cost: { stone: 4, crystal: 1 },
    give: { iron: 3 },
    frontier: true,
  },
  {
    id: "medicine",
    name: "회복약 × 2",
    description: "체력 45 회복",
    cost: { fiber: 3, bio: 2 },
    give: { medicine: 2 },
    frontier: true,
  },
  {
    id: "blade",
    name: "합금 무기",
    description: "펄스 공격력 12 → 24",
    cost: { iron: 4, plank: 2 },
    unlock: "blade",
    frontier: true,
  },
  {
    id: "armor",
    name: "개척 갑옷",
    description: "받는 피해 35% 감소",
    cost: { iron: 5, fiber: 6 },
    unlock: "armor",
    frontier: true,
  },
  {
    id: "engineering",
    name: "동력 연구",
    description: "기계와 회전익 제작 지식 · 보스 처치 불필요",
    cost: { knowledge: 6, crystal: 3 },
    unlock: "engineering",
    frontier: true,
  },
  {
    id: "rover",
    name: "기본 차량 설계",
    description: "차체·모터·바퀴 조립 차량 1대",
    cost: { iron: 8, plank: 6, resin: 2 },
    requires: "engineering",
    unlock: "rover",
    frontier: true,
  },
  {
    id: "ballistics",
    name: "투사체 연구",
    description: "기계 포탑과 원거리 펄스",
    cost: { knowledge: 8, iron: 4 },
    unlock: "ballistics",
    frontier: true,
  },
  {
    id: "aviation",
    name: "회전익 연구",
    description: "회전익 2개로 간이 비행 · 고정익은 후속",
    cost: { knowledge: 12, iron: 6, crystal: 4 },
    requires: "engineering",
    unlock: "aviation",
    frontier: true,
  },

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
    this.equipment = { weapon: "pulse", tool: "pick" };
    this.wear = {};
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
      (!recipe.requires || this.unlocks.has(recipe.requires)) &&
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
    if (GEAR[id]) {
      this.wear[id] = GEAR[id].durability;
      this.equipment[GEAR[id].slot] = id;
    }
    this.revision++;
    return true;
  }
  equip(id) {
    if (!GEAR[id] || !this.unlocks.has(id) || !(this.wear[id] > 0))
      return false;
    this.equipment[GEAR[id].slot] = id;
    this.revision++;
    return true;
  }
  repair(id) {
    const g = GEAR[id];
    if (
      !g?.durability ||
      !this.unlocks.has(id) ||
      this.wear[id] >= g.durability
    )
      return false;
    const cost = Object.fromEntries(
      Object.entries(g.cost).map(([k, n]) => [k, Math.ceil(n / 2)]),
    );
    if (!Object.entries(cost).every(([k, n]) => this.count(k) >= n))
      return false;
    for (const [k, n] of Object.entries(cost)) this.take(k, n);
    this.wear[id] = g.durability;
    this.revision++;
    return true;
  }
  save() {
    return {
      items: this.items,
      unlocks: [...this.unlocks],
      equipment: { ...this.equipment },
      wear: { ...this.wear },
    };
  }
  load(s) {
    this.items = {};
    for (const [k, n] of Object.entries(s?.items || {}))
      if (ITEMS[k] && Number.isFinite(n))
        this.items[k] = clamp(Math.floor(n), 0, 9999);
    this.unlocks = new Set(
      (s?.unlocks || []).filter((k) => RECIPES.some((r) => r.unlock === k)),
    );
    this.wear = {};
    this.equipment = { weapon: "pulse", tool: "pick" };
    for (const [id, g] of Object.entries(GEAR))
      if (g.durability && this.unlocks.has(id)) {
        this.wear[id] = Number.isFinite(s.wear?.[id])
          ? clamp(Math.floor(s.wear[id]), 0, g.durability)
          : g.durability;
        if (s.equipment?.[g.slot] === id && this.wear[id] > 0)
          this.equipment[g.slot] = id;
      }
    this.revision++;
  }
}
export class Pickups {
  constructor() {
    this.equipment = { weapon: "pulse", tool: "pick" };
    this.wear = {};
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
