import test from "node:test";
import assert from "node:assert/strict";
import {
  CharacterBody,
  skinVoxels,
} from "../app/src/main/assets/character-body.js";
import { characterModel } from "../app/src/main/assets/character-model.js";
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
test("character structural saves round-trip and malformed structural damage is rejected", () => {
  const b = new CharacterBody(characterModel());
  b.damageBone("armR:0", 24);
  const copy = new CharacterBody(characterModel(), JSON.parse(JSON.stringify(b.save())));
  assert.deepEqual(copy.save(), b.save());
  const invalid = JSON.parse(JSON.stringify(b.save()));
  invalid.structure.hp["unknown:0"] = 0;
  assert.throws(() => new CharacterBody(characterModel(), invalid), /structural damage/);
});
