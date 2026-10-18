// Three-compatible but renderer-independent: nodes need position/rotation.set,
// visible, and userData. The renderer and physics use these same part transforms.
// No render frame changes gameplay HP, calories, timers or ownership.
const PROFILE = {
  moss_deer:'quadruped',copper_fox:'quadruped',azure_beetle:'arthropod',root_stalker:'quadruped',
  scree_hare:'quadruped',flint_jackal:'quadruped',ore_mite:'arthropod',shaft_weasel:'quadruped',
  reed_grazer:'quadruped',mud_croc:'quadruped',silt_snail:'crawler',drain_eel:'serpent',
  ash_goat:'quadruped',ember_lizard:'quadruped',vent_grub:'crawler',furnace_mantis:'arthropod',
  cliff_ibex:'quadruped',gale_raptor:'winged',tide_crab:'arthropod',cistern_serpent:'serpent',
  prism_deer:'quadruped',veil_cat:'quadruped',mana_moth:'winged',root_weaver:'arachnid',
  candle_hare:'quadruped',relic_hound:'quadruped',shrine_beetle:'arthropod',oath_sentinel:'biped',
  drift_grazer:'quadruped',phase_stalker:'quadruped',anchor_tick:'arthropod',survey_drone:'hover',
  wayfarer_organic:'biped',custodian_inorganic:'biped',
};
import {subtractBox,disjointBoxes} from './voxel/solid.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const limb=(index)=>`limb_${index}`;
const profileOf=e=>e.bodyProfile??PROFILE[e.speciesId??e.assetId]??'quadruped';

/** One canonical visual->body map, also used for hit forwarding and colliders. */
export function creatureBodyPart(entity, visualPartId) {
  const id=String(visualPartId),profile=profileOf(entity);
  if(id==='root')return null;
  if(/^limb_\d+$/.test(id)||['core','head','spine','shell','weapon'].includes(id))return id;
  const quad=['left_foreleg','right_foreleg','left_hindleg','right_hindleg'];
  if(quad.includes(id))return limb(quad.indexOf(id));
  if(/^wing_(-?\d+)$/.test(id))return limb(id.endsWith('_-1')?0:1);
  if(/^thruster_\d+$/.test(id))return limb(Number(id.split('_').at(-1)));
  const sideLeg=/^(?:walking_leg|leg)_(-?\d+)(?:_(\d+))?$/.exec(id);
  if(sideLeg){const side=Number(sideLeg[1])<0?0:1;return limb(sideLeg[2]===undefined?side:Number(sideLeg[2])*2+side);}
  if(/^segment_\d+$/.test(id))return profile==='serpent'?limb(Math.min(3,Math.floor(Number(id.split('_').at(-1))/3))):'core';
  if(/raptorial_arm|^claw_|spinneret|heat_pouch|guard_staff|^arm_/.test(id))return 'weapon';
  if(/carapace|shell|scute|crest|backpack|service_pack|chest_panel/.test(id))return 'shell';
  if(/head|face|sensor|mouth|eye_stalk|antenna|horn|antler|beard|hood/.test(id))return 'head';
  if(/^foot$/.test(id)&&profile==='crawler')return 'limb_0';
  if(/^talon_/.test(id))return 'core'; // wings, not talons, own flight support.
  if(/tail|neck|reed_back|mane|mantle|ridge|thorax|torso|abdomen|hull|pelvis|belt|scarf|tabard|satchel/.test(id))return 'core';
  if(/folded_wings/.test(id))return 'shell';
  if(/root_shoulder/.test(id))return 'core';
  return null;
}

