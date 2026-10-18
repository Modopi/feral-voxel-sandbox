import test from "node:test";
import assert from "node:assert/strict";
import {
  listWorlds,
  createWorld,
  saveKey,
  deleteWorld,
  renameWorld,
  currentWorld,
} from "../app/src/main/assets/world-slots.js";
// World list and save slots (world-slots.js); the old machine field model these tests sat beside is gone (0.17.0).
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
