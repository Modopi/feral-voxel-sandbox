import R from '../vendor/rapier/rapier.js';
import * as T from '../vendor/three.module.js';
import { AssetCollisionWorld } from './voxel/physics.js';
import { SECTION_CELLS } from './atlas.js';
import { MachinePhysicsBridge } from './machine-physics.js';
import { ObjectPhysicsBridge } from './object-physics.js';
import { FixturePhysicsBridge } from './fixture-physics.js';
import { traceCombatModel, segmentInterval } from './combat-trace.js';
import { creatureBodyPart, creatureBones } from './creature-animation.js';
import { impactEnergy } from '../impact.js';
const IDENTITY = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

let initialization;
const initialize = () => initialization ??= R.init();
const xyz = (v) => Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : { x: v.x, y: v.y, z: v.z };
const array = (v) => [v.x, v.y, v.z];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const identity = { x: 0, y: 0, z: 0, w: 1 };
// Quaternion helpers without allocation in per-step loops (out is a 3-array).
const rotate = (q, x, y, z, out) => {
  const ix = q.w * x + q.y * z - q.z * y, iy = q.w * y + q.z * x - q.x * z, iz = q.w * z + q.x * y - q.y * x, iw = -q.x * x - q.y * y - q.z * z;
  out[0] = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y; out[1] = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z; out[2] = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
};
// World half extents of a box with half sizes x, y, z rotated by q.
const rotatedExtents = (q, x, y, z, out) => {
  const xx = q.x * q.x, yy = q.y * q.y, zz = q.z * q.z, xy = q.x * q.y, xz = q.x * q.z, yz = q.y * q.z, wx = q.w * q.x, wy = q.w * q.y, wz = q.w * q.z;
  out[0] = Math.abs(1 - 2 * (yy + zz)) * x + Math.abs(2 * (xy - wz)) * y + Math.abs(2 * (xz + wy)) * z;
  out[1] = Math.abs(2 * (xy + wz)) * x + Math.abs(1 - 2 * (xx + zz)) * y + Math.abs(2 * (yz - wx)) * z;
  out[2] = Math.abs(2 * (xz - wy)) * x + Math.abs(2 * (yz + wx)) * y + Math.abs(1 - 2 * (xx + yy)) * z;
};
const multiply = (a, b) => ({ x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z });
const visible = (node) => { for (let n = node; n; n = n.parent) if (n.visible === false) return false; return true; };
const solid = (box, material, role) => box.collision !== false && material?.collision !== false
  && material?.id !== 'visual_water' && role !== 'static_fluid_visual';
const intersects = (b, bounds) => b.center.every((v, i) => v + b.size[i] / 2 >= bounds.min[i] && v - b.size[i] / 2 <= bounds.max[i]);

/** Actual Rapier world for expedition terrain, buildings and articulated assets.
 * Await .ready (or use static create) before calling simulation methods.
 * The World is separate from the old game mode and is disposed with this bridge.
 */
export class RuntimePhysics {
  static async create(runtime, scene = null, options = {}) {
    const value = new RuntimePhysics(runtime, scene, options); await value.ready; return value;
  }
  constructor(runtime, scene = null, options = {}) {
    this.runtime = runtime; this.scene = scene;
    this.radius = options.radius ?? 12; this.terrainRadius = options.terrainRadius ?? 7;
    this.terrainBelow = options.terrainBelow ?? 3; this.terrainAbove = options.terrainAbove ?? 4;
    this.parts = new Map(); this.structures = new Map(); this.bossEffects = new Map(); this.fixtures = new Map(); this.terrainSections = new Map(); this.terrainRanges = []; this.terrainPrevious = []; this.terrainRangeCount = 0; this.terrainRevision = null; this.terrainVersion = 0; this.terrainScratch = new Uint8Array(SECTION_CELLS ** 3); this.terrainScratchVector = [0, 0, 0]; this.entryBounds = new WeakMap(); this.partShapes = new WeakMap(); this.modelBoxCache = new WeakMap(); this.fixtureBoxRefs = new Map();
    this.disposed = false; this.initialized = false; this.lastPlayer = null;
    this.impactClock = 0; this.impactCooldown = new Map(); this.impactLast = null;
    this.ready = initialize().then(() => {
      if (this.disposed) return;
      this.world = new R.World({ x: 0, y: -9.81, z: 0 });
      this.adapter = new AssetCollisionWorld(R, this.world);
      this.character = this.world.createCharacterController(.008);
      this.character.enableAutostep(.51, .15, false);
      this.character.enableSnapToGround(.06);
      this.character.setApplyImpulsesToDynamicBodies(true);
      this.characterCollider = this.world.createCollider(R.ColliderDesc.capsule(.6, .28).setSensor(true));
      this.machinePhysics = new MachinePhysicsBridge(this, R); this.objectPhysics = new ObjectPhysicsBridge(this); this.fixturePhysics = new FixturePhysicsBridge(this);
      this.initialized = true;
    });
  }
  assertReady() {
    if (this.disposed) throw new Error('RuntimePhysics disposed');
    if (!this.initialized) throw new Error('Await RuntimePhysics.ready before use');
  }

