import test from "node:test";
import assert from "node:assert/strict";
import {
  panelForce,
  coefficients,
  bodyDrag,
  exposedFaces,
} from "../app/src/main/assets/machine/aerodynamics.js";
import {
  CharacterController,
  FIXED_DT,
  bodyHeight,
  overlaps,
} from "../app/src/main/assets/physics.js";
import { Inventory } from "../app/src/main/assets/inventory.js";
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
test("wing lift scales with airspeed squared, loses lift after stall, and passive force never supplies energy", () => {
  const v = { x: 0, y: 0, z: -20 },
    a = panelForce("wing", v),
    b = panelForce("wing", { ...v, z: -40 });
  assert.ok(a.lift > 0);
  assert.ok(Math.abs(b.lift / a.lift - 4) < 1e-10);
  assert.equal(panelForce("wing", { x: 0, y: 0, z: 0 }).lift, 0);
  assert.ok(coefficients(0.26).lift > coefficients(0.9).lift);
  assert.ok(coefficients(0.9).stalled);
  for (const type of ["wing", "elevator", "rudder"])
    for (const y of [-30, -5, 0, 5, 30])
      for (const z of [-40, 0, 40]) {
        const v = { x: 7, y, z },
          f = panelForce(type, v, 1, {}, 2);
        assert.ok(
          dot(f.force, v) <= 1e-8,
          "lift is perpendicular; drag dissipates energy",
        );
      }
  assert.equal(panelForce("wing", v, 0).lift, 0);
  assert.ok(panelForce("wing", v, 0.3).lift < a.lift * 0.31);
});
test("internal hull faces do not multiply drag, and reversed airflow reverses drag", () => {
  const parts = [
      { id: "a", type: "hull", x: 0, y: 0, z: 0 },
      { id: "b", type: "hull", x: 0, y: 0, z: -1 },
    ],
    faces = exposedFaces(parts);
  assert.equal(bodyDrag("hull", { x: 0, y: 0, z: -20 }, faces.get("a")).z, 0);
  assert.ok(bodyDrag("hull", { x: 0, y: 0, z: -20 }, faces.get("b")).z > 0);
  assert.ok(bodyDrag("hull", { x: 0, y: 0, z: 20 }, faces.get("a")).z < 0);
});
test("elevator, fin and opposite wing deflections create pitch, yaw and roll forces in the commanded direction", () => {
  const v = { x: 0, y: 0, z: -25 };
  assert.ok(panelForce("elevator", v, 1, { pitch: 1 }).force.y < 0);
  assert.ok(panelForce("elevator", v, 1, { pitch: -1 }).force.y > 0);
  assert.ok(panelForce("rudder", v, 1, { turn: 1 }).force.x < 0);
  assert.ok(
    panelForce("wing", v, 1, { turn: 1 }, 4).lift <
      panelForce("wing", v, 1, { turn: 1 }, -4).lift,
  );
});
test("aircraft parts use research and shared inventory, including atomic kit crafting", () => {
  const i = new Inventory(false);
  i.grant("iron", 100);
  assert.equal(i.craft("wing_part"), false);
  assert.equal(i.count("iron"), 100);
  i.unlocks.add("aviation");
  assert.equal(i.craft("aircraft_parts"), true);
  assert.equal(i.count("wing_part"), 24);
  assert.equal(i.count("iron"), 11);
  assert.equal(i.craft("aircraft_parts"), false);
  assert.equal(i.count("wing_part"), 24);
});
function actor() {
  return {
    x: 10,
    y: 2,
    z: 10,
    yaw: 0,
    pitch: 0,
    vy: 0,
    grounded: true,
    flying: false,
  };
}
function tunnel(height = Infinity) {
  return {
    getCell: (x, y, z) =>
      y < 4 || (x >= 22 && x < 40 && y >= 4 + height * 2 && y < 10) ? 1 : 0,
  };
}
test("only crawling fits a half-metre tunnel; standing remains blocked until outside, including camera height", () => {
  const w = tunnel(0.5),
    p = actor(),
    c = new CharacterController(w, p);
  for (let i = 0; i < 60; i++) c.step(FIXED_DT, { side: 1 });
  assert.ok(p.x < 11);
  c.requestStance("crawl");
  for (let i = 0; i < 120; i++) c.step(FIXED_DT, { side: 1 });
  assert.ok(p.x > 12);
  assert.equal(bodyHeight(p), 0.5);
  assert.ok(c.render(1).y <= 2.5);
  c.requestStance("stand");
  c.step(FIXED_DT, {});
  assert.equal(p.stance, "crawl");
  assert.equal(p.stanceBlocked, true);
  assert.equal(overlaps(w, p, 0.23, bodyHeight(p)), false);
  p.x = 10;
  c.step(FIXED_DT, {});
  assert.equal(p.stance, "stand");
  assert.equal(p.stanceBlocked, false);
});
test("crouching fits a metre tunnel; sprint is disabled in low stances and crawling cannot jump", () => {
  const w = tunnel(1),
    p = actor(),
    c = new CharacterController(w, p);
  c.requestStance("crouch");
  for (let i = 0; i < 60; i++) c.step(FIXED_DT, { side: 1, sprint: true });
  assert.ok(Math.abs(p.x - 11.6) < 1e-6);
  assert.equal(p.sprinting, false);
  assert.equal(p.stance, "crouch");
  c.requestStance("crawl");
  c.step(FIXED_DT, { jump: true });
  assert.equal(p.y, 2);
  assert.equal(bodyHeight(p), 0.5);
  p.x = 10;
  c.requestStance("stand");
  for (let i = 0; i < 60; i++) c.step(FIXED_DT, { forward: 1, sprint: true });
  assert.ok(Math.abs(p.z - 5.2) < 1e-6);
  assert.equal(p.sprinting, true);
});
test("standing clearance asks the obstruction hook (moving bodies), and the capsule fits the chosen stance", () => {
  let blocked = true;
  const p = actor(),
    c = new CharacterController({ getCell: (_, y) => (y < 4 ? 1 : 0) }, p);
  c.requestStance("crawl");
  c.step(FIXED_DT);
  c.obstructed = () => blocked;
  c.requestStance("stand");
  c.step(FIXED_DT);
  assert.equal(p.stance, "crawl");
  assert.equal(p.stanceBlocked, true);
  blocked = false;
  c.step(FIXED_DT);
  assert.equal(p.stance, "stand");
});
