// Deterministic encounter definitions; persistent state lives in the region save.
export const GATHERABLES = {
  wood: {
    name: "맹아 나무",
    color: 0x70974f,
    reward: { wood: 4, fiber: 2, seed: 1 },
    regrow: 300,
  },
  berry: {
    name: "들열매 덤불",
    color: 0xb45765,
    reward: { berry: 3, seed: 1 },
    regrow: 180,
  },
  herb: {
    name: "은잎 약초",
    color: 0xa5c9ab,
    reward: { herb: 2, fiber: 1 },
    regrow: 240,
  },
  scrap: {
    name: "옛 기계 잔해",
    color: 0x9f8e76,
    reward: { scrap: 3 },
    regrow: 0,
  },
  crystal: {
    name: "공명 결정 군집",
    color: 0x70d6ce,
    reward: { crystal: 3 },
    regrow: 0,
  },
};
export const CONTRACTS = [
  {
    id: "forage",
    name: "공동 식탁",
    cost: { berry: 6 },
    reward: { food: 4, knowledge: 2 },
    text: "들열매를 모아 주민의 식탁을 채우세요.",
  },
  {
    id: "healer",
    name: "야전 치료소",
    cost: { herb: 4, bio: 2 },
    reward: { medicine: 3, knowledge: 3 },
    text: "약초와 생체 재료로 치료 물자를 마련하세요.",
  },
  {
    id: "salvage",
    name: "정착지 수리",
    cost: { scrap: 6 },
    reward: { iron: 5, crystal: 2 },
    text: "옛 기계 잔해를 회수해 정착지를 수리하세요.",
  },
];
export const RUINS = [
  {
    name: "씨앗 보관소",
    lore: "기록: 이끼 연맹은 마지막 숲의 씨앗을 이곳에 남겼다.",
    bonus: { resin: 3, seed: 6 },
  },
  {
    name: "바람 관측소",
    lore: "기록: 옛 비행사들은 바람과 날개를 연결해 산맥을 넘었다.",
    bonus: { scrap: 4, crystal: 2 },
  },
  {
    name: "동력 중계소",
    lore: "기록: 세 공동체는 한때 이 동력망을 함께 유지했다.",
    bonus: { iron: 3, scrap: 2 },
  },
];
export function ruinDefinition(info) {
  return RUINS[info.seed % RUINS.length];
}
export function relaySites(info) {
  const d = info.dungeon;
  return [
    [-3, 0],
    [3, 0],
    [0, 3],
  ].map(([x, z], index) => ({
    id: `relay:${index}`,
    index,
    x: d.x + x,
    z: d.z + z,
    name: ["북극성 중계기", "바람 중계기", "뿌리 중계기"][index],
  }));
}
export function resourceSites(info) {
  const hubs = [{ x: 77, z: 84 }, ...info.villages];
  const sites = hubs.flatMap((p, i) => [
    { id: `wood:${i}`, kind: "wood", x: p.x - 4, z: p.z },
    { id: `berry:${i}`, kind: "berry", x: p.x - 3, z: p.z + 3 },
    { id: `herb:${i}`, kind: "herb", x: p.x + 3, z: p.z + 3 },
    { id: `scrap:${i}`, kind: "scrap", x: p.x + 4, z: p.z },
  ]);
  for (const side of [-1, 1])
    sites.push({
      id: `crystal:${side}`,
      kind: "crystal",
      x: info.dungeon.x + side * 3,
      z: info.dungeon.z - 3,
    });
  return sites;
}
export function ensureContent(region) {
  region.resources ||= {};
  region.contracts ||= [];
  region.studies ||= [];
  region.relays ||= [0, 1, 2].filter((i) => i < Math.floor(region.dungeon));
}
