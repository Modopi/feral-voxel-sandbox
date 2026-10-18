import * as T from '../vendor/three.module.js';
import {surfaceGroups} from './voxel/solid.js';

/** Render-only batching inside one part. Callers retain part nodes/pivots and collider ownership.
 * The returned geometry/material are owned by the caller and must be disposed together.
 * No groups/multi-material meshes: each entry is exactly one draw call per render pass.
 */
export function buildPartMeshes(boxes,materials){
  const sources=new Map(materials.map(m=>[m.id,m]));
  for(const box of boxes)if(!sources.has(box.material))throw Error(`Unknown surface material: ${box.material}`);
  const batches=new Map();
  // Keep surfaceGroups' exact face subtraction, winding, normals and triangle topology.
  for(const [id,surface]of surfaceGroups(boxes,materials)){
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
  const result=[];
  for(const batch of batches.values()){
    const geometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.Float32BufferAttribute(batch.positions,3));
    geometry.setAttribute('normal',new T.Float32BufferAttribute(batch.normals,3));
    geometry.setAttribute('color',new T.Float32BufferAttribute(batch.colors,3));
    geometry.setIndex(batch.indices);
    const material=new T.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:batch.roughness,metalness:batch.metalness,
      emissive:batch.emissive,emissiveIntensity:batch.emission,opacity:batch.opacity,transparent:batch.opacity<1,depthWrite:batch.opacity>=1});
    result.push({geometry,material});
  }
  return result;
}
