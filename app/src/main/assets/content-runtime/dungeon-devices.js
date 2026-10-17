// Persistent, authored puzzle machinery. Resource units and per-device rates are
// local proposals; fixture components and their port contracts remain catalog-owned.
import { FIXTURE_LINK_RULES } from './fixture-energy.js';
import { VoxelAssetBuilder } from './voxel/authoring.mjs';

const STRUCTURE_RESTORE_COST = Object.freeze({ wood: 2, stone: 2 });
const STRUCTURE_PART_NAMES = Object.freeze({ windvane: '풍향판', platform: '운반대', altar: '제단 구조', mana_vine: '마나 수관' });
const VERSION = 1;
const TYPES = ['mechanical', 'electrical', 'thermal', 'chemical', 'magic', 'divine'];
const EPS = 1e-8;
const copy = value => structuredClone(value);
const finite = Number.isFinite;
const zero = () => Object.fromEntries(TYPES.map(type => [type, 0]));
const validPoint = p => Array.isArray(p) && p.length === 3 && p.every(finite);
const point = p => Array.isArray(p) ? p.slice(0, 3) : [p?.x, p?.y ?? 0, p?.z];
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const fail = reason => ({ ok: false, reason });
const success = extra => ({ ok: true, ...extra });

const SHAPE_CACHE = new Map();
const ROTATING_CACHE = new Map();
const GRID_M = 1 / 16;
function primitiveShape(shapeId, material, color) {
  if (SHAPE_CACHE.has(shapeId)) return SHAPE_CACHE.get(shapeId);
  const builder = new VoxelAssetBuilder({ schemaVersion: 1, id: `dungeon_device_${shapeId}`, name: shapeId,
    category: 'structure', equipmentKind: null, status: 'art_prototype', units: 'm', upAxis: 'Y', forwardAxis: '+Z', visualGridM: GRID_M,
    materials: [{ id: material, color, roughness: .8, metallic: .1, emission: 0, opacity: 1, collision: true }],
    parts: [{ id: 'root', parent: null, translation: [0, 0, 0], role: 'dungeon_device', boxes: [] }], anchors: [], instances: [], notes: ['Runtime pose of a VoxelAssetBuilder-authored device primitive.'] });
  builder.addBox('root', { center: [GRID_M / 2, GRID_M / 2, GRID_M / 2], size: [GRID_M, GRID_M, GRID_M], material });
  const asset = builder.toJSON(), shape = { asset, material, color };
  SHAPE_CACHE.set(shapeId, shape); return shape;
}
function rotatingSegmentAsset(shapeId, angleRad, material, color) {
  const angle = Math.round(angleRad * 1e4) / 1e4, key = `${shapeId}:${angle}:${material}:${color}`;
  if (ROTATING_CACHE.has(key)) return ROTATING_CACHE.get(key);
  const builder = new VoxelAssetBuilder({ schemaVersion: 1, id: `dungeon_device_${shapeId}_${String(angle).replace('-', 'm').replace('.', '_')}`, name: shapeId,
    category: 'structure', equipmentKind: null, status: 'art_prototype', units: 'm', upAxis: 'Y', forwardAxis: '+Z', visualGridM: GRID_M,
    materials: [{ id: material, color, roughness: .65, metallic: .5, emission: 0, opacity: 1, collision: true }],
    parts: [{ id: 'root', parent: null, translation: [0, 0, 0], role: 'dungeon_device', boxes: [] }], anchors: [], instances: [], notes: ['Discrete rotating plate pose authored through VoxelAssetBuilder; one part uses explicit empty-space fills to avoid overlap.'] });
  const c = Math.cos(angle), s = Math.sin(angle), aligned = Math.min(Math.abs(c), Math.abs(s)) < .12;
  builder.addPart({ id: 'plate', parent: 'root', role: 'dungeon_device' });
  for (let i = 0; i < 5; i++) {
    const offset = (i - 2) * .4;
    const longX = Math.abs(c) >= Math.abs(s), plan = aligned
      ? longX ? [.4, .25] : [.25, .4]
      : [.34, .34];
    const size = plan.map(v => Math.max(GRID_M, Math.round(v / GRID_M) * GRID_M));
    const dimensions = [size[0], .25, size[1]];
    const center = [c * offset, .125, s * offset].map((v, axis) =>
      Math.round((v - dimensions[axis] / 2) / GRID_M) * GRID_M + dimensions[axis] / 2);
    builder.addBox('plate', { center, size: dimensions, material }, {mode:'fill'});
  }
  const asset = builder.toJSON();
  if(ROTATING_CACHE.size>=128)ROTATING_CACHE.delete(ROTATING_CACHE.keys().next().value);
  ROTATING_CACHE.set(key, asset); return asset;
}

const PUZZLE_RULES = Object.freeze({
  root_manor: { manual: 'lift_gate', parts: ['joint'], clearanceM: 4.5, liftRateEUPerS: 10, liftRateMPerEU: 0.1 },
  mining_fort: { manual: 'shift_rubble', parts: ['joint', 'transmission'], rubbleMoveM: 3, rubbleRateMPerEU: 0.03 },
  floodworks: { manual: 'start_pump', parts: ['pump', 'fluid_container'], fluidType: 'acid_fluid', initialLiters: 400, safeDepthM: 0.05, poolAreaM2: 4, pumpRateLPerS: 10, pumpEUPerS: 10 },
  geothermal_foundry: { manual: 'start_cooling', parts: ['pump', 'heat_engine'], initialPathEU: 600, initialSourceEU: 400, heatCapacityEUPerC: 10, safePathEU: 200, coolantLiters: 20, heatTransferEUPerLiter: 60, pumpEUPerS: 10 },
  cliff_observatory: { manual: null, parts: ['joint', 'controller'], targetAngleRad: Math.PI / 2, windN: 30, safeWindN: 5 },
  sealed_arboretum: { manual: 'start_pump', parts: ['pump', 'mana_condenser'], fluidType: 'liquid_mana', initialLiters: 60, safeLiters: 6, pipeAreaM2: 0.24, pumpRateLPerS: 10, pumpEUPerS: 10 },
  forgotten_monastery: { manual: 'align_altar', parts: ['relic', 'transmission'], targetAngleRad: Math.PI / 2, divineRequiredEU: 10, divineEUPerS: 1, alignmentEUPerS: 10 },
  inertia_tower: { manual: 'engage_brake', parts: ['inertial_cell', 'controller'], massKg: 500, railMinM: 0, railMaxM: 8, targetM: 4, initialPositionM: 2.75, initialVelocityMps: 1, brakeControlEUPerS: 1, decelerationMps2: 0.4, cellCapacityEU: 600 },
});

