import * as T from '../vendor/three.module.js';

const styles = {
  windup: { color: 0xe3ae45, opacity: .16 },
  flight: { color: 0xcfad56, opacity: .12 },
  active: { color: 0xdb553e, opacity: .26 },
  recovery: { color: 0x90a99a, opacity: .045 },
};
const vector = (v) => new T.Vector3(v.x, v.y, v.z);
const clone = (v) => JSON.parse(JSON.stringify(v));
const visible = (node) => { for (let p = node; p; p = p.parent) if (!p.visible) return false; return true; };
const mesh = (g, m) => { const value = new T.Mesh(g, m); value.renderOrder = 3; return value; };
function release(node) {
  const materials = new Set();
  node.traverse((child) => { child.geometry?.dispose(); if (child.material) materials.add(child.material); });
  for (const material of materials) material.dispose();
  node.removeFromParent();
}
function material(color, opacity, wireframe = false) {
  return new T.MeshBasicMaterial({ color, opacity, transparent: opacity < 1, depthWrite: opacity >= 1,
    side: T.DoubleSide, wireframe, toneMapped: false });
}
/** Same world-space volumes used by BossSystem; metadata is a copy, never a gameplay source.
 * Shapes stay volumetric: pitched beams and flight height are visible, ring holes stay empty.
 */
function volume(shape, mat) {
  const node = new T.Group();
  if (shape.kind === 'sphere') node.add(mesh(new T.SphereGeometry(shape.radiusM, 24, 16), mat));
  else if (shape.kind === 'cylinder') node.add(mesh(new T.CylinderGeometry(shape.radiusM, shape.radiusM, shape.heightM, 48), mat));
  else if (shape.kind === 'annular_cylinder') {
    const outer = shape.outerRadiusM, inner = shape.innerRadiusM, h = shape.heightM;
    // Four open surfaces rather than a filled cylinder: no triangles cross the safe hole.
    for (const y of [-h / 2, h / 2]) {
      const cap = mesh(new T.RingGeometry(inner, outer, 64), mat);
      cap.rotation.x = Math.PI / 2; cap.position.y = y; node.add(cap);
    }
    for (const r of [inner, outer]) node.add(mesh(new T.CylinderGeometry(r, r, h, 64, 1, true), mat));
  } else if (shape.kind === 'oriented_box') {
    const size = shape.halfSize?.map((v) => v * 2) ?? [shape.widthM, shape.heightM, shape.lengthM];
    node.add(mesh(new T.BoxGeometry(...size), mat));
    if (shape.axes) node.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(...shape.axes.map(vector)));
  } else throw new Error(`Unknown boss shape ${shape.kind}`);
  node.position.copy(vector(shape.center));
  node.userData.shape = clone(shape); node.userData.collision = false;
  return node;
}

// Sparse exact sphere boundaries stay legible from inside the target volume.
// These are annotations only: neither floor rings nor countdowns are hit shapes.
function sphereGuides(shape, floorY, color) {
  const group = new T.Group(); group.name = 'sphere-guides';
  group.position.copy(vector(shape.center));
  group.userData = { decorativeOnly:true, collision:false, radiusM:shape.radiusM, floorY };
  const r=shape.radiusM, points=[];
  for(let i=0;i<=96;i++){const a=i/96*Math.PI*2;points.push(new T.Vector3(Math.cos(a)*r,Math.sin(a)*r,0));}
  for(let axis=0;axis<3;axis++){
    const line=new T.Line(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color,transparent:true,opacity:.7,toneMapped:false,depthWrite:false}));
    if(axis===1)line.rotation.x=Math.PI/2;if(axis===2)line.rotation.y=Math.PI/2;
    line.name='sphere-height-boundary';line.renderOrder=4;group.add(line);
  }
  const offset=floorY-shape.center.y;
  if(Math.abs(offset)<r){
    const radius=Math.sqrt(r*r-offset*offset);
    const boundary=mesh(new T.RingGeometry(Math.max(0,radius-.045),radius,96),material(color,.72));
    boundary.name='floor-boundary';boundary.rotation.x=-Math.PI/2;boundary.position.y=offset+.018;
    boundary.userData={radiusM:radius,collision:false,decorativeOnly:true};group.add(boundary);
    const timer=mesh(new T.RingGeometry(Math.max(0,radius-.12),Math.max(0,radius-.065),96),material(0xffe0a0,.9));
    timer.name='impact-countdown';timer.rotation.x=-Math.PI/2;timer.position.y=offset+.022;timer.renderOrder=5;
    timer.userData={fullIndexCount:timer.geometry.index.count,collision:false,decorativeOnly:true};group.add(timer);
  }
  return group;
}

