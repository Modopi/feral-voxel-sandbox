// Map presets on the one runtime (docs/UNIFIED-GAME.md). A map only chooses terrain, rules, start and
// places; creatures, items, research, crafting and saving are the runtime's. The basic island reuses the
// original island generator (world.js) and maps its blocks to design blocks.
import {WorldAtlas} from './atlas.js';
import {World, SIZE as ISLAND_SIZE, SEA as ISLAND_SEA} from '../world.js';
import {GEAR, MINING_HARDNESS} from '../equipment.js';

// Original island block numbers → design blocks (design blocks.json lists the same legacy numbers).
// Lava has no design block; the crater keeps its basalt shape.
export const LEGACY_BLOCKS = Object.freeze({1:'grass',2:'dirt',3:'stone',4:'sand',5:'log',6:'leaves',7:'iron_ore',8:'basalt',9:'basalt',10:'ash',11:'plank'});
// Original items → design items. Block pieces become the mapped block's raw resource at the design yield
// per cell; consumables keep their count. Everything else is listed, never silently converted.
export const LEGACY_ITEMS = Object.freeze({
  berry:{item:'berry',ratio:1},herb:{item:'herb',ratio:1},meat:{item:'meat',ratio:1},food:{item:'food',ratio:1},stew:{item:'food',ratio:1},seed:{item:'seed',ratio:1},
  stone:{item:'loose_stone',ratio:1},wood:{item:'raw_timber',ratio:1},sand:{item:'sand',ratio:1},dirt:{item:'soil',ratio:1},crystal:{item:'iron_ore',ratio:1},fiber:{item:'plant_fiber',ratio:1},
  // The island's starting pick: the design has no wooden pick, and a new island starts with the stone pick.
  stonepick:{item:'stone_pick',ratio:1},pick:{item:'stone_pick',ratio:1},
});
// Sandbox maps build with what they mine: a raw resource becomes the block it comes from, one unit per
// 0.5 m cell (the design's harvest yield), like the original island's block pieces.
export const BUILD_BLOCKS = Object.freeze({loose_stone:'stone',raw_timber:'log',sand:'sand',clay:'clay',iron_ore:'iron_ore',wood:'plank',stone:'stone',soil:'dirt'});
// Mining follows the frontier rule (equipment.js miningWorkFor) on every map. Design blocks are soil,
// wood, rock or ore; blocks the original island also had keep the frontier hardness, harder design-only
// blocks scale with their durability against the reference block of their kind.
const MINING_REFERENCE = {soil:'dirt',wood:'log',rock:'stone',ore:'iron_ore'};
const ROCK_MATERIALS = new Set(['stone','scrap_iron']);
export function miningKind(block){
  if(!block)return null;
  if(/_ore$|^sulfur_deposit$/.test(block.id))return 'ore';
  if(['wood','mana_wood'].includes(block.materialId))return 'wood';
  if(ROCK_MATERIALS.has(block.materialId)||['clay_brick','glass'].includes(block.id))return 'rock';
  return 'soil';
}
export function miningProfile(block,blocks){
  const kind=miningKind(block);if(!kind)return null;
  const reference=blocks.get(MINING_REFERENCE[kind]),scale=block.legacyBlockId!=null||!reference?1:Math.max(1,block.durabilityHpPerCell/reference.durabilityHpPerCell);
  return {kind,affinity:kind==='ore'?'rock':kind,hardness:MINING_HARDNESS[kind]*scale};
}
// A mined cell gives its block's raw resource; blocks without one give what the frontier gave for them.
export const MINED_ITEMS = Object.freeze({grass:'soil',dirt:'soil',ash:'soil',leaves:'plant_fiber',plank:'wood',moss:'plant_fiber',algae:'plant_fiber',
  ash_lichen:'plant_fiber',salt_grass:'plant_fiber',mana_fern:'plant_fiber',luminous_moss:'plant_fiber',mineral_lichen:'plant_fiber',iron_scrap_block:'scrap_iron'});
