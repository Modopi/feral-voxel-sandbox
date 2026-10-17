import * as T from "./vendor/three.module.js";
import { COLORS } from "./world.js";
import { cellKey, FACES } from "./structure.js";
import { massCenter } from "./loose-voxels.js";
import { worldPoint } from "./machine/assembly-state.js";
import { ITEMS, resourceForBlock } from "./inventory.js";
import { GEAR, activeGear, miningWork, spendGear } from "./equipment.js";
export function looseGeometry(cells) {
  const positions = [],
    normals = [],
    colors = [],
    materials = [],
    color = new T.Color();
  const filled = new Set(cells.map((c) => cellKey(c.x, c.y, c.z)));
  for (const c of cells)
    for (const face of FACES) {
      if (filled.has(cellKey(c.x + face[0], c.y + face[1], c.z + face[2])))
        continue;
      const d = face.findIndex(Boolean),
        sign = face[d],
        u = (d + 1) % 3,
        v = (d + 2) % 3;
      const a = [c.x * 0.5 - 0.25, c.y * 0.5 - 0.25, c.z * 0.5 - 0.25];
      if (sign > 0) a[d] += 0.5;
      const corners = [a.slice(), a.slice(), a.slice(), a.slice()];
      corners[1][u] += 0.5;
      corners[2][u] += 0.5;
      corners[2][v] += 0.5;
      corners[3][v] += 0.5;
      color.setHex(COLORS[c.b]);
      const shade =
        (d === 1 ? (sign > 0 ? 1 : 0.6) : d === 0 ? 0.84 : 0.72) *
        (1 - (c.damage || 0) * 0.25);
      for (const i of sign > 0 ? [0, 1, 2, 0, 2, 3] : [0, 3, 2, 0, 2, 1]) {
        positions.push(...corners[i]);
        normals.push(...face);
        colors.push(color.r * shade, color.g * shade, color.b * shade);
        materials.push(c.b);
      }
    }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new T.Float32BufferAttribute(normals, 3));
  g.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  g.setAttribute("materialKind", new T.Float32BufferAttribute(materials, 1));
  g.computeBoundingSphere();
  return g;
}
const names = [
  "",
  "풀밭",
  "흙",
  "돌",
  "모래",
  "원목",
  "잎",
  "광석",
  "현무암",
  "용암",
  "재",
  "목재",
];
export class LooseView {
  constructor(c) {
    this.c = c;
    this.meshes = new Map();
    this.nextUse = 0;
    this.line = new T.Line(
      new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]),
      new T.LineBasicMaterial({
        color: 0x8ee5d0,
        transparent: true,
        opacity: 0.65,
      }),
    );
    this.line.frustumCulled = false;
    c.view.scene.add(this.line);
    this.line.visible = false;
  }
  draw() {
    const { world, view } = this.c,
      active = world.loose.bodies;
    for (const [s, e] of this.meshes)
      if (!active.includes(s)) {
        view.scene.remove(e.mesh);
        e.mesh.geometry.dispose();
        this.meshes.delete(s);
      }
    for (const s of active) {
      let e = this.meshes.get(s);
      if (!e) {
        const mesh = new T.Mesh(looseGeometry(s.cells), view.terrainMaterial);
        mesh.castShadow = mesh.receiveShadow = true;
        view.scene.add(mesh);
        e = { mesh, revision: s.revision };
        this.meshes.set(s, e);
      }
      if (e.revision !== s.revision) {
        e.mesh.geometry.dispose();
        e.mesh.geometry = looseGeometry(s.cells);
        e.revision = s.revision;
      }
      e.mesh.position.copy(s.pose.position);
      e.mesh.quaternion.copy(s.pose.rotation);
    }
    const physics = this.c.currentPhysics(),
      grip = physics?.loose.grip;
    this.line.visible = !!grip;
    if (grip) {
      const hand = new T.Vector3(0.2, -0.12, -0.45).applyMatrix4(
          view.camera.matrixWorld,
        ),
        at = worldPoint(grip.s.pose, grip.local),
        p = this.line.geometry.attributes.position;
      p.setXYZ(0, hand.x, hand.y, hand.z);
      p.setXYZ(1, at.x, at.y, at.z);
      p.needsUpdate = true;
    }
  }
  use(hit, intent, held, repeated) {
    const physics = this.c.currentPhysics(),
      grip = physics?.loose.grip;
    if (!hit && !grip && (held !== "grapple" || intent === "secondary"))
      return false;
    if (repeated && (grip || held === "grapple" || intent === "secondary"))
      return true;
    const { world, inventory, view, toast } = this.c;
    if (world.time < this.nextUse) return true;
    this.nextUse = world.time + 0.18;
    const direction = new T.Vector3();
    view.camera.getWorldDirection(direction);
    if (grip) {
      physics.loose.release(intent === "secondary" ? null : direction);
      toast(
        intent === "secondary"
          ? "물체 내려놓기"
          : "물체 던지기 · 무거운 물체는 천천히 날아갑니다",
      );
      return true;
    }
    if (!hit) {
      toast("운반 집게 · 분리된 복셀 덩어리에 사용하세요");
      return true;
    }
    if (intent === "secondary") {
      if (held === "grapple" || (!ITEMS[held]?.block && held !== "wrench")) {
        if (hit.distance > (held === "grapple" ? 6.5 : 3)) {
          toast("손으로 잡으려면 3m 안으로 다가가세요");
          return true;
        }
        if (physics.loose.grab(hit, held === "grapple"))
          toast("운반 중 · 화면을 돌려 이동 · 사용: 내려놓기 · 공격: 던지기");
        else toast("렌치로 고정을 해제한 뒤 집으세요");
      } else if (held === "wrench") {
        hit.body.pose.anchored = !hit.body.pose.anchored;
        hit.body.pose.velocity = { x: 0, y: 0, z: 0 };
        hit.body.pose.spin = { x: 0, y: 0, z: 0 };
        toast(
          hit.body.pose.anchored
            ? "물체 고정 · 렌치로 다시 해제"
            : "고정 해제 · 중력 적용",
        );
      } else if (ITEMS[held]?.block) {
        if (!inventory.count(held)) toast("붙일 재료가 부족합니다");
        else if (!physics.loose.canAdd(hit))
          toast("다른 물체·지형과 겹쳐 붙일 수 없습니다");
        else if (world.loose.add(hit, ITEMS[held].block)) {
          inventory.take(held, 1);
          toast("물체 표면에 0.5m 복셀 붙이기");
        }
      } else toast("운반 집게: 집기 · 렌치: 고정 · 재료: 붙이기 · 도구: 깎기");
    } else if (held === "grapple" || !held) {
      physics.loose.push(hit, direction, held === "grapple");
      toast("물체 밀기 · 질량에 따라 가속");
    } else {
      const g =
        GEAR[held]?.slot === "tool" ? activeGear(inventory, "tool") : GEAR.pick;
      if (world.loose.strike(hit, 0.2 / miningWork(hit.cell.b, 0.5, g))) {
        const item = resourceForBlock(hit.cell.b);
        if (item) this.c.loot.spawn(item, 1, ...hit.point);
        if (GEAR[held]?.slot === "tool") spendGear(inventory, "tool");
        toast("복셀 절단 · 분리된 부분은 새 물체가 됩니다");
      } else
        toast(`복셀 파손 ${Math.floor(hit.cell.damage * 100)}% · 손상 보존`);
      view.toolKick = 1;
    }
    return true;
  }
  aim(hit, held) {
    const grip = this.c.currentPhysics()?.loose.grip;
    if (!hit && !grip) return false;
    const body = grip?.s || hit.body,
      mass = massCenter(body.cells).mass;
    const use = grip
      ? "내려놓기"
      : held === "grapple"
        ? "집기"
        : held === "wrench"
          ? body.pose.anchored
            ? "고정 해제"
            : "고정하기"
          : ITEMS[held]?.block
            ? "붙이기 ×1"
            : "잡기·끌기";
    document.querySelector("#useBtn small").textContent = use;
    document.querySelector("#actBtn small").textContent = grip
      ? "던지기"
      : "깎기";
    this.c.view.worldUI.set("focus", {
      title: grip
        ? "복셀 덩어리 운반 중"
        : `${names[hit.cell.b]} 덩어리 #${body.id}`,
      detail: `${body.cells.length}복셀 · ${mass >= 1000 ? (mass / 1000).toFixed(1) + " t" : Math.round(mass) + " kg"} · ${body.pose.anchored ? "고정" : "동적 물체"}`,
      hint: grip
        ? "화면을 돌려 운반 · 사용: 놓기 · 공격: 던지기"
        : "사용: 잡고 끌기 · 집게: 힘 보조 · 렌치: 고정 · 재료: 붙이기",
      value: hit?.cell.damage || 0,
      max: 1,
      color: "#a6e4d0",
      maxDistance: 12,
      follow: () => {
        const p = worldPoint(body.pose, grip?.local || hit.local);
        return { ...p, y: p.y + 0.2 };
      },
    });
    this.c.view.highlight.visible = false;
    return true;
  }
}
