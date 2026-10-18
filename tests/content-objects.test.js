import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../app/src/main/assets/content-runtime/catalog.generated.js';
import { WorldObjects } from '../app/src/main/assets/content-runtime/objects.js';
import { WorldAtlas } from '../app/src/main/assets/content-runtime/atlas.js';
import {Progression} from '../app/src/main/assets/content-runtime/progression.js';
import { assertAuthoringInvariant, assertCreatedByTool } from '../app/src/main/assets/content-runtime/voxel/authoring.js';

const clone = x => structuredClone(x);
function atlas(cells = []) {
  const map = new Map(cells.map(([x,y,z,id]) => [`${x},${y},${z}`, id]));
  return { map, getCell: (x,y,z) => map.get(`${x},${y},${z}`) ?? null,
    setCell(x,y,z,id) { if (id == null) map.delete(`${x},${y},${z}`); else map.set(`${x},${y},${z}`, id); return true; } };
}
const mass = id => CONTENT.blocks.entries.find(b => b.id === id).massPerCellKg;

test('cutting a rotated detached trunk preserves split owners, remaining mass, damage and a single harvest',()=>{
 const a=atlas([[0,1,0,'log'],[1,1,0,'log'],[2,1,0,'log']]),s=new WorldObjects(CONTENT,a),p=new Progression(CONTENT),o=s.detachAround([0,0,0]).objects[0];
 s.setPhysicsPose(o.id,{rotation:{x:0,y:Math.SQRT1_2,z:0,w:Math.SQRT1_2},angularVelocity:{x:0,y:2,z:0}});
 const point={x:.25,y:.75,z:-.75},before=o.massKg;
 assert.equal(s.damageAt(o.id,point,1,{progression:p}).ok,true);
 const saved=new WorldObjects(CONTENT,a,s.serialize());assert.equal(saved.get(o.id).cells[1].hp,o.cells[1].hp);
 const hit=s.damageAt(o.id,point,1e6,{progression:p});assert.equal(hit.ok,true);assert.equal(hit.objectIds.length,2);
 assert.equal([...s.objects.values()].reduce((n,v)=>n+v.massKg,0)+hit.removedMassKg,before);
 assert.equal(p.count('raw_timber'),CONTENT.blocks.entries.find(b=>b.id==='log').harvestYieldPerCell);
 assert.equal(s.damageAt(o.id,point,1e6,{progression:p}).ok,false);
 assert.equal(new WorldObjects(CONTENT,a,s.serialize()).objects.size,2);
 assert.deepEqual([...s.objects.values()].map(p=>Math.round(p.velocity.x)).sort((a,b)=>a-b),[-1,1]);
 for(const part of s.objects.values()){assertAuthoringInvariant(part.asset);assert(Math.abs(part.rotation.y-Math.SQRT1_2)<1e-12);}
});

test('severed trunk transfers exact original cell mass and volume with exclusive SDK geometry', () => {
  const a = atlas([[0,1,0,'log'],[0,2,0,'log'],[0,3,0,'leaves'],[1,3,0,'leaves']]);
  const s = new WorldObjects(CONTENT, a), result = s.detachAround([0,0,0]);
  assert.equal(result.detachedCells, 4); assert.equal(result.objects.length, 1); assert.equal(a.map.size, 0);
  const o = result.objects[0]; assert.equal(o.entityType, 'object'); assert.equal(o.massKg, 2 * mass('log') + 2 * mass('leaves'));
  assert.equal(o.volumeLiters, 500); assert.deepEqual(o.position, {x:0,y:.5,z:0});
  assertAuthoringInvariant(o.asset); assertCreatedByTool(o.asset);
  assert.equal(o.asset.parts[0].boxes.length, 4); assert.equal(o.asset.category, 'object');
  assert.equal(o.asset.materials.find(m=>m.id==='leaves').collision, false);
  assert.equal(s.physicsBodies()[0].boxes.filter(b=>b.collision).length, 2);
  assert.equal(s.physicsBodies()[0].boxes.reduce((n,b)=>n+b.massKg,0), o.massKg);
  assert.equal(s.sceneModels()[0].kind, 'object'); assert.equal(s.sceneModels()[0].ownerId, o.id);
  assert.equal(s.detachAround([0,0,0]).objects.length, 0);
});

test('connected foundations, fixed building cells and unknown blocks prevent detachment', () => {
  for (const support of ['foundation','unregistered_material']) {
    const data = clone(CONTENT); data.blocks.entries.push({ ...data.blocks.entries[0], id:'foundation', detachesWhenUnsupported:false });
    const a = atlas([[0,1,0,'log'],[1,1,0,support]]), s = new WorldObjects(data,a);
    assert.deepEqual(s.detachAround([0,0,0]).reasons, ['anchored']); assert.equal(a.map.size,2); assert.equal(s.objects.size,0);
  }
  const a = atlas([[0,1,0,'log']]); a.isAnchoredCell = (x,y,z) => x===1&&y===1&&z===0;
  const s = new WorldObjects(CONTENT,a); assert.deepEqual(s.detachAround([0,0,0]).reasons,['anchored']); assert.equal(a.map.size,1);
});