export function minedItem(block){
  if(!block)return null;
  return block.rawResourceId&&block.harvestYieldPerCell>0?{id:block.rawResourceId,count:block.harvestYieldPerCell}:MINED_ITEMS[block.id]?{id:MINED_ITEMS[block.id],count:1}:null;
}
// Design tools on the frontier tool table. Without a tool the hands mine like the frontier's starting pick.
export const TOOL_GEAR = Object.freeze({stone_pick:GEAR.stonepick,hand_knife:Object.freeze({name:'돌 절삭도구',power:2,affinity:'wood'})});
export const BARE_GEAR = GEAR.pick;
export const LEGACY_SPECIES = Object.freeze({0:'moss_deer',1:'copper_fox',2:'azure_beetle'});
const insideIsland = (x,z) => x>=0&&z>=0&&x<ISLAND_SIZE&&z<ISLAND_SIZE;
const ISLAND_SPAWN = {x:77.5,z:84.5,yaw:-.5};

/** The 160 × 160 m island with its rivers, crater and ruin, surrounded by sea. */
export class IslandAtlas extends WorldAtlas {
  get generatorId(){return 'island-v1';}
  get island(){if(!this._island){const w=new World(Number(this.seed));w.generate();this._island=w;}return this._island;}
  _rawSample(x,z){
    const inside=insideIsland(x,z),height=inside?this.island.surface(x,z):4,water=height<ISLAND_SEA+1;
    const environmentId=!inside?'coast':x>=132&&x<148&&z>=27&&z<42?'thermal':x>125&&z<90?'ridge':'grove';
    return {environmentId,baseEnvironmentId:environmentId,tier:1,baseTier:1,height,waterLevel:water?ISLAND_SEA+1:null,waterType:water?'water':null,safeBypass:false,
     hostileSpawnsAllowed:inside,highTierPatchId:null,nearbyPatch:null,ecologyCellId:`eco:${Math.floor(x/64)},${Math.floor(z/64)}`,reservedBy:null};
  }
  _baseCell(hx,hy,hz){
    const x=hx*.5,z=hz*.5;
    if(!insideIsland(x,z))return hy<=7?(hy<5?'stone':'sand'):null;
    return LEGACY_BLOCKS[this.island.getCell(hx,hy,hz)]??null;
  }
  _chunkCell(hx,hy,hz){return this._baseCell(hx,hy,hz);}
  _vegetationAt(){return null;}
  findBuildingSites(){return [];}
  harvestNodesAround(x,z,radius=64){
    const nodes=super.harvestNodesAround(x,z,radius).filter(n=>!n.id.startsWith('starter:')&&insideIsland(n.x,n.z));
    // Starter branches and stones sit around the island landing, like the expedition's around its spawn.
    const definitions=new Map(this.rules.harvestNodes.map(n=>[n.id,n]));
    for(const [nodeId,count]of [['fallen_branch',8],['loose_stone',8],['fiber_patch',4],['berry_bush',6]])for(let i=0;i<count;i++){
     const angle=this._rand('island-starter-angle',nodeId,i)*Math.PI*2,r=8+this._rand('island-starter-radius',nodeId,i)*16;
     const px=Math.round((ISLAND_SPAWN.x+Math.cos(angle)*r)*2)/2,pz=Math.round((ISLAND_SPAWN.z+Math.sin(angle)*r)*2)/2,def=definitions.get(nodeId),s=this.sample(px,pz);
     if(Math.hypot(px-x,pz-z)<=radius&&s.waterLevel===null)nodes.push({id:`starter:${nodeId}:${i}`,nodeId,sourceId:def.sourceId,resourceId:def.resourceId,x:px,y:this.heightAt(px,pz),z:pz,regrowS:def.regrowS});
    }
    return nodes;
  }
}

export const MAPS = Object.freeze({
  expedition:Object.freeze({id:'expedition',name:'FERAL 탐험',spawn:{x:0,z:0,yaw:Math.PI},rules:{survival:true},atlas:WorldAtlas,
   description:'끝없이 이어지는 세계입니다. 출발지에서 멀어질수록 위험해집니다. 던전·공동체·유적을 찾고, 채집한 표본으로 연구해 제작과 설비를 넓혀 가세요.',
   region:()=>true,landmarks:[],starter:{}}),
  island:Object.freeze({id:'island',name:'기본 탐험 맵',spawn:ISLAND_SPAWN,rules:{survival:false,sandbox:true,structures:false},atlas:IslandAtlas,
   description:'160 × 160 m의 섬입니다. 다섯 장소를 탐험하고 생태의 변화를 관찰하세요. 체력·식량이 줄지 않는 평화 규칙이며, 개발·생태 탭의 샌드박스 도구를 쓸 수 있습니다.',
   region:(x,z)=>insideIsland(x,z),
   landmarks:[{x:77,z:81,name:'초록 능선'},{x:102,z:55,name:'굽이치는 강'},{x:140,z:35,name:'잿빛 분화구'},{x:35,z:45,name:'이끼 숲'},{x:48,z:120,name:'잊힌 관측소'}],
   starter:{stone_pick:1,raw_timber:4,loose_stone:4,seed:4}}),
});
export function mapFor(type){return MAPS[type]??MAPS.expedition;}

