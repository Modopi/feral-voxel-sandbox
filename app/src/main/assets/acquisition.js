import { B } from "./world.js";
import { ITEMS, RECIPES, resourceForBlock } from "./inventory.js";
import { GEAR } from "./equipment.js";
import { animalDrops, SPECIES } from "./entities.js";
import { GATHERABLES } from "./frontier/content.js";
const terrainNames = {
  [B.DIRT]: "흙",
  [B.GRASS]: "풀밭",
  [B.STONE]: "돌",
  [B.BASALT]: "현무암",
  [B.WOOD]: "나무",
  [B.LEAF]: "나뭇잎",
  [B.ORE]: "광석",
  [B.SAND]: "모래",
  [B.ASH]: "재",
  [B.PLANK]: "목재",
};
// These definitions read the same recipes, harvest mapping and drops used by play.
export function acquisitionRules(frontier = true) {
  const rules = [];
  for (const b of Object.values(B)) {
    const id = resourceForBlock(b);
    if (id)
      rules.push({
        id: `block:${b}`,
        name: `${terrainNames[b]} 채굴`,
        cost: {},
        give: { [id]: 1 },
        renewal: "다음 지역 탐사 또는 해당 재료 재활용",
      });
  }
  SPECIES.forEach((sp, type) =>
    rules.push({
      id: `animal:${type}`,
      name: `${sp.name} 사냥`,
      cost: {},
      give: animalDrops(type),
      renewal: "먹이 번식 · 비옥한 서식지의 이동 무리",
    }),
  );
  if (frontier)
    for (const [kind, def] of Object.entries(GATHERABLES))
      rules.push({
        id: `gather:${kind}`,
        name: `${def.name} 채집`,
        cost: {},
        give: def.reward,
        renewal: def.regrow
          ? `${def.regrow}초 후 재성장`
          : "다음 지역 탐사 · 재활용",
      });
  for (const r of RECIPES.filter((r) => frontier || !r.frontier))
    rules.push({
      id: `recipe:${r.id}`,
      name: r.name,
      cost: r.cost,
      give: { ...r.give, ...(GEAR[r.id]?.cost ? { [r.id]: 1 } : {}) },
      requires: r.requires,
      unlock: r.unlock,
      renewal: "재료를 모아 제작",
    });
  return rules;
}
export function sourceHints(id, frontier = true) {
  const rules = acquisitionRules(frontier).filter((r) => r.give[id]);
  return rules.map(
    (r) => `${r.name}${r.id.startsWith("gather:") ? " · " + r.renewal : ""}`,
  );
}
export function auditAcquisition(frontier = true) {
  const rules = acquisitionRules(frontier),
    items = new Map(),
    unlocks = new Set(),
    applied = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of rules) {
      if (
        applied.has(rule.id) ||
        (rule.requires && !unlocks.has(rule.requires)) ||
        Object.keys(rule.cost).some((id) => !items.has(id))
      )
        continue;
      applied.add(rule.id);
      changed = true;
      for (const id of Object.keys(rule.give))
        if (!items.has(id))
          items.set(id, {
            via: rule.name,
            inputs: Object.keys(rule.cost),
            renewal: rule.renewal,
          });
      if (rule.unlock) unlocks.add(rule.unlock);
    }
  }
  return {
    items: Object.fromEntries(items),
    unlocks: [...unlocks],
    unreachableItems: Object.keys(ITEMS).filter(
      (id) => (frontier || !ITEMS[id].frontier) && !items.has(id),
    ),
    unreachableRecipes: rules
      .filter((r) => r.id.startsWith("recipe:") && !applied.has(r.id))
      .map((r) => r.id),
  };
}
