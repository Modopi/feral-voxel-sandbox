import { voxelComponents, massProperties } from "./structure.js";
// Leg function requires an unbroken path from its attachment layer to its foot.
export function limbSupport(mask, dims) {
  const [nx, ny] = dims;
  return voxelComponents(mask, dims).some(
    (group) =>
      group.some((i) => Math.floor(i / nx) % ny === ny - 1) &&
      group.some((i) => Math.floor(i / nx) % ny === 0),
  )
    ? 1
    : 0;
}
const attachmentCells = new WeakMap();
export function attachmentIntact(e, species, pi) {
  const child = species.parts[pi],
    parent = species.parts[child.parent];
  if (!parent) return true;
  if (e.lost & (1 << child.parent)) return false;
  if (!e.damage[child.parent]) return true;
  let indices = attachmentCells.get(child);
  if (!indices) {
    const [nx, ny, nz] = parent.dims;
    const distances = Array.from({ length: parent.count }, (_, j) =>
      Math.hypot(
        parent.offset[0] +
          ((j % nx) + 0.5 - nx / 2) * parent.cell -
          child.offset[0],
        parent.offset[1] +
          ((Math.floor(j / nx) % ny) + 0.5 - (parent.leg ? ny : ny / 2)) *
            parent.cell -
          child.offset[1],
        parent.offset[2] +
          (Math.floor(j / (nx * ny)) + 0.5 - nz / 2) * parent.cell -
          child.offset[2],
      ),
    );
    const nearest = Math.min(...distances);
    indices = distances.flatMap((d, j) =>
      d <= nearest + parent.cell * 0.15 ? [j] : [],
    );
    attachmentCells.set(child, indices);
  }
  return indices.some((j) => e.damage[child.parent][j]);
}
export function anatomy(e, species) {
  const support = [],
    cells = [];
  for (let pi = 0; pi < species.parts.length; pi++) {
    const p = species.parts[pi],
      mask = Array.from({ length: p.count }, (_, j) =>
        !(e.lost & (1 << pi)) && (!e.damage[pi] || e.damage[pi][j]) ? 1 : 0,
      );
    if (p.leg)
      support.push(
        attachmentIntact(e, species, pi) ? limbSupport(mask, p.dims) : 0,
      );
    for (let j = 0; j < mask.length; j++)
      if (mask[j]) {
        const [nx, ny, nz] = p.dims;
        cells.push({
          x: p.offset[0] + ((j % nx) + 0.5 - nx / 2) * p.cell,
          y:
            p.offset[1] +
            ((Math.floor(j / nx) % ny) + 0.5 - (p.leg ? ny : ny / 2)) * p.cell,
          z: p.offset[2] + (Math.floor(j / (nx * ny)) + 0.5 - nz / 2) * p.cell,
          mass: p.cell ** 3 * 800,
          size: p.cell,
        });
      }
  }
  const legs = support.reduce((a, b) => a + b, 0),
    left = support[0] + support[2],
    right = support[1] + support[3],
    front = support[0] + support[1],
    rear = support[2] + support[3];
  const diagonal =
    legs === 2 && support[0] === support[3] && support[1] === support[2];
  const result = {
    ...massProperties(cells),
    support,
    legs,
    mode:
      legs === 4 ? "walk" : legs === 3 ? "limp" : legs ? "crawl" : "immobile",
    label:
      legs === 4
        ? "정상 보행"
        : legs === 3
          ? "절뚝거림"
          : legs
            ? "기어 이동"
            : "이동 불가",
    speed:
      legs === 4
        ? 1
        : legs === 3
          ? 0.55
          : legs === 2
            ? diagonal
              ? 0.22
              : 0.12
            : legs === 1
              ? 0.045
              : 0,
    step: legs === 4 ? 1.2 : legs === 3 ? 0.45 : legs ? 0.12 : 0,
    drop:
      legs === 4
        ? 0
        : legs === 3
          ? -0.08 * species.s
          : legs === 2
            ? -0.25 * species.s
            : -(
                species.parts[0].offset[1] -
                (species.parts[0].cell * species.parts[0].dims[1]) / 2 -
                0.03
              ),
    roll: (right - left) * 0.09,
    pitch: (front - rear) * 0.09,
  };
  const core = species.parts[0];
  let bottom = Infinity;
  for (const dx of [-1, 1])
    for (const dy of [-1, 1])
      for (const dz of [-1, 1]) {
        const x = core.offset[0] + (dx * core.dims[0] * core.cell) / 2,
          y = core.offset[1] + (dy * core.dims[1] * core.cell) / 2,
          z = core.offset[2] + (dz * core.dims[2] * core.cell) / 2;
        bottom = Math.min(
          bottom,
          (x * Math.sin(result.roll) + y * Math.cos(result.roll)) *
            Math.cos(result.pitch) -
            z * Math.sin(result.pitch),
        );
      }
  result.drop = Math.max(result.drop, 0.03 - bottom);
  return result;
}
