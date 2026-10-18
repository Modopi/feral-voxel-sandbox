// Exact, grid-preserving cuboid subtraction within one articulated part.
// Independent parts are never fused: their joint allowance belongs to animation.
const EPS=1e-8;
const bounds=b=>({lo:b.center.map((v,i)=>v-b.size[i]/2),hi:b.center.map((v,i)=>v+b.size[i]/2)});
const intersects=(a,b)=>a.lo.every((v,i)=>v<b.hi[i]-EPS&&a.hi[i]>b.lo[i]+EPS);
function subtract(a,b){if(!intersects(a,b))return[a];const l=a.lo.map((v,i)=>Math.max(v,b.lo[i])),h=a.hi.map((v,i)=>Math.min(v,b.hi[i]));const out=[];const add=(lo,hi)=>{if(lo.every((v,i)=>hi[i]-v>EPS))out.push({lo,hi});};add([a.lo[0],a.lo[1],a.lo[2]],[l[0],a.hi[1],a.hi[2]]);add([h[0],a.lo[1],a.lo[2]],[a.hi[0],a.hi[1],a.hi[2]]);add([l[0],a.lo[1],a.lo[2]],[h[0],l[1],a.hi[2]]);add([l[0],h[1],a.lo[2]],[h[0],a.hi[1],a.hi[2]]);add([l[0],l[1],a.lo[2]],[h[0],h[1],l[2]]);add([l[0],l[1],h[2]],[h[0],h[1],a.hi[2]]);return out;}
export function subtractBox(box,cutter){return subtract(bounds(box),bounds(cutter)).map(r=>({...box,center:r.lo.map((v,i)=>(v+r.hi[i])/2),size:r.lo.map((v,i)=>r.hi[i]-v)}));}
export function boxesOverlap(a,b){return intersects(bounds(a),bounds(b));}
// The overlap checks below apply intersects() without allocating per pair: bounds are six numbers per box.
function boundsArray(boxes){const r=new Float64Array(boxes.length*6);for(let i=0;i<boxes.length;i++){const c=boxes[i].center,s=boxes[i].size;for(let k=0;k<3;k++){r[i*6+k]=c[k]-s[k]/2;r[i*6+3+k]=c[k]+s[k]/2;}}return r;}
const meets=(r,i,j)=>r[i*6]<r[j*6+3]-EPS&&r[i*6+3]>r[j*6]+EPS&&r[i*6+1]<r[j*6+4]-EPS&&r[i*6+4]>r[j*6+1]+EPS&&r[i*6+2]<r[j*6+5]-EPS&&r[i*6+5]>r[j*6+2]+EPS;
// Sweep and prune along the longest axis: a box is tested only against boxes whose span there is still open.
// visit(j,i) returning true stops the sweep.
function sweep(r,n,visit){
 let axis=0,best=-1;for(let k=0;k<3;k++){let lo=Infinity,hi=-Infinity;for(let i=0;i<n;i++){if(r[i*6+k]<lo)lo=r[i*6+k];if(r[i*6+3+k]>hi)hi=r[i*6+3+k];}if(hi-lo>best){best=hi-lo;axis=k;}}
 const order=Array.from({length:n},(_,i)=>i).sort((a,b)=>r[a*6+axis]-r[b*6+axis]),active=[];
 for(const i of order){const lo=r[i*6+axis]+EPS;let w=0;for(let k=0;k<active.length;k++)if(r[active[k]*6+3+axis]>lo)active[w++]=active[k];active.length=w;for(const j of active)if(meets(r,i,j)&&visit(j,i))return true;active.push(i);}
 return false;
}
/** Whether box overlaps any of boxes: the reject rule for one new box. */
export function overlapsAny(boxes,box){const c=box.center,s=box.size,l0=c[0]-s[0]/2,l1=c[1]-s[1]/2,l2=c[2]-s[2]/2,h0=c[0]+s[0]/2,h1=c[1]+s[1]/2,h2=c[2]+s[2]/2;
 for(const b of boxes){const d=b.center,t=b.size;if(d[0]-t[0]/2<h0-EPS&&d[0]+t[0]/2>l0+EPS&&d[1]-t[1]/2<h1-EPS&&d[1]+t[1]/2>l1+EPS&&d[2]-t[2]/2<h2-EPS&&d[2]+t[2]/2>l2+EPS)return true;}return false;}
