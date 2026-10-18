import { gripLimits } from '../impact.js';
const CELL = .5;
/** Collider shapes of a piece: its 0.5 m cells merged into the fewest exact cuboids per block (same mass per cell,
 * friction and solidity), the way terrain sections merge (no box covers an empty cell). A felled tree is tens of
 * colliders instead of hundreds, so the solver and the contact filter see tens of pairs. Other boxes (creature
 * fragments) are kept as they are. */
export function matterShapes(boxes) {
  const shapes = [], groups = new Map();
  for (const b of boxes) {
    const c = b.center, z = b.size;
    if (z[0] !== CELL || z[1] !== CELL || z[2] !== CELL || ![0, 1, 2].every((k) => Number.isInteger(c[k] / CELL - .5))) { shapes.push({ ...b, partId: b.partId ?? `matter:${shapes.length}` }); continue; }
    const key = `${b.blockId}|${b.massKg}|${b.friction}|${b.collision !== false}`;
    let g = groups.get(key); if (!g) groups.set(key, g = { box: b, cells: [] });
    g.cells.push(Math.round(c[0] / CELL - .5), Math.round(c[1] / CELL - .5), Math.round(c[2] / CELL - .5));
  }
  for (const { box, cells } of groups.values()) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < cells.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], cells[i + k]); hi[k] = Math.max(hi[k], cells[i + k]); }
    const X = hi[0] - lo[0] + 1, Y = hi[1] - lo[1] + 1, Z = hi[2] - lo[2] + 1, solid = new Uint8Array(X * Y * Z);
    for (let i = 0; i < cells.length; i += 3) solid[(cells[i] - lo[0]) + (cells[i + 2] - lo[2]) * X + (cells[i + 1] - lo[1]) * X * Z] = 1;
    for (let y = 0; y < Y; y++) for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) {
      const i = x + z * X + y * X * Z; if (!solid[i]) continue;
      let w = 1, d = 1, h = 1;
      while (x + w < X && solid[i + w]) w++;
      depth: while (z + d < Z) { for (let k = 0; k < w; k++) if (!solid[i + k + d * X]) break depth; d++; }
      height: while (y + h < Y) { for (let c = 0; c < d; c++) for (let k = 0; k < w; k++) if (!solid[i + k + c * X + h * X * Z]) break height; h++; }
      for (let a = 0; a < h; a++) for (let c = 0; c < d; c++) for (let k = 0; k < w; k++) solid[i + k + c * X + a * X * Z] = 0;
      shapes.push({ center: [(lo[0] + x + w / 2) * CELL, (lo[1] + y + h / 2) * CELL, (lo[2] + z + d / 2) * CELL], size: [w * CELL, h * CELL, d * CELL],
        massKg: box.massKg * w * h * d, friction: box.friction, collision: box.collision, blockId: box.blockId, partId: `matter:${shapes.length}` });
    }
  }
  return shapes;
}
/** Detached world matter: dynamic compound cuboids with authored per-cell mass.
 * No machine functions, extra component mass, inventory grants or energy ledgers.
 * Holding, throwing and carry weight follow the frontier hand grip (impact.js gripLimits); the carrying
 * grapple is the frontier's powered grip. A wrench-pinned object is a fixed body that cannot be moved. */
