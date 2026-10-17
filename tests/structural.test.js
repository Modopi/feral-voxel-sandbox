import test from "node:test";
import assert from "node:assert/strict";
import { World, B } from "../app/src/main/assets/world.js";
import {
  Ecology,
  SPECIES,
  cellPosition,
  toWorld,
  toLocal,
  condition,
} from "../app/src/main/assets/entities.js";
import {
  createLab,
  preset,
  damage,
  evaluate,
  restore,
  serialize,
} from "../app/src/main/assets/machine/model.js";
import {
  AssemblyPhysics,
  initialPose,
} from "../app/src/main/assets/machine/assembly-physics.js";
const flat = () => {
  const w = new World(12);
  w.surface = () => 10;
  w.get = () => 0;
  return w;
};
function animal(type = 0) {
  const w = flat(),
    eco = new Ecology(w),
    e = eco.spawn(type, 77, 87);
  e.yaw = 0;
  e.moving = 0;
  e.age = 40;
  e.lastThink = 100;
  return { w, eco, e };
}
function cut(eco, e, part, voxel) {
  const p = SPECIES[e.type].parts[part];
  return eco.damageHit(
    {
      entity: e,
      part,
      voxel,
      layer: "structure", node: `${part}:${voxel}`,
      point: toWorld(e, p, part, cellPosition(p, voxel), 0),
    },
    0,
    0.01,
    24,
  );
}
function machine(y = 10.06) {
  const s = createLab();
  preset(s);
  s.assembly = true;
  s.pose = initialPose(77, y, 87);
  return s;
}
test("a missing foot disables support before the whole leg detaches, changing speed and posture", () => {
  const { eco, e } = animal();
  const intact = condition(e);
  cut(eco, e, 2, 0);
  assert.equal(e.lost & (1 << 2), 0);
  assert.equal(eco.legs(e), 3);
  assert.equal(condition(e).mode, "limp");
  assert.ok(condition(e).mass < intact.mass);
  assert.ok(condition(e).speed < 0.6);
  assert.notEqual(condition(e).roll, 0);
  e.fear = 0;
  e.targetZ = e.z - 10;
  const z = e.z;
  eco.update(1, e, 0);
  assert.ok(z - e.z < e.speed * 0.6);
  assert.match(e.behavior, /절뚝/);
});
test("severing a joint drops the disconnected foot and all missing supports stop pursuit immediately", () => {
  const { eco, e } = animal(1);
  cut(eco, e, 2, 1);
  assert.ok(e.lost & (1 << 2));
  for (const pi of [3, 4, 5]) cut(eco, e, pi, 0);
  assert.equal(condition(e).mode, "immobile");
  e.targetX = e.x + 10;
  e.targetZ = e.z + 10;
  const p = [e.x, e.z];
  eco.update(1, e, 0);
  assert.deepEqual([e.x, e.z], p);
  assert.equal(e.moving, 0);
  assert.match(e.behavior, /이동 불가/);
});
test("support arrangement changes crawl capability; save/load retains wounds and recomputes anatomy", () => {
  const a = animal(),
    b = animal();
  for (const pi of [2, 5]) cut(a.eco, a.e, pi, 0);
  for (const pi of [2, 4]) cut(b.eco, b.e, pi, 0);
  assert.ok(condition(a.e).speed > condition(b.e).speed);
  const loaded = new Ecology(a.w);
  loaded.load(JSON.parse(JSON.stringify(a.eco.save())));
  assert.deepEqual(condition(loaded.entities[0]), condition(a.e));
});
test("lowered and tilted body coordinates round-trip for ray hits on animated limbs", () => {
  const { eco, e } = animal();
  cut(eco, e, 2, 0);
  cut(eco, e, 4, 0);
  e.yaw = 1.4;
  e.moving = 1;
  for (let pi = 0; pi < SPECIES[0].parts.length; pi++) {
    const p = SPECIES[0].parts[pi],
      v = cellPosition(p, 0),
      back = toLocal(e, p, pi, toWorld(e, p, pi, v, 2), 2);
    v.forEach((x, i) => assert.ok(Math.abs(x - back[i]) < 1e-10));
  }
});
test("an entity killed by its decision step cannot take one last movement step", () => {
  const { eco, e } = animal();
  e.lastThink = 0;
  e.hp = 0;
  e.targetX = e.x + 10;
  const x = e.x;
  eco.update(1, e, 1);
  assert.equal(e.x, x);
  assert.ok(e.dead);
  assert.equal(e.moving, 0);
});
test("a released assembly falls and lands without being attached to a player", () => {
  const s = machine(13),
    physics = new AssemblyPhysics({ surface: () => 10 });
  s.pose.anchored = false;
  for (let i = 0; i < 180; i++) physics.step(s, 1 / 60);
  assert.ok(s.pose.position.y > 9.9 && s.pose.position.y < 10.3);
  assert.ok(Math.abs(s.pose.velocity.y) < 0.5);
  assert.ok(physics.bodies.get(s).body.mass() > 80);
  physics.dispose();
});
test("motor damage prevents powered motion while an intact assembly drives and steers", () => {
  const positions = [];
  for (const broken of [false, true]) {
    const s = machine(),
      physics = new AssemblyPhysics({ surface: () => 10 });
    s.pose.anchored = false;
    if (broken) damage(s, s.blueprint.find((p) => p.type === "motor").id, 100);
    for (let i = 0; i < 120; i++)
      physics.step(s, 1 / 60, { forward: 1, side: 0.15 }, true);
    positions.push(Math.hypot(s.pose.position.x - 77, s.pose.position.z - 87));
    physics.dispose();
  }
  assert.ok(positions[0] > 2, JSON.stringify(positions));
  assert.ok(positions[1] < 0.5, JSON.stringify(positions));
});
test("a broken bridge splits a rigid body; mass, fragments and six-axis transforms survive reload", () => {
  const s = machine(),
    physics = new AssemblyPhysics({ surface: () => 10 });
  const end = s.blueprint.find((p) => p.x === 0 && p.z === -1 && p.y === 0);
  const before = evaluate(s).mass;
  damage(s, end.id, 100);
  physics.step(s, 1 / 60);
  assert.equal(s.fragments.length, 2);
  assert.ok(evaluate(s).mass < before);
  assert.equal(physics.bodies.size, 3);
  const loaded = restore(serialize(s));
  assert.deepEqual(loaded.pose, s.pose);
  assert.equal(loaded.fragments.length, 2);
  assert.deepEqual(
    loaded.fragments.map((f) => f.pose),
    s.fragments.map((f) => f.pose),
  );
  physics.dispose();
});
test("terrain removal updates real colliders and an anchored structure stays still until released", () => {
  const w = new World(1);
  for (let x = 60; x < 95; x++)
    for (let z = 70; z < 100; z++) w.set(x, 9, z, B.STONE);
  const s = machine(),
    physics = new AssemblyPhysics(w);
  physics.step(s, 1 / 60);
  for (let x = 74; x < 81; x++) for (let z = 84; z < 91; z++) w.set(x, 9, z, 0);
  for (let i = 0; i < 30; i++) physics.step(s, 1 / 60);
  assert.equal(s.pose.position.y, Math.fround(10.06));
  s.pose.anchored = false;
  for (let i = 0; i < 45; i++) physics.step(s, 1 / 60);
  assert.ok(s.pose.position.y < 8);
  physics.dispose();
});