function initialState(instance, template, legacyPuzzle = null) {
  const parts = Object.fromEntries((template.puzzle?.componentAnchors || []).map(anchor => [anchor.id, {
    componentId: anchor.componentId, installed: false, healthHp: 100, maxHealthHp: 100, ownerId: null,
  }]));
  const rules = PUZZLE_RULES[template.id] || {};
  const state = {
    schemaVersion: VERSION,
    parts,
    structureParts: {
      puzzle_gate: { healthHp: 100, maxHealthHp: 100, installed: legacyPuzzle?.phase !== 'open' },
      ...(template.id === 'mining_fort' ? { rubble: { healthHp: 100, maxHealthHp: 100, installed: true }, bridge_support: { healthHp: 0, maxHealthHp: 100, installed: false } } : {}),
      ...(template.id === 'sealed_arboretum' ? { mana_vine: { healthHp: 100, maxHealthHp: 100, installed: true } } : {}),
      ...(template.id === 'forgotten_monastery' ? { altar: { healthHp: 100, maxHealthHp: 100, installed: true } } : {}),
      ...(template.id === 'inertia_tower' ? { platform: { healthHp: 100, maxHealthHp: 100, installed: true } } : {}),
      ...(template.id === 'cliff_observatory' ? { windvane: { healthHp: 100, maxHealthHp: 100, installed: true } } : {}),
    },
    supplies: {},
    energy: zero(),
    metrics: { consumedEU: zero(), transferredInEU: zero(), transferredOutEU: zero(), manualInputEU: 0, heatLostEU: 0, spilledLiters: 0 },
    solved: legacyPuzzle?.phase === 'open',
    legacySolved: legacyPuzzle?.phase === 'open',
    work: { progressEU: 0, progressM: 0, active: legacyPuzzle?.phase === 'opening' && !!legacyPuzzle?.paid, legacyPaid: !!legacyPuzzle?.paid, legacyProgressS: legacyPuzzle?.phase === 'opening' ? Math.max(0, legacyPuzzle.elapsedS || 0) : 0 },
    claims: [],
    ecologyBasin: template.ecology?.water ? { initialLiters: template.ecology.water.volumeL, volumeLiters: template.ecology.water.volumeL, spilledLiters: 0, breached: false } : null,
    fluid: null,
    heat: null,
    wind: null,
    altar: null,
    motion: null,
  };
  if (template.id === 'mining_fort') state.bridge = { healthHp: 0, maxHealthHp: 100, loadKg: 600, installed: false };
  if (legacyPuzzle?.paid || legacyPuzzle?.phase === 'open') for (const part of Object.values(parts)) part.installed = true;
  if (instance.waterBreached && state.ecologyBasin) {
    state.ecologyBasin.spilledLiters = state.ecologyBasin.volumeLiters;
    state.ecologyBasin.volumeLiters = 0;
    state.ecologyBasin.breached = true;
  }
  if (template.id === 'floodworks' || template.id === 'sealed_arboretum') {
    const initialLiters = rules.initialLiters;
    state.fluid = { type: rules.fluidType, initialLiters, sourceLiters: initialLiters, receiverLiters: 0, spilledLiters: 0, route: template.id === 'sealed_arboretum' ? 'canopy' : 'outfall', running: false, leak: false };
  }
  if (template.id === 'geothermal_foundry') {
    state.heat = { initialTotalEU: rules.initialPathEU + rules.initialSourceEU, pathEU: rules.initialPathEU, coolantLiters: rules.coolantLiters, coolantHeatEU: 0, sourceEU: rules.initialSourceEU, lossEU: 0, valveOpen: true, pumpRunning: false };
  }
  if (template.id === 'cliff_observatory') state.wind = { angleRad: 0, locked: false, vaneAttached: true };
  if (template.id === 'forgotten_monastery') state.altar = { angleRad: 0, aligned: false, running: false, divineReceivedEU: 0, divineConsumedEU: 0 };
  if (template.id === 'inertia_tower') {
    const kineticEU = 0.5 * rules.massKg * rules.initialVelocityMps ** 2 / 100;
    state.motion = { positionM: rules.initialPositionM, velocityMps: rules.initialVelocityMps, kineticEU, initialKineticEU: kineticEU, capturedEU: 0, lostEU: 0, braking: false, locked: false, targetM: rules.targetM };
  }
  if (legacyPuzzle?.phase === 'opening' && legacyPuzzle.paid) {
    const ratio = clamp((legacyPuzzle.elapsedS || 0) / Math.max(1, legacyPuzzle.durationS || 1), 0, 0.95);
    state.work.progressEU = ratio * 40;
    state.work.progressM = ratio * (rules.clearanceM || rules.rubbleMoveM || 1);
  }
  return state;
}

export class DungeonDeviceSystem {
  constructor(dungeons) { this.dungeons = dungeons; this.geometryCache = new WeakMap(); }

  createState(instance, template) { return initialState(instance, template, instance.puzzle); }

  validateState(instance, template) {
    const s = instance.deviceState;
    if (!s || s.schemaVersion !== VERSION || !s.parts || !s.structureParts || !s.supplies || !s.energy || !s.metrics || typeof s.solved !== 'boolean' || !TYPES.every(t => finite(s.energy[t]) && s.energy[t] >= 0)) throw Error('던전 장치 저장이 잘못되었습니다.');
    for (const anchor of template.puzzle?.componentAnchors || []) {
      const part = s.parts[anchor.id];
      if (!part || part.componentId !== anchor.componentId || typeof part.installed !== 'boolean' || !finite(part.healthHp) || part.healthHp < 0 || !finite(part.maxHealthHp) || part.maxHealthHp <= 0 || part.healthHp > part.maxHealthHp || (part.ownerId !== null && typeof part.ownerId !== 'string')) throw Error('던전 부품 저장이 잘못되었습니다.');
    }
    for (const [id, part] of Object.entries(s.structureParts)) if (typeof id !== 'string' || typeof part.installed !== 'boolean' || !finite(part.healthHp) || part.healthHp < 0 || !finite(part.maxHealthHp) || part.maxHealthHp <= 0 || part.healthHp > part.maxHealthHp) throw Error('던전 구조 장치 저장이 잘못되었습니다.');
    if (!Array.isArray(s.claims) || !s.claims.every(id => typeof id === 'string')) throw Error('던전 장치 청구 저장이 잘못되었습니다.');
    if (s.fluid && ['initialLiters', 'sourceLiters', 'receiverLiters', 'spilledLiters'].some(k => !finite(s.fluid[k]) || s.fluid[k] < 0)) throw Error('던전 유체 저장이 잘못되었습니다.');
    if (s.heat && ['initialTotalEU', 'pathEU', 'coolantHeatEU', 'sourceEU', 'coolantLiters'].some(k => !finite(s.heat[k]) || s.heat[k] < 0)) throw Error('던전 열 저장이 잘못되었습니다.');
    if (s.motion && ['positionM', 'velocityMps', 'kineticEU', 'capturedEU', 'lostEU'].some(k => !finite(s.motion[k]))) throw Error('던전 운동 저장이 잘못되었습니다.');
  }

