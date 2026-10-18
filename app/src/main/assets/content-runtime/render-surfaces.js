import * as T from '../vendor/three.module.js';
import {surfaceGroups} from './voxel/solid.js';

/** Surfaces of one part's boxes collected into batches by material look (one draw call each); `emit` as in
 * surfaceGroups (later boxes only hide faces). */
function surfaceBatches(boxes,materials,emit=boxes.length){
  const sources=new Map(materials.map(m=>[m.id,m]));
  for(const box of boxes)if(!sources.has(box.material))throw Error(`Unknown surface material: ${box.material}`);
  const batches=new Map();
  // Keep surfaceGroups' exact face subtraction, winding, normals and triangle topology.
  for(const [id,surface]of surfaceGroups(boxes,materials,emit)){
    if(!surface.positions.length)continue;
    const src=sources.get(id),opacity=src.opacity??1,roughness=src.roughness??.9,metalness=src.metallic??0,emission=src.emission??0;
    // Three Color reads CSS/hex in sRGB and converts into its linear working space.
    const color=new T.Color(src.color);
    const key=JSON.stringify([opacity,roughness,metalness,emission,emission!==0?color.toArray():null,opacity<1?id:null]);
    let batch=batches.get(key);
    if(!batch){batch={positions:[],normals:[],colors:[],indices:[],opacity,roughness,metalness,emission,emissive:color};batches.set(key,batch);}
    const offset=batch.positions.length/3;
    for(const n of surface.positions)batch.positions.push(n);
    for(const n of surface.normals)batch.normals.push(n);
    for(let i=0;i<surface.positions.length;i+=3)batch.colors.push(color.r,color.g,color.b);
    for(const n of surface.indices)batch.indices.push(n+offset);
  }
  return batches;
}
function batchMaterial(batch){
  return new T.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:batch.roughness,metalness:batch.metalness,
    emissive:batch.emissive,emissiveIntensity:batch.emission,opacity:batch.opacity,transparent:batch.opacity<1,depthWrite:batch.opacity>=1});
}
function batchGeometry(batch){
  // Typed arrays (joined piece sections) are used as they are; plain arrays are converted.
  const geometry=new T.BufferGeometry(),attribute=(a,n)=>a instanceof Float32Array?new T.BufferAttribute(a,n):new T.Float32BufferAttribute(a,n);
  geometry.setAttribute('position',attribute(batch.positions,3));
  geometry.setAttribute('normal',attribute(batch.normals,3));
  geometry.setAttribute('color',attribute(batch.colors,3));
  geometry.setIndex(batch.indices instanceof Uint32Array?new T.BufferAttribute(batch.indices,1):batch.indices);
  return geometry;
}

/** Render-only batching inside one part. Callers retain part nodes/pivots and collider ownership.
 * The returned geometry/material are owned by the caller and must be disposed together.
 * No groups/multi-material meshes: each entry is exactly one draw call per render pass.
 */
export function buildPartMeshes(boxes,materials){
  const result=[];
  for(const batch of surfaceBatches(boxes,materials).values())result.push({geometry:batchGeometry(batch),material:batchMaterial(batch)});
  return result;
}

// ---- Loose world pieces (docs/ARCHITECTURE.md §7) ----
// Piece-local cells stay within a few thousand of the origin (a piece is at most 2048 cells), so the keys stay exact.
const CELL=.5,SECTION_CELLS=4,OFF=4096,K=8192,cellKey=(x,y,z)=>((x+OFF)*K+(y+OFF))*K+(z+OFF);
const NEIGHBOUR_KEYS=[K*K,-K*K,K,-K,1,-1],MATERIAL_NUMBERS=new Map();
const isCell=b=>b.size[0]===CELL&&b.size[1]===CELL&&b.size[2]===CELL&&Number.isInteger(b.center[0]/CELL-.5)&&Number.isInteger(b.center[1]/CELL-.5)&&Number.isInteger(b.center[2]/CELL-.5);
const typed=batch=>({...batch,positions:Float32Array.from(batch.positions),normals:Float32Array.from(batch.normals),colors:Float32Array.from(batch.colors),indices:Uint32Array.from(batch.indices)});
/** A loose piece's 0.5 m cells meshed per 2 m section: each section is meshed with the cells bordering it (they
 * only hide faces), so together the sections give exactly the piece's faces. Breaking a cell or splitting the
 * piece re-meshes only the sections whose cells or bordering cells changed (compared as numbers: cell key and
 * material per cell); the cached sections are then copied into one geometry per material batch, the same draw
 * calls buildPartMeshes gives. Boxes that are not cells (creature fragments) are one section. */
