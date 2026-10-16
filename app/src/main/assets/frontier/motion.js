// Terrain-aware prototype vehicle rules, independent of rendering and input devices.
import { evaluate, damage } from "../machine/model.js";
export class FrontierMotion {
  constructor(context) {
    this.c = context;
  }
  beforeStep(input, dt) {
    const { model: s, inventory: inv, player: p } = this.c;
    this.oldPosition = { x: p.x, y: p.y, z: p.z };
    s.provisionMachine(inv);
    p.flying = !!(s.riding && s.airborne);
    if (!s.riding) return { ...input, speedScale: 1 };
    const f = evaluate(s.machine);
    // Prototype vehicle motion shares the terrain collision controller. Power/mass and
    // damaged connected components govern speed; no rigid-body suspension is implied.
    const scale =
      Math.min(2.5, f.power / f.mass / 2) *
      (s.airborne ? Math.min(1, f.lift / 2) : f.grip);
    this.speed = scale * 3.2;
    this.vehicleMoving = Math.hypot(input.forward || 0, input.side || 0) > 0.05;
    return {
      ...input,
      sprint: false,
      jump: s.airborne && input.jump,
      speedScale: scale,
    };
  }
  afterStep(dt) {
    const { model: s, inventory: inv, player: p, world } = this.c;
    if (s.riding && this.oldPosition) {
      const f = evaluate(s.machine),
        radius = f.radius,
        old = this.oldPosition;
      let blocked = false;
      for (const x of [-radius, 0, radius])
        for (const z of [-radius, 0, radius]) {
          const xx = Math.floor(p.x + x),
            zz = Math.floor(p.z + z);
          if (xx < 1 || zz < 1 || xx > 158 || zz > 158) blocked = true;
          const floor = world.surface(xx, zz);
          if (!s.airborne && floor > old.y + 1.1) blocked = true;
          if (s.airborne && world.get(xx, Math.floor(p.y + 0.5), zz))
            blocked = true;
        }
      if (blocked) {
        p.x = old.x;
        p.z = old.z;
        if (s.airborne) p.y = old.y;
        if (
          (this.collisionClock || 0) <= s.time &&
          this.speed > 2 &&
          this.vehicleMoving
        ) {
          const part =
            s.machine.blueprint.find(
              (v) => s.machine.hp[v.id] > 0 && v.type === "wheel",
            ) || s.machine.blueprint[0];
          if (part) damage(s.machine, part.id, 3);
          this.collisionClock = s.time + 1;
        }
      }
    }
    const event = s.tick(dt, p, inv);
    if (!s.riding) p.flying = false;
    return event;
  }
}