  _instance(id) { return this.dungeons.get(id); }
  _template(id) { return this.dungeons.definition(id); }
  _state(id) { return this._instance(id)?.deviceState || null; }
  _anchors(id) { return this._template(id)?.puzzle?.componentAnchors || []; }
  _anchorPosition(id, anchorId = null) {
    const instance = this._instance(id), anchors = this._anchors(id);
    const anchor = (anchorId && anchors.find(a => a.id === anchorId)) || anchors[0];
    return anchor ? instance.origin.map((v, i) => v + anchor.positionM[i]) : instance.origin;
  }
  _inRange(id, position, anchorId = null, maxDistance = 4) {
    const p = point(position);
    return validPoint(p) && distance(p, this._anchorPosition(id, anchorId)) <= maxDistance;
  }
  _claim(instanceId, actionId, claimId, suffix = '') {
    return claimId || `${instanceId}:device:${actionId}${suffix ? `:${suffix}` : ''}`;
  }
  _partByComponent(id, componentId) { return this._anchors(id).find(a => a.componentId === componentId); }
  _partInstalled(id, componentId) {
    const anchor = this._partByComponent(id, componentId), part = anchor && this._state(id)?.parts[anchor.id];
    return !!part?.installed && part.healthHp > 0;
  }
  _refresh(id) {
    const instance = this._instance(id), state = this._state(id), rules = PUZZLE_RULES[instance?.templateId];
    if (!instance?.puzzle || !rules || !state) return false;
    const has = component => this._partInstalled(id, component);
    let solved = false;
    switch (instance.templateId) {
      case 'root_manor': solved = state.work.progressM >= rules.clearanceM && has('joint') && !!state.structureParts.puzzle_gate?.installed; break;
      case 'mining_fort': solved = state.work.progressM >= rules.rubbleMoveM && !!state.structureParts.rubble?.installed && has('joint') && has('transmission') && !!state.bridge?.installed && state.bridge.healthHp > 0; break;
      case 'floodworks': solved = !!state.fluid && state.fluid.sourceLiters / (1000 * rules.poolAreaM2) <= rules.safeDepthM && has('pump') && has('fluid_container'); break;
      case 'geothermal_foundry': solved = !!state.heat && !state.heat.valveOpen && state.heat.pathEU <= rules.safePathEU && has('pump') && has('heat_engine'); break;
      case 'cliff_observatory': solved = !!state.wind?.locked && state.wind.vaneAttached && !!state.structureParts.windvane?.installed && has('joint') && has('controller') && this._windForce(state.wind, rules) <= rules.safeWindN; break;
      case 'sealed_arboretum': solved = !!state.fluid && state.fluid.route === 'receiver' && state.fluid.sourceLiters <= rules.safeLiters && has('pump') && has('mana_condenser'); break;
      case 'forgotten_monastery': solved = !!state.altar?.aligned && state.altar.divineConsumedEU >= rules.divineRequiredEU && !!state.structureParts.altar?.installed && has('relic') && has('transmission'); break;
      case 'inertia_tower': solved = !!state.motion?.locked && Math.abs(state.motion.velocityMps) <= 0.1 && Math.abs(state.motion.positionM - rules.targetM) <= 0.5 && !!state.structureParts.platform?.installed && has('inertial_cell') && has('controller'); break;
    }
    const legacyIntact = state.legacySolved && rules.parts.every(has);
    solved ||= legacyIntact;
    const changed = state.solved !== solved;
    state.solved = solved;
    instance.puzzle.phase = solved ? 'open' : state.work.active ? 'opening' : 'locked';
    instance.puzzle.elapsedS = Math.max(state.work.legacyProgressS || 0, state.work.progressEU / 10, state.work.progressM);
    instance.puzzle.paid = !!state.work.legacyPaid;
    if (changed) { instance.revision++; if (solved) this.dungeons.events.push({ type: 'puzzle_opened', instanceId: id }); }
    return solved;
  }

  _requirementsMet(id, actionId) {
    const instance = this._instance(id), rules = PUZZLE_RULES[instance?.templateId];
    if (!rules) return false;
    const needed = rules.parts;
    if (actionId.startsWith('install:') || actionId.startsWith('replace:')) return true;
    if (actionId === 'repair_bridge') return this._partInstalled(id, 'joint') && this._partInstalled(id, 'transmission');
    if (instance.templateId === 'cliff_observatory' && actionId === 'set_vane') return this._partInstalled(id, 'joint') && this._partInstalled(id, 'controller');
    return needed.every(component => this._partInstalled(id, component));
  }

  act(id, actionId, { position, progression, claimId, angleRad, ownerId = null, targetM = null } = {}) {
    const instance = this._instance(id), state = this._state(id), template = this._template(id);
    if (!instance || !state || !template?.puzzle) return fail('no_puzzle');
    if (typeof actionId !== 'string') return fail('invalid_action');
    const componentAction = /^(install|replace):(.+)$/.exec(actionId);
    const anchor = componentAction && this._anchors(id).find(a => a.id === componentAction[2]);
    if (!this._inRange(id, position, anchor?.id || null)) return fail('out_of_range');
    if (componentAction) {
      if (!anchor) return fail('unknown_component_anchor');
      const part = state.parts[anchor.id];
      if (componentAction[1] === 'install' && part.installed && part.healthHp > 0) return success({ duplicate: true, part: copy(part) });
      if (componentAction[1] === 'replace' && part.installed && part.healthHp >= part.maxHealthHp) return success({ duplicate: true, part: copy(part) });
      if (!progression?.spend) return fail('progression_required');
      const costId = this._claim(id, actionId, claimId, String(part.replacements || 0));
      const receipt = progression.spend({ [anchor.componentId]: 1 }, { claimId: costId });
      if (!receipt?.ok || receipt.duplicate) return fail(receipt?.reason || 'component_required');
      part.installed = true; part.healthHp = part.maxHealthHp; part.ownerId = ownerId || null; part.replacements = (part.replacements || 0) + (componentAction[1] === 'replace' ? 1 : 0);
      instance.revision++; this._refresh(id); return success({ part: copy(part), componentId: anchor.componentId, consumed: { [anchor.componentId]: 1 } });
    }

    const restore = /^restore:(windvane|platform|altar|mana_vine)$/.exec(actionId);
    if (restore) {
      // Destroyed puzzle structures must stay recoverable or the passage can never be solved again.
      const partId = restore[1], structurePart = state.structureParts[partId];
      if (!structurePart) return fail('unknown_device_part');
      if (structurePart.installed && structurePart.healthHp >= structurePart.maxHealthHp) return success({ duplicate: true, partId });
      if (!progression?.spend) return fail('progression_required');
      const receipt = progression.spend(STRUCTURE_RESTORE_COST, { claimId: this._claim(id, actionId, claimId, String(structurePart.restorations || 0)) });
      if (!receipt?.ok || receipt.duplicate) return fail(receipt?.reason || 'items_required');
      Object.assign(structurePart, { healthHp: structurePart.maxHealthHp, installed: true, restorations: (structurePart.restorations || 0) + 1 });
      if (partId === 'windvane' && state.wind) state.wind.vaneAttached = true;
      if (partId === 'mana_vine' && state.fluid) state.fluid.leak = false;
      instance.revision++; this._refresh(id); return success({ partId, structurePart: copy(structurePart), consumed: { ...STRUCTURE_RESTORE_COST } });
    }
    if (actionId === 'repair_bridge' && instance.templateId === 'mining_fort') {
      if (!this._requirementsMet(id, actionId)) return fail('components_required');
      if (!progression?.spend) return fail('progression_required');
      const receipt = progression.spend({ wood: 2, stone: 2 }, { claimId: this._claim(id, actionId, claimId) });
      if (!receipt?.ok || receipt.duplicate) return fail(receipt?.reason || 'missing_inputs');
      state.bridge = { healthHp: 100, maxHealthHp: 100, loadKg: 600, installed: true };
      state.structureParts.bridge_support = { healthHp: 100, maxHealthHp: 100, installed: true };
      instance.revision++; this._refresh(id); return success({ bridge: copy(state.bridge), consumed: { wood: 2, stone: 2 } });
    }
    if (actionId === 'repair_bridge' || actionId === 'lift_gate' || actionId === 'shift_rubble' || actionId === 'start_pump' || actionId === 'start_cooling' || actionId === 'align_altar' || actionId === 'start_trial' || actionId === 'engage_brake' || actionId === 'lock_platform' || actionId === 'set_vane' || actionId === 'lock_vane' || actionId === 'close_valve' || actionId === 'route_mana') {
      if (!this._requirementsMet(id, actionId)) return fail('components_required');
    }

    switch (actionId) {
      case 'lift_gate':
        if (instance.templateId !== 'root_manor') return fail('unsupported_action');
        state.work.active = true; state.work.direction = 'up'; break;
      case 'lower_gate':
        if (instance.templateId !== 'root_manor') return fail('unsupported_action');
        state.work.active = true; state.work.direction = 'down'; break;
      case 'shift_rubble':
        if (instance.templateId !== 'mining_fort') return fail('unsupported_action');
        state.work.active = true; state.work.direction = 'rubble'; break;
      case 'start_pump':
        if (!['floodworks', 'sealed_arboretum'].includes(instance.templateId)) return fail('unsupported_action');
        if (instance.templateId === 'sealed_arboretum' && state.fluid.route !== 'receiver') return fail('receiver_route_required');
        state.fluid.running = true; state.work.active = true; break;
      case 'close_valve':
        if (instance.templateId !== 'geothermal_foundry') return fail('unsupported_action');
        state.heat.valveOpen = false; state.work.active = true; break;
      case 'start_cooling':
        if (instance.templateId !== 'geothermal_foundry') return fail('unsupported_action');
        if (state.heat.valveOpen) return fail('valve_open');
        state.heat.pumpRunning = true; state.work.active = true; break;
      case 'set_vane':
        if (instance.templateId !== 'cliff_observatory' || !finite(angleRad) || Math.abs(angleRad) > Math.PI) return fail('invalid_angle');
        state.wind.angleRad = angleRad; state.wind.locked = false; break;
      case 'lock_vane':
        if (instance.templateId !== 'cliff_observatory') return fail('unsupported_action');
        state.wind.locked = Math.abs(state.wind.angleRad - PUZZLE_RULES.cliff_observatory.targetAngleRad) <= Math.PI / 8;
        if (!state.wind.locked) return fail('angle_not_aligned');
        break;
      case 'route_mana':
        if (instance.templateId !== 'sealed_arboretum') return fail('unsupported_action');
        state.fluid.route = 'receiver'; break;
      case 'align_altar':
        if (instance.templateId !== 'forgotten_monastery') return fail('unsupported_action');
        state.altar.running = true; state.work.active = true; break;
      case 'start_trial':
        if (instance.templateId !== 'forgotten_monastery') return fail('unsupported_action');
        if (!state.altar.aligned) return fail('altar_not_aligned');
        state.altar.running = true; state.work.active = true; break;
      case 'engage_brake':
        if (instance.templateId !== 'inertia_tower') return fail('unsupported_action');
        if (targetM != null && (!finite(targetM) || targetM < PUZZLE_RULES.inertia_tower.railMinM || targetM > PUZZLE_RULES.inertia_tower.railMaxM)) return fail('invalid_target');
        state.motion.braking = true; state.motion.locked = false; state.work.active = true;
        if (targetM != null) state.motion.targetM = targetM;
        break;
      case 'lock_platform':
        if (instance.templateId !== 'inertia_tower') return fail('unsupported_action');
        if (Math.abs(state.motion.velocityMps) > 0.1 || Math.abs(state.motion.positionM - state.motion.targetM) > 0.5) return fail('platform_not_aligned');
        state.motion.locked = true; state.motion.braking = false; break;
      default: return fail('unsupported_action');
    }
    instance.revision++; this._refresh(id);
    return success({ actionId, status: this.status(id, { progression }) });
  }

