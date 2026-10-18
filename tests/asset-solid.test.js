import test from 'node:test';import assert from 'node:assert/strict';
import {disjointBoxes,overlappingPairs,normalizeAsset,surfaceGroups} from '../tools/asset-pipeline/solid.mjs';
import {flattenAsset} from '../tools/asset-pipeline/model.mjs';
const b=(center,size,material='a')=>({center,size,material});const mat=[{id:'a',opacity:1},{id:'b',opacity:1}];const volume=bs=>bs.reduce((s,b)=>s+b.size.reduce((x,y)=>x*y,1),0);
test('overlap removal preserves union volume and gives later material ownership',()=>{const out=disjointBoxes([b([0,0,0],[2,2,2]),b([1,0,0],[2,2,2],'b')]);assert.equal(overlappingPairs(out),0);assert.equal(volume(out),12);assert.equal(volume(out.filter(b=>b.material==='b')),8);assert.deepEqual(disjointBoxes(out),out);});
test('duplicate boxes collapse and partial opaque contacts lose only hidden faces',()=>{assert.equal(disjointBoxes([b([0,0,0],[1,1,1]),b([0,0,0],[1,1,1])]).length,1);const g=surfaceGroups([b([0,0,0],[1,1,1]),b([1,0,0],[1,1,1])],mat).get('a');assert.equal(g.indices.length/6,10);for(let i=0;i<g.indices.length;i+=3){const p=g.indices.slice(i,i+3).map(n=>g.positions.slice(n*3,n*3+3));const a=p[1].map((v,k)=>v-p[0][k]),b=p[2].map((v,k)=>v-p[0][k]);const cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],normal=g.normals.slice(g.indices[i]*3,g.indices[i]*3+3);assert.ok(cross.reduce((s,v,k)=>s+v*normal[k],0)>0);}});
test('independent joint parts retain overlapping geometry and pivots',()=>{const a={materials:mat,parts:[{id:'root',parent:null,translation:[0,0,0],boxes:[b([0,0,0],[1,1,1])]},{id:'joint',parent:'root',translation:[.25,0,0],boxes:[b([0,0,0],[1,1,1])]}],instances:[]};const n=normalizeAsset(a);assert.deepEqual(n.parts,a.parts);assert.equal(n.collision.selfCollision,false);assert.equal(n.collision.externalCollision,true);});
test('same species instances receive distinct collision ownership paths',()=>{const child={id:'species',parts:[{id:'root',parent:null,translation:[0,0,0],boxes:[b([0,0,0],[1,1,1])]}],instances:[]};const scene={id:'scene',parts:[],instances:[{id:'first',assetId:'species',translation:[0,0,0]},{id:'second',assetId:'species',translation:[2,0,0]}]};assert.deepEqual(flattenAsset(scene,new Map([['species',child]])).map(x=>x.ownerId),['scene/first','scene/second']);});
test('adjacent cells of one translucent liquid have no internal seam',()=>{const g=surfaceGroups([b([0,0,0],[1,1,1]),b([1,0,0],[1,1,1])],[{id:'a',opacity:.7}]).get('a');assert.equal(g.indices.length/6,10);});

