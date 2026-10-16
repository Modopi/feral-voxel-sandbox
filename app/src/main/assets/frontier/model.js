import { activeGear, spendGear } from "../equipment.js";
// Frontier rules. No DOM, renderer or storage access: every action is explicit.
import { hash, clamp } from "../world.js";
import {
  createLab,
  preset,
  evaluate,
  edit,
  damage,
  restore,
  serialize,
} from "../machine/model.js";
export const FACTIONS = ["이끼 연맹", "구리 조합", "현무암 부족"];
export const regionKey = (x, z) => `${x},${z}`;
export function regionInfo(seed, x, z) {
  const roll = (n) => hash(x + n * 19, z - n * 7, seed);
  const tier = Math.min(3, 1 + Math.floor((Math.abs(x) + Math.abs(z)) / 2));
  return {
    key: regionKey(x, z),
    x,
    z,
    seed: Math.floor(roll(1) * 2147483647),
    tier,
    name:
      ["이끼 숲", "붉은 구릉", "유리 해안", "잿빛 고원"][
        Math.floor(roll(2) * 4)
      ] + ` [${x}, ${z}]`,
    villages: [0, 1].map((i) => ({
      id: `${x},${z}:${i}`,
      name: ["강변 야영지", "고원 정착지"][i],
      x: (i ? 130 : 65) + Math.floor(roll(3 + i) * 6),
      z: i ? 114 : 68,
      faction: (Math.floor(roll(7) * 3) + i) % 3,
    })),
    boss: { x: 44 + Math.floor(roll(5) * 9), z: 126 },
    dungeon: { x: 133, z: 45 + Math.floor(roll(6) * 7) },
  };
}
const clone = (v) => JSON.parse(JSON.stringify(v));
export class Frontier {
  constructor(seed = 63026) {
    this.schema = 1;
    this.seed = seed;
    this.x = 0;
    this.z = 0;
    this.time = 0;
    this.socialClock = 0;
    this.hp = 100;
    this.hunger = 100;
    this.xp = 0;
    this.deaths = 0;
    this.reputation = [0, 0, 0];
    this.diplomacy = [0, 0, 0];
    this.allies = [];
    this.regions = {};
    this.log = ["원정 시작 · 강변 야영지에서 교역하고 유적을 탐사하세요."];
    this.machine = null;
    this.riding = false;
    this.airborne = false;
    this.attackClock = 0;
    this.hurtClock = 0;
    this.supportClock = 0;
    this.ensureRegion();
  }
  get key() {
    return regionKey(this.x, this.z);
  }
  get info() {
    return regionInfo(this.seed, this.x, this.z);
  }
  get region() {
    return this.regions[this.key];
  }
  get level() {
    return 1 + Math.floor(this.xp / 80);
  }
  get maxHP() {
    return 100 + Math.min(10, this.level - 1) * 10;
  }
  note(text) {
    this.log.unshift(text);
    this.log.length = Math.min(12, this.log.length);
  }
  ensureRegion() {
    const i = this.info;
    if (!this.regions[i.key])
      this.regions[i.key] = {
        visited: true,
        discovered: [],
        dungeon: 0,
        cacheClaimed: false,
        boss: {
          hp: 100 * i.tier,
          maxHP: 100 * i.tier,
          defeated: false,
          phase: 0,
          warning: 0,
          cooldown: 2,
          x: i.boss.x,
          z: i.boss.z,
          aimX: 0,
          aimZ: 0,
        },
        villages: i.villages.map((v) => ({
          ...v,
          food: 24,
          wood: 18,
          stone: 24,
          crystal: 10,
          tech: 0,
          population: 6,
          aid: 0,
          raidAt: -999,
        })),
      };
    return this.region;
  }
  canPay(inv, cost, reward = {}) {
    return inv.transaction(cost, reward);
  }
  exchange(inv, cost, reward = {}) {
    return inv.transaction(cost, reward, true);
  }
  discover(player, inv) {
    const r = this.region;
    for (const [id, p, name] of [
      ...r.villages.map((v) => [v.id, v, v.name]),
      ["ruin", this.info.dungeon, "옛 동력 유적"],
      ["boss", this.info.boss, "수호자 둥지"],
    ]) {
      if (
        Math.hypot(player.x - p.x, player.z - p.z) < 15 &&
        !r.discovered.includes(id)
      ) {
        r.discovered.push(id);
        this.xp += 8;
        inv.grant("knowledge", 2);
        this.note(`${name} 발견 · 연구 기록 +2`);
      }
    }
  }
  socialStep() {
    // All visited communities advance with one coarse 30-second tick, including distant ones.
    for (const region of Object.values(this.regions)) {
      for (const v of region.villages) {
        v.food = clamp(
          v.food + 3 + v.tech - Math.ceil(v.population / 3),
          0,
          80,
        );
        v.wood = Math.min(80, v.wood + 1 + v.tech);
        v.stone = Math.min(80, v.stone + 2);
        v.crystal = Math.min(40, v.crystal + (v.tech >= 1 ? 1 : 0));
        if (!v.food) v.population = Math.max(3, v.population - 1);
        else if (v.food > 40) v.population = Math.min(10, v.population + 1);
        // Slow local technical growth; player aid accelerates it, never runaway industrialisation.
        if (v.tech < 1 && v.wood >= 50 && v.stone >= 50) {
          v.wood -= 25;
          v.stone -= 25;
          v.tech = 1;
        }
      }
      const [a, b] = region.villages;
      const pair = [
        [0, 1],
        [1, 2],
        [0, 2],
      ].findIndex(
        (pair) => pair.includes(a.faction) && pair.includes(b.faction),
      );
      if (this.diplomacy[pair] <= -20) {
        a.food = Math.max(0, a.food - 3);
        b.wood = Math.max(0, b.wood - 3);
      } else if (a.food > b.food + 8) {
        a.food -= 2;
        b.food += 2;
      }
    }
    if (Math.floor(this.time / 30) % 4 === 0) {
      const pair = Math.floor(
        hash(Math.floor(this.time / 120), 0, this.seed) * 3,
      );
      this.diplomacy[pair] = clamp(
        this.diplomacy[pair] +
          (hash(pair, Math.floor(this.time), this.seed) > 0.5 ? 4 : -4),
        -40,
        40,
      );
    }
  }
  actVillage(id, action, inv, player) {
    const v = this.region.villages.find((v) => v.id === id);
    if (!v || Math.hypot(v.x - player.x, v.z - player.z) > 12)
      return "마을 12m 이내로 접근하세요.";
    const f = v.faction,
      hostile = this.reputation[f] <= -20;
    if (action === "peace") {
      if (!this.exchange(inv, { food: 6, iron: 2 }))
        return "화해에는 식량 6 · 합금 2가 필요합니다.";
      this.reputation[f] = Math.max(0, this.reputation[f]);
      this.note(`${FACTIONS[f]}과 화해했습니다.`);
      return "화해 완료";
    }
    if (hostile && action !== "raid")
      return "적대 중입니다. 보급품으로 화해를 제안하세요.";
    if (action === "trade") {
      if (v.crystal < 2 || v.food < 2)
        return "마을 재고가 부족합니다. 생산을 기다리세요.";
      if (!this.exchange(inv, { wood: 4 }, { crystal: 2, food: 2 }))
        return "원목 4개 또는 가방 여유가 필요합니다.";
      v.wood = Math.min(80, v.wood + 4);
      v.crystal -= 2;
      v.food -= 2;
      this.reputation[f] = Math.min(100, this.reputation[f] + 2);
      return "원목 4 → 결정 2 · 식량 2";
    }
    if (action === "aid") {
      if (!this.exchange(inv, { food: 3, plank: 4 }, { knowledge: 2 }))
        return "식량 3 · 목재 4 또는 가방 여유가 필요합니다.";
      v.food = Math.min(80, v.food + 3);
      v.aid++;
      v.tech = Math.min(2, Math.floor(v.aid / 2) + 1);
      this.reputation[f] = Math.min(100, this.reputation[f] + 12);
      this.xp += 6;
      this.note(`${v.name} 지원 · 기술 ${v.tech} · 평판 +12`);
      return "지원 완료 · 연구 기록 +2";
    }
    if (action === "ally") {
      if (this.allies.includes(f)) return "이미 동맹입니다.";
      if (this.reputation[f] < 24)
        return "평판 24 이상이면 동맹을 맺을 수 있습니다.";
      this.allies.push(f);
      this.note(`${FACTIONS[f]} 동맹 · 근처 보스 전투 지원`);
      return "동맹 체결 · 보스 전투에 지원 사격이 도착합니다.";
    }
    if (action === "mediate") {
      if (!this.exchange(inv, { knowledge: 2 }))
        return "연구 기록 2개가 필요합니다.";
      this.diplomacy = this.diplomacy.map((n) => Math.min(40, n + 12));
      this.xp += 5;
      return "집단 간 중재 · 모든 관계 +12";
    }
    if (action === "raid") {
      if (this.time - v.raidAt < 120)
        return "마을이 경계 중입니다. 120초 뒤 다시 시도하세요.";
      if (
        !this.exchange(
          inv,
          {},
          { food: Math.min(4, v.food), crystal: Math.min(3, v.crystal) },
        )
      )
        return "가방이 가득 찼습니다.";
      v.food = Math.max(0, v.food - 4);
      v.crystal = Math.max(0, v.crystal - 3);
      v.raidAt = this.time;
      this.reputation[f] = Math.max(-100, this.reputation[f] - 35);
      this.allies = this.allies.filter((n) => n !== f);
      this.hp = Math.max(1, this.hp - 25);
      this.diplomacy = this.diplomacy.map((n) => Math.max(-40, n - 8));
      this.note(`${v.name} 약탈 · 적대와 교역 중단`);
      return "약탈품 확보 · 체력 -25 · 평판 -35";
    }
    return "알 수 없는 행동";
  }
  consume(id, inv) {
    if (id === "food" && this.hunger >= 100) return "아직 배가 부릅니다.";
    if (id === "medicine" && this.hp >= this.maxHP)
      return "체력이 가득 찼습니다.";
    if (!["food", "medicine"].includes(id) || !inv.take(id, 1))
      return "가방에 해당 물품이 없습니다.";
    if (id === "food") this.hunger = Math.min(100, this.hunger + 35);
    else this.hp = Math.min(this.maxHP, this.hp + 45);
    return id === "food" ? "식량 -1 · 허기 회복" : "회복약 -1 · 체력 +45";
  }
  camp(player, inv) {
    if (Math.hypot(player.x - 77.5, player.z - 84.5) > 12)
      return "출발 야영지 12m 안에서 휴식하세요.";
    if (this.hp >= this.maxHP) return "이미 충분히 쉬었습니다.";
    if (!inv.take("food", 1)) return "휴식에는 식량 1개가 필요합니다.";
    this.hp = this.maxHP;
    this.hunger = Math.min(100, this.hunger + 20);
    return "야영지에서 회복했습니다.";
  }
  damagePlayer(amount, inv) {
    this.hp = Math.max(
      0,
      this.hp - amount * (inv.unlocks.has("armor") ? 0.65 : 1),
    );
    this.hurtClock = 0.4;
    if (this.riding && this.machine) {
      const p =
        this.machine.blueprint.find(
          (p) => this.machine.hp[p.id] > 0 && p.type !== "hull",
        ) || this.machine.blueprint[0];
      if (p) damage(this.machine, p.id, amount);
    }
  }
  tick(dt, player, inv) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.25);
    this.time += dt;
    this.socialClock += dt;
    this.attackClock = Math.max(0, this.attackClock - dt);
    this.hurtClock = Math.max(0, this.hurtClock - dt);
    this.hunger = Math.max(0, this.hunger - dt * 0.055);
    if (!this.hunger) this.hp = Math.max(0, this.hp - dt * 0.5);
    else if (this.hunger > 65 && this.hp < this.maxHP)
      this.hp = Math.min(this.maxHP, this.hp + dt * 0.12);
    while (this.socialClock >= 30) {
      this.socialClock -= 30;
      this.socialStep();
    }
    this.discover(player, inv);
    this.hostileClock = (this.hostileClock || 0) + dt;
    if (this.hostileClock >= 2) {
      this.hostileClock = 0;
      if (
        this.region.villages.some(
          (v) =>
            this.reputation[v.faction] <= -20 &&
            Math.hypot(player.x - v.x, player.z - v.z) < 10,
        )
      )
        this.damagePlayer(8, inv);
    }
    const b = this.region.boss,
      d = Math.hypot(player.x - b.x, player.z - b.z);
    if (!b.defeated && d < 26 && !player.flying) {
      if (b.warning > 0) {
        b.warning -= dt;
        if (b.warning <= 0) {
          if (Math.hypot(player.x - b.aimX, player.z - b.aimZ) < 4)
            this.damagePlayer(16 + this.info.tier * 5, inv);
          b.cooldown = 1.8;
          b.phase++;
        }
      } else if ((b.cooldown -= dt) <= 0) {
        b.warning = 1.15;
        b.aimX = player.x;
        b.aimZ = player.z;
      } else if (d > 4) {
        b.x += ((player.x - b.x) / d) * dt * 1.2;
        b.z += ((player.z - b.z) / d) * dt * 1.2;
      }
      this.supportClock += dt;
      if (this.allies.length && this.supportClock > 3) {
        this.supportClock = 0;
        this.hitBoss(4 * this.allies.length, inv);
      }
    } else b.warning = 0;
    const ruin = this.info.dungeon;
    if (
      !this.region.cacheClaimed &&
      Math.hypot(player.x - ruin.x, player.z - ruin.z) < 5 &&
      this.region.dungeon < 3
    ) {
      this.region.dungeon = Math.min(3, this.region.dungeon + dt / 6);
      this.hp = Math.max(
        0,
        this.hp - dt * (inv.unlocks.has("armor") ? 0.6 : 1.2),
      );
    }
    if (this.riding && this.machine) {
      const f = evaluate(this.machine);
      if (!f.power || (!f.grip && f.lift < 1.5)) {
        this.riding = false;
        this.airborne = false;
      }
      if (f.lift < 1.5) this.airborne = false;
    }
    if (this.hp <= 0) {
      this.deaths++;
      this.hunger = Math.max(40, this.hunger);
      this.xp = Math.max(0, this.xp - 15);
      this.hp = this.maxHP;
      this.riding = this.airborne = false;
      b.warning = 0;
      b.cooldown = 3;
      this.note("쓰러졌습니다 · 야영지로 복귀 · 경험 -15");
      return "respawn";
    }
    return null;
  }
  hitBoss(amount, inv) {
    const b = this.region.boss;
    if (b.defeated) return false;
    b.hp = Math.max(0, b.hp - amount);
    if (!b.hp) {
      b.defeated = true;
      b.warning = 0;
      this.xp += 60 * this.info.tier;
      this.hp = Math.min(this.maxHP, this.hp + 30);
      // A defeated boss is marked first. Rewards cannot be farmed by reopening its menu.
      inv.grant("relic", this.info.tier);
      inv.grant("knowledge", 6 * this.info.tier);
      inv.grant("iron", 5 * this.info.tier);
      this.note(`수호자 격파 · 유적 핵 +${this.info.tier} · 연구와 합금 획득`);
    }
    return true;
  }
  attack(inv) {
    if (this.attackClock > 0) return false;
    this.attackClock = this.riding ? 0.8 : activeGear(inv, "weapon").cooldown;
    const f = this.machine && evaluate(this.machine);
    if (this.riding && f.weapons > 0) {
      if (!inv.take("stone", 1)) return false;
      return this.hitBoss(30 * f.weapons, inv);
    }
    const gear = activeGear(inv, "weapon");
    if (!spendGear(inv, "weapon")) return false;
    return this.hitBoss(
      (gear.name === "기본 펄스" && inv.unlocks.has("blade")
        ? 24
        : gear.damage) +
        Math.min(10, this.level - 1) * 2,
      inv,
    );
  }
  claimRuin(player, inv) {
    const p = this.info.dungeon,
      r = this.region;
    if (Math.hypot(player.x - p.x, player.z - p.z) > 6)
      return "유적 중심 6m 이내로 접근하세요.";
    if (r.cacheClaimed) return "이미 회수한 유적입니다.";
    if (r.dungeon < 3)
      return `유적 방어장 해제 중 ${Math.floor((r.dungeon / 3) * 100)}% · 중심에서 버티세요.`;
    if (!this.exchange(inv, {}, { knowledge: 6, crystal: 4, iron: 3 }))
      return "가방 여유가 필요합니다.";
    r.cacheClaimed = true;
    this.xp += 30;
    this.note("옛 동력 유적 회수 · 연구 기록 +6");
    return "유적 회수 · 연구 6 · 결정 4 · 합금 3";
  }
  provisionMachine(inv) {
    if (inv.unlocks.has("rover") && !this.machine) {
      this.machine = createLab();
      preset(this.machine);
      this.machine.stock = 0;
      this.note(
        "기본 차량 조립 완료 · 원정 장부의 기계 탭에서 개조할 수 있습니다.",
      );
    }
  }
  editMachine(inv, kind, x, y, z, type) {
    this.provisionMachine(inv);
    if (!this.machine || this.riding) return "내린 뒤 차량 설계를 준비하세요.";
    if (kind === "add" && type === "cannon" && !inv.unlocks.has("ballistics"))
      return "투사체 연구가 필요합니다.";
    if (kind === "add" && type === "rotor" && !inv.unlocks.has("aviation"))
      return "회전익 연구가 필요합니다.";
    const s = this.machine;
    s.stock = inv.count("iron");
    const before = s.stock;
    if (!edit(s, kind, x, y, z, type)) {
      s.stock = 0;
      return "재료·위치·부품 상태를 확인하세요.";
    }
    const delta = s.stock - before;
    if (delta > 0) inv.grant("iron", delta);
    else inv.take("iron", -delta);
    s.stock = 0;
    return "설계 변경 완료 · 합금 " + (delta >= 0 ? "+" : "") + delta;
  }
  toggleRide(inv) {
    this.provisionMachine(inv);
    if (this.riding) {
      this.riding = this.airborne = false;
      return "차량에서 내렸습니다.";
    }
    if (!this.machine)
      return "가방에서 동력 연구와 기본 차량 설계를 제작하세요.";
    const f = evaluate(this.machine);
    if (!f.power || (!f.grip && f.lift < 1.5))
      return "연결된 모터와 바퀴 또는 회전익이 필요합니다.";
    this.riding = true;
    return "탑승 · 이동 조작으로 주행 · 기계 버튼으로 하차";
  }
  move(dx, dz, inv, player) {
    if (
      !Number.isInteger(dx) ||
      !Number.isInteger(dz) ||
      Math.abs(dx) + Math.abs(dz) !== 1
    )
      return "인접한 지역만 이동할 수 있습니다.";
    if (Math.abs(this.x + dx) > 10000 || Math.abs(this.z + dz) > 10000)
      return "프로토타입 탐험 범위 끝입니다.";
    if (
      Math.hypot(player.x - 77.5, player.z - 84.5) > 12 &&
      player.x > 8 &&
      player.z > 8 &&
      player.x < 152 &&
      player.z < 152
    )
      return "야영지 또는 지역 가장자리에서 이동하세요.";
    if (!inv.take("food", 1)) return "지역 이동에 식량 1개가 필요합니다.";
    this.x += dx;
    this.z += dz;
    this.ensureRegion();
    this.riding = this.airborne = false;
    this.note(`${this.info.name} 도착`);
    return null;
  }
  save() {
    return clone({
      schema: 1,
      seed: this.seed,
      x: this.x,
      z: this.z,
      time: this.time,
      socialClock: this.socialClock,
      hp: this.hp,
      hunger: this.hunger,
      xp: this.xp,
      deaths: this.deaths,
      reputation: this.reputation,
      diplomacy: this.diplomacy,
      allies: this.allies,
      regions: this.regions,
      log: this.log,
      machine: this.machine
        ? { ...this.machine, events: [], revision: 0 }
        : null,
    });
  }
  static load(data) {
    if (
      !data ||
      data.schema !== 1 ||
      !Number.isSafeInteger(data.seed) ||
      !Number.isInteger(data.x) ||
      !Number.isInteger(data.z) ||
      Math.abs(data.x) > 10000 ||
      Math.abs(data.z) > 10000
    )
      throw Error("개척 저장 형식을 읽을 수 없습니다.");
    const s = new Frontier(data.seed);
    for (const name of ["time", "socialClock", "hp", "hunger", "xp", "deaths"])
      if (!Number.isFinite(data[name]) || data[name] < 0)
        throw Error("개척 상태가 손상되었습니다.");
    for (const name of ["reputation", "diplomacy"])
      if (
        !Array.isArray(data[name]) ||
        data[name].length !== 3 ||
        data[name].some((n) => !Number.isFinite(n) || Math.abs(n) > 100)
      )
        throw Error("공동체 관계가 손상되었습니다.");
    if (!data.regions || !data.regions[regionKey(data.x, data.z)])
      throw Error("지역 저장이 없습니다.");
    for (const [key, r] of Object.entries(data.regions)) {
      if (
        !/^-?\d+,-?\d+$/.test(key) ||
        !r ||
        !Array.isArray(r.villages) ||
        r.villages.length !== 2 ||
        !Array.isArray(r.discovered) ||
        r.discovered.some((n) => typeof n !== "string")
      )
        throw Error("지역 기록이 손상되었습니다.");
      if (
        !r.boss ||
        !Number.isFinite(r.boss.hp) ||
        r.boss.hp < 0 ||
        r.boss.hp > r.boss.maxHP ||
        ![
          "x",
          "z",
          "aimX",
          "aimZ",
          "cooldown",
          "warning",
          "maxHP",
          "phase",
        ].every((n) => Number.isFinite(r.boss[n])) ||
        !Number.isFinite(r.dungeon) ||
        r.dungeon < 0 ||
        r.dungeon > 3
      )
        throw Error("수호자 기록이 손상되었습니다.");
      for (const v of r.villages)
        if (
          ![
            "x",
            "z",
            "food",
            "wood",
            "stone",
            "crystal",
            "tech",
            "population",
            "aid",
            "raidAt",
          ].every((n) => Number.isFinite(v[n])) ||
          ![0, 1, 2].includes(v.faction) ||
          ["food", "wood", "stone", "crystal"].some(
            (n) => v[n] < 0 || v[n] > 80,
          )
        )
          throw Error("마을 상태가 손상되었습니다.");
    }
    if (
      !Array.isArray(data.allies) ||
      data.allies.some((n) => ![0, 1, 2].includes(n)) ||
      !Array.isArray(data.log) ||
      data.log.some((n) => typeof n !== "string")
    )
      throw Error("원정 기록이 손상되었습니다.");
    const clean = clone(data);
    for (const key of Object.keys(s.save())) s[key] = clean[key];
    s.hp = Math.min(s.maxHP, s.hp);
    s.hunger = Math.min(100, s.hunger);
    if (data.machine) s.machine = restore(serialize(data.machine));
    s.riding = s.airborne = false;
    return s;
  }
}
