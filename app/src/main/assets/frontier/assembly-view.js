import { bodyHeight } from "../physics.js";
import { T } from "../render.js";
import { GEAR, spendGear } from "../equipment.js";
import { ITEMS } from "../inventory.js";
import { createLab, TYPES, damage, evaluate } from "../machine/model.js";
import { initialPose, worldPoint } from "../machine/assembly-state.js";
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export class AssemblyView {
  constructor(context, motion) {
    this.c = context;
    this.motion = motion;
    this.group = new T.Group();
    this.meshes = [];
    this.geometry = new T.BoxGeometry(0.49, 0.49, 0.49);
    this.materials = new Map();
    this.ghost = new T.Mesh(
      this.geometry,
      new T.MeshBasicMaterial({
        color: 0x9adba2,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    this.ghost.visible = false;
    context.view.scene.add(this.ghost);
    this.raycaster = new T.Raycaster();
    this.signature = "";
    this.nextUse = 0;
  }
  draw() {
    const s = this.c.model,
      machine = s.machine;
    this.group.visible = !!machine?.pose && machine.pose.region === s.key;
    if (!this.group.visible) {
      this.ghost.visible = false;
      return;
    }
    const structures = [machine, ...(machine.fragments || [])];
    const signature = structures
      .map((m) => m.blueprint.map((p) => `${p.id}:${m.hp[p.id]}`).join(","))
      .join("|");
    if (this.machine !== machine || this.signature !== signature) {
      this.group.clear();
      this.meshes = [];
      this.objects = [];
      for (const m of structures) {
        const object = new T.Group();
        this.group.add(object);
        this.objects.push({ m, object });
        for (const p of m.blueprint) {
          if (m.hp[p.id] <= 0) continue;
          const color = new T.Color(TYPES[p.type].color)
            .multiplyScalar(0.4 + (0.6 * m.hp[p.id]) / TYPES[p.type].hp)
            .getHex();
          let mat = this.materials.get(color);
          if (!mat) {
            mat = new T.MeshLambertMaterial({ color });
            this.materials.set(color, mat);
          }
          const mesh = new T.Mesh(this.geometry, mat);
          mesh.position.set(p.x * 0.5, p.y * 0.5 + 0.25, p.z * 0.5);
          mesh.userData = { assembly: m, part: p };
          if (p.type === "wing" || p.type === "elevator") mesh.scale.y = 0.14;
          if (p.type === "rudder") mesh.scale.x = 0.14;
          if (p.type === "propeller") mesh.scale.z = 0.26;
          object.add(mesh);
          this.meshes.push(mesh);
          if (["wing", "elevator", "rudder", "propeller"].includes(p.type)) {
            const stripe = new T.Mesh(
              this.geometry,
              (this.stripeMaterial ||= new T.MeshLambertMaterial({
                color: 0x485f59,
              })),
            );
            stripe.position.copy(mesh.position);
            if (p.type === "rudder") {
              stripe.scale.set(0.15, 0.2, 1);
            } else if (p.type === "propeller") {
              stripe.scale.set(0.26, 1.15, 0.3);
            } else {
              stripe.scale.set(1, 0.16, 0.18);
              stripe.position.z -= 0.14;
            }
            object.add(stripe);
          }
          if (p.type === "wheel") {
            const hub = new T.Mesh(
              this.geometry,
              (this.hubMaterial ||= new T.MeshLambertMaterial({
                color: 0xb0bbb7,
              })),
            );
            hub.scale.set(0.2, 0.35, 0.35);
            hub.position.copy(mesh.position);
            hub.position.x += Math.sign(p.x || 1) * 0.25;
            object.add(hub);
          }
        }
      }
      this.signature = signature;
      this.machine = machine;
    }
    for (const { m, object } of this.objects) {
      object.position.copy(m.pose.position);
      object.quaternion.copy(m.pose.rotation);
    }
    this.group.updateMatrixWorld(true);
  }
  ray(max = 6.5) {
    if (!this.group.visible) return null;
    const camera = this.c.view.camera,
      direction = new T.Vector3();
    camera.getWorldDirection(direction);
    this.raycaster.set(camera.position, direction);
    this.raycaster.far = max;
    const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
    return hit ? { ...hit, ...hit.object.userData } : null;
  }
  candidate(held, hit, block) {
    const type = ITEMS[held]?.machinePart,
      s = this.c.model;
    if (!type) return null;
    let m = s.machine,
      x = 0,
      y = 0,
      z = 0,
      pose;
    if (hit) {
      if (hit.assembly !== m)
        return { valid: false, reason: "떨어진 조각은 렌치로 회수하세요." };
      ({ x, y, z } = hit.part);
      x += Math.round(hit.face.normal.x);
      y += Math.round(hit.face.normal.y);
      z += Math.round(hit.face.normal.z);
      pose = m.pose;
    } else if (block && (!m || !m.blueprint.some((p) => m.hp[p.id] > 0))) {
      if (
        m?.pose.region !== s.key &&
        m?.fragments?.some((f) => f.blueprint.some((p) => f.hp[p.id] > 0))
      )
        return {
          valid: false,
          reason: "기존 조각이 있는 지역에서 회수하거나 다시 조립하세요.",
        };
      m = null;
      if (type !== "hull")
        return { valid: false, reason: "차체 블록을 먼저 바닥에 놓으세요." };
      pose = initialPose(
        block.hx * 0.5 + 0.25 + block.normal[0] * 0.5,
        block.hy * 0.5 + block.normal[1] * 0.5,
        block.hz * 0.5 + 0.25 + block.normal[2] * 0.5,
        s.key,
      );
    } else return { valid: false, reason: "현재 조립체의 면을 조준하세요." };
    const point = worldPoint(pose, {
      x: x * 0.5,
      y: y * 0.5 + 0.25,
      z: z * 0.5,
    });
    let reason = "";
    if (m && !m.pose.anchored)
      reason = "렌치 사용으로 먼저 조립체를 고정하세요.";
    if (s.riding) reason = "내린 뒤 조립하세요.";
    if (
      [x, y, z].some((n) => Math.abs(n) > 16) ||
      [s.machine, ...(s.machine?.fragments || [])].reduce(
        (n, a) => n + (a?.blueprint.filter((p) => a.hp[p.id] > 0).length || 0),
        0,
      ) >= 147
    )
      reason = "조립 범위 또는 147개 부품 한도입니다.";
    if (
      m?.blueprint.some(
        (p) => p.x === x && p.y === y && p.z === z && m.hp[p.id] > 0,
      )
    )
      reason = "이미 부품이 있습니다.";
    if (this.motion.physics?.overlapsPart(point, pose.rotation, m))
      reason = "다른 조각과 겹칩니다.";
    const player = this.c.player;
    if (
      Math.hypot(point.x - player.x, point.z - player.z) < 0.65 &&
      point.y > player.y - 0.25 &&
      point.y < player.y + bodyHeight(player) + 0.25
    )
      reason = "플레이어와 겹칩니다.";
    for (const dx of [-0.24, 0, 0.24])
      for (const dy of [-0.24, 0, 0.24])
        for (const dz of [-0.24, 0, 0.24]) {
          const v = worldPoint(pose, {
            x: x * 0.5 + dx,
            y: y * 0.5 + 0.25 + dy,
            z: z * 0.5 + dz,
          });
          if (
            this.c.world.getCell(
              Math.floor(v.x * 2),
              Math.floor(v.y * 2),
              Math.floor(v.z * 2),
            )
          )
            reason = "지형과 겹칩니다.";
        }
    if (
      point.x < 0.3 ||
      point.x > 159.7 ||
      point.z < 0.3 ||
      point.z > 159.7 ||
      point.y < 0.3 ||
      point.y > 79
    )
      reason = "월드 경계입니다.";
    return { valid: !reason, reason, m, x, y, z, pose, point, type };
  }
  aim(held, block, entityDistance = Infinity) {
    const hit = this.ray(Math.min(6.5, block?.distance ?? 6.5, entityDistance));
    this.hit = hit;
    this.placement = this.candidate(held, hit, block);
    this.ghost.visible = !!this.placement?.point;
    if (this.ghost.visible) {
      this.ghost.position.copy(this.placement.point);
      this.ghost.quaternion.copy(this.placement.pose.rotation);
      this.ghost.material.color.setHex(
        this.placement.valid ? 0x9adba2 : 0xeb806e,
      );
    }
    if (!hit) return false;
    const { assembly: m, part: p } = hit,
      f = evaluate(m),
      fragment = m !== this.c.model.machine;
    this.c.view.worldUI.set("focus", {
      title: `${TYPES[p.type].label} · ${fragment ? "분리된 조각" : m.pose.anchored ? "조립 고정" : "물리 작동"}`,
      detail: `HP ${Math.ceil(m.hp[p.id])}/${TYPES[p.type].hp} · ${Math.round(f.mass)} kg`,
      hint: ITEMS[held]?.machinePart
        ? this.placement?.reason || "사용: 면에 붙이기 · 0.5m"
        : held === "wrench"
          ? "공격: 회수 · 사용: 고정/해제"
          : held === "iron"
            ? "사용: 합금으로 수리"
            : "R / 상호작용: 탑승 · 렌치로 조립",
      value: m.hp[p.id],
      max: TYPES[p.type].hp,
      color: "#d8c896",
      maxDistance: 8,
      follow: () =>
        worldPoint(m.pose, { x: p.x * 0.5, y: p.y * 0.5 + 0.8, z: p.z * 0.5 }),
    });
    this.c.view.highlight.visible = false;
    return true;
  }
  use(intent, held, block, entityDistance = Infinity) {
    this.draw();
    this.aim(held, block, entityDistance);
    const hit = this.hit,
      type = ITEMS[held]?.machinePart,
      { model: s, inventory: inv, toast } = this.c;
    if (!hit && !(type && intent === "secondary")) return false;
    if (s.time < this.nextUse) return true;
    this.nextUse =
      s.time + ((intent !== "secondary" && GEAR[held]?.cooldown) || 0.3);
    if (intent === "secondary" && type) {
      const place = this.placement;
      if (!place?.valid) {
        toast(place?.reason || "부품을 붙일 면을 조준하세요.");
        return true;
      }
      if (!inv.take(held, 1)) return true;
      let m = place.m;
      if (!m) {
        m = createLab();
        m.stock = 0;
        m.assembly = true;
        m.pose = place.pose;
        m.fragments = s.machine?.fragments || [];
        s.machine = m;
      }
      const old = m.blueprint.find(
        (p) => p.x === place.x && p.y === place.y && p.z === place.z,
      );
      if (old) {
        m.blueprint = m.blueprint.filter((p) => p !== old);
        delete m.hp[old.id];
      }
      const p = {
        id: `p${m.nextId++}`,
        type,
        x: place.x,
        y: place.y,
        z: place.z,
      };
      m.blueprint.push(p);
      m.hp[p.id] = TYPES[type].hp;
      m.revision++;
      this.c.view.toolKick = 1;
      toast(TYPES[type].label + " 연결");
      return true;
    }
    if (!hit) return true;
    const { assembly: m, part: p } = hit;
    if (intent === "secondary" && held === "wrench") {
      if (s.riding || m !== s.machine) {
        toast("내린 뒤 본체를 조준하세요.");
        return true;
      }
      m.pose.anchored = !m.pose.anchored;
      if (m.pose.anchored) {
        m.pose.velocity = { x: 0, y: 0, z: 0 };
        m.pose.spin = { x: 0, y: 0, z: 0 };
      }
      toast(
        m.pose.anchored
          ? "조립체 고정 · 부품을 붙이거나 회수하세요."
          : "고정 해제 · 무게와 충돌이 적용됩니다.",
      );
      return true;
    }
    if (intent === "secondary" && held === "iron") {
      const cost = Math.max(
        1,
        Math.ceil(TYPES[p.type].cost * (1 - m.hp[p.id] / TYPES[p.type].hp)),
      );
      if (m.hp[p.id] >= TYPES[p.type].hp) toast("온전한 부품입니다.");
      else if (!inv.take("iron", cost))
        toast(`수리에 합금 ${cost}개가 필요합니다.`);
      else {
        m.hp[p.id] = TYPES[p.type].hp;
        m.revision++;
        toast("부품 수리 완료");
      }
      return true;
    }
    if (intent === "secondary") return false;
    if (held === "wrench") {
      if (s.riding || (m === s.machine && !m.pose.anchored)) {
        toast("렌치 사용으로 고정한 뒤 회수하세요.");
        return true;
      }
      const full = m.hp[p.id] === TYPES[p.type].hp,
        item = full ? `${p.type}_part` : "iron",
        count = full
          ? 1
          : Math.floor((TYPES[p.type].cost * m.hp[p.id]) / TYPES[p.type].hp);
      if (count && !inv.transaction({}, { [item]: count })) {
        toast("가방에 빈 공간이 필요합니다.");
        return true;
      }
      if (count) inv.grant(item, count);
      m.blueprint = m.blueprint.filter((a) => a !== p);
      delete m.hp[p.id];
      m.revision++;
      if (m !== s.machine && !m.blueprint.length)
        s.machine.fragments = s.machine.fragments.filter((a) => a !== m);
      toast(full ? "부품 회수" : "손상 비율만큼 합금 회수");
    } else {
      const gear = GEAR[held];
      if (hit.distance > (gear?.range || 3)) {
        toast("가까이 다가가 공격하세요.");
        return true;
      }
      if (gear && !spendGear(inv, gear.slot)) {
        toast("탄약이 필요합니다.");
        return true;
      }
      damage(m, p.id, gear?.damage || (gear?.slot === "tool" ? 6 : 4));
      this.c.view.toolKick = 1;
    }
    return true;
  }
  near() {
    const s = this.c.model,
      p = s.machine?.pose;
    return (
      p?.region === s.key &&
      distance(this.c.player, p.position) < evaluate(s.machine).radius + 3
    );
  }
  ride() {
    const s = this.c.model;
    if (!s.riding && !this.near()) return false;
    const was = s.riding;
    this.c.toast(s.toggleRide(this.c.inventory));
    if (was) this.motion.dismount();
    return true;
  }
}
