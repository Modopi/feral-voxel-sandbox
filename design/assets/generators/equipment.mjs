import { asset, mat, part, fill, paint, anchor } from './shared.mjs';
import { VoxelAssetBuilder } from '../../../tools/asset-pipeline/authoring.mjs';
const G=0.03125;
const COLORS={wood:'#9B734B',stone:'#8E9694',scrap_iron:'#7B7267',steel:'#8DADB7',mana_steel:'#538D9B',mana_stainless_alloy:'#6F9CA1',consecrated_adamantium:'#C0AF74',arcane_crystal_alloy:'#8E8BC2',composite_mana_superalloy:'#5877A0',meister_composite:'#D3E1DC'};
const snap=v=>Math.round(v/G)*G;
function voxel(a,p,c,s,m){fill(a,p,c,s,m);}
function beam(a,p,min,max,m){voxel(a,p,min.map((v,i)=>(v+max[i])/2),min.map((v,i)=>max[i]-v),m);}
function makePart(a,id,translation=[0,0,0],parent='root',role='visual'){return part(a,id,translation,parent,role).id;}
// Circular sections are rasterized directly into disjoint voxel rows at authoring time.
function ring(a,p,c,r,thickness,inner,m,axis='y'){
  const R=Math.max(1,Math.round(r/G)),I=Math.max(0,Math.round(inner/G));
  for(let zz=-R;zz<R;zz++){
    let start=null;
    const put=(x0,x1)=>{const cc=[(x0+x1)*G/2,0,(zz+.5)*G],sz=[(x1-x0)*G,thickness,G];if(axis==='z'){[cc[1],cc[2]]=[cc[2],cc[1]];[sz[1],sz[2]]=[sz[2],sz[1]];}else if(axis==='x'){[cc[0],cc[1]]=[cc[1],cc[0]];[sz[0],sz[1]]=[sz[1],sz[0]];}voxel(a,p,cc.map((v,i)=>v+c[i]),sz,m);};
    for(let xx=-R;xx<=R;xx++){
      const d=(xx+.5)**2+(zz+.5)**2,inside=xx<R&&d<=R*R&&d>=I*I;
      if(inside&&start===null)start=xx;
      if(!inside&&start!==null){put(start,xx);start=null;}
    }
  }
}
function legs(a,p,width,depth,height,m){for(const x of[-width/2+.125,width/2-.125])for(const z of[-depth/2+.125,depth/2-.125])voxel(a,p,[x,height/2,z],[.125,height,.125],m);}
function bench(a,p,width=1.75,depth=.875,height=.875,m='wood'){
  legs(a,p,width,depth,height-.125,m);voxel(a,p,[0,height-.0625,0],[width,.125,depth],m);
  for(const z of[-depth/2+.125,depth/2-.125])voxel(a,p,[0,.25,z],[width-.125,.09375,.09375],m);
}
function ports(a,p,{input=[-.375,.25,0],output=[.375,.25,0],shaft=[0,.25,.375]}={}){
  anchor(a,'material_input',p,input,'원료 투입 위치; 실제 처리량은 제작 데이터가 결정');
  anchor(a,'material_output',p,output,'가공품 배출 위치; 자동 생성 기능을 의미하지 않음');
  anchor(a,'power_input',p,shaft,'동력 연결 위치; 컴포넌트 기능 계약에 연결');
}
function materials(a,e,content){
  const recipe=content.progression.entries.find(r=>r.id===e.origin?.recipe),source=e.referenceMaterial||Object.keys(recipe?.inputs||{}).find(k=>COLORS[k])||'steel';
  mat(a,'body',COLORS[source]||'#839DA4',{metallic:source==='wood'||source==='stone'?0:.65,sourceMaterialId:source});
  mat(a,'dark','#343F45',{metallic:.45});mat(a,'edge','#C4CDD0',{metallic:.8,roughness:.45});
  mat(a,'wood','#91643E',{blockId:'log'});mat(a,'stone','#8A8C83',{blockId:'stone'});
  mat(a,'copper','#B47B4F',{metallic:.75});mat(a,'cloth','#686D4C');
  mat(a,'mana','#6DAFAE',{roughness:.35,emission:.12});mat(a,'sacred','#CAB879',{metallic:.5,roughness:.45});
  mat(a,'physics','#7487BF',{metallic:.65});mat(a,'glass','#A0CBCD',{roughness:.2,opacity:.7,blockId:'glass',collision:true});
  return source;
}
function cup(a,p){
  voxel(a,p,[0,G/2,0],[.1875,G,.1875],'wood');
  for(const x of[-.09375,.09375])voxel(a,p,[x,.109375,0],[G,.1875,.21875],'wood');
  for(const z of[-.09375,.09375])voxel(a,p,[0,.109375,z],[.15625,.1875,G],'wood');
  for(const yy of[.0625,.15625])voxel(a,p,[.15625,yy,0],[.09375,G,.0625],'wood');voxel(a,p,[.1875,.109375,0],[G,.125,.0625],'wood');
  for(const yy of[.046875,.171875])for(const z of[-.125,.125])voxel(a,p,[0,yy,z],[.1875,G,G],'cloth');
  anchor(a,'grip',p,[.1875,.109375,0],'slot:tool_hand; 채집컵 손잡이');anchor(a,'fluid_mouth',p,[0,.203125,0],'유체 입출구; 용량 1L은 원본 기능 데이터');
}
function pick(a,p,material='stone',scale=1){
  voxel(a,p,[0,.4375*scale,0],[.09375,.8125*scale,.09375],'wood');
  for(let k=0;k<5;k++)voxel(a,p,[(k-2)*.125*scale,.8125*scale-Math.abs(k-2)*.03125,0],[.15625*scale,.125,.125],material);
  for(const x of[-.375,.375])voxel(a,p,[x*scale,.71875*scale,0],[.09375,.09375,.09375],material);
  for(let k=0;k<4;k++)voxel(a,p,[0,.25+k*.0625,0],[.125,G,.125],'cloth');
  anchor(a,p+'_grip',p,[0,.375*scale,0],'slot:tool_hand; 곡괭이 손잡이');anchor(a,p+'_impact',p,[.375*scale,.71875*scale,0],'채굴 접촉점; 실제 도구 등급은 제작 데이터');
}
function knife(a,p){
  voxel(a,p,[0,.140625,0],[.09375,.28125,.09375],'wood');
  voxel(a,p,[0,.40625,0],[.125,.25,.0625],'stone');
  voxel(a,p,[.015625,.5625,0],[.09375,.0625,.0625],'stone');voxel(a,p,[.03125,.609375,0],[.0625,G,.0625],'stone');
  voxel(a,p,[0,.28125,0],[.15625,G,.125],'cloth');
  anchor(a,'grip',p,[0,.140625,0],'slot:tool_hand; 절삭도구 손잡이');anchor(a,'cutting_edge',p,[.0625,.46875,0],'절삭 접촉 위치; 무기 스킬을 추가하지 않음');
}
function tool(a,e){const p=makePart(a,'tool',[0,0,0],'root','tool');if(e.id==='bark_cup')cup(a,p);else if(e.id==='stone_pick')pick(a,p);else knife(a,p);a.equipmentSlots=[{slot:'tool_hand',partIds:[p],anchorId:e.id==='stone_pick'?'tool_grip':'grip'}];}
function tank(a,p,center=[0,.5,0],radius=.25,height=.75,m='body'){
  ring(a,p,center,radius,height,Math.max(G,radius-.0625),m);
  ring(a,p,[center[0],center[1]-height/2+G/2,center[2]],radius,G,0,m);
  for(const yy of[center[1]-height/3,center[1]+height/3])ring(a,p,[center[0],yy,center[2]],radius+G,G,radius-G,'dark');
  const cap=makePart(a,p+'_lid_'+a.parts.filter(q=>q.id.startsWith(p+'_lid_')).length,[...center],'root','lid');ring(a,cap,[0,height/2,0],radius,G,0,m);voxel(a,cap,[0,height/2+.0625,0],[.09375,.09375,.09375],'dark');
}
function component(a,e){
  const p=makePart(a,'housing',[0,0,0],'root','component'),rotor=makePart(a,'shaft',[0,.25,0],'root','moving_part');
  switch(e.id){
    case 'joint':
      for(const x of[-.15625,.15625])voxel(a,p,[x,.1875,0],[.0625,.375,.25],'body');
      ring(a,rotor,[0,0,0],.125,.375,.0625,'edge','x');voxel(a,rotor,[0,0,0],[.5,.0625,.0625],'dark');
      for(const x of[-.1875,.1875])for(const z of[-.09375,.09375])voxel(a,p,[x,.03125,z],[.125,.0625,.0625],'dark');break;
    case 'transmission':
      voxel(a,p,[0,.0625,0],[.625,.125,.375],'dark');
      for(const x of[-.15625,.15625]){ring(a,rotor,[x,.0625,0],.1875,.09375,.0625,'body','z');for(let k=0;k<8;k++){const q=k*Math.PI/4;voxel(a,rotor,[x+snap(Math.cos(q)*.1875),.0625+snap(Math.sin(q)*.1875),0],[.09375,.09375,.125],'edge');}}
      voxel(a,rotor,[0,.0625,0],[.75,.0625,.0625],'dark');break;
    case 'motor': case 'generator':
      ring(a,p,[0,.3125,0],.25,.5,0,'body','z');for(let k=-3;k<=3;k++)ring(a,p,[0,.3125,k*.0625],.28125,G,.21875,e.id==='motor'?'dark':'copper','z');
      voxel(a,rotor,[0,.0625,.375],[.09375,.09375,.25],'edge');
      for(const x of[-.1875,.1875])voxel(a,p,[x,.0625,0],[.125,.125,.5625],'dark');
      voxel(a,p,[0,.609375,-.09375],[.1875,.09375,.1875],e.id==='motor'?'copper':'physics');break;
    case 'heat_engine':
      voxel(a,p,[0,.0625,0],[.875,.125,.5625],'dark');tank(a,p,[-.21875,.40625,0],.1875,.5625,'copper');
      ring(a,rotor,[.25,.125,.0625],.25,.09375,.15625,'body','z');voxel(a,rotor,[.25,.125,.0625],[.0625,.5,.0625],'edge');voxel(a,p,[-.21875,.8125,0],[.125,.25,.125],'dark');break;
    case 'battery':
      voxel(a,p,[0,.28125,0],[.4375,.5,.3125],'body');for(const x of[-.1875,.1875])voxel(a,p,[x,.28125,0],[.0625,.5,.375],'dark');
      for(const x of[-.109375,.109375])voxel(a,p,[x,.5625,0],[.09375,.09375,.09375],x<0?'copper':'edge');
      paint(a,p,[0,.3125,.171875],[.1875,.25,G],'physics');break;
    case 'inertial_cell':
      voxel(a,p,[0,.03125,0],[.625,.0625,.5],'dark');
      for(const x of[-.28125,.28125])voxel(a,p,[x,.3125,0],[.0625,.5625,.125],'body');
      ring(a,rotor,[0,.0625,0],.28125,.09375,.1875,'physics','z');ring(a,rotor,[0,.0625,0],.15625,.125,.0625,'edge','z');voxel(a,rotor,[0,.0625,0],[.6875,.0625,.0625],'dark');break;
    case 'fluid_container':tank(a,p,[0,.40625,0],.25,.75,'body');voxel(a,p,[.3125,.21875,0],[.1875,.09375,.09375],'copper');break;
    case 'pump':
      ring(a,p,[0,.25,0],.1875,.3125,0,'body','z');voxel(a,p,[-.25,.25,0],[.25,.125,.125],'copper');voxel(a,p,[.125,.53125,0],[.125,.375,.125],'copper');
      voxel(a,p,[0,.03125,0],[.5,.0625,.375],'dark');voxel(a,rotor,[0,0,.28125],[.09375,.09375,.25],'edge');break;
    case 'mana_condenser':
      voxel(a,p,[0,.0625,0],[.5625,.125,.5625],'body');for(const x of[-.21875,.21875])for(const z of[-.21875,.21875])voxel(a,p,[x,.40625,z],[.0625,.6875,.0625],'edge');
      ring(a,p,[0,.6875,0],.3125,.0625,.21875,'copper');voxel(a,p,[0,.40625,0],[.15625,.4375,.15625],'mana');ring(a,p,[0,.21875,0],.25,.0625,.15625,'mana');break;
    case 'property_imprinter':
      voxel(a,p,[0,.0625,0],[.6875,.125,.5],'body');for(const x of[-.28125,.28125])voxel(a,p,[x,.375,0],[.125,.5,.3125],'dark');voxel(a,p,[0,.59375,0],[.6875,.09375,.3125],'body');
      voxel(a,rotor,[0,.15625,0],[.1875,.1875,.1875],'mana');voxel(a,p,[0,.15625,0],[.3125,.0625,.3125],'copper');break;
    case 'relic':
      for(let k=0;k<3;k++)voxel(a,p,[0,.0625+k*.09375,0],[.5-k*.09375,.09375,.5-k*.09375],'stone');
      voxel(a,p,[0,.46875,0],[.09375,.40625,.09375],'sacred');voxel(a,p,[0,.53125,0],[.34375,.0625,.09375],'sacred');
      ring(a,p,[0,.46875,0],.25,.0625,.21875,'sacred','z');break;
    case 'controller':
      voxel(a,p,[0,.15625,0],[.5,.3125,.34375],'body');paint(a,p,[0,.21875,.1875],[.3125,.125,G],'dark');for(const x of[-.15625,0,.15625])voxel(a,p,[x,.09375,.21875],[.0625,.0625,.0625],x===0?'copper':'edge');
      voxel(a,rotor,[.15625,.15625,0],[.0625,.25,.0625],'dark');voxel(a,rotor,[.15625,.3125,0],[.125,.09375,.125],'wood');break;
    case 'arc_thrower':
      voxel(a,p,[0,.15625,0],[.5625,.3125,.4375],'body');
      voxel(a,p,[0,.34375,-.0625],[.375,.0625,.3125],'dark');
      for(const x of[-.21875,.21875])voxel(a,p,[x,.15625,.09375],[.0625,.3125,.25],'copper');
      for(const z of[-.15625,.15625])voxel(a,p,[0,.09375,z],[.4375,.0625,.0625],'edge');
      ring(a,p,[0,.34375,.125],.1875,.0625,.125,'mana','z');
      voxel(a,rotor,[0,.21875,.375],[.125,.125,.4375],'dark');
      voxel(a,rotor,[0,.21875,.625],[.1875,.1875,.0625],'edge');
      voxel(a,p,[0,.4375,-.125],[.125,.125,.125],'physics');break;
  }
  if(['battery','fluid_container','relic'].includes(e.id))voxel(a,p,[0,G/2,0],[.5,G,.5],'dark');
  anchor(a,'mount',p,[0,0,0],'slot:component_mount; 기능 부품의 하부 접합면');
  for(const [index,energy]of (e.inputEnergies||[]).entries())anchor(a,'input_'+energy,p,[-.375,.25,index*.125],'energy_input:'+energy);
  for(const [index,energy]of (e.outputEnergies||[]).entries())anchor(a,'output_'+energy,p,[.375,.25,index*.125],'energy_output:'+energy);
  if(['joint','transmission','motor','generator','heat_engine','inertial_cell','pump'].includes(e.id))anchor(a,'drive_shaft',rotor,[0,0,.375],'mechanical shaft; rotation animation pivot, no new function');
  if(['fluid_container','pump','mana_condenser'].includes(e.id)){anchor(a,'fluid_in',p,[-.3125,.25,0],'fluid_input');anchor(a,'fluid_out',p,[.3125,.25,0],'fluid_output');}
  anchor(a,'control',p,[0,.25,.375],'상호작용 위치; 정의된 컴포넌트 기능만 실행');
  if(e.id==='arc_thrower')anchor(a,'muzzle',rotor,[0,.21875,.6875],'electrical projectile origin; range, cadence, cost, and damage come from the component contract');
}
function weaponPattern(a,e){
  const root=e.weaponKind,accent=root==='pierce'?'edge':root==='blunt'?'dark':'body';
  const grip=makePart(a,'grip',[0,0,0],'root','weapon_grip');
  const wrap=makePart(a,'grip_wrap',[0,0,0],'root','grip_wrap');
  voxel(a,grip,[0,0,0],[.09375,.4375,.09375],'wood');
  for(const y of[-.125,-.03125,.0625,.15625])voxel(a,wrap,[0,y,.0625],[.125,G,G],'cloth');
  if(root==='slash'){
    const guard=makePart(a,'guard',[0,0,0],'root','guard'),blade=makePart(a,'blade',[0,0,0],'root','weapon_head'),tip=makePart(a,'point',[0,0,0],'root','weapon_tip');
    voxel(a,guard,[0,.25,0],[.4375,.0625,.125],'dark');
    voxel(a,blade,[0,.5625,0],[.1875,.5625,.09375],accent);
    voxel(a,blade,[0,.5625,.0625],[.03125,.46875,G],'edge');
    voxel(a,tip,[0,.875,0],[.125,.125,.09375],'edge');
    anchor(a,'edge',blade,[.09375,.5625,0],'slash contact edge; gameplay uses the selected material profile');
  }else if(root==='pierce'){
    const shaft=makePart(a,'shaft',[0,0,0],'root','weapon_shaft'),head=makePart(a,'spearhead',[0,0,0],'root','weapon_head'),point=makePart(a,'point',[0,0,0],'root','weapon_tip'),butt=makePart(a,'butt',[0,0,0],'root','weapon_butt');
    voxel(a,shaft,[0,0,0],[.0625,1.5625,.0625],'wood');
    voxel(a,head,[0,.875,0],[.21875,.25,.125],'body');
    voxel(a,head,[0,.875,.0625],[.03125,.1875,G],'edge');
    voxel(a,point,[0,1.03125,0],[.125,.09375,.09375],'edge');
    voxel(a,butt,[0,-.8125,0],[.125,.0625,.125],'dark');
    anchor(a,'point',point,[0,1.078125,0],'piercing contact tip; gameplay uses the selected material profile');
  }else{
    const haft=makePart(a,'haft',[0,0,0],'root','weapon_shaft'),head=makePart(a,'head',[0,0,0],'root','weapon_head'),cap=makePart(a,'head_cap',[0,0,0],'root','weapon_cap');
    voxel(a,haft,[0,.3125,0],[.09375,.625,.09375],'wood');
    voxel(a,head,[0,.59375,0],[.375,.4375,.3125],'body');
    voxel(a,head,[0,.59375,.1875],[.25,.3125,G],accent);
    voxel(a,cap,[0,.84375,0],[.3125,.0625,.25],'edge');
    anchor(a,'impact',head,[0,.8125,.1875],'blunt contact face; gameplay uses the selected material profile');
  }
  anchor(a,'grip',grip,[0,0,0],'slot:main_hand; root hand origin');
  a.equipmentSlots=[{slot:'main_hand',partIds:a.parts.filter(p=>p.id!=='root').map(p=>p.id),anchorId:'grip'}];
  a.notes.push('One archetype model is parameterized by a separately owned material ID. Shape does not grant damage, material mass, durability, or attack mode.');
}
function station(a,e){
  const tier=Number(e.id.match(/_t(\d+)$/)?.[1]||1),p=makePart(a,'frame',[0,0,0],'root','station_frame'),work=makePart(a,'work_surface',[0,0,0],'root','work_surface');
  const advanced=/_station_t/.test(e.id),step=Math.max(0,tier-6),width=advanced?2.25+step*.25:1.75,depth=advanced?1.5+step*.125:.875;
  bench(a,p,width,depth,.875,e.id==='field_bench'?'wood':'dark');
  voxel(a,work,[0,.90625,0],[width-.125,.0625,depth-.125],e.id==='field_bench'?'wood':'body');
  if(e.id==='field_bench'){
    for(let k=0;k<5;k++)voxel(a,work,[-.625+k*.3125,.96875,0],[.28125,.0625,.75],'wood');voxel(a,work,[.4375,1.09375,0],[.25,.1875,.25],'stone');voxel(a,work,[-.4375,1.0625,0],[.0625,.1875,.0625],'dark');
  }else if(e.id==='kiln'){
    const kiln=makePart(a,'furnace',[0,0,0],'root','thermal_chamber');
    for(let k=0;k<5;k++)ring(a,kiln,[0,.1875+k*.1875,0],.625-k*.0625,.1875,.375-k*.03125,'stone');
    voxel(a,kiln,[0,1.1875,-.125],[.25,.5625,.25],'dark');paint(a,work,[0,.9375,.3125],[.5,.0625,.375],'copper');
  }else if(e.id==='forge'){
    voxel(a,work,[-.40625,1.03125,0],[.5,.1875,.4375],'dark');voxel(a,work,[-.40625,1.1875,0],[.6875,.125,.3125],'edge');voxel(a,work,[-.78125,1.1875,0],[.1875,.0625,.1875],'edge');
    tank(a,work,[.4375,1.125,0],.28125,.375,'stone');
  }else if(e.id==='fluid_bench'){
    tank(a,work,[-.4375,1.375,0],.25,.8125,'glass');tank(a,work,[.375,1.21875,0],.1875,.5,'body');
    voxel(a,work,[0,1.03125,.25],[.875,.09375,.09375],'copper');voxel(a,work,[0,1.21875,.25],[.09375,.375,.09375],'copper');
  }else if(e.id==='arcane_bench'){
    for(const x of[-.5625,.5625])voxel(a,work,[x,1.3125,0],[.125,.75,.125],'mana');ring(a,work,[0,1.5625,0],.5,.0625,.375,'copper');voxel(a,work,[0,1.21875,0],[.1875,.5,.1875],'mana');
  }else if(e.id==='consecration_table'){
    voxel(a,work,[0,1.0625,0],[1.5,.25,.6875],'stone');for(const x of[-.5625,.5625]){voxel(a,work,[x,1.3125,0],[.09375,.375,.09375],'sacred');voxel(a,work,[x,1.53125,0],[.1875,.0625,.1875],'sacred');}voxel(a,work,[0,1.25,0],[.5,.125,.375],'sacred');
  }else if(e.id==='precision_bench'){
    voxel(a,work,[0,1.0625,0],[1.375,.1875,.5],'body');for(let k=0;k<5;k++)voxel(a,work,[-.5+k*.25,1.1875,0],[.0625,.0625,.625],'edge');for(const x of[-.5625,.5625])voxel(a,work,[x,1.3125,0],[.125,.375,.3125],'dark');voxel(a,work,[0,1.5,0],[1.25,.125,.125],'edge');
  }else if(e.id.startsWith('arcane_engineering_')){
    for(const x of[-width*.27,width*.27]){
      tank(a,work,[snap(x),1.40625,0],.3125+step*.03125,.875,'body');
      for(let k=0;k<=step;k++)ring(a,work,[snap(x),1.09375+k*.15625,0],.34375+step*.03125,.03125,.28125,'mana');
    }
    for(const x of[-width/2+.125,width/2-.125])voxel(a,work,[snap(x),1.625,-depth/2+.125],[.125,1.375,.125],'dark');
    voxel(a,work,[0,2.3125,-depth/2+.125],[width,.125,.1875],'copper');voxel(a,work,[0,1.4375,0],[.1875,1,.1875],'mana');
  }else if(e.id.startsWith('arcane_studies_')){
    const canopy=makePart(a,'growth_chamber',[0,0,0],'root','growth_chamber');
    for(const x of[-width/2+.25,width/2-.25])for(const z of[-depth/2+.25,depth/2-.25])voxel(a,canopy,[snap(x),1.625,snap(z)],[.09375,1.375,.09375],'wood');
    voxel(a,canopy,[0,2.28125,0],[width-.3125,.0625,depth-.3125],'glass');
    voxel(a,canopy,[0,1.40625,0],[.1875,.9375,.1875],'wood');for(let k=0;k<3+step;k++){const sx=k%2?-1:1,yy=1.25+k*.125;voxel(a,canopy,[sx*.1875,yy,0],[.375,.09375,.125],'wood');voxel(a,canopy,[sx*.34375,yy+.09375,0],[.375,.125,.3125],'mana');}
    for(const x of[-.5,.5])ring(a,work,[x,.96875,0],.3125,.0625,.21875,'copper');
  }else if(e.id.startsWith('sanctity_')){
    for(let k=0;k<3;k++)voxel(a,work,[0,1+k*.09375,0],[width-.125-k*.25,.09375,depth-.125-k*.25],k%2?'sacred':'stone');
    const shrine=makePart(a,'reliquary',[0,0,0],'root','reliquary');
    for(const x of[-width/2+.1875,width/2-.1875]){voxel(a,shrine,[snap(x),1.625,0],[.1875,1.25,.1875],'stone');voxel(a,shrine,[snap(x),2.28125,0],[.3125,.0625,.3125],'sacred');}
    ring(a,shrine,[0,1.8125,0],.5+step*.0625,.09375,.40625+step*.0625,'sacred','z');
    voxel(a,shrine,[0,1.5625,0],[.125,.75,.125],'sacred');voxel(a,shrine,[0,1.6875,0],[.4375,.09375,.125],'sacred');
    for(let k=0;k<step;k++)voxel(a,shrine,[-.375+k*.25,1.34375,.25],[.125,.125,.125],'sacred');
  }else if(e.id.startsWith('physics_')){
    const gyro=makePart(a,'field_cage',[0,1.625,0],'root','field_cage');
    ring(a,gyro,[0,0,0],.625+step*.0625,.09375,.5+step*.0625,'physics','z');ring(a,gyro,[0,0,0],.5+step*.0625,.09375,.40625+step*.0625,'edge','x');
    ring(a,gyro,[0,0,0],.375+step*.03125,.0625,.28125+step*.03125,'copper','y');voxel(a,gyro,[0,0,0],[.25,.25,.25],'physics');
    for(const x of[-width/2+.125,width/2-.125])voxel(a,work,[snap(x),1.375,0],[.125,.875,.3125],'dark');
    for(let k=0;k<=step;k++)voxel(a,work,[-.625+k*.3125,1.0625,depth/2-.125],[.15625,.1875,.125],'physics');
  }
  // Front control rail and tier pips distinguish assembled stations at a glance.
  if(e.id!=='kiln'){
    voxel(a,work,[0,.96875,depth/2+.03125],[.625,.1875,.125],'dark');
    for(let k=0;k<Math.min(5,advanced?step+1:1);k++)voxel(a,work,[-.25+k*.125,1,depth/2+.109375],[.0625,.0625,G],advanced?'mana':'copper');
  }
  anchor(a,'mount',p,[0,0,0],'slot:station_ground; 설치 원점');anchor(a,'work',work,[0,.9375,0],'제작 작업 슬롯');
  ports(a,work,{input:[-width/2,.9375,0],output:[width/2,.9375,0],shaft:[0,.5,-depth/2]});
  anchor(a,'interaction',work,[0,.9375,depth/2+.25],'플레이어 조작 지점');
  a.visualDimensionsPolicy='Station frame grows by tier; dimensions are visual design, not implicit crafting capacity or mass.';
}
function gear(a,e){
  const t=e.tier,m='body',accent=t>=7?'sacred':t>=5?'mana':t>=3?'edge':'wood';
  const chest=makePart(a,'armor_chest',[0,.8125,0],'root','armor'),helmet=makePart(a,'armor_helmet',[0,1.5625,0],'root','armor');
  voxel(a,chest,[0,.25,.15625],[.5625,.5625,.09375],m);voxel(a,chest,[0,.25,-.15625],[.5625,.5625,.09375],m);
  for(const x of[-.296875,.296875])voxel(a,chest,[x,.25,0],[.0625,.5,.3125],m);
  for(let k=0;k<3;k++)paint(a,chest,[0,.09375+k*.15625,.21875],[.5,.0625,G],accent);
  if(t<=2)for(let k=0;k<5;k++)paint(a,chest,[-.21875+k*.109375,.25,.21875],[.0625,.5,G],'wood');
  const belt=makePart(a,'armor_belt',[0,.8125,0],'root','armor');voxel(a,belt,[0,0,0],[.65625,.125,.4375],'cloth');voxel(a,belt,[0,0,.25],[.1875,.125,.0625],accent);
  for(const sx of[-1,1]){
    const shoulder=makePart(a,sx<0?'armor_shoulder_left':'armor_shoulder_right',[sx*.375,1.25,0],'root','armor');
    for(let k=0;k<(t>=4?3:2);k++)voxel(a,shoulder,[sx*k*.03125,-k*.0625,0],[.25+k*.03125,.0625,.34375],k===0?accent:m);
    const boot=makePart(a,sx<0?'armor_greave_left':'armor_greave_right',[sx*.1875,.125,0],'root','armor');voxel(a,boot,[0,.21875,.09375],[.21875,.4375,.125],m);voxel(a,boot,[0,-.0625,.09375],[.25,.125,.375],'dark');
  }
  voxel(a,helmet,[0,.15625,0],[.5,.09375,.4375],m);for(const x of[-.21875,.21875])voxel(a,helmet,[x,0,0],[.0625,.25,.4375],m);voxel(a,helmet,[0,0,-.1875],[.4375,.25,.0625],m);
  voxel(a,helmet,[0,.0625,.21875],[.4375,.0625,.0625],accent);for(const x of[-.15625,.15625])voxel(a,helmet,[x,-.09375,.21875],[.125,.125,.0625],m);
  if(t>=5){voxel(a,helmet,[0,.28125,0],[.09375,.15625,.34375],accent);for(let k=0;k<Math.min(3,t-5);k++)voxel(a,chest,[0,.1875+k*.09375,.28125],[.09375,.0625,.0625],accent);}
  const weapon=makePart(a,'weapon',[.75,.125,0],'root','weapon');voxel(a,weapon,[0,.28125,0],[.09375,.4375,.09375],'wood');
  for(let k=0;k<4;k++)voxel(a,weapon,[0,.15625+k*.0625,0],[.125,G,.125],'cloth');
  if(t===1){voxel(a,weapon,[0,.78125,0],[.25,.5625,.1875],'wood');for(const sx of[-1,1])voxel(a,weapon,[sx*.15625,.8125,0],[.09375,.3125,.09375],'stone');}
  else{
    voxel(a,weapon,[0,.5,0],[.40625,.0625,.125],accent);voxel(a,weapon,[0,.859375,0],[.15625,.65625,.0625],m);voxel(a,weapon,[0,1.234375,0],[.09375,.09375,.0625],m);voxel(a,weapon,[0,1.296875,0],[G,G,.0625],accent);
    if(t>=5)paint(a,weapon,[0,.890625,.046875],[G,.59375,G],accent);
  }
  const shield=makePart(a,'shield',[-.6875,.625,0],'root','armor');
  for(let k=0;k<5;k++){const w=.625-Math.abs(k-2)*.0625;voxel(a,shield,[0,k*.125,0],[w,.125,.09375],m);}voxel(a,shield,[0,.25,.09375],[.1875,.1875,.09375],accent);
  const tool=makePart(a,'utility_tool',[-1.21875,.125,0],'root','tool');pick(a,tool,t>=3?m:'stone',.75);
  anchor(a,'weapon_grip',weapon,[0,.28125,0],'slot:main_hand; 이 위치를 아바타 손 좌표에 정렬');
  anchor(a,'weapon_contact',weapon,[0,t===1?1.0625:1.3125,0],'melee_contact; 원본 hitDamage/attackPeriod 사용, 별도 스킬 없음');
  anchor(a,'chest_attach',chest,[0,.25,0],'slot:torso; 아바타 흉부 장착');anchor(a,'helmet_attach',helmet,[0,0,0],'slot:head; 아바타 머리 장착');anchor(a,'shield_grip',shield,[0,.25,-.09375],'slot:off_hand');
  a.equipmentSlots=[{slot:'main_hand',partIds:['weapon'],anchorId:'weapon_grip'},{slot:'off_hand',partIds:['shield'],anchorId:'shield_grip'},{slot:'torso',partIds:a.parts.filter(p=>p.id.startsWith('armor_')&&!p.id.includes('helmet')).map(p=>p.id),anchorId:'chest_attach'},{slot:'head',partIds:['armor_helmet'],anchorId:'helmet_attach'},{slot:'tool_hand',partIds:['utility_tool'],anchorId:'utility_tool_grip'}];
  a.notes.push('이 세트는 원본 gear_baseline의 비교용 제작 장구를 무기·보호구·도구로 나눈 시각 해석이다. 검/곤봉 실루엣이 별도 무기 기술이나 추가 피해 속성을 만들지 않는다.');
}
export function generate(content){
  const entries=content.progression?.entries?.filter(e=>['tool','station','component','gear_baseline','weapon_pattern'].includes(e.kind))||[];
  return entries.map(e=>{
    const a=asset(e,'equipment',G);a.contentRef={file:'design/content/progression.json',id:e.id};a.equipmentKind=e.kind;
    a.tier=e.tier||Number(e.id.match(/_t(\d+)$/)?.[1]||1);a.sourceRecipeId=e.origin?.recipe||null;
    a.referenceMaterialId=materials(a,e,content);
    if(e.kind==='tool')tool(a,e);else if(e.kind==='station')station(a,e);else if(e.kind==='component')component(a,e);else if(e.kind==='weapon_pattern')weaponPattern(a,e);else gear(a,e);
    a.notes.push('제작 시점 SDK가 같은 부위의 중복 점유를 차단한다. 의도된 합집합은 fill, 재질 덧칠은 paint로 즉시 처리한다. 사후 중복 제거를 하지 않는다.',
      '시각 모델의 외형·앵커는 설치와 장착의 기준이다. 기능·에너지 입출력·내구·질량·실제 용량은 progression 데이터와 런타임 계약을 사용한다.',
      '부위의 parent/translation을 보존하며 같은 소유자에 속한 장구·관절 부위는 자기 충돌을 하지 않는다.');
    const builder=new VoxelAssetBuilder(a);return builder.toJSON();
  });
}
