import test from "node:test";
import assert from "node:assert/strict";
import { regionInfo } from "../app/src/main/assets/frontier/terrain.js";
import { PROJECTS, SIGNAL_ROUTES, CROPS, SORTIES } from "../app/src/main/assets/frontier/campaign.js";
import { prepareAttack, attackZones, attackHits } from "../app/src/main/assets/frontier/content.js";

test("telegraphs and collisions share all five shapes including safe ring centres and charge flanks", () => {
  for (let biome = 0; biome < 3; biome++)
    for (let phase = 0; phase < 3; phase++) {
      const b = { x: 20, z: 20, phase };
      prepareAttack(b, biome, { x: 25, z: 20 });
      assert.ok(b.warning >= 1.15);
      assert.ok(attackZones(b).length);
      if (b.pattern === "ring") {
        assert.equal(attackHits(b, { x: 20, z: 20 }), false);
        assert.equal(attackHits(b, { x: 25, z: 20 }), true);
        assert.equal(attackHits(b, { x: 29, z: 20 }), false);
      }
      if (b.pattern === "charge") {
        assert.equal(attackHits(b, { x: 24, z: 20 }), true);
        assert.equal(attackHits(b, { x: 24, z: 24 }), false);
      }
      if (b.pattern === "cross") {
        assert.equal(attackHits(b, { x: 25, z: 24 }), true);
        assert.equal(attackHits(b, { x: 28, z: 23 }), false);
      }
      if (b.pattern === "burst") {
        assert.equal(attackHits(b, { x: 25, z: 20, flying: true }), true);
        assert.equal(attackHits(b, { x: 25, z: 25 }), false);
      }
      if (b.pattern === "stomp") {
        assert.equal(attackHits(b, { x: 25, z: 20 }), true);
        assert.equal(attackHits(b, { x: 25, z: 25 }), false);
      }
    }
});
