import { VoxelAssetBuilder } from './voxel/authoring.js';

const GRID = 0.0625;
const MODEL_CACHE = new Map();
const TYPES = {
  source_raw_timber: ['fallen_branch', '떨어진 나뭇가지', 'raw_timber'],
  source_loose_stone: ['loose_stone', '주운 돌', 'loose_stone'],
  source_plant_fiber: ['fiber_patch', '섬유 풀', 'plant_fiber'],
  source_berry: ['berry_bush', '들열매 관목', 'berry'],
  source_herb: ['herb_patch', '약초', 'herb'],
  source_clay: ['clay_bank', '점토층', 'clay'],
  source_water: ['freshwater', '담수 원천', 'water'],
  source_sand: ['sand_bank', '모래층', 'sand'],
  source_sap: ['sap_tap', '수액 나무', 'sap'],
  source_seed: ['seed_head', '씨앗 이삭', 'seed'],
  source_acid_sap: ['acid_reed', '산성 갈대', 'acid_sap'],
  source_iron_ore: ['iron_ore', '철 원광', 'iron_ore'],
  source_titanium_ore: ['titanium_ore', '티타늄 원광', 'titanium_ore'],
  source_nickel_ore: ['nickel_ore', '니켈 원광', 'nickel_ore'],
  source_sulfur_deposit: ['sulfur_deposit', '황질 침전물', 'sulfur_deposit'],
  source_mana_crystal_ore: ['mana_crystal_ore', '마나 결정 원광', 'mana_crystal_ore'],
};
const SOURCE_BY_TYPE = new Map(Object.entries(TYPES).map(([id, [type]]) => [type, id]));
const COLORS = { bark:'#79573C', heartwood:'#B89A63', leaf:'#51804D', leafLight:'#78965B',
  reed:'#78975B', fiber:'#C5B78B', berry:'#AB4761', flower:'#C4AAC9', stone:'#858F8B',
  darkStone:'#596563', clay:'#A57254', sand:'#CBB985', water:'#659CA4', sap:'#C89B50',
  acid:'#ABBA57', iron:'#AF7958', titanium:'#B1BFC7', nickel:'#9DAB79', sulfur:'#CEBD5C', mana:'#6EAEA9' };
