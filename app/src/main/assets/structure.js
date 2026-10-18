// Shared connectivity and mass rules; no renderer, DOM, or physics-engine types.
export const FACES = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
export const cellKey = (x, y, z) => `${x},${y},${z}`;
export function components(cells) {
  const at = new Map(cells.map((c) => [cellKey(c.x, c.y, c.z), c])),
    seen = new Set(),
    groups = [];
  for (const start of cells) {
    if (seen.has(start)) continue;
    const group = [start];
    seen.add(start);
    for (let i = 0; i < group.length; i++) {
      const p = group[i];
      for (const [x, y, z] of FACES) {
        const next = at.get(cellKey(p.x + x, p.y + y, p.z + z));
        if (next && !seen.has(next)) {
          seen.add(next);
          group.push(next);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}
export function voxelComponents(mask, dims) {
  const [nx, ny] = dims,
    cells = [];
  for (let i = 0; i < mask.length; i++)
    if (mask[i])
      cells.push({
        id: i,
        x: i % nx,
        y: Math.floor(i / nx) % ny,
        z: Math.floor(i / (nx * ny)),
      });
  return components(cells).map((g) => g.map((c) => c.id));
}
export function massProperties(cells) {
  let mass = 0,
    center = [0, 0, 0];
  for (const c of cells) {
    mass += c.mass;
    center[0] += c.x * c.mass;
    center[1] += c.y * c.mass;
    center[2] += c.z * c.mass;
  }
  if (!mass) return { mass: 0, center: [0, 0, 0], inertia: [0, 0, 0] };
  center = center.map((v) => v / mass);
  const inertia = [0, 0, 0];
  for (const c of cells) {
    const d = [c.x - center[0], c.y - center[1], c.z - center[2]],
      own = (c.size || 0.5) ** 2 / 6;
    for (let i = 0; i < 3; i++)
      inertia[i] += c.mass * (own + d[(i + 1) % 3] ** 2 + d[(i + 2) % 3] ** 2);
  }
  return { mass, center, inertia };
}
/** A vector turned by a unit quaternion (loose voxel groups; serializable, independent of Three.js and Rapier). */
export function rotate(q, v) {
  const tx = 2 * (q.y * v.z - q.z * v.y),
    ty = 2 * (q.z * v.x - q.x * v.z),
    tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx,
  };
}
