import { VoxelAssetBuilder } from './voxel/authoring.js';
import {components} from '../structure.js';
import {resolveSurfaceDamage} from './material-effects.js';

const GRID = .5, CELL_LITERS = 125, MAX_COMPONENT_CELLS = 2048;
const DIRS = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]];
const copy = x => structuredClone(x), key = c => c.join(',');
const validCell = c => Array.isArray(c) && c.length === 3 && c.every(Number.isSafeInteger);
const vec = v => Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : v;
const validVector = v => v && ['x', 'y', 'z'].every(k => Number.isFinite(v[k]) && Math.abs(v[k]) <= 1e12);
const zero = () => ({ x: 0, y: 0, z: 0 });
const identity = () => ({ x: 0, y: 0, z: 0, w: 1 });
const colors = { grass:'#688b49', dirt:'#80644b', stone:'#858b87', sand:'#c4b483', log:'#725238', plank:'#a58a5c', leaves:'#54743f', moss:'#4c6a42', basalt:'#41464a', ash:'#7c776d', clay:'#9b6c52', glass:'#a4cad1' };
const color = id => colors[id] ?? (/mana|crystal/.test(id) ? '#7b79bd' : /sacred|holy/.test(id) ? '#e0c98a' : /ore|iron/.test(id) ? '#866f58' : /nickel/.test(id) ? '#9ca795' : /titan/.test(id) ? '#889ba0' : /leaf|grass|peat/.test(id) ? '#627b45' : '#777e79');

/** Detached world material remains an object, with no manufactured components.
 * This registry never integrates motion: the Rapier bridge is the sole pose driver.
 * Its snapshot must be saved atomically with atlas edits, just like inventory/world.
 */
