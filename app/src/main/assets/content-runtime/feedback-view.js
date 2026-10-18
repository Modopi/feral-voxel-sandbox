import * as T from '../vendor/three.module.js';
import { VoxelAssetBuilder } from './voxel/authoring.js';
import { surfaceGroups } from './voxel/solid.js';

const RANGE = 10, MAX_MARKERS = 4, MAX_FLIGHTS = 4, GRID = 1 / 32;
const quantity = death => Object.values(death?.items ?? {}).reduce((n, v) => n + (Number.isFinite(v) && v > 0 ? v : 0), death?.weapons?.length??0);
const dist = (a, b) => Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z);
const validPosition = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]));
const clone = value => structuredClone(value);

/** Cosmetic only: this authored model never supplies collision, inventory or recovery. */
export function buildRecoveryFairyAsset() {
  const builder = new VoxelAssetBuilder({ schemaVersion: 1, id: 'recovery_fairy', name: '소지품을 지키는 요정', category: 'effect',
    status: 'runtime_cosmetic', units: 'm', upAxis: 'Y', forwardAxis: '+Z', visualGridM: GRID,
    materials: [
      { id: 'body', color: '#a6e7d9', roughness: .65, metallic: 0, emission: .15, opacity: 1, collision: false },
      { id: 'face', color: '#f7e6ac', roughness: .7, metallic: 0, emission: .1, opacity: 1, collision: false },
      { id: 'eye', color: '#263c51', roughness: .8, metallic: 0, emission: 0, opacity: 1, collision: false },
      { id: 'wing', color: '#c2f4e9', roughness: .6, metallic: 0, emission: .12, opacity: .64, collision: false },
    ],
    parts: [{ id: 'root', parent: null, translation: [0, 0, 0], role: 'cosmetic', boxes: [] }], anchors: [], instances: [],
    notes: ['Ledger-driven recovery indicator only; all actual item transfer remains in ExpeditionRuntime.', 'This fairy has no biology, combat statistics, mass or collision.'] });
  const box = (part, x, y, z, w, h, d, material) => builder.addBox(part, { center: [(x+w/2)*GRID, (y+h/2)*GRID, (z+d/2)*GRID], size: [w*GRID,h*GRID,d*GRID], material });
  box('root',-1,1,-1,2,4,2,'body'); box('root',-2,5,-1,4,3,3,'face');
  box('root',-2,6,2,1,1,1,'eye'); box('root',1,6,2,1,1,1,'eye');
  box('root',-1,0,-1,1,1,1,'body'); box('root',0,0,0,1,1,1,'body');
  for (const side of [-1,1]) {
    const id = side < 0 ? 'wing_left' : 'wing_right'; builder.addPart({id, translation:[side*GRID,3*GRID,0], role:'cosmetic_wing'});
    box(id,side<0?-4:0,0,-1,4,3,1,'wing'); box(id,side<0?-3:0,-2,-1,3,2,1,'wing');
  }
  return builder.toJSON();
}