/** Carry an original island save into a fresh island runtime. The original save is not modified.
 * Returns what could not be carried over, for the player to see. */
export function applyLegacyIsland(runtime,old){
  const unmapped=[],items={},note=(name,detail)=>unmapped.push({name,detail});
  const world=old?.world;
  if(world?.edits?.length||world?.subcells?.length||world?.miningDamage?.length){
    // The original loader applies the save to the original generator; only cells that differ are copied.
    const base=new World(Number(world.seed??runtime.seed));base.generate();
    const loaded=new World(Number(world.seed??runtime.seed));loaded.generate();loaded.load(world);
    const touched=new Set([...(world.edits??[]).map(([i])=>i),...(world.subcells??[]).map(([i])=>i)]);let cells=0;
    for(const i of touched){const [x,y,z]=loaded.decode(i);for(let j=0;j<8;j++){
     const hx=x*2+(j&1),hy=y*2+((j>>1)&1),hz=z*2+((j>>2)&1),value=loaded.getCell(hx,hy,hz);
     if(value===base.getCell(hx,hy,hz))continue;
     const id=value?LEGACY_BLOCKS[value]??null:null;
     if(value&&!id){note('알 수 없는 블록',`${value}번 블록 1칸`);continue;}
     if(runtime.atlas.setCell(hx,hy,hz,id))cells++;
    }}
    runtime.conversionCells=cells;
    // Half-mined cells keep their wound: the frontier rule and the 0.5 m cells are the same on both sides.
    let wounds=0;
    for(const [key,[b,ratio]]of loaded.miningDamage){const [x,y,z]=loaded.decode(key>>3),j=key&7,cell=[x*2+(j&1),y*2+((j>>1)&1),z*2+((j>>2)&1)],blockId=LEGACY_BLOCKS[b];
     if(blockId&&runtime.atlas.getCell(...cell)===blockId){runtime.terrainDamage[cell.join(',')]={blockId,damage:ratio};wounds++;}}
    runtime.conversionWounds=wounds;
  }
  if(world?.fluids?.length)note('부은 물·산',"섬의 바다와 강은 그대로이며, 직접 부은 물과 산의 분포는 초기화됩니다.");
  if(world?.burning?.length)note('불',`${world.burning.length}칸의 불은 꺼집니다.`);
  if(world?.loose?.bodies?.length)note('떨어진 물체',`${world.loose.bodies.length}개는 옮기지 못했습니다.`);
  if(old?.eco?.entities?.length)note('동물 개체',`${old.eco.entities.length}마리의 개별 상태 대신 같은 종(이끼사슴·구리여우·청금딱정)의 생태가 새로 자랍니다.`);
  for(const s of [...(old?.inventory?.slots??[]),...(old?.inventory?.overflow??[])]){if(!s)continue;
   const rule=LEGACY_ITEMS[s.id];if(rule)items[rule.item]=(items[rule.item]??0)+s.count*rule.ratio;else note('아이템',`${s.id} ${s.count}개`);}
  if(old?.inventory?.unlocks?.length)note('기존 연구',`${old.inventory.unlocks.join(', ')}: 같은 이름의 연구는 연구 탭에서 다시 진행합니다.`);
  if(Object.keys(items).length){const r=runtime.progression.grant(items,{claimId:'legacy-island:items'});if(!r.ok)note('아이템 지급 실패',r.reason);}
  const p=old?.player;
  if(p&&[p.x,p.y,p.z].every(Number.isFinite)){Object.assign(runtime.player,{x:p.x,y:p.y,z:p.z,yaw:Number.isFinite(p.yaw)?p.yaw:runtime.player.yaw,pitch:Number.isFinite(p.pitch)?p.pitch:0,vy:0,stance:'stand'});}
  const discovered=(old?.discovered??[]).filter(name=>runtime.map.landmarks.some(l=>l.name===name));
  runtime.discoveredLandmarks=new Set(discovered);
  runtime.conversion={from:'feral.world.v1',version:old?.version??null,playTimeS:old?.playTime??0,items,unmapped};
  return runtime.conversion;
}
