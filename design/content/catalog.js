// Next-world contracts. These IDs deliberately do not rename legacy inventory IDs.
// Research effort/prerequisites and material traits are tunable design proposals.
// This catalog describes knowledge unlocks, not implemented world acquisition.
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const index = (entries) => Object.fromEntries(entries.map((entry) => [entry.id, entry]));

export const FIELDS = freeze(index([
  { id: "arcane_engineering", name: "마도공학자" },
  { id: "arcane_studies", name: "마도학자" },
  { id: "sanctity", name: "성자" },
  { id: "physics", name: "물리학자" },
]));

export const ENTITY_TYPES = freeze(index([
  { id: "object", name: "사물", origin: "detached_world", calories: false, naturalRecovery: false, civilizationEligible: false },
  { id: "machine", name: "기계", origin: "player_assembly", calories: false, naturalRecovery: false, civilizationEligible: false },
  { id: "organic", name: "유기생명", origin: "world_life", calories: true, naturalRecovery: true, civilizationEligible: true },
  { id: "inorganic", name: "무기생명", origin: "world_life", calories: false, naturalRecovery: false, civilizationEligible: true },
]));

export const ENERGIES = freeze(index([
  { id: "mechanical", name: "역학", damage: "physical", storage: ["inertial_cell"] },
  { id: "electrical", name: "전기", damage: "electric", storage: ["battery"] },
  { id: "thermal", name: "열", damage: "fire", storage: [] },
  { id: "chemical", name: "화학", damage: "acid", storage: [], sourceRule: "acidic_materials" },
  { id: "magic", name: "마법", damage: "magic_attribute", storage: ["fluid_container", "personal_mana"], effect: "add_property" },
  { id: "divine", name: "신성", damage: "holy", storage: ["relic"], effect: "strengthen_property" },
]));

const materials = [
  ["wood", "목재", 1, ["structure"]],
  ["stone", "돌", 2, ["hardness"]],
  ["scrap_iron", "잡철", 3, ["metalworking"]],
  ["steel", "강철", 4, ["strength", "repairability"]],
  ["titanium", "티타늄", 4, ["specific_strength"]],
  ["nickel", "니켈", 4, ["heat_resistance", "corrosion_resistance"]],
  ["mana_steel", "마나 강철", 5, ["strength", "mana_affinity"]],
  ["mana_titanium", "마나 티타늄", 5, ["specific_strength", "mana_affinity"]],
  ["mana_nickel", "마나 니켈", 5, ["corrosion_resistance", "mana_affinity"]],
  ["mithril", "미스릴", 5, ["lightweight", "mana_affinity"]],
  ["stainless_alloy", "스테인리스 합금", 5, ["corrosion_resistance"]],
].map(([id, name, tier, traits]) => ({ id, name, tier, field: null, traits }));

const branches = {
  arcane_engineering: [
    ["mana_stainless_alloy", "마나 스테인리스 합금"],
    ["consecrated_adamantium", "축성된 아다만티늄"],
    ["arcane_crystal_alloy", "마정석 합금"],
    ["composite_mana_superalloy", "복합 마나 초합금"],
    ["meister_composite", "마이스터 합성재"],
  ],
  arcane_studies: [
    ["mana_wood", "마나 목재"],
    ["consecrated_mana_wood", "축성된 마나 목재"],
    ["world_tree_wood", "세계수 목재"],
    ["fulfilled_world_tree_wood", "대성한 세계수 목재"],
    ["world_heartwood", "세계의 심재"],
  ],
  sanctity: [
    ["raw_arcane_crystal", "원시 마정석"],
    ["refined_arcane_crystal", "정제 마정석"],
    ["holy_iron", "성철"],
    ["blessed_holy_iron", "축복받은 성철"],
    ["saints_endurance", "성자의 인내"],
  ],
  physics: [
    ["inertial_alloy", "관성합금"],
    ["alpha_particle", "알파입자"],
    ["neutrino_condensate", "중성미자 응집체"],
    ["superstring_aggregate", "초끈집합체"],
    ["cosmic_megastructure", "우주 거대 구조"],
  ],
};
for (const [field, rows] of Object.entries(branches)) {
  rows.forEach(([id, name], i) => materials.push({ id, name, tier: i + 6, field, traits: [] }));
}
export const MATERIALS = freeze(index(materials));

