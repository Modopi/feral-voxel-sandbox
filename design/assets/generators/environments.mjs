import { asset, mat, part, paint as box, anchor, rng } from './shared.mjs';

// Static editorial dioramas only: this is not the game's world generator.
const COLOURS = {
  grass:'#718C46', dirt:'#73513C', stone:'#8C9292', sand:'#D7BC82', log:'#75503A',
  leaves:'#386047', basalt:'#46434B', ash:'#514C4A', plank:'#AD8358', moss:'#819D54',
  dry_grass:'#B69A60', clay:'#8F755A', reed:'#7C9852', algae:'#527D61',
  ash_lichen:'#B3AA71', salt_grass:'#8D9D75', mana_fern:'#679EAD', mana_log:'#696080',
  luminous_moss:'#C6CFA0', mineral_lichen:'#A7A3B9', iron_ore:'#9E6A48',
  titanium_ore:'#A4ABB6', nickel_ore:'#8E9976', sulfur_deposit:'#B6B44E',
  mana_crystal_ore:'#95B7D2', rubble:'#8F8579', clay_brick:'#AD7355',
  iron_scrap_block:'#747579', glass:'#A8CBD0', sacred_stone:'#D4CFB9',
  anomaly_stone:'#77717F', berry_bush:'#4F7149', herb_patch:'#7DA375',
};
const STYLE = {
  grove:{host:'grove',pad:2,top:'grass',soil:'dirt',rock:'stone',water:'#568E96',trees:64,plant:'moss'},
  ridge:{host:'ridge',pad:4,top:'dry_grass',soil:'dirt',rock:'stone',water:'#658B94',trees:8,plant:'dry_grass'},
  marsh:{host:'marsh',pad:2,top:'clay',soil:'clay',rock:'stone',water:'#547A6D',trees:10,plant:'reed'},
  thermal:{host:'thermal',pad:4,top:'ash',soil:'basalt',rock:'basalt',water:'#6F9298',trees:0,plant:'ash_lichen'},
  coast:{host:'coast',pad:12,top:'salt_grass',soil:'sand',rock:'stone',water:'#537F99',trees:8,plant:'salt_grass'},
  mana_grove:{host:'mana_grove',pad:2,top:'grass',soil:'dirt',rock:'stone',water:'#698D9D',trees:64,plant:'mana_fern'},
  sacred:{host:'grove',pad:2,top:'grass',soil:'dirt',rock:'stone',water:'#638F91',trees:38,plant:'luminous_moss'},
  anomaly:{host:'ridge',pad:4,top:'dry_grass',soil:'dirt',rock:'stone',water:'#68848C',trees:6,plant:'mineral_lichen'},
};
const W=224, D=192, CELL=4, BOTTOM=-16;
const snap = (v,g=.5)=>Math.round(v/g)*g;

