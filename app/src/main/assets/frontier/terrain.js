import { World, B, HEIGHT } from "../world.js";
// Regions use the existing voxel engine, loaded one at a time at explicit travel points.
// Structures are deterministic base terrain; player edits are applied afterwards.
export function frontierWorld(seed, info) {
  const world = new World(seed);
  world.generate();
  function put(x, y, z, b) {
    world.set(x, y, z, b, false);
    world.fluids.delete(world.index(x, y, z));
  }
  function pad(x, z, r, block = B.GRASS) {
    const y = Math.max(
      11,
      Math.min(25, world.ground[Math.floor(x) + Math.floor(z) * 160]),
    );
    for (let zz = z - r; zz <= z + r; zz++)
      for (let xx = x - r; xx <= x + r; xx++) {
        for (let yy = 1; yy < HEIGHT; yy++) {
          if (yy <= y) {
            if (yy >= y - 3 || world.get(xx, yy, zz) === 0)
              put(xx, yy, zz, yy === y ? block : B.DIRT);
          } else put(xx, yy, zz, B.AIR);
        }
        world.rescan(xx, zz);
      }
    return y + 1;
  }
  pad(77, 84, 5);
  for (const v of info.villages) {
    const y = pad(v.x, v.z, 7);
    for (const offset of [-4, 3]) {
      for (let x = v.x + offset; x < v.x + offset + 3; x++)
        for (let z = v.z - 5; z < v.z - 2; z++) {
          put(x, y, z, B.PLANK);
          if (x === v.x + offset || x === v.x + offset + 2)
            for (let h = 1; h <= 2; h++) put(x, y + h, z, B.WOOD);
          put(x, y + 3, z, B.PLANK);
        }
    }
    for (let x = v.x - 4; x <= v.x + 4; x++) put(x, y - 1, v.z + 4, B.GRASS);
  }
  const p = info.boss,
    y = pad(p.x, p.z, 10, B.BASALT);
  for (let i = -8; i <= 8; i += 4)
    for (const z of [p.z - 9, p.z + 9]) {
      put(p.x + i, y, z, B.STONE);
      put(p.x + i, y + 1, z, B.ORE);
    }
  const d = info.dungeon,
    h = pad(d.x, d.z, 7, B.STONE);
  for (const x of [d.x - 5, d.x + 5])
    for (const z of [d.z - 5, d.z + 5])
      for (let j = 0; j < 4; j++) put(x, h + j, z, j === 3 ? B.ORE : B.BASALT);
  if ((info.terrainVersion ?? 2) >= 2) {
    // Region silhouettes are baked into the voxel terrain only for newly generated regions.
    const bio = info.biome ?? 0;
    for (const side of [-1, 1]) {
      const x = d.x + side * 5;
      if (bio === 0) {
        for (let z = d.z - 4; z <= d.z + 4; z++)
          for (let yy = 0; yy < 3; yy++)
            if (z === d.z - 4 || z === d.z + 4) put(x, h + yy, z, B.WOOD);
        for (let z = d.z - 5; z <= d.z + 5; z++) put(x, h + 4, z, B.LEAF);
      } else if (bio === 1) {
        for (let yy = 0; yy < 6; yy++)
          put(x, h + yy, d.z - 4, yy % 2 ? B.ORE : B.BASALT);
        for (let xx = d.x - 5; xx <= d.x + 5; xx++)
          put(xx, h + 6, d.z - 4, B.PLANK);
      } else {
        for (let yy = 0; yy < 5; yy++)
          put(x, h + yy, d.z - 4, yy >= 3 ? B.ORE : B.STONE);
        for (let z = d.z - 4; z <= d.z + 4; z++)
          put(x, h - 1, z, z % 2 ? B.SAND : B.ORE);
      }
    }
    // Distinct arena landmarks leave the fighting floor and three survey approaches clear.
    for (const side of [-1, 1])
      for (let yy = 0; yy < (bio === 1 ? 6 : 4); yy++)
        put(
          p.x + side * 9,
          y + yy,
          p.z - 7,
          bio === 0
            ? yy === 3
              ? B.LEAF
              : B.WOOD
            : bio === 1
              ? B.BASALT
              : B.ORE,
        );
  }
  // Walkable half-metre supply trails connect hubs across cliffs and rivers.
  // Projection assigns each column one height so diagonal overlaps cannot create walls.
  const origin = { x: 77, z: 84, y: world.surface(77, 84) };
  for (const target of [...info.villages, info.boss, info.dungeon]) {
    const endY = world.surface(target.x, target.z),
      dx = target.x - origin.x,
      dz = target.z - origin.z,
      length2 = dx * dx + dz * dz;
    for (
      let z = Math.min(origin.z, target.z) - 2;
      z <= Math.max(origin.z, target.z) + 2;
      z++
    )
      for (
        let x = Math.min(origin.x, target.x) - 2;
        x <= Math.max(origin.x, target.x) + 2;
        x++
      ) {
        const t = Math.max(
          0,
          Math.min(1, ((x - origin.x) * dx + (z - origin.z) * dz) / length2),
        );
        if (Math.hypot(x - origin.x - dx * t, z - origin.z - dz * t) > 1.5)
          continue;
        const top = Math.round((origin.y + (endY - origin.y) * t) * 2) / 2;
        for (let y = 1; y < HEIGHT; y++) {
          if (y < Math.floor(top))
            put(x, y, z, y === Math.floor(top) - 1 ? B.PLANK : B.DIRT);
          else put(x, y, z, B.AIR);
        }
        if (top % 1)
          for (let hx = 0; hx < 2; hx++)
            for (let hz = 0; hz < 2; hz++)
              world.setCell(
                x * 2 + hx,
                Math.floor(top) * 2,
                z * 2 + hz,
                B.PLANK,
              );
        world.rescan(x, z);
      }
  }
  world.landmarks = [
    { name: "원정 야영지", x: 77, z: 84 },
    ...info.villages.map((v) => ({ name: v.name, x: v.x, z: v.z })),
    { name: "동력 유적", ...d },
    { name: "수호자 둥지", ...p },
  ];
  world.edits.clear();
  return world;
}