/** Whether any incoming box overlaps another incoming box or one of existing (existing pairs are not judged). */
export function overlapsAdding(existing,incoming){const all=existing.concat(incoming),n=existing.length;return sweep(boundsArray(all),all.length,(j,i)=>i>=n||j>=n);}
export function disjointBoxes(boxes){const rects=boxes.map(bounds),out=[];for(let i=0;i<boxes.length;i++){let fragments=[rects[i]];for(let j=i+1;j<boxes.length&&fragments.length;j++){if(!intersects(rects[i],rects[j]))continue;fragments=fragments.flatMap(r=>subtract(r,rects[j]));}for(const r of fragments)out.push({...boxes[i],center:r.lo.map((v,k)=>(v+r.hi[k])/2),size:r.lo.map((v,k)=>r.hi[k]-v)});}return out;}
export function overlappingPairs(boxes){let count=0;sweep(boundsArray(boxes),boxes.length,()=>{count++;return false;});return count;}
export function normalizeAsset(asset){const a=structuredClone(asset);for(const m of a.materials)m.collision=m.collision??!['water','acid_water','visual_water'].includes(m.id);let removedPairs=0;for(const p of a.parts){removedPairs+=overlappingPairs(p.boxes);p.boxes=disjointBoxes(p.boxes);}a.collision={enabled:true,ownerScope:'entity_instance',selfCollision:false,externalCollision:true,shape:'part_cuboid_compound',jointOverlapAllowed:true};a.geometry={normalization:'last_box_wins_within_part',removedOverlappingPairs:removedPairs,independentPartOverlap:'preserve_joint_allowance',surfaceMeshing:'remove_shared_same_medium_or_opaque_faces_within_part'};return a;}
function subtractRect(a,b){const [u,v,U,V]=a,[x,y,X,Y]=b;const l=Math.max(u,x),t=Math.max(v,y),r=Math.min(U,X),s=Math.min(V,Y);if(r-l<=EPS||s-t<=EPS)return[a];return [[u,v,l,V],[r,v,U,V],[l,v,r,t],[l,s,r,V]].filter(q=>q[2]-q[0]>EPS&&q[3]-q[1]>EPS);}
// Surfaces are exported per part, retaining closed joint interfaces when parts move.
// A box on the facing plane that does not reach a face leaves it whole (subtractRect would return it unchanged),
// so it is skipped with four comparisons on a bounds array: a layer of hundreds of cells costs no allocation or
// material lookup per pair. Candidates keep the plane's box order, so the faces come out as before.
// Only the first `emit` boxes give faces; later boxes only hide faces (a section of a larger solid meshed with the
// cells that border it gives exactly that solid's faces in the section).
export function surfaceGroups(boxes,materials,emit=boxes.length){const opaque=new Map(materials.map(m=>[m.id,m.opacity>=1]));const rs=boxes.map(bounds),R=boundsArray(boxes),planes=new Map(),groups=new Map();
 const ids=new Map(),mat=new Int32Array(boxes.length),opq=new Uint8Array(boxes.length);for(let i=0;i<boxes.length;i++){const id=boxes[i].material;if(!ids.has(id))ids.set(id,ids.size);mat[i]=ids.get(id);opq[i]=opaque.get(id)?1:0;}
 for(let i=0;i<rs.length;i++){for(let axis=0;axis<3;axis++)for(const side of ['lo','hi']){const key=`${axis}:${side}:${rs[i][side][axis]}`;if(!planes.has(key))planes.set(key,[]);planes.get(key).push(i);}}
 for(let i=0;i<emit;i++){const b=boxes[i],r=rs[i];if(!groups.has(b.material))groups.set(b.material,{positions:[],normals:[],indices:[]});const g=groups.get(b.material);for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){const u=axis===0?1:0,v=axis===2?1:2,plane=sign>0?r.hi[axis]:r.lo[axis],fu=r.lo[u],fv=r.lo[v],FU=r.hi[u],FV=r.hi[v];let faces=[[fu,fv,FU,FV]];for(const j of planes.get(`${axis}:${sign>0?'lo':'hi'}:${plane}`)||[]){if(i===j||R[j*6+3+u]-fu<=EPS||FU-R[j*6+u]<=EPS||R[j*6+3+v]-fv<=EPS||FV-R[j*6+v]<=EPS||!(mat[i]===mat[j]||(opq[i]&&opq[j])))continue;const q=rs[j];faces=faces.flatMap(f=>subtractRect(f,[q.lo[u],q.lo[v],q.hi[u],q.hi[v]]));}for(const [loU,loV,hiU,hiV]of faces){let corners=[[loU,loV],[hiU,loV],[hiU,hiV],[loU,hiV]];if(sign*(axis===1?-1:1)<0)corners=corners.reverse();const start=g.positions.length/3;for(const [x,y]of corners){const pos=[0,0,0],normal=[0,0,0];pos[axis]=plane;pos[u]=x;pos[v]=y;normal[axis]=sign;g.positions.push(...pos);g.normals.push(...normal);}g.indices.push(start,start+1,start+2,start,start+2,start+3);}}}
 return groups;
}
