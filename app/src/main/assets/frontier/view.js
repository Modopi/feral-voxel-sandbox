import { CharacterBodyView } from "../character-body-view.js";
import { CharacterRig } from "../character-view.js";
import { mountCharacterPortrait } from "../character-portrait.js";
import { uiIcon } from "../ui-art.js";
import { CampaignView } from "./campaign-view.js";
import { BIOMES, CROPS, biomeIndex } from "./campaign.js";
import { PATTERNS, attackZones } from "./encounters.js";
import {
  GATHERABLES,
  CONTRACTS,
  resourceSites,
  relaySites,
  ruinDefinition,
} from "./content.js";
import { ITEMS } from "../inventory.js";
import { activeGear, gearId, GEAR } from "../equipment.js";
import { itemArt } from "../item-art.js";
import { T } from "../render.js";
import { FACTIONS } from "./model.js";
import { AssemblyView } from "./assembly-view.js";
import { FrontierMotion } from "./motion.js";
import { evaluate, TYPES } from "../machine/model.js";
import { mountFieldHUD, setVitals, waypointText, GameWindow } from "../shell.js";
const $ = (id) => document.getElementById(id);
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class FrontierView {
  constructor(ctx) {
    this.c = ctx;
    this.motion = new FrontierMotion(ctx);
    this.assembly = new AssemblyView(ctx, this.motion);
    this.waypoint = null;
    this.revision = -1;
    this.oldPosition = null;
    this.group = new T.Group();
    ctx.view.scene.add(this.group);
    this.cube = new T.BoxGeometry(1, 1, 1);
    this.materials = new Map();
    this.npcs = [];
    this.targets = [];
    this.resourceMeshes = [];
    this.relayMeshes = [];
    mountFieldHUD({
      onJournal: () => this.open("map"),
      onStatus: () => this.open("journal"),
      onInteract: () => ctx.interact(),
    });
    this.window = new GameWindow({
      initial: "map",
      tabs: [
        { id: "journey", label: "여정", ariaLabel: "여정과 야영지", icon: "journey" },
        { id: "journal", label: "상태", ariaLabel: "캐릭터 상태", icon: "person" },
        { id: "map", label: "지도", ariaLabel: "원정 지도", icon: "map" },
        { id: "society", label: "마을", ariaLabel: "공동체", icon: "village" },
        { id: "machine", label: "기계", ariaLabel: "기계 조립", icon: "tools" },
      ],
      titles: {
        journey: "첫 신호 · 여정과 야영지",
        map: "원정 지도",
        society: "공동체",
        machine: "기계 조립",
        journal: "캐릭터 상태",
      },
      canOpen: () => this.c.running,
      onOpen: () => this.c.pause(true),
      onClose: () => ctx.pause(false),
      render: () => this.render(),
    });
    document.querySelector('[data-panel="world"] > p').textContent =
      "절차 생성 지역을 탐험하세요. 야영지 또는 지역 가장자리에서 원정 장부를 열어 인접 지역으로 이동할 수 있습니다.";
    document.querySelector('[data-tab="life"]').hidden = true;
    $("homeBtn").textContent = "야영지 귀환";
    // No free teleport during a fight: escape costs a recovery, just like defeat.
    $("homeBtn").onclick = () => {
      ctx.model.hp = 0;
      ctx.pause(false);
    };
    $("flyBtn").setAttribute("aria-label", "차량 비행 전환");
    $("flyBtn").innerHTML = "◇<small>비행</small>";
    $("flyBtn").innerHTML = uiIcon("flight") + "<small>비행</small>";
    this.waypoint = ctx.model.region.villages[0];
    this.campaignUI = new CampaignView(this);
  }
  box(parent, x, y, z, sx, sy, sz, color) {
    let mat = this.materials.get(color);
    if (!mat) {
      mat = new T.MeshStandardMaterial({
        color,
        roughness: 0.8,
        metalness: 0.04,
      });
      this.materials.set(color, mat);
    }
    const mesh = new T.Mesh(this.cube, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  resetScene() {
    this.c.view.worldUI.clear();
    for (const { light } of this.relayMeshes) light.material.dispose();
    this.bossCore?.material.dispose();
    this.campaignUI?.lamps?.forEach((m) => m.material.dispose());
    this.campaignUI?.beam?.material.dispose();
    this.warning?.geometry.dispose();
    this.warning?.material.dispose();
    this.warningGroup?.children.forEach((m) => {
      m.geometry.dispose();
      m.material.dispose();
    });
    this.training?.dispose();
    this.npcs.forEach((n) => n.rig?.dispose());
    this.group.clear();
    this.npcs = [];
    this.targets = [];
    this.resourceMeshes = [];
    this.relayMeshes = [];
    this.revision = -1;
    const { world, model: s } = this.c;
    for (const v of s.region.villages) {
      const y = world.surface(v.x, v.z);
      this.box(this.group, v.x, y + 2, v.z, 0.12, 4, 0.12, 0x635344);
      this.box(
        this.group,
        v.x + 0.6,
        y + 3.5,
        v.z,
        1.2,
        0.7,
        0.08,
        [0xa7bf7c, 0xd0a06d, 0x9aa9c9][v.faction],
      );
      for (let i = 0; i < 3; i++) {
        const rig = new CharacterRig(
            ["quartermaster", "herbalist", "mechanic"][i],
            v.faction + i,
          ),
          group = rig.root;
        this.group.add(group);
        this.npcs.push({
          group,
          v,
          i,
          rig,
          phase: i * 2,
          lastTime: null,
          near: false,
          greetUntil: 0,
        });
        this.registerTarget(group, {
          kind: "npc",
          village: v,
          name: `${v.name} · ${["보급 담당", "약초사", "정비사"][i]}`,
          role: i,
        });
      }
    }
    this.createTrainingBody();
    if (world.workyard) {
      const { x, y, z } = world.workyard;
      const sign = this.box(
        this.group,
        x,
        y + 0.9,
        z,
        1.1,
        0.6,
        0.12,
        0x365c53,
      );
      this.box(this.group, x, y + 0.3, z, 0.12, 0.6, 0.12, 0x947654);
      this.registerTarget(sign, { kind: "workyard", name: "해체·운반 작업장" });
    }
    const cy = world.surface(77, 84);
    this.registerTarget(
      this.box(this.group, 77, cy + 0.25, 84, 1.1, 0.5, 1.1, 0xd69d55),
      { kind: "camp", name: "원정 보급함" },
    );
    this.boss = new T.Group();
    this.group.add(this.boss);
    this.registerTarget(this.boss, {
      kind: "boss",
      name: BIOMES[s.info.biome].boss,
    });
    this.bossCore = this.box(
      this.boss,
      0,
      1.8,
      0,
      1.7,
      2,
      1.2,
      BIOMES[s.info.biome].color,
    );
    this.box(this.boss, 0, 3.2, 0, 1.1, 0.8, 0.9, 0xd4b968);
    this.bossCore.material = this.bossCore.material.clone();
    this.bossCore.material.emissive.setHex(BIOMES[s.info.biome].color);
    this.bossCore.material.emissiveIntensity = 0.08;
    this.box(this.boss, 0, 3.22, 0.47, 0.55, 0.12, 0.05, 0x9ee4d8);
    for (const side of [-1, 1]) {
      if (s.info.biome === 0) {
        this.box(this.boss, side * 0.65, 3.8, 0, 0.2, 1.2, 0.2, 0x836a48);
        this.box(this.boss, side * 0.95, 4.2, 0, 0.7, 0.15, 0.18, 0xb4c187);
      } else if (s.info.biome === 1) {
        const shoulder = this.box(
          this.boss,
          side * 1.2,
          2.5,
          0,
          0.9,
          0.7,
          1,
          0xa77b58,
        );
        shoulder.rotation.z = side * 0.18;
        this.box(this.boss, side * 0.8, 3.3, 0, 0.6, 0.4, 0.7, 0x6e7b7c);
      } else {
        const fin = this.box(
          this.boss,
          side * 1.3,
          2.5,
          0,
          0.3,
          2.3,
          0.7,
          0x7bb6c3,
        );
        fin.rotation.z = side * 0.4;
      }
    }

    this.bossLimbs = [-1, 1].map((side) =>
      this.box(this.boss, side * 1.15, 1.8, 0, 0.55, 1.7, 0.6, 0x40534e),
    );
    for (const side of [-1, 1])
      this.box(this.boss, side * 0.55, 0.55, 0, 0.6, 1.1, 0.7, 0x465d57);
    this.warning = new T.Mesh(
      new T.RingGeometry(0.1, 4, 40),
      new T.MeshBasicMaterial({
        color: 0xff6248,
        transparent: true,
        opacity: 0.55,
        side: T.DoubleSide,
        depthWrite: false,
      }),
    );
    this.warning.rotation.x = -Math.PI / 2;
    this.group.add(this.warning);
    this.warningGroup = new T.Group();
    this.group.add(this.warningGroup);
    this.warningKey = null;
    this.beacon = this.box(this.group, 0, 0, 0, 0.18, 6, 0.18, 0xe5c56f);
    const d = s.info.dungeon;
    this.cache = this.box(
      this.group,
      d.x,
      world.surface(d.x, d.z) + 0.7,
      d.z,
      1,
      1.4,
      1,
      0x71d6cb,
    );
    this.registerTarget(this.cache, {
      kind: "ruin",
      name: ruinDefinition(s.info).name + " · 공명 핵",
    });
    for (const site of relaySites(s.info)) {
      const root = new T.Group();
      root.position.set(site.x, world.surface(site.x, site.z), site.z);
      this.group.add(root);
      this.box(root, 0, 0.25, 0, 0.6, 0.5, 0.6, 0x576966);
      const light = this.box(root, 0, 0.8, 0, 0.38, 0.6, 0.38, 0xe0a45c);
      // Each relay owns its lamp material; changing it must not recolor other objects.
      light.material = light.material.clone();
      this.relayMeshes.push({ root, light, site });
      this.registerTarget(root, { kind: "relay", ...site });
    }
    for (const site of resourceSites(s.info)) {
      const def = GATHERABLES[site.kind],
        root = new T.Group();
      root.position.set(site.x, world.surface(site.x, site.z), site.z);
      this.group.add(root);
      this.box(
        root,
        0,
        0.12,
        0,
        0.6,
        0.24,
        0.6,
        site.kind === "scrap" ? 0x59656a : 0x576e43,
      );
      const growth = new T.Group();
      root.add(growth);
      for (const [x, y, z, h] of [
        [-0.22, 0.42, 0, 0.45],
        [0.2, 0.5, 0.15, 0.6],
        [0, 0.6, -0.12, 0.7],
      ])
        this.box(growth, x, y, z, 0.24, h, 0.24, def.color);
      if (site.kind === "wood") {
        growth.clear();
        this.box(growth, 0, 0.65, 0, 0.25, 1.3, 0.25, 0x805738);
        this.box(growth, 0, 1.5, 0, 1.1, 0.8, 1.1, def.color);
      }
      if (site.kind === "berry") {
        growth.clear();
        this.box(growth, 0, 0.42, 0, 0.9, 0.7, 0.85, 0x597a51);
        for (const [x, z] of [
          [-0.3, 0.4],
          [0.25, 0.37],
          [0.25, -0.3],
        ])
          this.box(growth, x, 0.62, z, 0.18, 0.18, 0.18, 0xc76b77);
      } else if (site.kind === "herb") {
        for (const x of [-0.22, 0.2, 0])
          this.box(growth, x, 0.94, 0, 0.2, 0.09, 0.2, 0xd8dbbc);
      } else if (site.kind === "scrap") {
        growth.children.forEach((m, i) => {
          m.rotation.z = (i - 1) * 0.5;
          m.scale.y *= 0.65;
        });
        this.box(growth, 0, 0.23, 0.2, 0.9, 0.15, 0.25, 0x7f9394);
      } else if (site.kind === "crystal")
        growth.children.forEach((m, i) => (m.rotation.z = (i - 1) * 0.25));
      this.resourceMeshes.push({ root, growth, site });
      this.registerTarget(root, { kind: "resource", site, name: def.name });
    }
    this.vehicle = this.assembly.group;
    this.group.add(this.vehicle);
    this.support = new T.Group();
    this.group.add(this.support);
    this.box(this.support, 0, 0.8, 0, 0.5, 1, 0.4, 0xaacb85);
    this.box(this.support, 0, 1.5, 0, 0.3, 0.35, 0.3, 0xe4cfa6);
    this.campaignUI.reset();
    this.draw();
  }
  createTrainingBody() {
    const { world, model: s } = this.c;
    this.training?.dispose();
    const rig = new CharacterRig("explorer");
    rig.root.position.set(81, world.surface(81, 89) + 0.14, 89);
    this.group.add(rig.root);
    this.training = new CharacterBodyView(rig, s.region.trainingBody);
    this.training.lastTime = s.time;
    if (!this.trainingStand || !this.trainingStand.parent) {
      this.trainingStand = this.box(
        this.group,
        81,
        world.surface(81, 89) + 0.06,
        89,
        0.9,
        0.12,
        0.9,
        0x8f9b83,
      );
      this.registerTarget(this.trainingStand, {
        kind: "bodyStation",
        name: "구조 훈련체 · 재조립 받침",
      });
    }
  }
  damageTraining(hit, held) {
    if (hit.distance > 3) {
      this.c.toast("3m 안에서 구조 훈련체를 타격하세요.");
      return;
    }
    const amount =
      GEAR[held]?.slot === "weapon"
        ? activeGear(this.c.inventory, "weapon").damage
        : 8;
    this.training.damage(
      hit,
      amount,
      GEAR[held]?.slot === "tool" ? 0.065 : 0.09,
    );
    this.c.model.region.trainingBody = this.training.body.save();
    this.c.view.toolKick = 1;
    this.c.toast(
      hit.layer === "shell"
        ? "외피 제거 · 내부 구조는 유지됩니다"
        : "골격 타격 · 지지와 관절 기능 재계산",
    );
    this.training.lastTime = null;
  }
  draw() {
    this.updateTargets();
    this.assembly.draw();
    this.campaignUI.update();
  }
  updateTargets() {
    const { model: s, world, player: p } = this.c;
    if (!this.boss) return;
    for (const n of this.npcs) {
      const { group, v, i, rig } = n,
        t = s.time * 0.18 + i * 2,
        dt =
          n.lastTime === null
            ? 0
            : Math.min(0.15, Math.max(0, s.time - n.lastTime));
      // Selection and draw can both update in the same simulation tick. Preserve
      // the travelled-distance pose instead of replacing it with idle on dt=0.
      if (n.lastTime === s.time) continue;
      n.lastTime = s.time;
      if (!group.userData.placed) {
        group.position.set(
          v.x + Math.cos(t) * 3,
          world.surface(v.x, v.z),
          v.z + 1 + Math.sin(t) * 2,
        );
        group.userData.placed = true;
      }
      const near = distance(p, group.position) < 4;
      if (near && !n.near) n.greetUntil = s.time + 1.4;
      n.near = near;
      const walking = !near && (s.time + i * 3) % 14 < 8;
      let desired = group.rotation.y,
        moved = 0;
      if (walking) {
        const dx = v.x + Math.cos(t) * 3 - group.position.x,
          dz = v.z + 1 + Math.sin(t) * 2 - group.position.z,
          d = Math.hypot(dx, dz);
        moved = Math.min(d, dt * 0.65);
        if (d > 0.01) {
          group.position.x += (dx / d) * moved;
          group.position.z += (dz / d) * moved;
          desired = Math.atan2(dx, dz);
        }
      } else if (near)
        desired = Math.atan2(p.x - group.position.x, p.z - group.position.z);
      group.position.y = world.surface(group.position.x, group.position.z);
      const turn = Math.atan2(
        Math.sin(desired - group.rotation.y),
        Math.cos(desired - group.rotation.y),
      );
      group.rotation.y += turn * Math.min(1, dt * 6);
      n.phase += moved * 8;
      const look = near
        ? Math.atan2(p.x - group.position.x, p.z - group.position.z) -
          group.rotation.y
        : Math.sin(s.time * 0.6 + i) * 0.25;
      rig.animate({
        time: s.time,
        phase: n.phase,
        seed: i + v.faction * 3,
        action: near
          ? "talk"
          : walking && moved > 0.001
            ? "walk"
            : i
              ? "work"
              : "idle",
        lookYaw: Math.atan2(Math.sin(look), Math.cos(look)),
        lookPitch: near
          ? Math.max(
              -0.25,
              Math.min(0.25, (group.position.y + 1.4 - p.y - 1.36) * 0.2),
            )
          : 0,
        greeting: near && s.time < n.greetUntil ? 1 : 0,
      });
      rig.detail(distance(p, group.position));
    }
    if (this.training && this.training.lastTime !== s.time) {
      const dt =
        this.training.lastTime === null
          ? 0
          : Math.min(0.1, Math.max(0, s.time - this.training.lastTime));
      this.training.lastTime = s.time;
      this.training.poseLabel = this.training.animate(
        s.time,
        dt,
        (x, z) => world.surface(x, z),
        distance(p, this.training.rig.root.position) < 2.5,
      );
    }
    const b = s.activeBoss;
    this.boss.visible = !b.defeated;
    this.boss.position.set(b.x, world.surface(b.x, b.z), b.z);
    this.boss.rotation.y = Math.atan2(p.x - b.x, p.z - b.z);
    this.bossLimbs.forEach((m, i) => {
      m.rotation.x = Math.sin(s.time * 3 + i) * 0.2;
      m.visible = b.hp / b.maxHP > (i === 0 ? 0.2 : 0.4);
    });
    this.warning.visible = false;
    this.warningGroup.visible = b.warning > 0;
    const key =
      b.warning > 0 ? `${b.phase}/${b.pattern}/${b.aimX}/${b.aimZ}` : null;
    if (key && key !== this.warningKey) {
      for (const m of this.warningGroup.children) {
        m.geometry.dispose();
        m.material.dispose();
      }
      this.warningGroup.clear();
      for (const zone of attackZones(b)) {
        const geometry =
          zone.type === "circle"
            ? new T.RingGeometry(Math.max(0.05, zone.inner), zone.outer, 32)
            : new T.PlaneGeometry(zone.width, zone.length);
        const mesh = new T.Mesh(
          geometry,
          new T.MeshBasicMaterial({
            color: 0xff634b,
            transparent: true,
            opacity: 0.55,
            side: T.DoubleSide,
            depthWrite: false,
          }),
        );
        mesh.rotation.x = -Math.PI / 2;
        if (zone.type === "line") mesh.rotation.z = zone.angle;
        mesh.position.set(zone.x, world.surface(zone.x, zone.z) + 0.06, zone.z);
        this.warningGroup.add(mesh);
      }
    }
    this.warningKey = key;
    this.warning.position.set(
      b.aimX,
      world.surface(b.aimX, b.aimZ) + 0.04,
      b.aimZ,
    );
    this.warning.material.opacity = 0.25 + Math.sin(s.time * 15) * 0.15 + 0.25;
    if (this.waypoint)
      this.beacon.position.set(
        this.waypoint.x,
        world.surface(this.waypoint.x, this.waypoint.z) + 4,
        this.waypoint.z,
      );
    this.cache.visible = !s.region.cacheClaimed;
    this.cache.rotation.y = s.time * 0.5;
    for (const { light, site } of this.relayMeshes)
      light.material.color.setHex(
        s.region.relays.includes(site.index) ? 0x7ae0ba : 0xe0a45c,
      );
    for (const { growth, site } of this.resourceMeshes) {
      const until = s.region.resources[site.id];
      growth.visible = until !== -1 && !(until > s.time);
    }
    this.support.visible =
      !!s.allies.length && !b.defeated && distance(p, b) < 26;
    this.support.position.set(
      b.x + 7,
      world.surface(b.x + 7, b.z + 4),
      b.z + 4,
    );
  }
  assemblyUse(intent, held, block, entityDistance) {
    return this.assembly.use(intent, held, block, entityDistance);
  }
  assemblyAim(held, block, entityDistance) {
    return this.assembly.aim(held, block, entityDistance);
  }
  beforeStep(input, dt) {
    return this.motion.beforeStep(input, dt);
  }
  afterStep(dt) {
    if (this.motion.afterStep(dt) === "respawn") {
      this.c.home();
      this.c.toast("쓰러졌습니다 · 야영지에서 다시 출발 · 경험 -15");
    }
  }
  registerTarget(root, data) {
    root.userData.interaction = data;
    this.targets.push(root);
  }
  objectTarget(max = 6.5) {
    this.updateTargets();
    const { view, world } = this.c,
      origin = view.camera.position,
      dir = new T.Vector3();
    view.camera.getWorldDirection(dir);
    const block = world.raycast(origin, dir, max);
    const ray = new T.Raycaster(
      origin,
      dir,
      0,
      Math.min(max, block?.distance ?? max),
    );
    this.group.updateMatrixWorld(true);
    let closest = null;
    for (const hit of ray.intersectObjects(this.targets, true)) {
      let root = hit.object,
        visible = true,
        data = null;
      while (root) {
        if (!root.visible) visible = false;
        if (!data && root.userData.interaction)
          data = root.userData.interaction;
        root = root.parent;
      }
      if (visible && data) {
        closest = {
          ...data,
          distance: hit.distance,
          point: hit.point,
          object: hit.object,
        };
        break;
      }
    }
    const bodyHit = this.training?.raycast(
      origin,
      dir,
      Math.min(max, block?.distance ?? max, closest?.distance ?? max),
    );
    return bodyHit
      ? { ...bodyHit, kind: "body", name: "구조 훈련체" }
      : closest;
  }
  objectAim(hit) {
    if (!hit) return false;
    const s = this.c.model;
    let detail = `${hit.distance.toFixed(1)} m`,
      hint = "사용 / R · 상호작용",
      value = 0,
      max = 0;
    if (hit.kind === "workyard") {
      detail = "가대교 · 광석 추 · 빈 상자 · 긴 원목";
      hint = "지지대 절단 → 잡고 끌기 → 옮겨 쌓기 · 집게는 가방에서 제작";
    } else if (hit.kind === "body" || hit.kind === "bodyStation") {
      const structure = this.training.body.status();
      detail = `${hit.layer === "structure" ? "내부 골격" : hit.kind === "body" ? "외피 복셀" : "재조립 받침"} · 골격 ${Math.round(structure.integrity * 100)}%`;
      hint = `${this.training.poseLabel || "정상 보행"} · 공격: 깎기 / 사용: 재조립`;
      value = structure.integrity;
      max = 1;
    } else if (hit.kind === "ruin") {
      detail = `중계기 ${s.region.relays.length}/3 해제`;
      hint =
        s.region.dungeon >= 3
          ? "사용 · 유적 핵과 보관소 물자 회수"
          : "주변의 주황색 중계기 세 개를 사용하세요";
      value = s.region.dungeon;
      max = 3;
    } else if (hit.kind === "relay") {
      detail = s.region.relays.includes(hit.index)
        ? "해제 완료"
        : "방어장 연결 중";
      hint = "사용 · 중계기 해제 · 진행 보존";
    } else if (hit.kind === "resource") {
      const def = GATHERABLES[hit.site.kind],
        until = s.region.resources[hit.site.id];
      detail =
        until === -1
          ? "회수 완료"
          : until > s.time
            ? `재성장 ${Math.ceil(until - s.time)}초`
            : Object.entries(def.reward)
                .map(([id, n]) => `${ITEMS[id].name} ${n}`)
                .join(" · ");
      hint = "사용 · 채집";
    } else if (hit.kind === "npc") {
      detail = `${FACTIONS[hit.village.faction]} · 평판 ${s.reputation[hit.village.faction]}`;
      hint = "사용 · 대화 / 교역 / 주민 의뢰";
    } else if (hit.kind === "outpost") {
      detail = "시설 건설 · 작물 재배 · 신호 복원 · 원정";
      hint = "사용 · 여정 열기";
    } else if (hit.kind === "crop") {
      const plot = s.region.outpost.plots[hit.index];
      detail = plot
        ? `${CROPS[plot.crop].name} · ${plot.ready > s.time ? Math.ceil(plot.ready - s.time) + "초 후 수확" : "수확 가능"}`
        : "빈 밭";
      hint = "사용 · 수확 또는 파종 준비";
    } else if (hit.kind === "survey") {
      detail = s.region.outpost.sortie?.visited.includes(hit.index)
        ? "측량 완료"
        : "측량 표석";
      hint = "사용 · 측량 원정 기록";
    } else if (hit.kind === "boss") {
      detail = `HP ${Math.ceil(s.activeBoss.hp)} / ${s.activeBoss.maxHP}`;
      hint = "공격 · 장착 무기로 타격";
      value = s.activeBoss.hp;
      max = s.activeBoss.maxHP;
    }
    this.c.view.worldUI.set("focus", {
      title: hit.name,
      detail,
      hint,
      value,
      max,
      color: "#addbd1",
      maxDistance: 30,
      position: { x: hit.point.x, y: hit.point.y + 0.15, z: hit.point.z },
    });
    this.c.view.highlight.visible = false;
    return true;
  }
  weaponRange() {
    const { model: s, inventory: inv } = this.c;
    return s.riding && s.machine && evaluate(s.machine).weapons > 0
      ? 22
      : activeGear(inv, "weapon").range;
  }
  bossTarget() {
    return this.objectTarget(this.weaponRange())?.kind === "boss";
  }
  use(selected) {
    if (selected !== 1 || !this.bossTarget()) return false;
    if (this.c.model.attack(this.c.inventory)) {
      this.c.view.toolKick = 1;
      this.hud();
    } else if (this.c.model.riding && !this.c.inventory.count("stone"))
      this.c.toast("포탑 탄약은 돌 조각입니다.");
    else if (
      activeGear(this.c.inventory, "weapon").ammo &&
      !this.c.inventory.count("arrow")
    )
      this.c.toast("화살이 필요합니다. 가방에서 제작하세요.");
    return true;
  }
  key(code) {
    if (code === "KeyJ") {
      this.open("map");
      return true;
    }
    if (code === "KeyR") {
      this.c.interact();
      return true;
    }
    if (code === "KeyH") {
      this.c.toast(this.c.model.consume("medicine", this.c.inventory));
      return true;
    }
    return false;
  }
  toggleFlight() {
    const { model: s, inventory: inv, player } = this.c;
    if (
      !s.riding ||
      !inv.unlocks.has("aviation") ||
      (evaluate(s.machine).lift < 1.5 &&
        !(evaluate(s.machine).wings > 0 && evaluate(s.machine).propellers > 0))
    ) {
      this.c.toast(
        "항공 연구와 탑승, 회전익 2개 또는 주날개·프로펠러가 필요합니다.",
      );
      return;
    }
    s.airborne = !s.airborne;
    player.flying = s.airborne;
    this.c.toast(
      s.airborne
        ? evaluate(s.machine).propellers > 0
          ? "고정익 조종 · 출력은 이동 스틱으로 조절"
          : "회전익 작동 · ↑ 상승 / ↓ 하강 · 이동으로 추진·조향"
        : "비행 해제 · 착륙",
    );
  }
  interact(hit = this.objectTarget()) {
    const { model: s, player: p, inventory: inv } = this.c;
    if (hit) {
      if (hit.distance > (hit.kind === "npc" ? 6 : 4)) {
        this.c.toast("가까이 다가가 사용하세요.");
        return;
      }
      if (hit.kind === "workyard") {
        this.c.toast(
          "지지대를 자르면 덩어리가 분리됩니다 · 사용: 잡고 끌기 · 빈 손 공격: 밀기 · 운반 집게: 힘 보조 · 렌치: 고정 · 재료: 붙이기",
        );
        return;
      }
      if (hit.kind === "body" || hit.kind === "bodyStation") {
        delete s.region.trainingBody;
        this.createTrainingBody();
        this.c.toast("구조 훈련체 재조립 · 외피와 골격 복원");
        return;
      }
      if (hit.kind === "npc") {
        this.conversation = {
          villageId: hit.village.id,
          role: hit.role,
          name: hit.name,
        };
        this.open("society");
        return;
      }
      if (hit.kind === "camp" || hit.kind === "outpost") {
        this.campaignUI.page = hit.kind === "camp" ? "camp" : "network";
        this.open("journey");
        return;
      }
      if (hit.kind === "crop") {
        if (s.region.outpost.plots[hit.index])
          this.campaignUI.action("harvest", hit.index);
        else {
          this.campaignUI.page = "camp";
          this.open("journey");
        }
        return;
      }
      if (hit.kind === "survey") {
        this.campaignUI.action("survey", hit.index);
        return;
      }
      const message =
        hit.kind === "relay"
          ? s.activateRelay(hit.index, p)
          : hit.kind === "ruin"
            ? s.claimRuin(p, inv)
            : hit.kind === "resource"
              ? s.gather(hit.site.id, p, inv)
              : "수호자는 무기를 들고 공격하세요.";
      this.c.toast(message);
      this.draw();
      return;
    }
    if (this.assembly.ride()) return;
    const village = s.region.villages.find((v) => distance(p, v) < 12);
    if (village) {
      this.open("society");
      return;
    }
    if (distance(p, s.info.dungeon) < 6) {
      this.c.toast(s.claimRuin(p, this.c.inventory));
      return;
    }
    if (distance(p, { x: 77.5, z: 84.5 }) < 12) {
      this.open("journal");
      return;
    }
    if (s.riding) {
      this.c.toast(s.toggleRide(this.c.inventory));
      return;
    }
    this.c.toast("사용할 대상을 조준하세요. 지도는 지도 버튼으로 엽니다.");
  }
  hud() {
    const { model: s, player: p } = this.c;
    this.campaignUI.hud();
    setVitals({
      hp: s.hp,
      maxHp: s.maxHP,
      food: s.hunger,
      level: s.level,
      xp: s.xp % 80,
      healthText: `체력 ${Math.ceil(s.hp)} / ${s.maxHP} · Lv.${s.level}`,
      foodText: `포만 ${Math.ceil(s.hunger)} · ${s.riding ? (s.airborne ? "비행 중" : "탑승 중") : "도보"}`,
      hurt: s.hurtClock > 0,
    });
    const b = s.activeBoss,
      near = !b.defeated && distance(p, b) < 28;
    const bossName = `${BIOMES[s.info.biome].boss}${s.region.outpost.sortie?.kind === "hunt" ? " 잔향" : ""} · 위험 ${s.info.tier}`;
    const bossWarning =
      b.warning > 0
        ? `${PATTERNS[b.pattern]?.name || "내려찍기"} · ${PATTERNS[b.pattern]?.hint || "붉은 원 밖으로 이동"}`
        : this.bossTarget()
          ? "장착 무기로 공격"
          : "수호자를 조준하세요";
    this.c.view.worldUI.set(
      "context",
      near
        ? {
            title: bossName,
            detail: `HP ${Math.ceil(b.hp)} / ${b.maxHP}`,
            value: Math.ceil(b.hp),
            max: b.maxHP,
            hint: bossWarning,
            color: "#f1b08f",
            maxDistance: 28,
            follow: () =>
              b.defeated
                ? null
                : { x: b.x, y: this.c.world.surface(b.x, b.z) + 2.8, z: b.z },
          }
        : null,
    );
    if (this.waypoint) $("waypoint").textContent = waypointText(p, this.waypoint);
    const village = s.region.villages.find((v) => distance(p, v) < 12);
    if (village && !near)
      this.c.view.worldUI.set("context", {
        title: village.name,
        detail: `${FACTIONS[village.faction]} · 평판 ${s.reputation[village.faction]}`,
        hint: "사용 / R · 교역과 대화",
        color: "#c9db9f",
        maxDistance: 14,
        side: -1,
        position: {
          x: village.x,
          y: this.c.world.surface(village.x, village.z) + 2.4,
          z: village.z,
        },
      });
    $("interactBtn").firstChild.textContent = s.riding
      ? "하차 "
      : this.assembly.near()
        ? "탑승 "
        : village
          ? "교역·대화 "
          : distance(p, s.info.dungeon) < 6
            ? "유적 회수 "
            : s.riding
              ? "하차 "
              : "상호작용 ";
    $("interactBtn").hidden =
      !village &&
      distance(p, s.info.dungeon) >= 6 &&
      distance(p, { x: 77.5, z: 84.5 }) >= 12 &&
      !s.riding &&
      !this.assembly.near();
    $("flightReadout").hidden = !s.riding || !s.airborne;
    if (s.riding && s.airborne) {
      const physics = this.motion.physics,
        f = evaluate(s.machine);
      $("flightReadout").textContent =
        `대기 속도 ${(physics.speed || 0).toFixed(1)} m/s · 출력 ${Math.round(physics.throttle * 100)}%\n${f.wings > 0 ? `양력 ${Math.round(physics.aero?.lift || 0)} N · 중량 ${Math.round(f.mass * 9.81)} N` : "회전익 · ↑ 상승 / ↓ 하강"}\n${physics.aero?.stalled ? "실속 · 기수를 낮추고 속도를 확보하세요" : f.wings > 0 ? "앞/뒤 출력 · 좌우 선회 · ↑/↓ 기수" : "이동 스틱으로 추진·선회"}`;
      $("flightReadout").classList.toggle("stalled", !!physics.aero?.stalled);
    }
    $("biome").textContent = s.info.name;
    $("flyBtn").classList.toggle("enabled", s.airborne);
    $("flyBtn").classList.toggle(
      "hidden",
      !s.riding || !this.c.inventory.unlocks.has("aviation"),
    );
  }
  get tab() {
    return this.window.tab;
  }
  feedback(message) {
    this.window.feedback(message);
  }
  close() {
    this.window.close();
  }
  open(tab) {
    this.window.open(tab);
  }
  button(label, fn, id) {
    return this.window.button(label, fn, id);
  }
  render() {
    const { model: s, inventory: inv, player: p } = this.c,
      root = $("frontierContent");
    root.replaceChildren();
    root.classList.toggle("journeyContent", this.tab === "journey");
    if (this.tab === "journey") this.campaignUI.render(root);
    if (this.tab === "map") {
      root.innerHTML = `<div class="mapLayout"><div class="regionMap"><h3>${escape(s.info.name)}</h3><small>위험 ${s.info.tier} · ${Object.keys(s.regions).length}개 지역 발견</small>
      <div class="routeGrid"><button data-route="0,-1">↑<small>북쪽 지역</small></button><button data-route="-1,0">←<small>서쪽</small></button><span><b>⌂</b><small>${s.x}, ${s.z}</small></span><button data-route="1,0">→<small>동쪽</small></button><button data-route="0,1">↓<small>남쪽 지역</small></button></div>
      <p>야영지·지역 경계에서 이동<br>식량 1개 필요 · 보유 ${inv.count("food")}</p></div><div class="destinationList"><h3>목적지 표시</h3><div id="destinations"></div><p>목적지를 선택하면 탐험 화면에 방향과 거리를 표시합니다.</p></div></div>`;
      root
        .querySelectorAll("[data-route]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              this.c.travel(...b.dataset.route.split(",").map(Number))),
        );
      for (const b of root.querySelectorAll("[data-route]")) {
        const [dx, dz] = b.dataset.route.split(",").map(Number),
          bio = BIOMES[biomeIndex(s.x + dx, s.z + dz)];
        b.querySelector("small").textContent = bio.name + " · " + bio.signal;
      }
      const destinations = [
        { name: "원정 야영지", x: 77.5, z: 84.5 },
        ...s.region.villages,
        {
          name: `${ruinDefinition(s.info).name} · 중계기 ${s.region.relays.length}/3`,
          ...s.info.dungeon,
        },
        ...resourceSites(s.info)
          .filter((site) => site.id.endsWith(":0"))
          .map((site) => ({ ...site, name: GATHERABLES[site.kind].name })),
        {
          name: s.activeBoss.defeated ? "수호자 둥지 · 격파" : "수호자 둥지",
          ...s.info.boss,
        },
      ];
      for (const d of destinations)
        $("destinations").append(
          this.button(
            `${d.name} · ${Math.round(distance(p, d))} m`,
            () => {
              this.campaignUI.track = false;
              this.waypoint = d;
              this.c.pause(false);
              this.hud();
            },
            d.name === "원정 야영지" ? "campWaypoint" : undefined,
          ),
        );
    }
    if (this.tab === "society") {
      root.innerHTML = `<h3>공동체와 관계</h3><p>마을 12m 안에서 교역·지원·외교가 가능합니다. 원정 중 다른 지역 마을도 30초마다 생산·소비합니다.</p><div id="villageList"></div><h3>집단 간 관계</h3><p>${s.diplomacy.map((v, i) => `${FACTIONS[i]} ↔ ${FACTIONS[(i + 1) % 3]}: ${v} (${v <= -20 ? "분쟁" : v >= 20 ? "협력" : "중립"})`).join("<br>")}</p>`;
      const conversation = this.conversation;
      if (conversation) {
        const greeting = document.createElement("p");
        greeting.className = "npcSpeech";
        greeting.textContent =
          conversation.name +
          " — " +
          [
            "새 탐험가군요. 주변의 열매와 나무를 모아 오세요. 물자와 교환하거나 식탁 의뢰를 도와주세요.",
            "다친 동물에게도 회복약을 쓸 수 있어요. 은잎 약초는 수확한 뒤 다시 자랍니다.",
            "옛 잔해는 합금으로 재련할 수 있죠. 유적의 세 중계기를 해제하면 공명 도구를 만들 핵도 얻을 수 있어요.",
          ][conversation.role || 0];
        root.prepend(greeting);
      }
      const villages = [...s.region.villages].sort(
        (a, b) =>
          Number(b.id === conversation?.villageId) -
          Number(a.id === conversation?.villageId),
      );
      for (const v of villages) {
        const row = document.createElement("section");
        row.className = "villageRow";
        row.innerHTML = `<h3>${escape(v.name)} <small>${FACTIONS[v.faction]} · ${Math.round(distance(p, v))} m</small></h3><p>주민 ${v.population} · 기술 ${v.tech} · 평판 ${s.reputation[v.faction]} ${s.allies.includes(v.faction) ? "· 동맹" : ""}<br>재고: 식량 ${v.food} / 원목 ${v.wood} / 돌 ${v.stone} / 결정 ${v.crystal}</p><div class="frontierButtons"></div>`;
        for (const [action, label] of [
          ["trade", "교역 · 원목 4 → 결정 2·식량 2"],
          ["quarry", "채석 교역 · 식량 2 → 돌 8·모래 4"],
          ["aid", "지원 · 식량 3·목재 4"],
          ["ally", "동맹 요청 · 평판 24"],
          ["mediate", "집단 중재 · 연구 2"],
          ["peace", "화해 · 식량 6·합금 2"],
          ["raid", "약탈 · 적대 전환"],
        ]) {
          const b = this.button(label, () => {
            if (action === "raid") {
              this.confirmRaid(v);
              return;
            }
            const result = s.actVillage(v.id, action, inv, p);
            this.render();
            return result;
          });
          b.dataset.action = action;
          if (distance(p, v) > 12) b.disabled = true;
          row.querySelector("div").append(b);
        }
        if (
          v.id === s.region.villages[0].id &&
          s.region.outpost.sortie?.kind === "supply"
        ) {
          const delivery = this.button(
            "원정 보급 전달 · 식량 6·회복약 2·목재 8",
            () => {
              const result = this.campaignUI.action("deliverSortie");
              this.render();
              return result;
            },
          );
          delivery.dataset.campaign = "deliverSortie";
          delivery.disabled =
            distance(p, v) > 12 || s.region.outpost.sortie.done;
          row.append(delivery);
        }
        const quests = document.createElement("div");
        quests.className = "villageContracts";
        quests.innerHTML = "<h4>주민 의뢰 · 재료를 모아 전달</h4>";
        for (const quest of CONTRACTS) {
          const done = s.region.contracts.includes(`${v.id}/${quest.id}`),
            entry = document.createElement("section");
          entry.className = "contractEntry";
          entry.innerHTML = `<strong>${quest.name}${done ? " · 완료" : ""}</strong><p>${quest.text}<br>${Object.entries(
            quest.cost,
          )
            .map(([id, n]) => `${ITEMS[id].name} ${inv.count(id)}/${n}`)
            .join(" · ")}<br>보상: ${Object.entries(quest.reward)
            .map(([id, n]) => `${ITEMS[id].name} ${n}`)
            .join(" · ")} · 평판 8</p>`;
          const button = this.button(done ? "전달 완료" : "의뢰 전달", () => {
            const scroll = root.scrollTop,
              result = s.deliver(v.id, quest.id, p, inv);
            this.render();
            root.scrollTop = scroll;
            return result;
          });
          button.dataset.contract = quest.id;
          button.disabled =
            done || distance(p, v) > 12 || s.reputation[v.faction] <= -20;
          entry.append(button);
          quests.append(entry);
        }
        row.append(quests);
        $("villageList").append(row);
      }
    }
    if (this.tab === "machine") this.machinePanel(root);
    if (this.tab === "journal") {
      const wins = Object.values(s.regions).filter(
        (r) => r.boss.defeated,
      ).length;
      const weapon = activeGear(inv, "weapon"),
        tool = activeGear(inv, "tool");
      const armor = inv.unlocks.has("armor");
      root.innerHTML = `<div class="characterSheet"><div class="characterFigure"><div class="characterStage ${armor ? "armored" : ""}"><span>개척자 · 끌어 회전</span></div><div class="equippedSlots"><div title="${escape(weapon.name)}">${itemArt(gearId(inv, "weapon"))}<small>무기</small></div><div title="${escape(tool.name)}">${itemArt(gearId(inv, "tool"))}<small>도구</small></div><div class="armorSlot ${armor ? "equipped" : ""}" title="${armor ? "개척 갑옷 · 피해 35% 감소" : "갑옷 미착용"}"><b>⛨</b><small>${armor ? "갑옷" : "없음"}</small></div></div></div>
      <div class="characterStats"><div class="characterName"><h3>개척자 <small>LV.</small> ${s.level}</h3><span>${s.riding ? (s.airborne ? "비행 중" : "탑승 중") : "탐험 중"}</span></div>
      <div class="statMeter hp"><label>체력 <b>${Math.ceil(s.hp)} / ${s.maxHP}</b></label><progress max="${s.maxHP}" value="${s.hp}"></progress></div>
      <div class="statMeter food"><label>포만 <b>${Math.ceil(s.hunger)} / 100</b></label><progress max="100" value="${s.hunger}"></progress></div>
      <div class="statMeter xp"><label>경험 <b>${s.xp % 80} / 80</b></label><progress max="80" value="${s.xp % 80}"></progress></div>
      <dl class="combatStats"><div><dt>${escape(weapon.name)}</dt><dd>공격 ${weapon.damage + (weapon.name === "기본 펄스" && inv.unlocks.has("blade") ? 12 : 0)}</dd></div><div><dt>${armor ? "개척 갑옷" : "기본 의복"}</dt><dd>피해 감소 ${armor ? "35" : "0"}%</dd></div></dl>
      <p class="activeEffects">${[s.journey.fedUntil > s.time ? `든든함 ${Math.ceil(s.journey.fedUntil - s.time)}초 · 피해 10% 감소` : "", s.journey.tonicUntil > s.time ? `강장 ${Math.ceil(s.journey.tonicUntil - s.time)}초 · 체력 0.8/초` : ""].filter(Boolean).join("<br>") || "음식·강장제의 효과가 여기에 표시됩니다."}</p>
      <div id="supplies" class="supplySlots"></div></div></div>
      <div class="milestoneStrip"><span>⚑ <b>${s.allies.length}</b> 동맹</span><span>◆ <b>${wins}</b> 수호자</span><span>▧ <b>${inv.count("knowledge")}</b> 연구</span><span>◈ <b>${inv.count("relic")}</b> 유적 핵</span></div>
      <details class="expeditionLog"><summary>원정 기록 <span>${s.log.length}</span></summary><ol>${s.log.map((t) => `<li>${escape(t)}</li>`).join("") || "<li>첫 원정을 시작했습니다.</li>"}</ol></details>`;
      mountCharacterPortrait(root.querySelector(".characterStage"), {
        armored: armor,
        held: inv.slots[inv.selectedSlot]?.id,
        stance: p.stance,
      });
      for (const [label, fn, id] of [
        ["식량 먹기", () => s.consume("food", inv), "eatFood"],
        ["회복약 사용 · H", () => s.consume("medicine", inv), "useMedicine"],
        ["야채 스튜 먹기", () => s.consume("stew", inv), "eatStew"],
        ["약초 강장제 사용", () => s.consume("tonic", inv), "useTonic"],
        ["야영지 휴식", () => s.camp(p, inv), "campRest"],
        [
          "가방 · 제작과 연구",
          () => {
            this.close();
            this.c.openBag();
          },
          "frontierBag",
        ],
        [
          "원정 저장",
          () =>
            this.c.save()
              ? "원정을 저장했습니다."
              : "저장 실패 · 공간을 확인하세요.",
          "frontierSave",
        ],
      ]) {
        const button = this.button(
          label,
          () => {
            const result = fn();
            if (!$("frontierPanel").hidden) this.render();
            return result;
          },
          id,
        );
        button.setAttribute("aria-label", label);
        const item = {
          eatFood: "food",
          useMedicine: "medicine",
          eatStew: "stew",
          useTonic: "tonic",
        }[id];
        button.innerHTML = item
          ? `${itemArt(item)}<b class="supplyCount">${inv.count(item)}</b><small>${item === "food" || item === "stew" ? "먹기" : "사용"}</small>`
          : `<b aria-hidden="true">${uiIcon(id === "campRest" ? "village" : id === "frontierBag" ? "bag" : "journey")}</b><small>${id === "campRest" ? "휴식" : id === "frontierBag" ? "가방" : "저장"}</small>`;
        if (item) button.disabled = inv.count(item) === 0;
        $("supplies").append(button);
      }
    }
  }
  confirmRaid(v) {
    const root = $("frontierContent"),
      dialog = document.createElement("div");
    dialog.className = "raidConfirm";
    dialog.innerHTML = `<p>${escape(v.name)}을 약탈하면 평판이 35 떨어지고 동맹·교역이 끊깁니다. 진행할까요?</p>`;
    dialog.append(
      this.button("약탈 실행", () => {
        const r = this.c.model.actVillage(
          v.id,
          "raid",
          this.c.inventory,
          this.c.player,
        );
        this.render();
        return r;
      }),
      this.button("취소", () => dialog.remove()),
    );
    root.prepend(dialog);
    dialog.querySelector("button").focus();
  }
  machinePanel(root) {
    const { model: s } = this.c,
      f = s.machine && evaluate(s.machine);
    root.innerHTML = `<h3>월드에서 조립</h3><p>가방에서 차체·바퀴·모터를 제작해 하단 아이템 칸에 놓으세요. 차체를 바닥에 놓고, 부품을 들고 면을 조준해 사용하면 붙습니다.</p><p>렌치: 공격으로 회수, 사용으로 고정/해제<br>합금: 손상된 부품을 조준하고 사용해 수리<br>가까이에서 R / 상호작용으로 탑승·하차<br>이동으로 추진·조향, 점프로 제동. 비행 중에는 ↑/Space로 상승·기수 올리기, ↓/Q로 하강·기수 내리기. 고정익은 스틱 앞/뒤로 출력을 조절하고, 손을 놓으면 출력을 유지합니다. 좌우는 주날개와 방향타로 선회합니다.</p><p>항공 연구 후 주날개를 좌우로 넓게, 수평·수직 꼬리날개를 뒤로, 프로펠러를 앞에 붙이세요. 처음 놓은 차체의 앞은 북쪽(-Z)입니다. 날개가 적거나 너무 무거우면 뜨지 않습니다. 받음각이 너무 크면 실속하고, 한쪽 날개를 잃으면 기체가 기웁니다.</p><details><summary>경량 비행기 조립 예 · 40개 부품</summary><p>항공 부품 묶음을 제작한 뒤 바닥에서 높여 차체를 고정하세요. 최초 차체가 중심(0,0,0), 한 칸은 0.5m입니다. 앞은 -Z, 위는 +Y입니다.</p><p>차체: X=0, Y=0, Z=-2부터 3까지 6개<br>모터: (0,1,0), 프로펠러: (0,0,-3)<br>주날개: 좌우 X=1~4와 -1~-4, Y=0, Z=-1·0·1에 24개<br>수평 꼬리: X=±1·±2, Y=0, Z=3에 4개<br>수직 꼬리: (0,1,3)<br>바퀴: (-4,-1,0), (4,-1,0), (0,-1,-2)</p><p>평평한 활주로를 확보하고 렌치로 고정을 해제한 뒤 탑승합니다. 비행을 켜고 스틱을 앞으로 밀어 출력을 올리세요. 대기 속도 20m/s 부근부터 ↑를 짧게 눌러 기수를 올립니다. 날개 배치와 무게중심에 따라 조종 느낌이 달라집니다.</p></details>${f ? `<p>질량 ${Math.round(f.mass)} kg · 동력 ${Math.round(f.power)} · 바퀴 접지 능력 ${Math.round(f.grip * 100)}%<br>조립체 위치: ${s.machine.pose?.region || s.key} 지역 · 분리된 조각 ${s.machine.fragments?.length || 0}개</p>` : ""}`;
    root.append(
      this.button("월드로 돌아가기", () => this.c.pause(false)),
      this.button("가방 · 부품 제작", () => {
        this.close();
        this.c.openBag();
      }),
    );
  }
}
