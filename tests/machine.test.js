import test from "node:test";
import assert from "node:assert/strict";
import {
  createLab,
  preset,
  evaluate,
  edit,
  damage,
  control,
  step,
  mine,
  serialize,
  restore,
} from "../app/src/main/assets/machine/model.js";
import {
  listWorlds,
  createWorld,
  saveKey,
  deleteWorld,
  renameWorld,
  currentWorld,
} from "../app/src/main/assets/world-slots.js";
const fresh = (heavy = false) => {
  const s = createLab();
  preset(s, heavy);
  return s;
};
test("same command produces different acceleration with different mass", () => {
  const a = fresh(),
    b = fresh(true);
  for (const s of [a, b]) {
    control(s, { throttle: 1 });
    for (let i = 0; i < 60; i++) step(s);
  }
  assert.ok(-a.body.vz > -b.body.vz * 1.5);
  assert.equal(evaluate(a).connected.size, a.blueprint.length);
});
test("motor damage reduces force, repair restores, blueprint remains unchanged", () => {
  const s = fresh(),
    p = s.blueprint.find((p) => p.type === "motor"),
    bp = JSON.stringify(s.blueprint),
    force = evaluate(s).force;
  damage(s, p.id, 40);
  assert.equal(evaluate(s).force, force / 2);
  assert.equal(JSON.stringify(s.blueprint), bp);
  assert.ok(edit(s, "repair", p.x, p.y, p.z));
  assert.equal(evaluate(s).force, force);
  damage(s, p.id, 100);
  assert.equal(evaluate(s).force, 0);
});
test("wheel damage degrades grip and steering and disconnected motor cannot drive", () => {
  const s = fresh();
  for (const p of s.blueprint.filter((p) => p.type === "wheel" && p.x < 0))
    damage(s, p.id, 100);
  assert.equal(evaluate(s).grip, 0.5);
  assert.equal(evaluate(s).steering, 0);
  edit(s, "remove", 0, 1, 0);
  edit(s, "add", 3, 2, 3, "motor");
  assert.equal(evaluate(s).power, 0);
});
test("collision damages local voxel and remains in bounded world", () => {
  const s = fresh();
  control(s, { throttle: 1 });
  for (let i = 0; i < 600; i++) step(s);
  assert.ok(s.events.some((x) => x.includes("충돌")));
  assert.ok(Object.values(s.hp).some((n) => n < 60));
  assert.ok(Math.abs(s.body.z) < 24);
});
test("resource checks are atomic, mining finite and repair cannot mint resources", () => {
  const s = fresh();
  s.stock = 0;
  const before = serialize(s);
  assert.equal(edit(s, "add", 2, 0, 0, "motor"), false);
  assert.equal(serialize(s), before);
  s.body.x = -6;
  s.body.z = 9;
  for (let i = 0; i < 30; i++) mine(s);
  assert.equal(s.stock, 80);
  assert.equal(s.ore, 0);
  const p = s.blueprint.find((p) => p.type === "motor");
  damage(s, p.id, 80);
  const stock = s.stock;
  edit(s, "remove", p.x, p.y, p.z);
  assert.equal(s.stock, stock);
});
test("machine save roundtrip and invalid data rejected", () => {
  const s = fresh();
  damage(s, s.blueprint[0].id, 20);
  assert.equal(
    serialize(restore(serialize(s))),
    serialize({ ...s, events: [], revision: 0 }),
  );
  const a = JSON.parse(serialize(s));
  a.blueprint.push({ ...a.blueprint[0] });
  assert.throws(() => restore(JSON.stringify(a)));
});
function store() {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}
test("world slots preserve legacy save and isolate create rename delete", () => {
  const db = store();
  db.setItem("feral.world.v1", "old");
  const list = listWorlds(db);
  assert.deepEqual(list.map(w => w.type).sort(), ["frontier", "island", "machine"]);
  assert.equal(saveKey(list[0]), "feral.world.v1");
  const a = createWorld(db, "試験", "machine"),
    b = createWorld(db, "섬 2", "island", 123);
  db.setItem(saveKey(a), "machine");
  db.setItem(saveKey(b), "island");
  renameWorld(db, a.id, "새 기계");
  assert.equal(currentWorld(db, "machine", "?world=" + a.id).name, "새 기계");
  deleteWorld(db, a.id);
  assert.equal(db.getItem(saveKey(a)), null);
  assert.equal(db.getItem(saveKey(b)), "island");
  assert.equal(db.getItem("feral.world.v1"), "old");
  assert.throws(() => currentWorld(db, "machine", "?world=" + b.id));
});
test("failed catalogue write retains previous world data", () => {
  const db = store();
  db.setItem("feral.world.v1", "old");
  db.setItem = () => {
    throw Error("full");
  };
  assert.throws(() => deleteWorld(db, "default"));
  assert.equal(db.getItem("feral.world.v1"), "old");
});
