import test from "node:test";
import assert from "node:assert/strict";
import { World, B } from "../app/src/main/assets/world.js";
import {
  CharacterController,
  FIXED_DT,
  EYE_HEIGHT,
  overlaps,
} from "../app/src/main/assets/physics.js";
function field() {
  const w = new World(18);
  for (let z = 4; z < 30; z++)
    for (let x = 4; x < 30; x++) {
      for (let y = 0; y < 4; y++) w.blocks[w.index(x, y, z)] = B.STONE;
      w.ground[x + z * 160] = 3;
    }
  return w;
}
function actor(x = 12.5, y = 4, z = 12.5) {
  return { x, y, z, yaw: 0, pitch: 0, vy: 0, flying: false, grounded: true };
}
const range = (a) => Math.max(...a) - Math.min(...a);
test("regression: old five-centimetre foot gap oscillates; swept support stays constant", () => {
  let y = 4.001,
    vy = 0;
  const old = [];
  for (let i = 0; i < 300; i++) {
    vy -= 18 * FIXED_DT;
    const ny = y + vy * FIXED_DT;
    if (ny + 0.05 >= 4) y = ny;
    else {
      y = Math.ceil(ny - 0.05) + 0.001;
      vy = 0;
    }
    old.push(y);
  }
  assert.ok(range(old) > 0.03);
  const w = field(),
    p = actor(),
    c = new CharacterController(w, p),
    values = [];
  for (let i = 0; i < 1200; i++) {
    c.step(FIXED_DT, {});
    values.push(c.render((i % 7) / 7).y);
  }
  assert.ok(range(values) < 1e-8);
  assert.equal(p.y, 4);
  assert.equal(p.grounded, true);
});
test("stationary floor contact is stable under irregular rendered frame intervals", () => {
  const w = field(),
    p = actor(),
    c = new CharacterController(w, p);
  let accumulator = 0;
  const cameras = [];
  for (let i = 0; i < 500; i++) {
    accumulator += [1 / 24, 1 / 90, 1 / 37, 1 / 120][i % 4];
    while (accumulator >= FIXED_DT) {
      c.step(FIXED_DT, {});
      accumulator -= FIXED_DT;
    }
    cameras.push(c.render(accumulator / FIXED_DT).y);
  }
  assert.ok(range(cameras) < 1e-8);
  assert.equal(cameras[0], 4 + EYE_HEIGHT);
});
test("jump lands once on exact ground without subsequent floor bounce", () => {
  const w = field(),
    p = actor(),
    c = new CharacterController(w, p);
  c.step(FIXED_DT, { jump: true });
  let high = p.y,
    landed = false;
  for (let i = 0; i < 180; i++) {
    c.step(FIXED_DT, {});
    high = Math.max(high, p.y);
    if (p.grounded) landed = true;
    if (landed) assert.equal(p.y, 4);
    assert.ok(!overlaps(w, p));
  }
  assert.ok(high - 4 > 1.28 && high - 4 < 1.33, `jump height ${high - 4}m`);
  assert.equal(p.y, 4);
});
test("jump clears a one-metre ledge with headroom and holding does not bounce", () => {
  const w = field();
  for (let x = 14; x < 19; x++)
    for (let z = 10; z < 15; z++) w.set(x, 4, z, B.STONE);
  const p = actor(13.3),
    c = new CharacterController(w, p);
  let peak = p.y;
  for (let i = 0; i < 90; i++) {
    c.step(FIXED_DT, { side: i < 55 ? 1 : 0, jump: true });
    peak = Math.max(peak, p.y);
    assert.ok(!overlaps(w, p));
  }
  assert.ok(p.x > 15 && peak > 5.28 && peak < 5.33);
  assert.equal(p.y, 5);
  assert.equal(p.grounded, true);
});
test("removing the support causes a real fall; half-metre platforms stop it exactly", () => {
  const w = field(),
    p = actor(),
    c = new CharacterController(w, p);
  w.setCell(24, 7, 24, 0);
  w.setCell(25, 7, 24, 0);
  w.setCell(24, 7, 25, 0);
  w.setCell(25, 7, 25, 0);
  for (let i = 0; i < 180; i++) c.step(FIXED_DT, {});
  assert.equal(p.y, 3.5);
  assert.equal(p.grounded, true);
  assert.ok(!overlaps(w, p));
});
test("half-metre stair climb fits the full 1.5 metre body", () => {
  const w = field();
  for (let z = 10; z < 14; z++)
    for (let x = 14; x < 18; x++) {
      for (let dx = 0; dx < 2; dx++)
        for (let dz = 0; dz < 2; dz++)
          w.setCell(x * 2 + dx, 8, z * 2 + dz, B.STONE);
    }
  const p = actor(13.4, 4, 10.25),
    c = new CharacterController(w, p);
  for (let i = 0; i < 65; i++) c.step(FIXED_DT, { side: 1 });
  assert.ok(p.x > 14);
  assert.equal(p.y, 4.5);
  assert.ok(!overlaps(w, p));
});
test("a solid one-metre wall blocks walking and a low ceiling blocks jumping", () => {
  const w = field();
  for (let y = 4; y < 8; y++)
    for (let z = 8; z < 17; z++) w.set(15, y, z, B.STONE);
  const p = actor(13, 4, 12.5),
    c = new CharacterController(w, p);
  for (let i = 0; i < 120; i++) c.step(FIXED_DT, { side: 1 });
  assert.ok(p.x <= 14.770001);
  assert.ok(!overlaps(w, p));
  w.set(14, 6, 12, B.STONE);
  c.step(FIXED_DT, { jump: true });
  for (let i = 0; i < 40; i++) {
    c.step(FIXED_DT, {});
    assert.ok(!overlaps(w, p));
  }
  assert.equal(p.y, 4);
});
test("half-cell edits preserve the other seven children and collapse uniform cells", () => {
  const w = field();
  w.set(12, 7, 12, B.DIRT);
  w.setCell(24, 14, 24, 0);
  assert.equal(w.getCell(24, 14, 24), 0);
  assert.equal(w.getCell(25, 14, 24), B.DIRT);
  assert.equal(w.subcells.size, 1);
  w.setCell(24, 14, 24, B.DIRT);
  assert.equal(w.subcells.size, 0);
});
test("tools remove 0.125, 1 and 8 cubic metres on filled terrain", () => {
  const counts = [];
  for (const size of [0.5, 1, 2]) {
    const w = field();
    for (let z = 9; z <= 16; z++)
      for (let x = 9; x <= 16; x++)
        for (let y = 5; y <= 11; y++) w.set(x, y, z, B.DIRT);
    const r = w.mine({ hx: 24, hy: 16, hz: 24 }, size);
    counts.push(r.removed);
    assert.equal(r.counts.get(B.DIRT), r.removed);
  }
  assert.deepEqual(counts, [1, 8, 64]);
});
test("ray picking finds the excavated half-cell boundary", () => {
  const w = new World();
  w.set(18, 5, 18, B.STONE);
  w.setCell(36, 10, 36, 0);
  const h = w.raycast({ x: 18.25, y: 5.25, z: 17 }, { x: 0, y: 0, z: 1 }, 5);
  assert.equal(h.hz, 37);
  assert.equal(h.distance, 1.5);
});
test("save and load preserve fine terrain and half-height support", () => {
  const w = field();
  w.setCell(24, 7, 24, 0);
  const saved = JSON.parse(JSON.stringify(w.save())),
    copy = field();
  copy.load(saved);
  assert.deepEqual([...copy.subcells], [...w.subcells]);
  assert.equal(copy.surface(12.25, 12.25), 3.5);
  assert.equal(copy.surface(12.75, 12.25), 4);
});
