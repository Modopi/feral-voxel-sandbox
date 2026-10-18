// Deterministic, sparse expedition terrain. Legacy World and its saves are untouched.
export const ATLAS_VERSION = 1;
export const CELL_SIZE = 0.5;
export const CHUNK_CELLS = 32;
export const CHUNK_METRES = 16;
const CAP_COLUMNS = 8192, CAP_REGIONS = 128;
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const smooth = t=>t*t*(3-2*t);
const cellKey = (x,y,z)=>`${x},${y},${z}`;
const columnKey = (x,z)=>`${x},${z}`;
const floorDiv = (x,n)=>Math.floor(x/n);
const safeInteger = n=>Number.isSafeInteger(n);
const finitePosition = n=>Number.isFinite(n)&&Math.abs(n)<=Number.MAX_SAFE_INTEGER/4;
function memo(map,key,compute,limit){if(map.has(key))return map.get(key);const value=compute();map.set(key,value);if(map.size>limit)map.delete(map.keys().next().value);return value;}
const SHA_K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
const rotate=(x,n)=>(x>>>n)|(x<<(32-n));
const SHA_ENCODER=new TextEncoder(),SHA_WORDS=new Uint32Array(64);
let SHA_BYTES=new Uint8Array(1024),SHA_VIEW=new DataView(SHA_BYTES.buffer);
const SHA_INITIAL=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
const SHA_STATE=new Uint32Array(8);
export function deterministicUnit(seed,...parts){
  const text=JSON.stringify([String(seed),'expedition-atlas-v1',...parts]);
  if(text.length*3+72>SHA_BYTES.length){SHA_BYTES=new Uint8Array(2**Math.ceil(Math.log2(text.length*3+72)));SHA_VIEW=new DataView(SHA_BYTES.buffer);}
  const byteLength=SHA_ENCODER.encodeInto(text,SHA_BYTES).written,paddedLength=Math.ceil((byteLength+9)/64)*64;
  SHA_BYTES.fill(0,byteLength,paddedLength);SHA_BYTES[byteLength]=128;
  const view=SHA_VIEW;view.setUint32(paddedLength-8,Math.floor(byteLength/0x20000000));view.setUint32(paddedLength-4,byteLength*8);
  const h=SHA_STATE,w=SHA_WORDS;h.set(SHA_INITIAL);
  for(let offset=0;offset<paddedLength;offset+=64){
    for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);
    for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(rotate(x,7)^rotate(x,18)^(x>>>3))+w[i-16]+(rotate(y,17)^rotate(y,19)^(y>>>10))+w[i-7];}
    let [a,b,c,d,e,f,g,q]=h;
    for(let i=0;i<64;i++){const t1=(q+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+SHA_K[i]+w[i])>>>0,t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;q=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
    const v=[a,b,c,d,e,f,g,q];for(let i=0;i<8;i++)h[i]=(h[i]+v[i])>>>0;
  }
  return (h[0]*2097152+(h[1]>>>11))/9007199254740992;
}
function validatePosition(x,z){if(!finitePosition(x)||!finitePosition(z))throw new RangeError('Atlas position must be a finite, safely representable metre coordinate');}
function decodeCell(key){const p=String(key).split(',').map(Number);if(p.length!==3||!p.every(safeInteger))throw new Error('Invalid saved cell coordinate');return p;}