  _supplyTarget(id, anchorId, type) {
    const anchors = this._anchors(id), instance = this._instance(id);
    const anchor = (anchorId && anchors.find(a => a.id === anchorId)) || anchors.find(a => PUZZLE_RULES[instance.templateId]?.parts?.includes(a.componentId)) || anchors[0];
    return anchor ? instance.origin.map((v, i) => v + anchor.positionM[i]) : null;
  }
  _fixtureSupply(instanceId, ownerId, type, progression, target = null) {
    const grid = progression?.fixtureEnergy, node = grid?.nodes?.get(ownerId);
    if (!grid || !node || !TYPES.includes(type)) return { ok: false, reason: 'unknown_fixture' };
    const ports = grid.ports(ownerId), world = node.position && [node.position.x, node.position.y, node.position.z];
    if (!world || !validPoint(world) || !node.active || node.health <= 0 || !progression.fixtureAccess?.includes(ownerId)) return { ok: false, reason: 'fixture_unavailable' };
    if (!ports?.outputs.includes(type) || !ports?.stores.includes(type)) return { ok: false, reason: 'output_port_required' };
    if (target && distance(world, target) > FIXTURE_LINK_RULES.maxDistanceM + EPS) return { ok: false, reason: 'cable_too_long' };
    return { ok: true, grid, node, ports, position: world };
  }
  connectSupply(instanceId, ownerId, type, { progression, claimId, anchorId = null } = {}) {
    const state = this._state(instanceId), instance = this._instance(instanceId), target = this._supplyTarget(instanceId, anchorId, type);
    if (!state || !instance?.puzzle || !target) return fail('unknown_instance');
    const source = this._fixtureSupply(instanceId, ownerId, type, progression, target); if (!source.ok) return fail(source.reason);
    if (!progression?.spend || typeof claimId !== 'string' || !claimId) return fail('claim_required');
    const lengthM = distance(source.position, target), materialCost = FIXTURE_LINK_RULES.materials[type];
    const items = Object.fromEntries(Object.entries(materialCost).map(([id, quantity]) => [id, Math.ceil(quantity * Math.max(0.25, lengthM) * 1000) / 1000]));
    if (state.supplies[type]) return fail('supply_already_connected');
    const receipt = progression.spend(items, { claimId: `${claimId}:cable` }); if (!receipt?.ok || receipt.duplicate) return fail(receipt?.reason || 'cable_material_required');
    state.supplies[type] = { ownerId, type, lengthM, anchorId: this._anchors(instanceId).find(a => distance(target, instance.origin.map((v, i) => v + a.positionM[i])) < EPS)?.id || anchorId || null, items };
    instance.revision++;
    return success({ supply: copy(state.supplies[type]), consumed: items });
  }
  disconnectSupply(instanceId, type, { progression } = {}) {
    const state = this._state(instanceId), instance = this._instance(instanceId);
    if (!state || !instance?.puzzle || !TYPES.includes(type)) return fail('unknown_instance_or_type');
    const link = state.supplies[type]; if (!link) return fail('unknown_supply');
    const grid = progression?.fixtureEnergy, node = grid?.nodes?.get(link.ownerId);
    if (!grid) return fail('progression_required');
    // A dismantled source leaves a dead link; clearing it must not require reaching a fixture that no longer exists.
    if (node &&!progression.fixtureAccess?.includes(link.ownerId)) return fail('out_of_range');
    delete state.supplies[type]; instance.revision++;
    return success({ disconnected: true, ownerId: link.ownerId, type, materialRefund: {} });
  }
  charge(instanceId, type, amount, { progression, claimId } = {}) {
    const state = this._state(instanceId), instance = this._instance(instanceId);
    if (!state || !instance?.puzzle || !TYPES.includes(type) || !finite(amount) || amount <= 0) return fail('invalid_charge');
    const link = state.supplies[type]; if (!link) return fail('supply_required');
    const target = this._supplyTarget(instanceId, link.anchorId, type), source = this._fixtureSupply(instanceId, link.ownerId, type, progression, target);
    if (!source.ok) return fail(source.reason);
    if (!claimId || typeof claimId !== 'string') return fail('claim_required');
    if (state.claims.includes(claimId)) return success({ duplicate: true, deviceEU: state.energy[type] });
    const cap = this._reserveCapacity(instanceId, type), accepted = Math.min(amount, Math.max(0, cap - state.energy[type]), source.node.energy[type]);
    if (accepted <= EPS) return fail(state.energy[type] >= cap - EPS ? 'device_capacity' : 'insufficient_stored_energy');
    source.node.energy[type] -= accepted; state.energy[type] += accepted;
    source.grid.metrics.exported[type] += accepted; state.metrics.transferredInEU[type] += accepted;
    state.claims.push(claimId);
    instance.revision++;
    return success({ transferredEU: accepted, remainingEU: source.node.energy[type], deviceEU: state.energy[type] });
  }
  _reserveCapacity(id, type) {
    const idByTemplate = this._instance(id)?.templateId;
    if (idByTemplate === 'root_manor') return type === 'mechanical' ? 80 : 0;
    if (idByTemplate === 'mining_fort') return type === 'mechanical' ? 100 : 0;
    if (idByTemplate === 'floodworks') return type === 'mechanical' ? 16000 : 0;
    if (idByTemplate === 'geothermal_foundry') return type === 'mechanical' ? 120 : 0;
    if (idByTemplate === 'sealed_arboretum') return type === 'mechanical' ? 1200 : 0;
    if (idByTemplate === 'forgotten_monastery') return type === 'mechanical' ? 80 : type === 'divine' ? 20 : 0;
    if (idByTemplate === 'inertia_tower') return type === 'mechanical' ? 120 : 0;
    return 0;
  }
  _takePower(id, type, amount, manualRemaining) {
    const state = this._state(id); if (amount <= 0) return 0;
    let take = Math.min(amount, state.energy[type]); state.energy[type] -= take;
    if (type === 'mechanical' && manualRemaining) {
      const extra = Math.min(amount - take, manualRemaining.value);
      take += extra; manualRemaining.value -= extra;
      state.metrics.manualInputEU += extra;
    }
    state.metrics.consumedEU[type] += take;
    return take;
  }
  _refreshSupplyLinks(id, progression) {
    const state = this._state(id), result = [];
    for (const [type, link] of Object.entries(state?.supplies || {})) {
      const target = this._supplyTarget(id, link.anchorId, type), source = this._fixtureSupply(id, link.ownerId, type, progression, target);
      result.push({ ...copy(link), valid: !!source.ok, reason: source.reason || null, storedEU: source.ok ? source.node.energy[type] : 0 });
    }
    return result;
  }

