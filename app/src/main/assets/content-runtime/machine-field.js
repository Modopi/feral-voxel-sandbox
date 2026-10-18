// The machine field (docs/ARCHITECTURE.md §6) on the one runtime: a world of the machine-field terrain with this
// module. Machines are built, driven into the pillars and the wall, damaged and repaired with the runtime's own
// machine system and panel. The module gives the field's starting equipment once, brings in its two example
// machines, returns a machine to the start pad, and carries over a save the old field page made.

// The start pad: example machines stand here facing down the field (-Z), and a machine returns here.
export const FIELD_START = Object.freeze({x:0,z:5,yaw:Math.PI});
// Starting equipment: building materials for small (10 cm) machines, fuel, the parts of one more car and the
// research those parts need. The examples are 50 cm machines the field brings in without taking from the bag.
export const FIELD_KIT = Object.freeze({wood:640,scrap_iron:256,raw_timber:64,heat_engine:1,transmission:4,controller:1});
export const FIELD_RESEARCH = Object.freeze(['heat_engine','transmission','controller']);

/** The old field's example designs (machine/model.js preset) in runtime cells: a three-voxel spine with the
 * engine on top and four wheels; the heavy one adds a 3 × 5 deck. Front is +Z on the machine. The driver sits
 * at the front (the controller's voxel) with nothing above or ahead, so the view down the field is open. */
export function exampleDesign(heavy=false){
  const voxels=[],components=[],links=[],cell=(x,y,z)=>voxels.push({cell:[x,y,z],materialId:'wood'});
  for(let z=-1;z<=1;z++)cell(0,0,z);
  cell(0,1,0);
  for(const x of [-1,1])for(const z of [-1,1])cell(x,0,z);
  if(heavy)for(let z=-2;z<=2;z++)for(const x of [-1,0,1])if(x||z)cell(x,1,z);
  components.push({cell:[0,1,0],componentId:'heat_engine',fuelItems:8},{cell:heavy?[0,1,2]:[0,0,1],componentId:'controller'});
  for(const x of [-1,1])for(const z of [-1,1]){components.push({cell:[x,0,z],componentId:'transmission',legacyType:'wheel'});links.push({from:0,to:components.length-1,type:'mechanical'});}
  return {name:heavy?'중량 예제':'경량 예제',gridM:.5,voxels,components,links};
}

export class MachineField {
  constructor(runtime,state=null){
    this.runtime=runtime;this.revision=0;
    if(state!=null&&(typeof state!=='object'||typeof state.equipped!=='boolean'))throw Error('기계 시험장 기록이 손상되었습니다.');
    this.equipped=state?.equipped??false;
  }
  tick(){if(!this.equipped)this.equip();}
  /** The starting equipment and the light example, once per field. */
  equip(){
    const g=this.runtime.progression;this.equipped=true;
    for(const id of FIELD_RESEARCH){const research=g.catalog.get(g.catalog.get(id).research);if(!g.research.has(research.id))g.discover(research.blueprint,{origin:'discovery',claimId:`machine-field:research:${research.id}`});}
    g.grant(FIELD_KIT,{claimId:'machine-field:kit'});
    this.example(false);
  }
  /** Where the cell (0, 0, 0) of a machine facing down the field stands on the start pad. */
  startPose(){
    const {x,z,yaw}=FIELD_START,half=.25;
    // Cell (0, 0, 0)'s centre is half a voxel from the machine's origin; turned to face -Z that is -X and -Z.
    return {position:{x:x+half,y:this.runtime.surfaceHeight(x,z)+.06,z:z+half},yaw};
  }
  /** Brings in an example machine on the start pad, replacing the field's earlier example and its fragments. */
  example(heavy){
    const s=this.runtime.machines;
    for(const m of [...s.machines.values()])if(m.fieldExample)s.removeMachine(m.id);
    const pose=this.startPose(),result=s.importDesign({...exampleDesign(heavy),...pose,tags:{fieldExample:true}});
    if(result.ok){this.revision++;this.runtime.message(`${heavy?'중량':'경량'} 예제 기계를 출발 패드에 놓았습니다.`);}
    return result;
  }
  /** Puts a machine back on the start pad, upright and at rest (the old field's return to the start). */
  recover(id){
    const pose=this.startPose(),result=this.runtime.machines.place(id,pose);
    if(result.ok)this.runtime.message('기계를 출발 패드로 옮겼습니다.');
    return result;
  }
  serialize(){return {equipped:this.equipped};}
}

// ---- A save of the old machine field page (machine/model.js, `feral.machine.v1`) ----
// Its parts were 0.5 m cells on a grid facing -Z: a hull, a motor (power) or a wheel. On the runtime they are
// wood voxels of a 50 cm machine turned to face +Z, the motor a heat engine, each wheel a wheel transmission
// linked to every engine, and a controller on the core hull so it can be driven. Health keeps its share.
const OLD_PARTS = Object.freeze({hull:null,motor:{componentId:'heat_engine',fuelItems:8},wheel:{componentId:'transmission',legacyType:'wheel'}});
const OLD_NAMES = Object.freeze({hull:'차체',motor:'모터',wheel:'바퀴',wing:'주날개',elevator:'수평 꼬리날개',rudder:'수직 꼬리날개',propeller:'프로펠러',cannon:'포탑',rotor:'회전익'});
const OLD_HP = Object.freeze({hull:100,motor:80,wheel:60,wing:40,elevator:35,rudder:35,propeller:45,cannon:70,rotor:50});

