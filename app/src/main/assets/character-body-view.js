import * as T from "./vendor/three.module.js";
import { CharacterBody, skinVoxels } from "./character-body.js";
import { PIXEL as P } from "./character-model.js";
import { boneHealth, rayBox } from "./structural-body.js";
import {
  boxesGeometry,
  characterMaterial,
  textures,
} from "./character-view.js";
const faceDirs = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
// Emit only exposed faces after damage. Intact parts retain their cached art mesh.
export function damagedSurface(graph, part, removed) {
  const cells = skinVoxels(graph, part),
    pos = [],
    norm = [],
    col = [],
    uv = [];
  const unit = new T.BoxGeometry(P, P, P).toNonIndexed(),
    p = unit.attributes.position,
    n = unit.attributes.normal,
    t = unit.attributes.uv;
  for (const v of cells.values())
    if (!removed.has(v.key)) {
      const color = new T.Color(v.color),
        tile = Math.max(0, textures.indexOf(v.texture));
      for (let face = 0; face < 6; face++) {
        const dir = faceDirs[face],
          neighbor = v.grid.map((x, i) => x + dir[i]).join(",");
        if (cells.has(neighbor) && !removed.has(neighbor)) continue;
        const axis = face < 2 ? 0 : face < 4 ? 1 : 2,
          uAxis = axis === 0 ? 2 : 0,
          vAxis = axis === 1 ? 2 : 1;
        const ox = (tile % 4) * 32 + 1 + (((v.grid[uAxis] % 14) + 14) % 14),
          oy =
            Math.floor(tile / 4) * 32 + 1 + (((v.grid[vAxis] % 14) + 14) % 14);
        for (let k = face * 6; k < face * 6 + 6; k++) {
          pos.push(
            p.getX(k) + v.at[0],
            p.getY(k) + v.at[1],
            p.getZ(k) + v.at[2],
          );
          norm.push(n.getX(k), n.getY(k), n.getZ(k));
          col.push(color.r, color.g, color.b);
          uv.push((ox + t.getX(k)) / 128, (oy + t.getY(k)) / 128);
        }
      }
    }
  unit.dispose();
  const g = new T.BufferGeometry();
  for (const [id, a, size] of [
    ["position", pos, 3],
    ["normal", norm, 3],
    ["color", col, 3],
    ["uv", uv, 2],
  ])
    g.setAttribute(id, new T.Float32BufferAttribute(a, size));
  g.computeBoundingSphere();
  return g;
}
export class CharacterBodyView {
  constructor(rig, saved) {
    this.rig = rig;
    this.body = rig.body = new CharacterBody(rig.model, saved);
    this.skinOwned = new Map();
    this.boneMeshes = [];
    this.fragmented = new Set();
    this.fragments = [];
    this.sync();
  }
  sync() {
    for (const mesh of this.rig.meshes) {
      const part = mesh.userData.bodyPart,
        removed = this.body.shell.get(part);
      if (removed) {
        this.skinOwned.get(part)?.dispose();
        const g = damagedSurface(this.body.model, part, removed);
        mesh.geometry = g;
        this.skinOwned.set(part, g);
      }
      this.rig.bones[part].visible = this.body.attached(part);
    }
    for (const m of this.boneMeshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.boneMeshes = [];
    for (const [part] of this.body.model.parts) {
      const pieces = this.pieces().filter((p) => p.part === part);
      if (!pieces.length) continue;
      const mesh = new T.Mesh(
        boxesGeometry(
          pieces.map((p) => ({
            ...p,
            color:
              this.body.structure.hp[p.node] !== undefined
                ? 0xbd956d
                : 0xe4d6b5,
            texture: "plain",
          })),
        ),
        characterMaterial(),
      );
      mesh.userData.structure = true;
      this.rig.bones[part].add(mesh);
      this.boneMeshes.push(mesh);
    }
  }
  pieces() {
    return this.body.model.pieces.filter(
      (p) =>
        this.body.attached(p.part) &&
        boneHealth(this.body.model, this.body.structure, p.node) > 0 &&
        (!p.other ||
          boneHealth(this.body.model, this.body.structure, p.other) > 0),
    );
  }
  raycast(origin, direction, max) {
    this.rig.root.updateMatrixWorld(true);
    let result = null,
      best = max;
    const ray = new T.Raycaster(origin, direction, 0, max),
      visible = (o) => {
        for (let p = o; p; p = p.parent) if (!p.visible) return false;
        return true;
      };
    for (const h of ray.intersectObjects(this.rig.meshes, false)) {
      if (!visible(h.object)) continue;
      result = {
        part: h.object.userData.bodyPart,
        layer: "shell",
        point: h.point,
        distance: h.distance,
      };
      best = h.distance;
      break;
    }
    const rays = new Map();
    for (const p of this.pieces()) {
      if (!rays.has(p.part)) {
        const inverse = this.rig.bones[p.part].matrixWorld.clone().invert(),
          o = origin.clone().applyMatrix4(inverse),
          end = origin.clone().add(direction).applyMatrix4(inverse);
        rays.set(p.part, { o: o.toArray(), d: end.sub(o).toArray() });
      }
      const r = rays.get(p.part),
        t = rayBox(r.o, r.d, p.at, p.size, best);
      if (t !== null) {
        best = t;
        result = {
          part: p.part,
          layer: "structure",
          node: p.node,
          point: origin.clone().addScaledVector(direction, t),
          distance: t,
        };
      }
    }
    return result;
  }
  damage(hit, amount, radius = 0.075) {
    const before = new Set(
      [...this.body.model.parts.keys()].filter((p) => this.body.attached(p)),
    );
    const result =
      hit.layer === "structure"
        ? this.body.damageBone(hit.node, amount)
        : {
            removed: this.body.removeSurface(
              hit.part,
              this.rig.bones[hit.part]
                .worldToLocal(hit.point.clone())
                .toArray(),
              radius,
            ),
          };
    this.rig.root.updateMatrixWorld(true);
    // Detached subtrees become loose visual chunks; the logical actor persists.
    for (const part of before) {
      const bone = this.rig.bones[part];
      if (this.body.attached(part) || this.fragmented.has(part)) continue;
      const parent = this.body.model.parts.get(part).parent;
      if (before.has(parent) && !this.body.attached(parent)) continue;
      const fragment = bone.clone(true);
      fragment.traverse((m) => {
        if (m.isMesh) m.geometry = m.geometry.clone();
      });
      bone.matrixWorld.decompose(
        fragment.position,
        fragment.quaternion,
        fragment.scale,
      );
      this.rig.root.parent.add(fragment);
      this.fragments.push({ mesh: fragment, vy: 0, life: 8 });
      bone.traverse((b) => this.fragmented.add(b.name));
    }
    this.sync();
    return result;
  }
  animate(time, dt, surface, inspect = false) {
    const f = this.body.status().functions,
      alive = this.body.status().alive,
      legs = Number(f.legL) + Number(f.legR),
      arms = Number(f.armL) + Number(f.armR);
    this.rig.animate({
      time,
      phase: time * 3,
      action: !alive
        ? "idle"
        : legs === 2
          ? inspect
            ? "idle"
            : "walk"
          : legs === 1
            ? "crouch"
            : arms
              ? "crawl"
              : "idle",
    });
    if (legs === 1) {
      this.rig.bones.torso.rotation.z = f.legL ? 0.13 : -0.13;
      this.rig.bones[f.legL ? "legL" : "legR"].rotation.x +=
        Math.sin(time * 3) * 0.12;
    }
    if (!alive)
      for (const bone of Object.values(this.rig.bones))
        bone.rotation.set(0, 0, 0);
    for (const p of this.fragments) {
      p.life -= dt;
      p.vy -= 9 * dt;
      p.mesh.position.y += p.vy * dt;
      const floor = surface(p.mesh.position.x, p.mesh.position.z) + 0.12;
      if (p.mesh.position.y < floor) {
        p.mesh.position.y = floor;
        p.vy = 0;
      } else p.mesh.rotation.z += dt * 0.9;
    }
    this.fragments = this.fragments.filter((p) => {
      if (p.life > 0) return true;
      this.disposeFragment(p);
      return false;
    });
    return !alive
      ? "중추 파괴 · 정지"
      : legs === 2
        ? "정상 보행"
        : legs === 1
          ? "다리 지지 상실 · 절뚝거림"
          : arms
            ? "두 다리 지지 상실 · 기어 이동"
            : "지지·팔 기능 상실 · 정지";
  }
  disposeFragment(p) {
    p.mesh.traverse((m) => {
      if (m.isMesh) m.geometry.dispose();
    });
    p.mesh.removeFromParent();
  }
  dispose() {
    for (const g of this.skinOwned.values()) g.dispose();
    for (const m of this.boneMeshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.fragments.forEach((p) => this.disposeFragment(p));
    this.rig.dispose();
  }
}
