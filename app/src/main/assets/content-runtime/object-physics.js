import { gripLimits } from '../impact.js';
/** Detached world matter: dynamic compound cuboids with authored per-cell mass.
 * No machine functions, extra component mass, inventory grants or energy ledgers.
 * Holding, throwing and carry weight follow the frontier hand grip (impact.js gripLimits). */
export class ObjectPhysicsBridge {
  constructor(physics) { this.physics = physics; this.bodies = new Map(); this.held=null; }
  grab(id,point){
    const p=this.physics.runtime.player,o=this.physics.runtime.objects.get(id),cache=this.bodies.get(id);
    if(!o||!cache||!point||!['x','y','z'].every(k=>Number.isFinite(point[k]))||Math.hypot(point.x-p.x,point.y-p.y,point.z-p.z)>4)return {ok:false,reason:'물체에 가까이 다가가세요.'};
    const body=cache.entry.body,q=body.rotation(),v={x:point.x-o.position.x,y:point.y-o.position.y,z:point.z-o.position.z},eye=this.eye(p);
    // Held at the grab distance from the eye, 1.5–2.5 m; held matter slides (friction 0.35) until released.
    this.held={id,local:this.rotate(v,{x:-q.x,y:-q.y,z:-q.z,w:q.w}),distance:Math.max(1.5,Math.min(2.5,Math.hypot(point.x-eye.x,point.y-eye.y,point.z-eye.z))),friction:cache.entry.colliders.map(c=>c.friction())};
    for(const c of cache.entry.colliders)c.setFriction(.35);
    return {ok:true,massKg:o.massKg};
  }
  eye(p){return {x:p.x,y:p.y+(p.bodyHeight??1.5)*.9,z:p.z};}
  /** Carrying slows the player by the held mass (frontier: at most to 45%). */
  get speedScale(){const cache=this.bodies.get(this.held?.id);return cache?gripLimits(cache.entry.body.mass(),false).speedScale:1;}
  rotate(v,q){const t={x:2*(q.y*v.z-q.z*v.y),y:2*(q.z*v.x-q.x*v.z),z:2*(q.x*v.y-q.y*v.x)};return {x:v.x+q.w*t.x+q.y*t.z-q.z*t.y,y:v.y+q.w*t.y+q.z*t.x-q.x*t.z,z:v.z+q.w*t.z+q.x*t.y-q.y*t.x};}
  release(){const cache=this.bodies.get(this.held?.id);if(cache)cache.entry.colliders.forEach((c,i)=>c.setFriction(this.held.friction?.[i]??.7));this.held=null;}
  /** Frontier push: an empty-handed strike shoves a piece along the view, up to three times its mass or 650 N·s. */
  push(id,point){
    const cache=this.bodies.get(id),p=this.physics.runtime.player;if(!cache||!point)return {ok:false,reason:'target_missing'};
    const body=cache.entry.body,pitch=p.pitch??0,d={x:-Math.sin(p.yaw)*Math.cos(pitch),y:Math.sin(pitch),z:-Math.cos(p.yaw)*Math.cos(pitch)},impulse=Math.min(body.mass()*3,650);
    body.applyImpulseAtPoint({x:d.x*impulse,y:d.y*impulse,z:d.z*impulse},point,true);return {ok:true,pushed:true,impulse};
  }
  /** Frontier throw: adds min(5, 1100 / mass) m/s along the view. */
  throwHeld(){
    const cache=this.bodies.get(this.held?.id),p=this.physics.runtime.player;if(!cache)return {ok:false,reason:'잡고 있는 물체가 없습니다.'};
    const body=cache.entry.body,mass=body.mass(),pitch=p.pitch??0,direction={x:-Math.sin(p.yaw)*Math.cos(pitch),y:Math.sin(pitch),z:-Math.cos(p.yaw)*Math.cos(pitch)},speed=gripLimits(mass,false).throwSpeed;
    this.release();body.applyImpulse({x:direction.x*mass*speed,y:direction.y*mass*speed,z:direction.z*mass*speed},true);return {ok:true,speed};
  }
  /** Frontier hold spring: the grip point is pulled to the held distance along the view with 30 /s² per metre,
   * 9 /s damping and gravity compensated, the acceleration capped at min(45, 3500 N / mass); spin bleeds 6%
   * a step, and the grip lets go beyond 8 m. */
  prepare(dt){
    const held=this.held,cache=this.bodies.get(held?.id),p=this.physics.runtime.player;if(!held)return;
    if(!cache||p.hp<=0){this.release();return;}
    const body=cache.entry.body,offset=this.rotate(held.local,body.rotation()),origin=body.translation(),anchor={x:origin.x+offset.x,y:origin.y+offset.y,z:origin.z+offset.z};
    const eye=this.eye(p),pitch=p.pitch??0,target={x:eye.x-Math.sin(p.yaw)*Math.cos(pitch)*held.distance,y:eye.y+Math.sin(pitch)*held.distance,z:eye.z-Math.cos(p.yaw)*Math.cos(pitch)*held.distance};
    if(Math.hypot(target.x-anchor.x,target.y-anchor.y,target.z-anchor.z)>8){this.release();return;}
    const v=body.linvel(),w=body.angvel(),c=body.worldCom(),r={x:anchor.x-c.x,y:anchor.y-c.y,z:anchor.z-c.z},at={x:v.x+w.y*r.z-w.z*r.y,y:v.y+w.z*r.x-w.x*r.z,z:v.z+w.x*r.y-w.y*r.x};
    const mass=body.mass(),a={x:(target.x-anchor.x)*30-at.x*9,y:(target.y-anchor.y)*30-at.y*9+9.81,z:(target.z-anchor.z)*30-at.z*9};
    const scale=Math.min(1,Math.min(45,gripLimits(mass,false).force/mass)/Math.max(1,Math.hypot(a.x,a.y,a.z)))*mass*dt;
    body.applyImpulseAtPoint({x:a.x*scale,y:a.y*scale,z:a.z*scale},anchor,true);
    body.setAngvel({x:w.x*.94,y:w.y*.94,z:w.z*.94},true);
  }
  sync() {
    const system = this.physics.runtime.objects, player = this.physics.runtime.player, alive = new Set();
    for (const object of system?.physicsBodies?.() ?? []) {
      if (!object.boxes.length || Math.hypot(object.position.x - player.x, object.position.z - player.z) > 64) continue;
      alive.add(object.id);
      const signature = JSON.stringify(object.boxes); let cache = this.bodies.get(object.id);
      if (cache?.signature === signature) continue;
      if (cache) this.physics.adapter.removeOwner(object.id);
      const mass = object.boxes.reduce((sum, b) => sum + b.massKg, 0);
      if (!Number.isFinite(mass) || mass <= 0) throw new TypeError('Object requires finite authored cell mass');
      const entry = this.physics.adapter.addBody({ ownerId: object.id, partId: 'matter', type: 'dynamic', boxes: object.boxes,
        position: [object.position.x, object.position.y, object.position.z], rotation: object.rotation, mass });
      for (let i = 0; i < entry.colliders.length; i++) {
        const collider = entry.colliders[i], box = object.boxes[i];
        if (!Number.isFinite(box.massKg) || box.massKg <= 0) throw new TypeError('Invalid object cell mass');
        collider.setMass(box.massKg); if (box.collision === false) collider.setSensor(true);
        this.physics.adapter.colliderOwners.set(collider.handle, Object.freeze({ ownerId: object.id, partId: box.partId ?? `cell:${i}`, bodyHandle: entry.body.handle }));
      }
      entry.body.recomputeMassPropertiesFromColliders();
      entry.body.setLinvel(object.velocity ?? { x: 0, y: 0, z: 0 }, true);
      entry.body.setAngvel(object.angularVelocity ?? { x: 0, y: 0, z: 0 }, true);
      this.bodies.set(object.id, { signature, entry });
    }
    for (const id of this.bodies.keys()) if (!alive.has(id)) { this.physics.adapter.removeOwner(id); this.bodies.delete(id); }
  }
  capture() {
    for (const [id, { entry }] of this.bodies) this.physics.runtime.objects?.setPhysicsPose(id, {
      position: { ...entry.body.translation() }, rotation: { ...entry.body.rotation() },
      velocity: { ...entry.body.linvel() }, angularVelocity: { ...entry.body.angvel() },
    });
  }
  dispose() { this.capture(); for (const id of this.bodies.keys()) this.physics.adapter.removeOwner(id); this.bodies.clear(); }
}
