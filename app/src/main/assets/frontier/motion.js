import {
  AssemblyPhysics,
  initialPose,
  worldPoint,
} from "../machine/assembly-physics.js";
import { evaluate } from "../machine/model.js";
export class FrontierMotion {
  constructor(context) {
    this.c = context;
  }
  prepare() {
    const { model: s, inventory, world } = this.c;
    s.provisionMachine(inventory);
    if (this.terrain !== world) {
      this.physics?.dispose();
      this.physics = new AssemblyPhysics(world);
      this.terrain = world;
    }
    if (s.machine && !s.machine.pose) {
      s.machine.pose = initialPose(
        77.5,
        world.surface(77.5, 87.5) + 0.05,
        87.5,
        s.key,
      );
      s.machine.assembly = true;
    }
    return s.machine?.pose.region === s.key ? s.machine : null;
  }
  beforeStep(input, dt) {
    const s = this.c.model,
      machine = this.prepare();
    this.wasRiding = s.riding;
    this.previous = {
      x: this.c.player.x,
      y: this.c.player.y,
      z: this.c.player.z,
    };
    if (machine) {
      if (s.riding) machine.pose.anchored = false;
      this.physics.step(machine, dt, input, s.riding, s.airborne);
    } else s.riding = s.airborne = false;
    if (s.riding) this.c.player.flying = false;
    return { ...input, speedScale: 1 };
  }
  afterStep(dt) {
    const { model: s, inventory, player: p } = this.c;
    if (
      !s.riding &&
      s.machine?.pose.region === s.key &&
      this.previous &&
      !p.flying
    )
      this.physics.moveCharacter(this.previous, p);
    if (s.riding && s.machine?.pose) {
      const seat = worldPoint(s.machine.pose, { x: 0, y: 1.05, z: 0 });
      Object.assign(p, seat, { vy: 0, grounded: false });
    }
    const event = s.tick(dt, p, inventory);
    if (this.wasRiding && !s.riding && event !== "respawn") this.dismount();
    return event;
  }
  dismount() {
    const { model: s, world, player: p } = this.c;
    if (!s.machine?.pose) return;
    const radius = evaluate(s.machine).radius + 0.8;
    for (const [x, z] of [
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius],
    ]) {
      const point = worldPoint(s.machine.pose, { x, y: 0, z });
      if (point.x < 1 || point.z < 1 || point.x > 159 || point.z > 159)
        continue;
      const y = world.surface(point.x, point.z);
      if (y <= s.machine.pose.position.y + 2) {
        Object.assign(p, {
          x: point.x,
          y: Math.max(y, point.y),
          z: point.z,
          vy: Math.max(-30, Math.min(30, s.machine.pose.velocity.y)),
          grounded: y >= point.y,
        });
        return;
      }
    }
    // Emergency exit above the machine when every side is obstructed.
    Object.assign(p, {
      ...worldPoint(s.machine.pose, { x: 0, y: 2.5, z: 0 }),
      vy: 0,
    });
  }
}
