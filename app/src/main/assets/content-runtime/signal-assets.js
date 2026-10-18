// First-signal world things (docs/ARCHITECTURE.md §6) as voxel assets made with the shared SDK, after the
// shapes the frontier drew: camp supplies and signal mast, relays, the ruin core, guardians, village signs and
// people, gathering sites and survey markers. Shapes only: what they do belongs to first-signal.js.
import { VoxelAssetBuilder } from './voxel/authoring.js';
import { BIOMES } from '../frontier/campaign.js';
import { GATHERABLES } from '../frontier/content.js';

const GRID = .05, CACHE = new Map();
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const snap = (v) => Math.round(v / GRID) * GRID;
export const FACTION_COLORS = Object.freeze([0xa7bf7c, 0xd0a06d, 0x9aa9c9]);

/** One asset per id; `draw(box, part)` adds boxes by centre and size in metres (snapped to the 5 cm grid). */
function asset(id, name, materials, draw, parts = ['root']) {
  if (CACHE.has(id)) return CACHE.get(id);
  const builder = new VoxelAssetBuilder({ schemaVersion: 1, id, name, category: 'prop', status: 'runtime_campaign', units: 'm', upAxis: 'Y', forwardAxis: '+Z', visualGridM: GRID,
    materials: Object.entries(materials).map(([key, color]) => ({ id: key, color: hex(color), roughness: .85, metallic: 0, emission: 0, opacity: 1, collision: true })),
    parts: parts.map((part, i) => ({ id: part, parent: i ? 'root' : null, translation: [0, 0, 0], role: 'campaign', boxes: [] })), anchors: [], instances: [],
    notes: ['첫 신호 캠페인의 월드 표시 형상이다. 상호작용과 보상은 first-signal 모듈의 규칙에 있다.'] });
  // Later boxes only fill empty space unless they are a marking painted onto what is already there.
  const box = (x, y, z, w, h, d, material, part = 'root', mode = 'fill') => {
    const lo = [snap(x - w / 2), snap(y - h / 2), snap(z - d / 2)], hi = [snap(x + w / 2), snap(y + h / 2), snap(z + d / 2)];
    for (let i = 0; i < 3; i++) if (hi[i] - lo[i] < GRID / 2) hi[i] = lo[i] + GRID;
    builder.addBox(part, { center: lo.map((v, i) => (v + hi[i]) / 2), size: lo.map((v, i) => hi[i] - v), material }, { mode });
  };
  draw(box);
  const built = builder.toJSON();
  CACHE.set(id, built);
  return built;
}

export const relayAsset = (on) => asset(`signal_relay_${on ? 'on' : 'off'}`, on ? '해제한 중계기' : '중계기', { base: 0x576966, lamp: on ? 0x9ee4d8 : 0xe0a45c }, (box) => {
  box(0, .25, 0, .6, .5, .6, 'base');
  box(0, .8, 0, .4, .6, .4, 'lamp');
});

export const ruinCoreAsset = (open) => asset(`signal_ruin_core_${open ? 'open' : 'sealed'}`, '공명 핵', { stand: 0x5d6563, core: open ? 0x9ef0e4 : 0x71d6cb }, (box) => {
  box(0, .1, 0, 1.2, .2, 1.2, 'stand');
  box(0, .9, 0, 1, 1.4, 1, 'core');
});

/** The guardian of a biome (frontier shapes; the limbs of the ridge and coast guardians stay upright). */
export const guardianAsset = (biome) => asset(`signal_guardian_${biome}`, BIOMES[biome].boss,
  { body: BIOMES[biome].color, head: 0xd4b968, eye: 0x9ee4d8, limb: 0x40534e, leg: 0x465d57, horn: 0x836a48, leaf: 0xb4c187, shoulder: 0xa77b58, plate: 0x6e7b7c, fin: 0x7bb6c3 }, (box) => {
    box(0, 1.8, 0, 1.7, 2, 1.2, 'body');
    box(0, 3.2, 0, 1.1, .8, .9, 'head');
    box(0, 3.2, .45, .55, .1, .1, 'eye', 'root', 'replace');
    for (const side of [-1, 1]) {
      if (biome === 0) { box(side * .65, 4.2, 0, .2, .8, .2, 'horn'); box(side * .95, 4.5, 0, .7, .15, .2, 'leaf'); }
      else if (biome === 1) { box(side * 1.2, 3.05, 0, .9, .5, 1, 'shoulder'); box(side * .8, 3.7, 0, .6, .4, .7, 'plate'); }
      else box(side * 1.6, 2.5, 0, .3, 2.3, .7, 'fin');
      box(side * 1.15, 1.8, 0, .6, 1.7, .6, 'limb');
      box(side * .55, .4, 0, .6, .8, .7, 'leg');
    }
  });

export const villageSignAsset = (faction) => asset(`signal_village_sign_${faction}`, '마을 표지', { post: 0x635344, flag: FACTION_COLORS[faction] }, (box) => {
  box(0, 2, 0, .15, 4, .15, 'post');
  box(.7, 3.5, 0, 1.2, .7, .1, 'flag');
});