export class FeedbackView {
  constructor(view) {
    this.view = view; this.scene = view.scene ?? view;
    this.root = new T.Group(); this.root.name = 'player-feedback'; this.root.userData.collision = false; this.scene.add(this.root);
    this.asset = buildRecoveryFairyAsset(); this.geometry = []; this.materials = []; this.partMeshes = new Map();
    for (const part of this.asset.parts) {
      const meshes = [];
      for (const [id, surface] of surfaceGroups(part.boxes, this.asset.materials)) {
        if (!surface.positions.length) continue;
        const source = this.asset.materials.find(m => m.id === id), geometry = new T.BufferGeometry();
        geometry.setAttribute('position', new T.Float32BufferAttribute(surface.positions,3)); geometry.setAttribute('normal',new T.Float32BufferAttribute(surface.normals,3)); geometry.setIndex(surface.indices);
        const material = new T.MeshStandardMaterial({color:source.color,roughness:source.roughness,metalness:0,emissive:source.color,emissiveIntensity:source.emission,
          transparent:source.opacity<1,opacity:source.opacity,depthWrite:source.opacity===1,depthTest:true});
        this.geometry.push(geometry); this.materials.push(material); meshes.push({geometry,material});
      }
      this.partMeshes.set(part.id,meshes);
    }
    this.ringGeometry = new T.RingGeometry(RANGE-.035,RANGE+.035,64); this.ringGeometry.rotateX(-Math.PI/2);
    this.ringMaterial = new T.MeshBasicMaterial({color:'#a3e6cf',transparent:true,opacity:.16,side:T.DoubleSide,depthWrite:false,depthTest:true,toneMapped:false});
    this.centerGeometry = new T.RingGeometry(.35,.42,24); this.centerGeometry.rotateX(-Math.PI/2);
    this.markers = new Map(); this.flights = []; this.time = 0; this.hitUntil = 0; this.hitTextUntil = 0; this.hitStrength = 0;
    this.noticeUntil = 0; this.notice = ''; this.lastHp = null; this.lastDamageAt = null; this.lastDeathId = null; this.disposed = false;
    this.status = { hitOpacity:0,hitText:'',recoveryText:'',markers:0,fairies:0,flights:0,nearestDistance:null,inRecoveryRange:false };
    this._hud();
  }
  _hud() {
    const doc = this.view.renderer?.domElement?.ownerDocument ?? globalThis.document;
    if (!doc?.body?.appendChild || !doc.createElement) return;
    const overlay = doc.createElement('div'); overlay.className = 'feral-feedback'; overlay.setAttribute('aria-hidden','true');
    Object.assign(overlay.style,{position:'fixed',inset:'0',pointerEvents:'none',zIndex:'18'});
    const damage = doc.createElement('div'); Object.assign(damage.style,{position:'absolute',inset:'0',opacity:'0',background:'radial-gradient(ellipse at center,transparent 48%,rgba(165,38,33,.7) 100%)',boxShadow:'inset 0 0 20px rgba(182,50,40,.55)'});
    const hit = doc.createElement('div'); Object.assign(hit.style,{position:'absolute',top:'58%',left:'50%',transform:'translateX(-50%)',color:'#ffd5c7',font:'600 16px system-ui',textShadow:'0 1px 4px #180500'});
    const recovery = doc.createElement('div'); Object.assign(recovery.style,{position:'absolute',bottom:'108px',left:'50%',transform:'translateX(-50%)',maxWidth:'min(82vw,500px)',padding:'7px 11px',borderRadius:'7px',background:'rgba(14,34,30,.78)',color:'#d4f3e5',font:'13px system-ui',textAlign:'center',display:'none'});
    overlay.appendChild(damage); overlay.appendChild(hit); overlay.appendChild(recovery); doc.body.appendChild(overlay);
    this.dom = {overlay,damage,hit,recovery};
  }
  _fairy() {
    const group=new T.Group(),parts=new Map(); group.userData={kind:'cosmetic_fairy',collision:false};
    for(const part of this.asset.parts){const node=new T.Group();node.position.set(...part.translation);parts.set(part.id,node);for(const shape of this.partMeshes.get(part.id))node.add(new T.Mesh(shape.geometry,shape.material));}
    for(const part of this.asset.parts)(part.parent===null?group:parts.get(part.parent)).add(parts.get(part.id));
    return {group,parts};
  }
  _marker(death) {
    const group=new T.Group();group.name=`recovery:${death.id}`;group.userData={kind:'recovery_marker',deathId:death.id,collision:false,recoveryRadiusM:RANGE};
    group.position.set(death.position.x,death.position.y,death.position.z);
    const ring=new T.Mesh(this.ringGeometry,this.ringMaterial);ring.position.y=.035;
    const center=new T.Mesh(this.centerGeometry,this.ringMaterial);center.position.y=.05;group.add(ring,center);
    const fairies=[this._fairy(),this._fairy()];for(const f of fairies)group.add(f.group);
    this.root.add(group);return {group,ring,fairies,remaining:quantity(death),position:clone(death.position)};
  }
  _flight(position, player) {
    if(this.flights.length>=MAX_FLIGHTS){this.flights.shift().fairy.group.removeFromParent();}
    const fairy=this._fairy();this.root.add(fairy.group);
    this.flights.push({fairy,from:clone(position),to:{x:player.x,y:player.y+1.1,z:player.z},started:this.time,duration:.9});
  }
  _wings(fairy,phase){fairy.parts.get('wing_left').rotation.y=Math.sin(phase)*.5;fairy.parts.get('wing_right').rotation.y=-Math.sin(phase)*.5;}
  _roomForItems(runtime,death){
    const inventory=runtime.progression?.inventory??{},slots=Object.values(inventory).reduce((n,v)=>n+Math.ceil(Math.max(0,v)/64),0);
    return Object.entries(death.items??{}).some(([id,n])=>n>0&&(36-slots+Math.ceil((inventory[id]??0)/64))*64-(inventory[id]??0)>0);
  }
  sync(runtime,dt=0){
    if(this.disposed)return this.status;
    if(!Number.isFinite(dt)||dt<0)return this.status;
    this.time+=Math.min(dt,10);
    const player=runtime.player;if(!validPosition(player))return this.status;
    const deaths=Array.isArray(runtime.deaths)?runtime.deaths:[],latest=deaths.at(-1)?.id??null;
    const initialized=this.lastHp!==null,loss=initialized?Math.max(0,this.lastHp-player.hp):0;
    const newHit=initialized&&Number.isFinite(player.lastDamageAt)&&player.lastDamageAt>(this.lastDamageAt??-Infinity);
    if(loss>0||newHit){this.hitUntil=this.time+.7;this.hitTextUntil=this.time+1.05;this.hitStrength=Math.min(.4,.15+loss/Math.max(1,player.maxHp??100));this.hitLabel=loss>0?`피격 −${Math.max(1,Math.round(loss))} HP`:'피격';}
    if(initialized&&latest&&latest!==this.lastDeathId){this.notice='소지품은 사망 지점에 보관됩니다. 10m 안으로 돌아가면 요정이 가져옵니다.';this.noticeUntil=this.time+4;}
    this.lastHp=player.hp;this.lastDamageAt=player.lastDamageAt??null;this.lastDeathId=latest;
    const active=deaths.filter(d=>d&&!d.recovered&&quantity(d)>0&&validPosition(d.position));
    active.sort((a,b)=>dist(player,a.position)-dist(player,b.position));
    const selected=active.filter(d=>dist(player,d.position)<=200).slice(0,MAX_MARKERS),wanted=new Set(selected.map(d=>d.id));
    // Only current visual markers are remembered; completed historical ledger entries
    // stay in runtime, never in an ever-growing visual event queue.
    for(const[id,marker]of this.markers){
      const ledger=deaths.find(d=>d.id===id),remaining=quantity(ledger);
      if(ledger&&remaining<marker.remaining){
        this._flight(marker.position,player);this.notice=remaining>0?'요정이 소지품 일부를 가져왔습니다. 남은 물품은 표식에 보관됩니다.':'요정이 남겨 둔 소지품을 모두 가져왔습니다.';this.noticeUntil=this.time+3;
      }
      marker.remaining=remaining;
      if(!wanted.has(id)){marker.group.removeFromParent();this.markers.delete(id);}
    }
    for(const death of selected){
      let marker=this.markers.get(death.id);if(!marker){marker=this._marker(death);this.markers.set(death.id,marker);}
      marker.group.position.set(death.position.x,death.position.y,death.position.z);marker.position=clone(death.position);
      marker.ring.visible=dist(player,death.position)<22;
      marker.fairies.forEach((f,i)=>{const phase=this.time*1.4+i*Math.PI;f.group.position.set(Math.cos(phase)*.65,1.15+Math.sin(phase*1.7)*.12,Math.sin(phase)*.65);f.group.rotation.y=-phase;this._wings(f,this.time*12+i);});
    }
    for(let i=this.flights.length-1;i>=0;i--){const f=this.flights[i],t=(this.time-f.started)/f.duration;if(t>=1){f.fairy.group.removeFromParent();this.flights.splice(i,1);continue;}const u=t*t*(3-2*t);f.fairy.group.position.set(f.from.x+(f.to.x-f.from.x)*u,f.from.y+1+(f.to.y-f.from.y-1)*u+Math.sin(t*Math.PI)*.5,f.from.z+(f.to.z-f.from.z)*u);this._wings(f.fairy,this.time*14);}
    const nearest=active[0],distance=nearest?dist(player,nearest.position):null,inRange=distance!==null&&distance<=RANGE;
    let recoveryText=this.time<this.noticeUntil?this.notice:'';
    if(nearest&&!recoveryText)recoveryText=inRange?(this._roomForItems(runtime,nearest)?'회수 범위 안 · 요정이 남은 소지품을 가져옵니다.':'회수 범위 안 · 가방에 공간을 만들면 요정이 남은 소지품을 가져옵니다.'):`남겨 둔 소지품 ${Math.ceil(distance)}m · 10m 안에서 요정이 회수`;
    this.status={hitOpacity:this.time<this.hitUntil?this.hitStrength*Math.max(0,(this.hitUntil-this.time)/.7):0,hitText:this.time<this.hitTextUntil?this.hitLabel:'',recoveryText,
      markers:this.markers.size,fairies:this.markers.size*2+this.flights.length,flights:this.flights.length,nearestDistance:distance,inRecoveryRange:inRange};
    if(this.dom){this.dom.damage.style.opacity=String(this.status.hitOpacity);this.dom.hit.textContent=this.status.hitText;this.dom.recovery.textContent=recoveryText;this.dom.recovery.style.display=recoveryText?'block':'none';}
    return this.status;
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.root.removeFromParent();this.root.clear();this.markers.clear();this.flights.length=0;for(const g of this.geometry)g.dispose();for(const m of this.materials)m.dispose();this.ringGeometry.dispose();this.centerGeometry.dispose();this.ringMaterial.dispose();this.dom?.overlay.remove();this.dom=null;}
}
