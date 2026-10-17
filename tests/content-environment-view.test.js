import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from '../app/src/main/assets/vendor/three.module.js';
import {WorldAtlas} from '../app/src/main/assets/content-runtime/atlas.js';
import {EnvironmentView,liquidGeometry} from '../app/src/main/assets/content-runtime/environment-view.js';
const content=Object.fromEntries(['environments','blocks','structures'].map(k=>[k,JSON.parse(fs.readFileSync(new URL(`../design/content/${k}.json`,import.meta.url)))]));
const create=()=>new WorldAtlas(content,{seed:'visual-water'});

test('actual liquid geometry has volume-exact height, outward winding and no internal shared faces',()=>{
 const a=create();a.pour(.25,5.25,.25,.0625);a.pour(.75,5.25,.25,.0625);
 const g=liquidGeometry(a,[[0,10,0],[1,10,0]]);g.computeBoundingBox();assert.equal(g.boundingBox.min.y,5);assert.equal(g.boundingBox.max.y,5.25);assert.equal(g.getAttribute('position').count,60); // five exposed faces for each cell
 const p=g.getAttribute('position'),n=g.getAttribute('normal'),v=[new T.Vector3(),new T.Vector3(),new T.Vector3()];
 for(let i=0;i<p.count;i+=3){for(let j=0;j<3;j++)v[j].fromBufferAttribute(p,i+j);const cross=v[1].sub(v[0]).cross(v[2].sub(v[0]));assert.ok(cross.dot(new T.Vector3().fromBufferAttribute(n,i))>0);}
 g.dispose();
});
test('opaque neighbor hides its liquid face; acid color reflects the saved reagent fraction',()=>{
 const a=create();a.setCell(-1,10,0,'stone');a.pour(.25,5.25,.25,.05,{acidFraction:.45});
 const g=liquidGeometry(a,[[0,10,0]]);assert.equal(g.getAttribute('position').count,30);const c=g.getAttribute('color');assert.ok(c.getY(0)>c.getZ(0));g.dispose();
});
test('view uses persisted fluids, burning and heat with bounded instances and never changes game state',()=>{
 const a=create();a.setCell(0,8,0,'plank');a.igniteCell(0,8,0);a.setCell(4,8,0,'stone');a.applyThermalEnergy(4,8,0,500);a.pour(.25,6,.25,.05,{acidFraction:.4});
 const before=JSON.stringify(a.serialize()),scene=new T.Scene(),view=new EnvironmentView({scene},a,{maxEffects:1,maxLiquidCells:1});const stats=view.sync({x:0,y:4,z:0},0);
 assert.equal(stats.liquidCells,1);assert.equal(stats.fireCells,1);assert.equal(stats.hotCells,1);assert.equal(view.flame.count,1);assert.equal(view.liquid.material.depthTest,true);assert.equal(view.liquid.material.depthWrite,false);assert.equal(view.liquid.material.transparent,true);
 view.sync({x:0,y:4,z:0},.3);assert.equal(JSON.stringify(a.serialize()),before);view.sync({x:1000,y:4,z:1000},1);assert.equal(view.flame.count,0);assert.equal(view.heat.count,0);assert.equal(view.stats.liquidCells,0);view.dispose();assert.equal(scene.children.length,0);
});
test('natural water is observed without materialization and a saved depleted surface is not redrawn',()=>{
 const a=create();a.loadAround(80,24,{radiusChunks:0,y:-.25,workBudgetMs:Infinity,maxCellsPerLoad:Infinity});const view=new EnvironmentView(new T.Scene(),a,{columnBudget:1024});const player={x:80,y:0,z:24};
 for(let i=0;i<12;i++)view.sync(player,i*.2);
 assert.ok(view.stats.liquidCells>0);assert.equal(a.fluidCells.size,0,'view must not seed the physics map');
 const top=a.fluidAt(80.25,-.25,24.25);assert.ok(top);a.takeFluid(80.25,-.25,24.25,.125);
 const cells=view._liquidCells(player);assert.equal(cells.some(p=>p[0]===160&&p[1]===-1&&p[2]===48),false);
 const before=JSON.stringify(a.serialize());view.sync(player,3);assert.equal(JSON.stringify(a.serialize()),before);view.dispose();
});
test('restored fluids create identical geometry and disappear after being withdrawn',()=>{
 const a=create();a.pour(.25,5.25,.25,.075,{acidFraction:.2});const restored=WorldAtlas.fromState(content,JSON.parse(JSON.stringify(a.serialize())));
 const views=[a,restored].map(atlas=>new EnvironmentView(new T.Scene(),atlas));for(const v of views)v.sync({x:0,y:4,z:0},0);
 assert.deepEqual(views[0].liquid.geometry.getAttribute('position').array,views[1].liquid.geometry.getAttribute('position').array);
 restored.takeFluid(.25,5.25,.25,.075);views[1].sync({x:0,y:4,z:0},1);assert.equal(views[1].stats.liquidCells,0);for(const v of views)v.dispose();
});