export function generate(content) {
  const blockIds = new Set(content.blocks.entries.map(e=>e.id));
  const speciesIds = new Set(content.creatures.entries.map(e=>e.id));
  const structureMap = new Map(content.structures.entries.map(e=>[e.id,e]));
  const assetIds = new Set([...speciesIds,...content.bosses.entries.map(e=>e.id),...structureMap.keys()]);
  return content.environments.entries.map(entry=>{
    if(assetIds.has(entry.id)) throw new Error(`Environment asset ID collides: ${entry.id}`);
    const style=STYLE[entry.id];
    if(!style)throw new Error(`Missing environment visual style: ${entry.id}`);
    const structure=structureMap.get(entry.building.dungeonId);
    if(!structure)throw new Error(`Missing structure: ${entry.building.dungeonId}`);
    const a=asset(entry,'environment',.5);
    const random=rng(`feral-environment-diorama-v1:${entry.id}`);
    const phase=random()*Math.PI*2;
    for(const [id,color] of Object.entries(COLOURS)) {
      if(blockIds.has(id))mat(a,id,color,{blockId:id,roughness:id==='glass'?.25:.9,metallic:id==='iron_scrap_block'?.45:0});
    }
    mat(a,'water',style.water,{roughness:.24,opacity:.86});
    mat(a,'acid_water','#A7B35A',{roughness:.3,opacity:.92});
    mat(a,'hot_rock','#C76A3D',{roughness:.75,emission:.35,blockId:'basalt'});
    mat(a,'pale_leaf','#B0BCA1',{blockId:'leaves'});
    mat(a,'blue_leaf','#648B9C',{blockId:'leaves'});
    const terrain=part(a,'terrain',[0,0,0],'root','exposed_strata');
    part(a,'surface',[0,0,0],'root','environment_surface');
    part(a,'watercourses',[0,0,0],'root','static_fluid_visual');
    part(a,'vegetation',[0,0,0],'root','plant_clusters');
    part(a,'outcrops',[0,0,0],'root','resource_outcrops');
    part(a,'overlay',[0,0,0],'root','environment_overlay');
    const f=structure.footprintM;
    const tx=snap(-(f.min[0]+f.max[0])/2), tz=snap(12-(f.min[1]+f.max[1])/2);
    const footprint={minX:f.min[0]+tx,maxX:f.max[0]+tx,minZ:f.min[1]+tz,maxZ:f.max[1]+tz};
    const inFootprint=(x,z,m=0)=>x>=footprint.minX-m&&x<=footprint.maxX+m&&z>=footprint.minZ-m&&z<=footprint.maxZ+m;
    const front=structure.entrances.find(e=>e.id==='front');
    const frontRoom=structure.rooms.find(r=>r.id===front?.roomId);
    if(!front||!frontRoom)throw new Error(`Missing front entrance room: ${structure.id}`);
    const entrance=[tx+front.positionM[0],style.pad+front.positionM[1],tz+front.positionM[2]];
    // Infer the exterior normal from the actual room boundary, never asset centre.
    const sides=[0,2].flatMap(axis=>[
      {axis,direction:-1,distance:Math.abs(front.positionM[axis]-frontRoom.minM[axis])},
      {axis,direction:1,distance:Math.abs(front.positionM[axis]-frontRoom.maxM[axis])},
    ]).sort((a,b)=>a.distance-b.distance||a.axis-b.axis||a.direction-b.direction);
    const facing=sides[0];
    if(facing.distance>.5)throw new Error(`Front entrance is not on room boundary: ${structure.id}`);
    const approachHalfWidth=Math.max(entry.building.entranceApproachWidthM,front.clearSizeM[0])/2;
    const onApproach=(x,z,m=0)=>{
      const v=[x,0,z],along=(v[facing.axis]-entrance[facing.axis])*facing.direction;
      const across=Math.abs(v[facing.axis===0?2:0]-entrance[facing.axis===0?2:0]);
      return along>=-m&&across<=approachHalfWidth+m;
    };
    const clear=(x,z,m=0)=>inFootprint(x,z,8+m)||onApproach(x,z,m);
    const creek=(z)=>-84+Math.sin(z*.037+phase)*8;
    const reservoir=structure.ecology?.water;
    const height=(x,z)=>{
      // Read the same basin bounds as the structure; reserve its full depth.
      const lx=x-tx,lz=z-tz;
      if(reservoir){
        const c=reservoir.basinCenterM,s=reservoir.basinSizeM;
        if(lx+CELL/2>c[0]-s[0]/2&&lx-CELL/2<c[0]+s[0]/2&&lz+CELL/2>c[2]-s[2]/2&&lz-CELL/2<c[2]+s[2]/2)return style.pad+c[1]-s[1]/2;
      }
      if(inFootprint(x,z))return style.pad-.5;
      if(clear(x,z,2))return style.pad;
      const s=Math.sin(x*.061+phase), t=Math.cos(z*.054-phase*.4);
      let h;
      switch(style.host){
        case 'grove': h=2+2*s+1.5*t;break;
        case 'ridge': h=4+4*Math.abs(Math.sin(x*.064+z*.018+phase))+2*t;break;
        case 'marsh': h=s+t>.65?1: -2;break;
        case 'thermal': h=2+4*Math.floor((Math.sin(x*.045+phase)+Math.cos(z*.048)+2)*.65);break;
        case 'coast': h=x< -78?-6:x< -58?-2:x< -42?4:10+2*Math.floor((s+t+2)*.5);break;
        case 'mana_grove': h=2+2*s+2*t;break;
        default: h=style.pad;
      }
      if(style.host!=='coast'&&style.host!=='marsh'&&Math.abs(x-creek(z))<5)h=-2;
      return snap(h,1);
    };
    for(let iz=0;iz<D/CELL;iz++){
      const z=-D/2+CELL/2+iz*CELL;
      const row=[];
      for(let ix=0;ix<W/CELL;ix++){
        const x=-W/2+CELL/2+ix*CELL,h=height(x,z);
        let top=style.top;
        if(clear(x,z,2))top=style.host==='thermal'?'basalt':style.top;
        else if(style.host==='coast'&&x< -42)top='sand';
        else if(style.host==='ridge'&&h>=8)top='stone';
        else if(style.host==='thermal'&&h>=8)top='basalt';
        const watery=!clear(x,z,2)&&(style.host==='marsh'?h<0:style.host==='coast'?x< -58:Math.abs(x-creek(z))<5);
        row.push({x,z,h,top,watery});
      }
      // Merge equal neighbouring four-metre terrain cells into strata runs.
      for(let i=0;i<row.length;){
        let j=i+1;
        while(j<row.length&&row[j].h===row[i].h&&row[j].top===row[i].top&&row[j].watery===row[i].watery)j++;
        const r=row[i],width=(j-i)*CELL,x=(r.x+row[j-1].x)/2;
        const rockTop=r.h-2;
        box(a,terrain.id,[x,(BOTTOM+rockTop)/2,z],[width,rockTop-BOTTOM,CELL],style.rock);
        box(a,terrain.id,[x,r.h-1.25,z],[width,1.5,CELL],style.soil);
        box(a,'surface',[x,r.h-.25,z],[width,.5,CELL],r.top);
        if(r.watery){
          const waterTop=style.host==='coast'?-1:0;
          if(waterTop>r.h)box(a,'watercourses',[x,(waterTop+r.h)/2,z],[width,waterTop-r.h,CELL],'water');
        }
        i=j;
      }
    }
    const groundAt=(x,z)=>height(Math.floor((x+W/2)/CELL)*CELL-W/2+CELL/2,Math.floor((z+D/2)/CELL)*CELL-D/2+CELL/2);
    const scatter=(count,margin,fn)=>{
      let placed=0;
      for(let attempts=0;placed<count&&attempts<count*24;attempts++){
        const x=snap((random()-.5)*(W-12)),z=snap((random()-.5)*(D-12));
        if(clear(x,z,margin))continue;
        const h=groundAt(x,z);
        if(h<0)continue;
        fn(x,h,z,placed++);
      }
    };
    scatter(style.trees,4,(x,h,z,i)=>{
      const tall=style.host==='mana_grove'?6+Math.floor(random()*5):4+Math.floor(random()*5);
      const trunk=style.host==='mana_grove'?'mana_log':'log';
      const leaf=entry.id==='mana_grove'?'blue_leaf':entry.id==='sacred'&&i%3===0?'pale_leaf':'leaves';
      box(a,'vegetation',[x,h+tall/2,z],[1,tall,1],trunk);
      box(a,'vegetation',[x,h+tall-.5,z],[4,2,4],leaf);
      box(a,'vegetation',[x-.5,h+tall+1,z],[3,1,3],leaf);
      box(a,'vegetation',[x+1.5,h+tall-1,z-.5],[2,1.5,2],leaf);
      if(i%4===0)box(a,'vegetation',[x+.5,h+.25,z+1],[2,.5,1],style.plant);
    });
    scatter(style.host==='marsh'?90:64,2,(x,h,z,i)=>{
      if(style.host==='marsh'){
        for(let j=0;j<3;j++)box(a,'vegetation',[x+j*.5,h+.75+(j%2)*.25,z],[.5,1.5+(j%2)*.5,.5],'reed');
      }else{
        box(a,'vegetation',[x,h+.25,z],[1+Math.floor(random()*3),.5,1+Math.floor(random()*2)],style.plant);
        if(style.host==='mana_grove'&&i%3===0)box(a,'vegetation',[x,h+.75,z],[.5,1,.5],'mana_fern');
      }
    });
    const ores=entry.oreVeins.length?entry.oreVeins:[{blockId:entry.id==='sacred'?'sacred_stone':'anomaly_stone'}];
    scatter(14,3,(x,h,z,i)=>{
      const ore=ores[i%ores.length].blockId;
      box(a,'outcrops',[x,h+1,z],[3,2,2],style.rock);
      box(a,'outcrops',[x+.5,h+2.25,z],[2, .5,1.5],ore);
      box(a,'outcrops',[x-1.75,h+.75,z],[.5,1.5,1],ore);
    });
    if(style.host==='marsh')scatter(5,5,(x,h,z)=>{
      box(a,'watercourses',[x,h+.25,z],[3,.5,3],'acid_water');
      box(a,'vegetation',[x+2,h+.5,z],[1,1,3],'reed');
    });
    if(style.host==='thermal')scatter(8,6,(x,h,z)=>{
      box(a,'outcrops',[x,h+.5,z],[4,1,4],'basalt');
      box(a,'outcrops',[x,h+1.25,z],[2,.5,2],'hot_rock');
      box(a,'outcrops',[x-2,h+1.5,z],[1,3,2],'basalt');
    });
    if(entry.id==='sacred')scatter(14,3,(x,h,z,i)=>{
      box(a,'overlay',[x,h+.25,z],[3,.5,2],'luminous_moss');
      if(i%3===0){box(a,'overlay',[x,h+1.5,z],[1,3,1],'sacred_stone');box(a,'overlay',[x,h+3.25,z],[2,.5,2],'sacred_stone');}
    });
    if(entry.id==='anomaly')scatter(16,3,(x,h,z,i)=>{
      box(a,'overlay',[x,h+.5,z],[4,1,2],'anomaly_stone');
      box(a,'overlay',[x+1,h+1.5,z-.5],[1,2,1],'anomaly_stone');
      box(a,'overlay',[x-1.5,h+.25,z],[1,.5,3],'mineral_lichen');
      if(i%4===0)box(a,'overlay',[x,h+.75,z+1.25],[2,.5,.5],'mana_crystal_ore');
    });
    // The original structure is reused unscaled, never reauthored as scenery.
    a.instances.push({id:`${entry.id}_dungeon`,assetId:structure.id,translation:[tx,style.pad,tz]});
    const occupied=[];
    for(const [i,rule] of entry.spawning.rules.entries()){
      if(!speciesIds.has(rule.speciesId))throw new Error(`Missing species ${rule.speciesId}`);
      let chosen=null;
      for(let attempt=0;attempt<100;attempt++){
        const x=snap(-88+random()*176),z=snap(-82+random()*20),h=groundAt(x,z);
        if(clear(x,z,4)||h<0||occupied.some(p=>Math.hypot(x-p[0],z-p[1])<6))continue;
        chosen=[x,h,z];occupied.push([x,z]);break;
      }
      if(chosen)a.instances.push({id:`${entry.id}_fauna_${i}`,assetId:rule.speciesId,translation:chosen});
    }
    anchor(a,'dungeon_entrance','root',entrance,'Actual front entrance position transformed by the original structure instance');
    anchor(a,'review_camera_target','root',[0,style.pad+3,8],'Panorama composition centre, not a spawn point');
    const forecourt=[...entrance];
    const sceneHalfExtent=facing.axis===0?W/2:D/2;
    forecourt[facing.axis]=facing.direction*(sceneHalfExtent-8);
    anchor(a,'forecourt','root',forecourt,'Exterior approach aligned with the actual front room wall normal; not navigation verification');
    a.notes.push(
      'Static 224m × 192m editorial diorama at original metre scale, 0.5m visual grid. Terrain surface sampled in 4m cells and merged into cuboid runs.',
      'This art prototype is not the procedural world generator and does not implement climate, ecology, spawning, navigation, energy, or gameplay collision.',
      'Structure instance uses its source footprint and original coordinates; expanded footprint is reserved flat and free of trees, outcrops and water. Ground under its floor is -0.5m; reservoir excavation reads the original ecology.water basin bounds and depth. Entrance anchor and approach direction read entrances.front and the linked room boundary.',
      'Creature instances are unscaled reference placements, not a spawn simulation. Building/model geometry remains owned by the referenced original asset.',
      'Water transparency, hot-rock colour and pale foliage are visual materials only; emission values are not stored gameplay energy.',
      `Fixed visual seed: feral-environment-diorama-v1:${entry.id}. Host palette: ${style.host}. Height offset is presentation-only and not world sea-level generation.`
    );
    if(entry.mode==='overlay')a.notes.push(`${entry.id} is an overlay on the ${style.host} host environment. Host strata, vegetation and water remain visible; this is not a seventh/eighth independent base biome.`);
    return a;
  });
}