test("lost left/front support lowers that side rather than the healthy side", () => {
  const { eco, e } = animal();
  cut(eco, e, 2, 0);
  assert.ok(condition(e).roll > 0);
  assert.ok(condition(e).pitch < 0);
});
test("walking collides with the actual assembly and can stand on top", () => {
  const s = machine(),
    physics = new AssemblyPhysics({ surface: () => 10 });
  physics.step(s, 1 / 60);
  const before = { x: 77, y: 10, z: 90 },
    p = { x: 77, y: 10, z: 86, vy: 0 };
  physics.moveCharacter(before, p);
  assert.ok(p.z > 87.4 || p.y > 10.4, JSON.stringify(p));
  const above = { x: 77, y: 12, z: 87 },
    landing = { x: 77, y: 9, z: 87, vy: -2 };
  physics.moveCharacter(above, landing);
  assert.ok(landing.y > 10.9);
  assert.equal(landing.vy, 0);
  physics.dispose();
});
test("balanced rotors lift the body and losing one changes its angular motion", () => {
  const s = machine(),
    physics = new AssemblyPhysics({ surface: () => 10 });
  for (const x of [-1, 1]) {
    const p = { id: `p${s.nextId++}`, x, y: 1, z: 0, type: "rotor" };
    s.blueprint.push(p);
    s.hp[p.id] = 50;
  }
  s.revision++;
  s.pose.anchored = false;
  for (let i = 0; i < 60; i++)
    physics.step(s, 1 / 60, { up: true }, true, true);
  assert.ok(s.pose.position.y > 12);
  const r = s.blueprint.find((p) => p.type === "rotor");
  damage(s, r.id, 50);
  for (let i = 0; i < 30; i++)
    physics.step(s, 1 / 60, { up: true }, true, true);
  assert.ok(Math.hypot(s.pose.spin.x, s.pose.spin.z) > 0.5);
  physics.dispose();
});
test("a fragment can break again and no disconnected part retains powered function", () => {
  const s = machine(),
    physics = new AssemblyPhysics({ surface: () => 10 });
  damage(
    s,
    s.blueprint.find((p) => p.x === 0 && p.y === 0 && p.z === 0).id,
    100,
  );
  physics.step(s, 1 / 60);
  assert.equal(evaluate(s).power, 0);
  assert.ok(s.fragments.length >= 3);
  const fragment = s.fragments.find((f) => f.blueprint.length >= 3),
    bridge = fragment.blueprint.find((p) => p.type === "hull");
  const count = s.fragments.length;
  damage(fragment, bridge.id, 100);
  physics.step(s, 1 / 60);
  assert.ok(s.fragments.length > count);
  physics.dispose();
});
test("invalid rigid transforms are rejected before entering the physics engine", () => {
  const s = machine();
  s.pose.velocity.x = 1e300;
  assert.throws(() => restore(serialize(s)));
  s.pose.velocity.x = 0;
  s.pose.rotation.w = 0;
  assert.throws(() => restore(serialize(s)));
});

test("old saves with destroyed body attachment points cannot retain functional floating legs", () => {
  const { eco, e } = animal();
  e.damage[0] = new Uint8Array(SPECIES[0].parts[0].count).fill(1);
  // Remove the lower left/front body cell adjacent to the left front hip.
  e.damage[0][0] = 0;
  const loaded = new Ecology(flat());
  const legacy=JSON.parse(JSON.stringify(eco.save()));
  delete legacy.entities[0].structure;
  loaded.load(legacy);
  assert.ok(loaded.entities[0].lost & (1 << 2));
  assert.equal(condition(loaded.entities[0]).legs, 3);
});