/** A villager: legs, a tunic in the faction colour with a role colour belt, arms and a head. */
export const villagerAsset = (faction, role) => asset(`signal_villager_${faction}_${role}`, ['보급 담당', '약초사', '정비사'][role],
  { cloth: FACTION_COLORS[faction], trim: [0xd8b25a, 0x7fb07a, 0x8c9aa6][role], skin: 0xe4cfa6, legs: 0x4d4a44 }, (box) => {
    for (const side of [-1, 1]) box(side * .12, .4, 0, .2, .8, .25, 'legs', side < 0 ? 'left_leg' : 'right_leg');
    box(0, 1.1, 0, .5, .6, .3, 'cloth');
    box(0, .85, 0, .5, .1, .3, 'trim', 'root', 'replace');
    for (const side of [-1, 1]) box(side * .35, 1.1, 0, .15, .55, .2, 'cloth', side < 0 ? 'left_arm' : 'right_arm');
    box(0, 1.6, 0, .3, .35, .3, 'skin');
  }, ['root', 'left_leg', 'right_leg', 'left_arm', 'right_arm']);

export const campCrateAsset = () => asset('signal_camp_crate', '원정 보급함', { wood: 0xd69d55 }, (box) => box(0, .25, 0, 1.1, .5, 1.1, 'wood'));

/** The signal mast; its three lamps are their own things so they can light one by one. */
export const mastAsset = () => asset('signal_mast', '송신탑', { pole: 0x566461, bar: 0x70817a }, (box) => {
  for (const side of [-1, 1]) box(side * 1.4, 2.4, 0, .25, 4.8, .25, 'pole');
  for (const y of [1, 2.5, 4]) box(0, y, 0, 3, .2, .2, 'bar');
});
export const lampAsset = (biome, lit) => asset(`signal_lamp_${lit ? biome : 'off'}`, lit ? `${BIOMES[biome].signal} 신호` : '꺼진 신호등', { lamp: lit ? BIOMES[biome].color : 0x3d4847 }, (box) => box(0, 0, 0, .5, .5, .5, 'lamp'));
export const beamAsset = () => asset('signal_beam', '첫 신호', { beam: 0xb9f2d6 }, (box) => box(0, 3.5, 0, .15, 7, .15, 'beam'));

/** Camp facilities at the frontier's offsets from the camp (garden beds, workbench, cooking stove). */
export const FACILITY_OFFSETS = Object.freeze({ garden: [-2.5, 1], workshop: [2.8, -2], kitchen: [2.7, 2.7] });
export const facilityAsset = (id) => asset(`signal_facility_${id}`, { garden: '공동 텃밭', workshop: '공동 정비소', kitchen: '야영 취사장' }[id],
  { soil: 0x76553b, edge: 0xbfa16d, top: 0xa88b64, leg: 0x665540, vise: 0x788c90, stone: 0x758077, pot: 0x494b40, fire: 0xd1aa67 }, (box) => {
    if (id === 'garden') for (const z of [0, 1.5]) { box(0, .1, z, 2, .2, 1.2, 'soil'); for (const x of [-1.05, 1.05]) box(x, .25, z, .1, .5, 1.4, 'edge'); }
    else if (id === 'workshop') { box(0, .8, 0, 1.8, .2, 1.1, 'top'); for (const x of [-.7, .7]) box(x, .35, 0, .15, .7, .8, 'leg'); box(0, 1.1, 0, .6, .4, .5, 'vise'); }
    else { box(0, .2, 0, 1.5, .4, 1.2, 'stone'); box(0, .6, 0, .7, .4, .7, 'pot'); box(0, .85, 0, .6, .1, .6, 'fire'); }
  });

/** A garden bed's crop row at one of three growth stages (stems with a flower head, frontier). */
export const cropAsset = (stage) => asset(`signal_crop_${stage}`, '작물', { stem: 0x719955, head: 0xb88979 }, (box) => {
  const h = [.25, .45, .7][stage];
  for (const x of [-.6, 0, .6]) { box(x, h / 2, 0, .1, h, .1, 'stem'); if (stage) box(x, h, 0, .35, .2, .35, 'head'); }
});

export const resourceAsset = (kind) => asset(`signal_resource_${kind}`, GATHERABLES[kind].name,
  { ground: kind === 'scrap' ? 0x59656a : 0x576e43, grow: GATHERABLES[kind].color, trunk: 0x805738, bush: 0x597a51, berry: 0xc76b77, bloom: 0xd8dbbc, plate: 0x7f9394 }, (box) => {
    box(0, .1, 0, .6, .2, .6, 'ground');
    if (kind === 'wood') { box(0, .85, 0, .25, 1.3, .25, 'trunk'); box(0, 1.9, 0, 1.1, .8, 1.1, 'grow'); }
    else if (kind === 'berry') { box(0, .55, 0, .9, .7, .85, 'bush'); for (const [x, z] of [[-.3, .45], [.25, .45], [.25, -.45]]) box(x, .65, z, .2, .2, .2, 'berry'); }
    else {
      for (const [x, z, h] of [[-.22, 0, .45], [.2, .15, .6], [0, -.15, .7]]) box(x, .2 + h / 2, z, .25, kind === 'scrap' ? h * .65 : h, .25, 'grow');
      if (kind === 'herb') for (const x of [-.22, .2, 0]) box(x, .95, 0, .2, .1, .2, 'bloom');
      if (kind === 'scrap') box(0, .25, .3, .9, .15, .25, 'plate');
    }
  });

export const surveyMarkerAsset = (visited) => asset(`signal_survey_${visited ? 'done' : 'open'}`, '측량 표석', { post: 0x9caa9e, cap: visited ? 0x8fa17d : 0xe3cb8c }, (box) => {
  box(0, .5, 0, .25, 1, .25, 'post');
  box(0, 1.05, 0, .65, .2, .65, 'cap');
});
