import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../app/src/main/assets/vendor/three.module.js';
import { CONTENT } from '../app/src/main/assets/content-runtime/catalog.generated.js';
import { BossSystem } from '../app/src/main/assets/content-runtime/bosses.js';
import { BossView } from '../app/src/main/assets/content-runtime/boss-view.js';
test('inside sphere warning retains exact height/floor boundaries while limiting full-screen tint',()=>{
 const system=new BossSystem(CONTENT),e=system.spawn('rootback_beast',[0,0,9],{arenaOrigin:[0,0,0]}),skill=system.definitions.get(e.bossId).skills.find(s=>s.id==='root_seed');
 const shape={kind:'sphere',center:{x:0,y:.75,z:0},radiusM:1.6};
 system.startCast(e,{s:skill,shape,windupS:1.4},{id:'player',position:shape.center});
 const camera=new T.PerspectiveCamera();camera.position.set(0,1.36,0);camera.updateMatrixWorld();
 const scene=new T.Scene(),view=new BossView({scene,camera});const saved=JSON.stringify(system.serialize());
 view.sync(system);const hazard=view.hazards.get(e.id).node;
 assert(hazard.userData.observerInside);assert(hazard.children[0].children[0].material.opacity<=.01);
 assert.deepEqual(hazard.children[0].userData.shape,shape);
 const floor=hazard.getObjectByName('floor-boundary'),guides=hazard.getObjectByName('sphere-guides');
 assert(Math.abs(floor.userData.radiusM-Math.sqrt(1.6**2-.75**2))<1e-9);
 assert.equal(guides.children.filter(n=>n.name==='sphere-height-boundary').length,3);
 for(const n of guides.children.filter(n=>n.name==='sphere-height-boundary'))for(let i=0;i<n.geometry.attributes.position.count;i++){
  const p=new T.Vector3().fromBufferAttribute(n.geometry.attributes.position,i);assert(Math.abs(p.length()-1.6)<1e-6);
 }
 assert.equal(JSON.stringify(system.serialize()),saved,'view must not alter damage, timing or ledger');
 camera.position.set(0,2,-8);camera.updateMatrixWorld();view.sync(system);
 assert.equal(hazard.userData.observerInside,false);assert(hazard.children[0].children[0].material.opacity>.01);
 view.dispose();assert.equal(scene.children.length,0);
});
test('sphere countdown represents windup plus actual projectile travel and stays continuous at launch',()=>{
 const system=new BossSystem(CONTENT),e=system.spawn('rootback_beast',[0,0,9]),skill=system.definitions.get(e.bossId).skills.find(s=>s.id==='root_seed');
 system.startCast(e,{s:skill,shape:{kind:'sphere',center:{x:0,y:1,z:0},radiusM:1.6},windupS:1.4},{id:'player',position:{x:0,y:1,z:0}});
 const scene=new T.Scene(),view=new BossView(scene);e.cast.remaining=.1;view.sync(system);
 const before=view.hazards.get(e.id).node,until=before.userData.untilImpactS;assert(Math.abs(until-.85)<1e-9);
 const count=before.getObjectByName('impact-countdown').geometry.drawRange.count;
 e.cast.stage='flight';e.cast.remaining=.75;view.sync(system);const launched=view.hazards.get(e.id).node;
 assert(Math.abs(launched.userData.untilImpactS-.75)<1e-9);assert(launched.getObjectByName('impact-countdown').geometry.drawRange.count<=count);
 e.cast.stage='active';e.cast.remaining=.3;view.sync(system);
 assert.equal(view.hazards.get(e.id).node.getObjectByName('impact-countdown').geometry.drawRange.count,0);
 view.dispose();
});

test('BossView renders all explicit T9/T10 variant cast volumes from the base asset identity', () => {
 for (const variant of CONTENT.bosses.variants) {
  const system = new BossSystem(CONTENT);
  const e = system.spawn(variant.baseBossId, [0, 0, 8], { contentVariantId: variant.id, tier: variant.tier });
  const def = system.definitionFor(e), skillId = variant.baseBossId === 'sanctuary_warden' ? 'warden_seal' : 'sentinel_arc';
  const skill = def.skills.find(s => s.id === skillId), target = { id: 'player', position: { x: 0, y: 0, z: 0 }, height: 1.8 };
  const shape = system.makeShape(e, skill, target, {});
  system.startCast(e, { s: skill, shape, windupS: skill.windupS }, target);
  const camera = new T.PerspectiveCamera(); camera.position.set(shape.center.x, shape.center.y, shape.center.z); camera.updateMatrixWorld();
  const scene = new T.Scene(); scene.camera = camera;
  const view = new BossView(scene), saved = JSON.stringify(system.serialize());
  view.sync(system);
  const hazard = view.hazards.get(e.id).node, mesh = hazard.children[0].children[0];
  assert.equal(e.bossId, variant.baseBossId);
  assert.equal(e.contentVariantId, variant.id);
  assert.equal(hazard.userData.skillId, skillId);
  assert.equal(mesh.geometry.type, 'SphereGeometry');
  assert.deepEqual(mesh.parent.userData.shape, shape);
  assert.equal(hazard.userData.observerInside, true);
  assert(mesh.material.opacity <= .01, 'inside warning remains legible without obscuring the boss');
  assert.equal(JSON.stringify(system.serialize()), saved, 'viewport must not mutate variant state');
  view.dispose(); assert.equal(scene.children.length, 0);
 }
});
