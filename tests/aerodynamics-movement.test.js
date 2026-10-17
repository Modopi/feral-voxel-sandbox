import test from "node:test";
import assert from "node:assert/strict";
import {
  panelForce,
  coefficients,
  bodyDrag,
  exposedFaces,
} from "../app/src/main/assets/machine/aerodynamics.js";
import {
  AssemblyPhysics,
  initialPose,
} from "../app/src/main/assets/machine/assembly-physics.js";
import {
  createLab,
  TYPES,
  evaluate,
  damage,
  serialize,
  restore,
} from "../app/src/main/assets/machine/model.js";
import {
  CharacterController,
  FIXED_DT,
  bodyHeight,
  overlaps,
} from "../app/src/main/assets/physics.js";
import { Inventory } from "../app/src/main/assets/inventory.js";
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
function aircraft(y = 5.8) {
  const s = createLab();
  s.assembly = true;
  s.pose = initialPose(80, y, 145);
  s.pose.anchored = false;
  const add = (type, x, y, z) => {
    const p = { id: "p" + s.nextId++, type, x, y, z };
    s.blueprint.push(p);
    s.hp[p.id] = TYPES[type].hp;
  };
  for (let z = -2; z <= 3; z++) add("hull", 0, 0, z);
  add("motor", 0, 1, 0);
  add("propeller", 0, 0, -3);
  for (let x = -4; x <= 4; x++)
    if (x) for (const z of [-1, 0, 1]) add("wing", x, 0, z);
  for (const x of [-2, -1, 1, 2]) add("elevator", x, 0, 3);
  add("rudder", 0, 1, 3);
  for (const x of [-4, 4]) add("wheel", x, -1, 0);
  add("wheel", 0, -1, -2);
  return s;
}
const terrain = () => ({ surface: () => 5 });
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
test("a connected craft takes off from a runway using its propeller and wings; output is retained at neutral stick", () => {
  const s = aircraft(),
    physics = new AssemblyPhysics(terrain());
  try {
    // Intact landing gear absorbs small runway bumps; allow a full 6.5-second takeoff.
    for (let i = 0; i < 390; i++)
      physics.step(s, 1 / 60, { forward: 1, up: i > 240 }, true, true);
    assert.ok(s.pose.position.y > 12, `altitude ${s.pose.position.y}`);
    assert.equal(physics.grounded, 0);
    assert.ok(physics.speed > 15);
    assert.ok(physics.aero.lift > evaluate(s).mass * 9.81 * 0.8);
    assert.equal(physics.aero.stalled, false);
    const throttle = physics.throttle;
    physics.step(s, 1 / 60, {}, true, true);
    assert.equal(physics.throttle, throttle);
    const loaded = restore(serialize(s));
    assert.deepEqual(loaded.pose, s.pose);
    assert.equal(evaluate(loaded).wings, evaluate(s).wings);
  } finally {
    physics.dispose();
  }
});
test("asymmetric wing loss changes real angular motion; unpiloted panels and wind still produce forces", () => {
  const spin = [];
  for (const cut of [false, true]) {
    const s = aircraft(35);
    s.pose.position.z = 110;
    s.pose.velocity.z = -28;
    if (cut)
      for (const p of s.blueprint)
        if (p.type === "wing" && p.x > 0) damage(s, p.id, 100);
    const physics = new AssemblyPhysics(terrain());
    try {
      for (let i = 0; i < 30; i++) physics.step(s, 1 / 60, {}, false, false);
      spin.push(Math.abs(s.pose.rotation.z));
      assert.ok(physics.aero.lift > 0);
      assert.equal(physics.throttle, 0);
    } finally {
      physics.dispose();
    }
  }
  assert.ok(spin[1] > spin[0] + 0.05, JSON.stringify(spin));
  const s = aircraft(35);
  s.pose.position.z = 110;
  const physics = new AssemblyPhysics(terrain());
  try {
    physics.wind.z = 25;
    physics.step(s, 1 / 60);
    assert.ok(physics.aero.lift > 100);
  } finally {
    physics.dispose();
  }
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
test("standing clearance also checks moving assemblies, and the physics capsule fits the chosen stance", () => {
  const s = createLab();
  s.assembly = true;
  s.pose = initialPose(10, 2.5, 10);
  s.blueprint = [{ id: "p1", type: "hull", x: 0, y: 0, z: 0 }];
  s.hp = { p1: 100 };
  s.nextId = 2;
  const physics = new AssemblyPhysics({ surface: () => 2 }),
    p = actor(),
    c = new CharacterController({ getCell: (_, y) => (y < 4 ? 1 : 0) }, p);
  try {
    physics.step(s, 1 / 60);
    c.requestStance("crawl");
    c.step(FIXED_DT);
    c.obstructed = (p, h) => physics.characterObstructed(p, h);
    c.requestStance("stand");
    c.step(FIXED_DT);
    assert.equal(p.stance, "crawl");
    assert.equal(p.stanceBlocked, true);
    const before = { ...p };
    p.x += 0.02;
    physics.moveCharacter(before, p);
    assert.ok(p.x > before.x);
    s.pose.anchored = false;
    physics.bodies.get(s).body.setTranslation({ x: 30, y: 5, z: 30 }, true);
    physics.step(s, 1 / 60);
    c.step(FIXED_DT);
    assert.equal(p.stance, "stand");
  } finally {
    physics.dispose();
  }
});

test("destroying the connected motor removes propeller thrust while the intact craft accelerates", () => {
  const distances = [];
  for (const broken of [false, true]) {
    const s = aircraft();
    if (broken) damage(s, s.blueprint.find(p => p.type === "motor").id, 100);
    const physics = new AssemblyPhysics(terrain());
    try {
      for (let i = 0; i < 180; i++) physics.step(s, 1 / 60, { forward: 1 }, true, true);
      distances.push(145 - s.pose.position.z);
    } finally { physics.dispose(); }
  }
  assert.ok(distances[0] > 10, JSON.stringify(distances));
  assert.ok(Math.abs(distances[1]) < 0.1, JSON.stringify(distances));
});