/** DOM/WebGL-independent view bridge. Only creates Three nodes; it never advances simulation. */
export class BossView {
  constructor(scene) {
    this.scene = scene;
    this.group = new T.Group(); this.group.name = 'boss-combat-volumes';
    (scene.scene ?? scene).add(this.group);
    this.hazards = new Map(); this.effects = new Map(); this.markers = new Map();
  }
  reconcile(map, rows, make) {
    const alive = new Set();
    for (const row of rows) {
      alive.add(row.key);
      let value = map.get(row.key);
      if (!value || value.signature !== row.signature) {
        if (value) release(value.node);
        const node = make(row); this.group.add(node);
        value = { node, signature: row.signature }; map.set(row.key, value);
      }
      row.update?.(value.node);
    }
    for (const [key, value] of map) if (!alive.has(key)) { release(value.node); map.delete(key); }
  }
  sync(system) {
    const telegraphs = system.getTelegraphs();
    const observerPosition = this.scene.camera?.getWorldPosition(new T.Vector3());
    for (const e of system.entities.values()) if (!e.defeated && e.cast?.stage === 'recovery') {
      telegraphs.push({ bossId: e.id, skillId: e.cast.skillId, stage: 'recovery', shape: e.cast.shape, remainingS: e.cast.remaining });
    }
    this.reconcile(this.hazards, telegraphs.map((t) => {
      const entity=system.entities.get(t.bossId), cast=entity?.cast;
      const floorY=entity?.arenaOrigin?.y ?? t.shape.center.y-t.shape.radiusM;
      const travelS=t.shape.kind==='sphere' && cast?.origin ? vector(cast.origin).distanceTo(vector(t.shape.center))/12 : 0;
      const totalS=(cast?.windupS ?? t.remainingS)+travelS;
      const untilImpactS=t.stage==='windup'?t.remainingS+travelS:t.stage==='flight'?t.remainingS:0;
      return { key: t.bossId,
      signature: JSON.stringify([t.skillId, t.stage, t.shape, floorY]), source: {...t,floorY},
      update(node) {
        node.userData.remainingS = t.remainingS;
        node.userData.untilImpactS = untilImpactS;
        if(t.shape.kind==='sphere'){
          const inside=observerPosition && observerPosition.distanceTo(vector(t.shape.center))<t.shape.radiusM;
          // A camera inside two-sided transparent geometry otherwise receives
          // a full-screen tint that obscures both boss animation and escape.
          node.children[0].children[0].material.opacity=inside ? (t.stage==='active'?.025:.008) : Math.min(styles[t.stage].opacity,.07);
          node.userData.observerInside=!!inside;
          const timer=node.getObjectByName('impact-countdown');
          if(timer){const fraction=Math.max(0,Math.min(1,untilImpactS/Math.max(.001,totalS)));
            timer.geometry.setDrawRange(0,Math.floor(fraction*96)*6);timer.userData.fraction=fraction;}
        }
        const projectile = node.getObjectByName('projectile');
        if (projectile && t.projectilePosition) projectile.position.copy(vector(t.projectilePosition));
      },
    }; }), ({ source: t }) => {
      const root = new T.Group(), s = styles[t.stage];
      root.userData = { bossId: t.bossId, skillId: t.skillId, stage: t.stage, collision: false };
      root.add(volume(t.shape, material(s.color, s.opacity, t.stage === 'recovery')));
      if(t.shape.kind==='sphere')root.add(sphereGuides(t.shape,t.floorY,s.color));
      if (t.projectilePosition) {
        const projectile = mesh(new T.SphereGeometry(.15, 12, 8), material(0xe6b76b, 1));
        projectile.name = 'projectile'; projectile.userData.collision = false; root.add(projectile);
      }
      return root;
    });
    const effects = system.getWorldEffects();
    this.reconcile(this.effects, effects.map((e) => ({ key: `${e.bossId}:${e.type}:${e.gimmickId ?? 'basin'}`,
      signature: JSON.stringify(e), source: e })), ({ source: e }) => {
      const size = ['x', 'y', 'z'].map((k) => e.max[k] - e.min[k]);
      const node = mesh(new T.BoxGeometry(...size), material(e.type === 'water' ? 0x718d68 : 0x526c39, e.type === 'water' ? .32 : 1));
      node.position.set(...['x', 'y', 'z'].map((k) => (e.max[k] + e.min[k]) / 2));
      node.userData = { ...clone(e), collision: e.type === 'solid', gameplaySource: 'BossSystem.getWorldEffects' };
      return node;
    });
    const markers = [];
    const observer = this.scene.camera?.getWorldPosition(new T.Vector3());
    for (const e of system.entities.values()) {
      if (e.defeated) continue;
      const model = this.scene.models?.get(e.id); if (!model) continue;
      model.group.updateMatrixWorld(true);
      const phase = system.phase(e), exposed = system.coreExposed(e, observer), broken = e.parts.core.broken;
      for (const anchor of model.asset.anchors ?? []) {
        if (!anchor.purpose.includes('weak_point')) continue;
        const part = model.parts.get(anchor.partId); if (!part || !visible(part)) continue;
        const position = new T.Vector3(...anchor.position).applyMatrix4(part.matrixWorld);
        const state = broken ? 'broken' : exposed ? 'exposed' : 'protected';
        markers.push({ key: `${e.id}:${anchor.id}`, signature: `${phase.id}:${state}`, source: { e, anchor, phase, state },
          update(node) { node.position.copy(position); } });
      }
    }
    this.reconcile(this.markers, markers, ({ source: { e, anchor, phase, state } }) => {
      const color = state === 'broken' ? 0x777b75 : state === 'exposed' ? 0x83c4b0 : 0xa9915e;
      const node = mesh(new T.SphereGeometry(state === 'exposed' ? .21 : .14, 12, 8), material(color, state === 'exposed' ? .7 : .3, true));
      node.userData = { bossId: e.id, anchorId: anchor.id, phaseId: phase.id, behavior: phase.state.behavior,
        state, collision: false, decorativeOnly: true };
      return node;
    });
    return { hazards: this.hazards.size, effects: this.effects.size, markers: this.markers.size };
  }
  dispose() {
    for (const map of [this.hazards, this.effects, this.markers]) { for (const { node } of map.values()) release(node); map.clear(); }
    this.group.removeFromParent();
  }
}
