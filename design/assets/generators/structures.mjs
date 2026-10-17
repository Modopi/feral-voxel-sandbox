import { asset, mat, part, paint as box, anchor, rng } from './shared.mjs';

// The original room volumes and corridor paths are the geometric source of truth.
// These render prototypes deliberately do not implement collision or component logic.
const COLORS = {
  log:'#73503A', plank:'#A77A50', stone:'#92948B', rubble:'#756E64',
  moss:'#65844D', clay_brick:'#96705F', iron_scrap_block:'#716D68',
  basalt:'#444D52', glass:'#9DC5C4', algae:'#477D63', mana_log:'#638A8C',
  sacred_stone:'#C2B790', anomaly_stone:'#5A6486', water:'#397E96',
};
const EPS = 1e-7;
const rect = (lo,hi) => ({lo,hi});
const intersect = (a,b) => a.lo.every((v,i)=>v < b.hi[i]-EPS && a.hi[i]>b.lo[i]+EPS);
function subtract(a,b) {
  if (!intersect(a,b)) return [a];
  const l=a.lo.map((v,i)=>Math.max(v,b.lo[i])), h=a.hi.map((v,i)=>Math.min(v,b.hi[i]));
  const out=[], push=(lo,hi)=>{if(lo.every((v,i)=>hi[i]-v>EPS))out.push(rect(lo,hi));};
  push([a.lo[0],a.lo[1],a.lo[2]],[l[0],a.hi[1],a.hi[2]]);
  push([h[0],a.lo[1],a.lo[2]],[a.hi[0],a.hi[1],a.hi[2]]);
  push([l[0],a.lo[1],a.lo[2]],[h[0],l[1],a.hi[2]]);
  push([l[0],h[1],a.lo[2]],[h[0],a.hi[1],a.hi[2]]);
  push([l[0],l[1],a.lo[2]],[h[0],h[1],l[2]]);
  push([l[0],l[1],h[2]],[h[0],h[1],a.hi[2]]);
  return out;
}
function segments(path,width,height) {
  return path.slice(1).map((end,i)=>{
    const start=path[i], lo=start.map((v,j)=>Math.min(v,end[j])), hi=start.map((v,j)=>Math.max(v,end[j]));
    // Extend half width around both ends to retain clearance at all right-angle bends.
    lo[0]-=width/2;lo[2]-=width/2;hi[0]+=width/2;hi[2]+=width/2;
    hi[1]+=height;
    return rect(lo,hi);
  });
}
function emit(a,p,r,m) {box(a,p,r.lo.map((v,i)=>(v+r.hi[i])/2),r.lo.map((v,i)=>r.hi[i]-v),m);}
function carved(a,p,r,m,voids) {
  let cuts=[r];
  for(const v of voids) {
    if(!intersect(r,v))continue;
    cuts=cuts.flatMap(c=>subtract(c,v));
    if(!cuts.length)return;
  }
  for(const c of cuts)emit(a,p,c,m);
}
function shellFaces(r,t) {
  const [x,y,z]=r.lo,[X,Y,Z]=r.hi;
  return [rect([x-t,y,z-t],[x,Y,Z+t]),rect([X,y,z-t],[X+t,Y,Z+t]),
    rect([x,y,z-t],[X,Y,z]),rect([x,y,Z],[X,Y,Z+t])];
}
function roof(a,p,r,m,style) {
  const [x,,z]=r.lo,[X,Y,Z]=r.hi, width=X-x,depth=Z-z;
  if(style==='grove'||style==='mana_grove') {
    // A stepped pitched roof starts at clear ceiling height; no upper floor is invented.
    for(let i=0;i<Math.ceil(depth/2);i++) {
      const zz=z+i*2,dd=Math.min(2,Z-zz);
      const rise=Math.floor(Math.min(zz-z,Z-zz-dd)/4)*.5;
      emit(a,p,rect([x-1,Y+rise,zz],[X+1,Y+rise+.5,zz+dd]),m);
    }
  } else {
    emit(a,p,rect([x-.5,Y,z-.5],[X+.5,Y+.5,Z+.5]),m);
  }
  if(['ridge','sacred','anomaly'].includes(style)) {
    for(let xx=x;xx<X;xx+=4) {
      emit(a,p,rect([xx,Y+.5,z-.5],[Math.min(xx+1,X),Y+1.5,z+.5]),m);
      emit(a,p,rect([xx,Y+.5,Z-.5],[Math.min(xx+1,X),Y+1.5,Z+.5]),m);
    }
  }
}
function make(entry,content) {
  const a=asset(entry,'structure',.5),available=new Set(content.blocks.entries.map(b=>b.id));
  const byBlock={};
  function material(id) {
    if(!available.has(id))throw new Error(`Unknown structure block ${id}`);
    if(!byBlock[id])byBlock[id]=mat(a,id,COLORS[id]||'#8C8B80',{blockId:id,
      roughness:id==='glass'?.2:.88,metallic:id==='iron_scrap_block'?.55:0,
      opacity:id==='water'?.72:1});
    return byBlock[id];
  }
  const walls=material(entry.blockAssignments.wall),floors=material(entry.blockAssignments.floor),
    roofing=material(entry.blockAssignments.roof),trim=material(entry.blockAssignments.trim),
    style=entry.environmentId,thickness=entry.wallThicknessM||1;
  const floorP=part(a,'floor_mesh',[0,0,0],'root','floor').id;
  const wallP=part(a,'room_walls',[0,0,0],'root','wall').id;
  const hallP=part(a,'corridor_walls',[0,0,0],'root','wall').id;
  const detailP=part(a,'exterior_details',[0,0,0],'root','landmark').id;
  const propP=part(a,'interior_landmarks',[0,0,0],'root','landmark').id;
  const rooms=entry.rooms.map(r=>rect(r.minM,r.maxM));
  const corridors=entry.connections.flatMap(c=>segments(c.centerlineM,c.clearWidthM,c.clearHeightM));
  const mouths=[];
  for(const e of entry.entrances) {
    const room=entry.rooms.find(r=>r.id===e.roomId),[x,y,z]=e.positionM,[w,h]=e.clearSizeM;
    const xface=Math.abs(x-room.minM[0])<EPS||Math.abs(x-room.maxM[0])<EPS;
    mouths.push(xface?rect([x-2,y,z-w/2],[x+2,y+h,z+w/2]):rect([x-w/2,y,z-2],[x+w/2,y+h,z+2]));
    anchor(a,e.id,'root',e.positionM,`Open entrance ${w}m wide, ${h}m high; no combat lock`);
  }
  const exterior=entry.exteriorBypass?segments(entry.exteriorBypass.pathM,entry.exteriorBypass.widthM,5):[];
  const parking=entry.machineParking?rect(entry.machineParking.centerM.map((v,i)=>i===1?v:v-entry.machineParking.clearSizeM[i]/2),entry.machineParking.centerM.map((v,i)=>i===1?v+entry.machineParking.clearSizeM[i]:v+entry.machineParking.clearSizeM[i]/2)):null;
  const reserved=[...corridors,...mouths,...exterior,...(parking?[parking]:[])];
  for(const room of rooms)for(const face of shellFaces(room,thickness))carved(a,wallP,face,walls,reserved);
  // Hall shells are subtracted by every other open volume, leaving no phantom walls at junctions.
  corridors.forEach((r,i)=>{
    for(const face of shellFaces(r,thickness))carved(a,hallP,face,walls,[...rooms,...reserved]);
    const rp=part(a,`corridor_roof_${i}`,[0,0,0],'root','roof').id;
    carved(a,rp,rect([r.lo[0]-thickness,r.hi[1],r.lo[2]-thickness],[r.hi[0]+thickness,r.hi[1]+.5,r.hi[2]+thickness]),roofing,rooms);
  });
  // A floor-cell union preserves exact room and connection coverage without z-fighting.
  const tiles=new Map();
  function paint(r,m) {
    for(let z=Math.round(r.lo[2]*2);z<Math.round(r.hi[2]*2);z++)
      for(let x=Math.round(r.lo[0]*2);x<Math.round(r.hi[0]*2);x++)tiles.set(`${x},${z}`,m);
  }
  for(const r of [...rooms,...corridors,...mouths,...exterior,...(parking?[parking]:[])])paint(r,floors);
  const basin=entry.ecology?.water;
  if(basin) {
    const [x,y,z]=basin.basinCenterM,[w,h,d]=basin.basinSizeM;
    // Data y is basin bottom, matching room floor y=0.
    const b=rect([x-w/2,y,z-d/2],[x+w/2,y+h,z+d/2]);
    for(let zz=b.lo[2]*2;zz<b.hi[2]*2;zz++)for(let xx=b.lo[0]*2;xx<b.hi[0]*2;xx++)tiles.delete(`${xx},${zz}`);
    emit(a,floorP,rect([b.lo[0],b.lo[1]-.5,b.lo[2]],[b.hi[0],b.lo[1],b.hi[2]]),floors);
    emit(a,propP,rect([b.lo[0],b.lo[1],b.lo[2]],[b.hi[0],-.5,b.hi[2]]),mat(a,'visual_water',COLORS.water,{opacity:.72,roughness:.2}));
    for(const f of shellFaces(b,.5))emit(a,propP,f,walls);
    anchor(a,'ecology_water','root',[x,y,z],'Basin placement; fluid simulation not implemented in visual asset');
  }
  const zRows=new Map();
  for(const [key,m]of tiles){const[x,z]=key.split(',').map(Number);if(!zRows.has(z))zRows.set(z,[]);zRows.get(z).push([x,m]);}
  const runs=[];
  for(const [z,xs]of [...zRows].sort((a,b)=>a[0]-b[0])){
    xs.sort((a,b)=>a[0]-b[0]);let start=xs[0][0],end=start+1,m=xs[0][1];
    const add=()=>runs.push({start,end,z,m});
    for(const [x,mm]of xs.slice(1))if(x===end&&mm===m)end++;else{add();start=x;end=x+1;m=mm;}add();
  }
  const merged=[];let active=new Map(),lastZ=null;
  for(const run of runs){
    if(run.z!==lastZ){if(lastZ!==null&&run.z!==lastZ+1)active=new Map();lastZ=run.z;}
    const key=`${run.start}:${run.end}:${run.m}`;const old=active.get(key);
    if(old&&old.z1===run.z){old.z1++;}else{const q={...run,z0:run.z,z1:run.z+1};merged.push(q);active.set(key,q);}
  }
  for(const q of merged)emit(a,floorP,rect([q.start/2,-(entry.floorThicknessM||.5),q.z0/2],[q.end/2,0,q.z1/2]),q.m);

  // Decorative exterior posts are carved against all traversable reserved volumes.
  function outside(r,m=trim){carved(a,detailP,r,m,[...rooms,...reserved]);}
  entry.rooms.forEach((r,index)=>{
    const [x,,z]=r.minM,[X,Y,Z]=r.maxM,cx=(x+X)/2,cz=(z+Z)/2;
    const rp=part(a,`roof_${r.id}`,[0,0,0],'root','roof').id;
    roof(a,rp,rooms[index],roofing,style);
    anchor(a,`room_${r.id}`,'root',r.centerM,r.name);
    // Four corner piers and horizontal facade banding express construction scale.
    for(const xx of[x-1.5,X+.5])for(const zz of[z-1.5,Z+.5])
      outside(rect([xx,0,zz],[xx+1,Y+.5,zz+1]),walls);
    for(const zz of[z-1.5,Z+.5])outside(rect([x,Math.min(3,Y-.5),zz],[X,Math.min(3,Y-.5)+.5,zz+.5]));
    if(style==='grove'||style==='mana_grove'){
      for(let k=0;k<3;k++){
        const xx=x+2+k*3;
        if(xx+1>=X)continue;
        outside(rect([xx,0,Z+1],[xx+1,2+k*.5,Z+2]),material(style==='grove'?'log':'mana_log'));
        outside(rect([xx-.5,2+k*.5,Z+1],[xx+1.5,2.5+k*.5,Z+1.5]),trim);
      }
      // Moss shingles / pale canopy frames remain attached to the hideable roof.
      for(let xx=x+1;xx<X-1;xx+=4)emit(a,rp,rect([xx,Y+.5,z+1],[xx+1,Y+1,z+3]),trim);
    }else if(style==='ridge'){
      for(let xx=x+2;xx<X;xx+=5)outside(rect([xx,0,z-2],[xx+1,3,z-1]),material('iron_scrap_block'));
      for(let xx=x;xx<X;xx+=4)emit(a,rp,rect([xx,Y+.5,cz-1],[Math.min(xx+2,X),Y+1.5,cz+1]),material('iron_scrap_block'));
    }else if(style==='marsh'){
      // Square section downpipes are deliberately outside the clear interiors.
      for(const xx of[x-2,X+1])outside(rect([xx,0,z+2],[xx+.5,Y,z+2.5]),walls);
      emit(a,rp,rect([cx-2,Y,cz-2],[cx+2,Y+1,cz+2]),walls);
      emit(a,rp,rect([cx-1,Y+1,cz-1],[cx+1,Y+1.5,cz+1]),trim);
    }else if(style==='thermal'){
      for(const xx of[x+1,X-3]){
        emit(a,rp,rect([xx,Y,z+1],[xx+2,Y+3,z+3]),material('basalt'));
        emit(a,rp,rect([xx-.5,Y+3,z+.5],[xx+2.5,Y+3.5,z+3.5]),material('iron_scrap_block'));
      }
    }else if(style==='coast'){
      emit(a,rp,rect([cx-.5,Y,cz-.5],[cx+.5,Y+3,cz+.5]),material('plank'));
      emit(a,rp,rect([cx-2,Y+2.5,cz-.5],[cx+2,Y+3,cz+.5]),material('glass'));
      // Glass skylight strips read as an observatory without inventing an upper room.
      for(let xx=x+1;xx<X-1;xx+=4)emit(a,rp,rect([xx,Y+.5,z+1],[xx+2,Y+1,Z-1]),material('glass'));
    }else if(style==='sacred'){
      for(let xx=x+2;xx<X;xx+=5){
        outside(rect([xx,0,z-2],[xx+1,2,z-1]),walls);
        outside(rect([xx,2,z-1.5],[xx+1,Y,z-1]),trim);
      }
      emit(a,rp,rect([cx-.5,Y,cz-.5],[cx+.5,Y+2,cz+.5]),trim);
      emit(a,rp,rect([cx-1.5,Y+1,cz-.5],[cx+1.5,Y+1.5,cz+.5]),trim);
    }else if(style==='anomaly'){
      const yy=Y+1;
      for(const zz of[z+1,Z-2])emit(a,rp,rect([x+1,yy,zz],[X-1,yy+.5,zz+.5]),material('anomaly_stone'));
      for(const xx of[x+1,X-1.5])emit(a,rp,rect([xx,yy,z+1],[xx+.5,yy+.5,Z-1.5]),material('anomaly_stone'));
      for(const xx of[x+1,X-2])emit(a,rp,rect([xx,Y,z+1],[xx+.5,yy,z+1.5]),material('basalt'));
    }
  });

  // Material variation, broken silhouettes and environment-specific construction details.
  // All additions outside the original clear volume are clipped against circulation.
  const random=rng(entry.id+':architectural-weathering-v2');
  const wallDark=mat(a,'weathered_wall',style==='grove'?'#725039':style==='mana_grove'?'#486B74':style==='sacred'?'#A39879':'#656B6D',{blockId:entry.blockAssignments.wall});
  const wallLight=mat(a,'worn_wall',style==='grove'?'#BC9465':style==='sacred'?'#D1C7A4':style==='mana_grove'?'#85AEA7':'#A1A197',{blockId:entry.blockAssignments.wall});
  const greens=style==='grove'?[mat(a,'deep_moss','#46623E',{blockId:'moss'}),material('moss'),mat(a,'sunlit_leaves','#8BA65B',{blockId:'leaves'})]:style==='mana_grove'?[mat(a,'pale_canopy','#85B5AA',{blockId:'mana_fern'}),mat(a,'dark_canopy','#426F70',{blockId:'mana_fern'}),material('mana_log')]:[];
  const windowCuts=[];
  function cutPart(partId,cuts){
    const p=a.parts.find(p=>p.id===partId),old=p.boxes;p.boxes=[];
    for(const b of old){let rs=[rect(b.center.map((v,i)=>v-b.size[i]/2),b.center.map((v,i)=>v+b.size[i]/2))];for(const cut of cuts)rs=rs.flatMap(r=>subtract(r,cut));for(const r of rs)emit(a,partId,r,b.material);}
  }
  entry.rooms.forEach((r,ri)=>{
    const [x,,z]=r.minM,[X,Y,Z]=r.maxM,cx=(x+X)/2,cz=(z+Z)/2;
    const rp=`roof_${r.id}`;
    // Cut actual windows and place a projecting sill/lintel; openings remain legible at a distance.
    for(const zz of[z,Z])for(let xx=x+2;xx<X-2;xx+=6){
      const h=style==='sacred'?3:2,lo=2,side=zz===z?-1:1;
      windowCuts.push(rect([xx,lo,zz-1.5],[xx+2,lo+h,zz+1.5]));
      const face=side<0?zz-1.5:zz+1;
      outside(rect([xx-.5,lo-.5,face],[xx+2.5,lo,face+.5]),wallLight);
      outside(rect([xx-.5,lo+h,face],[xx+2.5,lo+h+.5,face+.5]),wallLight);
      for(const xxx of[xx-.5,xx+2])outside(rect([xxx,lo,face],[xxx+.5,lo+h,face+.5]),wallLight);
    }
    if(!['grove','mana_grove'].includes(style)){
      // Staggered ashlar/brick courses avoid smooth monolithic concrete boxes.
      for(let yy=.5;yy<Math.min(Y,9);yy+=2)for(const zz of[z-1.5,Z+1])
        for(let xx=x+(Math.round(yy)%2?1:0);xx<X-1;xx+=4)
          if(random()>.28)outside(rect([xx,yy,zz],[Math.min(xx+2.5,X),yy+.5,zz+.5]),random()>.5?wallDark:wallLight);
    }else{
      // Timber bay framing plus long 0.5m-grid roots curling outside the exterior.
      for(let xx=x+2;xx<X;xx+=4)for(const zz of[z-1.5,Z+1])outside(rect([xx,0,zz],[xx+.5,Y,zz+.5]),wallDark);
      for(const corner of[[x-1.5,z-1.5],[X+.5,Z+.5]]){
        const sx=corner[0]<cx?-1:1,sz=corner[1]<cz?-1:1;
        for(let k=0;k<7;k++){
          const dx=Math.floor(k/2)*.5*sx,dz=Math.max(0,3-k)*.5*sz;
          const baseY=k*.5,thick=k<3?1.5:1;
          outside(rect([corner[0]+dx,baseY,corner[1]+dz],[corner[0]+dx+thick,baseY+1,corner[1]+dz+thick]),material(style==='grove'?'log':'mana_log'));
        }
        // Flat spreading roots visibly grip the ground at the base.
        for(let k=0;k<5;k++){
          const xx=corner[0]+k*.5*sx,zz=corner[1]+Math.floor(k/2)*.5*sz;
          outside(rect([xx,0,zz],[xx+1.5,.5+(k<2?.5:0),zz+1]),wallDark);
        }
      }
      // Irregular broad moss cushions, not isolated identical green roof tiles.
      for(let zz=z+.5;zz<Z-1;zz+=3)for(let xx=x+.5;xx<X-1;xx+=3){
        if(random()>.66)continue;
        const dd=Math.min(3,Z-zz),ww=Math.min(random()>.5?3.5:2,X-xx);
        const height=Y+Math.floor(Math.min(zz-z,Z-zz-dd)/4)*.5+.5;
        emit(a,rp,rect([xx,height,zz],[xx+ww,height+.5,zz+dd]),greens[Math.floor(random()*greens.length)]);
        if(random()>.65)emit(a,rp,rect([xx+.5,height+.5,zz+.5],[xx+Math.max(1,ww-.5),height+1,zz+Math.max(1,dd-.5)]),greens[0]);
      }
      // Vines drape from the eaves on two exposed elevations, clipped away from doorways.
      for(let xx=x+1;xx<X-1;xx+=4)for(let k=0;k<4;k++){
        const shift=k%2*.5;outside(rect([xx+shift,Y-1-k*.5,Z+1],[xx+shift+.5,Y-.5-k*.5,Z+1.5]),greens[k%greens.length]);
      }
    }
    if((style==='grove'||style==='mana_grove')&&r.id==='production'){
      // An open ribbed greenhouse is a distinct silhouette from the sleeping wings.
      cutPart(rp,[rect([x+2,Y,z+2],[X-2,Y+8,Z-2])]);
      for(let xx=x+2;xx<X-1;xx+=3){
        emit(a,rp,rect([xx,Y,z+2],[xx+.5,Y+2,z+2.5]),trim);
        emit(a,rp,rect([xx,Y,Z-2.5],[xx+.5,Y+2,Z-2]),trim);
        emit(a,rp,rect([xx,Y+2,z+2],[xx+.5,Y+2.5,Z-2]),trim);
      }
      for(const zz of[z+2,Z-2.5])emit(a,rp,rect([x+2,Y+2,zz],[X-2,Y+2.5,zz+.5]),trim);
    }
    if(style==='grove'&&r.id==='arena'){
      const holes=[rect([x+4,Y,z+4],[X-4,Y+12,Z-5]),rect([x+2,Y,z+8],[X-9,Y+12,Z-2])];
      cutPart(rp,holes);
      for(let xx=x+3;xx<X-2;xx+=4){
        emit(a,rp,rect([xx,Y,z+2],[xx+.5,Y+.5,z+6+(Math.round(xx)%3)]),wallDark);
        emit(a,rp,rect([xx,Y,Z-6],[xx+.5,Y+.5,Z-2]),wallDark);
      }
      windowCuts.push(rect([x-1.5,Y-4,z+5],[x+1.5,Y+.5,z+11]));
      for(let k=0;k<6;k++)outside(rect([x-2-k*.5,0,z+6+k],[x-.5-k*.5,.5+(k%2)*.5,z+7+k]),walls);
    }
    if(style==='ridge'){
      // Raised loading headframe and repeating roof braces, all above the room ceiling.
      if(['arena','workshop'].includes(r.id)){
        for(const xx of[cx-3,cx+2])emit(a,rp,rect([xx,Y,cz-1],[xx+1,Y+3,cz+1]),material('iron_scrap_block'));
        emit(a,rp,rect([cx-4,Y+3,cz-1.5],[cx+4,Y+3.5,cz+1.5]),material('iron_scrap_block'));
        for(let k=0;k<4;k++)emit(a,rp,rect([cx-2+k,Y+.5+k*.5,cz-.5],[cx-1+k,Y+1+k*.5,cz+.5]),wallDark);
      }
      for(let xx=x+2;xx<X-1;xx+=4)for(let k=0;k<2;k++)emit(a,rp,rect([xx,Y+.5,z+1+k*2],[xx+1.5,Y+1,z+2+k*2]),random()>.5?wallDark:wallLight);
    }else if(style==='marsh'){
      // A ribbed square-section service duct and open drain crown identify waterworks.
      for(let zz=z+2;zz<Z-1;zz+=2)emit(a,rp,rect([cx-1,Y+.5,zz],[cx+1,Y+1.5,zz+.5]),wallDark);
      for(let k=0;k<4;k++)for(const xx of[x-2,X+1])outside(rect([xx,.5+k,cz-1],[xx+.5,1+k,cz+1]),trim);
      if(r.id==='arena')for(const xx of[cx-5,cx+3]){
        for(const f of shellFaces(rect([xx,Y,cz-2],[xx+2,Y+3,cz+2]),.5))emit(a,rp,f,walls);
      }
    }else if(style==='thermal'){
      for(let xx=x+3;xx<X-2;xx+=5){
        for(let k=0;k<3;k++)emit(a,rp,rect([xx,Y+.5+k*.5,z+3+k],[xx+2,Y+1+k*.5,z+4+k]),material('iron_scrap_block'));
      }
      if(r.id==='arena')for(const f of shellFaces(rect([cx-2,Y,cz-2],[cx+2,Y+4,cz+2]),1))emit(a,rp,f,material('basalt'));
    }else if(style==='coast'){
      if(['arena','workshop'].includes(r.id)){
        emit(a,rp,rect([cx-1,Y,cz-1],[cx+1,Y+2,cz+1]),walls);
        for(let k=0;k<6;k++)emit(a,rp,rect([cx-3+k,Y+2+Math.floor(k/2)*.5,cz-1],[cx-2+k,Y+3.5+Math.floor(k/2)*.5,cz+1]),k===5?material('glass'):walls);
        emit(a,rp,rect([cx-3.5,Y+1.5,cz-1.5],[cx-3,Y+4,cz+1.5]),wallDark);
      }
    }else if(style==='sacred'){
      // Low stepped nave roof and flying buttress profiles, never an extra usable storey.
      for(let k=0;k<4;k++)if(X-x>4+2*k&&Z-z>4+2*k)emit(a,rp,rect([x+2+k,Y+k*.5,z+2+k],[X-2-k,Y+.5+k*.5,Z-2-k]),k%2?wallLight:trim);
      for(let xx=x+2;xx<X-1;xx+=5)for(let k=0;k<4;k++)outside(rect([xx,k*1.5,z-3+k*.5],[xx+1,k*1.5+1.5,z-2+k*.5]),walls);
    }else if(style==='anomaly'){
      // Concentric octagonal sensor loops, supported by the original roof, read as a laboratory.
      const rr=Math.min(X-x,Z-z)/2-3;
      for(let k=0;k<3;k++){
        const v=rr-k*2;if(v<=2)continue;const yy=Y+1+k*.5;
        for(const zz of[cz-v,cz+v-.5])emit(a,rp,rect([cx-v+2,yy,zz],[cx+v-2,yy+.5,zz+.5]),k%2?wallLight:trim);
        for(const xx of[cx-v,cx+v-.5])emit(a,rp,rect([xx,yy,cz-v+2],[xx+.5,yy+.5,cz+v-2]),k%2?wallLight:trim);
        for(const sx of[-1,1])for(const sz of[-1,1])for(let n=0;n<2;n++){
          const xx=cx+sx*(v-2+n*.5),zz=cz+sz*(v-.5-n*.5);
          emit(a,rp,rect([xx,yy,zz],[xx+.5,yy+.5,zz+.5]),trim);
        }
      }
    }
  });
  for(const p of a.parts.filter(p=>p.role==='wall'))cutPart(p.id,windowCuts);

  // The producer rooms that require daylight receive an actual roof aperture.
  // Do this after decoration so shingles cannot silently reseal the opening.
  const producer=entry.ecology?.producers?.find(p=>p.requiresLight);
  if(producer){
    const r=entry.rooms.find(q=>q.id===producer.roomId);
    const rp=a.parts.find(p=>p.id===`roof_${r.id}`),[cx,,cz]=r.centerM;
    const shaft=rect([cx-2,r.maxM[1],cz-2],[cx+2,r.maxM[1]+12,cz+2]);
    const original=rp.boxes;rp.boxes=[];
    for(const b of original){
      const bounds=rect(b.center.map((v,i)=>v-b.size[i]/2),b.center.map((v,i)=>v+b.size[i]/2));
      for(const cut of subtract(bounds,shaft))emit(a,rp.id,cut,b.material);
    }
    anchor(a,'producer_skylight','root',[cx,r.maxM[1],cz],'Actual open roof aperture; producer daylight path');
  }

  if(entry.bossArena){
    const obs=entry.bossArena.obstacles;
    for(const ob of obs){
      // Obstacle centerM.y is its floor anchor in structure data.
      const q=ob.centerM,s=ob.sizeM;
      emit(a,propP,rect([q[0]-s[0]/2,q[1],q[2]-s[2]/2],[q[0]+s[0]/2,q[1]+s[1],q[2]+s[2]/2]),material(ob.blockId));
    }
    for(const g of entry.bossArena.gimmickSlots){
      anchor(a,g.id,'root',g.positionM,'Boss gimmick locator; behavior owned by boss data');
      // Existing cover near a gimmick remains a single physical feature.
      const p=g.positionM;
      if(!obs.some(o=>Math.abs(o.centerM[0]-p[0])<2&&Math.abs(o.centerM[2]-p[2])<2))
        emit(a,propP,rect([p[0]-.5,p[1],p[2]-.5],[p[0]+.5,p[1]+1,p[2]+.5]),trim);
    }
    anchor(a,'boss_spawn','root',entry.bossArena.bossSpawnM,'Boss local origin transformed to building coordinates');
  }
  for(const r of entry.rewardAnchors||[]){
    anchor(a,`reward_${r.id}`,'root',r.positionM,`${r.channel} reward; persistent claim ledger required`);
    // A chest is a locator visual, not a generated inventory or a functional component.
    const p=r.positionM;if(r.channel==='boss')continue;
    emit(a,propP,rect([p[0]-.5,p[1],p[2]-.5],[p[0]+.5,p[1]+1,p[2]+.5]),trim);
  }
  for(const c of entry.puzzle?.componentAnchors||[]){
    anchor(a,c.id,'root',c.positionM,`${c.componentId} assembly anchor; actual component behavior not included`);
    const p=c.positionM;
    emit(a,propP,rect([p[0]-.5,p[1],p[2]-.5],[p[0]+.5,p[1]+1,p[2]+.5]),walls);
    emit(a,propP,rect([p[0]-.5,p[1]+1,p[2]-.5],[p[0]+.5,p[1]+1.5,p[2]+.5]),trim);
  }
  for(const s of entry.serviceAnchors||[])anchor(a,s.id,'root',s.positionM,'Community service locator; no resident or stock spawned');
  a.notes.push('Single-floor art prototype. Room clear sizes and doorway/corridor widths come directly from structures.json. Roof and roof decorations have role=roof for inspection cutaway.',
    'Closed room walls are carved against open corridor and entrance volumes. Exterior detail is clipped against rooms, passages and bypass. Visual GLB is not runtime collision or navigation validation.',
    'Facade trim, stepped roof shapes and rooftop instruments are cosmetic; no extra story, usable technology, energy supply or generated loot is implied.',
    'Water is a visual layer below walking level; its simulation, ecosystem stock, damage and persistent inventory remain gameplay work.',
    'Gimmick, component, reward and room anchors preserve source data locations. Runtime requires source-of-truth content and actual component assembly.');
  return a;
}

export function generate(content){return content.structures.entries.map(e=>make(e,content));}