// Component capability is declared here; voxel geometry does not infer functions.
// Material traits are not arbitrary abilities and do not provide new energy ports.
export const COMPONENTS = freeze(index([
  { id: "joint", name: "구조·접합부", functions: ["attachment", "load_transfer"], inputs: [], outputs: [], stores: [], research: "joinery" },
  { id: "transmission", name: "구동 전달부", functions: ["transmit_rotation"], inputs: ["mechanical"], outputs: ["mechanical"], stores: [], research: "mechanisms" },
  { id: "motor", name: "전기 구동부", functions: ["rotation"], inputs: ["electrical"], outputs: ["mechanical"], stores: [], research: "power" },
  { id: "heat_engine", name: "열기관", functions: ["rotation"], inputs: ["thermal"], outputs: ["mechanical"], stores: [], research: "power" },
  { id: "generator", name: "발전부", functions: ["generate_electricity"], inputs: ["mechanical"], outputs: ["electrical"], stores: [], research: "power" },
  { id: "battery", name: "전지", functions: ["store_energy"], inputs: ["electrical"], outputs: ["electrical"], stores: ["electrical"], research: "power" },
  { id: "inertial_cell", name: "관성전지", functions: ["store_energy"], inputs: ["mechanical"], outputs: ["mechanical"], stores: ["mechanical"], research: "inertia" },
  { id: "fluid_container", name: "유체 용기", functions: ["contain_fluid"], inputs: [], outputs: [], stores: [], research: "fluids", fluidContents: ["water", "acid", "liquid_mana"] },
  { id: "pump", name: "펌프", functions: ["transfer_fluid"], inputs: ["mechanical"], outputs: [], stores: [], research: "fluids" },
  { id: "mana_condenser", name: "마나 응집부", functions: ["condense_mana"], inputs: [], outputs: ["magic"], stores: [], research: "mana" },
  { id: "property_imprinter", name: "물성 부여부", functions: ["add_property"], inputs: ["magic"], outputs: [], stores: [], research: "mana" },
  { id: "relic", name: "성물", functions: ["generate_divinity", "store_energy", "strengthen_property"], inputs: ["divine"], outputs: ["divine"], stores: ["divine"], research: "consecration" },
  { id: "controller", name: "제어부", functions: ["control"], inputs: [], outputs: [], stores: [], research: "mechanisms" },
]));

const research = [
  ["observation", "관찰과 기록", [], 10],
  ["joinery", "구조와 접합", ["observation"], 20],
  ["mechanisms", "기계 연결", ["joinery", "material:scrap_iron"], 60],
  ["power", "에너지 변환", ["mechanisms"], 100],
  ["fluids", "유체 취급", ["joinery"], 40],
  ["mana", "마나 취급", ["observation", "fluids"], 100],
  ["consecration", "기초 축성", ["observation"], 100],
  ["inertia", "관성 제어", ["power"], 100],
].map(([id, name, prerequisites, work]) => ({
  id, name, field: null, prerequisites,
  self: { work }, blueprint: `blueprint:${id}`, unlocks: [],
}));

const materialPrerequisites = {
  wood: ["joinery"], stone: ["material:wood"], scrap_iron: ["material:stone"],
  steel: ["material:scrap_iron"], titanium: ["material:scrap_iron"], nickel: ["material:scrap_iron"],
  mana_steel: ["material:steel", "mana"], mana_titanium: ["material:titanium", "mana"],
  mana_nickel: ["material:nickel", "mana"], mithril: ["material:titanium", "mana"],
  stainless_alloy: ["material:steel", "material:nickel"],
  mana_stainless_alloy: ["material:stainless_alloy", "mana"],
  mana_wood: ["material:wood", "mana"],
  raw_arcane_crystal: ["mana", "consecration"],
  inertial_alloy: ["material:steel", "inertia"],
};
for (const rows of Object.values(branches)) {
  rows.slice(1).forEach(([id], i) => {
    materialPrerequisites[id] = [`material:${rows[i][0]}`];
  });
}
materialPrerequisites.consecrated_adamantium.push("consecration");
materialPrerequisites.consecrated_mana_wood.push("consecration");
for (const material of materials) {
  research.push({
    id: `material:${material.id}`, name: `${material.name} 가공 연구`, field: material.field,
    prerequisites: materialPrerequisites[material.id],
    self: { work: material.tier * material.tier * 20 },
    blueprint: `blueprint:material:${material.id}`,
    unlocks: [{ kind: "material", id: material.id }],
  });
}
for (const component of Object.values(COMPONENTS)) {
  research.find((entry) => entry.id === component.research).unlocks.push({ kind: "component", id: component.id });
}
export const RESEARCH = freeze(index(research));
export const CONTENT = freeze({
  schema: 1, status: "development", scope: "knowledge_contracts",
  fields: FIELDS, entities: ENTITY_TYPES, energies: ENERGIES,
  materials: MATERIALS, components: COMPONENTS, research: RESEARCH,
});
