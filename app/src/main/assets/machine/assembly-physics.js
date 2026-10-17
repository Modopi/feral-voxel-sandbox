import R from "../vendor/rapier/rapier.js";
import { components } from "../structure.js";
import { createLab, TYPES, evaluate, damage } from "./model.js";
import { initialPose, rotate, worldPoint } from "./assembly-state.js";
await R.init();
const vector = (v) => ({ x: v.x, y: v.y, z: v.z });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Every connected structure owns a compound rigid body; fragments keep their momentum.
export class AssemblyPhysics {
  constructor(terrain) {
    this.terrain = terrain;
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.events = new R.EventQueue(true);
    this.bodies = new Map();
    this.colliders = new Map();
    this.ground = [];
    this.clock = 0;
  }
  dispose() {
    this.events.free();
    this.world.free();
    this.bodies.clear();
  }
  overlapsPart(point, rotation, source) {
    return !!this.world.intersectionWithShape(
      point,
      rotation,
      new R.Cuboid(0.245, 0.245, 0.245),
      undefined,
      undefined,
      undefined,
      undefined,
      (c) =>
        this.colliders.has(c.handle) &&
        this.colliders.get(c.handle).s !== source,
    );
  }
  moveCharacter(before, player) {
    if (!this.character) {
      this.character = this.world.createCharacterController(0.01);
      this.character.enableAutostep(0.55, 0.2, true);
      this.character.enableSnapToGround(0.08);
      this.characterCollider = this.world.createCollider(
        R.ColliderDesc.capsule(0.52, 0.23).setSensor(true),
      );
    }
    this.characterCollider.setTranslation({
      x: before.x,
      y: before.y + 0.75,
      z: before.z,
    });
    const delta = {
      x: player.x - before.x,
      y: player.y - before.y,
      z: player.z - before.z,
    };
    this.character.computeColliderMovement(this.characterCollider, delta);
    const move = this.character.computedMovement();
    player.x = before.x + move.x;
    player.y = before.y + move.y;
    player.z = before.z + move.z;
    if (this.character.computedGrounded()) {
      player.grounded = true;
      player.vy = 0;
    }
  }
  snapshot(s, body) {
    if (!s.pose) return;
    s.pose.position = vector(body.translation());
    s.pose.rotation = { ...body.rotation() };
    s.pose.velocity = vector(body.linvel());
    s.pose.spin = vector(body.angvel());
  }
  split(s) {
    s.fragments ||= [];
    s.fragments = s.fragments.filter((f) =>
      f.blueprint.some((p) => f.hp[p.id] > 0),
    );
    for (const source of [s, ...s.fragments]) {
      const live = source.blueprint.filter((p) => source.hp[p.id] > 0);
      if (live.length !== source.blueprint.length) {
        source.blueprint = live;
        source.hp = Object.fromEntries(
          live.map((p) => [p.id, source.hp[p.id]]),
        );
        source.revision++;
      }
      const groups = components(live).sort((a, b) => b.length - a.length);
      const retained =
        source === s
          ? groups.find((g) =>
              g.some(
                (p) => p.x === 0 && p.y === 0 && p.z === 0 && p.type === "hull",
              ),
            )
          : groups[0];
      const current = this.bodies.get(source);
      if (current) this.snapshot(source, current.body);
      for (const group of groups) {
        if (group === retained) continue;
        if (s.fragments.length >= 147) break;
        const fragment = createLab();
        fragment.assembly = true;
        fragment.blueprint = group;
        fragment.hp = Object.fromEntries(
          group.map((p) => [p.id, source.hp[p.id]]),
        );
        fragment.nextId = source.nextId;
        fragment.stock = 0;
        fragment.pose = structuredClone(source.pose);
        fragment.pose.anchored = false;
        if (current) {
          const [x, y, z] = evaluate(fragment).center;
          fragment.pose.velocity = vector(
            current.body.velocityAtPoint(worldPoint(source.pose, { x, y, z })),
          );
        }
        s.fragments.push(fragment);
        const ids = new Set(group.map((p) => p.id));
        source.blueprint = source.blueprint.filter((p) => !ids.has(p.id));
        for (const id of ids) delete source.hp[id];
        source.revision++;
      }
    }
  }
  sync(s) {
    let entry = this.bodies.get(s);
    if (entry && entry.revision === s.revision) {
      const type = s.pose.anchored
        ? R.RigidBodyType.Fixed
        : R.RigidBodyType.Dynamic;
      if (entry.body.bodyType() !== type) entry.body.setBodyType(type, true);
      return entry;
    }
    if (entry) {
      this.snapshot(s, entry.body);
      const [x, y, z] = evaluate(s).center;
      s.pose.velocity = vector(
        entry.body.velocityAtPoint(worldPoint(s.pose, { x, y, z })),
      );
      for (const c of entry.parts.keys()) this.colliders.delete(c);
      this.world.removeRigidBody(entry.body);
    }
    const pose = s.pose;
    const desc = (
      pose.anchored ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic()
    )
      .setTranslation(...["x", "y", "z"].map((k) => pose.position[k]))
      .setRotation(pose.rotation)
      .setLinvel(...["x", "y", "z"].map((k) => pose.velocity[k]))
      .setAngvel(pose.spin)
      .setLinearDamping(0.15)
      .setAngularDamping(0.7)
      .setCcdEnabled(true);
    const body = this.world.createRigidBody(desc),
      parts = new Map();
    for (const part of s.blueprint) {
      if (s.hp[part.id] <= 0) continue;
      const desc = (
        part.type === "wheel"
          ? R.ColliderDesc.ball(0.28)
          : R.ColliderDesc.cuboid(0.245, 0.245, 0.245)
      )
        .setTranslation(part.x * 0.5, part.y * 0.5 + 0.25, part.z * 0.5)
        .setMass(TYPES[part.type].mass)
        .setFriction(part.type === "wheel" ? 0.06 : 0.4)
        .setFrictionCombineRule(R.CoefficientCombineRule.Min)
        .setRestitution(0.05)
        .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(4000);
      const c = this.world.createCollider(desc, body);
      parts.set(c.handle, part);
      this.colliders.set(c.handle, { s, part });
    }
    entry = { body, parts, revision: s.revision };
    this.bodies.set(s, entry);
    return entry;
  }
  terrainAround(s) {
    const tiles = new Set();
    for (const obj of [s, ...(s.fragments || [])]) {
      const p = obj.pose.position,
        cx = Math.floor(p.x / 8),
        cz = Math.floor(p.z / 8);
      for (let z = cz - 2; z <= cz + 2; z++)
        for (let x = cx - 2; x <= cx + 2; x++)
          if (x >= 0 && x < 20 && z >= 0 && z < 20) tiles.add(`${x},${z}`);
    }
    const stamps = [...tiles].sort().map((tile) => {
      const [x, z] = tile.split(",").map(Number);
      return (
        tile +
        ":" +
        (this.terrain.collisionChunks?.get(`${x >> 1},${z >> 1}`) || 0)
      );
    });
    const key =
      stamps.join("|") +
      (!this.terrain.collisionChunks
        ? this.terrain.collisionRevision || 0
        : "");
    if (key === this.terrainKey) return;
    this.terrainKey = key;
    for (const c of this.ground) this.world.removeCollider(c, false);
    this.ground = [];
    const add = (x, y, z, hx, hy, hz) =>
      this.ground.push(
        this.world.createCollider(
          R.ColliderDesc.cuboid(hx, hy, hz)
            .setTranslation(x, y, z)
            .setFriction(0.8),
        ),
      );
    const w = this.terrain;
    // Merge vertical runs; fine edits retain exact half-metre collision geometry.
    for (const tile of tiles) {
      const [tx, tz] = tile.split(",").map(Number);
      for (let z = tz * 8; z < tz * 8 + 8; z++)
        for (let x = tx * 8; x < tx * 8 + 8; x++) {
          if (!w.getCell) {
            const h = w.surface(x, z);
            add(x + 0.5, h / 2, z + 0.5, 0.5, h / 2, 0.5);
            continue;
          }
          let start = -1;
          for (let y = 0; y <= 40; y++) {
            const fine = y < 40 && w.subcells?.has(w.index(x, y, z));
            const solid = y < 40 && !fine && !!w.get(x, y, z);
            if (solid && start < 0) start = y;
            if (!solid && start >= 0) {
              add(x + 0.5, (y + start) / 2, z + 0.5, 0.5, (y - start) / 2, 0.5);
              start = -1;
            }
            if (fine)
              for (let dz = 0; dz < 2; dz++)
                for (let dx = 0; dx < 2; dx++)
                  for (let dy = 0; dy < 2; dy++)
                    if (w.getCell(x * 2 + dx, y * 2 + dy, z * 2 + dz))
                      add(
                        x + dx * 0.5 + 0.25,
                        y + dy * 0.5 + 0.25,
                        z + dz * 0.5 + 0.25,
                        0.25,
                        0.25,
                        0.25,
                      );
          }
        }
    }
    // World borders are physical, not a teleport clamp.
    for (const [x, z, hx, hz] of [
      [-0.5, 80, 0.5, 80],
      [160.5, 80, 0.5, 80],
      [80, -0.5, 80, 0.5],
      [80, 160.5, 80, 0.5],
    ])
      add(x, 40, z, hx, 40, hz);
  }
  step(s, dt, input = {}, riding = false, airborne = false) {
    if (!s?.pose) return;
    this.clock += dt;
    this.split(s);
    const active = [s, ...(s.fragments || [])];
    for (const [old, entry] of this.bodies)
      if (!active.includes(old)) {
        for (const c of entry.parts.keys()) this.colliders.delete(c);
        this.world.removeRigidBody(entry.body);
        this.bodies.delete(old);
      }
    const entry = this.sync(s);
    for (const fragment of s.fragments || []) this.sync(fragment);
    this.terrainAround(s);
    for (const obj of active) {
      const body = this.bodies.get(obj).body;
      body.resetForces(false);
      body.resetTorques(false);
    }
    const body = entry.body,
      f = evaluate(s),
      q = body.rotation(),
      vel = body.linvel();
    const forward = rotate(q, { x: 0, y: 0, z: -1 }),
      right = rotate(q, { x: 1, y: 0, z: 0 }),
      up = rotate(q, { x: 0, y: 1, z: 0 });
    let grounded = 0;
    for (const [handle, part] of entry.parts)
      if (part.type === "wheel" && f.connected.has(part.id)) {
        this.world.contactPairsWith(this.world.getCollider(handle), (other) =>
          this.world.contactPair(this.world.getCollider(handle), other, (m) => {
            if (m.numContacts() > 0) grounded++;
          }),
        );
      }
    if (riding && !s.pose.anchored) {
      if (grounded) {
        const force = f.power * f.grip * clamp(input.forward || 0, -1, 1),
          lateral = vel.x * right.x + vel.z * right.z;
        body.addForce(
          {
            x: forward.x * force - right.x * lateral * f.mass * 4,
            y: 0,
            z: forward.z * force - right.z * lateral * f.mass * 4,
          },
          true,
        );
        const speed = vel.x * forward.x + vel.z * forward.z;
        const turn = -(input.side || 0) * f.steering * clamp(speed / 2, -1, 1);
        body.addTorque(
          { x: 0, y: (turn - body.angvel().y) * f.inertia[1] * 5, z: 0 },
          true,
        );
        if (input.jump)
          body.addForce(
            { x: -vel.x * f.mass * 8, y: 0, z: -vel.z * f.mass * 8 },
            true,
          );
      }
      if (airborne && f.power > 0) {
        const throttle = input.down ? 0.55 : input.jump || input.up ? 1.4 : 1;
        for (const part of s.blueprint)
          if (part.type === "rotor" && f.connected.has(part.id)) {
            const lift =
              700 *
              (s.hp[part.id] / TYPES.rotor.hp) *
              Math.min(1, f.power / 600) *
              throttle;
            body.addForceAtPoint(
              { x: up.x * lift, y: up.y * lift, z: up.z * lift },
              worldPoint(s.pose, {
                x: part.x * 0.5,
                y: part.y * 0.5 + 0.25,
                z: part.z * 0.5,
              }),
              true,
            );
          }
        body.addForce(
          {
            x: forward.x * (input.forward || 0) * f.power * 0.35,
            y: 0,
            z: forward.z * (input.forward || 0) * f.power * 0.35,
          },
          true,
        );
        body.addTorque(
          { x: 0, y: -(input.side || 0) * f.mass * 1.5, z: 0 },
          true,
        );
      }
    }
    this.world.timestep = dt;
    this.world.step(this.events);
    this.events.drainContactForceEvents((event) => {
      for (const handle of [event.collider1(), event.collider2()]) {
        const hit = this.colliders.get(handle);
        if (hit && this.clock >= (hit.s.impactAt || 0)) {
          damage(
            hit.s,
            hit.part.id,
            Math.min(50, (event.totalForceMagnitude() - 4000) * dt * 0.03),
          );
          hit.s.impactAt = this.clock + 0.4;
        }
      }
    });
    for (const obj of active) this.snapshot(obj, this.bodies.get(obj).body);
    this.speed = Math.hypot(vel.x, vel.y, vel.z);
    this.grounded = grounded;
  }
}
export { initialPose, worldPoint, rotate };
