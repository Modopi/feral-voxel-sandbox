import R from '../vendor/rapier/rapier.js';
import * as T from '../vendor/three.module.js';
import { AssetCollisionWorld } from './voxel/physics.mjs';
import { MachinePhysicsBridge } from './machine-physics.js';
import { ObjectPhysicsBridge } from './object-physics.js';
import { FixturePhysicsBridge } from './fixture-physics.js';
import { traceCombatModel } from './combat-trace.js';

let initialization;
const initialize = () => initialization ??= R.init();
const xyz = (v) => Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : { x: v.x, y: v.y, z: v.z };
const array = (v) => [v.x, v.y, v.z];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const identity = { x: 0, y: 0, z: 0, w: 1 };
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
    this.parts = new Map(); this.structures = new Map(); this.bossEffects = new Map(); this.fixtures = new Map(); this.terrainKey = null; this.modelBoxCache = new WeakMap(); this.fixtureBoxRefs = new Map();
    this.disposed = false; this.initialized = false; this.lastPlayer = null;
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

  terrainAt(player, force = false) {
    const p = xyz(player), atlas = this.runtime.atlas;
    if (!atlas?.isSolidCell) return false;
    // Two-metre cache cells plus margin avoid rebuilding for every input tick.
    const cx = Math.floor(p.x / 2) * 2, cy = Math.floor(p.y), cz = Math.floor(p.z / 2) * 2;
    const dynamicKey = [...(this.machinePhysics?.bodies ?? []), ...(this.objectPhysics?.bodies ?? []), ...(this.fixturePhysics?.bodies ?? [])].map(([id, c]) => {
      const p = c.entry.body.translation(), q = c.entry.body.rotation(), v = c.entry.body.linvel();
      return [id, ...[p.x, p.y, p.z].map(Math.floor), ...[q.x, q.y, q.z, q.w].map((n) => Math.round(n * 12)),
        ...[v.x, v.y, v.z].map((n) => Math.round(n / 5)), c.signature];
    });
    const key = `${cx},${cy},${cz}:${atlas.revision ?? 0}:${JSON.stringify(dynamicKey)}`;
    if (!force && key === this.terrainKey) return false;
    this.adapter.removeOwner('@terrain');
    const bounds = {
      min: [cx - this.terrainRadius - 2, cy - this.terrainBelow, cz - this.terrainRadius - 2],
      max: [cx + this.terrainRadius + 2, cy + this.terrainAbove, cz + this.terrainRadius + 2],
    };
    const min = bounds.min.map((v) => Math.floor(v * 2)), max = bounds.max.map((v) => Math.ceil(v * 2));
    const boxes = [];
    // Exact union of 0.5m cells: merge only contiguous x runs in one y/z row.
    // Holes, caves, mining edits and fluid non-collision cells remain empty.
    for (let y = min[1]; y < max[1]; y++) for (let z = min[2]; z < max[2]; z++) {
      let start = null;
      for (let x = min[0]; x <= max[0]; x++) {
        const occupied = x < max[0] && atlas.isSolidCell(x, y, z);
        if (occupied && start === null) start = x;
        if (!occupied && start !== null) {
          boxes.push({ center: [(start + x) * .25, y * .5 + .25, z * .5 + .25], size: [(x - start) * .5, .5, .5] }); start = null;
        }
      }
    }
    // Sparse neighbourhoods around actual moving cuboids keep distant aircraft,
    // separated fragments and long assemblies in contact with local terrain.
    // Do not fill the potentially huge empty AABB between player and vehicles.
    const extra = new Set(), rows = new Map();
    for (const { entry } of [...(this.machinePhysics?.bodies.values() ?? []), ...(this.objectPhysics?.bodies.values() ?? []), ...(this.fixturePhysics?.bodies.values() ?? [])]) {
      const v = entry.body.linvel(), margin = 1.5 + Math.min(5, Math.hypot(v.x, v.y, v.z) * .1);
      for (const collider of entry.colliders) {
        const c = collider.translation(), q0 = collider.rotation(), q = new T.Quaternion(q0.x, q0.y, q0.z, q0.w);
        const h = collider.shape.halfExtents, basis = [new T.Vector3(h.x, 0, 0), new T.Vector3(0, h.y, 0), new T.Vector3(0, 0, h.z)].map((a) => a.applyQuaternion(q));
        const ext = ['x', 'y', 'z'].map((k) => basis.reduce((sum, a) => sum + Math.abs(a[k]), 0));
        const low = ['x', 'y', 'z'].map((k, i) => Math.floor((c[k] - ext[i] - margin) * 2));
        const high = ['x', 'y', 'z'].map((k, i) => Math.ceil((c[k] + ext[i] + margin) * 2));
        for (let y = low[1]; y < high[1]; y++) for (let z = low[2]; z < high[2]; z++) for (let x = low[0]; x < high[0]; x++) {
          if (x >= min[0] && x < max[0] && y >= min[1] && y < max[1] && z >= min[2] && z < max[2]) continue;
          const cell = `${x},${y},${z}`; if (extra.has(cell)) continue; extra.add(cell);
          if (!atlas.isSolidCell(x, y, z)) continue;
          const row = `${y},${z}`; if (!rows.has(row)) rows.set(row, []); rows.get(row).push(x);
        }
      }
    }
    for (const [row, xs] of rows) {
      const [y, z] = row.split(',').map(Number); xs.sort((a, b) => a - b);
      let start = xs[0], end = start + 1;
      for (let i = 1; i <= xs.length; i++) {
        if (xs[i] === end) { end++; continue; }
        boxes.push({ center: [(start + end) * .25, y * .5 + .25, z * .5 + .25], size: [(end - start) * .5, .5, .5] });
        start = xs[i]; end = start + 1;
      }
    }
    if (boxes.length) this.adapter.addBody({ ownerId: '@terrain', type: 'fixed', boxes });
    this.terrainKey = key; return true;
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
    const plans = new Map();
    for (const [id, model] of models) {
      if (['structure', 'machine', 'object', 'fixture', 'resource'].includes(model.desc?.kind)) continue;
      const root = model.group; root.updateMatrixWorld(true);
      const rootPosition = new T.Vector3(); root.getWorldPosition(rootPosition);
      if (distance(rootPosition, xyz(player)) > this.radius + 8) continue;
      for (const part of model.asset.parts) {
        const node = model.parts.get(part.id); if (!node || !visible(node)) continue;
        const p = new T.Vector3(), q = new T.Quaternion(), s = new T.Vector3(); node.matrixWorld.decompose(p, q, s);
        const boxes = part.boxes.filter((b) => solid(b, model.asset.materials.find((m) => m.id === b.material), part.role))
          .map((b) => ({ center: b.center.map((v, i) => v * [s.x, s.y, s.z][i]), size: b.size.map((v, i) => v * [s.x, s.y, s.z][i]) }));
        if (!boxes.length) continue;
        const key = `${id}::${part.id}`;
        plans.set(key, { id: key, ownerId: id, partId: part.id, model, node, position: xyz(p), rotation: { x: q.x, y: q.y, z: q.z, w: q.w }, boxes,
          geometryKey: JSON.stringify(boxes) });
      }
    }
    return plans;
  }

  removeEntry(entry){
    if(!entry)return;
    for(const c of entry.colliders)this.adapter.colliderOwners.delete(c.handle);
    this.world.removeRigidBody(entry.body);
    const index=this.adapter.entries.indexOf(entry);if(index>=0)this.adapter.entries.splice(index,1);
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
    // Refresh broad-phase after new terrain/parts before issuing actual queries.
    this.adapter.step(1e-6);
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

  step(dt) {
    this.assertReady(); if (!Number.isFinite(dt) || dt <= 0 || dt > .25) throw new RangeError('Invalid physics dt');
    let remaining = dt;
    while (remaining > 1e-9) {
      const step = Math.min(1 / 60, remaining);
      this.machinePhysics.prepare(step); this.objectPhysics.sync(); this.objectPhysics.prepare(step); if (this.runtime.placements?.physicsBodies) this.fixturePhysics.sync(); this.terrainAt(this.runtime.player); this.adapter.step(step); this.machinePhysics.capture(); this.objectPhysics.capture(); this.fixturePhysics.capture(); remaining -= step;
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
      if (this.terrainAt(current)) this.adapter.step(1e-6);
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
    this.parts.clear(); this.structures.clear(); this.bossEffects.clear(); this.fixtures.clear(); this.disposed = true;
  }
}