// Frontier layered body on design models: shell wounds are grid cubes cut out of a part's boxes, and bone
// bars inside each logical part (skull, spine with shoulder and pelvis bars, limb bones) show through them.
export const WOUND_GRID=1/32;
export const BONE_MATERIAL=Object.freeze({id:'bone_core',color:'#e7dcc2',opacity:1,roughness:.8,metallic:0,emission:0,collision:false});
const INSET=.002;
export function creatureBones(part,logical){
  if(!part?.boxes?.length||!logical||logical==='shell')return [];
  const lo=[0,1,2].map(i=>Math.min(...part.boxes.map(b=>b.center[i]-b.size[i]/2))),hi=[0,1,2].map(i=>Math.max(...part.boxes.map(b=>b.center[i]+b.size[i]/2)));
  const size=hi.map((v,i)=>v-lo[i]),center=lo.map((v,i)=>(v+hi[i])/2),snap=v=>Math.max(WOUND_GRID,Math.round(v/WOUND_GRID)*WOUND_GRID);
  // Thin or sparse parts (ears, antlers, tails, wing membranes) carry no bone of their own.
  const fill=part.boxes.reduce((v,b)=>v+b.size[0]*b.size[1]*b.size[2],0)/(size[0]*size[1]*size[2]);
  if(fill<.4||Math.min(...size)<.09)return [];
  const thick=Math.min(snap(Math.min(...size)*.34),.09),bones=[];
  if(logical==='head')bones.push({center,size:size.map(v=>snap(v*.45))});
  else{
   const axis=size.indexOf(Math.max(...size)),bar=[thick,thick,thick];bar[axis]=snap(size[axis]*.84);
   const cross=axis===0?2:0,trunk=logical==='core'&&axis!==1&&size[cross]>=.16&&size[1]>=.16;
   if(!trunk)bones.push({center,size:bar});
   else{
    // A horizontal trunk: spine along the back and a closed rib cage down both flanks, close under the
    // shell, so a blow across the trunk always meets bone once the shell over it is gone.
    const top=center[1]+size[1]*.22,rib=2*WOUND_GRID,drop=snap(size[1]*.56),count=Math.max(3,Math.floor(size[axis]*.8/rib)),start=center[axis]-count*rib/2+rib/2;
    bones.push({center:[center[0],top,center[2]],size:bar});
    for(let i=0;i<count;i++)for(const side of [-1,1]){const c=[...center];c[axis]=start+i*rib;c[cross]+=side*size[cross]*.3;c[1]=top-drop/2;const s=[rib,rib,rib];s[1]=drop;bones.push({center:c,size:s});}
   }
  }
  // Bones stay inside the shell's own solid; a small inset keeps their faces off its grid planes.
  const pieces=[];
  for(const bone of disjointBoxes(bones.map(b=>({...b,material:BONE_MATERIAL.id}))))for(const shell of part.boxes){
   const l=[0,1,2].map(i=>Math.max(bone.center[i]-bone.size[i]/2,shell.center[i]-shell.size[i]/2)+INSET),h=[0,1,2].map(i=>Math.min(bone.center[i]+bone.size[i]/2,shell.center[i]+shell.size[i]/2)-INSET);
   if(h.every((v,i)=>v-l[i]>WOUND_GRID/4))pieces.push({center:l.map((v,i)=>(v+h[i])/2),size:l.map((v,i)=>h[i]-v),material:BONE_MATERIAL.id});
  }
  return pieces;
}
/** Shell boxes left after the wounds ([x,y,z,sx,sy,sz] cuts, part-local metres; older saves hold cubes [x,y,z,s]). */
export function woundedBoxes(boxes,wounds=[]){
  let out=boxes;
  for(const w of wounds){const cutter={center:w.slice(0,3),size:w.length===4?[w[3],w[3],w[3]]:w.slice(3,6)};out=out.flatMap(b=>subtractBox(b,cutter));}
  return out;
}
/** One hit's cut, like the frontier's bite of shell voxels: wide across the struck face, shallow along
 * the swing. Bigger hits bite wider and deeper; piercing is narrow and deep, impact wide. */
export function woundCut(amount,mode='strike'){
  const even=v=>Math.max(2*WOUND_GRID,Math.round(v/(2*WOUND_GRID))*2*WOUND_GRID);
  const width=clamp(.125+amount*.006,.125,.3125)*(mode==='pierce'?.5:mode==='impact'?1.3:1),depth=clamp(.0625+amount*.002,.0625,.125)*(mode==='pierce'?2:1);
  return {width:even(width),depth:even(depth)};
}
/** The cut box for a hit at a part-local point along a part-local swing direction. */
export function woundBox(local,direction,cut){
  const axis=[0,1,2].reduce((a,i)=>Math.abs(direction[i])>Math.abs(direction[a])?i:a,0),sign=Math.sign(direction[axis])||1;
  const center=[...local],size=[cut.width,cut.width,cut.width];center[axis]+=sign*cut.depth/2;size[axis]=cut.depth;
  return [...center.map(v=>Math.round(v/WOUND_GRID)*WOUND_GRID),...size];
}

function damageHidden(entity,id,mapping){
  if(entity.fragmentMass?.parts?.[id]?.objectId)return true;
  const missing=new Set(entity.pose?.missingParts??entity.missingParts??[]);
  if(missing.has(id)||mapping&&missing.has(mapping))return true;
  return Boolean(mapping&&entity.parts?.[mapping]?.detached); // Internal core/spine HP0 never erases the outer body.
}

