import test from "node:test";
import assert from "node:assert/strict";
import { World, B } from "../app/src/main/assets/world.js";
import {
  colliderBoxes,
  massCenter,
} from "../app/src/main/assets/loose-voxels.js";
import { impactEnergy, gripLimits } from "../app/src/main/assets/impact.js";
import { AssemblyPhysics } from "../app/src/main/assets/machine/assembly-physics.js";
import {
  Ecology,
  cellPosition,
  toWorld,
  SPECIES,
} from "../app/src/main/assets/entities.js";
const settleQueue = (w) => {
  let n = 0;
  while (w.loose.pending.size || w.loose.job) {
    w.loose.tick(256);
    assert.ok(n++ < 1000, "connectivity work terminates");
  }
};
const cell = (x, y, z, b = B.WOOD) => ({ x, y, z, b });
function floorWorld() {
  const w = new World(1);
  for (let z = 70; z < 90; z++)
    for (let x = 70; x < 90; x++) w.set(x, 1, z, B.STONE);
  return w;
}
test("cutting the last support converts the whole island, retaining material and mining damage", () => {
  const w = floorWorld();
  w.setCell(160, 4, 160, B.WOOD);
  w.setCell(160, 5, 160, B.WOOD);
  w.setCell(161, 5, 160, B.STONE);
  w.miningDamage.set(w.damageKey(161, 5, 160), [B.STONE, 0.3]);
  w.loose.enabled = true;
  w.setCell(160, 4, 160, 0);
  settleQueue(w);
  assert.equal(w.loose.bodies.length, 1);
  const s = w.loose.bodies[0];
  assert.equal(s.cells.length, 2);
  assert.equal(s.cells.find((c) => c.b === B.STONE).damage, 0.3);
  assert.equal(w.getCell(160, 5, 160), 0);
  assert.equal(w.get(80, 1, 80), B.STONE);
  assert.equal(massCenter(s.cells).mass, 375);
});
test("a second support prevents detachment, and connectivity work resumes after a save", () => {
  const w = floorWorld();
  for (let x = 160; x < 165; x++) w.setCell(x, 6, 160, B.PLANK);
  for (const x of [160, 164])
    for (let y = 4; y < 6; y++) w.setCell(x, y, 160, B.WOOD);
  w.loose.enabled = true;
  w.setCell(160, 4, 160, 0);
  settleQueue(w);
  assert.equal(w.loose.bodies.length, 0);
  w.setCell(164, 4, 160, 0);
  w.loose.tick(1);
  const saved = w.save(),
    copy = floorWorld();
  copy.load(saved);
  copy.loose.enabled = true;
  settleQueue(copy);
  assert.equal(copy.loose.bodies.length, 1);
  assert.equal(copy.loose.bodies[0].cells.length, 7);
});
test("further cuts split bodies without creating resources or losing angular momentum", () => {
  const w = new World(),
    s = w.loose.create([cell(0, 0, 0), cell(1, 0, 0), cell(2, 0, 0)], {
      x: 80,
      y: 10,
      z: 80,
    });
  s.pose.velocity = { x: 2, y: 0, z: 0 };
  s.pose.spin = { x: 0, y: 0, z: 2 };
  const hit = { body: s, cell: s.cells[1] };
  assert.equal(w.loose.strike(hit, 0.4), false);
  assert.equal(w.loose.strike(hit, 0.6), true);
  assert.equal(w.loose.bodies.length, 2);
  assert.equal(
    w.loose.bodies.reduce((n, s) => n + s.cells.length, 0),
    2,
  );
  assert.equal(w.loose.bodies[0].pose.velocity.y, -1);
  assert.equal(w.loose.bodies[1].pose.velocity.y, 1);
  assert.equal(w.loose.strike(hit, 1), false);
});
test("rotated bodies raycast in their own coordinates; nearest terrain can occlude them", () => {
  const w = new World(),
    s = w.loose.create([cell(0, 0, 0), cell(1, 0, 0)], { x: 80, y: 8, z: 80 });
  s.pose.rotation = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
  const hit = w.loose.raycast({ x: 80, y: 8, z: 82 }, { x: 0, y: 0, z: -1 }, 6);
  assert.equal(hit.cell, s.cells[0]);
  assert.ok(Math.abs(hit.distance - 1.75) < 1e-6);
  assert.deepEqual(hit.normal, [-1, 0, 0]);
  assert.equal(
    w.loose.raycast({ x: 80, y: 8, z: 82 }, { x: 0, y: 0, z: -1 }, 1),
    null,
  );
});
test("compound collider merging preserves occupied volume and material mass", () => {
  const cells = [];
  for (let x = 0; x < 4; x++)
    for (let y = 0; y < 2; y++)
      for (let z = 0; z < 3; z++) cells.push(cell(x, y, z));
  const boxes = colliderBoxes(cells);
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].mass, 1800);
  assert.equal(boxes[0].half.x * boxes[0].half.y * boxes[0].half.z * 8, 3);
});
test("saved bodies preserve pose, pins and partial damage; malformed data is rejected", () => {
  const w = new World(),
    s = w.loose.create([cell(0, 0, 0)], { x: 20, y: 10, z: 20 });
  s.cells[0].damage = 0.25;
  s.pose.anchored = true;
  const copy = new World();
  copy.load(w.save());
  assert.deepEqual(copy.loose.bodies, w.loose.bodies);
  const bad = w.save();
  bad.loose.bodies[0].pose.rotation.w = 0;
  assert.throws(() => new World().load(bad), /회전/);
});
test("physical fall causes one resource-conserving impact, resting contact does not keep damaging", () => {
  const w = floorWorld(),
    s = w.loose.create([cell(0, 0, 0)], { x: 80, y: 12, z: 80 }),
    physics = new AssemblyPhysics(w);
  let chips = 0;
  physics.onVoxelImpact = () => chips++;
  try {
    for (let i = 0; i < 240; i++) physics.step(null, 1 / 60);
    assert.equal(chips, 1);
    assert.equal(w.loose.bodies.length, 0);
    assert.ok(!physics.loose.entries.size);
  } finally {
    physics.dispose();
  }
  const resting = floorWorld(),
    r = resting.loose.create([cell(0, 0, 0)], { x: 80, y: 2.25, z: 80 }),
    p = new AssemblyPhysics(resting);
  try {
    for (let i = 0; i < 180; i++) p.step(null, 1 / 60);
    assert.equal(r.cells[0].damage || 0, 0);
    assert.ok(Math.abs(r.pose.position.y - 2.25) < 0.04);
  } finally {
    p.dispose();
  }
});
test("mass-limited grabbing lifts a light object while a heavy stone stays on the ground and can be pushed", () => {
  const w = floorWorld(),
    light = w.loose.create([cell(0, 0, 0)], { x: 78, y: 2.25, z: 80 }),
    heavy = w.loose.create(
      Array.from({ length: 8 }, (_, i) =>
        cell(i % 2, Math.floor(i / 2) % 2, Math.floor(i / 4), B.STONE),
      ),
      { x: 82, y: 2.25, z: 80 },
    ),
    p = new AssemblyPhysics(w);
  try {
    p.step(null, 1 / 60);
    p.loose.grab({ body: light, local: { x: 0, y: 0, z: 0 }, distance: 2 });
    p.loose.aim = {
      origin: { x: 78, y: 4, z: 82 },
      direction: { x: 0, y: 0, z: -1 },
    };
    for (let i = 0; i < 90; i++) p.step(null, 1 / 60);
    assert.ok(light.pose.position.y > 3.5);
    p.loose.release();
    p.loose.grab({ body: heavy, local: { x: 0, y: 0, z: 0 }, distance: 2 });
    p.loose.aim = {
      origin: { x: 82, y: 5, z: 82 },
      direction: { x: 0, y: 0, z: -1 },
    };
    for (let i = 0; i < 90; i++) p.step(null, 1 / 60);
    assert.ok(heavy.pose.position.y < 2.5);
    assert.ok(p.loose.speedScale < 0.6);
    p.loose.release();
    const x = heavy.pose.position.x;
    p.loose.push(
      { body: heavy, point: [x, 2.5, 80.25] },
      { x: 1, y: 0, z: 0 },
      true,
    );
    for (let i = 0; i < 30; i++) p.step(null, 1 / 60);
    assert.ok(heavy.pose.position.x > x + 0.01);
  } finally {
    p.dispose();
  }
});
test("momentum damages contacted actors once and is not triggered by support force", () => {
  const w = floorWorld(),
    s = w.loose.create([cell(0, 0, 0, B.STONE)], { x: 80, y: 3, z: 84 });
  s.pose.velocity = { x: 0, y: 0, z: -12 };
  const p = new AssemblyPhysics(w),
    key = {};
  let damage = 0,
    hits = 0;
  p.impactActors = [
    {
      id: "victim",
      key,
      mass: 80,
      height: 1.6,
      radius: 0.3,
      position: { x: 80, y: 2.8, z: 80 },
    },
  ];
  p.onActorImpact = (actor, hit) => {
    assert.equal(actor.key, key);
    damage += hit.energy;
    hits++;
  };
  try {
    for (let i = 0; i < 120; i++) p.step(null, 1 / 60);
    assert.ok(damage > 1000);
    assert.equal(hits, 1);
  } finally {
    p.dispose();
  }
});
test("impact rules forgive small falls, scale with mass, and stronger grips retain weight differences", () => {
  assert.equal(impactEnergy(80, Infinity, 7, 8), 0);
  assert.ok(
    impactEnergy(80, Infinity, 14, 8) > impactEnergy(80, Infinity, 10, 8),
  );
  assert.ok(impactEnergy(1000, Infinity, 10) > impactEnergy(100, Infinity, 10));
  assert.ok(gripLimits(75).throwSpeed > gripLimits(2400).throwSpeed);
  assert.ok(gripLimits(2400, true).force > gripLimits(2400).force);
});
test("animal impact is absorbed by the outer layer before damaging the internal skeleton", () => {
  const w = floorWorld(),
    eco = new Ecology(w),
    e = eco.spawn(0, 80, 80),
    part = SPECIES[0].parts[2],
    pos = toWorld(e, part, 2, cellPosition(part, 0), 0);
  const point = { x: pos[0], y: pos[1], z: pos[2] };
  eco.impact(e, point, 300, 0);
  assert.equal(eco.legs(e), 4);
  assert.equal(Object.keys(e.structure.hp).length, 0);
  eco.impact(e, point, 4500, 0);
  assert.ok(eco.legs(e) < 4);
});