export function applyLegacyMachineField(runtime,old,from){
  const unmapped=[],note=(name,detail)=>unmapped.push({name,detail}),field=runtime.modules['machine-field']??runtime.loadModule('machine-field',null);
  let parts=[];const broken=[],unknown=[];
  for(const p of old.blueprint){
    const hp=Number(old.hp?.[p.id]);
    if(!(p.type in OLD_PARTS)){unknown.push(p);continue;}
    if(!(hp>0)){broken.push(p);continue;}
    parts.push({...p,share:Math.min(1,hp/OLD_HP[p.type])});
  }
  if(broken.length)note('부서진 부품',`${broken.length}개(체력 0)는 옮기지 않았습니다.`);
  // The old page kept parts that no longer touched the core (it carried them as weight); here they fall off.
  if(parts.length){
    const key=p=>`${p.x},${p.y},${p.z}`,alive=new Map(parts.map(p=>[key(p),p]));
    const core=parts.find(p=>p.type==='hull'&&!p.x&&!p.y&&!p.z)??parts[0],keep=new Set([key(core)]),queue=[core];
    while(queue.length){const p=queue.pop();for(const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){const k=`${p.x+dx},${p.y+dy},${p.z+dz}`;if(alive.has(k)&&!keep.has(k)){keep.add(k);queue.push(alive.get(k));}}}
    const detached=parts.filter(p=>!keep.has(key(p)));parts=parts.filter(p=>keep.has(key(p)));
    if(detached.length)note('떨어져 나간 부품',`${detached.map(p=>OLD_NAMES[p.type]).join('·')} ${detached.length}개는 기계에 이어져 있지 않아 옮기지 않았습니다.`);
  }
  if(unknown.length)note('시험장에 없는 부품',unknown.map(p=>OLD_NAMES[p.type]??p.type).join('·'));
  if(old.assembly||old.fragments||old.pose)note('월드 조립체 기록','개척 원정의 조립체 위치·조각 기록은 옮기지 않았습니다.');
  if(Number.isFinite(old.stock))note('시험장 재료',`${old.stock}(시작 장비의 재료로 대신합니다)`);
  let machines=0;
  if(parts.length){
    // Old (x, y, z) facing -Z → runtime (-x, y, -z) facing +Z: the same machine turned around, left stays left.
    const voxels=parts.map(p=>({cell:[-p.x,p.y,-p.z],materialId:'wood',hp:p.share})),components=[],links=[];
    for(const p of parts)if(OLD_PARTS[p.type])components.push({cell:[-p.x,p.y,-p.z],...OLD_PARTS[p.type]});
    const engines=components.flatMap((c,i)=>c.componentId==='heat_engine'?[i]:[]),wheels=components.flatMap((c,i)=>c.legacyType==='wheel'?[i]:[]);
    for(const from of engines)for(const to of wheels)links.push({from,to,type:'mechanical'});
    // The seat: the frontmost hull with nothing above it (old front is -Z), nearest the centre line, so the
    // driver's view ahead is open; else any hull.
    const filled=new Set(parts.map(p=>`${p.x},${p.y},${p.z}`)),open=parts.filter(p=>p.type==='hull'&&!filled.has(`${p.x},${p.y+1},${p.z}`));
    const seat=open.sort((a,b)=>a.z-b.z||Math.abs(a.x)-Math.abs(b.x)||b.y-a.y)[0]??parts.find(p=>p.type==='hull');
    if(seat)components.push({cell:[-seat.x,seat.y,-seat.z],componentId:'controller'});else note('조종석','차체가 없어 조종 장치를 달지 못했습니다.');
    // The old body stood at (x, z) with its core cell's centre there; forward (sin yaw, -cos yaw) is runtime yaw π - yaw.
    const body=old.body??{x:0,z:5,yaw:0},yaw=Math.PI-(Number(body.yaw)||0),half=.25;
    const x=(Number(body.x)||0)-(Math.cos(yaw)*half+Math.sin(yaw)*half),z=(Number(body.z)||0)-(Math.cos(yaw)*half-Math.sin(yaw)*half);
    const result=runtime.machines.importDesign({name:'옮겨 온 기계',gridM:.5,position:{x,y:runtime.surfaceHeight(x,z)+.06,z},yaw,voxels,components,links});
    if(result.ok)machines=1;else note('기계',`부품을 이어 붙일 수 없어 옮기지 못했습니다(${result.reason}).`);
  }
  // The field still hands out its starting equipment, but not a second example next to the carried-over machine.
  field.equipped=true;
  const g=runtime.progression;
  for(const id of FIELD_RESEARCH){const research=g.catalog.get(g.catalog.get(id).research);if(!g.research.has(research.id))g.discover(research.blueprint,{origin:'discovery',claimId:`machine-field:research:${research.id}`});}
  g.grant(FIELD_KIT,{claimId:'machine-field:kit'});
  if(!machines)field.example(false);
  runtime.refreshWorld();
  return runtime.conversion={from,version:'machine-field-1',playTimeS:Math.round((Number(old.tick)||0)/60),items:[],extras:machines?[`기계 1대(부품 ${parts.length}개)`]:[],unmapped};
}
