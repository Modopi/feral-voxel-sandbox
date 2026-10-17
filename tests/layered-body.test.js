import test from "node:test";
import assert from "node:assert/strict";
import { World } from "../app/src/main/assets/world.js";
import {
  Ecology,
  SPECIES,
  cellPosition,
  toWorld,
  condition,
} from "../app/src/main/assets/entities.js";
import {
  animalSkeleton,
  animalBodyInfo,
  bonePieces,
} from "../app/src/main/assets/animal-skeleton.js";
import { boneHealth } from "../app/src/main/assets/structural-body.js";
import {
  CharacterBody,
  skinVoxels,
} from "../app/src/main/assets/character-body.js";
import { characterModel } from "../app/src/main/assets/character-model.js";
import { Frontier } from "../app/src/main/assets/frontier/model.js";
function setup(type = 0) {
  const w = new World(2);
  w.surface = () => 10;
  const eco = new Ecology(w),
    e = eco.spawn(type, 77, 87);
  e.yaw = 0;
  e.moving = 0;
  e.phase = 0;
  eco.rehash();
  return { w, eco, e };
}
function hit(e, part, voxel, layer = "shell") {
  return {
    entity: e,
    part,
    voxel,
    layer,
    node: `${part}:${voxel}`,
    point: toWorld(
      e,
      SPECIES[e.type].parts[part],
      part,
      cellPosition(SPECIES[e.type].parts[part], voxel),
      0,
    ),
  };
}
test("removing a whole foot exterior changes mass and appearance, but not support, HP, or identity", () => {
  const { eco, e } = setup(),
    before = condition(e),
    id = e.id;
  eco.damageHit(hit(e, 2, 0), 0, 0.01, 100);
  assert.equal(e.hp, e.maxHP);
  assert.equal(e.id, id);
  assert.equal(e.damage[2][0], 0);
  assert.equal(eco.legs(e), 4);
  assert.equal(condition(e).speed, 1);
  assert.ok(condition(e).mass < before.mass);
  assert.equal(animalBodyInfo(e, SPECIES[0]).structure, 100);
  assert.ok(animalBodyInfo(e, SPECIES[0]).shell < 100);
});
test("a front ray hits coat before bone, then exposed bone; only a full internal fracture disables support", () => {
  const { eco, e } = setup();
  const at = toWorld(
      e,
      SPECIES[0].parts[2],
      2,
      cellPosition(SPECIES[0].parts[2], 0),
      0,
    ),
    o = { x: at[0], y: at[1], z: at[2] - 1 },
    d = { x: 0, y: 0, z: 1 };
  let h = eco.ray(o, d, 2, 0);
  assert.equal(h.layer, "shell");
  assert.equal(h.part, 2);
  eco.damageHit(h, 0, 0.01, 12);
  h = eco.ray(o, d, 2, 0);
  assert.equal(h.layer, "structure");
  assert.equal(h.node, "2:0");
  eco.damageHit(h, 0, 0.01, 8);
  assert.equal(eco.legs(e), 4);
  assert.equal(boneHealth(animalSkeleton(SPECIES[0]), e.structure, "2:0"), 16);
  eco.damageHit(h, 0, 0.01, 16);
  assert.equal(eco.legs(e), 3);
  assert.equal(condition(e).label, "절뚝거림");
  assert.equal(e.lost & (1 << 2), 0);
  assert.ok(
    !bonePieces(e, SPECIES[0]).some(
      (p) => p.node === "2:0" || p.other === "2:0",
    ),
  );
});
test("all head coating can be removed without severing ears or destroying the vital skeleton", () => {
  const { eco, e } = setup();
  for (let j = 0; j < SPECIES[0].parts[1].count; j++)
    eco.damageHit(hit(e, 1, j), 0, 0.001, 100);
  assert.equal(e.dead, false);
  assert.equal(e.lost, 0);
  assert.equal(e.hp, e.maxHP);
  assert.equal(animalBodyInfo(e, SPECIES[0]).structure, 100);
  const model = animalSkeleton(SPECIES[0]);
  eco.damageHit(
    { ...hit(e, 1, 0, "structure"), node: model.brain },
    0,
    0.01,
    30,
  );
  assert.equal(e.dead, true);
  assert.match(e.deathCause, /골격|머리/);
});
test("severing the shared rear spine disconnects both hind limbs while front support survives", () => {
  const { eco, e } = setup();
  const p = SPECIES[0].parts[0],
    j = 1 + p.dims[0] + 2 * p.dims[0] * p.dims[1];
  eco.damageHit(hit(e, 0, j, "structure"), 0, 0.01, 30);
  assert.deepEqual(condition(e).support, [1, 1, 0, 0]);
  assert.ok(e.lost & (1 << 4));
  assert.ok(e.lost & (1 << 5));
  assert.equal(e.dead, false);
});
test("surface-only injuries and partial bone damage persist independently through save/load", () => {
  const { w, eco, e } = setup();
  eco.damageHit(hit(e, 2, 0), 0, 0.01, 100);
  eco.damageHit(hit(e, 3, 0, "structure"), 0, 0.01, 8);
  const loaded = new Ecology(w);
  loaded.load(JSON.parse(JSON.stringify(eco.save())));
  const r = loaded.entities[0];
  assert.equal(r.damage[2][0], 0);
  assert.equal(boneHealth(animalSkeleton(SPECIES[0]), r.structure, "3:0"), 16);
  assert.equal(loaded.legs(r), 4);
  assert.deepEqual(condition(r), condition(e));
});
test("old missing feet remain disabled when migrating the legacy all-voxel support policy", () => {
  const { w, eco, e } = setup();
  eco.damageHit(hit(e, 2, 0), 0, 0.01, 12);
  const saved = JSON.parse(JSON.stringify(eco.save()));
  delete saved.entities[0].structure;
  const loaded = new Ecology(w);
  loaded.load(saved);
  assert.equal(loaded.legs(loaded.entities[0]), 3);
  assert.equal(loaded.entities[0].damage[2][0], 0);
});
test("all human roles share structural capabilities while detailed skin and bone damage remain independent", () => {
  for (const role of ["explorer", "quartermaster", "herbalist", "mechanic"]) {
    const b = new CharacterBody(characterModel(role)),
      part = "shinL",
      cells = skinVoxels(b.model, part);
    assert.ok(cells.size > 200);
    b.removeSurface(part, [0, -0.08, 0.09], 0.08);
    assert.ok(b.shell.get(part).size > 0);
    assert.equal(b.status().functions.legL, true);
    assert.equal(b.status().integrity, 1);
    b.damageBone("shinL:0", 24);
    assert.equal(b.status().functions.legL, false);
    assert.equal(b.status().functions.legR, true);
    assert.equal(b.status().functions.armL, true);
    assert.equal(b.attached("footL"), false);
    assert.equal(b.status().alive, true);
    const restored = new CharacterBody(
      characterModel(role),
      JSON.parse(JSON.stringify(b.save())),
    );
    assert.deepEqual(restored.save(), b.save());
    assert.deepEqual(restored.status().functions, b.status().functions);
  }
});
test("training body belongs to persistent region state and rejects malformed structural saves", () => {
  const s = new Frontier(1),
    b = new CharacterBody(characterModel());
  b.damageBone("armR:0", 24);
  s.region.trainingBody = b.save();
  const copy = Frontier.load(JSON.parse(JSON.stringify(s.save())));
  assert.deepEqual(copy.region.trainingBody, b.save());
  const invalid = JSON.parse(JSON.stringify(s.save()));
  invalid.regions[s.key].trainingBody.structure.hp["unknown:0"] = 0;
  assert.throws(() => Frontier.load(invalid), /structural damage/);
});