export class SectionedSurfaces{
  constructor(){this.sections=new Map();this.meshed=0;}
  /** Batches (material look → joined typed positions, normals, colors, indices) of the piece's current boxes. */
  update(boxes,materials){
    const n=boxes.length,wanted=new Map();
    // A split rebuilds the piece in another cell and material order: sections compare sorted cells and global material numbers.
    const mat=new Int32Array(n);for(let i=0;i<n;i++){const id=boxes[i].material;let m=MATERIAL_NUMBERS.get(id);if(m===undefined)MATERIAL_NUMBERS.set(id,m=MATERIAL_NUMBERS.size);mat[i]=m;}
    if(boxes.every(isCell)){
      const keys=new Float64Array(n),sec=new Float64Array(n),index=new Map();
      for(let i=0;i<n;i++){const c=boxes[i].center,x=Math.round(c[0]/CELL-.5),y=Math.round(c[1]/CELL-.5),z=Math.round(c[2]/CELL-.5);
        keys[i]=cellKey(x,y,z);sec[i]=cellKey(Math.floor(x/SECTION_CELLS),Math.floor(y/SECTION_CELLS),Math.floor(z/SECTION_CELLS));index.set(keys[i],i);
        let s=wanted.get(sec[i]);if(!s)wanted.set(sec[i],s={own:[],border:new Set()});s.own.push(i);}
      for(let i=0;i<n;i++){const s=wanted.get(sec[i]);for(const d of NEIGHBOUR_KEYS){const j=index.get(keys[i]+d);if(j!==undefined&&sec[j]!==sec[i])s.border.add(j);}}
      const byCell=(a,b)=>keys[a]-keys[b];
      for(const s of wanted.values()){s.own.sort(byCell);const list=[...s.own,...[...s.border].sort(byCell)],sig=new Float64Array(list.length*2+1);sig[0]=s.own.length;list.forEach((i,k)=>{sig[1+k*2]=keys[i];sig[2+k*2]=mat[i];});s.list=list;s.signature=sig;}
    }else{
      // Free-form boxes: one section, compared by the boxes array itself.
      wanted.set('all',{list:boxes.map((_,i)=>i),own:boxes,signature:boxes});
    }
    for(const k of this.sections.keys())if(!wanted.has(k))this.sections.delete(k);
    for(const [k,s]of wanted){
      const old=this.sections.get(k);
      if(old&&old.signature.length===s.signature.length&&old.signature.every((v,i)=>v===s.signature[i]))continue;
      const batches=new Map();for(const [key,b]of surfaceBatches(s.list.map(i=>boxes[i]),materials,s.own.length))batches.set(key,typed(b));
      this.sections.set(k,{signature:s.signature,batches});this.meshed++;
    }
    const totals=new Map(),order=[...this.sections.keys()].sort((a,b)=>a<b?-1:a>b?1:0);
    for(const k of order)for(const [key,b]of this.sections.get(k).batches){const t=totals.get(key)??{vertices:0,indices:0,props:b};t.vertices+=b.positions.length;t.indices+=b.indices.length;totals.set(key,t);}
    const joined=new Map();
    for(const [key,t]of totals){const {positions,normals,colors,indices,...props}=t.props;joined.set(key,{...props,positions:new Float32Array(t.vertices),normals:new Float32Array(t.vertices),colors:new Float32Array(t.vertices),indices:new Uint32Array(t.indices),v:0,i:0});}
    for(const k of order)for(const [key,b]of this.sections.get(k).batches){const j=joined.get(key),offset=j.v/3;
      j.positions.set(b.positions,j.v);j.normals.set(b.normals,j.v);j.colors.set(b.colors,j.v);for(let q=0;q<b.indices.length;q++)j.indices[j.i+q]=b.indices[q]+offset;j.v+=b.positions.length;j.i+=b.indices.length;}
    return joined;
  }
}
/** Meshes for SectionedSurfaces batches on `node`: geometry is replaced in place, a material kept per batch. */
export function syncBatchMeshes(node,meshes,batches,userData){
  for(const [key,mesh]of meshes)if(!batches.has(key)){mesh.removeFromParent();mesh.geometry.dispose();mesh.material.dispose();meshes.delete(key);}
  for(const [key,batch]of batches){
    let mesh=meshes.get(key);
    if(mesh){mesh.geometry.dispose();mesh.geometry=batchGeometry(batch);continue;}
    mesh=new T.Mesh(batchGeometry(batch),batchMaterial(batch));mesh.userData={...userData};node.add(mesh);meshes.set(key,mesh);
  }
  return [...meshes.values()];
}
