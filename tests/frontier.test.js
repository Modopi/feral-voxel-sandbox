import test from "node:test";
import assert from "node:assert/strict";
// Frontier region terrain and the shared research items. The campaign rules are checked through the
// first-signal module (tests/first-signal-rules.test.js).
import { frontierWorld, regionInfo } from "../app/src/main/assets/frontier/terrain.js";
test("frontier regions are seed-stable and structures retain player edits", () => {
  const a = regionInfo(42, -3, 2),
    b = regionInfo(42, -3, 2);
  assert.deepEqual(a, b);
  assert.notEqual(a.seed, regionInfo(42, -2, 2).seed);
  const w = frontierWorld(a.seed, a);
  const y = w.surface(77, 84);
  w.set(77, y, 84, 3);
  const saved = w.save();
  const restored = frontierWorld(a.seed, a);
  restored.load(saved);
  assert.equal(restored.get(77, y, 84), 3);
  assert.equal(restored.landmarks.length, 6);
  assert.ok(restored.landmarks.some((p) => p.name === "해체·운반 작업장"));
});
