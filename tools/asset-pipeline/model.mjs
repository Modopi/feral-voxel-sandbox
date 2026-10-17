import {overlappingPairs} from './solid.mjs';
// Canonical hierarchy evaluation shared by validation, previews and export.
export function flattenAsset(asset,library,options={},stack=[],ownerPath=asset.id){
 if(stack.includes(asset.id))throw Error(`Cyclic asset reference: ${[...stack,asset.id].join(' > ')}`);
 const parts=new Map(asset.parts.map(p=>[p.id,p]));const memo=new Map();
 function transform(id,trail=[]){if(memo.has(id))return memo.get(id);if(trail.includes(id))throw Error('Cyclic part '+id);const p=parts.get(id);if(!p)throw Error('Missing part '+id);const base=p.parent===null?[0,0,0]:transform(p.parent,[...trail,id]);const t=base.map((v,i)=>v+p.translation[i]);memo.set(id,t);return t;}
 function hidden(id){const p=parts.get(id);return !p?false:(options.hideRoofs&&p.role==='roof')||(p.parent!==null&&hidden(p.parent));}
 const boxes=[];
 for(const p of asset.parts){const t=transform(p.id);if(hidden(p.id))continue;for(const b of p.boxes)boxes.push({...b,center:b.center.map((v,i)=>v+t[i]),materialKey:asset.id+':'+b.material,assetId:asset.id,partId:p.id,ownerId:ownerPath});}
 for(const inst of asset.instances){const child=library.get(inst.assetId);if(!child)throw Error('Missing instance '+inst.assetId);for(const b of flattenAsset(child,library,options,[...stack,asset.id],ownerPath+'/'+inst.id))boxes.push({...b,center:b.center.map((v,i)=>v+inst.translation[i])});}
 return boxes;
}
export function boundsOf(boxes){if(!boxes.length)throw Error('Empty geometry');const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const b of boxes)for(let i=0;i<3;i++){min[i]=Math.min(min[i],b.center[i]-b.size[i]/2);max[i]=Math.max(max[i],b.center[i]+b.size[i]/2);}return {min,max,size:max.map((v,i)=>v-min[i]),center:max.map((v,i)=>(v+min[i])/2)};}
export function validateAsset(a,library,content){
 const fail=m=>{throw Error(`${a.id}: ${m}`)};const vec=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
 if(a.schemaVersion!==1||a.status!=='art_prototype'||a.units!=='m'||a.upAxis!=='Y'||a.forwardAxis!=='+Z')fail('Invalid header');
 if(!['creature','boss','structure','environment','equipment'].includes(a.category)||!Number.isFinite(a.visualGridM)||a.visualGridM<=0)fail('Invalid category/grid');
 const source=content[a.contentRef.file.split('/').pop().replace('.json','')];if(!source?.entries.some(e=>e.id===a.contentRef.id)||a.contentRef.id!==a.id)fail('Invalid content ref');
 const blockIds=new Set(content.blocks.entries.map(x=>x.id)),materialIds=new Set(),partIds=new Set();
 for(const m of a.materials){if(materialIds.has(m.id)||!/^#[0-9a-fA-F]{6}$/.test(m.color))fail('Invalid material '+m.id);materialIds.add(m.id);for(const key of ['roughness','metallic','opacity'])if(!Number.isFinite(m[key])||m[key]<0||m[key]>1)fail('Invalid '+key);if(!Number.isFinite(m.emission)||m.emission<0||m.emission>5)fail('Invalid emission');if(m.blockId&&!blockIds.has(m.blockId))fail('Unknown block '+m.blockId);}
 for(const p of a.parts){if(partIds.has(p.id)||!vec(p.translation))fail('Invalid part '+p.id);partIds.add(p.id);for(const b of p.boxes){if(!vec(b.center)||!vec(b.size)||b.size.some(v=>v<=0)||!materialIds.has(b.material))fail('Invalid box '+p.id);for(let i=0;i<3;i++)for(const v of [b.center[i]-b.size[i]/2,b.size[i],p.translation[i]])if(Math.abs(v/a.visualGridM-Math.round(v/a.visualGridM))>1e-5)fail('Off grid '+p.id);}}
 if(a.parts.filter(p=>p.parent===null).length!==1)fail('Expected one root');for(const p of a.parts)if(p.parent!==null&&!partIds.has(p.parent))fail('Unknown parent');
 const anchorIds=new Set();for(const x of a.anchors){if(anchorIds.has(x.id)||!partIds.has(x.partId)||!vec(x.position))fail('Invalid anchor '+x.id);anchorIds.add(x.id);}
 const instanceIds=new Set();for(const x of a.instances){if(instanceIds.has(x.id)||!library.has(x.assetId)||!vec(x.translation))fail('Invalid instance '+x.id);instanceIds.add(x.id);}
 if(a.collision){const c=a.collision;if(c.enabled!==true||c.ownerScope!=='entity_instance'||c.selfCollision!==false||c.externalCollision!==true||c.shape!=='part_cuboid_compound'||c.jointOverlapAllowed!==true)fail('Collision contract mismatch');for(const p of a.parts)if(overlappingPairs(p.boxes))fail('Overlapping solids within part '+p.id);for(const m of a.materials)if(typeof m.collision!=='boolean')fail('Material collision must be explicit');}
 const boxes=flattenAsset(a,library);const bounds=boundsOf(boxes);return {boxes:boxes.length,parts:a.parts.length,anchors:a.anchors.length,bounds};
}