export class WorldAtlas {
  constructor(content, options={}) {
    if(!content?.environments?.entries||!content?.blocks?.entries)throw new TypeError('WorldAtlas needs CONTENT.environments and CONTENT.blocks');
    const state=options.state;
    if(state&&(state.schemaVersion!==ATLAS_VERSION||state.generator!==this.generatorId))throw new Error('Unsupported atlas save version');
    this.content=content;this.seed=String(state?.seed??options.seed??63026);
    this.environments=new Map(content.environments.entries.map(e=>[e.id,e]));
    this.blocks=new Map(content.blocks.entries.map(b=>[b.id,b]));
    this.palette=[null,...this.blocks.keys()];this.blockNumbers=new Map(this.palette.map((id,i)=>[id,i]));
    if(!Number.isFinite(options.maxActiveChunks??96))throw new TypeError('Invalid chunk limit');
    this.maxActiveChunks=clamp(Math.floor(options.maxActiveChunks??96),1,256);
    this.activeChunks=new Map();this.edits=new Map();this.columnEdits=new Map();this.chunkEdits=new Map();this.reservations=new Map();
    this._columns=new Map();this._ores=new Map();this._trees=new Map();this._patchGroups=new Map();this._samples=new Map();this._hashes=new Map();this._caves=new Map();this._noiseCorners=new Map();this._jobs=new Map();this.lastLoadWork={processedCells:0,completedChunks:0};
    this.pendingChunkCount=0;this.revision=0;this.onCellDestroyed=options.onCellDestroyed??null;
    this.rules=content.environments.world;
    this.fluidCells=new Map();this._fluidChunkKeys=new Map();this._fluidActive=new Set();this._flowCursor=0;this.burning=new Map();this.fuelRemaining=new Map();this.thermalCells=new Map();this.cellDamage=new Map();
    this.simulationTime=state?.simulationTime??0;this._simulationAccumulator=state?.simulationAccumulator??0;this._thermalCursor=state?.thermalCursor??0;this.environmentRevision=0;
    if(!Number.isFinite(this.simulationTime)||this.simulationTime<0||!Number.isFinite(this._simulationAccumulator)||this._simulationAccumulator<0)throw new Error('Invalid environmental clock');
    this.reactions={burnedCells:0,burnedMassKg:0,combustionEu:0,dissolvedCells:0,neutralizedAcidM3:0,evaporatedM3:0,evaporatedAcidM3:0,heatDissipatedEu:0,heatReactedEu:0,steamThermalEu:0,dissolvedMassKg:0,...state?.reactions};
    this._restoring=true;
    if(state){
      for(const r of state.reservations??[])this.reserveArea(r.id,r);
      for(const [key,id] of state.edits??[]){const [x,y,z]=decodeCell(key);this.setCell(x,y,z,id);}
      for(const [key,f]of state.fluidCells??[]){const p=decodeCell(key);if(![f.volumeM3,f.acidM3,f.thermalEu].every(Number.isFinite)||f.volumeM3<0||f.volumeM3>.125||f.acidM3<0||f.acidM3>f.volumeM3||f.thermalEu<0)throw new Error('Invalid saved fluid');this._storeFluid(...p,f);}
      for(const [field,target]of [['burning',this.burning],['fuelRemaining',this.fuelRemaining],['thermalCells',this.thermalCells],['cellDamage',this.cellDamage]])for(const [key,value]of state[field]??[]){decodeCell(key);target.set(key,value&&typeof value==='object'?{...value}:value);}
      this._flowCursor=state.flowCursor??0;
      if(state.fluidActive){this._fluidActive.clear();for(const key of state.fluidActive){decodeCell(key);if(this.fluidCells.get(key)?.volumeM3>1e-9)this._fluidActive.add(key);}}
      if(state.focus&&[state.focus.x,state.focus.z,state.focus.radius].every(Number.isFinite))this._focus={...state.focus};
    }
    this._restoring=false;
  }
  static fromState(content,state,options={}){return new this(content,{...options,state});}
  /** Map presets subclass the terrain generator; saves record which one made the world. */
  get generatorId(){return 'expedition-atlas-v1';}
  _rand(...parts){return memo(this._hashes,JSON.stringify(parts),()=>deterministicUnit(this.seed,...parts),32768);}
  _noise(x,z,scale,channel){const u=x/scale,v=z/scale,ix=Math.floor(u),iz=Math.floor(v),fx=smooth(u-ix),fz=smooth(v-iz);const [a,b,c,d]=memo(this._noiseCorners,`${channel}:${ix},${iz}`,()=>[this._rand(channel,ix,iz),this._rand(channel,ix+1,iz),this._rand(channel,ix,iz+1),this._rand(channel,ix+1,iz+1)],4096);return(a+(b-a)*fx)*(1-fz)+(c+(d-c)*fx)*fz;}
  _reservationAt(x,z){for(const r of [...this.reservations.values()].sort((a,b)=>a.id.localeCompare(b.id)))if(x>=r.minX&&x<r.maxX&&z>=r.minZ&&z<r.maxZ)return r;return null;}
  reserveArea(id,r){
    if(typeof id!=='string'||!id||!r||![r.minX,r.maxX,r.minZ,r.maxZ,r.height].every(finitePosition)||r.minX>=r.maxX||r.minZ>=r.maxZ)throw new TypeError('Invalid terrain reservation');
    const next={id,minX:r.minX,maxX:r.maxX,minZ:r.minZ,maxZ:r.maxZ,height:Math.round(r.height*2)/2};
    if(JSON.stringify(this.reservations.get(id))===JSON.stringify(next))return false;
    const previous=this.reservations.get(id);
    this.reservations.set(id,next);this._columns.clear();this._samples.clear();this._trees.clear();this._ores.clear();this._caves.clear();
    for(const [key,c] of this.activeChunks)if([r,previous].filter(Boolean).some(q=>c.cx*16<q.maxX&&(c.cx+1)*16>q.minX&&c.cz*16<q.maxZ&&(c.cz+1)*16>q.minZ))this.activeChunks.delete(key);
    for(const c of this.activeChunks.values())if([r,previous].filter(Boolean).some(q=>c.cx*16<q.maxX+.5&&(c.cx+1)*16>q.minX-.5&&c.cz*16<q.maxZ+.5&&(c.cz+1)*16>q.minZ-.5))c.revision=this.revision+1;
    this._jobs.clear();this._loadPlan=null;this.revision++;return true;
  }
  _baseTier(x,z){const r=Math.hypot(x,z);for(const band of this.rules.difficulty.radialBands){if(r>=band.minM&&(band.maxM===null||r<band.maxM)){if(band.tier)return band.tier;const roll=this._rand('tier',floorDiv(x,256),floorDiv(z,256));let cumulative=0;for(const [tier,w] of Object.entries(band.tierWeights)){cumulative+=w;if(roll<cumulative)return Number(tier);}}}return 5;}
  _anchorTier(cx,cz){for(const row of this.rules.difficulty.patchTiers){const n=Math.ceil((row.minimumRadiusM+256)/512);if((cx===n&&cz===0)||(cx===-n-1&&cz===0)||(cz===n&&cx===0)||(cz===-n-1&&cx===0))return row.tier;}return null;}
  _patchForRegion(cx,cz){const minimum=this.rules.difficulty.patchTiers[0].minimumRadiusM;if(Math.hypot(Math.max(Math.abs(cx*512),Math.abs((cx+1)*512)),Math.max(Math.abs(cz*512),Math.abs((cz+1)*512)))<minimum)return null;const gx=floorDiv(cx,8),gz=floorDiv(cz,8);const group=memo(this._patchGroups,columnKey(gx,gz),()=>{
    const candidates=[];
    for(let z=gz*8;z<gz*8+8;z++)for(let x=gx*8;x<gx*8+8;x++){
      if(Math.hypot(Math.max(Math.abs(x*512),Math.abs((x+1)*512)),Math.max(Math.abs(z*512),Math.abs((z+1)*512)))<minimum)continue;
      const forced=this._anchorTier(x,z),px=x*512+256+(this._rand('patch-x',x,z)-.5)*128,pz=z*512+256+(this._rand('patch-z',x,z)-.5)*128;
      const r=Math.hypot(px,pz),ratio=Math.min(Math.abs(px),Math.abs(pz))/Math.max(1,Math.abs(px),Math.abs(pz));
      if(!forced&&(ratio>Math.tan(25*Math.PI/180)||this._rand('patch-exists',x,z)>=.2))continue;
      const allowed=this.rules.difficulty.patchTiers.filter(p=>r>=p.minimumRadiusM);if(!allowed.length)continue;
      const tier=forced??allowed[Math.floor(this._rand('patch-tier',x,z)*allowed.length)].tier;
      if(!allowed.some(p=>p.tier===tier))continue;
      candidates.push({id:`patch:${x},${z}`,cx:x,cz:z,x:px,z:pz,radius:64+Math.floor(this._rand('patch-radius',x,z)*33),tier,forced:!!forced,priority:this._rand('patch-priority',x,z)});
    }
    candidates.sort((a,b)=>Number(b.forced)-Number(a.forced)||a.priority-b.priority);
    const result=new Map();let area=0;for(const c of candidates){const a=Math.PI*c.radius*c.radius;if(area+a<=4096*4096*.06){result.set(columnKey(c.cx,c.cz),c);area+=a;}}return result;
    },CAP_REGIONS);return group.get(columnKey(cx,cz))??null;}
  _climateAt(x,z){
    const moisture=this._noise(x,z,1024,'moisture'),geology=this._noise(x,z,512,'geology'),mana=this._noise(x,z,512,'mana'),elevation=this._noise(x,z,256,'height'),detail=this._noise(x,z,32,'detail'),continent=this._noise(x,z,4096,'continent');
    const rawElevation=-16+112*elevation+16*detail,coastDistance=(continent-.22)*4096;
    let environmentId='grove';
    if(Math.hypot(x,z)>=128){
      if(coastDistance<128||rawElevation>64&&moisture<.5)environmentId='coast';
      else if(geology>.90)environmentId='thermal';
      else if(moisture>.80&&rawElevation<6)environmentId='marsh';
      else if(mana>.75&&moisture>.50)environmentId='mana_grove';
      else if(moisture<.45||rawElevation>48)environmentId='ridge';
    }
    return{moisture,geology,mana,elevation,detail,continent,environmentId};
  }
  _rawSample(x,z){
    const radius=Math.hypot(x,z),climate=this._climateAt(x,z),{moisture,geology,mana,elevation,continent}=climate,baseEnvironmentId=climate.environmentId;
    const cx=floorDiv(x,512),cz=floorDiv(z,512),patch=this._patchForRegion(cx,cz);
    const localX=x-cx*512,localZ=z-cz*512;
    let safeBypass=false,patchDistance=Infinity;
    if(radius>=64){
      // Six-metre half-width safe lanes join region edges and a twelve-metre ring.
      safeBypass=Math.min(localX,512-localX,localZ,512-localZ)<=6;
      if(patch){patchDistance=Math.hypot(x-patch.x,z-patch.z);const ring=patch.radius+48;safeBypass ||= Math.abs(patchDistance-ring)<=6 || (patchDistance>=ring&& (Math.abs(x-patch.x)<=6||Math.abs(z-patch.z)<=6));}
    }
    let environmentId=baseEnvironmentId;
    const ox=cx*512+256,oz=cz*512+256,overlayDistance=Math.hypot(x-ox,z-oz);
    if(radius>=128&&overlayDistance<48+this._rand('overlay-radius',cx,cz)*48){const overlayRoll=this._rand('overlay',cx,cz);if(overlayRoll<.08)environmentId='sacred';else if(radius>=1536&&overlayRoll<.12)environmentId='anomaly';}
    const baseTier=this._baseTier(x,z),insidePatch=patch&&patchDistance<=patch.radius&&!safeBypass;
    const e=this.environments.get(baseEnvironmentId),range=e.terrain.heightAboveSeaM;
    const fraction=.7*elevation+.2*climate.detail+.1*this._noise(x,z,8,'micro');
    let h=range[0]+(range[1]-range[0])*fraction;
    // Thirty-two-metre neighbourhood blend avoids biome-height discontinuities.
    let blended=h,weight=1;
    for(const [dx,dz]of [[-16,0],[16,0],[0,-16],[0,16]]){
      const other=this._climateAt(x+dx,z+dz).environmentId;
      if(other!==baseEnvironmentId){const r=this.environments.get(other).terrain.heightAboveSeaM;blended+=(r[0]+(r[1]-r[0])*fraction)*.25;weight+=.25;}
    }
    h=blended/weight;
    if(baseEnvironmentId==='coast'&&continent<.24)h=-4+this._noise(x,z,64,'seabed')*3;
    if(baseEnvironmentId==='marsh')h=moisture>.76?-1.5:Math.floor(h/2)*2;
    if(baseEnvironmentId==='thermal')h=Math.floor(h/4)*4;
    const stream=Math.abs(this._noise(x,z,256,'river')-.5)<.018;
    if(radius>64&&stream)h=-1.5;
    // Guaranteed nearby fresh water, outside the initial hostile-free dry area.
    const starterPond=Math.hypot(x-80,z-24)<6;if(starterPond)h=-1;
    if(radius<64)h=4;
    else if(radius<96&&!starterPond&&!stream){const t=smooth((radius-64)/32);h=4+(h-4)*t;}
    if(safeBypass)h=4;
    const reservation=this._reservationAt(x,z);if(reservation)h=reservation.height;
    h=Math.round(h*2)/2;
    const hasWater=h<0&&!reservation&&!safeBypass;
    const acid=hasWater&&!starterPond&&baseEnvironmentId==='marsh'&&this._rand('acid',floorDiv(x,16),floorDiv(z,16))<.12;
    return {environmentId,baseEnvironmentId,tier:insidePatch?patch.tier:baseTier,baseTier,height:h,waterLevel:hasWater?0:null,waterType:hasWater?(acid?'acid':'water'):null,safeBypass,hostileSpawnsAllowed:radius>=64&&!safeBypass&&!reservation,highTierPatchId:insidePatch?patch.id:null,nearbyPatch:patch?{id:patch.id,x:patch.x,z:patch.z,radius:patch.radius,tier:patch.tier}:null,ecologyCellId:`eco:${floorDiv(x,64)},${floorDiv(z,64)}`,reservedBy:reservation?.id??null};
  }
  sample(x,z){validatePosition(x,z);const hx=Math.floor(x*2),hz=Math.floor(z*2);const s=memo(this._samples,columnKey(hx,hz),()=>this._rawSample(hx*.5+.25,hz*.5+.25),CAP_COLUMNS);const e=this.environments.get(s.environmentId);return {...s,spawnRules:e.spawning.rules,harvestNodeIds:e.harvestNodeIds};}
  spawnTable(environmentId,{hostEnvironmentId='grove'}={}){const e=this.environments.get(environmentId);if(!e)throw new Error('Unknown environment');const host=this.environments.get(hostEnvironmentId);return {environmentId,ecologyCellSizeM:64,...e.spawning,totalCap:e.spawning.totalCap??Math.floor((host?.spawning.totalCap??14)*e.spawning.overlayBudgetFraction),hostEnvironmentId:e.mode==='overlay'?hostEnvironmentId:null};}
  _column(hx,hz){return memo(this._columns,columnKey(hx,hz),()=>{
    const s=this.sample(hx*.5,hz*.5),e=this.environments.get(s.baseEnvironmentId),surfaceId=e.terrain.surfaceBlockId;
    const surface=this.blocks.get(surfaceId)?.collision?surfaceId:e.terrain.subsoilBlockId;
    return {...s,topCell:Math.round(s.height*2)-1,surface,subsoil:e.terrain.subsoilBlockId,bedrock:e.terrain.bedrockBlockId,soilCells:Math.max(1,Math.round(2*(e.terrain.soilThicknessM[0]+this._rand('soil-depth',floorDiv(hx,16),floorDiv(hz,16))*(e.terrain.soilThicknessM[1]-e.terrain.soilThicknessM[0]))))};
  },CAP_COLUMNS);}
  _oreMap(ecx,ecz){return memo(this._ores,columnKey(ecx,ecz),()=>{
    const map=new Map(),env=this.environments.get(this.sample(ecx*64+32,ecz*64+32).baseEnvironmentId);
    for(const vein of env.oreVeins){for(let i=0;i<vein.veinsPer4096M2;i++){
      const tag=`${vein.blockId}:${i}`,x0=ecx*128+16+Math.floor(this._rand('ore-x',ecx,ecz,tag)*96),z0=ecz*128+16+Math.floor(this._rand('ore-z',ecx,ecz,tag)*96);
      let x=x0,z=z0,y=Math.round(this._column(x,z).height*2)-Math.round(2*(vein.depthBelowSurfaceM[0]+this._rand('ore-depth',ecx,ecz,tag)*(vein.depthBelowSurfaceM[1]-vein.depthBelowSurfaceM[0])));
      const count=vein.veinCellCount[0]+Math.floor(this._rand('ore-count',ecx,ecz,tag)*(vein.veinCellCount[1]-vein.veinCellCount[0]+1));
      for(let j=0;j<count*4&&map.size<1024;j++){
        const c=this._column(x,z);if(y<c.topCell-c.soilCells)map.set(cellKey(x,y,z),vein.blockId);
        if(j>=count-1)break;
        const axis=Math.floor(this._rand('ore-step',ecx,ecz,tag,j)*6),d=axis%2?1:-1;
        if(axis<2)x=clamp(x+d,ecx*128+1,ecx*128+126);else if(axis<4)y+=d;else z=clamp(z+d,ecz*128+1,ecz*128+126);
      }
    }}return map;
  },CAP_REGIONS);}
  _treeAt(tx,tz){return memo(this._trees,columnKey(tx,tz),()=>{
    const x=tx*8+2+Math.floor(this._rand('tree-x',tx,tz)*8)*.5,z=tz*8+2+Math.floor(this._rand('tree-z',tx,tz)*8)*.5,s=this.sample(x,z);
    if(s.reservedBy||s.safeBypass||s.waterLevel!==null||Math.hypot(x,z)<12)return null;
    const host=this.environments.get(s.baseEnvironmentId),d=host.decoration;
    if(this._rand('tree-exists',tx,tz)>=d.treesPer1024M2/16)return null;
    const range=d.treeHeightM,height=range[0]+Math.floor(this._rand('tree-height',tx,tz)*(range[1]-range[0]+1));
    return{x,z,base:s.height,height,log:s.baseEnvironmentId==='mana_grove'?'mana_log':'log'};
  },2048);}
  _vegetationAt(hx,hy,hz,c){
    if(c.reservedBy||c.safeBypass)return null;
    const x=hx*.5+.25,y=hy*.5+.25,z=hz*.5+.25;
    for(let tz=floorDiv(z-2,8);tz<=floorDiv(z+2,8);tz++)for(let tx=floorDiv(x-2,8);tx<=floorDiv(x+2,8);tx++){
      const tree=this._treeAt(tx,tz);if(!tree)continue;
      if(Math.abs(x-tree.x)<=.5&&Math.abs(z-tree.z)<=.5&&y>=tree.base&&y<tree.base+tree.height)return tree.log;
      if(Math.abs(x-tree.x)<=2&&Math.abs(z-tree.z)<=2&&y>=tree.base+tree.height-1&&y<tree.base+tree.height+1&&Math.abs(x-tree.x)+Math.abs(z-tree.z)<3.5)return'leaves';
    }
    if(hy===c.topCell+1&&c.waterLevel===null&&this._rand('plant',hx,hz)<.12){const e=this.environments.get(c.environmentId);return e.decoration.blockIds.find(id=>this.blocks.get(id)?.kind==='vegetation')??null;}
    return null;
  }
  _caveAt(hx,hy,hz,column){
    if(column.reservedBy||column.safeBypass||hy>column.topCell-6)return false;
    const ex=floorDiv(hx,128),ez=floorDiv(hz,128);
    const cave=memo(this._caves,columnKey(ex,ez),()=>{
      const x=ex*64+32,z=ez*64+32,s=this.sample(x,z),p=this.environments.get(s.baseEnvironmentId).pattern;
      if(this._rand('cave-exists',ex,ez)>=p.caveChancePerCell)return null;
      const angle=this._rand('cave-angle',ex,ez)*Math.PI*2,length=16+this._rand('cave-length',ex,ez)*16;
      const depth=p.caveDepthM[0]+this._rand('cave-depth',ex,ez)*(p.caveDepthM[1]-p.caveDepthM[0]);
      return{x,z,y:s.height-depth,dx:Math.cos(angle)*length/2,dz:Math.sin(angle)*length/2,radius:p.caveRadiusM[0]+this._rand('cave-radius',ex,ez)*(p.caveRadiusM[1]-p.caveRadiusM[0])};
    },CAP_REGIONS);
    if(!cave)return false;
    const x=hx*.5+.25,y=hy*.5+.25,z=hz*.5+.25,dx=x-cave.x,dz=z-cave.z,t=clamp((dx*cave.dx+dz*cave.dz)/(cave.dx*cave.dx+cave.dz*cave.dz),-1,1);
    return(dx-t*cave.dx)**2+(dz-t*cave.dz)**2+(y-cave.y)**2<cave.radius*cave.radius;
  }
  _baseCell(hx,hy,hz){const c=this._column(hx,hz);if(hy>c.topCell){if(hy>c.topCell+24)return null;return this._vegetationAt(hx,hy,hz,c);}if(hy===c.topCell)return c.surface;if(this._caveAt(hx,hy,hz,c))return null;if(hy>=c.topCell-c.soilCells)return c.subsoil;return this._oreMap(floorDiv(hx,128),floorDiv(hz,128)).get(cellKey(hx,hy,hz))??c.bedrock;}
  getCell(hx,hy,hz){if(![hx,hy,hz].every(safeInteger))throw new RangeError('Cell coordinates must be safe integers');const key=cellKey(hx,hy,hz);if(this.edits.has(key))return this.edits.get(key);const cx=floorDiv(hx,32),cy=floorDiv(hy,32),cz=floorDiv(hz,32),chunk=this.activeChunks.get(cellKey(cx,cy,cz));if(chunk)return this.palette[chunk.blocks[(hx-cx*32)+(hz-cz*32)*32+(hy-cy*32)*1024]];return this._baseCell(hx,hy,hz);}
  isSolidCell(hx,hy,hz){const id=this.getCell(hx,hy,hz);return id!==null&&this.blocks.get(id)?.collision!==false;}
  setCell(hx,hy,hz,id){
    if(![hx,hy,hz].every(safeInteger)||id!==null&&!this.blocks.has(id))throw new TypeError('Invalid edited voxel');
    const key=cellKey(hx,hy,hz);if(this.edits.has(key)&&this.edits.get(key)===id)return false;
    if(!this._restoring&&id!==null&&this._fluidState(hx,hy,hz).volumeM3>1e-9)return false;
    if((this.burning.has(key)||this.fuelRemaining.has(key)||this.cellDamage.has(key)||this.thermalCells.has(key))&&this.getCell(hx,hy,hz)!==id){this.burning.delete(key);this.fuelRemaining.delete(key);this.cellDamage.delete(key);this.thermalCells.delete(key);}
    if(((hx%32)+32)%32===16&&((hz%32)+32)%32===16)this._loadPlan=null;
    this.edits.set(key,id);const chunkKey=cellKey(floorDiv(hx,32),floorDiv(hy,32),floorDiv(hz,32));if(!this.chunkEdits.has(chunkKey))this.chunkEdits.set(chunkKey,new Map());this.chunkEdits.get(chunkKey).set(key,id);
    const ck=columnKey(hx,hz);if(!this.columnEdits.has(ck))this.columnEdits.set(ck,new Map());this.columnEdits.get(ck).set(hy,id);
    const cx=floorDiv(hx,32),cy=floorDiv(hy,32),cz=floorDiv(hz,32),chunk=this.activeChunks.get(cellKey(cx,cy,cz));if(chunk){chunk.blocks[(hx-cx*32)+(hz-cz*32)*32+(hy-cy*32)*1024]=this.blockNumbers.get(id);chunk.revision=++this.revision;}else this.revision++;
    // Exposed faces belong to both chunks at a seam. A neighbor can have no voxel
    // edits of its own and still need a mesh rebuild after this edit.
    for(const [dx,dy,dz]of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){const nx=floorDiv(hx+dx,32),ny=floorDiv(hy+dy,32),nz=floorDiv(hz+dz,32);if(nx===cx&&ny===cy&&nz===cz)continue;const neighbor=this.activeChunks.get(cellKey(nx,ny,nz));if(neighbor)neighbor.revision=this.revision;}
    if(!this._restoring&&id===null)this._wakeFluidNeighbors(hx,hy,hz);return true;
  }
  heightAt(x,z){validatePosition(x,z);const hx=Math.floor(x*2),hz=Math.floor(z*2),c=this._column(hx,hz),edits=this.columnEdits.get(columnKey(hx,hz));if(!edits)return c.height;let y=c.topCell;for(const [hy,id]of edits)if(id!==null&&this.blocks.get(id)?.collision!==false)y=Math.max(y,hy);while(edits.has(y)&&(edits.get(y)===null||this.blocks.get(edits.get(y))?.collision===false))y--;return(y+1)*.5;}
  _naturalFluid(hx,hy,hz){
    const s=this._column(hx,hz);if(s.waterLevel===null||hy*.5>=s.waterLevel||(hy+1)*.5<=s.height||this.isSolidCell(hx,hy,hz))return{volumeM3:0,acidM3:0,thermalEu:0};
    const volumeM3=Math.max(0,Math.min((hy+1)*.5,s.waterLevel)-Math.max(hy*.5,s.height))*.25;
    return{volumeM3,acidM3:s.waterType==='acid'?volumeM3*.45:0,thermalEu:0};
  }
  _fluidState(hx,hy,hz){const key=cellKey(hx,hy,hz);return this.fluidCells.get(key)??this._naturalFluid(hx,hy,hz);}
  _simulationNear(hx,hz){return !this._focus||Math.abs(hx*.5-this._focus.x)<=this._focus.radius&&Math.abs(hz*.5-this._focus.z)<=this._focus.radius;}
  _storeFluid(hx,hy,hz,state){
    const key=cellKey(hx,hy,hz),v=clamp(state.volumeM3,0,.125);
    const f={volumeM3:v,acidM3:clamp(state.acidM3,0,v),thermalEu:Math.max(0,state.thermalEu)};
    this.fluidCells.set(key,f);const ck=cellKey(floorDiv(hx,32),floorDiv(hy,32),floorDiv(hz,32));if(!this._fluidChunkKeys.has(ck))this._fluidChunkKeys.set(ck,new Set());this._fluidChunkKeys.get(ck).add(key); // Zero is a persistent depletion tombstone, never regenerate it.
    if(v>1e-9&&this._simulationNear(hx,hz)&&this._fluidActive.size<2048)this._fluidActive.add(key);else if(v<=1e-9)this._fluidActive.delete(key);
    this.environmentRevision++;return f;
  }
  _wakeFluidNeighbors(hx,hy,hz){for(const [dx,dy,dz]of [[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){const x=hx+dx,y=hy+dy,z=hz+dz;if(this.isSolidCell(x,y,z))continue;const f=this._fluidState(x,y,z);if(f.volumeM3>1e-9)this._storeFluid(x,y,z,f);}}
  fluidAt(x,y,z){
    validatePosition(x,z);if(!finitePosition(y))throw new RangeError('Invalid fluid query height');
    const hx=Math.floor(x*2),hy=Math.floor(y*2),hz=Math.floor(z*2),f=this._fluidState(hx,hy,hz);if(f.volumeM3<=1e-9||this.isSolidCell(hx,hy,hz))return null;
    const top=hy*.5+f.volumeM3/.25;if(y>=top)return null;
    return{type:f.acidM3/f.volumeM3>.3?'acid':'water',depth:top-y,volumeM3:f.volumeM3,acidFraction:f.acidM3/f.volumeM3,temperatureC:20+f.thermalEu/(4000*f.volumeM3)};
  }
  pour(x,y,z,volumeM3,{acidFraction=0,temperatureC=20}={}){
    validatePosition(x,z);if(!finitePosition(y)||!Number.isFinite(volumeM3)||volumeM3<0||!Number.isFinite(acidFraction)||acidFraction<0||acidFraction>1||!Number.isFinite(temperatureC)||temperatureC<20||temperatureC>2000)throw new RangeError('Invalid fluid addition');
    const hx=Math.floor(x*2),hy=Math.floor(y*2),hz=Math.floor(z*2);let left=volumeM3;
    for(const [dx,dy,dz]of [[0,0,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0],[1,1,0],[-1,1,0],[0,1,1],[0,1,-1]]){
      if(left<=1e-9)break;const xx=hx+dx,yy=hy+dy,zz=hz+dz;if(this.isSolidCell(xx,yy,zz))continue;
      const f=this._fluidState(xx,yy,zz),added=Math.min(left,.125-f.volumeM3);if(added<=0)continue;
      this._storeFluid(xx,yy,zz,{volumeM3:f.volumeM3+added,acidM3:f.acidM3+added*acidFraction,thermalEu:f.thermalEu+added*4000*(temperatureC-20)});left-=added;
    }
    return volumeM3-left;
  }
  takeFluid(x,y,z,volumeM3){
    validatePosition(x,z);if(!finitePosition(y)||!Number.isFinite(volumeM3)||volumeM3<0)throw new RangeError('Invalid fluid withdrawal');
    const hx=Math.floor(x*2),hy=Math.floor(y*2),hz=Math.floor(z*2),f=this._fluidState(hx,hy,hz),taken=Math.min(volumeM3,f.volumeM3);
    if(taken<=0)return{volumeM3:0,acidFraction:0,temperatureC:20};
    const fraction=taken/f.volumeM3,result={volumeM3:taken,acidFraction:f.acidM3/f.volumeM3,temperatureC:20+f.thermalEu/(4000*f.volumeM3)};
    this._storeFluid(hx,hy,hz,{volumeM3:f.volumeM3-taken,acidM3:f.acidM3*(1-fraction),thermalEu:f.thermalEu*(1-fraction)});this._wakeFluidNeighbors(hx,hy,hz);return result;
  }
  _transferFluid(from,to,requested){
    if(this.isSolidCell(...to)||!this._simulationNear(to[0],to[2]))return 0;
    const a=this._fluidState(...from),b=this._fluidState(...to),m=Math.min(a.volumeM3,.125-b.volumeM3,Math.max(0,requested));if(m<=1e-9)return 0;
    const ratio=m/a.volumeM3,acid=a.acidM3*ratio,heat=a.thermalEu*ratio;
    this._storeFluid(...from,{volumeM3:a.volumeM3-m,acidM3:a.acidM3-acid,thermalEu:a.thermalEu-heat});
    this._storeFluid(...to,{volumeM3:b.volumeM3+m,acidM3:b.acidM3+acid,thermalEu:b.thermalEu+heat});return m;
  }
  _damageTerrain(hx,hy,hz,damageHp){
    if(!(damageHp>0))return false;const key=cellKey(hx,hy,hz),id=this.getCell(hx,hy,hz),b=this.blocks.get(id);if(!b)return false;
    const previous=this.cellDamage.get(key),damage=(previous?.blockId===id?previous.damageHp:0)+damageHp;
    if(damage>=b.durabilityHpPerCell){this.setCell(hx,hy,hz,null);this.cellDamage.delete(key);this.onCellDestroyed?.([hx,hy,hz]);return true;}
    this.cellDamage.set(key,{blockId:id,damageHp:damage});return false;
  }
  _flowStep(dt){
    const keys=[...this._fluidActive];if(!keys.length)return;
    const count=Math.min(128,keys.length),offset=Math.floor(this.simulationTime*10)%4;
    for(let i=0;i<count;i++){
      const key=keys[(this._flowCursor+i)%keys.length],[x,y,z]=decodeCell(key);
      if(!this._simulationNear(x,z)){this._fluidActive.delete(key);continue;}
      let f=this._fluidState(x,y,z);if(f.volumeM3<=1e-9){this._fluidActive.delete(key);continue;}
      this._transferFluid([x,y,z],[x,y-1,z],f.volumeM3);
      for(let j=0;j<4;j++){const [dx,dz]=[[1,0],[0,1],[-1,0],[0,-1]][(j+offset)%4];f=this._fluidState(x,y,z);const other=this._fluidState(x+dx,y,z+dz);this._transferFluid([x,y,z],[x+dx,y,z+dz],(f.volumeM3-other.volumeM3)*.23);}
      f=this._fluidState(x,y,z);if(f.volumeM3<=1e-9)continue;
      for(const [dx,dy,dz]of [[0,0,0],[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]]){
        const xx=x+dx,yy=y+dy,zz=z+dz,k=cellKey(xx,yy,zz),b=this.blocks.get(this.getCell(xx,yy,zz));
        if(f.volumeM3>.01)this.burning.delete(k);
        if(b&&f.acidM3/f.volumeM3>.3){
          const potential=(f.acidM3/f.volumeM3)*(1-b.acidResistance)*8*dt*Math.min(1,f.volumeM3/.025),damage=Math.min(potential,f.acidM3/.00001),spent=damage*.00001;
          if(this._damageTerrain(xx,yy,zz,damage)){this.reactions.dissolvedCells++;this.reactions.dissolvedMassKg+=b.massPerCellKg;}
          f={...f,acidM3:f.acidM3-spent};this.reactions.neutralizedAcidM3+=spent;
        }
      }
      const sensible=4000*f.volumeM3*80;
      if(f.thermalEu>sensible){const evaporated=Math.min(f.volumeM3,(f.thermalEu-sensible)/225000),r=evaporated/f.volumeM3;this.reactions.evaporatedM3+=evaporated;this.reactions.evaporatedAcidM3+=f.acidM3*r;this.reactions.steamThermalEu+=evaporated*225000+(f.thermalEu-evaporated*225000)*r;f={volumeM3:f.volumeM3-evaporated,acidM3:f.acidM3*(1-r),thermalEu:Math.max(0,(f.thermalEu-evaporated*225000)*(1-r))};}
      this._storeFluid(x,y,z,f);
    }
    this._flowCursor=(this._flowCursor+count)%Math.max(1,keys.length);
  }
  temperatureAtCell(hx,hy,hz){const key=cellKey(hx,hy,hz),b=this.blocks.get(this.getCell(hx,hy,hz)),t=this.thermalCells.get(key);if(!b||!t)return 20;return 20+t.energyEu*Math.exp(-.04*(this.simulationTime-t.updatedAt))/(Math.max(.05,b.massPerCellKg*.02));}
  applyThermalEnergy(hx,hy,hz,energyEu){
    if(![hx,hy,hz].every(safeInteger)||!Number.isFinite(energyEu)||energyEu<0)throw new RangeError('Invalid thermal energy');
    const fluid=this._fluidState(hx,hy,hz);if(fluid.volumeM3>1e-9){this._storeFluid(hx,hy,hz,{...fluid,thermalEu:fluid.thermalEu+energyEu});return energyEu;}
    const b=this.blocks.get(this.getCell(hx,hy,hz));if(!b){this.reactions.heatDissipatedEu+=energyEu;return 0;}
    const key=cellKey(hx,hy,hz),old=this.thermalCells.get(key),remaining=old?old.energyEu*Math.exp(-.04*(this.simulationTime-old.updatedAt)):0;
    if(old)this.reactions.heatDissipatedEu+=old.energyEu-remaining;
    this.thermalCells.set(key,{energyEu:remaining+energyEu,updatedAt:this.simulationTime});
    if(b.flammable&&this.temperatureAtCell(hx,hy,hz)>=b.ignitionTemperatureC)this.igniteCell(hx,hy,hz);
    return energyEu;
  }
  igniteCell(hx,hy,hz){
    if(![hx,hy,hz].every(safeInteger))throw new RangeError('Invalid ignition cell');const key=cellKey(hx,hy,hz),id=this.getCell(hx,hy,hz),b=this.blocks.get(id);
    if(!b?.flammable||this.burning.has(key)||this._fluidState(hx,hy,hz).volumeM3>.01)return false;
    const full=b.massPerCellKg*50,remaining=this.fuelRemaining.get(key)??full;if(remaining<=1e-9)return false;
    const duration=b.kind==='wood'?8:b.kind==='vegetation'?3:4;
    this.fuelRemaining.set(key,remaining);this.burning.set(key,{blockId:id,remainingS:duration*remaining/full,rateEuPerSecond:full/duration});this.environmentRevision++;return true;
  }
  _fireStep(dt){
    for(const [key,fire]of [...this.burning].slice(0,128)){
      const [x,y,z]=decodeCell(key);if(!this._simulationNear(x,z))continue;
      if(this.getCell(x,y,z)!==fire.blockId){this.burning.delete(key);continue;}
      if(this._fluidState(x,y,z).volumeM3>.01){this.burning.delete(key);continue;}
      const fuel=this.fuelRemaining.get(key)??0,burned=Math.min(fuel,fire.rateEuPerSecond*Math.min(dt,fire.remainingS));this.fuelRemaining.set(key,fuel-burned);fire.remainingS=Math.max(0,fire.remainingS-dt);
      const share=burned*.65/6;for(const [dx,dy,dz]of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]])this.applyThermalEnergy(x+dx,y+dy,z+dz,share);
      this.reactions.heatDissipatedEu+=burned*.35;this.reactions.combustionEu+=burned;
      if(fire.remainingS<=1e-9||fuel-burned<=1e-9){this.reactions.burnedMassKg+=this.blocks.get(fire.blockId).massPerCellKg;this.setCell(x,y,z,null);this.burning.delete(key);this.reactions.burnedCells++;this.onCellDestroyed?.([x,y,z]);}
    }
  }
  _thermalStep(dt){
    const keys=[...this.thermalCells.keys()];if(!keys.length)return;const count=Math.min(128,keys.length);
    for(let i=0;i<count;i++){
      const key=keys[(this._thermalCursor+i)%keys.length],[x,y,z]=decodeCell(key),entry=this.thermalCells.get(key),b=this.blocks.get(this.getCell(x,y,z));
      if(!b){this.reactions.heatDissipatedEu+=entry.energyEu;this.thermalCells.delete(key);continue;}
      if(!this._simulationNear(x,z))continue;
      const energy=entry.energyEu*Math.exp(-.04*(this.simulationTime-entry.updatedAt)),capacity=Math.max(.05,b.massPerCellKg*.02),temperature=20+energy/capacity;
      this.reactions.heatDissipatedEu+=entry.energyEu-energy;
      const reacted=Math.min(energy,Math.max(0,temperature-b.heatToleranceC)*capacity*.05*dt);
      this.reactions.heatReactedEu+=reacted;
      const destroyed=this._damageTerrain(x,y,z,reacted/2);
      if(!destroyed&&energy-reacted>1e-8)this.thermalCells.set(key,{energyEu:energy-reacted,updatedAt:this.simulationTime});else{this.reactions.heatDissipatedEu+=energy-reacted;this.thermalCells.delete(key);}
    }
    this._thermalCursor=(this._thermalCursor+count)%Math.max(1,keys.length);
  }
  tick(dt){
    if(!Number.isFinite(dt)||dt<0)throw new RangeError('Invalid atlas simulation duration');this._simulationAccumulator+=dt;let steps=0;
    while(this._simulationAccumulator>=.1-1e-10&&steps<8){this._simulationAccumulator=Math.max(0,this._simulationAccumulator-.1);this.simulationTime+=.1;this._flowStep(.1);this._fireStep(.1);this._thermalStep(.1);steps++;}
    return{steps,pendingSeconds:this._simulationAccumulator,fluidCells:this._fluidActive.size,burningCells:this.burning.size,environmentRevision:this.environmentRevision};
  }
  fluidTotals(){let volumeM3=0,acidM3=0,thermalEu=0;for(const f of this.fluidCells.values()){volumeM3+=f.volumeM3;acidM3+=f.acidM3;thermalEu+=f.thermalEu;}return{volumeM3,acidM3,thermalEu,scope:'materialized_cells_only'};}
  _newChunkJob(cx,cy,cz){return{key:cellKey(cx,cy,cz),cx,cy,cz,size:32,cellSize:CELL_SIZE,blocks:new Uint16Array(32768),palette:this.palette,revision:this.revision,cursor:0,columnIndex:-1,column:null,flora:null};}
  _advanceChunk(job,limit,deadline=Infinity){
    let processed=0;
    while(job.cursor<32768&&processed<limit){
      if((processed&63)===0&&performance.now()>=deadline)break;
      const col=Math.floor(job.cursor/32),y=job.cursor%32,x=col%32,z=Math.floor(col/32),hx=job.cx*32+x,hy=job.cy*32+y,hz=job.cz*32+z;
      if(job.columnIndex!==col){job.columnIndex=col;job.column=this._column(hx,hz);job.flora=new Map();const c=job.column;
        const low=Math.max(job.cy*32,c.topCell+1),high=Math.min(job.cy*32+31,c.topCell+24);
        for(let yy=low;yy<=high;yy++){const id=this._vegetationAt(hx,yy,hz,c);if(id!==null)job.flora.set(yy,id);}
      }
      const key=cellKey(hx,hy,hz),id=this.edits.has(key)?this.edits.get(key):this._chunkCell(hx,hy,hz,job);
      job.blocks[x+z*32+y*1024]=this.blockNumbers.get(id)??0;job.cursor++;processed++;
    }
    return processed;
  }
  /** Generated block of one cell during chunk building (same rules as _baseCell, using the job's column cache). */
  _chunkCell(hx,hy,hz,job){
    const c=job.column;
    if(hy>c.topCell)return job.flora.get(hy)??null;
    if(hy===c.topCell)return c.surface;
    if(this._caveAt(hx,hy,hz,c))return null;
    if(hy>=c.topCell-c.soilCells)return c.subsoil;
    return this._oreMap(floorDiv(hx,128),floorDiv(hz,128)).get(cellKey(hx,hy,hz))??c.bedrock;
  }
  _finishChunk(job){
    // Edits may have arrived after a cell was generated during an earlier frame.
    for(const [key,id]of this.chunkEdits.get(job.key)??[]){const [x,y,z]=decodeCell(key);if(floorDiv(x,32)===job.cx&&floorDiv(y,32)===job.cy&&floorDiv(z,32)===job.cz)job.blocks[(x-job.cx*32)+(z-job.cz*32)*32+(y-job.cy*32)*1024]=this.blockNumbers.get(id);}
    const {key,cx,cy,cz,size,cellSize,blocks,palette}=job;return{key,cx,cy,cz,size,cellSize,blocks,palette,revision:this.revision};
  }
  _generateChunk(cx,cy,cz){const job=this._newChunkJob(cx,cy,cz);this._advanceChunk(job,32768);return this._finishChunk(job);}
  loadAround(x,z,{radiusChunks=2,verticalRadius=0,y,chunkBudget=4,workBudgetMs=8,maxCellsPerLoad=32768}={}){
    validatePosition(x,z);if(!(workBudgetMs>0)||!(maxCellsPerLoad>0))throw new RangeError('Invalid incremental work budget');const started=performance.now(),deadline=started+workBudgetMs;if(![radiusChunks,verticalRadius,chunkBudget].every(Number.isFinite))throw new RangeError('Invalid chunk loading budget');if(y!==undefined&&!finitePosition(y))throw new RangeError('Invalid load height');
    this._focus={x,z,radius:Math.max(64,(radiusChunks+1)*16)};
    const r=clamp(Math.floor(radiusChunks),0,8),v=clamp(Math.floor(verticalRadius),0,4),budget=clamp(Math.floor(chunkBudget),0,this.maxActiveChunks),cx=floorDiv(x,16),cz=floorDiv(z,16);
    const planKey=`${cx},${cz}:${r}:${v}:${y===undefined?'terrain':floorDiv(y,16)}:${this.maxActiveChunks}`;
    if(this._loadPlan?.key!==planKey){
      const horizontal=[];for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++)horizontal.push({cx:cx+dx,cz:cz+dz,priority:dx*dx+dz*dz});
      horizontal.sort((a,b)=>a.priority-b.priority||a.cx-b.cx||a.cz-b.cz);
      this._loadPlan={key:planKey,horizontal,cursor:0,wanted:[]};
    }
    const plan=this._loadPlan,prepareDeadline=workBudgetMs===Infinity?Infinity:Math.min(deadline,started+Math.min(3,workBudgetMs));
    while(plan.cursor<plan.horizontal.length&&performance.now()<prepareDeadline){
      const c=plan.horizontal[plan.cursor++],surface=floorDiv(this.heightAt(c.cx*16+8,c.cz*16+8),16),primary=y!==undefined&&c.priority<=2?floorDiv(y,16):surface;
      const levels=new Set([primary,surface]);for(let dy=-v;dy<=v;dy++)levels.add(surface+dy);
      // Surface coverage precedes remote buried/sky chunks; the player's immediate
      // layer still wins when mining or building above the ordinary ground.
      for(const cy of levels)plan.wanted.push({cx:c.cx,cy,cz:c.cz,key:cellKey(c.cx,cy,c.cz),priority:c.priority+(cy===primary?0:cy===surface?.25:25+Math.abs(cy-surface))});
    }
    plan.wanted.sort((a,b)=>a.priority-b.priority||a.cx-b.cx||a.cz-b.cz||a.cy-b.cy);
    const selected=plan.wanted.slice(0,this.maxActiveChunks),keys=new Set(selected.map(c=>c.key)),prepared=plan.cursor===plan.horizontal.length;
    if(!prepared)for(const [key,c]of this.activeChunks)if(Math.abs(c.cx-cx)<=r&&Math.abs(c.cz-cz)<=r)keys.add(key);
    this.unloadExcept(keys);
    for(const key of this._fluidActive){const [hx,,hz]=decodeCell(key);if(!this._simulationNear(hx,hz))this._fluidActive.delete(key);}
    for(const key of keys){if(this._fluidActive.size>=2048)break;for(const fluidKey of this._fluidChunkKeys.get(key)??[]){if(this._fluidActive.size>=2048)break;if(this.fluidCells.get(fluidKey).volumeM3>1e-9)this._fluidActive.add(fluidKey);}}
    let generated=0,processed=0;
    for(const c of selected){
      if(this.activeChunks.has(c.key)||generated>=budget||processed>=maxCellsPerLoad||performance.now()>=deadline)continue;
      if(!this._jobs.has(c.key))this._jobs.set(c.key,this._newChunkJob(c.cx,c.cy,c.cz));
      const job=this._jobs.get(c.key);processed+=this._advanceChunk(job,maxCellsPerLoad-processed,deadline);
      if(job.cursor===32768){if(this.activeChunks.size>=this.maxActiveChunks){const victim=[...this.activeChunks.values()].sort((a,b)=>((b.cx-cx)**2+(b.cz-cz)**2)-((a.cx-cx)**2+(a.cz-cz)**2))[0];if(victim)this.activeChunks.delete(victim.key);}this.activeChunks.set(c.key,this._finishChunk(job));this._jobs.delete(c.key);generated++;}
    }
    this.lastLoadWork={processedCells:processed,completedChunks:generated};
    this.pendingChunkCount=prepared?selected.filter(c=>!this.activeChunks.has(c.key)).length:Math.max(1,Math.min(plan.horizontal.length*(2*v+1),this.maxActiveChunks)-selected.filter(c=>this.activeChunks.has(c.key)).length);return [...this.activeChunks.values()];
  }
  unloadExcept(keys){const keep=keys instanceof Set?keys:new Set(keys);for(const key of this.activeChunks.keys())if(!keep.has(key))this.activeChunks.delete(key);for(const key of this._jobs.keys())if(!keep.has(key))this._jobs.delete(key);}
  findBuildingSites(x,z,radius=512){
    validatePosition(x,z);radius=clamp(radius,0,2048);const result=[],templates=this.content.structures?.entries??[];
    for(let cz=floorDiv(z-radius,512);cz<=floorDiv(z+radius,512);cz++)for(let cx=floorDiv(x-radius,512);cx<=floorDiv(x+radius,512);cx++){
      for(const kind of ['community','dungeon','small_ruin']){
        const slots=kind==='small_ruin'?this.rules.placement.smallRuinMaxPerRegion:1;
        const probability=kind==='community'?this.rules.placement.communityProbabilityPerRegion:kind==='dungeon'?this.rules.placement.dungeonProbabilityPerRegion:this.rules.placement.smallRuinProbabilityPerRegion;
        for(let i=0;i<slots;i++){
          if(this._rand('building-site',kind,cx,cz,i)>=probability)continue;
          const px=Math.round((cx*512+96+this._rand('building-x',kind,cx,cz,i)*320)*2)/2,pz=Math.round((cz*512+96+this._rand('building-z',kind,cx,cz,i)*320)*2)/2,s=this.sample(px,pz),e=this.environments.get(s.environmentId);
          if(Math.hypot(px-x,pz-z)>radius||Math.hypot(px,pz)<e.building.minDistanceToSpawnM||s.safeBypass||s.waterLevel!==null||s.reservedBy)continue;
          let templateId=e.building.dungeonId;
          if(kind==='community')templateId=templates.find(t=>t.kind!=='dungeon'&&t.environmentId===s.environmentId)?.id??'communal_archive';
          if(kind==='small_ruin')templateId='communal_archive';
          if(templates.length&&!templates.some(t=>t.id===templateId))continue;
          if(kind==='dungeon'&&result.some(t=>t.kind==='community'&&Math.hypot(t.x-px,t.z-pz)<this.rules.placement.minDungeonCommunityDistanceM))continue;
          result.push({id:`site:${cx},${cz}:${kind}:${i}`,kind,variant:kind==='small_ruin'?'small_ruin':null,environmentId:s.environmentId,tier:s.tier,templateId,x:Math.round(px*2)/2,z:Math.round(pz*2)/2,y:s.height});
        }
      }
    }
    return result;
  }
  harvestNodesAround(x,z,radius=64){validatePosition(x,z);radius=clamp(radius,0,256);const result=[],definitions=new Map(this.rules.harvestNodes.map(n=>[n.id,n]));
    for(let ez=floorDiv(z-radius,64);ez<=floorDiv(z+radius,64);ez++)for(let ex=floorDiv(x-radius,64);ex<=floorDiv(x+radius,64);ex++){
      const e=this.environments.get(this.sample(ex*64+32,ez*64+32).environmentId);
      for(const nodeId of e.harvestNodeIds){const def=definitions.get(nodeId);if(!def)continue;for(let i=0;i<def.candidateCountPer4096M2;i++){
        const px=Math.round((ex*64+this._rand('harvest-x',ex,ez,nodeId,i)*64)*2)/2,pz=Math.round((ez*64+this._rand('harvest-z',ex,ez,nodeId,i)*64)*2)/2,s=this.sample(px,pz);
        if(!this.environments.get(s.environmentId).harvestNodeIds.includes(nodeId))continue;
        if(Math.hypot(px-x,pz-z)>radius||s.reservedBy||nodeId==='freshwater'&&s.waterType!=='water'||nodeId!=='freshwater'&&s.waterLevel!==null)continue;
        result.push({id:`harvest:${ex},${ez}:${nodeId}:${i}`,nodeId,sourceId:def.sourceId,resourceId:def.resourceId,x:Math.round(px*2)/2,y:s.waterLevel??s.height,z:Math.round(pz*2)/2,regrowS:def.regrowS});
      }}
    }
    // Fixed accessible starter affordances, not free inventory grants.
    for(const [nodeId,count]of [['fallen_branch',8],['loose_stone',8],['fiber_patch',4],['berry_bush',6]])for(let i=0;i<count;i++){
      const angle=this._rand('starter-node-angle',nodeId,i)*Math.PI*2,r=18+this._rand('starter-node-radius',nodeId,i)*22,px=Math.round(Math.cos(angle)*r*2)/2,pz=Math.round(Math.sin(angle)*r*2)/2,def=definitions.get(nodeId);
      if(Math.hypot(px-x,pz-z)<=radius&&!this.sample(px,pz).reservedBy)result.push({id:`starter:${nodeId}:${i}`,nodeId,sourceId:def.sourceId,resourceId:def.resourceId,x:px,y:this.heightAt(px,pz),z:pz,regrowS:def.regrowS});
    }
    if(Math.hypot(x-80,z-24)<=radius){const def=definitions.get('freshwater');result.push({id:'starter:freshwater',nodeId:'freshwater',sourceId:def.sourceId,resourceId:def.resourceId,x:80,y:0,z:24,regrowS:0});}
    return result;
  }
  serialize(){return{schemaVersion:ATLAS_VERSION,generator:this.generatorId,seed:this.seed,simulationTime:this.simulationTime,simulationAccumulator:this._simulationAccumulator,flowCursor:this._flowCursor,thermalCursor:this._thermalCursor,reactions:{...this.reactions},focus:this._focus?{...this._focus}:null,fluidActive:[...this._fluidActive],fluidCells:[...this.fluidCells].map(([k,v])=>[k,{...v}]),burning:[...this.burning].map(([k,v])=>[k,{...v}]),fuelRemaining:[...this.fuelRemaining],thermalCells:[...this.thermalCells].map(([k,v])=>[k,{...v}]),cellDamage:[...this.cellDamage].map(([k,v])=>[k,{...v}]),edits:[...this.edits].sort(([a],[b])=>a.localeCompare(b)),reservations:[...this.reservations.values()].sort((a,b)=>a.id.localeCompare(b.id))};}
}