test('bounded search preserves large connected masses without partial deletion', () => {
  const cells = Array.from({length:2050}, (_,i)=>[i,1,0,'stone']);
  const a = atlas(cells), s = new WorldObjects(CONTENT,a); const result = s.detachAround([0,0,0]);
  assert.deepEqual(result.reasons,['component_limit']); assert.equal(result.detachedCells,0); assert.equal(a.map.size,2050);
});

test('two disjoint unsupported branches get independent object owners while grounded branch stays', () => {
  const data = clone(CONTENT); data.blocks.entries.push({...data.blocks.entries[0],id:'foundation',detachesWhenUnsupported:false});
  const a = atlas([[1,0,0,'stone'],[-1,0,0,'log'],[0,-1,0,'foundation']]);
  const s = new WorldObjects(data,a), result=s.detachAround([0,0,0]);
  assert.equal(result.objects.length,2); assert.equal(new Set(result.objects.map(o=>o.id)).size,2);
  assert.equal(a.getCell(0,-1,0),'foundation'); assert.equal(result.detachedCells,2);
});

test('saved pose, materials and finite cells restore with no repeated detachment', () => {
  const a=atlas([[0,1,0,'log'],[0,2,0,'leaves']]), s=new WorldObjects(CONTENT,a), o=s.detachAround([0,0,0]).objects[0];
  assert.equal(s.setPhysicsPose(o.id,{position:{x:4,y:1,z:-2},rotation:{x:0,y:1,z:0,w:1},velocity:[2,-3,4],angularVelocity:[1,2,3]}),true);
  assert.equal(s.setPhysicsPose(o.id,{position:{x:NaN,y:0,z:0}}),false);
  const snapshot=JSON.parse(JSON.stringify(s.serialize())), restored=new WorldObjects(CONTENT,a,snapshot);
  assert.deepEqual(restored.serialize(),snapshot); assert.equal(restored.get(o.id).massKg,mass('log')+mass('leaves'));
  assert.equal(restored.detachAround([0,0,0]).objects.length,0);
  a.setCell(0,1,0,'stone'); assert.equal(restored.detachAround([0,0,0]).objects[0].id,'object:2');
  assert.equal(new WorldObjects(CONTENT,a,restored.serialize()).objects.size,2,'new material may later occupy the same source coordinates');
});

test('failed world mutation restores removed material and creates no object', () => {
  const a=atlas([[0,1,0,'log'],[0,2,0,'log']]), original=a.setCell;
  a.setCell=(x,y,z,id)=> { if(y===2&&id===null)return false; return original(x,y,z,id); };
  const s=new WorldObjects(CONTENT,a); assert.throws(()=>s.detachAround([0,0,0]),/refused/);
  assert.equal(a.map.size,2); assert.equal(s.objects.size,0); assert.equal(s.nextId,1);
});

test('invalid saves and unallocated biological fragments cannot create duplicate mass', () => {
  const a=atlas([[0,1,0,'log']]),s=new WorldObjects(CONTENT,a);s.detachAround([0,0,0]);
  const state=s.serialize(); state.objects[0].cells.push(clone(state.objects[0].cells[0]));
  assert.throws(()=>new WorldObjects(CONTENT,a,state),/Duplicate/);
  assert.throws(()=>s.detachAround([.5,0,0]),/integer/);
  const before=s.serialize(); assert.equal(s.spawnFragment({sourceId:'deer',massKg:10}).reason,'fragment_mass_allocation_required'); assert.deepEqual(s.serialize(),before);
});

test('actual procedural tree crown detaches after every supporting trunk cell is cut', () => {
  const a = new WorldAtlas(CONTENT,{seed:37}), s = new WorldObjects(CONTENT,a);
  let tree;
  for(let x=1;x<12&&!tree;x++)for(let z=1;z<12&&!tree;z++)tree=a._treeAt(x,z);
  assert.ok(tree,'seed must contain a tree');
  const hy=Math.ceil(tree.base*2), hx=Math.floor(tree.x*2), hz=Math.floor(tree.z*2);
  const cuts=[];
  for(let x=hx-2;x<=hx+2;x++)for(let z=hz-2;z<=hz+2;z++)if(a.getCell(x,hy,z)===tree.log)cuts.push([x,hy,z]);
  assert.ok(cuts.length>0);
  let detached=[]; for(const c of cuts){a.setCell(...c,null);detached.push(...s.detachAround(c).objects);}
  assert.ok(detached.length>0,'unsupported procedural tree must become a dynamic object');
  assert.ok(detached.some(o=>o.cells.some(c=>c.blockId==='leaves')));
  for(const o of detached)for(const c of o.cells)assert.equal(a.getCell(...c.sourceCell),null);
  const savedAtlas=new WorldAtlas(CONTENT,{seed:37,state:a.serialize()}), loaded=new WorldObjects(CONTENT,savedAtlas,s.serialize());
  assert.equal(loaded.objects.size,s.objects.size); assert.equal(loaded.detachAround(cuts.at(-1)).objects.length,0);
});