  update(dt, { progression = null, manualInstanceId = null, position = null } = {}) {
    if (!finite(dt) || dt < 0) throw Error('장치 시간은 0 이상의 초여야 합니다.');
    for (const instance of this.dungeons.instances.values()) {
      if (!instance.puzzle || !instance.deviceState) continue;
      const id = instance.id, state = instance.deviceState, templateId = instance.templateId, rules = PUZZLE_RULES[templateId];
      const manual = manualInstanceId === id && this._inRange(id, position, null, 4), manualRemaining = { value: manual ? dt * 10 : 0 };
      let changed = false;
      if (templateId === 'root_manor' && !this._partInstalled(id, 'joint') && state.work.progressM > 0) {
        const old = state.work.progressM; state.work.progressM = Math.max(0, old - dt * 3); changed = state.work.progressM !== old;
      }
      if (templateId === 'root_manor' && state.work.active && this._partInstalled(id, 'joint')) {
        const direction = state.work.direction === 'down' ? -1 : 1, oldM = state.work.progressM, oldEU = state.work.progressEU;
        if (direction > 0) {
          const need = Math.min(dt * rules.liftRateEUPerS, Math.max(0, (rules.clearanceM - state.work.progressM) / rules.liftRateMPerEU));
          const eu = this._takePower(id, 'mechanical', need, manualRemaining);
          state.work.progressEU += eu; state.work.progressM = Math.min(rules.clearanceM, state.work.progressM + eu * rules.liftRateMPerEU);
          if (state.work.progressM >= rules.clearanceM - EPS) {state.work.progressM=rules.clearanceM;state.work.active=false;}
        } else {
          state.work.progressM = Math.max(0, state.work.progressM - dt);
        }
        changed ||= state.work.progressM !== oldM || state.work.progressEU !== oldEU;
      }
      if (templateId === 'mining_fort' && state.work.active && state.work.direction === 'rubble' && this._requirementsMet(id, 'shift_rubble')) {
        const maxEU = Math.min(dt * 10, Math.max(0, (rules.rubbleMoveM - state.work.progressM) / rules.rubbleRateMPerEU));
        const eu = this._takePower(id, 'mechanical', maxEU, manualRemaining);
        state.work.progressEU += eu; state.work.progressM = Math.min(rules.rubbleMoveM, state.work.progressM + eu * rules.rubbleRateMPerEU);
        changed = eu > 0;
      }
      if (templateId === 'floodworks' && state.fluid.running && this._requirementsMet(id, 'start_pump')) {
        const transfer = Math.min(dt * rules.pumpRateLPerS, state.fluid.sourceLiters);
        const needEU = transfer / rules.pumpRateLPerS * rules.pumpEUPerS;
        const eu = this._takePower(id, 'mechanical', needEU, manualRemaining);
        const moved = Math.min(transfer, eu / rules.pumpEUPerS * rules.pumpRateLPerS);
        state.fluid.sourceLiters -= moved; state.fluid.receiverLiters += moved; changed = moved > 0;
      }
      if (templateId === 'geothermal_foundry' && state.heat) {
        if (state.heat.valveOpen && state.heat.sourceEU > 0) {
          const added = Math.min(state.heat.sourceEU, dt * 10); state.heat.sourceEU -= added; state.heat.pathEU += added; changed ||= added > 0;
        }
        if (state.heat.pumpRunning && this._requirementsMet(id, 'start_cooling')) {
          const liters = Math.min(dt, state.heat.coolantLiters);
          const eu = this._takePower(id, 'mechanical', liters * rules.pumpEUPerS, manualRemaining);
          const moved = Math.min(liters, eu / rules.pumpEUPerS);
          const heat = Math.min(state.heat.pathEU, moved * rules.heatTransferEUPerLiter);
          state.heat.pathEU -= heat; state.heat.coolantHeatEU += heat; state.heat.coolantLiters -= moved; changed ||= moved > 0;
        }
      }
      if (templateId === 'sealed_arboretum' && state.fluid.running && this._requirementsMet(id, 'start_pump')) {
        const transfer = Math.min(dt * rules.pumpRateLPerS, state.fluid.sourceLiters);
        const eu = this._takePower(id, 'mechanical', transfer / rules.pumpRateLPerS * rules.pumpEUPerS, manualRemaining);
        const moved = Math.min(transfer, eu / rules.pumpEUPerS * rules.pumpRateLPerS);
        state.fluid.sourceLiters -= moved; state.fluid.receiverLiters += moved; changed = moved > 0;
      }
      if (templateId === 'forgotten_monastery' && state.altar) {
        if (state.altar.running && !state.altar.aligned) {
          const eu = this._takePower(id, 'mechanical', Math.min(dt * rules.alignmentEUPerS, (rules.targetAngleRad - state.altar.angleRad) * rules.alignmentEUPerS), manualRemaining);
          state.altar.angleRad = Math.min(rules.targetAngleRad, state.altar.angleRad + eu / rules.alignmentEUPerS);
          state.altar.aligned = state.altar.angleRad >= rules.targetAngleRad - EPS; changed ||= eu > 0;
        }
        if (state.altar.running && state.altar.aligned) {
          const use = Math.min(dt * rules.divineEUPerS, state.energy.divine, rules.divineRequiredEU - state.altar.divineConsumedEU);
          state.energy.divine -= use; state.altar.divineReceivedEU += use; state.altar.divineConsumedEU += use;
          state.metrics.consumedEU.divine += use; changed ||= use > 0;
        }
      }
      if (templateId === 'inertia_tower' && state.motion) {
        const m = state.motion, kineticFromSpeed = v => 0.5 * rules.massKg * v * v / 100;
        let poweredS = 0;
        if (m.braking && !m.locked) {
          const oldVelocity = m.velocityMps, speed = Math.abs(oldVelocity);
          const brakeDuration = speed > EPS ? Math.min(dt, speed / rules.decelerationMps2) : 0;
          const control = this._takePower(id, 'mechanical', brakeDuration * rules.brakeControlEUPerS, manualRemaining);
          poweredS = control / rules.brakeControlEUPerS;
          if (poweredS > 0) {
            const oldKinetic = kineticFromSpeed(oldVelocity);
            const sign = Math.sign(oldVelocity), nextSpeed = Math.max(0, speed - rules.decelerationMps2 * poweredS);
            m.velocityMps = sign * nextSpeed;
            const delta = Math.max(0, oldKinetic - kineticFromSpeed(nextSpeed));
            const room = Math.max(0, rules.cellCapacityEU - m.capturedEU), recovered = Math.min(delta, room);
            m.capturedEU += recovered; m.lostEU += delta - recovered; state.metrics.heatLostEU += delta - recovered;
            m.kineticEU = kineticFromSpeed(nextSpeed);
            const averageVelocity = (oldVelocity + m.velocityMps) / 2;
            m.positionM += averageVelocity * poweredS;
            changed = true;
          }
        }
        const oldPosition = m.positionM;
        const unpoweredS = m.locked ? 0 : Math.max(0, dt - poweredS);
        if (unpoweredS > 0) m.positionM += m.velocityMps * unpoweredS;
        if (m.positionM > rules.railMaxM) { const speed = Math.abs(m.velocityMps), before = kineticFromSpeed(speed); m.positionM = rules.railMaxM - (m.positionM - rules.railMaxM); m.velocityMps = -speed * 0.95; const lost = before - kineticFromSpeed(m.velocityMps); m.lostEU += lost; state.metrics.heatLostEU += lost; }
        if (m.positionM < rules.railMinM) { const speed = Math.abs(m.velocityMps), before = kineticFromSpeed(speed); m.positionM = rules.railMinM + (rules.railMinM - m.positionM); m.velocityMps = speed * 0.95; const lost = before - kineticFromSpeed(m.velocityMps); m.lostEU += lost; state.metrics.heatLostEU += lost; }
        if (Math.abs(m.positionM - oldPosition) > EPS) changed = true;
        m.kineticEU = kineticFromSpeed(m.velocityMps);
      }
      if (state.fluid?.leak && state.fluid.sourceLiters > 0) {
        const leak = Math.min(state.fluid.sourceLiters, dt);
        state.fluid.sourceLiters -= leak; state.fluid.spilledLiters += leak; state.metrics.spilledLiters += leak; changed ||= leak > 0;
      }
      if (changed) instance.revision++;
      this._refresh(id);
    }
  }

