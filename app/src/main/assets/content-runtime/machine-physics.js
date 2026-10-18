import * as T from '../vendor/three.module.js';
const xyz = (v) => ({ x: v.x, y: v.y, z: v.z });
const arr = (v) => [v.x, v.y, v.z];
const identity = { x: 0, y: 0, z: 0, w: 1 };
// A running engine burns a little fuel every step: a collider's mass (and the cargo) is set again once it moved by
// 0.1 %, so Rapier does not recompute the body's mass properties every step for grams.
export const MASS_TOLERANCE = 1e-3;
const rotation = (m) => m.rotation ?? { x: 0, y: Math.sin(m.yaw / 2), z: 0, w: Math.cos(m.yaw / 2) };

/** One dynamic compound per connected assembly. Every authored voxel remains a
 * separate cuboid (and a damage-addressable collider); no aggregate AABB hull.
 * MachineSystem owns inventory/energy/claims; Rapier alone integrates 6DOF. */
export class MachinePhysicsBridge {
  constructor(physics, R) {
    this.physics = physics; this.R = R; this.system = physics.runtime.machines;
    this.bodies = new Map(); this.contacts = new Map(); this.pass = 0;
    this.system?.setPhysicsDriver(physics);
  }
  sync() {
    if (!this.system) return;
    const player = this.physics.runtime.player, pass = ++this.pass;
    for (const m of this.system.machines.values()) {
      const dx = m.position.x - player.x, dz = m.position.z - player.z;
      if (!m.voxels.length || dx * dx + dz * dz > 64 * 64) continue;
      let cache = this.bodies.get(m.id);
      // The colliders change only with the machine's voxels, wheels or anchor: look only when its revision moves.
      if (cache?.revision !== m.revision || cache.anchored !== !!m.anchored) {
        const wheels = m.components.filter((c) => c.legacyType === 'wheel').map((c) => c.voxelId);
        const signature = JSON.stringify([m.gridM, m.voxels.map((v) => [v.id, v.cell]), !!m.anchored, wheels]);
        if (cache?.signature !== signature) {
          if (cache) this.physics.adapter.removeOwner(m.id);
          // Wheel suspension carries a wheeled machine just above the ground (machines.js WHEEL_DRIVE), so its voxels
          // do not scrape the ground; a wheel voxel that still touches it slides, since the wheel drive pushes and holds.
          const rolling = new Set(wheels);
          const boxes = m.voxels.map((v) => ({ center: v.cell.map((n) => (n + .5) * m.gridM), size: [m.gridM, m.gridM, m.gridM], friction: rolling.has(v.id) ? 0 : .6 }));
          // A wrench-anchored machine is a fixed body until it is released (frontier).
          const fixed = !!m.anchored, entry = this.physics.adapter.addBody({ ownerId: m.id, partId: 'assembly', type: fixed ? 'fixed' : 'dynamic', boxes,
            position: arr(m.position), rotation: rotation(m), mass: fixed ? 0 : Math.max(.001, this.system.evaluate(m.id).mass), friction: .6 });
          if (!fixed) { this.physics.watchImpacts?.(entry.colliders, Math.max(.001, this.system.evaluate(m.id).mass)); entry.body.setLinvel(m.velocity, true); entry.body.setAngvel(m.angularVelocity ?? { x: 0, y: 0, z: 0 }, true); entry.body.setLinearDamping(0); entry.body.setAngularDamping(.04); }
          const voxelIds = m.voxels.map((v) => v.id);
          entry.colliders.forEach((c, i) => {
            this.physics.adapter.colliderOwners.set(c.handle, Object.freeze({ ownerId: m.id, partId: voxelIds[i], bodyHandle: entry.body.handle }));
            if (rolling.has(voxelIds[i])) c.setFrictionCombineRule(this.R.CoefficientCombineRule.Min);
          });
          // Collider masses are compared and set in place each step (mass()); cargo is the last entry.
          cache = { entry, signature, voxelIds, voxelIndex: new Map(voxelIds.map((id, i) => [id, i])), masses: new Float64Array(voxelIds.length + 1).fill(NaN), nextMasses: new Float64Array(voxelIds.length + 1), placed: m.placed ?? 0, seen: 0 };
          this.bodies.set(m.id, cache);
        }
        cache.revision = m.revision; cache.anchored = !!m.anchored;
      }
      // A machine moved by MachineSystem.place (back to the start) is put there at rest.
      if (cache.placed !== (m.placed ?? 0)) {
        const body = cache.entry.body; body.setTranslation(m.position, true); body.setRotation(rotation(m), true);
        body.setLinvel(m.velocity, true); body.setAngvel(m.angularVelocity, true); cache.placed = m.placed ?? 0;
      }
      cache.seen = pass; this.mass(m, cache);
    }
    // Machines out of reach or gone this pass lose their bodies (deleting during Map iteration is safe).
    for (const [id, cache] of this.bodies) if (cache.seen !== pass) {
      this.physics.adapter.removeOwner(id); this.bodies.delete(id); this.contacts.delete(id);
    }
  }
  /** Sets the collider masses when one of them or the cargo moved by MASS_TOLERANCE (fuel burnt, cargo loaded).
   * Per step and without allocating: the masses are written into the cache's arrays and compared there. */
  mass(m, cache) {
    if (m.anchored) return; // fixed bodies carry no mass
    const next = this.system.writePhysicsMasses(m, cache.voxelIndex, cache.nextMasses), applied = cache.masses;
    // NaN (never applied) always differs.
    let i = 0; while (i < next.length && Math.abs(next[i] - applied[i]) <= MASS_TOLERANCE * Math.max(1, applied[i])) i++;
    if (i === next.length) return;
    applied.set(next);
    const colliders = cache.entry.colliders;
    for (let j = 0; j < colliders.length; j++) colliders[j].setMass(applied[j]);
    const cargo = applied[colliders.length], inertia = cargo * m.gridM ** 2 / 6;
    cache.entry.body.setAdditionalMassProperties(cargo, { x: 0, y: 0, z: 0 }, { x: inertia, y: inertia, z: inertia }, identity, true);
    cache.entry.body.recomputeMassPropertiesFromColliders();
  }
  prepare(dt) {
    if (!this.system) return;
    this.sync();
    const packets = this.system.preparePhysicsStep(dt, { active: this.bodies });
    for (const packet of packets) {
      const cache = this.bodies.get(packet.id); if (!cache) continue;
      const body = cache.entry.body; body.resetForces(false); body.resetTorques(false);
      this.mass(this.system.machines.get(packet.id), cache);
      if (packet.forces?.length) for (const item of packet.forces) body.addForceAtPoint(item.force, item.point, true);
      else if (packet.force) body.addForce(packet.force, true);
      if (packet.torque) body.addTorque(packet.torque, true);
      this.environmentForces(cache,dt);
    }
  }
  environmentForces(cache,dt){
    const rt=this.physics.runtime,fluidAt=rt.terrain?.fluidAt?.bind(rt.terrain)??rt.atlas?.fluidAt?.bind(rt.atlas);
    const body=cache.entry.body,m=this.system.machines.get(cache.entry.ownerId);if(!m)return;
    let submerged=0,totalVolume=0;
    if(fluidAt)for(let i=0;i<cache.entry.colliders.length;i++){
      const collider=cache.entry.colliders[i],voxel=m.voxels.find(v=>v.id===cache.voxelIds[i]);if(!voxel)continue;
      const center=collider.translation(),q=collider.rotation(),up=new T.Vector3(0,1,0).applyQuaternion(new T.Quaternion(-q.x,-q.y,-q.z,q.w));
      const verticalSpan=m.gridM*(Math.abs(up.x)+Math.abs(up.y)+Math.abs(up.z));
      const fluid=fluidAt(center.x,center.y-verticalSpan/2+.0001,center.z),volume=voxel.volumeLiters/1000;totalVolume+=volume;
      if(!fluid||fluid.depth<=0)continue;
      const fraction=Math.min(1,fluid.depth/verticalSpan),density=(rt.progression?.catalog.get(fluid.type)?.massKgPerUnit??1)*1000;
      submerged+=volume*fraction;
      body.addForceAtPoint({x:0,y:density*volume*fraction*9.81,z:0},center,true);
    }
    if(submerged>0){
      const fraction=submerged/totalVolume,rate=Math.min(4*fraction,.9/dt),v=body.linvel(),mass=body.mass();
      body.addForce({x:-v.x*mass*rate,y:-v.y*mass*rate,z:-v.z*mass*rate},true);
    }
    const wind=rt.dungeons?.devices?.sampleAt(body.worldCom());
    if(wind?.windForceN>0){const direction=wind.windVelocity??{x:1,y:0,z:0},length=Math.hypot(direction.x,direction.y,direction.z);if(length>0)body.addForce({x:direction.x/length*wind.windForceN,y:direction.y/length*wind.windForceN,z:direction.z/length*wind.windForceN},true);}
  }
  capture() {
    for (const [id, { entry }] of this.bodies) {
      const body = entry.body;
      this.system.acceptPhysicsState(id, { position: xyz(body.translation()), rotation: { ...body.rotation() },
        velocity: xyz(body.linvel()), angularVelocity: xyz(body.angvel()) });
    }
  }
  hitColliders(cache, shape) {
    const R = this.R, q = new T.Quaternion(); let geometry;
    if (shape.kind === 'sphere') geometry = new R.Ball(shape.radiusM);
    else if (shape.kind === 'cylinder' || shape.kind === 'annular_cylinder') geometry = new R.Cylinder(shape.heightM / 2, shape.outerRadiusM ?? shape.radiusM);
    else if (shape.kind === 'oriented_box') {
      geometry = new R.Cuboid(...shape.halfSize);
      q.setFromRotationMatrix(new T.Matrix4().makeBasis(...shape.axes.map((a) => new T.Vector3(a.x, a.y, a.z))));
    } else return [];
    return cache.entry.colliders.flatMap((c, i) => {
      if (!c.intersectsShape(geometry, shape.center, q)) return [];
      if (shape.kind === 'annular_cylinder' && this.insideHole(c, shape)) return [];
      return [cache.voxelIds[i]];
    });
  }
  insideHole(c, shape) {
    // Clip the eight OBB vertices and twelve edges to the vertical attack slab.
    // Maximum horizontal distance of this clipped convex polytope occurs at a
    // vertex; this preserves a true cylindrical hole even for pitched machines.
    const q0 = c.rotation(), q = new T.Quaternion(q0.x, q0.y, q0.z, q0.w), p = c.translation(), h = c.shape.halfExtents;
    const corners = [];
    for (let x = -1; x <= 1; x += 2) for (let y = -1; y <= 1; y += 2) for (let z = -1; z <= 1; z += 2)
      corners.push(new T.Vector3(x * h.x, y * h.y, z * h.z).applyQuaternion(q).add(new T.Vector3(p.x, p.y, p.z)));
    const lo = shape.bottomY ?? shape.center.y - shape.heightM / 2, hi = lo + shape.heightM;
    const clipped = corners.filter((v) => v.y >= lo && v.y <= hi);
    for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) {
      const j = i ^ bit; if (j < i) continue;
      const a = corners[i], b = corners[j]; if (Math.abs(b.y - a.y) < 1e-10) continue;
      for (const y of [lo, hi]) { const t = (y - a.y) / (b.y - a.y); if (t >= 0 && t <= 1) clipped.push(a.clone().lerp(b, t)); }
    }
    return !clipped.some((v) => Math.hypot(v.x - shape.center.x, v.z - shape.center.z) > shape.innerRadiusM - 1e-7);
  }
  targets() {
    return [...this.bodies].map(([id, cache]) => {
      const m = this.system.machines.get(id), body = cache.entry.body;
      const hp = m.voxels.reduce((sum, v) => sum + v.hp, 0);
      return { id, ownerId: id, entityType: 'machine', hp, position: xyz(body.worldCom()), height: 0, radius: 0,
        intersectsShape: (shape) => { const ids = this.hitColliders(cache, shape); this.contacts.set(id, ids); return ids.length > 0; } };
    });
  }
  damage(event) {
    const id = event.targetId ?? event.ownerId, cache = this.bodies.get(id), m = this.system?.machines.get(id);
    if (!cache || !m || !Number.isFinite(event.amount) || event.amount <= 0 || !event.castId) return { ok: false, reason: 'invalid_machine_hit' };
    const ids = (this.contacts.get(id) ?? []).filter((id) => m.voxels.some((v) => v.id === id));
    if (!ids.length) return { ok: false, reason: 'no_contact_voxels' };
    const result = this.system.applyDamageEvent(id, `boss:${event.bossId}:${event.castId}`, Object.fromEntries(ids.map((v) => [v, event.amount / ids.length])), { energyType: event.energyType ?? 'mechanical' });
    if (result.ok && !result.duplicate && event.impulse) cache.entry.body.applyImpulse(event.impulse, true);
    this.sync(); return result;
  }
  dispose() {
    this.capture(); this.system?.setPhysicsDriver(null);
    for (const id of this.bodies.keys()) this.physics.adapter.removeOwner(id);
    this.bodies.clear(); this.contacts.clear();
  }
}