export class WorldObjects {
  constructor(content, atlas, state = {}) {
    if (!atlas?.getCell || !atlas.setCell) throw Error('WorldObjects requires an editable atlas');
    state ??= {};
    this.atlas = atlas; this.blocks = new Map(content.blocks.entries.map(b => [b.id, b]));
    this.objects = new Map(); this.nextId = 1;
    this.maxComponentCells = MAX_COMPONENT_CELLS;
    if (state.schemaVersion != null && state.schemaVersion !== 1) throw Error('Unsupported world object save');
    if (state.nextId != null) { if (!Number.isSafeInteger(state.nextId) || state.nextId < 1) throw Error('Invalid object serial'); this.nextId = state.nextId; }
    for (const raw of state.objects ?? []) {
      if (raw?.fragment) {
        if (typeof raw.id !== 'string' || !raw.id.startsWith('object:') || this.objects.has(raw.id) || raw.entityType !== 'object' || !validVector(raw.position) || !validVector(raw.velocity) || !validVector(raw.angularVelocity)) throw Error('Invalid saved fragment');
        const object = copy(raw); object.rotation = this._rotation(object.rotation); this._buildFragment(object);
        if ([...this.objects.values()].some(o => o.fragment?.claimId === object.fragment.claimId)) throw Error('Duplicate fragment claim');
        this.objects.set(object.id, object);
        const serial = Number(object.id.slice(7)); if (Number.isSafeInteger(serial)) this.nextId = Math.max(this.nextId, serial + 1);
        continue;
      }
      if (!raw || typeof raw.id !== 'string' || !raw.id.startsWith('object:') || this.objects.has(raw.id) || raw.entityType !== 'object' || !validVector(raw.position) || !validVector(raw.velocity) || !validVector(raw.angularVelocity) || !Array.isArray(raw.cells) || raw.cells.length < 1 || raw.cells.length > MAX_COMPONENT_CELLS || !validCell(raw.originCell)) throw Error('Invalid world object');
      const sourceCells = new Set();
      const object = copy(raw); object.rotation = this._rotation(object.rotation);
      for (const cell of object.cells) {
        if (!validCell(cell.cell) || !validCell(cell.sourceCell) || !this.blocks.has(cell.blockId) || key(cell.sourceCell) !== key(cell.cell.map((v, i) => v + object.originCell[i]))) throw Error('Invalid detached cell');
        if (sourceCells.has(key(cell.sourceCell))) throw Error('Duplicate detached source cell');
        if(cell.hp!=null&&(!Number.isFinite(cell.hp)||cell.hp<=0||cell.hp>this.blocks.get(cell.blockId).durabilityHpPerCell))throw Error('Invalid detached cell health');
        sourceCells.add(key(cell.sourceCell));
      }
      this._build(object); this.objects.set(object.id, object);
      const serial = Number(object.id.slice(7));
      if (Number.isSafeInteger(serial)) this.nextId = Math.max(this.nextId, serial + 1);
    }
    // Avoid collision even when older clients saved an out-of-date nextId.
    while (this.objects.has(`object:${this.nextId}`)) this.nextId++;
  }
  _rotation(q) {
    if (!validVector(q) || !Number.isFinite(q.w)) throw Error('Invalid object quaternion');
    const length = Math.hypot(q.x, q.y, q.z, q.w);
    if (length < 1e-9) throw Error('Zero object quaternion');
    return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
  }
  _fixed(cell, block) {
    if (!block || block.detachesWhenUnsupported !== true) return true;
    // Integrators can expose immovable foundations or contact with fixed buildings.
    return Boolean(this.atlas.isAnchoredCell?.(...cell));
  }
  _component(start, examined) {
    const queue = [start], queued = new Set([key(start)]), cells = [];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      if (cursor >= this.maxComponentCells) { for (const c of queue) examined.add(key(c)); return { reason: 'component_limit', cells: [] }; }
      const cell = queue[cursor], blockId = this.atlas.getCell(...cell), block = this.blocks.get(blockId);
      examined.add(key(cell));
      if (blockId == null) continue;
      if (this._fixed(cell, block)) return { reason: 'anchored', cells: [] };
      cells.push({ cell, blockId });
      for (const d of DIRS) {
        const neighbor = cell.map((v, i) => v + d[i]), k = key(neighbor);
        if (queued.has(k)) continue;
        if (this.atlas.isAnchoredCell?.(...neighbor)) return { reason: 'anchored', cells: [] };
        const adjacentId = this.atlas.getCell(...neighbor);
        if (adjacentId == null) continue;
        if (this._fixed(neighbor, this.blocks.get(adjacentId))) return { reason: 'anchored', cells: [] };
        queued.add(k); queue.push(neighbor);
      }
    }
    return { cells };
  }
  detachAround(cell) {
    if (!validCell(cell)) throw Error('Destroyed cell must use integer half-metre coordinates');
    if (this.atlas.getCell(...cell) != null) return { objects: [], detachedCells: 0, reasons: ['cell_not_destroyed'] };
    const examined = new Set(), created = [], reasons = [];
    for (const d of DIRS) {
      const start = cell.map((v, i) => v + d[i]);
      if (examined.has(key(start)) || this.atlas.getCell(...start) == null) continue;
      const found = this._component(start, examined);
      if (found.reason) { reasons.push(found.reason); continue; }
      if (!found.cells.length) continue;
      const originCell = [0, 1, 2].map(axis => Math.min(...found.cells.map(c => c.cell[axis])));
      const object = { id: `object:${this.nextId}`, entityType: 'object', kind: 'object', originCell,
        name: '분리된 월드 조각', position: { x: originCell[0] * GRID, y: originCell[1] * GRID, z: originCell[2] * GRID },
        rotation: identity(), velocity: zero(), angularVelocity: zero(), revision: 1,
        cells: found.cells.map(c => ({ cell: c.cell.map((v, i) => v - originCell[i]), sourceCell: [...c.cell], blockId: c.blockId })) };
      // Validate the exclusive SDK geometry and all masses before changing the atlas.
      this._build(object);
      if (found.cells.some(c => this.atlas.getCell(...c.cell) !== c.blockId)) { reasons.push('world_changed'); continue; }
      const removed = [];
      try {
        for (const c of found.cells) {
          removed.push(c);
          this.atlas.setCell(...c.cell, null);
          if (this.atlas.getCell(...c.cell) != null) throw Error('Atlas refused detachment');
        }
      } catch (error) {
        for (const c of removed) this.atlas.setCell(...c.cell, c.blockId);
        throw error;
      }
      this.nextId++; this.objects.set(object.id, object); created.push(object);
    }
    return { objects: created, detachedCells: created.reduce((n, o) => n + o.cells.length, 0), reasons: [...new Set(reasons)] };
  }
  _build(object) {
    const ids = [...new Set(object.cells.map(c => c.blockId))];
    const materials = ids.map(id => {
      const b = this.blocks.get(id);
      if (b.cellSizeM !== GRID || !(b.massPerCellKg > 0) || !Number.isFinite(b.massPerCellKg)) throw Error('Detached material requires canonical 0.5m cell mass');
      return { id, blockId: id, color: color(id), roughness: .9, metallic: b.kind === 'metal' ? .65 : 0, opacity: b.opacity, emission: 0, collision: b.collision !== false };
    });
    const builder = new VoxelAssetBuilder({ schemaVersion: 1, id: object.id, name: object.name,
      category: 'object', entityType: 'object', status: 'runtime_detached_material', units: 'm', upAxis: 'Y', forwardAxis: '+Z', visualGridM: GRID,
      materials, parts: [{ id: 'root', parent: null, translation: [0, 0, 0], role: 'detached_world_material', boxes: [] }], anchors: [], instances: [],
      notes: ['Material transferred from atlas cells; no machine function inferred.', 'Each cell retains 125 litres and its canonical mass. Motion belongs to the physics bridge.'] });
    object.boxes = []; object.massKg = 0; object.volumeLiters = 0;
    for (const c of object.cells) {
      const block = this.blocks.get(c.blockId), center = c.cell.map(v => (v + .5) * GRID), size = [GRID, GRID, GRID];
      builder.addBox('root', { center, size, material: c.blockId });
      object.boxes.push({ center, size, massKg: block.massPerCellKg, blockId: c.blockId, collision: block.collision !== false,
        friction: block.friction, partId: `cell:${key(c.cell)}`, volumeLiters: CELL_LITERS });
      object.massKg += block.massPerCellKg; object.volumeLiters += CELL_LITERS;
    }
    object.mass = object.massKg; object.asset = builder.toJSON();
  }
  get(id) { return this.objects.get(id) ?? null; }
  _centre(object){
    const local={x:0,y:0,z:0};
    for(const b of object.boxes)for(const [i,k]of ['x','y','z'].entries())local[k]+=b.center[i]*b.massKg/object.massKg;
    const q=object.rotation,t={x:2*(q.y*local.z-q.z*local.y),y:2*(q.z*local.x-q.x*local.z),z:2*(q.x*local.y-q.y*local.x)};
    return {x:local.x+q.w*t.x+q.y*t.z-q.z*t.y,y:local.y+q.w*t.y+q.z*t.x-q.x*t.z,z:local.z+q.w*t.z+q.x*t.y-q.y*t.x};
  }
  /** The object's cell under a world point, or null. */
  cellAt(id,point){
    const o=this.get(id);if(!o||!validVector(point))return null;
    const q=o.rotation,v={x:point.x-o.position.x,y:point.y-o.position.y,z:point.z-o.position.z};
    const x=-q.x,y=-q.y,z=-q.z,w=q.w,tx=2*(y*v.z-z*v.y),ty=2*(z*v.x-x*v.z),tz=2*(x*v.y-y*v.x);
    const local=[v.x+w*tx+y*tz-z*ty,v.y+w*ty+z*tx-x*tz,v.z+w*tz+x*ty-y*tx].map(n=>Math.floor(n/GRID));
    return o.cells.find(c=>key(c.cell)===key(local))??null;
  }
  damageAt(id,point,amount,{energyType='mechanical',progression=null,yieldOf=null}={}){
    const o=this.get(id);if(!o||!validVector(point)||!Number.isFinite(amount)||amount<=0)return {ok:false,reason:'invalid_object_hit'};
    if(o.fragment)return {ok:false,reason:'생물 부위의 전리품은 사용 버튼으로 회수하세요.'};
    const cell=this.cellAt(id,point);if(!cell)return {ok:false,reason:'target_missing'};
    const block=this.blocks.get(cell.blockId),response=resolveSurfaceDamage(block,amount,energyType);if(!response.ok)return response;
    const hp=Math.max(0,(cell.hp??block.durabilityHpPerCell)-response.amount);
    if(hp>0){cell.hp=hp;o.revision++;return {ok:true,hp};}
    const remaining=o.cells.filter(c=>c!==cell),groups=components(remaining.map(c=>({x:c.cell[0],y:c.cell[1],z:c.cell[2],source:c}))),pieces=[];
    // Build all children before changing the registry. Original source coordinates
    // and local frames remain unchanged, including a rotated parent's orientation.
    let serial=this.nextId;const oldCentre=this._centre(o),spin=o.angularVelocity;
    for(let i=0;i<groups.length;i++){
      const part={...o,id:i?`object:${serial++}`:o.id,cells:groups[i].map(c=>copy(c.source)),revision:o.revision+1};this._build(part);
      const centre=this._centre(part),d={x:centre.x-oldCentre.x,y:centre.y-oldCentre.y,z:centre.z-oldCentre.z};
      part.velocity={x:o.velocity.x+spin.y*d.z-spin.z*d.y,y:o.velocity.y+spin.z*d.x-spin.x*d.z,z:o.velocity.z+spin.x*d.y-spin.y*d.x};pieces.push(part);
    }
    const mined=yieldOf?yieldOf(block):block.rawResourceId&&block.harvestYieldPerCell>0?{id:block.rawResourceId,count:block.harvestYieldPerCell}:null,items=mined?{[mined.id]:mined.count}:{};
    const claimId=`object-harvest:${id}:${key(cell.sourceCell)}`;
    if(progression&&Object.keys(items).length){const receipt=progression.grant(items,{claimId});if(!receipt.ok)return receipt;}
    this.objects.delete(id);for(const part of pieces)this.objects.set(part.id,part);this.nextId=serial;
    return {ok:true,hp:0,removed:true,removedMassKg:block.massPerCellKg,objectIds:pieces.map(p=>p.id),items,claimId};
  }
  setPhysicsPose(id, { position, rotation, velocity, angularVelocity } = {}) {
    const o = this.get(id); if (!o) return false;
    const p = position == null ? o.position : vec(position), v = velocity == null ? o.velocity : vec(velocity), w = angularVelocity == null ? o.angularVelocity : vec(angularVelocity);
    if (![p, v, w].every(validVector)) return false;
    let q; try { q = rotation == null ? o.rotation : this._rotation(rotation); } catch { return false; }
    Object.assign(o, { position: copy(p), rotation: q, velocity: copy(v), angularVelocity: copy(w) }); return true;
  }
  physicsBodies() { return [...this.objects.values()].map(o => ({ id: o.id, ownerId: o.id, entityType: 'object', position: o.position, rotation: o.rotation,
    velocity: o.velocity, angularVelocity: o.angularVelocity, massKg: o.massKg, boxes: o.boxes, revision: o.revision })); }
  sceneModels() { return [...this.objects.values()].map(o => ({ id: o.id, ownerId: o.id, assetId: o.id, kind: 'object', entityType: 'object',
    asset: o.asset, model: o.asset, position: o.position, rotation: o.rotation, velocity: o.velocity, angularVelocity: o.angularVelocity,
    mass: o.massKg, massKg: o.massKg, revision: o.revision, fragment: o.fragment ? copy(o.fragment) : null })); }
  descriptors() { return this.sceneModels(); }
  _buildFragment(object) {
    const f = object.fragment;
    if (!f || typeof f.sourceOwnerId !== 'string' || typeof f.sourcePartId !== 'string' || typeof f.claimId !== 'string' || !f.claimId || f.policy !== 'authored_rest_solid_union_last_part_owns_overlap_v1' || typeof f.allocationId !== 'string' || !Number.isFinite(f.massKg) || f.massKg <= 0 || !Number.isFinite(f.totalMassKg) || f.massKg > f.totalMassKg || !Array.isArray(f.boxMassesKg)) throw Error('Invalid fragment allocation');
    if (object.asset?.parts?.length !== 1 || object.asset.parts[0].parent !== null) throw Error('Fragment must preserve one source visual part');
    const part = object.asset.parts[0];
    if (part.translation.some(v => v !== 0) || f.boxMassesKg.length !== part.boxes.length || f.boxMassesKg.some(n => !Number.isFinite(n) || n < 0) || Math.abs(f.boxMassesKg.reduce((n,v)=>n+v,0)-f.massKg) > 1e-7) throw Error('Invalid fragment box mass');
    const source = copy(object.asset); source.id = object.id;
    object.asset = new VoxelAssetBuilder(source).toJSON();
    const materials = new Map(object.asset.materials.map(m=>[m.id,m]));
    object.boxes = part.boxes.flatMap((b,index)=>{
      if (f.boxMassesKg[index] <= 0) return [];
      if (b.collision === false || materials.get(b.material)?.collision === false) throw Error('Cosmetic volume cannot create creature mass');
      return [{ center:copy(b.center),size:copy(b.size),massKg:f.boxMassesKg[index],collision:true,friction:.6,partId:`${f.sourcePartId}:${index}`,volumeLiters:b.size.reduce((n,v)=>n*v,1)*1000 }];
    });
    if (!object.boxes.length) throw Error('Fragment has no physical solid');
    object.massKg = f.massKg; object.mass = f.massKg; object.volumeLiters = object.boxes.reduce((n,b)=>n+b.volumeLiters,0);
  }
  spawnFragment(packet = {}) {
    const { sourceOwnerId,sourcePartId,claimId,allocation:a,sourceLedger:ledger,asset } = packet;
    if (!a || !ledger) return { ok:false,reason:'fragment_mass_allocation_required' };
    if (ledger.ownerId !== sourceOwnerId || ledger.allocationId !== a.allocationId || ledger.policy !== a.policy || ledger.totalMassKg !== a.totalMassKg || !Number.isFinite(ledger.remainingMassKg) || !ledger.parts?.[sourcePartId] || Math.abs(ledger.parts[sourcePartId].massKg-a.massKg)>1e-7) return {ok:false,reason:'invalid_mass_ledger'};
    const charged = Object.values(ledger.claims ?? {}).reduce((n,c)=>n+c.massKg,0);
    if (!Number.isFinite(charged) || Math.abs(charged+ledger.remainingMassKg-ledger.totalMassKg)>1e-7) return {ok:false,reason:'mass_not_conserved'};
    const existing = [...this.objects.values()].find(o=>o.fragment?.claimId===claimId);
    if (existing && (existing.fragment.sourceOwnerId!==sourceOwnerId || existing.fragment.sourcePartId!==sourcePartId || existing.fragment.allocationId!==a.allocationId)) return {ok:false,reason:'fragment_claim_conflict'};
    const prior=ledger.claims?.[claimId];
    if (prior) return existing && prior.objectId===existing.id ? {ok:true,duplicate:true,object:existing,objectId:existing.id} : {ok:false,reason:'fragment_snapshot_mismatch'};
    if (ledger.parts[sourcePartId].objectId || a.massKg>ledger.remainingMassKg+1e-7) return {ok:false,reason:'mass_already_transferred'};
    let object=existing;
    if (!object) {
      const position=vec(packet.position),velocity=vec(packet.velocity??zero()),angularVelocity=vec(packet.angularVelocity??zero());
      if (![position,velocity,angularVelocity].every(validVector)) return {ok:false,reason:'invalid_fragment_pose'};
      try {
        object={id:`object:${this.nextId}`,kind:'object',entityType:'object',name:asset?.name??'분리된 생물 부위',position:copy(position),rotation:this._rotation(packet.rotation??identity()),velocity:copy(velocity),angularVelocity:copy(angularVelocity),revision:1,asset:copy(asset),
          fragment:{sourceOwnerId,sourcePartId,claimId,allocationId:a.allocationId,policy:a.policy,totalMassKg:a.totalMassKg,massKg:a.massKg,boxMassesKg:copy(a.boxMassesKg),lootOwnerId:sourceOwnerId}};
        this._buildFragment(object);
      } catch(error) { return {ok:false,reason:'invalid_fragment_allocation',detail:error.message}; }
    }
    // One synchronous transfer: source budget and new owner change together.
    ledger.claims ??= {}; ledger.claims[claimId]={objectId:object.id,sourcePartId,massKg:object.massKg};
    ledger.parts[sourcePartId].objectId=object.id;ledger.remainingMassKg=Math.max(0,ledger.remainingMassKg-object.massKg);
    if (!existing) { this.objects.set(object.id,object); this.nextId++; }
    return {ok:true,duplicate:Boolean(existing),object,objectId:object.id};
  }
  serialize() {
    return { schemaVersion: 1, nextId: this.nextId, objects: [...this.objects.values()].map(o => copy({ id: o.id, entityType: o.entityType, kind: o.kind,
      name: o.name, ...(o.fragment ? { fragment:o.fragment,asset:o.asset } : { originCell:o.originCell,cells:o.cells }), position: o.position, rotation: o.rotation, velocity: o.velocity, angularVelocity: o.angularVelocity,
      revision: o.revision })) };
  }
}