/** Metadata and exact local cuboids for the existing part-compound collision
 * adapter. It must apply each node.matrixWorld; never union these into a hull. */
export function creatureCollisionParts(record,entity){
  const materials=new Map(record.asset.materials.map(m=>[m.id,m]));
  return record.asset.parts.flatMap(p=>{
    const node=record.parts.get(p.id),logicalPartId=creatureBodyPart(entity,p.id);
    if(!node||node.visible===false||damageHidden(entity,p.id,logicalPartId))return [];
    let ancestor=p.parent;
    while(ancestor!==null){const parent=record.parts.get(ancestor);if(parent?.visible===false)return [];ancestor=parent?.userData?.part?.parent??null;}
    const boxes=p.boxes.filter(b=>b.collision!==false&&materials.get(b.material)?.collision!==false);
    return boxes.length?[{ownerId:entity.id,partId:p.id,logicalPartId,node,boxes,selfCollision:false,externalCollision:true}]:[];
  });
}

export function animateCreatureModel(record,entity,time=0,dt=0){
  if(!record?.parts||!entity)return;
  const profile=profileOf(entity),species=entity.speciesId??entity.assetId;
  const bodySize=entity.bodySize??[1,1,1],H=bodySize[2],W=bodySize[1];
  const pose=entity.pose??{},state=entity.state??pose.state??'idle';
  const dead=Boolean(entity.dead||state==='dead'),rest=entity.rest||state==='rest';
  const moving=Boolean(pose.moving??entity.moving)&&!dead&&!rest;
  const phase=Number.isFinite(pose.phase)?pose.phase:time*6;
  const flying=['winged','hover'].includes(profile)&&(pose.limbSupport??[true,true]).every(Boolean)&&!dead;
  const work=entity.civilization&&!dead&&['repair','work','trade'].includes(state);
  const windup=state==='windup'||entity.attack&&!entity.attack.hitDone;
  const recovering=state==='recover'||entity.attack?.hitDone;
  const targetBlend=dead?1:0;
  const anim=record.creatureAnimation??={deathBlend:targetBlend};
  anim.deathBlend+=clamp(targetBlend-anim.deathBlend,-Math.max(0,dt)*4,Math.max(0,dt)*4);
  const death=anim.deathBlend;
  for(const[id,node]of record.parts){
    const source=node.userData.part??record.asset.parts.find(p=>p.id===id),base=source?.translation??[0,0,0];
    node.position.set(...base);node.rotation.set(0,0,0);
    const bodyPart=creatureBodyPart(entity,id);
    node.userData.creatureOwnerId=entity.id;
    node.userData.logicalPartId=bodyPart;
    // Physics consumes this node's actual local cuboids and current world matrix.
    node.userData.collisionOwnerId=entity.id;
    node.visible=!damageHidden(entity,id,bodyPart);
    if(id==='root'){
      node.visible=true;
      node.rotation.z=death*Math.PI*.48;
      node.position.y+=death*W*.5;
      if(!dead&&rest){node.position.y-=H*(profile==='biped'?.12:.07);node.rotation.x=profile==='biped'?.18:.03;}
      if(!dead&&moving&&profile==='quadruped'){node.position.y+=Math.abs(Math.sin(phase*2))*H*.018;node.rotation.z=Math.sin(phase)*.025*(1-(pose.speedFactor??1));}
      if(!dead&&profile==='hover'){node.position.y+=Math.sin(time*2.2)*H*.025;node.rotation.x=moving?.07:0;}
      continue;
    }
    if(!node.visible)continue;
    const supplied=pose.parts?.[id];
    if(supplied?.rotation)node.rotation.set(...supplied.rotation);
    if(supplied?.hidden){node.visible=false;continue;}
    const gait=phase*(entity.entityType==='inorganic'?.8:1),amplitude=moving?.42:0;
    if(profile==='quadruped'){
      const index=['left_foreleg','right_foreleg','left_hindleg','right_hindleg'].indexOf(id);
      if(index>=0){const offset=[0,Math.PI,Math.PI,0][index];node.rotation.x=Math.sin(gait+offset)*amplitude;
        if(species==='scree_hare'||species==='candle_hare')node.rotation.x=Math.sin(gait+(index<2?0:Math.PI))*(index<2?.3:.6)*(moving?1:0);
        if(rest)node.rotation.x=index<2?-.65:.7;
      }
      if(id==='head'){node.rotation.x+=rest?.22:state==='forage'?.32:Math.sin(time*1.5)*.025;node.rotation.y=Math.sin(time*.7)*.035;}
      if(id==='tail'){node.rotation.y=Math.sin(time*2+gait*.3)*.16;node.rotation.x=rest?.2:0;}
      if(/ear/.test(id))node.rotation.z=Math.sin(time*2.4)*.05*(id.endsWith('_l')?-1:1);
    }else if(['arthropod','arachnid'].includes(profile)){
      const leg=/^(?:walking_leg|leg)_(-?\d+)_(\d+)$/.exec(id);
      if(leg){const side=Number(leg[1]),row=Number(leg[2]);node.rotation.y=Math.sin(gait+(row%2)*Math.PI+(side<0?0:Math.PI))*.25*(moving?1:0);node.rotation.z=Math.max(0,Math.sin(gait+row))*side*.16*(moving?1:0);if(rest)node.rotation.z=side*.22;}
      if(/^raptorial_arm/.test(id))node.rotation.x=windup?-.8:recovering?.5:-.1;
      if(/^claw_/.test(id))node.rotation.y=(id.endsWith('_-1')?-1:1)*(windup?.35:.12);
      if(/^antenna/.test(id))node.rotation.x=Math.sin(time*3)*.1;
    }else if(profile==='winged'){
      const match=/^wing_(-?\d+)$/.exec(id);
      if(match){const side=Number(match[1]);node.rotation.z=flying?Math.sin(time*(species==='mana_moth'?15:6))*side*(species==='mana_moth'?.65:.38):side*.55;node.rotation.x=windup?-.35:0;}
      if(/^talon_/.test(id))node.rotation.x=windup?-.6:flying?.35:0;
      if(id==='head')node.rotation.x=windup?.32:0;
      if(id==='tail')node.rotation.x=Math.sin(time*2)*.08;
    }else if(profile==='serpent'){
      const segment=/^segment_(\d+)$/.exec(id);
      if(segment){const i=Number(segment[1]),wave=Math.sin(gait-i*.5);node.rotation.y=wave*.18*(moving?1:.15);node.position.x+=wave*W*.14*(moving?1:.15);if(rest)node.rotation.y+=(i-5.5)*.06;}
      if(id==='head')node.rotation.y=Math.sin(gait-6)*.12*(moving?1:.1);
    }else if(profile==='crawler'){
      const segment=/^segment_(\d+)$/.exec(id);
      if(segment){const i=Number(segment[1]);node.position.y+=Math.sin(gait-i*.6)*H*.035*(moving?1:.1);node.rotation.x=Math.sin(gait-i*.6)*.06*(moving?1:0);}
      if(/^eye_stalk/.test(id))node.rotation.x=Math.sin(time*1.7)*.1;
      if(id==='foot')node.rotation.y=Math.sin(gait)*.025*(moving?1:0);
    }else if(profile==='biped'){
      const leg=/^leg_(-?\d+)$/.exec(id),arm=/^arm_(-?\d+)$/.exec(id);
      if(leg){const side=Number(leg[1]);node.rotation.x=Math.sin(gait+(side<0?0:Math.PI))*amplitude;if(rest)node.rotation.x=-.9;}
      if(arm){const side=Number(arm[1]);node.rotation.x=-Math.sin(gait+(side<0?0:Math.PI))*amplitude*.65;
        if(work)node.rotation.x=-.6+Math.sin(time*4+(side<0?0:Math.PI))*.22;
        if(windup)node.rotation.x=-.9;if(recovering)node.rotation.x=.35;
      }
      if(id==='guard_staff')node.rotation.x=windup?-.35:recovering?.35:0;
      if(id==='head')node.rotation.y=work?Math.sin(time)*.12:0;
    }else if(profile==='hover'){
      if(/^thruster_/.test(id))node.rotation.x=moving?-.1:Math.sin(time*3)*.025;
      if(id==='sensor')node.rotation.y=windup?0:Math.sin(time*.8)*.2;
    }
    if(windup&&id==='head')node.rotation.x-=.18;
    if(death){node.rotation.x=clamp(node.rotation.x,-.2,.2)*(1-death);if(/leg|arm|wing/.test(id))node.rotation.x+=death*.35;}
    // Explicit visual joint limits, before the physics adapter's obstruction clamp.
    node.rotation.x=clamp(node.rotation.x,-1.1,1.1);node.rotation.y=clamp(node.rotation.y,-.8,.8);node.rotation.z=clamp(node.rotation.z,-.9,.9);
  }
  record.group.updateMatrixWorld?.(true);
  return {profile,dead,rest,flying,partCount:record.parts.size};
}