export class ObjectPhysicsBridge {
  constructor(physics) { this.physics = physics; this.bodies = new Map(); this.held=null; this.pass = 0; }
  grab(id,point,{powered=false}={}){
    const p=this.physics.runtime.player,o=this.physics.runtime.objects.get(id),cache=this.bodies.get(id);
    if(!o||!cache||!point||!['x','y','z'].every(k=>Number.isFinite(point[k]))||Math.hypot(point.x-p.x,point.y-p.y,point.z-p.z)>(powered?6.5:4))return {ok:false,reason:'물체에 가까이 다가가세요.'};
    if(o.anchored)return {ok:false,reason:'고정된 물체입니다. 렌치로 풀어 주세요.'};
    const body=cache.entry.body,q=body.rotation(),v={x:point.x-o.position.x,y:point.y-o.position.y,z:point.z-o.position.z},eye=this.eye(p);
    // Held at the grab distance from the eye, 1.5–2.5 m (grapple 4 m); held matter slides (friction 0.35) until released.
    this.held={id,powered,local:this.rotate(v,{x:-q.x,y:-q.y,z:-q.z,w:q.w}),distance:Math.max(1.5,Math.min(powered?4:2.5,Math.hypot(point.x-eye.x,point.y-eye.y,point.z-eye.z))),friction:cache.entry.colliders.map(c=>c.friction())};
    for(const c of cache.entry.colliders)c.setFriction(.35);
    return {ok:true,massKg:o.massKg};
  }
  eye(p){return {x:p.x,y:p.y+(p.bodyHeight??1.5)*.9,z:p.z};}
  /** Carrying slows the player by the held mass (frontier: at most to 45%). */
  get speedScale(){const cache=this.bodies.get(this.held?.id);return cache?gripLimits(cache.entry.body.mass(),this.held.powered).speedScale:1;}
  rotate(v,q){const t={x:2*(q.y*v.z-q.z*v.y),y:2*(q.z*v.x-q.x*v.z),z:2*(q.x*v.y-q.y*v.x)};return {x:v.x+q.w*t.x+q.y*t.z-q.z*t.y,y:v.y+q.w*t.y+q.z*t.x-q.x*t.z,z:v.z+q.w*t.z+q.x*t.y-q.y*t.x};}
  release(){const cache=this.bodies.get(this.held?.id);if(cache)cache.entry.colliders.forEach((c,i)=>c.setFriction(this.held.friction?.[i]??.7));this.held=null;}
  /** Frontier push: an empty-handed strike shoves a piece along the view, up to three times its mass or 650 N·s
   * (the grapple 2200 N·s). Pinned pieces do not move. */
  push(id,point,{powered=false}={}){
    const cache=this.bodies.get(id),p=this.physics.runtime.player;if(!cache||!point)return {ok:false,reason:'target_missing'};
    if(this.physics.runtime.objects.get(id)?.anchored)return {ok:false,reason:'고정된 물체입니다. 렌치로 풀어 주세요.'};
    const body=cache.entry.body,pitch=p.pitch??0,d={x:-Math.sin(p.yaw)*Math.cos(pitch),y:Math.sin(pitch),z:-Math.cos(p.yaw)*Math.cos(pitch)},impulse=Math.min(body.mass()*3,powered?2200:650);
    body.applyImpulseAtPoint({x:d.x*impulse,y:d.y*impulse,z:d.z*impulse},point,true);return {ok:true,pushed:true,impulse};
  }
  /** Frontier throw: adds min(5, 1100 / mass) m/s along the view (grapple min(8, 4200 / mass)). */
  throwHeld(){
    const cache=this.bodies.get(this.held?.id),p=this.physics.runtime.player;if(!cache)return {ok:false,reason:'잡고 있는 물체가 없습니다.'};
    const body=cache.entry.body,mass=body.mass(),pitch=p.pitch??0,direction={x:-Math.sin(p.yaw)*Math.cos(pitch),y:Math.sin(pitch),z:-Math.cos(p.yaw)*Math.cos(pitch)},speed=gripLimits(mass,!!this.held.powered).throwSpeed;
    this.release();body.applyImpulse({x:direction.x*mass*speed,y:direction.y*mass*speed,z:direction.z*mass*speed},true);return {ok:true,speed};
  }
  /** Frontier hold spring: the grip point is pulled to the held distance along the view with 30 /s² per metre,
   * 9 /s damping and gravity compensated, the acceleration capped at min(45, 3500 N / mass); spin bleeds 6%
   * a step, and the grip lets go beyond 8 m or when the piece is pinned. The grapple grips with 22000 N. */
  prepare(dt){
    const held=this.held,cache=this.bodies.get(held?.id),p=this.physics.runtime.player;if(!held)return;
    if(!cache||p.hp<=0||this.physics.runtime.objects.get(held.id)?.anchored){this.release();return;}
    const body=cache.entry.body,offset=this.rotate(held.local,body.rotation()),origin=body.translation(),anchor={x:origin.x+offset.x,y:origin.y+offset.y,z:origin.z+offset.z};
    const eye=this.eye(p),pitch=p.pitch??0,target={x:eye.x-Math.sin(p.yaw)*Math.cos(pitch)*held.distance,y:eye.y+Math.sin(pitch)*held.distance,z:eye.z-Math.cos(p.yaw)*Math.cos(pitch)*held.distance};
    if(Math.hypot(target.x-anchor.x,target.y-anchor.y,target.z-anchor.z)>8){this.release();return;}
    const v=body.linvel(),w=body.angvel(),c=body.worldCom(),r={x:anchor.x-c.x,y:anchor.y-c.y,z:anchor.z-c.z},at={x:v.x+w.y*r.z-w.z*r.y,y:v.y+w.z*r.x-w.x*r.z,z:v.z+w.x*r.y-w.y*r.x};
    const mass=body.mass(),a={x:(target.x-anchor.x)*30-at.x*9,y:(target.y-anchor.y)*30-at.y*9+9.81,z:(target.z-anchor.z)*30-at.z*9};
    const scale=Math.min(1,Math.min(45,gripLimits(mass,held.powered).force/mass)/Math.max(1,Math.hypot(a.x,a.y,a.z)))*mass*dt;
    body.applyImpulseAtPoint({x:a.x*scale,y:a.y*scale,z:a.z*scale},anchor,true);
    body.setAngvel({x:w.x*.94,y:w.y*.94,z:w.z*.94},true);
  }
  sync() {
    const player = this.physics.runtime.player, pass = ++this.pass;
    for (const object of this.physics.runtime.objects?.physicsBodies?.() ?? []) {
      const dx = object.position.x - player.x, dz = object.position.z - player.z;
      if (!object.boxes?.length || dx * dx + dz * dz > 64 * 64) continue;
      let cache = this.bodies.get(object.id);
      // The colliders change only with the object's cells (WorldObjects._build makes a new boxes array) or its pin:
      // nothing is compared or rebuilt while a piece only moves or a cell only loses health.
      if (cache && cache.boxes === object.boxes && cache.anchored === !!object.anchored) { cache.seen = pass; continue; }
      if (cache) this.physics.adapter.removeOwner(object.id);
      const mass = object.boxes.reduce((sum, b) => sum + b.massKg, 0);
      if (!Number.isFinite(mass) || mass <= 0) throw new TypeError('Object requires finite authored cell mass');
      const fixed = !!object.anchored, shapes = matterShapes(object.boxes), entry = this.physics.adapter.addBody({ ownerId: object.id, partId: 'matter', type: fixed ? 'fixed' : 'dynamic', boxes: shapes,
        position: [object.position.x, object.position.y, object.position.z], rotation: object.rotation, mass: fixed ? 0 : mass });
      for (let i = 0; i < entry.colliders.length; i++) {
        const collider = entry.colliders[i], box = shapes[i];
        if (!Number.isFinite(box.massKg) || box.massKg <= 0) throw new TypeError('Invalid object cell mass');
        if (!fixed) collider.setMass(box.massKg); if (box.collision === false) collider.setSensor(true);
        this.physics.adapter.colliderOwners.set(collider.handle, Object.freeze({ ownerId: object.id, partId: box.partId, bodyHandle: entry.body.handle }));
      }
      if (!fixed) {
        this.physics.watchImpacts?.(entry.colliders, mass);
        entry.body.recomputeMassPropertiesFromColliders();
        entry.body.setLinvel(object.velocity ?? { x: 0, y: 0, z: 0 }, true);
        entry.body.setAngvel(object.angularVelocity ?? { x: 0, y: 0, z: 0 }, true);
      }
      this.bodies.set(object.id, { boxes: object.boxes, anchored: fixed, entry, seen: pass });
    }
    // Pieces out of reach or gone this pass lose their bodies (deleting during Map iteration is safe).
    for (const [id, cache] of this.bodies) if (cache.seen !== pass) { this.physics.adapter.removeOwner(id); this.bodies.delete(id); }
  }
  /** Poses back to the registry each step; a sleeping body has not moved since. */
  capture() {
    const objects = this.physics.runtime.objects;
    for (const [id, { entry }] of this.bodies) if (!entry.body.isSleeping()) objects?.setPhysicsPose(id, {
      position: entry.body.translation(), rotation: entry.body.rotation(), velocity: entry.body.linvel(), angularVelocity: entry.body.angvel(),
    });
  }
  dispose() { this.capture(); for (const id of this.bodies.keys()) this.physics.adapter.removeOwner(id); this.bodies.clear(); }
}
