import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import * as T from '../app/src/main/assets/vendor/three.module.js';
import {surfaceGroups} from '../app/src/main/assets/content-runtime/voxel/solid.js';
import {buildPartMeshes} from '../app/src/main/assets/content-runtime/render-surfaces.js';
const mat=(id,color,extra={})=>({id,color,opacity:1,roughness:.9,metallic:0,emission:0,...extra});
const box=(center,size,material)=>({center,size,material});
function dispose(meshes){for(const m of meshes){m.geometry.dispose();m.material.dispose();}}
function original(boxes,materials){return [...surfaceGroups(boxes,materials)].filter(([,s])=>s.positions.length).map(([id,s])=>{
  const geometry=new T.BufferGeometry(),src=materials.find(m=>m.id===id);
  geometry.setAttribute('position',new T.Float32BufferAttribute(s.positions,3));geometry.setAttribute('normal',new T.Float32BufferAttribute(s.normals,3));geometry.setIndex(s.indices);
  return {geometry,material:new T.MeshStandardMaterial({color:src.color})};
});}
function triangles(meshes){const result=[];for(const {geometry:g,material:m}of meshes){const p=g.getAttribute('position'),n=g.getAttribute('normal'),c=g.getAttribute('color'),indices=g.index;
  for(let i=0;i<indices.count;i+=3){const triangle=[];for(let j=0;j<3;j++){const k=indices.getX(i+j);triangle.push([p.getX(k),p.getY(k),p.getZ(k),n.getX(k),n.getY(k),n.getZ(k),...(c?[c.getX(k),c.getY(k),c.getZ(k)]:m.color.toArray())].map(x=>Math.round(x*1e6)/1e6));}result.push(JSON.stringify(triangle));}
}return result.sort();}
function area(meshes){let total=0;for(const {geometry:g}of meshes){const p=g.getAttribute('position');for(let i=0;i<g.index.count;i+=3){const points=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,g.index.getX(i+j)));total+=points[1].sub(points[0]).cross(points[2].sub(points[0])).length()/2;}}return total;}

test('compatible opaque colors merge in linear RGB without changing any colored face or input',()=>{
  const materials=[mat('red','#804020'),mat('green','#208040'),mat('blue','#402080')],boxes=[box([0,0,0],[1,1,1],'red'),box([1,0,0],[1,1,1],'green'),box([0,1,0],[1,1,1],'blue')],before=JSON.stringify({materials,boxes});
  const old=original(boxes,materials),merged=buildPartMeshes(boxes,materials);assert.equal(old.length,3);assert.equal(merged.length,1);
  assert.deepEqual(triangles(merged),triangles(old));assert.equal(area(merged),area(old));assert.equal(JSON.stringify({materials,boxes}),before);
  assert.equal(merged[0].material.vertexColors,true);assert.deepEqual(merged[0].material.color.toArray(),[1,1,1]);assert.equal(merged[0].geometry.groups.length,0);
  const red=new T.Color('#804020'),color=merged[0].geometry.getAttribute('color');assert(Math.abs(color.getX(0)-red.r)<1e-7);assert(Math.abs(red.r-128/255)>.1,'vertex data is linear, not sRGB byte fractions');dispose(old);dispose(merged);
});

test('roughness, metalness, emission, emissive color and transparency remain separate',()=>{
  const materials=[mat('a','#ff0000'),mat('b','#00ff00'),mat('rough','#ff0000',{roughness:.4}),mat('metal','#ff0000',{metallic:.8}),mat('glow1','#ff0000',{emission:1}),mat('glow2','#00ff00',{emission:1}),mat('glow3','#ff0000',{emission:2}),mat('glow_same','#ff0000',{emission:1}),mat('glass1','#ff0000',{opacity:.5}),mat('glass2','#00ff00',{opacity:.5}),mat('glass3','#ff0000',{opacity:.75})];
  const merged=buildPartMeshes(materials.map((m,i)=>box([i*2,0,0],[1,1,1],m.id)),materials);assert.equal(merged.length,9);
  assert.equal(merged.filter(m=>m.material.transparent).length,3);for(const {material:m}of merged)assert.equal(m.depthWrite,!m.transparent);
  assert(merged.some(m=>m.material.metalness===.8));assert(merged.some(m=>m.material.roughness===.4));assert.equal(merged.filter(m=>m.material.emissiveIntensity>0).length,3);
  const emissive=merged.filter(m=>m.material.emissiveIntensity===1).map(m=>m.material.emissive.getHex());assert.deepEqual(emissive.sort((a,b)=>a-b),[0x00ff00,0xff0000]);dispose(merged);
});

test('original ray grid keeps floor edges, enclosed holes and independently transformed parts',()=>{
  const materials=[mat('a','#624b3a'),mat('b','#839450')],boxes=[box([-1.5,0,0],[1,.5,4],'a'),box([1.5,0,0],[1,.5,4],'b'),box([0,0,-1.5],[2,.5,1],'a'),box([0,0,1.5],[2,.5,1],'b')];
  const old=original(boxes,materials),merged=buildPartMeshes(boxes,materials),oldRoot=new T.Group(),newRoot=new T.Group();
  for(const [list,root]of [[old,oldRoot],[merged,newRoot]]){root.position.set(.25,2,-.5);for(const m of list)root.add(new T.Mesh(m.geometry,m.material));root.updateMatrixWorld(true);}
  for(let x=-2.5;x<=2.5;x+=.25)for(let z=-2.5;z<=2.5;z+=.25){const ray=new T.Raycaster(new T.Vector3(x+.25,5,z-.5),new T.Vector3(0,-1,0)),a=ray.intersectObject(oldRoot,true),b=ray.intersectObject(newRoot,true);assert.equal(b.length,a.length);if(a.length)assert.equal(a[0].distance,b[0].distance);if(Math.abs(x)<1&&Math.abs(z)<1)assert.equal(b.length,0,'hole cannot become an AABB-filled floor');}
  assert.equal(area(old),area(merged));dispose(old);dispose(merged);
});

test('every canonical model preserves triangle count per part; independent part geometry is never fused',()=>{
  const folder=new URL('../design/assets/models/',import.meta.url);let before=0,after=0,parts=0;
  for(const file of readdirSync(folder).filter(f=>f.endsWith('.voxel.json'))){const asset=JSON.parse(readFileSync(new URL(file,folder)));for(const part of asset.parts){
    const groups=[...surfaceGroups(part.boxes,asset.materials).values()].filter(s=>s.positions.length),meshes=buildPartMeshes(part.boxes,asset.materials);parts++;before+=groups.length;after+=meshes.length;
    assert.equal(meshes.reduce((n,m)=>n+m.geometry.index.count,0),groups.reduce((n,s)=>n+s.indices.length,0),`${asset.id}/${part.id}`);assert(meshes.length<=groups.length);dispose(meshes);
  }}
  assert(after<before);console.log(`canonical per-part draws ${before} -> ${after}; ${parts} independent part calls`);
});

test('empty parts allocate nothing and invalid material references fail before GPU resources',()=>{
  assert.deepEqual(buildPartMeshes([],[]),[]);assert.throws(()=>buildPartMeshes([box([0,0,0],[1,1,1],'missing')],[]),/Unknown surface material/);
});
