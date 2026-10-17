// SI units: metres, seconds, kg, N. A local panel model, not a fluid solver.
// The craft points along -Z; horizontal panels have +Y normals and fins +X.
export const AIR_DENSITY = 1.225;
export const AIRFOILS = Object.freeze({
  wing: { area: 0.25, incidence: 0.06, drag: 0.025 },
  elevator: { area: 0.25, incidence: 0, drag: 0.02 },
  rudder: { area: 0.25, incidence: 0, drag: 0.02, vertical: true },
});
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function coefficients(angle, baseDrag = 0.025) {
  const a = Math.atan2(Math.sin(angle), Math.cos(angle));
  const stall = (15 * Math.PI) / 180;
  const blend = clamp((Math.abs(a) - stall) / ((12 * Math.PI) / 180), 0, 1);
  const attached = clamp(4.5 * a, -1.35, 1.35);
  const lift = attached * (1 - blend) + 0.9 * Math.sin(2 * a) * blend;
  return {
    lift,
    drag: baseDrag + 0.09 * lift * lift + 1.1 * Math.sin(a) ** 2,
    stalled: Math.abs(a) > stall,
  };
}
export function panelForce(type, velocity, health = 1, controls = {}, x = 0) {
  const foil = AIRFOILS[type];
  if (!foil) throw Error("Unknown airfoil");
  const normalSpeed = foil.vertical ? velocity.x : velocity.y;
  const speed = Math.hypot(normalSpeed, velocity.z);
  if (speed < 0.01 || health <= 0)
    return {
      force: { x: 0, y: 0, z: 0 },
      lift: 0,
      drag: 0,
      speed,
      angle: 0,
      stalled: false,
    };
  // Elevator down-force behind the centre of mass raises the nose. Opposite
  // wing deflections bank the craft; the fin coordinates yaw with that bank.
  const deflection =
    type === "elevator"
      ? -(controls.pitch || 0) * 0.12
      : type === "rudder"
        ? -(controls.turn || 0) * 0.12
        : -Math.sign(x) * (controls.turn || 0) * 0.12;
  const angle =
    Math.atan2(-normalSpeed, -velocity.z) + foil.incidence + deflection;
  const c = coefficients(angle, foil.drag);
  const pressure = 0.5 * AIR_DENSITY * speed * speed * foil.area;
  const lift = pressure * c.lift * clamp(health, 0, 1);
  // Damaged panels still have a physical surface and a larger parasitic drag.
  const drag = pressure * (c.drag + (1 - clamp(health, 0, 1)) * 0.2);
  const normal = lift * (-velocity.z / speed) - (drag * normalSpeed) / speed;
  const along = (lift * normalSpeed) / speed - (drag * velocity.z) / speed;
  return {
    force: foil.vertical
      ? { x: normal, y: 0, z: along }
      : { x: 0, y: normal, z: along },
    lift,
    drag,
    speed,
    angle,
    stalled: c.stalled,
  };
}
// Only exposed voxel faces catch form drag. Neighbouring body blocks shield
// internal faces; thin panels are handled separately by their airfoil model.
export function exposedFaces(parts) {
  const solid = new Set(
    parts.filter((p) => !AIRFOILS[p.type]).map((p) => `${p.x},${p.y},${p.z}`),
  );
  return new Map(
    parts.map((p) => [
      p.id,
      [
        !solid.has(`${p.x + 1},${p.y},${p.z}`),
        !solid.has(`${p.x - 1},${p.y},${p.z}`),
        !solid.has(`${p.x},${p.y + 1},${p.z}`),
        !solid.has(`${p.x},${p.y - 1},${p.z}`),
        !solid.has(`${p.x},${p.y},${p.z + 1}`),
        !solid.has(`${p.x},${p.y},${p.z - 1}`),
      ],
    ]),
  );
}
export function bodyDrag(
  type,
  velocity,
  exposed = [true, true, true, true, true, true],
) {
  const panel = AIRFOILS[type];
  const area = panel
    ? panel.vertical
      ? [0, 0.035, 0]
      : [0.035, 0, 0]
    : type === "propeller"
      ? [0.06, 0.06, 0.12]
      : [0.25, 0.25, 0.25];
  return Object.fromEntries(
    ["x", "y", "z"].map((axis, i) => {
      const v = velocity[axis];
      return [
        axis,
        exposed[2 * i + (v < 0 ? 1 : 0)]
          ? -0.5 * AIR_DENSITY * 0.8 * area[i] * v * Math.abs(v)
          : 0,
      ];
    }),
  );
}
