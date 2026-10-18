import * as T from '../vendor/three.module.js';
import { bossLogicalPart } from './boss-animation.js';

// Initial gameplay tuning, not material-science constants. Authored per-material
// penetrationResistanceEUPerM overrides this conservative prototype fallback.
export const COMBAT_TRACE_RULES = Object.freeze({ pierceDepthM: 1.2, impactDepthM: .6,
  softResistanceEUPerM: 24, woodResistanceEUPerM: 60, mineralResistanceEUPerM: 120, metalResistanceEUPerM: 180,
  impactTransmission: .65 });
const vec = (p) => new T.Vector3(...(Array.isArray(p) ? p : [p.x, p.y, p.z]));
function resistance(material) {
  const explicit = material?.penetrationResistanceEUPerM;
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const id = material?.id ?? '';
  if (/metal|steel|iron|alloy|titan|nickel|silver|bronze|copper/.test(id)) return 180;
  if (/stone|rock|crystal|ceramic|bone|carapace|shell/.test(id)) return 120;
  if (/wood|bark|root|timber/.test(id)) return 60;
  return 24;
}
/** Entry and exit fractions of segment a→b through an axis-aligned box, or null. */
export function segmentInterval(a, b, center, size) {
  let enter = 0, exit = 1;
  for (const [i, k] of ['x', 'y', 'z'].entries()) {
    const d = b[k] - a[k], lo = center[i] - size[i] / 2, hi = center[i] + size[i] / 2;
    if (Math.abs(d) < 1e-10) { if (a[k] < lo || a[k] > hi) return null; continue; }
    const t0 = (lo - a[k]) / d, t1 = (hi - a[k]) / d;
    enter = Math.max(enter, Math.min(t0, t1)); exit = Math.min(exit, Math.max(t0, t1));
    if (exit <= enter + 1e-9) return null;
  }
  return [enter, exit];
}
/** Trace actual visible articulated cuboids. No combat state is changed. An
 * externalStop callback returns the first blocking external owner's distance.
 * The one HP budget is effectiveAmount; hits are allocations of that SAME
 * budget for structural effects and must never be applied as extra HP damage. */
export function traceCombatModel(record, { from, to, ownerId, mode = 'strike', energyEU, amount }, externalStop = () => Infinity) {
  if (!['strike', 'pierce', 'impact'].includes(mode)) throw new RangeError('Unknown attack mode');
  if (![energyEU, amount].every(n => Number.isFinite(n) && n >= 0)) throw new RangeError('Finite nonnegative attack budget required');
  const start = vec(from), end = vec(to), length = start.distanceTo(end);
  if (![...start, ...end].every(Number.isFinite)) throw new TypeError('Invalid combat ray');
  const result = { ownerId, attackMode: mode, effectiveAmount: 0, hits: [], structuralHits: [], spentEU: 0, remainingEU: energyEU, blocked: false };
  if (!record || length < 1e-8 || amount === 0 || energyEU === 0) return result;
  record.group.updateMatrixWorld(true);
  const ranges = [];
  for (const part of record.asset.parts) {
    const node = record.parts.get(part.id); if (!node) continue;
    let visible = true; for (let n = node; n; n = n.parent) if (!n.visible) visible = false;
    if (!visible) continue;
    const inv = node.matrixWorld.clone().invert(), a = start.clone().applyMatrix4(inv), b = end.clone().applyMatrix4(inv);
    for (const box of part.boxes) {
      const material = record.asset.materials.find(m => m.id === box.material);
      if (box.collision === false || material?.collision === false || part.role === 'static_fluid_visual') continue;
      const range = segmentInterval(a, b, box.center, box.size); if (!range) continue;
      ranges.push({ enter: range[0] * length, exit: range[1] * length, visualPartId: part.id,
        partId: record.desc?.kind === 'boss' ? bossLogicalPart(record.asset, part.id) : part.id,
        resistance: resistance(material), materialId: material?.id, volume: box.size.reduce((v,n)=>v*n,1) });
    }
  }
  ranges.sort((a,b)=>a.enter-b.enter || a.volume-b.volume);
  if (!ranges.length) return result;
  const first = ranges[0], stop = externalStop(start, end);
  if (stop < first.enter - 1e-4) { result.blocked = true; return result; }
  const limit = Math.min(length, stop, first.enter + (mode === 'strike' ? 0 : COMBAT_TRACE_RULES[mode + 'DepthM']));
  const allocations = new Map();
  const deposit = (r, eu, depth) => { if (eu <= 1e-10) return; const key = r.visualPartId;
    let hit = allocations.get(key); if (!hit) { hit = { partId: r.partId, visualPartId: key, amount: 0, energyEU: 0, depthM: depth, materialId: r.materialId }; allocations.set(key,hit); }
    hit.energyEU += eu; hit.amount += amount * eu / energyEU; result.remainingEU -= eu;
  };
  if (mode === 'strike') deposit(first, energyEU, 0);
  else {
    // Split at every surface and use the smallest enclosing solid in overlaps;
    // nested organs remain real geometry, without double-charging overlapping
    // authoring boxes or inventing bones where the model contains none.
    const cuts = [...new Set([first.enter, limit, ...ranges.flatMap(r=>[r.enter,r.exit]).filter(t=>t>first.enter&&t<limit)])].sort((a,b)=>a-b);
    let deepest = first;
    for (let i=0; i<cuts.length-1 && result.remainingEU>1e-8; i++) {
      const lo=cuts[i],hi=cuts[i+1],mid=(lo+hi)/2;
      const r=ranges.filter(r=>r.enter<=mid&&r.exit>=mid).sort((a,b)=>a.volume-b.volume || b.enter-a.enter)[0];
      if (!r) continue;
      deepest=r;
      const cost=Math.min(result.remainingEU,(hi-lo)*r.resistance);
      deposit(r,cost,lo-first.enter);
    }
    if (mode === 'impact') {
      // Distributed impulse reaches the deepest intersected region but loses
      // structural effectiveness with material depth. HP still uses one budget.
      const transmitted=result.remainingEU*COMBAT_TRACE_RULES.impactTransmission;
      deposit(deepest,transmitted,Math.max(0,Math.min(deepest.enter,limit)-first.enter));
      deposit(first,result.remainingEU,0);
    } else deposit(deepest,result.remainingEU,Math.max(0,Math.min(deepest.enter,limit)-first.enter));
  }
  result.hits=[...allocations.values()]; result.structuralHits=result.hits;
  result.effectiveAmount=amount; result.remainingEU=Math.max(0,result.remainingEU); result.spentEU=energyEU-result.remainingEU;
  return result;
}
