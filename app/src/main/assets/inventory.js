import { TYPES } from "./machine/model.js";
import { GEAR } from "./equipment.js";
import { B, clamp } from "./world.js";
import { solidAt } from "./physics.js";
export const ITEMS = {
  meat: { name: "날고기", icon: "", color: 0xc27670 },
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
for (const [id, g] of Object.entries(GEAR))
  ITEMS[id] = {
    name: g.name,
    color: 0x9eb5b5,
    gear: true,
    frontier: g.frontier,
    icon: "",
    limit: 1,
  };
for (const [type, part] of Object.entries(TYPES))
  ITEMS[`${type}_part`] = {
    name: part.label + " 블록",
    color: part.color,
    machinePart: type,
    frontier: true,
  };
ITEMS.wrench = {
  name: "조립 렌치",
  color: 0xbfcad1,
  assemblyTool: true,
  limit: 1,
  frontier: true,
};
export const SLOT_COUNT = 36,
  STACK_LIMIT = 64;
export const stackLimit = (id) => ITEMS[id]?.limit || STACK_LIMIT;
export const RECIPES = [
  {
    id: "aircraft_parts",
    name: "경량 비행기 부품 묶음",
    description:
      "차체 6 · 모터 1 · 주날개 24 · 수평 꼬리 4 · 수직 꼬리 1 · 프로펠러 1 · 바퀴 3. 월드에서 직접 조립하세요.",
    cost: { iron: 89 },
    give: {
      hull_part: 6,
      motor_part: 1,
      wing_part: 24,
      elevator_part: 4,
      rudder_part: 1,
      propeller_part: 1,
      wheel_part: 3,
    },
    requires: "aviation",
    frontier: true,
  },
  {
    id: "wrench",
    name: "조립 렌치",
    description:
      "공격: 고정된 부품 회수 · 사용: 고정/해제 · 합금을 들고 사용하면 수리",
    cost: { iron: 2, wood: 1 },
    give: { wrench: 1 },
    frontier: true,
  },
  ...Object.entries(TYPES).map(([type, p]) => ({
    id: `${type}_part`,
    name: p.label + " 블록",
    description: p.hint || "0.5m 부품 · 월드에서 면에 직접 붙이기",
    cost: { iron: p.cost },
    give: { [`${type}_part`]: 1 },
    requires:
      type === "rotor" || p.aviation
        ? "aviation"
        : type === "cannon"
          ? "ballistics"
          : "engineering",
    frontier: true,
  })),
  {
    id: "cooked_meat",
    name: "구운 고기 × 2",
    description: "사냥한 고기와 땔감으로 식량 마련",
    cost: { meat: 1, wood: 1 },
    give: { food: 2 },
    frontier: true,
  },
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
    name: "항공 연구",
    description: "주날개·조종면·프로펠러와 회전익 제작",
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
    this.slots = Array(SLOT_COUNT).fill(null);
    this.overflow = [];
    this.selectedSlot = 0;
    this.equipment = { weapon: "pulse", tool: "pick" };
    this.wear = {};
    this.unlocks = new Set();
    this.revision = 0;
    if (starter)
      for (const [id, n] of Object.entries({
        pick: 1,
        pulse: 1,
        dirt: 16,
        wood: 4,
        stone: 4,
        seed: 4,
      }))
        this.add(id, n);
  }
  get items() {
    const items = {};
    for (const s of this.slots)
      if (s) items[s.id] = (items[s.id] || 0) + s.count;
    return items;
  }
  count(id) {
    return this.slots.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0);
  }
  add(id, n) {
    if (!ITEMS[id] || !Number.isFinite(n) || n < 1) return 0;
    n = Math.floor(n);
    const total = n,
      limit = stackLimit(id);
    for (const s of this.slots)
      if (s?.id === id && s.count < limit) {
        const v = Math.min(n, limit - s.count);
        s.count += v;
        n -= v;
      }
    for (let i = 0; i < SLOT_COUNT && n > 0; i++)
      if (!this.slots[i]) {
        const v = Math.min(n, limit);
        this.slots[i] = { id, count: v };
        n -= v;
      }
    if (total !== n) this.revision++;
    return total - n;
  }
  // Earned rewards and legacy excess stay recoverable if all 36 slots are occupied.
  grant(id, n) {
    const remaining = n - this.add(id, n);
    if (remaining > 0) {
      const old = this.overflow.find((s) => s.id === id);
      if (old) old.count += remaining;
      else this.overflow.push({ id, count: remaining });
      this.revision++;
    }
  }
  reclaim() {
    for (const s of this.overflow) s.count -= this.add(s.id, s.count);
    this.overflow = this.overflow.filter((s) => s.count > 0);
    this.revision++;
  }
  take(id, n) {
    if (!Number.isInteger(n) || n < 0 || this.count(id) < n) return false;
    // Consume the selected stack first so the number under the held item is truthful.
    const order = [
      this.selectedSlot,
      ...Array.from({ length: SLOT_COUNT }, (_, i) => i).filter(
        (i) => i !== this.selectedSlot,
      ),
    ];
    for (const i of order) {
      const s = this.slots[i];
      if (s?.id !== id) continue;
      const v = Math.min(s.count, n);
      s.count -= v;
      n -= v;
      if (!s.count) this.slots[i] = null;
      if (!n) break;
    }
    this.revision++;
    return true;
  }
  move(from, to, split = false) {
    if (
      ![from, to].every(
        (i) => Number.isInteger(i) && i >= 0 && i < SLOT_COUNT,
      ) ||
      from === to ||
      !this.slots[from]
    )
      return false;
    const a = this.slots[from],
      b = this.slots[to],
      n = split ? Math.ceil(a.count / 2) : a.count;
    if (b && b.id !== a.id) {
      if (split) return false;
      [this.slots[from], this.slots[to]] = [b, a];
    } else {
      const moved = Math.min(n, stackLimit(a.id) - (b?.count || 0));
      if (!moved) return false;
      this.slots[to] = { id: a.id, count: (b?.count || 0) + moved };
      a.count -= moved;
      if (!a.count) this.slots[from] = null;
    }
    this.revision++;
    return true;
  }
  select(index) {
    if (!Number.isInteger(index) || index < 0 || index > 8) return false;
    this.selectedSlot = index;
    const id = this.slots[index]?.id;
    if (GEAR[id]) this.equipment[GEAR[id].slot] = id;
    this.revision++;
    return true;
  }
  transaction(cost, reward, commit = false) {
    if (!Object.entries(cost).every(([id, n]) => this.count(id) >= n))
      return false;
    const copy = new Inventory(false);
    copy.slots = this.slots.map((s) => (s ? { ...s } : null));
    copy.selectedSlot = this.selectedSlot;
    for (const [id, n] of Object.entries(cost))
      if (!copy.take(id, n)) return false;
    for (const [id, n] of Object.entries(reward))
      if (copy.add(id, n) !== n) return false;
    if (commit) {
      this.slots = copy.slots;
      this.revision++;
    }
    return true;
  }
  canCraft(r) {
    return (
      (!r.requires || this.unlocks.has(r.requires)) &&
      !(
        r.unlock &&
        (GEAR[r.id]?.cost ? this.count(r.id) > 0 : this.unlocks.has(r.unlock))
      ) &&
      this.transaction(r.cost, {
        ...(r.give || {}),
        ...(GEAR[r.id]?.cost ? { [r.id]: 1 } : {}),
      })
    );
  }
  craft(id) {
    const r = RECIPES.find((r) => r.id === id);
    if (!r || !this.canCraft(r)) return false;
    this.transaction(
      r.cost,
      { ...(r.give || {}), ...(GEAR[id]?.cost ? { [id]: 1 } : {}) },
      true,
    );
    if (r.unlock) this.unlocks.add(r.unlock);
    if (GEAR[id]?.cost) this.wear[id] = GEAR[id].durability;
    this.revision++;
    return true;
  }
  equip(id) {
    const index = this.slots.findIndex((s) => s?.id === id);
    if (!GEAR[id] || index < 0 || (GEAR[id].durability && !this.wear[id]))
      return false;
    if (index >= 9) this.move(index, this.selectedSlot);
    this.select(index < 9 ? index : this.selectedSlot);
    return true;
  }
  repair(id) {
    const g = GEAR[id];
    if (!g?.durability || !this.count(id) || this.wear[id] >= g.durability)
      return false;
    const cost = Object.fromEntries(
      Object.entries(g.cost).map(([k, n]) => [k, Math.ceil(n / 2)]),
    );
    if (!this.transaction(cost, {}, true)) return false;
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
      slots: this.slots.map((s) => (s ? { ...s } : null)),
      selectedSlot: this.selectedSlot,
      overflow: this.overflow.map((s) => ({ ...s })),
    };
  }
  load(s) {
    this.slots = Array(SLOT_COUNT).fill(null);
    this.overflow = [];
    this.selectedSlot = Number.isInteger(s?.selectedSlot)
      ? clamp(s.selectedSlot, 0, 8)
      : 0;
    this.unlocks = new Set(
      (s?.unlocks || []).filter((k) => RECIPES.some((r) => r.unlock === k)),
    );
    this.wear = {};
    this.equipment = { weapon: "pulse", tool: "pick" };
    if (Array.isArray(s?.slots)) {
      s.slots.slice(0, SLOT_COUNT).forEach((v, i) => {
        if (ITEMS[v?.id] && Number.isInteger(v.count) && v.count > 0) {
          this.slots[i] = {
            id: v.id,
            count: Math.min(stackLimit(v.id), v.count),
          };
          if (v.count > stackLimit(v.id))
            this.overflow.push({ id: v.id, count: v.count - stackLimit(v.id) });
        }
      });
    } else {
      this.add("pick", 1);
      this.add("pulse", 1);
      for (const [k, n] of Object.entries(s?.items || {}))
        if (ITEMS[k] && Number.isFinite(n) && n > 0)
          this.grant(k, clamp(Math.floor(n), 0, 9999));
      for (const id of this.unlocks) if (GEAR[id]?.cost) this.grant(id, 1);
    }
    for (const v of s?.overflow || [])
      if (ITEMS[v?.id] && Number.isInteger(v.count) && v.count > 0)
        this.overflow.push({ id: v.id, count: Math.min(v.count, 9999) });
    for (const [id, g] of Object.entries(GEAR))
      if (
        g.durability &&
        (this.count(id) || this.overflow.some((s) => s.id === id))
      ) {
        this.unlocks.add(id);
        this.wear[id] = Number.isFinite(s?.wear?.[id])
          ? clamp(Math.floor(s.wear[id]), 0, g.durability)
          : g.durability;
        if (s?.equipment?.[g.slot] === id) this.equipment[g.slot] = id;
      }
    this.select(this.selectedSlot);
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
