import R from "./vendor/rapier/rapier.js";
import { impactEnergy, IMPACT_TOUGHNESS } from "./impact.js";
import { damage } from "./machine/model.js";
import { rotate } from "./machine/assembly-state.js";
const vec = (v) => ({ x: v.x, y: v.y, z: v.z });
// Contact forces wake the detector; damage uses the pre-impact normal velocity,
// not persistent support force. Each object has a short impact cooldown.
export class ImpactPhysics {
  constructor(owner) {
    this.owner = owner;
    this.actors = new Map();
    this.actorHandles = new Map();
    this.beforeBodies = new Map();
    this.pending = [];
    this.cooldowns = new WeakMap();
    this.clock = 0;
    this.terrainCooldown = new Map();
  }
  before(dt) {
    this.clock += dt;
    const { world } = this.owner,
      specs = this.owner.impactActors || [],
      keys = new Set(specs.map((s) => s.id));
    for (const [id, e] of this.actors)
      if (!keys.has(id)) {
        world.removeRigidBody(e.body);
        this.actorHandles.delete(e.collider.handle);
        this.actors.delete(id);
      }
    for (const spec of specs) {
      let e = this.actors.get(spec.id);
      if (!e) {
        const body = world.createRigidBody(
          R.RigidBodyDesc.kinematicPositionBased().setTranslation(
            spec.position.x,
            spec.position.y,
            spec.position.z,
          ),
        );
        const collider = world.createCollider(
          R.ColliderDesc.capsule(
            Math.max(0, spec.height / 2 - spec.radius),
            spec.radius,
          )
            .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
            .setContactForceEventThreshold(100),
          body,
        );
        e = { body, collider, spec };
        this.actors.set(spec.id, e);
        this.actorHandles.set(collider.handle, e);
      }
      e.spec = spec;
      const previous = e.body.translation(),
        delta = {
          x: spec.position.x - previous.x,
          y: spec.position.y - previous.y,
          z: spec.position.z - previous.z,
        };
      const teleported = Math.hypot(delta.x, delta.y, delta.z) > 1.5;
      e.velocity = teleported
        ? { x: 0, y: 0, z: 0 }
        : { x: delta.x / dt, y: delta.y / dt, z: delta.z / dt };
      if (teleported) e.body.setTranslation(spec.position, true);
      e.body.setNextKinematicTranslation(spec.position);
      e.collider.setShape(
        new R.Capsule(Math.max(0, spec.height / 2 - spec.radius), spec.radius),
      );
    }
    this.beforeBodies.clear();
    for (const e of [
      ...this.owner.bodies.values(),
      ...this.owner.loose.entries.values(),
    ]) {
      const b = e.body;
      this.beforeBodies.set(b.handle, {
        mass: b.isDynamic() ? b.mass() : Infinity,
        velocity: vec(b.linvel()),
        spin: vec(b.angvel()),
        center: vec(b.worldCom()),
      });
    }
    this.pending = [];
  }
  collect(event) {
    const { world, colliders } = this.owner,
      a = world.getCollider(event.collider1()),
      b = world.getCollider(event.collider2());
    if (!a || !b) return;
    const atA = colliders.get(a.handle),
      atB = colliders.get(b.handle);
    if (!atA && !atB) return;
    const actorA = this.actorHandles.get(a.handle)?.spec,
      actorB = this.actorHandles.get(b.handle)?.spec;
    const pre = (c) => {
        const actor = this.actorHandles.get(c.handle);
        return actor
          ? {
              mass: actor.spec.mass,
              velocity: actor.velocity,
              spin: { x: 0, y: 0, z: 0 },
              center: actor.spec.position,
            }
          : this.beforeBodies.get(c.parent()?.handle);
      },
      pa = pre(a),
      pb = pre(b);
    world.contactPair(a, b, (manifold, flipped) => {
      if (!manifold.numSolverContacts()) return;
      const point = vec(manifold.solverContactPoint(0)),
        n = manifold.normal();
      const velocity = (state) => {
        if (!state) return { x: 0, y: 0, z: 0 };
        const r = {
            x: point.x - state.center.x,
            y: point.y - state.center.y,
            z: point.z - state.center.z,
          },
          v = state.velocity,
          w = state.spin;
        return {
          x: v.x + w.y * r.z - w.z * r.y,
          y: v.y + w.z * r.x - w.x * r.z,
          z: v.z + w.x * r.y - w.y * r.x,
        };
      };
      const va = velocity(pa),
        vb = velocity(pb),
        speed = Math.max(
          0,
          ((va.x - vb.x) * n.x + (va.y - vb.y) * n.y + (va.z - vb.z) * n.z) *
            (flipped ? -1 : 1),
        );
      const energy = impactEnergy(
        actorA?.mass || pa?.mass || Infinity,
        actorB?.mass || pb?.mass || Infinity,
        speed,
        atA?.part?.type === "wheel" || atB?.part?.type === "wheel" ? 8 : 4,
      );
      if (energy <= 0) return;
      this.pending.push({
        atA,
        atB,
        actorA,
        actorB,
        point,
        energy,
        speed,
        normal: vec(n),
        ground: (!atA && !actorA) || (!atB && !actorB),
      });
    });
  }
  flush() {
    // The strongest contact wins when a compound body has several contacting cells.
    this.pending.sort((a, b) => b.energy - a.energy);
    for (const hit of this.pending) {
      const { energy, point } = hit;
      if (hit.ground) {
        const w = this.owner.terrain,
          n = hit.normal;
        for (const sign of [-1, 1]) {
          const p = [
            point.x + n.x * 0.04 * sign,
            point.y + n.y * 0.04 * sign,
            point.z + n.z * 0.04 * sign,
          ].map((v) => Math.floor(v * 2));
          const b = w.getCell?.(...p);
          if (!b || b === 9 || p[1] < 2) continue;
          const key = p.join(",");
          if (this.clock < (this.terrainCooldown.get(key) || 0)) break;
          this.terrainCooldown.set(key, this.clock + 0.35);
          const result = w.strikeMining(
            { hx: p[0], hy: p[1], hz: p[2] },
            0.5,
            (mat) => (energy * 0.35) / IMPACT_TOUGHNESS[mat],
          );
          for (const [mat, count] of result.counts)
            for (let i = 0; i < count; i++)
              this.owner.onVoxelImpact?.(mat, point);
          break;
        }
      }
      for (const actor of [hit.actorA, hit.actorB])
        if (actor && this.clock >= (this.cooldowns.get(actor.key) || 0)) {
          this.cooldowns.set(actor.key, this.clock + 0.45);
          this.owner.onActorImpact?.(actor, {
            energy,
            point,
            speed: hit.speed,
          });
        }
      for (const entry of [hit.atA, hit.atB]) {
        const s = entry?.loose || entry?.s;
        if (!s || this.clock < (this.cooldowns.get(s) || 0)) continue;
        this.cooldowns.set(s, this.clock + 0.3);
        if (entry.s) {
          damage(s, entry.part.id, Math.min(60, energy / 180));
          continue;
        }
        if (!this.owner.terrain.loose.bodies.includes(s)) continue;
        const q = s.pose.rotation,
          local = rotate(
            { x: -q.x, y: -q.y, z: -q.z, w: q.w },
            {
              x: point.x - s.pose.position.x,
              y: point.y - s.pose.position.y,
              z: point.z - s.pose.position.z,
            },
          );
        const cell = s.cells.reduce((best, c) =>
          Math.hypot(
            c.x * 0.5 - local.x,
            c.y * 0.5 - local.y,
            c.z * 0.5 - local.z,
          ) <
          Math.hypot(
            best.x * 0.5 - local.x,
            best.y * 0.5 - local.y,
            best.z * 0.5 - local.z,
          )
            ? c
            : best,
        );
        if (
          this.owner.terrain.loose.strike(
            { body: s, cell },
            (energy * 0.65) / IMPACT_TOUGHNESS[cell.b],
          )
        )
          this.owner.onVoxelImpact?.(cell.b, point);
      }
    }
    this.pending = [];
    for (const [key, t] of this.terrainCooldown)
      if (t < this.clock) this.terrainCooldown.delete(key);
  }
}
