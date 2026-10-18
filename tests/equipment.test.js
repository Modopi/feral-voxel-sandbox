import test from "node:test";
import assert from "node:assert/strict";
import {
  GEAR,
  activeGear,
  spendGear,
  miningWork,
} from "../app/src/main/assets/equipment.js";
import { World, B } from "../app/src/main/assets/world.js";
test("tools specialize in materials", () => {
  assert.ok(
    miningWork(B.WOOD, 1, GEAR.axe) < miningWork(B.WOOD, 1, GEAR.ironpick),
  );
  assert.ok(
    miningWork(B.ORE, 1, GEAR.ironpick) < miningWork(B.ORE, 1, GEAR.axe),
  );
});