  damage(instanceId, partId, amount) {
    const state = this._state(instanceId), instance = this._instance(instanceId);
    if (!state || !finite(amount) || amount <= 0) return fail('invalid_damage');
    const anchor = this._anchors(instanceId).find(a => a.id === partId || a.componentId === partId), part = anchor && state.parts[anchor.id];
    if (part) { part.healthHp = Math.max(0, part.healthHp - amount); if (!part.healthHp) part.installed = false; instance.revision++; this._refresh(instanceId); return success({ partId: anchor.id, healthHp: part.healthHp, maxHealthHp: part.maxHealthHp, removed: part.healthHp === 0 }); }
    const structurePart = state.structureParts[partId];
    if (structurePart) {
      structurePart.healthHp = Math.max(0, structurePart.healthHp - amount);
      if (structurePart.healthHp === 0) structurePart.installed = false;
      if (partId === 'bridge_support' && state.bridge) { state.bridge.healthHp = structurePart.healthHp; state.bridge.installed = structurePart.installed; }
      if (partId === 'windvane' && state.wind && !structurePart.installed) { state.wind.vaneAttached = false; state.wind.locked = false; }
      if (partId === 'platform' && state.motion && !structurePart.installed) { state.motion.locked = false; state.motion.braking = false; }
      if (partId === 'mana_vine' && state.fluid && !structurePart.installed) state.fluid.leak = true;
      instance.revision++; this._refresh(instanceId);
      return success({ partId, healthHp: structurePart.healthHp, maxHealthHp: structurePart.maxHealthHp, removed: !structurePart.installed });
    }
    if (partId === 'pipe' && state.fluid) { state.fluid.leak = true; instance.revision++; return success({ partId, leak: true, healthHp: 0, removed: true }); }
    return fail('unknown_device_part');
  }
  breachEcologyBasin(instanceId) {
    const basin = this._state(instanceId)?.ecologyBasin;
    if (!basin || basin.breached) return false;
    basin.spilledLiters += basin.volumeLiters; this._state(instanceId).metrics.spilledLiters += basin.volumeLiters; basin.volumeLiters = 0; basin.breached = true;
    this._instance(instanceId).revision++; return true;
  }

