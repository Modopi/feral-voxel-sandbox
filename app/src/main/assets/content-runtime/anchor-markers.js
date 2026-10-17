import * as T from '../vendor/three.module.js';

const COLORS = { salvage: '#9fd8c4', archive: '#c9b8f2', boss: '#f2cf7a' }, RANGE = 120, REFRESH_S = .5;
const point = v => Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : v;
const dist = (a, b) => Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z);

/** Cosmetic only: marks unclaimed dungeon rewards. It never supplies collision, aim targets or claims. */
export class AnchorMarkers {
  constructor(view) {
    this.scene = view.scene ?? view; this.root = new T.Group(); this.root.name = 'reward-markers'; this.root.userData.collision = false; this.scene.add(this.root);
    this.ring = new T.RingGeometry(.55, .68, 32); this.ring.rotateX(-Math.PI / 2);
    this.beam = new T.CylinderGeometry(.045, .045, 3.2, 8, 1, true); this.beam.translate(0, 1.6, 0);
    this.materials = new Map(Object.entries(COLORS).map(([channel, color]) => [channel, new T.MeshBasicMaterial({ color, transparent: true, opacity: .5, side: T.DoubleSide, depthWrite: false, toneMapped: false })]));
    this.markers = new Map(); this.time = 0; this.clock = REFRESH_S;
  }
  wanted(runtime) {
    const out = new Map();
    for (const instance of runtime.nearbyStructures ?? []) for (const a of runtime.dungeons.anchors(instance.id)) {
      const position = point(a.position);
      if (a.kind !== 'reward' || a.claimed || (a.channel === 'boss' && !instance.boss?.defeated) || dist(runtime.player, position) > RANGE) continue;
      out.set(a.id, { ...a, position });
    }
    return out;
  }
  sync(runtime, dt) {
    this.time += dt; this.clock += dt;
    if (this.clock >= REFRESH_S) {
      this.clock = 0; const wanted = this.wanted(runtime);
      for (const [id, marker] of this.markers) if (!wanted.has(id)) { this.root.remove(marker); this.markers.delete(id); }
      for (const [id, a] of wanted) {
        if (this.markers.has(id)) continue;
        const material = this.materials.get(a.channel) ?? this.materials.get('salvage'), group = new T.Group();
        group.name = `reward:${id}`; group.userData = { kind: 'reward_marker', anchorId: id, collision: false };
        group.add(new T.Mesh(this.ring, material), new T.Mesh(this.beam, material));
        group.position.set(a.position.x, a.position.y + .03, a.position.z); this.root.add(group); this.markers.set(id, group);
      }
    }
    const pulse = 1 + Math.sin(this.time * 3) * .08;
    for (const marker of this.markers.values()) marker.scale.set(pulse, 1, pulse);
    return this.markers.size;
  }
  dispose() { this.scene.remove(this.root); this.ring.dispose(); this.beam.dispose(); for (const m of this.materials.values()) m.dispose(); this.markers.clear(); }
}
