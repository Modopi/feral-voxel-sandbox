import { B } from "./world.js";
// Distances in metres, cooldowns in simulation seconds. Tools are persistent gear.
export const GEAR = {
  relicpick: {
    name: "공명 곡괭이",
    slot: "tool",
    power: 6,
    affinity: "rock",
    durability: 520,
    cost: { relic: 1, iron: 8, crystal: 6 },
    frontier: true,
  },
  pulse: {
    name: "기본 펄스",
    slot: "weapon",
    damage: 12,
    range: 6.5,
    cooldown: 0.55,
    radius: 0.12,
  },
  pick: { name: "나무 곡괭이", slot: "tool", power: 1, affinity: "rock" },
  club: {
    name: "돌 곤봉",
    slot: "weapon",
    damage: 18,
    range: 2.8,
    cooldown: 0.7,
    radius: 0.19,
    durability: 90,
    cost: { stone: 6, wood: 4 },
  },
  spear: {
    name: "돌 창",
    slot: "weapon",
    damage: 16,
    range: 4.8,
    cooldown: 0.65,
    radius: 0.1,
    durability: 100,
    cost: { stone: 4, plank: 4, fiber: 2 },
  },
  sword: {
    name: "합금 검",
    slot: "weapon",
    damage: 28,
    range: 3.2,
    cooldown: 0.42,
    radius: 0.2,
    durability: 200,
    cost: { iron: 6, plank: 2 },
    frontier: true,
  },
  battleaxe: {
    name: "합금 전투 도끼",
    slot: "weapon",
    damage: 42,
    range: 3,
    cooldown: 0.95,
    radius: 0.3,
    durability: 160,
    cost: { iron: 9, plank: 4 },
    frontier: true,
  },
  bow: {
    name: "사냥 활",
    slot: "weapon",
    damage: 22,
    range: 20,
    cooldown: 0.9,
    radius: 0.08,
    durability: 140,
    ammo: "arrow",
    cost: { plank: 6, fiber: 8 },
  },
  crystalbow: {
    name: "결정 석궁",
    slot: "weapon",
    damage: 38,
    range: 26,
    cooldown: 1.3,
    radius: 0.14,
    durability: 220,
    ammo: "arrow",
    cost: { iron: 8, crystal: 6, fiber: 4 },
    frontier: true,
  },
  stonepick: {
    name: "돌 곡괭이",
    slot: "tool",
    power: 2,
    affinity: "rock",
    durability: 160,
    cost: { stone: 8, plank: 4 },
  },
  ironpick: {
    name: "합금 곡괭이",
    slot: "tool",
    power: 4,
    affinity: "rock",
    durability: 360,
    cost: { iron: 6, plank: 4 },
    frontier: true,
  },
  axe: {
    name: "벌목 도끼",
    slot: "tool",
    power: 3,
    affinity: "wood",
    durability: 180,
    cost: { stone: 6, plank: 4 },
  },
  shovel: {
    name: "삽",
    slot: "tool",
    power: 4,
    affinity: "soil",
    durability: 200,
    cost: { stone: 4, plank: 3 },
  },
};
export function activeGear(inv, slot) {
  const id = inv.equipment?.[slot];
  return GEAR[id]?.slot === slot &&
    inv.count(id) > 0 &&
    (!GEAR[id].durability || inv.wear[id] > 0)
    ? GEAR[id]
    : GEAR[slot === "weapon" ? "pulse" : "pick"];
}
export function gearId(inv, slot) {
  return Object.keys(GEAR).find((k) => GEAR[k] === activeGear(inv, slot));
}
export function spendGear(inv, slot) {
  const g = activeGear(inv, slot),
    id = gearId(inv, slot);
  if (g.ammo && !inv.take(g.ammo, 1)) return false;
  if (g.durability) {
    inv.wear[id] = Math.max(0, inv.wear[id] - 1);
    inv.revision++;
  }
  return true;
}
export function miningWork(block, size, gear) {
  const kind = [B.WOOD, B.PLANK].includes(block)
    ? "wood"
    : [B.STONE, B.ORE, B.BASALT].includes(block)
      ? "rock"
      : "soil";
  const hardness =
    kind === "rock"
      ? block === B.ORE
        ? 2.4
        : 1.6
      : kind === "wood"
        ? 1.2
        : 0.55;
  return (
    (hardness * Math.max(0.5, size ** 3)) /
    (gear.affinity === kind ? gear.power : 1)
  );
}