  _windForce(wind, rules = PUZZLE_RULES.cliff_observatory) { return wind?.vaneAttached && wind?.locked ? rules.windN * (1 - 0.9 * Math.abs(Math.sin(wind.angleRad))) : rules.windN; }
  _energySummary(id, progression) {
    const state = this._state(id);
    return { reservedEU: copy(state.energy), reserveCapacityEU: Object.fromEntries(TYPES.map(type => [type, this._reserveCapacity(id, type)])), supplies: this._refreshSupplyLinks(id, progression), metrics: copy(state.metrics) };
  }
  status(id, { progression = null } = {}) {
    const instance = this._instance(id), state = this._state(id), template = this._template(id);
    if (!instance || !state || !template?.puzzle) return null;
    this._refresh(id);
    const rules = PUZZLE_RULES[instance.templateId], parts = this._anchors(id).map(a => ({ id: a.id, componentId: a.componentId, position: instance.origin.map((v, i) => v + a.positionM[i]), ...copy(state.parts[a.id]) }));
    const actions = this._anchors(id).flatMap(a => [
      { id: `install:${a.id}`, label: `장치 설치 · ${a.componentId}`, items: { [a.componentId]: 1 }, hold: false, disabled: !!state.parts[a.id].installed && state.parts[a.id].healthHp > 0, detail: a.componentId },
      { id: `replace:${a.id}`, label: `장치 교체 · ${a.componentId}`, items: { [a.componentId]: 1 }, hold: false, disabled: state.parts[a.id].healthHp >= state.parts[a.id].maxHealthHp, detail: a.componentId },
    ]);
    const addAction = (id, label, { items = {}, hold = false, disabled = false, detail = null } = {}) => actions.push({ id, label, items, hold, disabled, ...(detail ? { detail } : {}) });
    for (const [partId, structurePart] of Object.entries(state.structureParts)) if (STRUCTURE_PART_NAMES[partId] && structurePart.healthHp < structurePart.maxHealthHp) addAction(`restore:${partId}`, `${STRUCTURE_PART_NAMES[partId]} 복구`, { items: { ...STRUCTURE_RESTORE_COST } });
    const missing = rules.parts.filter(component => !this._partInstalled(id, component));
    const gateDisabled = missing.length > 0;
    switch (instance.templateId) {
      case 'root_manor': addAction('lift_gate', '운반문 들어 올리기', { hold: true, disabled: gateDisabled }); addAction('lower_gate', '운반문 내리기', { hold: true, disabled: !this._partInstalled(id, 'joint') }); break;
      case 'mining_fort': addAction('shift_rubble', '낙석 옆으로 밀기', { hold: true, disabled: gateDisabled }); addAction('repair_bridge', '운반교 지지 보수', { items: { wood: 2, stone: 2 }, disabled: gateDisabled || !!state.bridge?.installed }); break;
      case 'floodworks': addAction('start_pump', '산성 유체 수신조로 펌프', { hold: true, disabled: gateDisabled }); break;
      case 'geothermal_foundry': addAction('close_valve', '유한 열원 밸브 차단', { disabled: gateDisabled || !state.heat.valveOpen }); addAction('start_cooling', '냉각수 순환', { hold: true, disabled: gateDisabled || state.heat.valveOpen }); break;
      case 'cliff_observatory': addAction('set_vane', '풍향판 각도 설정', { disabled: gateDisabled, detail: { angleRad: Math.PI / 2 } }); addAction('lock_vane', '풍향판 고정', { disabled: gateDisabled }); break;
      case 'sealed_arboretum': addAction('route_mana', '마나 분기 수신조로 전환', { disabled: gateDisabled }); addAction('start_pump', '수관 액체 펌프', { hold: true, disabled: gateDisabled || state.fluid.route !== 'receiver' }); break;
      case 'forgotten_monastery': addAction('align_altar', '전달축으로 제단 정렬', { hold: true, disabled: gateDisabled }); addAction('start_trial', '신성 전달 시련 시작', { hold: false, disabled: gateDisabled || !state.altar.aligned }); break;
      case 'inertia_tower': addAction('engage_brake', '운반대 제동', { hold: true, disabled: gateDisabled }); addAction('lock_platform', '정렬 위치 잠금', { disabled: gateDisabled || Math.abs(state.motion.velocityMps) > 0.1 }); break;
    }
    const danger = {
      fluid: state.fluid && { type: state.fluid.type, sourceLiters: state.fluid.sourceLiters, receiverLiters: state.fluid.receiverLiters, spilledLiters: state.fluid.spilledLiters, conserved: Math.abs(state.fluid.initialLiters - state.fluid.sourceLiters - state.fluid.receiverLiters - state.fluid.spilledLiters) < 1e-5, route: state.fluid.route, running: state.fluid.running, leak: state.fluid.leak },
      heat: state.heat && { pathEU: state.heat.pathEU, coolantLiters: state.heat.coolantLiters, coolantHeatEU: state.heat.coolantHeatEU, sourceEU: state.heat.sourceEU, temperatureC: 20 + state.heat.pathEU / rules.heatCapacityEUPerC, valveOpen: state.heat.valveOpen, conserved: Math.abs(state.heat.initialTotalEU - state.heat.pathEU - state.heat.coolantHeatEU - state.heat.sourceEU - state.heat.lossEU) < 1e-5 },
      wind: state.wind && { angleRad: state.wind.angleRad, forceN: this._windForce(state.wind, rules), vaneAttached: state.wind.vaneAttached, locked: state.wind.locked },
      altar: state.altar && copy(state.altar),
      motion: state.motion && copy(state.motion),
      ecologyBasin: state.ecologyBasin && { ...copy(state.ecologyBasin), conserved: Math.abs(state.ecologyBasin.initialLiters - state.ecologyBasin.volumeLiters - state.ecologyBasin.spilledLiters) < 1e-5 },
    };
    const supplyList = this._refreshSupplyLinks(id, progression).map(link => ({ ...link, deviceEU: state.energy[link.type] }));
    const summary = state.solved ? '장치가 정상 상태로 해결되었습니다.' : instance.templateId === 'floodworks' ? `회로 유체 ${state.fluid.sourceLiters.toFixed(1)} L · 수신조 ${state.fluid.receiverLiters.toFixed(1)} L` : instance.templateId === 'geothermal_foundry' ? `통로 ${Math.round(20 + state.heat.pathEU / rules.heatCapacityEUPerC)}°C · 냉각수 ${state.heat.coolantLiters.toFixed(1)} L` : instance.templateId === 'inertia_tower' ? `운반대 ${state.motion.positionM.toFixed(2)} m · ${state.motion.velocityMps.toFixed(2)} m/s` : `${parts.filter(part => part.installed).length}/${parts.length}개 부품 설치`;
    return { instanceId: id, templateId: instance.templateId, phase: instance.puzzle.phase, solved: state.solved, summary, actions, parts, work: copy(state.work), supplies: supplyList, energy: this._energySummary(id, progression), ...danger };
  }

  _worldBox(instance, center, size, fields = {}) {
    const partId = fields.partId ?? 'device', material = fields.materialId ?? fields.material ?? 'dungeon_device', color = fields.color ?? '#8A8A8A';
    const shape=primitiveShape(`${partId}:${material}`, material, color),source=shape.asset.parts[0].boxes[0];
    // Instance scale and translation of the actual SDK-authored cell. The unit
    // cell's centre is its pivot; source geometry and material stay immutable.
    const worldCenter=source.center.map((v,i)=>(v/GRID_M-.5)*size[i]+center[i]+instance.origin[i]);
    const worldSize=source.size.map((v,i)=>v/GRID_M*size[i]);
    const health = instance.deviceState.structureParts?.[partId];
    return { ...source, center:worldCenter, size:worldSize, ownerId: instance.id, partId, material, materialId: material,
      role: 'dungeon_device', devicePart: true, color, opacity: 1, healthHp: health?.healthHp ?? 100, maxHealthHp: health?.maxHealthHp ?? 100, ...fields };
  }
  geometry(id) {
    const instance = this._instance(id), state = this._state(id), template = this._template(id);
    if (!instance || !state || !template?.puzzle) return [];
    const cached = this.geometryCache.get(instance);
    if (cached?.revision === instance.revision) return cached.boxes;
    const gate = template.puzzle.physicalGate;
    const result = [];
    if (state.structureParts.puzzle_gate?.installed) {
      let centerY = gate.positionM[1] + gate.boundsM[1] / 2;
      if (instance.templateId === 'root_manor') centerY += state.work.progressM;
      else if (state.solved) centerY += PUZZLE_RULES.root_manor.clearanceM;
      result.push(this._worldBox(instance, [gate.positionM[0], centerY, gate.positionM[2]], gate.boundsM, { material: 'puzzle_gate', color: '#A88350', partId: 'puzzle_gate', blockId: template.blockAssignments.wall, collision: true }));
    }
    if (instance.templateId === 'mining_fort') {
      if (state.structureParts.rubble?.installed) result.push(this._worldBox(instance, [33, 0.6, state.work.progressM], [1.4, 1.2, 1.4], { material: 'rubble', color: '#706457', partId: 'rubble', blockId: template.blockAssignments.wall, collision: true }));
      if (state.bridge?.installed && state.bridge.healthHp > 0 && state.structureParts.bridge_support?.installed) result.push(this._worldBox(instance, [26, 0.2, -1], [6, 0.3, 2], { material: 'bridge', color: '#795936', partId: 'bridge_support', collision: true }));
    }
    if (instance.templateId === 'floodworks' && state.fluid) {
      const depth = state.fluid.sourceLiters / (1000 * PUZZLE_RULES.floodworks.poolAreaM2);
      if (depth > EPS) result.push(this._worldBox(instance, [35, depth / 2, 0], [4, depth, 1], { material: state.fluid.type, color: '#77A5BD', partId: 'fluid_surface', collision: false, liquidType: state.fluid.type, depthM: depth }));
      result.push(this._worldBox(instance, [21, 0.6, -4], [1.5, 1.2, 1.5], { material: 'pump', color: '#7C756A', partId: 'pump', collision: false }));
    }
    if (instance.templateId === 'geothermal_foundry' && state.heat?.pathEU > 0) result.push(this._worldBox(instance, [34, 0.04, 0], [6, 0.08, 3], { material: 'hot_flow', color: '#E87932', partId: 'thermal_hazard', collision: false, temperatureC: 20 + state.heat.pathEU / PUZZLE_RULES.geothermal_foundry.heatCapacityEUPerC }));
    if (instance.templateId === 'cliff_observatory' && state.wind?.vaneAttached && state.structureParts.windvane?.installed) {
      const asset = rotatingSegmentAsset('windvane', state.wind.angleRad, 'wind_vane', '#A78855');
      for (const part of asset.parts.filter(p => p.id !== 'root')) for (const box of part.boxes) {
        result.push(this._worldBox(instance, [27 + box.center[0], 2 + box.center[1], -4 + box.center[2]], box.size, { material: 'wind_vane', color: '#A78855', partId: 'windvane', collision: true, angleRad: state.wind.angleRad }));
      }
    }
    if (instance.templateId === 'sealed_arboretum' && state.fluid) {
      const scale = state.fluid.sourceLiters / Math.max(1, state.fluid.initialLiters);
      const depth = state.fluid.sourceLiters / (1000 * PUZZLE_RULES.sealed_arboretum.pipeAreaM2);
      if (state.fluid.sourceLiters > EPS && state.structureParts.mana_vine?.installed) {
        result.push(this._worldBox(instance, [34, 1.3, 0], [5 * scale, 2.6 * scale, 1.4], { material: 'mana_vine', color: '#4D7549', partId: 'mana_vine', collision: true, volumeL: state.fluid.sourceLiters }));
      }
      if (state.fluid.sourceLiters > EPS) {
        result.push(this._worldBox(instance, [34, 0.9 + depth / 2, -1.1], [6, depth, 0.04], { material: 'liquid_mana', color: '#55CDB3', partId: 'mana_circuit', collision: false, liquidType: state.fluid.type, depthM: depth, volumeL: state.fluid.sourceLiters }));
      }
      result.push(this._worldBox(instance, [27, 1, -4], [1.5, 1.5, 1.5], { material: 'mana_receiver', color: '#55CDB3', partId: 'receiver', collision: false }));
    }
    if (instance.templateId === 'forgotten_monastery' && state.altar && state.structureParts.altar?.installed) {
      result.push(this._worldBox(instance, [25, 0.375, 0], [1.5, 0.75, 1.5], { material: 'altar_stone', color: '#817C6B', partId: 'altar', collision: true }));
      const asset = rotatingSegmentAsset('altar_surface', state.altar.angleRad, state.altar.aligned ? 'aligned_altar' : 'altar', state.altar.aligned ? '#C3B77F' : '#A9A68F');
      for (const part of asset.parts.filter(p => p.id !== 'root')) for (const box of part.boxes) {
        result.push(this._worldBox(instance, [25 + box.center[0], 0.875 + box.center[1], box.center[2]], box.size, { material: state.altar.aligned ? 'aligned_altar' : 'altar', color: state.altar.aligned ? '#C3B77F' : '#A9A68F', partId: 'altar', collision: true, angleRad: state.altar.angleRad }));
      }
    }
    if (instance.templateId === 'inertia_tower' && state.motion && state.structureParts.platform?.installed) result.push(this._worldBox(instance, [30 + state.motion.positionM, 0.35, 0], [3, 0.35, 2], { material: 'inertia_platform', color: '#687C82', partId: 'platform', collision: true, velocityMps: state.motion.locked ? 0 : state.motion.velocityMps, topY: 0.525 }));
    this.geometryCache.set(instance, { revision: instance.revision, boxes: result });
    return result;
  }