// surfaceGroups skips facing boxes that cannot reach a face and can take boxes that only hide faces (P2, 0.18.1).
// The reference below is the scan it replaced: every box on the facing plane, in box order.
const EPS_REF=1e-8,boundsRef=b=>({lo:b.center.map((v,i)=>v-b.size[i]/2),hi:b.center.map((v,i)=>v+b.size[i]/2)});
function subtractRectRef(a,b){const [u,v,U,V]=a,[x,y,X,Y]=b;const l=Math.max(u,x),t=Math.max(v,y),r=Math.min(U,X),s=Math.min(V,Y);if(r-l<=EPS_REF||s-t<=EPS_REF)return[a];return [[u,v,l,V],[r,v,U,V],[l,v,r,t],[l,s,r,V]].filter(q=>q[2]-q[0]>EPS_REF&&q[3]-q[1]>EPS_REF);}
function surfaceGroupsRef(boxes,materials){const opaque=new Map(materials.map(m=>[m.id,m.opacity>=1]));const rs=boxes.map(boundsRef),planes=new Map(),groups=new Map();for(let i=0;i<rs.length;i++){for(let axis=0;axis<3;axis++)for(const side of ['lo','hi']){const key=`${axis}:${side}:${rs[i][side][axis]}`;if(!planes.has(key))planes.set(key,[]);planes.get(key).push(i);}}
 for(let i=0;i<boxes.length;i++){const b=boxes[i],r=rs[i];if(!groups.has(b.material))groups.set(b.material,{positions:[],normals:[],indices:[]});const g=groups.get(b.material);for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){const axes=[0,1,2].filter(x=>x!==axis),[u,v]=axes,plane=sign>0?r.hi[axis]:r.lo[axis];let faces=[[r.lo[u],r.lo[v],r.hi[u],r.hi[v]]];for(const j of planes.get(`${axis}:${sign>0?'lo':'hi'}:${plane}`)||[]){if(i===j||!(b.material===boxes[j].material||(opaque.get(b.material)&&opaque.get(boxes[j].material))))continue;const q=rs[j];faces=faces.flatMap(f=>subtractRectRef(f,[q.lo[u],q.lo[v],q.hi[u],q.hi[v]]));}for(const [loU,loV,hiU,hiV]of faces){let corners=[[loU,loV],[hiU,loV],[hiU,hiV],[loU,hiV]];if(sign*(axis===1?-1:1)<0)corners=corners.reverse();const start=g.positions.length/3;for(const [x,y]of corners){const pos=[0,0,0],normal=[0,0,0];pos[axis]=plane;pos[u]=x;pos[v]=y;normal[axis]=sign;g.positions.push(...pos);g.normals.push(...normal);}g.indices.push(start,start+1,start+2,start,start+2,start+3);}}}
 return groups;
}
test('surfaceGroups gives exactly the faces of the full plane scan, in the same order', async () => {
  let seed = 7; const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const materials = [{ id: 'a', opacity: 1 }, { id: 'b', opacity: 1 }, { id: 'glass', opacity: .5 }];
  for (let round = 0; round < 6; round++) {
    const raw = [];
    for (let i = 0; i < 160; i++) raw.push({ center: [0, 1, 2].map(() => Math.floor(rand() * 16) * .25), size: [0, 1, 2].map(() => [.25, .5, .5, 1, 1.5][Math.floor(rand() * 5)]), material: materials[Math.floor(rand() * 3)].id });
    for (const boxes of [raw, disjointBoxes(raw)]) assert.deepEqual(surfaceGroups(boxes, materials), surfaceGroupsRef(boxes, materials));
  }
  // Authored game models, part by part (parts up to 600 boxes here; the asset regeneration check rebuilds all GLBs).
  const { readdirSync, readFileSync } = await import('node:fs'), dir = new URL('../design/assets/models/', import.meta.url);
  let parts = 0;
  for (const file of readdirSync(dir).filter(f => f.endsWith('.voxel.json'))) {
    const asset = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    for (const part of asset.parts) if (part.boxes.length && part.boxes.length <= 600) { assert.deepEqual(surfaceGroups(part.boxes, asset.materials), surfaceGroupsRef(part.boxes, asset.materials), `${asset.id}/${part.id}`); parts++; }
  }
  assert.ok(parts > 100, `${parts} game model parts`);
});
test('boxes past emit only hide faces: a section meshed with its bordering cells gives the solid\'s faces there', () => {
  const materials = [{ id: 'a', opacity: 1 }, { id: 'glass', opacity: .5 }], cells = [];
  for (let x = 0; x < 6; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) if ((x + y * 2 + z * 3) % 5) cells.push({ center: [x * .5 + .25, y * .5 + .25, z * .5 + .25], size: [.5, .5, .5], material: x % 3 ? 'a' : 'glass' });
  const faces = groups => new Set([...groups].flatMap(([id, g]) => { const out = []; for (let i = 0; i < g.indices.length; i += 6) out.push(id + ':' + [0, 1, 2, 3, 4, 5].map(k => g.positions.slice(g.indices[i + k] * 3, g.indices[i + k] * 3 + 3).join(',')).join('|')); return out; }));
  const whole = faces(surfaceGroups(cells, materials)), split = new Set();
  for (const side of [0, 1]) {
    const mine = cells.filter(c => (c.center[0] < 1.5) === !side), border = cells.filter(c => (c.center[0] < 1.5) === !!side && Math.abs(c.center[0] - 1.5) < .5);
    for (const f of faces(surfaceGroups([...mine, ...border], materials, mine.length))) split.add(f);
  }
  assert.deepEqual([...split].sort(), [...whole].sort());
});
