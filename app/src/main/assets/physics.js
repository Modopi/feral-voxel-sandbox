import { SIZE, HEIGHT, clamp } from "./world.js";
export const FIXED_DT = 1 / 60,
  BODY_HEIGHT = 1.5,
  EYE_HEIGHT = 1.36,
  BODY_RADIUS = 0.23;
const EPS = 1e-7;
export function solidAt(world, x, y, z) {
  return !!world.getCell(
    Math.floor(x * 2),
    Math.floor(y * 2),
    Math.floor(z * 2),
  );
}
// Sweep against exact half-metre collision planes; touching faces never overlap.
export function sweep(world, p, axis, delta, r = BODY_RADIUS, h = BODY_HEIGHT) {
  if (!delta) return 0;
  const lo = { x: p.x - r, y: p.y, z: p.z - r },
    hi = { x: p.x + r, y: p.y + h, z: p.z + r };
  const a = { ...lo },
    b = { ...hi };
  a[axis] += Math.min(0, delta);
  b[axis] += Math.max(0, delta);
  let allowed = delta;
  for (
    let y = Math.floor((a.y + EPS) * 2);
    y <= Math.floor((b.y - EPS) * 2);
    y++
  )
    for (
      let z = Math.floor((a.z + EPS) * 2);
      z <= Math.floor((b.z - EPS) * 2);
      z++
    )
      for (
        let x = Math.floor((a.x + EPS) * 2);
        x <= Math.floor((b.x - EPS) * 2);
        x++
      ) {
        if (!world.getCell(x, y, z)) continue;
        const cellLo = { x: x * 0.5, y: y * 0.5, z: z * 0.5 },
          cellHi = { x: (x + 1) * 0.5, y: (y + 1) * 0.5, z: (z + 1) * 0.5 };
        let other = true;
        for (const k of ["x", "y", "z"])
          if (
            k !== axis &&
            (hi[k] <= cellLo[k] + EPS || lo[k] >= cellHi[k] - EPS)
          ) {
            other = false;
            break;
          }
        if (!other) continue;
        if (delta > 0 && hi[axis] <= cellLo[axis] + EPS)
          allowed = Math.min(allowed, Math.max(0, cellLo[axis] - hi[axis]));
        else if (delta < 0 && lo[axis] >= cellHi[axis] - EPS)
          allowed = Math.max(allowed, Math.min(0, cellHi[axis] - lo[axis]));
      }
  return allowed;
}
export function overlaps(world, p, r = BODY_RADIUS, h = BODY_HEIGHT) {
  for (
    let y = Math.floor((p.y + EPS) * 2);
    y <= Math.floor((p.y + h - EPS) * 2);
    y++
  )
    for (
      let z = Math.floor((p.z - r + EPS) * 2);
      z <= Math.floor((p.z + r - EPS) * 2);
      z++
    )
      for (
        let x = Math.floor((p.x - r + EPS) * 2);
        x <= Math.floor((p.x + r - EPS) * 2);
        x++
      )
        if (world.getCell(x, y, z)) return true;
  return false;
}
export class CharacterController {
  constructor(world, player) {
    this.world = world;
    this.player = player;
    this.previous = { x: player.x, y: player.y, z: player.z, offset: 0 };
    this.offset = 0;
    this.jumpWasDown = false;
  }
  reset(preserveVelocity = false) {
    const p = this.player;
    this.offset = 0;
    this.previous = { x: p.x, y: p.y, z: p.z, offset: 0 };
    this.jumpWasDown = false;
    if (!preserveVelocity) p.vy = 0;
  }
  supported() {
    return sweep(this.world, this.player, "y", -0.025) > -0.025 + EPS;
  }
  horizontal(axis, delta) {
    const p = this.player,
      w = this.world,
      allowed = sweep(w, p, axis, delta);
    if (Math.abs(allowed - delta) < EPS) {
      p[axis] += allowed;
      return;
    }
    // Half-block stairs are stepped up only if both the head and destination fit.
    if (p.grounded && Math.abs(delta) > EPS) {
      const old = { x: p.x, y: p.y, z: p.z },
        up = sweep(w, p, "y", 0.5);
      if (up > 0.49999) {
        p.y += up;
        const stepped = sweep(w, p, axis, delta);
        if (Math.abs(stepped - delta) < EPS) {
          p[axis] += stepped;
          const down = sweep(w, p, "y", -0.525);
          if (down > -0.525 + EPS) {
            p.y += down;
            this.offset -= p.y - old.y;
            return;
          }
        }
      }
      Object.assign(p, old);
    }
    p[axis] += allowed;
  }
  step(dt, input = {}) {
    const p = this.player;
    this.previous = { x: p.x, y: p.y, z: p.z, offset: this.offset };
    this.offset *= Math.exp(-14 * dt);
    const jump = !!input.jump,
      pressed = jump && !this.jumpWasDown;
    this.jumpWasDown = jump;
    const length = Math.max(1, Math.hypot(input.forward || 0, input.side || 0)),
      f = (input.forward || 0) / length,
      side = (input.side || 0) / length,
      s = Math.sin(p.yaw),
      c = Math.cos(p.yaw),
      speed = (input.sprint ? 4.8 : 3.2) * (p.flying ? 2.2 : 1),
      dx = (-s * f + c * side) * speed * dt,
      dz = (-c * f - s * side) * speed * dt;
    if (p.flying) {
      p.x += dx;
      p.z += dz;
      p.y = clamp(
        p.y +
          ((jump || input.up ? 1 : 0) -
            (input.down ? 1 : 0) +
            Math.sin(p.pitch) * f) *
            speed *
            dt,
        1,
        HEIGHT + 12,
      );
      p.vy = 0;
      p.grounded = false;
    } else {
      p.grounded = this.supported();
      this.horizontal("x", dx);
      this.horizontal("z", dz);
      const support = this.supported();
      if (pressed && support) {
        p.vy = 6.2;
        p.grounded = false;
      } else if (support && p.vy <= 0) {
        p.vy = 0;
        p.grounded = true;
      } else p.grounded = false;
      if (!p.grounded) {
        p.vy = Math.max(-25, (p.vy || 0) - 18 * dt);
        const delta = p.vy * dt,
          dy = sweep(this.world, p, "y", delta);
        p.y += dy;
        if (Math.abs(dy - delta) > EPS) {
          if (p.vy < 0) p.grounded = true;
          p.vy = 0;
        }
      }
    }
    p.x = clamp(p.x, BODY_RADIUS, SIZE - BODY_RADIUS);
    p.z = clamp(p.z, BODY_RADIUS, SIZE - BODY_RADIUS);
    return Math.hypot(f, side);
  }
  render(alpha) {
    const p = this.player,
      a = clamp(alpha, 0, 1),
      b = this.previous;
    return {
      x: b.x + (p.x - b.x) * a,
      y:
        b.y +
        (p.y - b.y) * a +
        EYE_HEIGHT +
        b.offset +
        (this.offset - b.offset) * a,
      z: b.z + (p.z - b.z) * a,
    };
  }
  recover() {
    const p = this.player;
    for (let i = 0; i < HEIGHT * 2 && overlaps(this.world, p); i++)
      p.y = Math.ceil((p.y + 0.001) * 2) * 0.5;
    this.reset();
    p.grounded = this.supported();
  }
}
