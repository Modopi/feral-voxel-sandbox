import {subtractBox,overlapsAny,overlapsAdding,overlappingPairs} from './solid.mjs';
export const COLLISION_CONTRACT=Object.freeze({enabled:true,ownerScope:'entity_instance',selfCollision:false,externalCollision:true,shape:'part_cuboid_compound',jointOverlapAllowed:true});
const createdAssets=new WeakSet();
export function assertCreatedByTool(asset){if(!createdAssets.has(asset))throw Error('에셋은 FERAL 제작 도구로 생성해야 합니다.');}
export function initializeAuthoring(asset){createdAssets.add(asset);asset.collision={...COLLISION_CONTRACT};asset.geometry={authoringTool:'feral_voxel_builder_v1',occupancy:'exclusive_within_part',independentPartOverlap:'preserve_joint_allowance',surfaceMeshing:'remove_shared_same_medium_or_opaque_faces_within_part'};return asset;}
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
function validateRegion(asset,b){if(!vector(b.center)||!vector(b.size)||b.size.some(v=>v<=0))throw Error('위치와 크기는 유한한 숫자여야 하며 크기는 0보다 커야 합니다.');const g=asset.visualGridM;if(!Number.isFinite(g)||g<=0)throw Error('유효한 복셀 격자가 필요합니다.');for(let i=0;i<3;i++)for(const v of [b.center[i]-b.size[i]/2,b.size[i]])if(Math.abs(v/g-Math.round(v/g))>1e-6)throw Error(`복셀 경계와 크기를 ${g}m 격자에 맞추세요.`);}
function targetPart(asset,id){const p=asset.parts.find(p=>p.id===id);if(!p)throw Error('없는 부위입니다: '+id);return p;}
/** Shared creation primitive. No invalid intermediate asset is ever committed. */
export function placeBox(asset,partId,box,{mode='reject'}={}){
 if(!['reject','replace','fill'].includes(mode))throw Error('추가 방식은 reject, replace, fill 중 하나여야 합니다.');validateRegion(asset,box);if(!asset.materials.some(m=>m.id===box.material))throw Error('없는 재질입니다: '+box.material);const p=targetPart(asset,partId);const incoming=structuredClone(box);
 if(mode==='reject'){if(overlapsAny(p.boxes,incoming))throw Error('같은 부위의 기존 복셀과 겹칩니다. 위치를 바꾸거나 명시적으로 교체를 선택하세요.');p.boxes.push(incoming);}
 else if(mode==='replace'){const next=p.boxes.flatMap(b=>subtractBox(b,incoming));next.push(incoming);p.boxes=next;}
 else{let next=[incoming];for(const b of p.boxes){next=next.flatMap(f=>subtractBox(f,b));if(!next.length)break;}p.boxes.push(...next);}
 return incoming;
}
/** Many boxes in reject mode at once: checked together by sweep and prune, committed together or not at all. */
export function placeBoxes(asset,partId,boxes){
 if(!Array.isArray(boxes))throw Error('복셀 목록이 필요합니다.');for(const box of boxes){validateRegion(asset,box);if(!asset.materials.some(m=>m.id===box.material))throw Error('없는 재질입니다: '+box.material);}
 const p=targetPart(asset,partId),incoming=structuredClone(boxes);if(overlapsAdding(p.boxes,incoming))throw Error('같은 부위의 기존 복셀과 겹칩니다. 위치를 바꾸거나 명시적으로 교체를 선택하세요.');for(const box of incoming)p.boxes.push(box);
 return incoming;
}
export function removeRegion(asset,partId,region){validateRegion(asset,region);const p=targetPart(asset,partId);p.boxes=p.boxes.flatMap(b=>subtractBox(b,region));}
export function assertAuthoringInvariant(a){
 if(!Array.isArray(a.parts)||!Array.isArray(a.materials))throw Error('부위와 재질 목록이 필요합니다.');const ids=new Set(a.parts.map(p=>p.id));if(ids.size!==a.parts.length)throw Error('중복 부위 ID');if(a.parts.filter(p=>p.parent===null).length!==1)throw Error('최상위 부위는 하나여야 합니다.');
 for(const p of a.parts){if(!vector(p.translation)||p.translation.some(v=>Math.abs(v/a.visualGridM-Math.round(v/a.visualGridM))>1e-6))throw Error('부위 피벗을 격자에 맞추세요.');let current=p;const seen=new Set();while(current){if(seen.has(current.id))throw Error('부위 순환 참조');seen.add(current.id);if(current.parent===null)break;current=a.parts.find(x=>x.id===current.parent);if(!current)throw Error('없는 부모 부위');}for(const b of p.boxes){validateRegion(a,b);if(!a.materials.some(m=>m.id===b.material))throw Error('없는 재질');}if(overlappingPairs(p.boxes))throw Error('기존 모델에 같은 부위의 중복 점유가 있습니다. 제작 도구는 잘못된 원본을 자동 보정하지 않습니다.');}
 for(const [key,value]of Object.entries(COLLISION_CONTRACT))if(a.collision?.[key]!==value)throw Error('충돌 계약 위반: '+key);
}
export class VoxelAssetBuilder{
 constructor(asset){this.asset=structuredClone(asset);initializeAuthoring(this.asset);for(const m of this.asset.materials)m.collision=m.collision??!['water','acid_water','visual_water'].includes(m.id);assertAuthoringInvariant(this.asset);}
 addBox(partId,box,options){return placeBox(this.asset,partId,box,options);}
 addBoxes(partId,boxes){return placeBoxes(this.asset,partId,boxes);}
 removeBox(partId,region){removeRegion(this.asset,partId,region);}
 addPart({id,parent='root',translation=[0,0,0],role='visual'}){if(typeof id!=='string'||!id||this.asset.parts.some(p=>p.id===id))throw Error('새 부위에는 중복되지 않는 이름이 필요합니다.');targetPart(this.asset,parent);if(!vector(translation)||translation.some(v=>Math.abs(v/this.asset.visualGridM-Math.round(v/this.asset.visualGridM))>1e-6))throw Error('부위 피벗을 격자에 맞추세요.');const p={id,parent,translation:[...translation],role,boxes:[]};this.asset.parts.push(p);return p;}
 toJSON(){assertAuthoringInvariant(this.asset);const copy=structuredClone(this.asset);createdAssets.add(copy);return copy;}
}
