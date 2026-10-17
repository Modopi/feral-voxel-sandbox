import { gripLimits } from "./impact.js";
import R from "./vendor/rapier/rapier.js";
import { colliderBoxes } from "./loose-voxels.js";
import { rotate } from "./machine/assembly-state.js";
// Shares the vehicle world: terrain, loose objects, machines and character queries collide.
export class LoosePhysics {
  constructor(owner) {
    this.owner = owner;
    this.entries = new Map();
    this.grip = null;
  }
  sync() {
    const { world, terrain, colliders } = this.owner,
      active = terrain.loose?.bodies || [];
    for (const [s, e] of this.entries)
      if (
        !active.includes(s) ||
        e.revision !== s.revision ||
        e.anchored !== s.pose.anchored
      ) {
        for (const h of e.handles) colliders.delete(h);
        world.removeRigidBody(e.body);
        this.entries.delete(s);
      }
    for (const s of active)
      if (!this.entries.has(s)) {
        const p = s.pose,
          desc = p.anchored
            ? R.RigidBodyDesc.fixed()
            : R.RigidBodyDesc.dynamic();
        desc
          .setTranslation(p.position.x, p.position.y, p.position.z)
          .setRotation(p.rotation)
          .setCcdEnabled(true)
          .setLinearDamping(0.1)
          .setAngularDamping(0.6);
        if (!p.anchored)
          desc
            .setLinvel(p.velocity.x, p.velocity.y, p.velocity.z)
            .setAngvel(p.spin);
        const body = world.createRigidBody(desc),
          handles = [];
        for (const box of colliderBoxes(s.cells)) {
          const c = world.createCollider(
            R.ColliderDesc.cuboid(box.half.x, box.half.y, box.half.z)
              .setTranslation(box.at.x, box.at.y, box.at.z)
              .setMass(box.mass)
              .setFriction(0.85)
              .setRestitution(0.06)
              .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
              .setContactForceEventThreshold(100),
            body,
          );
          handles.push(c.handle);
          colliders.set(c.handle, { loose: s });
        }
        this.entries.set(s, {
          body,
          handles,
          revision: s.revision,
          anchored: p.anchored,
        });
      }
    if (
      this.grip &&
      (!active.includes(this.grip.s) || this.grip.s.pose.anchored)
    )
      this.grip = null;
  }
  grab(hit, powered = false) {
    if (hit.body.pose.anchored) return false;
    this.sync();
    this.grip = {
      s: hit.body,
      powered,
      local: { ...hit.local },
      distance: Math.max(1.5, Math.min(powered ? 4 : 2.5, hit.distance)),
    };
    for (const h of this.entries.get(hit.body).handles)
      this.owner.world.getCollider(h).setFriction(0.35);
    return true;
  }
  get speedScale() {
    const g = this.grip,
      e = g && this.entries.get(g.s);
    return e ? gripLimits(e.body.mass(), g.powered).speedScale : 1;
  }
  push(hit, direction, powered = false) {
    this.sync();
    const body = this.entries.get(hit.body)?.body;
    if (!body || hit.body.pose.anchored) return false;
    const impulse = Math.min(body.mass() * 3, powered ? 2200 : 650);
    body.applyImpulseAtPoint(
      {
        x: direction.x * impulse,
        y: direction.y * impulse,
        z: direction.z * impulse,
      },
      { x: hit.point[0], y: hit.point[1], z: hit.point[2] },
      true,
    );
    return true;
  }
  release(direction) {
    const grip = this.grip;
    this.grip = null;
    const body = grip && this.entries.get(grip.s)?.body;
    if (body)
      for (const h of this.entries.get(grip.s).handles)
        this.owner.world.getCollider(h).setFriction(0.85);
    if (direction && body) {
      const speed = gripLimits(body.mass(), grip.powered).throwSpeed;
      body.applyImpulse(
        {
          x: direction.x * speed * body.mass(),
          y: direction.y * speed * body.mass(),
          z: direction.z * speed * body.mass(),
        },
        true,
      );
      this.owner.snapshot(grip.s, body);
    }
  }
  before(dt) {
    this.sync();
    if (!this.grip || !this.aim) return;
    const { s, local, distance } = this.grip,
      body = this.entries.get(s)?.body;
    if (!body) return;
    const offset = rotate(body.rotation(), local),
      p = body.translation(),
      anchor = { x: p.x + offset.x, y: p.y + offset.y, z: p.z + offset.z },
      v = body.velocityAtPoint(anchor),
      a = {};
    const target = {};
    for (const k of ["x", "y", "z"])
      target[k] = this.aim.origin[k] + this.aim.direction[k] * distance;
    if (
      Math.hypot(
        target.x - anchor.x,
        target.y - anchor.y,
        target.z - anchor.z,
      ) > 8
    ) {
      this.release();
      return;
    }
    for (const k of ["x", "y", "z"])
      a[k] = (target[k] - anchor[k]) * 30 - v[k] * 9 + (k === "y" ? 9.81 : 0);
    const scale =
      Math.min(
        1,
        Math.min(
          45,
          gripLimits(body.mass(), this.grip.powered).force / body.mass(),
        ) / Math.max(1, Math.hypot(a.x, a.y, a.z)),
      ) *
      body.mass() *
      dt;
    body.applyImpulseAtPoint(
      { x: a.x * scale, y: a.y * scale, z: a.z * scale },
      anchor,
      true,
    );
    const spin = body.angvel();
    body.setAngvel(
      { x: spin.x * 0.94, y: spin.y * 0.94, z: spin.z * 0.94 },
      true,
    );
  }
  after() {
    for (const [s, e] of this.entries) this.owner.snapshot(s, e.body);
  }
  canAdd(hit) {
    const { world } = this.owner,
      s = hit.body,
      q = s.pose.rotation;
    const local = {
        x: (hit.cell.x + hit.normal[0]) * 0.5,
        y: (hit.cell.y + hit.normal[1]) * 0.5,
        z: (hit.cell.z + hit.normal[2]) * 0.5,
      },
      p = rotate(q, local);
    for (const k of ["x", "y", "z"]) p[k] += s.pose.position[k];
    if (
      p.x < 0.25 ||
      p.x > 159.75 ||
      p.y < 1.25 ||
      p.y > 39.75 ||
      p.z < 0.25 ||
      p.z > 159.75
    )
      return false;
    return !world.intersectionWithShape(
      p,
      q,
      new R.Cuboid(0.245, 0.245, 0.245),
      undefined,
      undefined,
      undefined,
      undefined,
      (c) => !c.isSensor() && this.owner.colliders.get(c.handle)?.loose !== s,
    );
  }
}
