import test from "node:test";
import assert from "node:assert/strict";
import * as T from "../app/src/main/assets/vendor/three.module.js";
import { CharacterRig } from "../app/src/main/assets/character-view.js";
import {
  CHARACTER_ROLES,
  PORTRAIT_ACTIONS,
} from "../app/src/main/assets/character-model.js";
import { World } from "../app/src/main/assets/world.js";
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