function sourceKey(id) {
  const key = TYPES[id] ? id : SOURCE_BY_TYPE.get(id);
  if (!key) throw new RangeError('알 수 없는 채집 원천: ' + id);
  return key;
}
/** All geometry passes through the same creation-time occupancy SDK as authored equipment. */
export function buildResourceAsset(sourceIdOrNodeType) {
  const sourceId = sourceKey(sourceIdOrNodeType);
  if (MODEL_CACHE.has(sourceId)) return MODEL_CACHE.get(sourceId);
  const [nodeType, name, resourceId] = TYPES[sourceId];
  const builder = new VoxelAssetBuilder({ schemaVersion:1, id:`resource_${resourceId}`, name,
    category:'resource', equipmentKind:null, status:'art_prototype', units:'m', upAxis:'Y', forwardAxis:'+Z', visualGridM:GRID,
    contentRef:{file:'design/content/progression.json',id:sourceId}, sourceId, resourceId,
    materials:Object.entries(COLORS).map(([id,color]) => ({id,color,roughness:.9,metallic:['iron','titanium','nickel'].includes(id)?.35:0,
      emission:0,opacity:id==='water'?.8:1,collision:id!=='water'})),
    parts:[{id:'root',parent:null,translation:[0,0,0],role:'resource',boxes:[]}],
    anchors:[{id:'harvest',partId:'root',position:[0,.375,0],purpose:'채집 조준 위치; 실제 도구·시간·보상은 source 데이터'}], instances:[],
    notes:['원천별 채집 형상이다. 형상이 아이템 생성·채집 권한·에너지 기능을 추가하지 않는다.',
      '실제 위치와 소진/재생은 atlas 노드와 progression 채집 원장에 종속된다. 같은 부위 합집합은 제작 시점 fill만 사용한다.'] });
  // Integer cell ranges make all boundaries exact; intentional branch/leaf unions use explicit fill.
  const box = (x,y,z,w,h,d,material) => builder.addBox('root', {
    center:[(x+w/2)*GRID,(y+h/2)*GRID,(z+d/2)*GRID], size:[w*GRID,h*GRID,d*GRID], material }, {mode:'fill'});
  const leaf = (x,y,z,axis=0,material='leaf') => {
    if(axis===0){box(x,y,z,5,1,2,material);box(x+1,y+1,z,3,1,2,'leafLight');}
    else {box(x,y,z,2,1,5,material);box(x,y+1,z+1,2,1,3,'leafLight');}
  };
  const rock = (x,z,w,h,d,material='stone') => {
    box(x,0,z,w,1,d,'darkStone');box(x+1,1,z+1,Math.max(1,w-2),Math.max(1,h-2),Math.max(1,d-2),material);
    box(x+2,Math.max(2,h-1),z+2,Math.max(1,w-4),1,Math.max(1,d-4),material);
  };
  if(nodeType==='fallen_branch') {
    box(-8,0,-1,16,2,2,'bark');box(-7,2,-1,5,1,2,'bark');box(1,1,1,2,2,7,'bark');
    box(3,2,6,4,1,2,'bark');box(-8,0,-1,1,2,2,'heartwood');box(7,0,-1,1,2,2,'heartwood');
    leaf(4,2,6);leaf(-5,2,-4,1);
  } else if(nodeType==='loose_stone') {
    rock(-6,-4,7,4,6);rock(1,-2,6,5,7);rock(-3,3,5,3,4);
  } else if(nodeType==='fiber_patch') {
    for(let i=0;i<7;i++){const x=(i%3)*3-4,z=Math.floor(i/3)*3-3,h=7+(i%3)*2;
      box(x,0,z,1,h,1,'reed');box(x+1,3,z,1,h-4,1,'leaf');box(x+2,h-2,z,1,2,1,'fiber');
      box(x-2,2,z,2,1,2,'leaf');}
  } else if(nodeType==='berry_bush') {
    box(-1,0,-1,2,8,2,'bark');box(-5,4,-1,10,1,2,'bark');
    for(const [x,y,z] of [[-6,5,-3],[1,5,-3],[-4,8,1],[0,9,-2],[-4,3,3]]){
      box(x,y,z,6,2,5,'leaf');box(x+1,y+2,z+1,4,1,3,'leafLight');
      box(x,y+1,z+4,1,2,1,'berry');box(x+4,y+2,z+3,1,1,1,'berry');}
  } else if(nodeType==='herb_patch') {
    for(const [x,z] of [[-4,-2],[1,2],[-1,-5]]){
      box(x,0,z,1,6,1,'reed');leaf(x-4,1,z);leaf(x,3,z-2,1);box(x-1,6,z-1,3,1,3,'flower');box(x,7,z,1,1,1,'fiber');}
  } else if(nodeType==='seed_head' || nodeType==='acid_reed') {
    const acid=nodeType==='acid_reed';
    for(let i=0;i<5;i++){const x=(i%3)*4-4,z=Math.floor(i/3)*4-2,h=10+i*2;
      box(x,0,z,1,h,1,'reed');leaf(x-3,4,z);box(x-1,h,z-1,3,acid?4:5,3,acid?'acid':'fiber');
      if(!acid){box(x-2,h+1,z,1,3,1,'heartwood');box(x+2,h+2,z,1,2,1,'fiber');}
      else box(x+1,h-2,z+1,1,2,1,'sap');}
  } else if(nodeType==='sap_tap') {
    box(-3,0,-3,6,17,6,'bark');box(-2,17,-2,4,1,4,'heartwood');
    for(let k=0;k<3;k++)box(-4+k,2+k*4,3,2,4,1,'heartwood');
    box(0,7,3,2,4,1,'sap');box(0,4,4,1,3,1,'sap');
    box(-7,9,-1,5,2,2,'bark');leaf(-8,11,-2);leaf(2,12,0,1);
    for(const [x,z] of [[-5,-2],[2,-4],[-1,3]])box(x,0,z,3,2,3,'bark');
  } else if(['clay_bank','sand_bank','freshwater'].includes(nodeType)) {
    const water=nodeType==='freshwater',m=water?'water':nodeType==='clay_bank'?'clay':'sand';
    box(-8,0,-6,16,1,12,m);box(-6,1,-4,12,1,8,m);
    if(water){for(const [x,z,w,d] of [[-9,-6,2,12],[7,-6,2,12],[-7,-7,14,2],[-7,5,14,2]])box(x,0,z,w,2,d,'stone');}
    else {box(-4,2,-3,7,1,5,m);box(1,3,-2,4,1,3,m);box(-6,2,2,3,1,2,m);}
  } else {
    const ore={iron_ore:'iron',titanium_ore:'titanium',nickel_ore:'nickel',sulfur_deposit:'sulfur',mana_crystal_ore:'mana'}[nodeType];
    rock(-7,-5,14,7,10);
    if(nodeType==='mana_crystal_ore'){
      for(const [x,y,z,h] of [[-3,4,-1,8],[1,4,1,5],[3,3,-3,6]]){box(x,y,z,2,h,2,ore);box(x,y+h,z,1,1,1,ore);}
    }else{
      // Mineral seams visibly follow the host rock surface, with separated nodules.
      for(let k=0;k<5;k++){box(-4+k*2,3+(k%2),4,2,2,1,ore);box(-4+k*2,6,-2+(k%3),2,1,2,ore);}
      if(nodeType==='sulfur_deposit')for(let k=0;k<3;k++)box(-3+k*3,7,-1,2,2+k%2,2,ore);
    }
  }
  const asset=builder.toJSON();MODEL_CACHE.set(sourceId,asset);return asset;
}

export function isResourceAvailable(runtime,node) {
  const environmentId=runtime.atlas.sample(node.x,node.z).environmentId;
  const previous=runtime.progression.harvestClaims?.[`${environmentId}:${node.id}`];
  if(!previous)return true;
  if(previous.sourceId!==node.sourceId)return false;
  return Number.isFinite(node.regrowS)&&node.regrowS>0&&runtime.progression.clock+1e-8>=previous.at+node.regrowS;
}
/** Bounded, deterministic view only: no resources are spawned or granted here. */
export function getResourceDescriptors(runtime,{limit=48,radius=48}={}) {
  if(!Number.isFinite(limit)||!Number.isFinite(radius)||limit<0||radius<0)throw new RangeError('채집 표시 범위와 개수가 잘못되었습니다.');
  const p=runtime.player,budget=Math.min(96,Math.floor(limit)),seen=new Set();
  const nodes=(runtime.nodes??runtime.atlas.harvestNodesAround(p.x,p.z,radius))
    .filter(n=>{if(seen.has(n.id)||!TYPES[n.sourceId]||![n.x,n.y,n.z].every(Number.isFinite))return false;seen.add(n.id);return Math.hypot(n.x-p.x,n.z-p.z)<=radius&&isResourceAvailable(runtime,n);})
    .sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z)||a.id.localeCompare(b.id)).slice(0,budget);
  return nodes.map(node=>{const asset=buildResourceAsset(node.sourceId);return {id:node.id,assetId:asset.id,asset,kind:'resource',
    position:{x:node.x,y:node.y,z:node.z},sourceId:node.sourceId,resourceId:node.resourceId,interactable:true,node};});
}
