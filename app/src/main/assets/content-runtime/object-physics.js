/** Detached world matter: dynamic compound cuboids with authored per-cell mass.
 * No machine functions, extra component mass, inventory grants or energy ledgers. */
export class ObjectPhysicsBridge {
  constructor(physics) { this.physics = physics; this.bodies = new Map(); this.held=null; }
  grab(id,point){
    const p=this.physics.runtime.player,o=this.physics.runtime.objects.get(id),cache=this.bodies.get(id);
    if(!o||!cache||!point||!['x','y','z'].every(k=>Number.isFinite(point[k]))||Math.hypot(point.x-p.x,point.y-p.y,point.z-p.z)>4)return {ok:false,reason:'물체에 가까이 다가가세요.'};
    const body=cache.entry.body,q=body.rotation(),v={x:point.x-o.position.x,y:point.y-o.position.y,z:point.z-o.position.z};
    this.held={id,local:this.rotate(v,{x:-q.x,y:-q.y,z:-q.z,w:q.w})};return {ok:true,massKg:o.massKg};
  }
  rotate(v,q){const t={x:2*(q.y*v.z-q.z*v.y),y:2*(q.z*v.x-q.x*v.z),z:2*(q.x*v.y-q.y*v.x)};return {x:v.x+q.w*t.x+q.y*t.z-q.z*t.y,y:v.y+q.w*t.y+q.z*t.x-q.x*t.z,z:v.z+q.w*t.z+q.x*t.y-q.y*t.x};}
  release(){this.held=null;}
  /** Frontier push: an empty-handed strike shoves a piece along the view, up to three times its mass or 650 N·s. */
  push(id,point){
    const cache=this.bodies.get(id),p=this.physics.runtime.player;if(!cache||!point)return {ok:false,reason:'target_missing'};
    const body=cache.entry.body,pitch=p.pitch??0,d={x:-Math.sin(p.yaw)*Math.cos(pitch),y:Math.sin(pitch),z:-Math.cos(p.yaw)*Math.cos(pitch)},impulse=Math.min(body.mass()*3,650);
    body.applyImpulseAtPoint({x:d.x*impulse,y:d.y*impulse,z:d.z*impulse},point,true);return {ok:true,pushed:true,impulse};
  }
  throwHeld(){
    const cache=this.bodies.get(this.held?.id),p=this.physics.runtime.player;if(!cache)return {ok:false,reason:'잡고 있는 물체가 없습니다.'};
    const body=cache.entry.body,mass=body.mass(),pitch=p.pitch??0,direction={x:-Math.sin(p.yaw)*Math.cos(pitch),y:Math.sin(pitch),z:-Math.cos(p.yaw)*Math.cos(pitch)},velocity=body.linvel();
    const along=direction.x*velocity.x+direction.y*velocity.y+direction.z*velocity.z,speed=Math.min(8,-along+Math.sqrt(along*along+600/mass));
    body.applyImpulse({x:direction.x*mass*speed,y:direction.y*mass*speed,z:direction.z*mass*speed},true);this.release();return {ok:true};
  }
  prepare(dt){
    const held=this.held,cache=this.bodies.get(held?.id),p=this.physics.runtime.player;if(!held)return;
    if(!cache||p.hp<=0){this.release();return;}
    const body=cache.entry.body,offset=this.rotate(held.local,body.rotation()),origin=body.translation(),anchor={x:origin.x+offset.x,y:origin.y+offset.y,z:origin.z+offset.z};
    const eye={x:p.x,y:p.y+(p.bodyHeight??1.5)*.9,z:p.z};if(Math.hypot(anchor.x-eye.x,anchor.y-eye.y,anchor.z-eye.z)>6){this.release();return;}
    const target={x:eye.x-Math.sin(p.yaw)*Math.cos(p.pitch??0)*2,y:eye.y+Math.sin(p.pitch??0)*2,z:eye.z-Math.cos(p.yaw)*Math.cos(p.pitch??0)*2};
    const velocity=body.linvel(),force={};for(const k of ['x','y','z'])force[k]=(target[k]-anchor[k])*650-velocity[k]*90;
    const scale=Math.min(1,1800/Math.max(1,Math.hypot(force.x,force.y,force.z)));for(const k of ['x','y','z'])force[k]*=scale*dt;
    body.applyImpulseAtPoint(force,anchor,true);
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
