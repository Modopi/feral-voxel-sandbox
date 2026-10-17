import { terrainMaterial, Atmosphere } from "./art-direction.js";
import { ITEMS } from "./inventory.js";
import { WorldUI } from "./world-ui.js";
import * as T from "./vendor/three.module.js";
import { SIZE, HEIGHT, CHUNK, COLORS, B, hash, clamp } from "./world.js";
import { SPECIES, cellPosition, toWorld, occupied, pose } from "./entities.js";
export { T };
function geometry(positions, normals, colors, materials) {
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new T.Float32BufferAttribute(normals, 3));
  g.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  g.setAttribute("materialKind", new T.Float32BufferAttribute(materials, 1));
  g.computeBoundingSphere();
  return g;
}
// Greedy face merging reduces terrain geometry without one object per block.
export function chunkGeometry(w, cx, cz) {
  const positions = [],
    normals = [],
    colors = [],
    materials = [],
    dims = [CHUNK, HEIGHT, CHUNK],
    origin = [cx * CHUNK, 0, cz * CHUNK],
    mask = new Int16Array(CHUNK * HEIGHT),
    color = new T.Color();
  const at = (v) => w.meshCell(v[0] + origin[0], v[1], v[2] + origin[2]);
  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3,
      v = (d + 2) % 3,
      x = [0, 0, 0],
      q = [0, 0, 0];
    q[d] = 1;
    for (x[d] = -1; x[d] < dims[d]; ) {
      let n = 0;
      for (x[v] = 0; x[v] < dims[v]; x[v]++)
        for (x[u] = 0; x[u] < dims[u]; x[u]++) {
          const a =
              x[d] >= 0
                ? at(x)
                : w.meshCell(x[0] + origin[0], x[1], x[2] + origin[2]),
            b = w.meshCell(
              x[0] + q[0] + origin[0],
              x[1] + q[1],
              x[2] + q[2] + origin[2],
            );
          mask[n++] =
            a && !b && x[d] >= 0 ? a : !a && b && x[d] < dims[d] - 1 ? -b : 0;
        }
      x[d]++;
      n = 0;
      for (let j = 0; j < dims[v]; j++)
        for (let i = 0; i < dims[u]; ) {
          const m = mask[n];
          if (!m) {
            i++;
            n++;
            continue;
          }
          let width = 1;
          while (i + width < dims[u] && mask[n + width] === m) width++;
          let height = 1;
          outer: for (; j + height < dims[v]; height++) {
            for (let k = 0; k < width; k++)
              if (mask[n + k + height * dims[u]] !== m) break outer;
          }
          x[u] = i;
          x[v] = j;
          const du = [0, 0, 0],
            dv = [0, 0, 0];
          du[u] = width;
          dv[v] = height;
          let corners = [
            x.slice(),
            x.map((a, k) => a + du[k]),
            x.map((a, k) => a + du[k] + dv[k]),
            x.map((a, k) => a + dv[k]),
          ];
          const order = m > 0 ? [0, 1, 2, 0, 2, 3] : [0, 3, 2, 0, 2, 1];
          const normal = [0, 0, 0];
          normal[d] = Math.sign(m);
          color.setHex(COLORS[Math.abs(m)]);
          const shade = d === 1 ? (m > 0 ? 1 : 0.6) : d === 0 ? 0.84 : 0.72;
          for (const k of order) {
            positions.push(
              corners[k][0] + origin[0],
              corners[k][1],
              corners[k][2] + origin[2],
            );
            normals.push(...normal);
            materials.push(Math.abs(m));
            colors.push(color.r * shade, color.g * shade, color.b * shade);
          }
          for (let yy = 0; yy < height; yy++)
            for (let xx = 0; xx < width; xx++) mask[n + xx + yy * dims[u]] = 0;
          i += width;
          n += width;
        }
    }
  }
  for (const [i, cells] of w.subcells) {
    const [bx, by, bz] = w.decode(i);
    if (bx >> 4 !== cx || bz >> 4 !== cz) continue;
    for (let j = 0; j < 8; j++) {
      const mat = cells[j];
      if (!mat) continue;
      const h = [
        bx * 2 + (j & 1),
        by * 2 + ((j >> 1) & 1),
        bz * 2 + ((j >> 2) & 1),
      ];
      for (let d = 0; d < 3; d++)
        for (const sign of [-1, 1]) {
          const next = h.slice();
          next[d] += sign;
          if (w.getCell(...next)) continue;
          const u = (d + 1) % 3,
            v = (d + 2) % 3,
            start = h.map((k) => k * 0.5);
          if (sign > 0) start[d] += 0.5;
          const du = [0, 0, 0],
            dv = [0, 0, 0];
          du[u] = 0.5;
          dv[v] = 0.5;
          const corners = [
              start,
              start.map((a, k) => a + du[k]),
              start.map((a, k) => a + du[k] + dv[k]),
              start.map((a, k) => a + dv[k]),
            ],
            order = sign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 3, 2, 0, 2, 1],
            normal = [0, 0, 0];
          normal[d] = sign;
          color.setHex(COLORS[mat]);
          const shade = d === 1 ? (sign > 0 ? 1 : 0.6) : d === 0 ? 0.84 : 0.72;
          for (const k of order) {
            positions.push(...corners[k]);
            normals.push(...normal);
            materials.push(mat);
            colors.push(color.r * shade, color.g * shade, color.b * shade);
          }
        }
    }
  }
  return geometry(positions, normals, colors, materials);
}
export class View {
  constructor(canvas, w) {
    this.world = w;
    this.renderer = new T.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0xb2d5cf);
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.scene = new T.Scene();
    this.scene.fog = new T.Fog(0xb2d5cf, 48, 112);
    this.camera = new T.PerspectiveCamera(82, 1, 0.04, 150);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.camera);
    this.worldUI = new WorldUI(this.scene, this.camera);
    this.ambientLight = new T.HemisphereLight(0xc9dfed, 0x4e583d, 1.35);
    this.scene.add(this.ambientLight);
    this.sunLight = new T.DirectionalLight(0xffe3a8, 2.4);
    this.sunLight.position.set(-40, 75, 35);
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sunLight.shadow.camera, {
      left: -28,
      right: 28,
      top: 28,
      bottom: -28,
      near: 1,
      far: 135,
    });
    this.sunLight.shadow.bias = -0.0003;
    this.sunLight.shadow.normalBias = 0.04;
    this.terrainMaterial = terrainMaterial();
    this.chunks = new Map();
    this.cube = new T.BoxGeometry(1, 1, 1);
    this.creatureMaterial = new T.MeshStandardMaterial({ roughness: 0.88 });
    this.nearMesh = new T.InstancedMesh(
      this.cube,
      this.creatureMaterial,
      24000,
    );
    this.farMesh = new T.InstancedMesh(this.cube, this.creatureMaterial, 40000);
    this.nearMesh.count = 0;
    this.farMesh.count = 0;
    for (const m of [this.nearMesh, this.farMesh]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(T.DynamicDrawUsage);
      this.scene.add(m);
    }
    this.waterMesh = new T.InstancedMesh(
      new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new T.MeshStandardMaterial({
        roughness: 0.23,
        metalness: 0.15,
        side: T.DoubleSide,
        transparent: true,
        opacity: 0.67,
        depthWrite: false,
      }),
      16000,
    );
    this.waterMesh.frustumCulled = false;
    this.waterMesh.count = 0;
    this.waterMesh.receiveShadow = true;
    this.scene.add(this.waterMesh);
    this.flameMesh = new T.InstancedMesh(
      this.cube,
      new T.MeshBasicMaterial(),
      600,
    );
    this.flameMesh.count = 0;
    this.flameMesh.frustumCulled = false;
    this.scene.add(this.flameMesh);
    this.grassMesh = new T.InstancedMesh(
      this.cube,
      new T.MeshLambertMaterial(),
      2200,
    );
    this.grassMesh.count = 0;
    this.grassMesh.frustumCulled = false;
    this.grassMesh.receiveShadow = true;
    this.scene.add(this.grassMesh);
    this.cloudMesh = new T.InstancedMesh(
      this.cube,
      new T.MeshBasicMaterial({
        color: 0xf1f1d8,
        transparent: true,
        opacity: 0.65,
      }),
      60,
    );
    this.scene.add(this.cloudMesh);
    const ob = new T.Object3D();
    for (let i = 0; i < 60; i++) {
      ob.position.set(
        hash(i, 1) * SIZE,
        33 + hash(i, 2) * 9,
        hash(i, 3) * SIZE,
      );
      ob.scale.set(4 + hash(i, 4) * 15, 0.8 + hash(i, 5), 3 + hash(i, 6) * 8);
      ob.updateMatrix();
      this.cloudMesh.setMatrixAt(i, ob.matrix);
    }
    this.cloudMesh.instanceMatrix.needsUpdate = true;
    this.sun = new T.Mesh(
      new T.SphereGeometry(3.4, 8, 6),
      new T.MeshBasicMaterial({ color: 0xffeab4 }),
    );
    this.sun.position.set(15, 68, 18);
    this.scene.add(this.sun);
    this.highlight = new T.LineSegments(
      new T.EdgesGeometry(this.cube),
      new T.LineBasicMaterial({
        color: 0xf5d78c,
        transparent: true,
        opacity: 0.8,
      }),
    );
    this.highlight.scale.setScalar(1.007);
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    this.pickupMesh = new T.InstancedMesh(
      this.cube,
      new T.MeshStandardMaterial({ roughness: 0.8, emissive: 0x182317 }),
      600,
    );
    this.pickupMesh.count = 0;
    this.pickupMesh.frustumCulled = false;
    this.scene.add(this.pickupMesh);
    this.forward = new T.Vector3();
    this.creatureRenderFrame = 0;
    this.o = new T.Object3D();
    this.color = new T.Color();
    this.nearCount = 0;
    this.farCount = 0;
    this.quality = "balanced";
    this.detailLimit = 24;
    this.radius = 76;
    this.fluidFrame = 0;
    this.atmosphere = new Atmosphere(this);
    this.makeTool();
    this.resize();
  }
  makeTool() {
    this.tool = new T.Group();
    this.camera.add(this.tool);
    const add = (c, x, y, z, sx, sy, sz) => {
      const m = new T.Mesh(
        this.cube,
        new T.MeshStandardMaterial({
          color: c,
          roughness: 0.65,
          metalness: 0.1,
        }),
      );
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      this.tool.add(m);
    };
    add(0x293f40, 0.37, -0.28, -0.52, 0.17, 0.15, 0.4);
    add(0xdecba1, 0.37, -0.21, -0.51, 0.19, 0.045, 0.28);
    add(0xb77844, 0.37, -0.29, -0.78, 0.13, 0.12, 0.12);
    add(0x263a35, 0.37, -0.4, -0.42, 0.1, 0.23, 0.1);
    add(0x82e6be, 0.37, -0.215, -0.62, 0.1, 0.027, 0.05);
    add(0x586457, 0.37, -0.49, -0.3, 0.16, 0.2, 0.28);
    this.tool.scale.setScalar(0.58);
    this.tool.position.set(0.18, -0.12, -0.22);
    this.toolBase = { y: -0.12, z: -0.22 };
    this.toolKick = 0;
  }
  setHeldItem(id) {
    if (ITEMS[id]?.gear || ITEMS[id]?.assemblyTool) {
      if (this.heldCube) {
        this.camera.remove(this.heldCube);
        this.heldCube.material.dispose();
        this.heldCube = null;
      }
      this.tool.visible = true;
      this.setEquipment(id);
      return;
    }
    this.setEquipment("utility");
    if (this.heldCube) {
      this.camera.remove(this.heldCube);
      this.heldCube.material.dispose();
      this.heldCube = null;
    }
    this.tool.visible = false;
    if (!id) return;
    this.heldCube = new T.Mesh(
      this.cube,
      new T.MeshStandardMaterial({
        color: ITEMS[id]?.color || 0x9b7654,
        roughness: 0.8,
      }),
    );
    this.heldCube.scale.setScalar(
      ITEMS[id]?.block || ITEMS[id]?.machinePart ? 0.1 : 0.06,
    );
    this.heldCube.position.set(0.22, -0.17, -0.4);
    this.heldCube.rotation.set(0.1, 0.6, 0.1);
    this.camera.add(this.heldCube);
  }
  setEquipment(id) {
    if (this.equipmentId === id) return;
    this.equipmentId = id;
    if (!this.originalTool) this.originalTool = [...this.tool.children];
    for (const mesh of [...this.tool.children]) {
      this.tool.remove(mesh);
      if (!this.originalTool.includes(mesh)) mesh.material.dispose();
    }
    if (id === "pulse" || id === "utility") {
      this.tool.add(...this.originalTool);
      return;
    }
    const metal =
      id.includes("iron") || ["sword", "battleaxe", "crystalbow"].includes(id)
        ? 0xb6d6d3
        : 0x8c9b9c;
    const add = (color, x, y, z, sx, sy, sz) => {
      const mesh = new T.Mesh(
        this.cube,
        new T.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.1 }),
      );
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      this.tool.add(mesh);
      return mesh;
    };
    add(0x76563a, 0.37, -0.34, -0.51, 0.065, 0.42, 0.065);
    if (id === "wrench") {
      add(0xbfcad1, 0.37, -0.12, -0.51, 0.23, 0.08, 0.07);
      add(0xbfcad1, 0.26, -0.06, -0.51, 0.06, 0.18, 0.07);
      add(0xbfcad1, 0.48, -0.06, -0.51, 0.06, 0.18, 0.07);
    } else if (id === "bow" || id === "crystalbow") {
      add(0xba8b50, 0.37, -0.12, -0.58, 0.055, 0.4, 0.06);
      add(0xba8b50, 0.37, -0.52, -0.58, 0.055, 0.35, 0.06);
      add(0xe4dac0, 0.37, -0.3, -0.45, 0.015, 0.75, 0.015);
      add(metal, 0.37, -0.3, -0.76, 0.025, 0.025, 0.65);
      if (id === "crystalbow")
        add(0x6bccd4, 0.37, -0.28, -0.62, 0.42, 0.06, 0.08);
    } else if (id === "sword" || id === "spear") {
      add(
        metal,
        0.37,
        0.04,
        -0.52,
        id === "spear" ? 0.065 : 0.12,
        id === "spear" ? 0.65 : 0.5,
        0.045,
      );
      add(0xc4a15a, 0.37, -0.18, -0.51, 0.26, 0.045, 0.08);
    } else if (id === "axe" || id === "battleaxe") {
      add(metal, 0.43, -0.09, -0.52, 0.28, 0.21, 0.07);
    } else if (id === "shovel") {
      add(metal, 0.37, -0.04, -0.52, 0.2, 0.24, 0.04);
    } else if (id === "club") {
      add(metal, 0.37, -0.06, -0.52, 0.18, 0.28, 0.18);
    } else {
      add(metal, 0.37, -0.08, -0.52, 0.48, 0.08, 0.09);
      add(metal, 0.58, -0.14, -0.52, 0.06, 0.17, 0.09);
    }
  }
  resize() {
    const width = innerWidth,
      height = innerHeight;
    this.renderer.setPixelRatio(
      Math.min(
        devicePixelRatio,
        this.quality === "low" ? 1 : this.quality === "high" ? 2 : 1.5,
      ),
    );
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
  qualitySet(q) {
    this.quality = q;
    this.renderer.shadowMap.enabled = q !== "low";
    this.sunLight.castShadow = q !== "low";
    const size = q === "high" ? 2048 : 1024;
    if (this.sunLight.shadow.mapSize.x !== size) {
      this.sunLight.shadow.map?.dispose();
      this.sunLight.shadow.map = null;
      this.sunLight.shadow.mapSize.set(size, size);
    }
    this.detailLimit = q === "low" ? 10 : q === "high" ? 42 : 24;
    this.radius = q === "low" ? 48 : q === "high" ? 108 : 76;
    this.scene.fog.near = this.radius * 0.58;
    this.scene.fog.far = this.radius + 18;
    this.camera.far = this.radius + 42;
    this.camera.updateProjectionMatrix();
    this.resize();
  }
  rebuild(count = 2) {
    let n = 0;
    for (const id of this.world.dirty) {
      this.world.dirty.delete(id);
      const cx = id % 10,
        cz = (id / 10) | 0,
        old = this.chunks.get(id);
      if (old) {
        old.geometry.dispose();
        this.scene.remove(old);
      }
      const mesh = new T.Mesh(
        chunkGeometry(this.world, cx, cz),
        this.terrainMaterial,
      );
      mesh.castShadow = mesh.receiveShadow = true;
      this.chunks.set(id, mesh);
      this.scene.add(mesh);
      if (++n >= count) break;
    }
  }
  instance(mesh, index, pos, scale, color, rx = 0, yaw = 0, body = null) {
    if (index >= mesh.instanceMatrix.count) return false;
    const o = this.o;
    o.position.set(...pos);
    o.scale.set(...scale);
    o.rotation.set(body?.pitch || 0, yaw, body?.roll || 0, "YXZ");
    o.rotateX(rx);
    o.updateMatrix();
    mesh.setMatrixAt(index, o.matrix);
    this.color.setHex(color);
    mesh.setColorAt(index, this.color);
    return true;
  }
  entities(eco, time, alpha = 1) {
    let near = 0,
      far = 0,
      detail = 0;
    const cam = this.camera.position,
      forward = this.camera.getWorldDirection(this.forward),
      visible = eco.entities.filter(
        (e) =>
          !e.dead &&
          (e.x - cam.x) ** 2 + (e.z - cam.z) ** 2 < this.radius ** 2 &&
          (e.x - cam.x) * forward.x + (e.z - cam.z) * forward.z > -4,
      );
    visible.sort(
      (a, b) =>
        (a.x - cam.x) ** 2 +
        (a.z - cam.z) ** 2 -
        (b.x - cam.x) ** 2 -
        (b.z - cam.z) ** 2,
    );
    for (const entity of visible) {
      const e = {
        ...entity,
        x:
          (entity.px ?? entity.x) +
          (entity.x - (entity.px ?? entity.x)) * alpha,
        y:
          (entity.py ?? entity.y) +
          (entity.y - (entity.py ?? entity.y)) * alpha,
        z:
          (entity.pz ?? entity.z) +
          (entity.z - (entity.pz ?? entity.z)) * alpha,
      };
      const sp = SPECIES[e.type],
        dist = Math.hypot(e.x - cam.x, e.z - cam.z),
        fine = dist < 23 && detail++ < this.detailLimit;
      for (let pi = 0; pi < sp.parts.length; pi++) {
        if (e.lost & (1 << pi)) continue;
        const p = sp.parts[pi],
          angle = pose(e, p, pi, time).angle;
        if (fine || e.damage[pi]) {
          for (let j = 0; j < p.count; j++)
            if (occupied(e, pi, j) && near < 24000) {
              const v = cellPosition(p, j),
                pos = toWorld(e, p, pi, v, time),
                shade = hash(j, pi, e.type) > 0.68 ? 0xeee0b0 : p.color;
              this.instance(
                this.nearMesh,
                near++,
                pos,
                [p.cell * 0.985, p.cell * 0.985, p.cell * 0.985],
                shade,
                angle,
                e.yaw,
                e.bodyPose,
              );
            }
        } else {
          const center = [0, p.leg ? (-p.dims[1] * p.cell) / 2 : 0, 0];
          this.instance(
            this.farMesh,
            far++,
            toWorld(e, p, pi, center, time),
            p.dims.map((v) => v * p.cell * 0.98),
            p.color,
            angle,
            e.yaw,
            e.bodyPose,
          );
        }
      }
      // Eyes are separate eighth-metre voxels and follow the head.
      if (!(e.lost & 2) && dist < 35) {
        const p = sp.parts[1];
        for (const x of [-0.2, 0.2])
          this.instance(
            this.farMesh,
            far++,
            toWorld(e, p, 1, [x, 0, -p.dims[2] * p.cell * 0.52], time),
            [0.125, 0.125, 0.055],
            0x172e2d,
            0,
            e.yaw,
            e.bodyPose,
          );
      }
    }
    for (const d of eco.debris)
      if (near < 24000)
        this.instance(
          this.nearMesh,
          near++,
          [d.x, d.y, d.z],
          [d.cell, d.cell, d.cell],
          d.color,
          d.rx,
          d.rx * 0.6,
        );
    for (const [m, n] of [
      [this.nearMesh, near],
      [this.farMesh, far],
    ]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.nearCount = near;
    this.farCount = far;
    this.visibleCount = visible.length;
  }
  environment(time, force = false) {
    if (this.fluidFrame++ % 6 !== 0 && !force) return;
    let n = 0;
    const w = this.world,
      cam = this.camera.position,
      rad = this.radius;
    for (const [i, f] of w.fluids) {
      const [x, y, z] = w.decode(i);
      if (
        (x - cam.x) ** 2 + (z - cam.z) ** 2 > rad * rad ||
        f.v < 0.005 ||
        w.fluids.get(w.index(x, y + 1, z))?.v > 0.9
      )
        continue;
      const a = f.v ? f.a / f.v : 0;
      this.instance(
        this.waterMesh,
        n++,
        [x + 0.5, y + f.v - 0.005, z + 0.5],
        [1, 1, 1],
        a > 0.08 ? 0x97bb46 : 0x458e9e,
      );
      if (n >= 16000) break;
    }
    this.waterMesh.count = n;
    this.waterMesh.instanceMatrix.needsUpdate = true;
    if (this.waterMesh.instanceColor)
      this.waterMesh.instanceColor.needsUpdate = true;
    n = 0;
    for (const [i, f] of w.burning) {
      const [x, y, z] = w.decode(i);
      this.instance(
        this.flameMesh,
        n++,
        [x + 0.5, y + 1.2 + Math.sin(time * 12 + i) * 0.12, z + 0.5],
        [0.45, 0.5 + Math.sin(time * 8 + i) * 0.2, 0.45],
        n % 2 ? 0xffa63c : 0xf6d581,
      );
      if (n >= 600) break;
    }
    this.flameMesh.count = n;
    this.flameMesh.instanceMatrix.needsUpdate = true;
    if (this.flameMesh.instanceColor)
      this.flameMesh.instanceColor.needsUpdate = true;
    n = 0;
    const maxr = this.quality === "low" ? 17 : 30;
    for (
      let z = Math.max(0, (cam.z - maxr) | 0);
      z < Math.min(SIZE, cam.z + maxr);
      z += 2
    )
      for (
        let x = Math.max(0, (cam.x - maxr) | 0);
        x < Math.min(SIZE, cam.x + maxr);
        x += 2
      ) {
        const i = x + z * SIZE,
          h = w.surface(x, z),
          v = w.plants[i];
        if (v < 0.28 || w.get(x, Math.floor(h - 0.001), z) !== B.GRASS)
          continue;
        const scale = 0.12 + v * 0.28;
        this.instance(
          this.grassMesh,
          n++,
          [x + 0.3 + hash(x, z) * 0.4, h + scale / 2, z + 0.5],
          [0.08, scale, 0.25],
          hash(x, z) > 0.92 ? 0xdac694 : v > 0.6 ? 0x96b477 : 0x889263,
          0,
          hash(x, z) * 6,
        );
        if (n >= 2200) break;
      }
    this.grassMesh.count = n;
    this.grassMesh.instanceMatrix.needsUpdate = true;
    if (this.grassMesh.instanceColor)
      this.grassMesh.instanceColor.needsUpdate = true;
  }
  pickups(loot, time) {
    let n = 0;
    for (const d of loot.items) {
      if (n >= 600) break;
      const glow = d.settled ? Math.sin(time * 2 + d.id) * 0.025 : 0;
      this.instance(
        this.pickupMesh,
        n++,
        [d.x, d.y + glow, d.z],
        [d.cell, d.cell, d.cell],
        d.color,
        d.rx,
        d.rx * 0.7,
      );
    }
    this.pickupMesh.count = n;
    this.pickupMesh.instanceMatrix.needsUpdate = true;
    if (this.pickupMesh.instanceColor)
      this.pickupMesh.instanceColor.needsUpdate = true;
  }
  draw(time, dt, moving = 0) {
    const day =
      0.5 + Math.sin(((((8 + time / 60) % 24) - 6) / 24) * Math.PI * 2) * 0.5;
    this.atmosphere.update(time, day);
    this.toolKick = Math.max(0, this.toolKick - dt * 6);
    this.tool.position.z = this.toolBase.z + this.toolKick * 0.035;
    this.tool.position.y =
      this.toolBase.y + Math.sin(time * 9) * 0.0025 * moving;
    this.tool.rotation.x = this.toolKick * 0.12;
    this.worldUI.update();
    this.renderer.render(this.scene, this.camera);
  }
  stats() {
    return {
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      nearVoxels: this.nearCount,
      farParts: this.farCount,
      visibleEntities: this.visibleCount,
    };
  }
}