  sampleAt(position) {
    const p = point(position); if (!validPoint(p)) return null;
    const result = { fluidType: null, fluidDepthM: 0, temperatureC: null, windForceN: 0, platformVelocityMps: null, windVelocity: { x: 0, y: 0, z: 0 }, platformVelocity: { x: 0, y: 0, z: 0 }, hazards: [] };
    let found = false, windAngleRad = 0;
    for (const instance of this.dungeons.instancesNear(p, 2)) {
      const state = instance.deviceState, template = this._template(instance.id); if (!state) continue;
      const local = p.map((v, i) => v - instance.origin[i]);
      const basin = template.ecology?.water;
      if (basin && state.ecologyBasin && state.ecologyBasin.volumeLiters > 0 && !state.ecologyBasin.breached) {
        const c = basin.basinCenterM, s = basin.basinSizeM;
        if (local[0] >= c[0] - s[0] / 2 && local[0] < c[0] + s[0] / 2 && local[2] >= c[2] - s[2] / 2 && local[2] < c[2] + s[2] / 2 && local[1] >= c[1] && local[1] < c[1] + s[1]) {
          result.fluidType = basin.liquid; result.fluidDepthM = Math.min(s[1], state.ecologyBasin.volumeLiters / basin.volumeL * s[1]); result.hazards.push('ecology_water'); found = true;
        }
      }
      if (instance.templateId === 'floodworks' && state.fluid) {
        const depth = state.fluid.sourceLiters / (1000 * PUZZLE_RULES.floodworks.poolAreaM2);
        if (local[0] >= 33 && local[0] <= 37 && Math.abs(local[2]) <= 0.5 && local[1] >= 0 && local[1] <= depth) {
          result.fluidType = state.fluid.type; result.fluidDepthM = depth; if (depth > PUZZLE_RULES.floodworks.safeDepthM) result.hazards.push(state.fluid.type); found = true;
        }
      }
      if (instance.templateId === 'geothermal_foundry' && state.heat && state.heat.pathEU > 0 && local[0] >= 31 && local[0] <= 37 && Math.abs(local[2]) <= 1.5 && local[1] >= -0.2 && local[1] <= 1.5) {
        result.temperatureC = 20 + state.heat.pathEU / PUZZLE_RULES.geothermal_foundry.heatCapacityEUPerC; if (result.temperatureC > 45) result.hazards.push('heat'); found = true;
      }
      if (instance.templateId === 'cliff_observatory' && local[0] >= 30 && local[0] <= 39 && Math.abs(local[2]) <= 3 && local[1] >= -1 && local[1] <= 6) {
        result.windForceN = this._windForce(state.wind); windAngleRad = state.wind.angleRad; if (result.windForceN > PUZZLE_RULES.cliff_observatory.safeWindN) result.hazards.push('crosswind'); found = true;
      }
      if (instance.templateId === 'sealed_arboretum' && state.fluid) {
        const depth = state.fluid.sourceLiters / (1000 * PUZZLE_RULES.sealed_arboretum.pipeAreaM2);
        if (local[0] >= 31 && local[0] <= 37 && Math.abs(local[2] + 1.1) <= 0.02 && local[1] >= 0.9 && local[1] <= 0.9 + depth) {
          result.fluidType = state.fluid.type; result.fluidDepthM = depth; if (state.fluid.sourceLiters > PUZZLE_RULES.sealed_arboretum.safeLiters) result.hazards.push('mana_pressure'); found = true;
        }
      }
      if (instance.templateId === 'inertia_tower' && state.motion && state.structureParts.platform?.installed && Math.abs(local[0] - (30 + state.motion.positionM)) <= 1.5 && Math.abs(local[2]) <= 1 && Math.abs(local[1] - 0.525) <= 0.25) { result.platformVelocityMps = state.motion.locked ? 0 : state.motion.velocityMps; if (Math.abs(result.platformVelocityMps) > 0.1) result.hazards.push('moving_platform'); found = true; }
    }
    if (!found) return null;
    if (result.windForceN) {
      const speed = result.windForceN / 15;
      result.windVelocity = { x: speed * Math.cos(windAngleRad), y: 0, z: speed * Math.sin(windAngleRad) };
    }
    if (result.platformVelocityMps != null) result.platformVelocity = { x: result.platformVelocityMps, y: 0, z: 0 };
    return { ...result, depthM: result.fluidDepthM, heatC: result.temperatureC, acidDps: result.fluidType === 'acid_fluid' && result.fluidDepthM > 0.05 ? 6 : 0, safe: result.hazards.length === 0 };
  }

  serializeState(instanceId) { return this._state(instanceId) ? copy(this._state(instanceId)) : null; }
}

export { PUZZLE_RULES };
