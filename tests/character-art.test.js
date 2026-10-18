import test from "node:test";
import assert from "node:assert/strict";
import * as T from "../app/src/main/assets/vendor/three.module.js";
import { CharacterRig } from "../app/src/main/assets/character-view.js";
import {
  CHARACTER_ROLES,
  PORTRAIT_ACTIONS,
} from "../app/src/main/assets/character-model.js";
import {
  animalDetails,
  visibleAnimalDetails,
} from "../app/src/main/assets/animal-art.js";
import { World } from "../app/src/main/assets/world.js";
import {
  Ecology,
  SPECIES,
  toWorld,
  occupied,
} from "../app/src/main/assets/entities.js";

test("jointed locomotion and crouch/crawl keep a supporting boot on the ground; reset clears gestures", () => {
  const rig = new CharacterRig("explorer");
  for (const action of PORTRAIT_ACTIONS)
    for (const phase of [0, 0.7, 1.5, 3, 4.5]) {
      rig.animate({ action, phase, time: 1.1 });
      rig.root.updateMatrixWorld(true);
      let low = Infinity;
      for (const side of ["L", "R"]) {
        const bone = rig.bones["foot" + side],
          mesh = bone.children[0],
          vertices = mesh.geometry.attributes.position;
        for (let i = 0; i < vertices.count; i++)
          low = Math.min(
            low,
            new T.Vector3()
              .fromBufferAttribute(vertices, i)
              .applyMatrix4(mesh.matrixWorld).y,
          );
      }
      assert.ok(Math.abs(low) < 1e-6, `${action}/${phase}: foot ${low}`);
    }
  rig.animate({ action: "talk", time: 0.2 });
  assert.ok(rig.bones.mouth.scale.y > 1);
  rig.animate({ action: "idle", time: 1 });
  assert.equal(rig.bones.mouth.scale.y, 1);
  assert.equal(rig.bones.armR.rotation.z, -0.05);
  rig.dispose();
});
test("all roles have connected elbow/knee/ankle rigs and share immutable geometry without sharing poses", () => {
  for (const role of CHARACTER_ROLES) {
    const a = new CharacterRig(role),
      b = new CharacterRig(role);
    assert.equal(a.meshes[0].geometry, b.meshes[0].geometry);
    assert.equal(a.bones.handR.parent, a.bones.forearmR);
    assert.equal(a.bones.footL.parent, a.bones.shinL);
    a.animate({ action: "wave", time: 1 });
    b.animate({ action: "idle", time: 1 });
    assert.notEqual(a.bones.armR.rotation.z, b.bones.armR.rotation.z);
    a.detail(30);
    assert.equal(a.bones.eyeR.visible, false);
    a.detail(3);
    assert.equal(a.bones.eyeR.visible, true);
    a.dispose();
    b.dispose();
  }
});
test("an external antler hit removes its owning physical cell and decoration, including after save/load", () => {
  const w = new World(1);
  w.surface = () => 10;
  const eco = new Ecology(w),
    e = eco.spawn(0, 77, 87);
  e.yaw = 0.6;
  e.moving = 0;
  eco.rehash();
  const art = animalDetails(0, SPECIES[0].parts),
    d = art
      .filter((d) => d.feature === "antler")
      .sort((a, b) => b.at[1] - a.at[1])[0];
  const at = toWorld(e, SPECIES[0].parts[d.part], d.part, d.at, 0),
    dir = { x: Math.sin(e.yaw), y: 0, z: Math.cos(e.yaw) };
  const origin = { x: at[0] - dir.x * 2, y: at[1], z: at[2] - dir.z * 2 };
  const hit = eco.ray(origin, dir, 4, 0);
  assert.ok(hit);
  assert.equal(hit.detail, "antler");
  assert.equal(hit.part, 1);
  eco.damageHit(hit, 0, 0.001, 0);
  assert.equal(occupied(e, hit.part, hit.voxel), false);
  assert.ok(
    !visibleAnimalDetails(e, SPECIES[0].parts).some(
      (d) => d.part === hit.part && d.voxel === hit.voxel,
    ),
  );
  const restored = new Ecology(w);
  restored.load(JSON.parse(JSON.stringify(eco.save())));
  assert.deepEqual(
    visibleAnimalDetails(restored.entities[0], SPECIES[0].parts),
    visibleAnimalDetails(e, SPECIES[0].parts),
  );
});
test("every species detail is owned by a valid saved cell; lost limbs leave no floating eyes/feet/ears", () => {
  for (let type = 0; type < 3; type++) {
    const parts = SPECIES[type].parts,
      details = animalDetails(type, parts);
    assert.ok(
      details.length < 150,
      `bounded instance budget: ${details.length}`,
    );
    for (const d of details) {
      assert.ok(d.voxel >= 0 && d.voxel < parts[d.part].count);
      assert.ok(d.size.every((n) => n > 0));
    }
    for (let part = 0; part < parts.length; part++) {
      const e = { type, lost: 1 << part, damage: {} };
      assert.ok(visibleAnimalDetails(e, parts).every((d) => d.part !== part));
      e.lost = 0;
      e.damage[part] = new Uint8Array(parts[part].count);
      assert.ok(visibleAnimalDetails(e, parts).every((d) => d.part !== part));
    }
  }
});
