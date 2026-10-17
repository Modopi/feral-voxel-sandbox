/** Falling installed machines use the same SDK-authored local cuboids and owner.
 * Total mass is the consumed recipe's material mass; inertia distribution within
 * that rigid assembly is proportional to visual solid volume (explicit approximation).
 * The parent RuntimePhysics owns world stepping, terrain streaming and disposal order.
 */
export class FixturePhysicsBridge {
  constructor(physics){this.physics=physics;this.bodies=new Map();this.supportRevision=null;}
  sync(){
    const placements=this.physics.runtime.placements;if(!placements)return;
    const revision=String(this.physics.runtime.atlas?.revision??'')+':'+String([...(this.physics.runtime.dungeons?.instances?.values?.()??[])].map(i=>i.revision).join(','));
    if(revision!==this.supportRevision){for(const {entry}of this.bodies.values())entry.body.wakeUp();this.supportRevision=revision;}
    placements.checkSupports();const player=this.physics.runtime.player??{x:0,z:0},alive=new Set();
    for(const fixture of placements.physicsBodies()){
      if(Math.hypot(fixture.position.x-player.x,fixture.position.z-player.z)>64)continue;
      alive.add(fixture.id);const signature=JSON.stringify([fixture.assetId,fixture.boxes]);let cache=this.bodies.get(fixture.id);
      if(cache?.signature===signature)continue;
      // Remove the previous fixed owner exactly once, before adding its dynamic replacement.
      if(cache){this._capture(fixture.id,cache.entry);this.physics.adapter.removeOwner(fixture.id);}
      else if(this.physics.fixtures?.has(fixture.id)){this.physics.adapter.removeOwner(fixture.id);this.physics.fixtures.delete(fixture.id);}
      if(!Number.isFinite(fixture.massKg)||fixture.massKg<=0)throw Error('Fixture mass must come from its authored recipe');
      const entry=this.physics.adapter.addBody({ownerId:fixture.id,partId:'fixture_assembly',type:'dynamic',boxes:fixture.boxes,
        position:[fixture.position.x,fixture.position.y,fixture.position.z],rotation:fixture.rotation,mass:fixture.massKg,friction:.7,restitution:0});
      for(let i=0;i<entry.colliders.length;i++){
        const collider=entry.colliders[i],box=fixture.boxes[i];collider.setMass(box.massKg);
        this.physics.adapter.colliderOwners.set(collider.handle,Object.freeze({ownerId:fixture.id,partId:box.partId,materialId:box.material,bodyHandle:entry.body.handle}));
      }
      entry.body.recomputeMassPropertiesFromColliders();entry.body.setLinvel(fixture.velocity,true);entry.body.setAngvel(fixture.angularVelocity,true);
      entry.body.setLinearDamping(.08);entry.body.setAngularDamping(.15);
      // Never restore a sleeping unsupported object: terrain may have changed while unloaded.
      this.bodies.set(fixture.id,{signature,entry});
    }
    for(const [id,cache]of this.bodies)if(!alive.has(id)){this._capture(id,cache.entry);this.physics.adapter.removeOwner(id);this.bodies.delete(id);}
  }
  _capture(id,entry){this.physics.runtime.placements?.setPhysicsPose(id,{position:{...entry.body.translation()},rotation:{...entry.body.rotation()},
    velocity:{...entry.body.linvel()},angularVelocity:{...entry.body.angvel()},settled:entry.body.isSleeping()});}
  capture(){for(const [id,{entry}]of this.bodies)this._capture(id,entry);}
  dispose(){this.capture();for(const id of this.bodies.keys())this.physics.adapter.removeOwner(id);this.bodies.clear();}
}