  /** Terrain colliders are cached per atlas section (SECTION_CELLS, 4 m). The
   * wanted set is the player's box plus a margin around every moving cuboid. A
   * section is built when it enters that set and rebuilt only when the atlas
   * reports a solid-cell change inside it, so a resting or jittering object, or
   * mining elsewhere, costs no collider work. Atlases without section revisions
   * fall back to their global revision. Returns true when colliders changed. */
  terrainAt(player, force = false) {
    const p = xyz(player), atlas = this.runtime.atlas;
    if (!atlas?.isSolidCell) return false;
    const r = this.terrainRadius + 1, ranges = this.terrainRanges;
    let n = this._sectionRange(ranges, 0, p.x - r, p.y - this.terrainBelow, p.z - r, p.x + r, p.y + this.terrainAbove, p.z + r);
    // Sparse neighbourhoods around actual moving bodies keep distant aircraft,
    // separated fragments and long assemblies in contact with local terrain.
    // Each body's own world AABB is used, never the empty space between bodies.
    const e = this.terrainScratchVector;
    for (const bridge of [this.machinePhysics, this.objectPhysics, this.fixturePhysics]) for (const { entry } of bridge?.bodies.values() ?? []) {
      const bounds = this.bodyBounds(entry); if (!bounds) continue;
      const t = entry.body.translation(), q = entry.body.rotation(), v = entry.body.linvel(), margin = 1.5 + Math.min(5, Math.hypot(v.x, v.y, v.z) * .1);
      rotate(q, bounds.center[0], bounds.center[1], bounds.center[2], e); const cx = t.x + e[0], cy = t.y + e[1], cz = t.z + e[2];
      rotatedExtents(q, bounds.half[0], bounds.half[1], bounds.half[2], e);
      n = this._sectionRange(ranges, n, cx - e[0] - margin, cy - e[1] - margin, cz - e[2] - margin, cx + e[0] + margin, cy + e[1] + margin, cz + e[2] + margin);
    }
    const revision = atlas.revision ?? 0;
    let same = !force && revision === this.terrainRevision && n === this.terrainRangeCount;
    for (let i = 0; same && i < n; i++) same = ranges[i] === this.terrainPrevious[i];
    if (same) return false;
    this.terrainRevision = revision; this.terrainRangeCount = n;
    for (let i = 0; i < n; i++) this.terrainPrevious[i] = ranges[i];
    const wanted = new Map();
    for (let i = 0; i < n; i += 6) for (let sy = ranges[i + 1]; sy <= ranges[i + 4]; sy++) for (let sz = ranges[i + 2]; sz <= ranges[i + 5]; sz++)
      for (let sx = ranges[i]; sx <= ranges[i + 3]; sx++) { const key = `${sx},${sy},${sz}`; if (!wanted.has(key)) wanted.set(key, [sx, sy, sz]); }
    let changed = false;
    for (const [key, section] of this.terrainSections) if (!wanted.has(key)) { this.removeEntry(section.entry); this.terrainSections.delete(key); changed = true; }
    for (const [key, [sx, sy, sz]] of wanted) {
      const sectionRevision = atlas.terrainSectionRevision ? atlas.terrainSectionRevision(sx, sy, sz) : revision, old = this.terrainSections.get(key);
      if (!force && old && old.revision === sectionRevision) continue;
      if (old) this.removeEntry(old.entry);
      const boxes = this._terrainSectionBoxes(atlas, sx, sy, sz);
      this.terrainSections.set(key, { revision: sectionRevision, entry: boxes.length ? this.adapter.addBody({ ownerId: '@terrain', partId: key, type: 'fixed', boxes }) : null });
      changed = true;
    }
    if (changed) this.terrainVersion++;
    return changed;
  }
  /** Body-space bounds of an entry's cuboid colliders, measured once from their
   * poses (colliders never move within their body). */
  bodyBounds(entry) {
    if (this.entryBounds.has(entry)) return this.entryBounds.get(entry);
    let bounds = null;
    if (entry.colliders.length) {
      const t = entry.body.translation(), q0 = entry.body.rotation(), inverse = { x: -q0.x, y: -q0.y, z: -q0.z, w: q0.w }, e = [0, 0, 0], p = [0, 0, 0];
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const collider of entry.colliders) {
        const c = collider.translation(), cq = collider.rotation(), h = collider.shape.halfExtents;
        rotate(inverse, c.x - t.x, c.y - t.y, c.z - t.z, p);
        rotatedExtents(multiply(inverse, cq), h.x, h.y, h.z, e);
        for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i] - e[i]); max[i] = Math.max(max[i], p[i] + e[i]); }
      }
      bounds = { center: min.map((v, i) => (v + max[i]) / 2), half: min.map((v, i) => (max[i] - v) / 2) };
    }
    this.entryBounds.set(entry, bounds); return bounds;
  }
  /** Writes the inclusive section index range of a metre AABB at ranges[n..n+5]. */
  _sectionRange(ranges, n, x0, y0, z0, x1, y1, z1) {
    const m = SECTION_CELLS * .5;
    ranges[n] = Math.floor(x0 / m); ranges[n + 1] = Math.floor(y0 / m); ranges[n + 2] = Math.floor(z0 / m);
    ranges[n + 3] = Math.floor(x1 / m); ranges[n + 4] = Math.floor(y1 / m); ranges[n + 5] = Math.floor(z1 / m);
    return n + 6;
  }
  /** Exact union of the section's solid 0.5 m cells as greedy cuboids: runs grow
   * along x, then z, then y. Holes, caves, mining edits and fluid (non-collision)
   * cells stay empty; a fully solid section becomes one box. */
  _terrainSectionBoxes(atlas, sx, sy, sz) {
    const S = SECTION_CELLS, solid = this.terrainScratch, x0 = sx * S, y0 = sy * S, z0 = sz * S, boxes = [];
    let any = 0;
    for (let y = 0, i = 0; y < S; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++, i++) any |= solid[i] = atlas.isSolidCell(x0 + x, y0 + y, z0 + z) ? 1 : 0;
    if (!any) return boxes;
    for (let y = 0; y < S; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
      const i = x + z * S + y * S * S; if (!solid[i]) continue;
      let w = 1, d = 1, h = 1;
      while (x + w < S && solid[i + w]) w++;
      depth: while (z + d < S) { for (let k = 0; k < w; k++) if (!solid[i + k + d * S]) break depth; d++; }
      height: while (y + h < S) { for (let c = 0; c < d; c++) for (let k = 0; k < w; k++) if (!solid[i + k + c * S + h * S * S]) break height; h++; }
      for (let a = 0; a < h; a++) for (let c = 0; c < d; c++) for (let k = 0; k < w; k++) solid[i + k + c * S + a * S * S] = 0;
      boxes.push({ center: [(x0 + x + w / 2) * .5, (y0 + y + h / 2) * .5, (z0 + z + d / 2) * .5], size: [w * .5, h * .5, d * .5] });
    }
    return boxes;
  }

  syncStructures(models, player) {
    const p = xyz(player), r = this.radius;
    const bounds = { min: [p.x - r, p.y - 5, p.z - r], max: [p.x + r, p.y + 8, p.z + r] };
    for (const { entry } of [...this.machinePhysics.bodies.values(), ...this.objectPhysics.bodies.values(), ...this.fixturePhysics.bodies.values()]) {
      for (const collider of entry.colliders) {
        const center = collider.translation(), h = collider.shape.halfExtents, reach = Math.hypot(h.x, h.y, h.z) + 2;
        ['x', 'y', 'z'].forEach((k, i) => { bounds.min[i] = Math.min(bounds.min[i], center[k] - reach); bounds.max[i] = Math.max(bounds.max[i], center[k] + reach); });
      }
    }
    const scope = [...bounds.min, ...bounds.max].map((n) => Math.floor(n / 2)).join(',');
    const wanted = new Map();
    for (const [id, model] of models) if (model.desc?.kind === 'structure') wanted.set(id, model);
    for (const instance of this.runtime.nearbyStructures ?? []) wanted.set(instance.id, wanted.get(instance.id));
    const alive = new Set();
    for (const [id, model] of wanted) {
      const inst = this.runtime.dungeons?.get?.(id);
      const revision = inst?.revision ?? 0;
      const key = `${revision}:${scope}`;
      alive.add(id);
      if (this.structures.get(id)?.key === key) continue;
      let boxes;
      if (this.runtime.dungeons?.renderBoxes) boxes = this.runtime.dungeons.renderBoxes(id, { bounds }).filter((b) => b.collision !== false && b.materialId !== 'visual_water' && b.role !== 'static_fluid_visual');
      else boxes = this.structureModelBoxes(model, bounds);
      const previous=this.structures.get(id),staticBoxes=boxes.filter(b=>!b.devicePart&&b.role!=='dungeon_device');
      const staticSignature=JSON.stringify(staticBoxes),devices=previous?.devices??new Map();let entry=previous?.entry??null;
      if(previous?.staticSignature!==staticSignature){this.removeEntry(entry);entry=staticBoxes.length?this.adapter.addBody({ownerId:id,type:'fixed',boxes:staticBoxes}):null;}
      const wantedDevices=new Set();
      for(const [index,box]of boxes.entries())if(box.devicePart||box.role==='dungeon_device'){
        const partId=`${box.partId??'device'}:${index}`,signature=JSON.stringify(box);wantedDevices.add(partId);const old=devices.get(partId);if(old?.signature===signature)continue;
        this.removeEntry(old?.entry);devices.set(partId,{signature,entry:this.adapter.addBody({ownerId:id,partId,type:'fixed',boxes:[box]})});
      }
      for(const [partId,cached]of devices)if(!wantedDevices.has(partId)){this.removeEntry(cached.entry);devices.delete(partId);}
      this.structures.set(id, { key, entry, staticSignature, devices });
    }
    for (const id of this.structures.keys()) if (!alive.has(id)) { this.adapter.removeOwner(id); this.structures.delete(id); }
  }

  syncFixtures(models) {
    const groups = new Map();
    const placementRevision = this.runtime.placements?.revision;
    if (!this.placementBoxes || placementRevision === undefined || placementRevision !== this.placementBoxRevision) {
      this.placementBoxes = this.runtime.placements?.collisionBoxes(null, { fixedOnly: true }) ?? [];
      this.placementBoxRevision = placementRevision;
    }
    for (const box of this.placementBoxes) {
      if (this.runtime.placements?.isDynamic?.(box.ownerId)) continue;
      if (!groups.has(box.ownerId)) groups.set(box.ownerId, []); groups.get(box.ownerId).push(box);
    }
    for (const [id, model] of models) {
      if (!['fixture', 'resource'].includes(model.desc?.kind) || groups.has(id) || this.runtime.placements?.isDynamic?.(id)) continue;
      const bounds = { min: [-Infinity, -Infinity, -Infinity], max: [Infinity, Infinity, Infinity] };
      groups.set(id, this.structureModelBoxes(model, bounds));
    }
    for (const [id, boxes] of groups) {
      const previous = this.fixtureBoxRefs.get(id);
      if (previous === boxes || previous?.length === boxes.length && boxes.every((b,i)=>b === previous[i])) continue;
      this.fixtureBoxRefs.set(id, boxes);
      const signature = JSON.stringify(boxes); if (this.fixtures.get(id) === signature) continue;
      this.adapter.removeOwner(id);
      if (boxes.length) this.adapter.addBody({ ownerId: id, type: 'fixed', boxes });
      this.fixtures.set(id, signature);
    }
    for (const id of this.fixtures.keys()) if (!groups.has(id)) { if (!this.fixturePhysics.bodies.has(id)) this.adapter.removeOwner(id); this.fixtures.delete(id); this.fixtureBoxRefs.delete(id); }
  }

  syncBossEffects() {
    const alive = new Set();
    for (const effect of this.runtime.bosses?.getWorldEffects() ?? []) {
      if (effect.type !== 'solid') continue;
      const ownerId = `@boss-effect:${effect.bossId}:${effect.gimmickId}`;
      const key = JSON.stringify([effect.min, effect.max]); alive.add(ownerId);
      if (this.bossEffects.get(ownerId) === key) continue;
      this.adapter.removeOwner(ownerId);
      const axes = ['x', 'y', 'z'];
      this.adapter.addBody({ ownerId, type: 'fixed', boxes: [{
        center: axes.map((k) => (effect.min[k] + effect.max[k]) / 2),
        size: axes.map((k) => effect.max[k] - effect.min[k]),
      }] });
      this.bossEffects.set(ownerId, key);
    }
    for (const id of this.bossEffects.keys()) if (!alive.has(id)) { this.adapter.removeOwner(id); this.bossEffects.delete(id); }
  }

  structureModelBoxes(model, bounds) {
    if (!model) return [];
    model.group.updateMatrixWorld(true);
    const matrices = model.asset.parts.map(part => { const node=model.parts.get(part.id);
      return node ? [visible(node), ...node.matrixWorld.elements] : [false]; });
    const cached = this.modelBoxCache.get(model);
    const key = JSON.stringify([model.desc?.revision ?? model.revision ?? 0, matrices]);
    let result;
    if (cached?.asset === model.asset && cached.key === key) result = cached.boxes;
    else {
    result = []; const q = new T.Quaternion(), translation = new T.Vector3(), scale = new T.Vector3();
    for (const part of model.asset.parts) {
      const node = model.parts.get(part.id); if (!node || !visible(node)) continue;
      node.matrixWorld.decompose(translation, q, scale);
      for (const b of part.boxes) {
        const material = model.asset.materials.find((m) => m.id === b.material);
        if (!solid(b, material, part.role)) continue;
        const c = new T.Vector3(...b.center).applyMatrix4(node.matrixWorld);
        const out = { center: array(c), size: b.size.map((v, i) => v * [scale.x, scale.y, scale.z][i]), rotation: { x: q.x, y: q.y, z: q.z, w: q.w } };
        result.push(out);
      }
    }
    this.modelBoxCache.set(model, { asset:model.asset, key, boxes:result });
    }
    if (bounds.min[0] === -Infinity && bounds.max[0] === Infinity) return result;
    // Culling is only broadphase. The cached shape remains the exact cuboid.
    return result.filter(b => { const r=Math.hypot(...b.size)/2;
      return b.center[0]+r>=bounds.min[0] && b.center[0]-r<=bounds.max[0] && b.center[2]+r>=bounds.min[2] && b.center[2]-r<=bounds.max[2]; });
  }

  desiredParts(models, player) {
    const plans = new Map(), origin = xyz(player), reach = this.radius + 8;
    for (const [id, model] of models) {
      if (['structure', 'machine', 'object', 'fixture', 'resource'].includes(model.desc?.kind)) continue;
      // Distance first: only actors in range pay for a hierarchy matrix update.
      const root = model.group, rootPosition = new T.Vector3();
      if (!root.parent || root.parent.isScene) rootPosition.copy(root.position);
      else { root.updateMatrixWorld(true); root.getWorldPosition(rootPosition); }
      if (distance(rootPosition, origin) > reach) continue;
      root.updateMatrixWorld(true);
      for (const part of model.asset.parts) {
        const node = model.parts.get(part.id); if (!node || !visible(node)) continue;
        const p = new T.Vector3(), q = new T.Quaternion(), s = new T.Vector3(); node.matrixWorld.decompose(p, q, s);
        const shape = this.partShape(model, part, s); if (!shape.boxes.length) continue;
        const key = `${id}::${part.id}`;
        plans.set(key, { id: key, ownerId: id, partId: part.id, model, node, position: xyz(p), rotation: { x: q.x, y: q.y, z: q.z, w: q.w }, boxes: shape.boxes,
          geometryKey: shape.key });
      }
    }
    return plans;
  }
  /** Solid boxes of a part at a world scale, cached per part and scale. The scale
   * is rounded: matrix decomposition jitters in the last bits (0.09375 becomes
   * 0.09374999999999999), which otherwise rebuilt every animated limb each frame. */
  partShape(model, part, scale) {
    const sx = Math.round(scale.x * 1e4) / 1e4, sy = Math.round(scale.y * 1e4) / 1e4, sz = Math.round(scale.z * 1e4) / 1e4, scaleKey = `${sx},${sy},${sz}`;
    let byScale = this.partShapes.get(part.boxes);
    if (!byScale) this.partShapes.set(part.boxes, byScale = new Map());
    let shape = byScale.get(scaleKey);
    if (!shape) {
      const factor = [sx, sy, sz], boxes = part.boxes.filter((b) => solid(b, model.asset.materials.find((m) => m.id === b.material), part.role))
        .map((b) => ({ center: b.center.map((v, i) => v * factor[i]), size: b.size.map((v, i) => v * factor[i]) }));
      byScale.set(scaleKey, shape = { boxes, key: `${part.id}:${scaleKey}:${JSON.stringify(boxes)}` });
    }
    return shape;
  }

  removeEntry(entry){
    if(!entry)return;
    for(const c of entry.colliders)this.adapter.colliderOwners.delete(c.handle);
    this.world.removeRigidBody(entry.body);
    const index=this.adapter.entries.indexOf(entry);if(index>=0)this.adapter.entries.splice(index,1);
    this.adapter.revision++;
  }

  removePart(key) {
    const cached = this.parts.get(key); if (!cached) return;
    // The adapter's public removeOwner deliberately removes all child bodies;
    // here retain siblings when an individual visible limb is removed.
    this.removeEntry(cached.entry);
    this.parts.delete(key);
  }

  sweepPart(entry, targetPosition, targetRotation) {
    const current = entry.body.translation(), currentQ = entry.body.rotation();
    const delta = { x: targetPosition.x - current.x, y: targetPosition.y - current.y, z: targetPosition.z - current.z };
    const total = Math.hypot(delta.x, delta.y, delta.z);
    const excludeSelf = (c) => (!c.isSensor() || c.handle === this.characterCollider.handle) && !(c.handle === this.characterCollider.handle && entry.ownerId === 'player') && this.adapter.ownershipForCollider(c)?.ownerId !== entry.ownerId;
    let fraction = 1;
    if (total > 1e-6) for (const collider of entry.colliders) {
      const hit = this.world.castShape(collider.translation(), collider.rotation(), delta, collider.shape,
        .001, fraction, false, undefined, undefined, collider, entry.body, excludeSelf);
      if (hit) fraction = Math.min(fraction, Math.max(0, hit.time_of_impact - .002 / total));
    }
    const next = { x: current.x + delta.x * fraction, y: current.y + delta.y * fraction, z: current.z + delta.z * fraction };
    // Rotation uses discrete <=5-degree pose checks, with each authored cuboid;
    // the owner's other children are always filtered out. This is not an AABB.
    const q0 = new T.Quaternion(currentQ.x, currentQ.y, currentQ.z, currentQ.w), q1 = new T.Quaternion(targetRotation.x, targetRotation.y, targetRotation.z, targetRotation.w);
    const angle = q0.angleTo(q1), steps = Math.max(1, Math.ceil(angle / (Math.PI / 36)));
    let acceptedQ = q0.clone();
    if (angle > 1e-6) for (let i = 1; i <= steps; i++) {
      const q = q0.clone().slerp(q1, i / steps); let blocked = false;
      for (const collider of entry.colliders) {
        const local = collider.translationWrtParent(), localQ = collider.rotationWrtParent();
        const center = new T.Vector3(local.x, local.y, local.z).applyQuaternion(q).add(new T.Vector3(next.x, next.y, next.z));
        const rotation = q.clone().multiply(new T.Quaternion(localQ.x, localQ.y, localQ.z, localQ.w));
        const obstruction = this.world.intersectionWithShape(xyz(center), rotation, collider.shape, undefined, undefined, collider, entry.body, excludeSelf);
        if (obstruction) { blocked = true; break; }
      }
      if (blocked) break; acceptedQ = q;
    }
    return { position: next, rotation: { x: acceptedQ.x, y: acceptedQ.y, z: acceptedQ.z, w: acceptedQ.w }, fraction };
  }

  synchronize(sceneModels = this.scene?.models ?? new Map(), player = this.runtime.player) {
    this.assertReady();
    const models = sceneModels instanceof Map ? sceneModels : new Map(Object.entries(sceneModels));
    this.lastPlayer = xyz(player);
    const playerHeight = player.bodyHeight ?? (player.stance === 'crawl' ? .65 : player.stance === 'crouch' ? 1.2 : 1.8);
    this.characterCollider.setShape(new R.Capsule(playerHeight / 2 - .27, .27));
    this.characterCollider.setTranslation({ x: player.x, y: player.y + playerHeight / 2, z: player.z });
    this.sceneModels = models;
    this.machinePhysics.sync(); this.objectPhysics.sync(); if (this.runtime.placements?.physicsBodies) this.fixturePhysics.sync(); this.terrainAt(player); this.syncStructures(models, player); this.syncBossEffects(); this.syncFixtures(models);
    const plans = this.desiredParts(models, player);
    for (const key of this.parts.keys()) if (!plans.has(key)) this.removePart(key);
    for (const [key, plan] of plans) {
      if (this.parts.get(key)?.geometryKey !== plan.geometryKey) this.removePart(key);
      if (!this.parts.has(key)) {
        const entry = this.adapter.addBody({ ownerId: plan.ownerId, partId: plan.partId, type: 'kinematic', boxes: plan.boxes,
          position: array(plan.position), rotation: plan.rotation, mass: this.runtime.creatures?.massForVisualPart?.(plan.ownerId, plan.partId) ?? 1 });
        this.parts.set(key, { entry, geometryKey: plan.geometryKey, initial: true });
      }
      const entry = this.parts.get(key).entry;
      const mass = this.runtime.creatures?.massForVisualPart?.(plan.ownerId, plan.partId);
      if (Number.isFinite(mass) && mass >= 0 && mass !== entry.mass) {
        const volumes = plan.boxes.map((b) => b.size.reduce((a, n) => a * n, 1)), total = volumes.reduce((a, n) => a + n, 0);
        entry.colliders.forEach((c, i) => c.setMass(mass * volumes[i] / total));
        entry.body.recomputeMassPropertiesFromColliders(); entry.mass = mass;
      }
    }
    // Queries read the broad-phase of the last world step: refresh it only when a
    // body was added or removed or the player capsule moved since then.
    const capsule = this.characterCollider.translation(), stepped = this.steppedCapsule;
    if (this.adapter.revision !== this.adapter.steppedRevision || !stepped || Math.abs(stepped.height - playerHeight) > 1e-6
      || Math.abs(stepped.x - capsule.x) + Math.abs(stepped.y - capsule.y) + Math.abs(stepped.z - capsule.z) > 1e-6) this.worldStep(1e-6);
    const ownerCorrection = new Map();
    for (const [key, plan] of plans) {
      const cached = this.parts.get(key), entry = cached.entry;
      if (cached.initial) continue;
      const desired = this.sweepPart(entry, plan.position, plan.rotation);
      if (desired.fraction < 1) {
        const correction = { x: desired.position.x - plan.position.x, y: desired.position.y - plan.position.y, z: desired.position.z - plan.position.z };
        const old = ownerCorrection.get(plan.ownerId);
        if (!old || Math.hypot(correction.x, correction.y, correction.z) > Math.hypot(old.x, old.y, old.z)) ownerCorrection.set(plan.ownerId, correction);
      }
    }
    // Keep the simulation/model root at the collision-limited position instead
    // of allowing the visible actor to diverge from the physics bodies.
    for (const [ownerId, correction] of ownerCorrection) {
      const model = models.get(ownerId), pos = model?.desc?.position;
      if (pos) for (const k of ['x', 'y', 'z']) pos[k] += correction[k];
      if (model) { model.group.position.add(new T.Vector3(correction.x, correction.y, correction.z)); model.group.updateMatrixWorld(true); }
    }
    // Re-evaluate the hierarchy after a root correction. Every sibling receives
    // the same root displacement; a blocked nose cannot collapse a free tail
    // into itself. Parent-first local rotation limiting keeps render and collider
    // poses in agreement when a swinging limb encounters an external wall.
    for (const [key, plan] of plans) {
      const cached = this.parts.get(key);
      if (cached.initial) { cached.initial = false; continue; }
      plan.node.updateWorldMatrix(true, false);
      const p = new T.Vector3(), q = new T.Quaternion(), scale = new T.Vector3();
      plan.node.matrixWorld.decompose(p, q, scale);
      const allowed = this.sweepPart(cached.entry, xyz(p), q);
      cached.entry.body.setNextKinematicTranslation(allowed.position);
      cached.entry.body.setNextKinematicRotation(allowed.rotation);
      const parentQ = new T.Quaternion(); plan.node.parent.getWorldQuaternion(parentQ);
      const acceptedQ = new T.Quaternion(allowed.rotation.x, allowed.rotation.y, allowed.rotation.z, allowed.rotation.w);
      plan.node.quaternion.copy(parentQ.invert().multiply(acceptedQ));
      if (allowed.fraction < 1) {
        const local = plan.node.parent.worldToLocal(new T.Vector3(allowed.position.x, allowed.position.y, allowed.position.z));
        plan.node.position.copy(local);
      }
      plan.node.updateMatrixWorld(true);
    }
    return { parts: this.parts.size, colliders: this.world.colliders.len(), structures: this.structures.size };
  }

  /** One Rapier step, remembering the player capsule the broad-phase now holds. */
  worldStep(dt) {
    this.adapter.step(dt);
    const capsule = this.characterCollider.translation();
    this.steppedCapsule = { x: capsule.x, y: capsule.y, z: capsule.z, height: this.characterCollider.shape.halfHeight * 2 + .54 };
  }
  step(dt) {
    this.assertReady(); if (!Number.isFinite(dt) || dt <= 0 || dt > .25) throw new RangeError('Invalid physics dt');
    let remaining = dt;
    while (remaining > 1e-9) {
      const step = Math.min(1 / 60, remaining);
      this.machinePhysics.prepare(step); this.objectPhysics.sync(); this.objectPhysics.prepare(step); if (this.runtime.placements?.physicsBodies) this.fixturePhysics.sync(); this.terrainAt(this.runtime.player); this.worldStep(step); this.playerImpacts(step); this.creatureImpacts(); this.machinePhysics.capture(); this.objectPhysics.capture(); this.fixturePhysics.capture(); remaining -= step;
    }
  }
  /** Bodies that strike the player hurt like the frontier's (impact.js, safe speed 4 m/s). Runs after the
   * world step and before capture, so the last captured poses still hold the pre-impact velocity: they give
   * a cheap closing-speed and distance check, and only then the exact collider test, at most once per body
   * every 0.45 s. The held object and the driven machine never strike their user. */
  playerImpacts(dt) {
    const p = this.runtime.player, last = this.impactLast ??= { x: p.x, y: p.y, z: p.z };
    const vx = (p.x - last.x) / dt, vy = (p.y - last.y) / dt, vz = (p.z - last.z) / dt;
    last.x = p.x; last.y = p.y; last.z = p.z; this.impactClock += dt;
    if (vx * vx + vy * vy + vz * vz > 2500 || p.hp <= 0) return; // a teleport or respawn, not motion
    this.strikesFrom(this.objectPhysics.bodies, this.runtime.objects, this.objectPhysics.held?.id, p, vx, vy, vz);
    this.strikesFrom(this.machinePhysics.bodies, this.machinePhysics.system?.machines, this.runtime.drivingMachineId, p, vx, vy, vz);
    if (this.impactCooldown.size) for (const [id, until] of this.impactCooldown) if (until <= this.impactClock) this.impactCooldown.delete(id);
  }
  /** A loose object moving faster than 4 m/s that touches a creature's part strikes it with the impact
   * energy of the two masses (runtime.strikeCreature), once per object and creature every 0.45 s. */
  creatureImpacts() {
    const creatures = this.runtime.creatures; if (!creatures?.get) return;
    for (const [id, cache] of this.objectPhysics.bodies) {
      const s = this.runtime.objects?.get?.(id), v = s?.velocity;
      if (!v || v.x * v.x + v.y * v.y + v.z * v.z <= 16) continue;
      for (const collider of cache.entry.colliders) this.world.contactPairsWith(collider, (other) => {
        const owner = this.adapter.ownershipForCollider(other), creature = owner && creatures.get(owner.ownerId);
        if (!creature) return;
        const key = `${id}>${owner.ownerId}`; if ((this.impactCooldown.get(key) ?? 0) > this.impactClock) return;
        const c = other.translation(), dx = c.x - s.position.x, dy = c.y - s.position.y, dz = c.z - s.position.z, d = Math.hypot(dx, dy, dz) || 1;
        const closing = (v.x * dx + v.y * dy + v.z * dz) / d; if (closing <= 4) return;
        this.impactCooldown.set(key, this.impactClock + .45);
        this.runtime.strikeCreature?.(owner.ownerId, owner.partId, impactEnergy(cache.entry.body.mass(), creature.massKg ?? 60, closing, 4), { x: c.x, y: c.y, z: c.z }, id);
      });
    }
  }
  strikesFrom(bodies, states, skipId, p, vx, vy, vz) {
    for (const [id, cache] of bodies) {
      const s = states?.get?.(id);
      if (id === skipId || !s?.position || !s.velocity) continue;
      const rx = s.velocity.x - vx, ry = s.velocity.y - vy, rz = s.velocity.z - vz;
      if (rx * rx + ry * ry + rz * rz <= 16 || (this.impactCooldown.get(id) ?? 0) > this.impactClock) continue;
      const b = this.bodyBounds(cache.entry); if (!b) continue;
      const height = p.bodyHeight ?? 1.8, dx = p.x - s.position.x, dy = p.y + height / 2 - s.position.y, dz = p.z - s.position.z, d = Math.hypot(dx, dy, dz);
      if (d > Math.hypot(b.center[0], b.center[1], b.center[2]) + Math.hypot(b.half[0], b.half[1], b.half[2]) + height / 2 + .3) continue;
      const closing = d > 1e-6 ? (rx * dx + ry * dy + rz * dz) / d : 0;
      if (closing <= 4) continue;
      const shape = new R.Capsule(Math.max(0, height / 2 - .27), .27), center = { x: p.x, y: p.y + height / 2, z: p.z };
      if (!cache.entry.colliders.some((c) => !c.isSensor() && c.intersectsShape(shape, center, IDENTITY))) continue;
      this.impactCooldown.set(id, this.impactClock + .45);
      this.runtime.strikePlayer?.(impactEnergy(cache.entry.body.mass(), 80, closing, 4), id);
    }
  }
  /** Exact placement overlap against every external solid cuboid/actor. A tiny
   * inset permits touching support faces without permitting occupied volume. */
  externalOverlap(box, { ignoreOwnerId } = {}) {
    this.assertReady();
    if (!Array.isArray(box.center) || !Array.isArray(box.size) || box.center.length !== 3 || box.size.length !== 3 ||
      !box.center.every(Number.isFinite) || !box.size.every((n) => Number.isFinite(n) && n > 0)) throw new TypeError('Invalid placement box');
    const shape = new R.Cuboid(...box.size.map((n) => Math.max(n / 2 - 1e-5, n / 4)));
    const q = box.rotation ?? identity;
    const quaternion = Array.isArray(q) ? { x: q[0], y: q[1], z: q[2], w: q[3] } : q;
    return !!this.world.intersectionWithShape(xyz(box.center), quaternion, shape, undefined, undefined, undefined, undefined,
      (c) => (c.handle === this.characterCollider.handle || !c.isSensor()) &&
        !(ignoreOwnerId != null && this.adapter.ownershipForCollider(c)?.ownerId === ignoreOwnerId));
  }

  canPlaceVoxel(machine, { cell, gridM }) {
    this.assertReady();
    const q0 = machine.rotation ?? { x: 0, y: Math.sin(machine.yaw / 2), z: 0, w: Math.cos(machine.yaw / 2) };
    const q = new T.Quaternion(q0.x, q0.y, q0.z, q0.w);
    const center = new T.Vector3(...cell.map((v) => (v + .5) * gridM)).applyQuaternion(q).add(new T.Vector3(...array(machine.position)));
    // Resting Rapier bodies can penetrate their support by a few tens of
    // micrometres. Allow only this contact band when extending a grounded
    // assembly; both streamed colliders and the exact terrain query use it.
    const contactInset = Math.min(.001, gridM / 32);
    const shape = new R.Cuboid(...[0, 1, 2].map(() => gridM / 2 - contactInset));
    const collision = this.world.intersectionWithShape(xyz(center), q, shape, undefined, undefined, this.characterCollider, undefined,
      (c) => !c.isSensor() && this.adapter.ownershipForCollider(c)?.ownerId !== machine.id);
    if (collision) return false;
    // Query exact terrain cells too: placement may precede this frame's streamed
    // collider rebuild. Rotation remains an OBB/cuboid intersection.
    const r = gridM * Math.sqrt(3) / 2;
    for (let x = Math.floor((center.x - r) * 2); x <= Math.floor((center.x + r) * 2); x++)
      for (let y = Math.floor((center.y - r) * 2); y <= Math.floor((center.y + r) * 2); y++)
        for (let z = Math.floor((center.z - r) * 2); z <= Math.floor((center.z + r) * 2); z++)
          if (this.runtime.atlas?.isSolidCell?.(x, y, z) && shape.intersectsShape(xyz(center), q,
            new R.Cuboid(.25, .25, .25), { x: x * .5 + .25, y: y * .5 + .25, z: z * .5 + .25 }, identity)) return false;
    return true;
  }
  getPartPhysics(ownerId, partId) {
    const entry = this.parts.get(`${ownerId}::${partId}`)?.entry; if (!entry) return null;
    return { position: { ...entry.body.translation() }, rotation: { ...entry.body.rotation() },
      velocity: { ...entry.body.linvel() }, angularVelocity: { ...entry.body.angvel() } };
  }
  machineTargets() { this.assertReady(); return this.machinePhysics.targets(); }
  damageMachineTarget(event) { this.assertReady(); return this.machinePhysics.damage(event); }

  movePlayer(before, player) {
    this.assertReady();
    const start = xyz(before), desired = xyz(player), height = player.bodyHeight ?? (player.stance === 'crawl' ? .65 : player.stance === 'crouch' ? 1.2 : 1.8);
    const radius = .27;
    this.characterCollider.setShape(new R.Capsule(height / 2 - radius, radius));
    if (player.stance === 'crawl' || player.flying) this.character.disableAutostep(); else this.character.enableAutostep(.51, .15, false);
    if (player.flying || desired.y > start.y) this.character.disableSnapToGround(); else this.character.enableSnapToGround(.06);
    const delta = { x: desired.x - start.x, y: desired.y - start.y, z: desired.z - start.z };
    const steps = Math.max(1, Math.ceil(Math.hypot(delta.x, delta.y, delta.z)));
    const current = { ...start }; let grounded = false;
    for (let i = 0; i < steps; i++) {
      if (this.terrainAt(current)) this.worldStep(1e-6);
      this.characterCollider.setTranslation({ x: current.x, y: current.y + height / 2, z: current.z });
      this.character.computeColliderMovement(this.characterCollider, { x: delta.x / steps, y: delta.y / steps, z: delta.z / steps },
        R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, (c) => c.handle !== this.characterCollider.handle && this.adapter.ownershipForCollider(c)?.ownerId !== 'player' && !(this.runtime.drivingMachineId != null && this.adapter.ownershipForCollider(c)?.ownerId === this.runtime.drivingMachineId));
      const movement = this.character.computedMovement();
      current.x += movement.x; current.y += movement.y; current.z += movement.z;
      grounded ||= this.character.computedGrounded();
    }
    Object.assign(player, current);
    this.characterCollider.setTranslation({ x: player.x, y: player.y + height / 2, z: player.z });
    if (grounded) { player.grounded = true; if (player.vy < 0) player.vy = 0; }
    return { movement: { x: current.x - start.x, y: current.y - start.y, z: current.z - start.z }, grounded };
  }

  /** Part-local metres of a world point on an owner's rendered part (shell wounds). */
  partLocalPoint(ownerId, partId, point) {
    const node = (this.sceneModels ?? this.scene?.models)?.get(ownerId)?.parts.get(partId);
    if (!node || !point) return null;
    node.updateMatrixWorld(true);
    const v = new T.Vector3(point.x, point.y, point.z).applyMatrix4(node.matrixWorld.clone().invert());
    return [v.x, v.y, v.z];
  }

  /** Unbroken bone pieces of one visible creature part, in part-local metres (cached per asset part). */
  _bones(record, entity, part) {
    const logical = creatureBodyPart(entity, part.id);
    if (!logical || entity.parts?.[logical]?.broken) return [];
    this.boneCache ??= new Map();
    const key = `${record.asset.id}:${part.id}`;
    if (!this.boneCache.has(key)) this.boneCache.set(key, creatureBones(part, logical));
    return this.boneCache.get(key);
  }
  _visibleParts(record) {
    record.group.updateMatrixWorld(true);
    return record.asset.parts.map(part => ({ part, node: record.parts.get(part.id) })).filter(({ node }) => {
      if (!node) return false;
      for (let n = node; n; n = n.parent) if (!n.visible) return false;
      return true;
    });
  }
  /** Creature parts whose bones a world segment crosses, nearest first ({partId, enterM}). */
  traceBones(ownerId, from, to) {
    const record = (this.sceneModels ?? this.scene?.models)?.get(ownerId), entity = this.runtime.creatures?.get(ownerId);
    if (!record || !entity || !from || !to) return [];
    const a = new T.Vector3(from.x, from.y, from.z), b = new T.Vector3(to.x, to.y, to.z), length = a.distanceTo(b), hits = [];
    for (const { part, node } of this._visibleParts(record)) {
      const inv = node.matrixWorld.clone().invert(), la = a.clone().applyMatrix4(inv), lb = b.clone().applyMatrix4(inv);
      let best = null;
      for (const box of this._bones(record, entity, part)) { const r = segmentInterval(la, lb, box.center, box.size); if (r && (best === null || r[0] < best)) best = r[0]; }
      if (best !== null) hits.push({ partId: part.id, enterM: best * length });
    }
    return hits.sort((x, y) => x.enterM - y.enterM);
  }
  /** True when a part-local cut box [x,y,z,sx,sy,sz] overlaps that part's unbroken bone. */
  cutReachesBone(ownerId, partId, cut) {
    const record = (this.sceneModels ?? this.scene?.models)?.get(ownerId), entity = this.runtime.creatures?.get(ownerId), part = record?.asset.parts.find(p => p.id === partId);
    if (!record || !entity || !part || !cut) return false;
    return this._bones(record, entity, part).some(b => [0, 1, 2].every(i => Math.abs(b.center[i] - cut[i]) < (b.size[i] + cut[3 + i]) / 2));
  }

  /** True only when the actual collider segment is clear. Ignore attacker and
   * intended target bodies, but retain other owners and all terrain/structures. */
  traceCombat(options) {
    this.assertReady();
    const model = (this.sceneModels ?? this.scene?.models)?.get(options.ownerId);
    return traceCombatModel(model, options, (a, b) => {
      const delta = b.clone().sub(a), length = delta.length(); delta.normalize();
      const hit = this.world.castRay(new R.Ray(xyz(a), xyz(delta)), length, true,
        R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.characterCollider, undefined,
        c => { const owner = this.adapter.ownershipForCollider(c)?.ownerId;
          return owner !== options.ownerId && owner !== (options.excludeOwnerId ?? 'player'); });
      return hit?.timeOfImpact ?? hit?.toi ?? Infinity;
    });
  }

  hasAttackLineOfSight(from, to, { excludeOwnerId, targetOwnerId } = {}) {
    this.assertReady();
    const a = xyz(from), b = xyz(to), d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    if (![...Object.values(a), ...Object.values(b)].every(Number.isFinite)) throw new TypeError('Invalid attack ray');
    const length = Math.hypot(d.x, d.y, d.z); if (length < 1e-8) return true;
    const ray = new R.Ray(a, { x: d.x / length, y: d.y / length, z: d.z / length });
    const hit = this.world.castRay(ray, Math.max(0, length - .0001), true, undefined, undefined,
      this.characterCollider, undefined, (c) => {
        if (c.isSensor()) return false;
        const owner = this.adapter.ownershipForCollider(c)?.ownerId;
        return !(excludeOwnerId != null && owner === excludeOwnerId) && !(targetOwnerId != null && owner === targetOwnerId);
      });
    return !hit;
  }

  groundHeight(x, z, nearY = this.runtime.player?.y ?? 0) {
    this.assertReady();
    const ray = new R.Ray({ x, y: nearY + 1, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, 6, true, undefined, undefined, this.characterCollider, undefined,
      (c) => { const own = this.adapter.ownershipForCollider(c); return own && (own.ownerId === '@terrain' || this.structures.has(own.ownerId) || this.bossEffects.has(own.ownerId) || this.fixtures.has(own.ownerId)); });
    return hit ? nearY + 1 - hit.timeOfImpact : this.runtime.atlas.heightAt(x, z);
  }

  dispose() {
    if (this.disposed) return;
    if (this.initialized) { this.machinePhysics.dispose(); this.objectPhysics.dispose(); this.fixturePhysics.dispose(); this.world.removeCharacterController(this.character); this.world.removeCollider(this.characterCollider, false); this.adapter.dispose(); this.world.free(); }
    this.parts.clear(); this.structures.clear(); this.bossEffects.clear(); this.fixtures.clear(); this.terrainSections.clear(); this.disposed = true;
  }
}
