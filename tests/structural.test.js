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
  restore,
  serialize,
} from "../app/src/main/assets/machine/model.js";
import { initialPose } from "../app/src/main/assets/machine/assembly-state.js";
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
test("lost left/front support lowers that side rather than the healthy side", () => {
  const { eco, e } = animal();
  cut(eco, e, 2, 0);
  assert.ok(condition(e).roll > 0);
  assert.ok(condition(e).pitch < 0);
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
