import { activeGear, gearId } from "../equipment.js";
import { itemArt } from "../item-art.js";
import { T } from "../render.js";
import { FACTIONS } from "./model.js";
import { FrontierMotion } from "./motion.js";
import { evaluate, TYPES } from "../machine/model.js";
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
const avatar = `<div class="voxelAvatar" aria-hidden="true"><i class="head"></i><i class="body"></i><i class="arm a"></i><i class="arm b"></i><i class="leg a"></i><i class="leg b"></i></div>`;
const pips = (kind) => `<div class="pipTrack ${kind}" aria-hidden="true">${"<i><b></b></i>".repeat(10)}</div>`;
function fillPips(track, value) {
  const amount = Math.ceil(Math.max(0, Math.min(100, value)) / 5);
  if (track.dataset.amount === String(amount)) return;
  track.dataset.amount = amount;
  [...track.children].forEach((pip, i) => {
    pip.firstChild.style.width = `${Math.min(2, Math.max(0, amount - i * 2)) * 50}%`;
  });
}
export class FrontierView {
  constructor(ctx) {
    this.c = ctx;
    this.motion = new FrontierMotion(ctx);
    this.tab = "map";
    this.waypoint = null;
    this.revision = -1;
    this.oldPosition = null;
    this.group = new T.Group();
    ctx.view.scene.add(this.group);
    this.cube = new T.BoxGeometry(1, 1, 1);
    this.materials = new Map();
    this.npcs = [];
    const hud = document.createElement("div");
    hud.id = "frontierHUD";
    hud.innerHTML = `<div id="vitals"><span id="healthText" class="srOnly"></span><meter id="health" class="srOnly" min="0" max="100" value="100" aria-label="체력"></meter>${pips("hearts")}<b id="levelHUD"></b>${pips("hunger")}<small id="hungerText" class="srOnly"></small><progress id="experienceHUD" max="80" value="0" aria-label="다음 레벨 경험치"></progress></div>
      <div id="waypoint"></div><div id="frontierActions"><button id="journalBtn" aria-label="원정 지도"><span aria-hidden="true">▧</span><small>지도</small></button><button id="statusBtn" aria-label="캐릭터 상태"><span aria-hidden="true">♟</span><small>상태</small></button><button id="interactBtn">상호작용 <small>R</small></button></div>`;
    $("hud").append(hud);
    const panel = document.createElement("section");
    panel.id = "frontierPanel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "frontierTitle");
    panel.innerHTML = `<div class="gameWindow"><header><h2 id="frontierTitle">원정 지도</h2><button id="frontierClose" aria-label="원정 장부 닫기">×</button></header>
      <nav aria-label="원정 장부 메뉴"><button data-frontier-tab="journal" aria-label="캐릭터 상태"><b aria-hidden="true">♟</b><span>상태</span></button><button data-frontier-tab="map" aria-label="원정 지도"><b aria-hidden="true">▧</b><span>지도</span></button><button data-frontier-tab="society" aria-label="공동체"><b aria-hidden="true">⚑</b><span>마을</span></button><button data-frontier-tab="machine" aria-label="기계 조립"><b aria-hidden="true">⚒</b><span>기계</span></button></nav>
      <div id="frontierContent"></div><p id="frontierFeedback" role="status" aria-live="polite"></p></div>`;
    document.body.append(panel);
    $("journalBtn").onclick = () => this.open("map");
    $("statusBtn").onclick = () => this.open("journal");
    $("interactBtn").onclick = () => this.interact();
    $("frontierClose").onclick = () => ctx.pause(false);
    panel
      .querySelectorAll("[data-frontier-tab]")
      .forEach((b) => (b.onclick = () => this.open(b.dataset.frontierTab)));
    panel.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const buttons = [...panel.querySelectorAll("button, select, summary")].filter(
        (e) => !e.disabled && e.offsetParent,
      );
      const first = buttons[0],
        last = buttons.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
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
    this.waypoint = ctx.model.region.villages[0];
  }
  box(parent, x, y, z, sx, sy, sz, color) {
    let mat = this.materials.get(color);
    if (!mat) {
      mat = new T.MeshLambertMaterial({ color });
      this.materials.set(color, mat);
    }
    const mesh = new T.Mesh(this.cube, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    parent.add(mesh);
    return mesh;
  }
  resetScene() {
    this.c.view.worldUI.clear();
    this.group.clear();
    this.npcs = [];
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
        const group = new T.Group();
        this.group.add(group);
        this.box(
          group,
          0,
          0.65,
          0,
          0.45,
          0.75,
          0.3,
          [0x89a76b, 0xad8059, 0x798a9f][v.faction],
        );
        this.box(group, 0, 1.2, 0, 0.3, 0.3, 0.3, 0xdac4a0);
        this.box(group, -0.13, 0.2, 0, 0.16, 0.4, 0.2, 0x3e4b41);
        this.box(group, 0.13, 0.2, 0, 0.16, 0.4, 0.2, 0x3e4b41);
        this.npcs.push({ group, v, i });
      }
    }
    const cy = world.surface(77, 84);
    this.box(this.group, 77, cy + 0.25, 84, 1.1, 0.5, 1.1, 0xd69d55);
    this.boss = new T.Group();
    this.group.add(this.boss);
    this.bossCore = this.box(this.boss, 0, 1.8, 0, 1.7, 2, 1.2, 0x607b77);
    this.box(this.boss, 0, 3.2, 0, 1.1, 0.8, 0.9, 0xd4b968);
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
    this.vehicle = new T.Group();
    this.group.add(this.vehicle);
    this.support = new T.Group();
    this.group.add(this.support);
    this.box(this.support, 0, 0.8, 0, 0.5, 1, 0.4, 0xaacb85);
    this.box(this.support, 0, 1.5, 0, 0.3, 0.35, 0.3, 0xe4cfa6);
    this.draw();
  }
  draw() {
    const { model: s, world, player: p } = this.c;
    if (!this.boss) return;
    for (const { group, v, i } of this.npcs) {
      const t = s.time * 0.18 + i * 2;
      group.position.set(
        v.x + Math.cos(t) * 3,
        world.surface(v.x, v.z),
        v.z + 1 + Math.sin(t) * 2,
      );
      group.rotation.y = -t;
    }
    const b = s.region.boss;
    this.boss.visible = !b.defeated;
    this.boss.position.set(b.x, world.surface(b.x, b.z), b.z);
    this.boss.rotation.y = Math.atan2(p.x - b.x, p.z - b.z);
    this.bossLimbs.forEach((m, i) => {
      m.rotation.x = Math.sin(s.time * 3 + i) * 0.2;
      m.visible = b.hp / b.maxHP > (i === 0 ? 0.2 : 0.4);
    });
    this.warning.visible = b.warning > 0;
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
    this.support.visible =
      !!s.allies.length && !b.defeated && distance(p, b) < 26;
    this.support.position.set(
      b.x + 7,
      world.surface(b.x + 7, b.z + 4),
      b.z + 4,
    );
    if (s.machine && this.revision !== s.machine.revision) {
      this.vehicle.clear();
      for (const part of s.machine.blueprint) {
        const hp = s.machine.hp[part.id] / TYPES[part.type].hp;
        if (hp <= 0) continue;
        const color = new T.Color(TYPES[part.type].color)
          .multiplyScalar(0.4 + hp * 0.6)
          .getHex();
        this.box(
          this.vehicle,
          part.x * 0.5,
          part.y * 0.5 + 0.25,
          part.z * 0.5,
          part.type === "rotor" ? 1.2 : 0.47,
          part.type === "rotor" ? 0.12 : 0.47,
          0.47,
          color,
        );
        if (part.type === "cannon")
          this.box(
            this.vehicle,
            part.x * 0.5,
            part.y * 0.5 + 0.3,
            part.z * 0.5 - 0.55,
            0.18,
            0.18,
            0.9,
            0x625d4d,
          );
      }
      this.revision = s.machine.revision;
    }
    this.vehicle.visible = !!s.machine;
    this.vehicle.position.set(
      s.riding ? p.x : 77.5,
      s.riding ? p.y : world.surface(77.5, 87.5),
      s.riding ? p.z : 87.5,
    );
    this.vehicle.rotation.y = s.riding ? p.yaw : 0;
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
  bossTarget() {
    const { model: s, view, world, inventory: inv } = this.c;
    if (s.region.boss.defeated) return false;
    const b = s.region.boss,
      origin = view.camera.position,
      dir = new T.Vector3();
    view.camera.getWorldDirection(dir);
    const center = new T.Vector3(b.x, world.surface(b.x, b.z) + 1.8, b.z),
      delta = center.sub(origin),
      along = delta.dot(dir);
    const range =
      s.riding && s.machine && evaluate(s.machine).weapons > 0
        ? 22
        : activeGear(inv, "weapon").range;
    if (
      along < 0 ||
      along > range ||
      delta.lengthSq() - along * along > 2.4 * 2.4
    )
      return false;
    const hit = world.raycast(origin, dir, along);
    return !hit || hit.distance > along - 1.4;
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
      this.interact();
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
      evaluate(s.machine).lift < 1.5
    ) {
      this.c.toast("회전익 연구 · 연결된 회전익 2개 · 탑승이 필요합니다.");
      return;
    }
    s.airborne = !s.airborne;
    player.flying = s.airborne;
    this.c.toast(
      s.airborne
        ? "간이 비행 · 점프로 상승 / Q로 하강 / 시선 방향으로 이동"
        : "비행 해제 · 착륙",
    );
  }
  interact() {
    const { model: s, player: p } = this.c;
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
    this.open("map");
  }
  hud() {
    const { model: s, player: p } = this.c;
    $("healthText").textContent =
      `체력 ${Math.ceil(s.hp)} / ${s.maxHP} · Lv.${s.level}`;
    $("health").max = s.maxHP;
    $("health").value = s.hp;
    fillPips($("vitals").querySelector(".hearts"), s.hp / s.maxHP * 100);
    fillPips($("vitals").querySelector(".hunger"), s.hunger);
    $("levelHUD").textContent = s.level;
    $("experienceHUD").value = s.xp % 80;
    $("hungerText").textContent =
      `포만 ${Math.ceil(s.hunger)} · ${s.riding ? (s.airborne ? "비행 중" : "탑승 중") : "도보"}`;
    const b = s.region.boss,
      near = !b.defeated && distance(p, b) < 28;
    const bossName =
      `${["", "이끼 수호자", "구리 거신", "심연 파수꾼"][s.info.tier]} · 위험 ${s.info.tier}`;
    const bossWarning =
      b.warning > 0
        ? "충격파! 붉은 원 밖으로 피하세요"
        : this.bossTarget()
          ? "장착 무기로 공격"
          : "수호자를 조준하세요";
    if (this.bossTarget()) {
      this.c.view.highlight.visible = false;
      this.c.view.worldUI.set("focus", null);
    }
    this.c.view.worldUI.set("context", near ? {
      title: bossName,
      detail: `HP ${Math.ceil(b.hp)} / ${b.maxHP}`, value: Math.ceil(b.hp), max: b.maxHP,
      hint: bossWarning, color: "#f1b08f", maxDistance: 28,
      follow: () => b.defeated ? null : { x: b.x, y: this.c.world.surface(b.x, b.z) + 2.8, z: b.z },
    } : null);
    $("vitals").classList.toggle("hurt", s.hurtClock > 0);
    if (this.waypoint) {
      const dx = this.waypoint.x - p.x,
        dz = this.waypoint.z - p.z;
      const angle = Math.atan2(
        Math.cos(p.yaw) * dx - Math.sin(p.yaw) * dz,
        -Math.sin(p.yaw) * dx - Math.cos(p.yaw) * dz,
      );
      const arrow =
        Math.abs(angle) < 0.5
          ? "↑"
          : Math.abs(angle) > 2.5
            ? "↓"
            : angle > 0
              ? "→"
              : "←";
      $("waypoint").textContent =
        `${arrow} ${this.waypoint.name} · ${Math.round(distance(p, this.waypoint))} m`;
    }
    const village = s.region.villages.find((v) => distance(p, v) < 12);
    if (village && !near) this.c.view.worldUI.set("context", {
      title: village.name, detail: `${FACTIONS[village.faction]} · 평판 ${s.reputation[village.faction]}`,
      hint: "사용 / R · 교역과 대화", color: "#c9db9f", maxDistance: 14, side: -1,
      position: { x: village.x, y: this.c.world.surface(village.x, village.z) + 2.4, z: village.z },
    });
    $("interactBtn").firstChild.textContent = village
      ? "교역·대화 "
      : distance(p, s.info.dungeon) < 6
        ? "유적 회수 "
        : s.riding
          ? "하차 "
          : "상호작용 ";
    $("interactBtn").hidden = !village && distance(p, s.info.dungeon) >= 6 &&
      distance(p, { x: 77.5, z: 84.5 }) >= 12 && !s.riding;
    $("biome").textContent = s.info.name;
    $("flyBtn").classList.toggle("enabled", s.airborne);
    $("flyBtn").classList.toggle(
      "hidden",
      !s.riding || !this.c.inventory.unlocks.has("aviation"),
    );
  }
  feedback(message) {
    $("frontierFeedback").textContent = message;
  }
  close() {
    $("frontierPanel").hidden = true;
  }
  open(tab = this.tab) {
    if (!this.c.running) return;
    this.c.pause(true);
    $("pauseScreen").classList.add("hidden");
    $("frontierPanel").hidden = false;
    this.tab = tab;
    $("frontierPanel").dataset.page = tab;
    $("frontierTitle").textContent = { map: "원정 지도", society: "공동체", machine: "기계 조립", journal: "캐릭터 상태" }[tab];
    $("frontierPanel")
      .querySelectorAll("[data-frontier-tab]")
      .forEach((b) =>
        { b.classList.toggle("active", b.dataset.frontierTab === tab);
          b.setAttribute("aria-pressed", String(b.dataset.frontierTab === tab)); },
      );
    this.feedback("");
    this.render();
    $("frontierContent").scrollTop = 0;
    $("frontierClose").focus({ preventScroll: true });
  }
  button(label, fn, id) {
    const b = document.createElement("button");
    b.textContent = label;
    if (id) b.id = id;
    b.onclick = () => {
      const result = fn();
      if (typeof result === "string") this.feedback(result);
    };
    return b;
  }
  render() {
    const { model: s, inventory: inv, player: p } = this.c,
      root = $("frontierContent");
    root.replaceChildren();
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
      const destinations = [
        { name: "원정 야영지", x: 77.5, z: 84.5 },
        ...s.region.villages,
        { name: "동력 유적", ...s.info.dungeon },
        {
          name: s.region.boss.defeated ? "수호자 둥지 · 격파" : "수호자 둥지",
          ...s.info.boss,
        },
      ];
      for (const d of destinations)
        $("destinations").append(
          this.button(
            `${d.name} · ${Math.round(distance(p, d))} m`,
            () => {
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
      for (const v of s.region.villages) {
        const row = document.createElement("section");
        row.className = "villageRow";
        row.innerHTML = `<h3>${escape(v.name)} <small>${FACTIONS[v.faction]} · ${Math.round(distance(p, v))} m</small></h3><p>주민 ${v.population} · 기술 ${v.tech} · 평판 ${s.reputation[v.faction]} ${s.allies.includes(v.faction) ? "· 동맹" : ""}<br>재고: 식량 ${v.food} / 원목 ${v.wood} / 돌 ${v.stone} / 결정 ${v.crystal}</p><div class="frontierButtons"></div>`;
        for (const [action, label] of [
          ["trade", "교역 · 원목 4 → 결정 2·식량 2"],
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
        $("villageList").append(row);
      }
    }
    if (this.tab === "machine") this.machinePanel(root);
    if (this.tab === "journal") {
      const wins = Object.values(s.regions).filter(
        (r) => r.boss.defeated,
      ).length;
      const weapon = activeGear(inv, "weapon"), tool = activeGear(inv, "tool");
      const armor = inv.unlocks.has("armor");
      root.innerHTML = `<div class="characterSheet"><div class="characterFigure"><div class="characterStage ${armor ? "armored" : ""}">${avatar}<span>개척자</span></div><div class="equippedSlots"><div title="${escape(weapon.name)}">${itemArt(gearId(inv, "weapon"))}<small>무기</small></div><div title="${escape(tool.name)}">${itemArt(gearId(inv, "tool"))}<small>도구</small></div><div class="armorSlot ${armor ? "equipped" : ""}" title="${armor ? "개척 갑옷 · 피해 35% 감소" : "갑옷 미착용"}"><b>⛨</b><small>${armor ? "갑옷" : "없음"}</small></div></div></div>
      <div class="characterStats"><div class="characterName"><h3>개척자 <small>LV.</small> ${s.level}</h3><span>${s.riding ? (s.airborne ? "비행 중" : "탑승 중") : "탐험 중"}</span></div>
      <div class="statMeter hp"><label>체력 <b>${Math.ceil(s.hp)} / ${s.maxHP}</b></label><progress max="${s.maxHP}" value="${s.hp}"></progress></div>
      <div class="statMeter food"><label>포만 <b>${Math.ceil(s.hunger)} / 100</b></label><progress max="100" value="${s.hunger}"></progress></div>
      <div class="statMeter xp"><label>경험 <b>${s.xp % 80} / 80</b></label><progress max="80" value="${s.xp % 80}"></progress></div>
      <dl class="combatStats"><div><dt>${escape(weapon.name)}</dt><dd>공격 ${weapon.damage + (weapon.name === "기본 펄스" && inv.unlocks.has("blade") ? 12 : 0)}</dd></div><div><dt>${armor ? "개척 갑옷" : "기본 의복"}</dt><dd>피해 감소 ${armor ? "35" : "0"}%</dd></div></dl>
      <div id="supplies" class="supplySlots"></div></div></div>
      <div class="milestoneStrip"><span>⚑ <b>${s.allies.length}</b> 동맹</span><span>◆ <b>${wins}</b> 수호자</span><span>▧ <b>${inv.count("knowledge")}</b> 연구</span><span>◈ <b>${inv.count("relic")}</b> 유적 핵</span></div>
      <details class="expeditionLog"><summary>원정 기록 <span>${s.log.length}</span></summary><ol>${s.log.map((t) => `<li>${escape(t)}</li>`).join("") || "<li>첫 원정을 시작했습니다.</li>"}</ol></details>`;
      for (const [label, fn, id] of [
        ["식량 먹기", () => s.consume("food", inv), "eatFood"],
        ["회복약 사용 · H", () => s.consume("medicine", inv), "useMedicine"],
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
        const item = id === "eatFood" ? "food" : id === "useMedicine" ? "medicine" : null;
        button.innerHTML = item ? `${itemArt(item)}<b class="supplyCount">${inv.count(item)}</b><small>${item === "food" ? "먹기" : "회복"}</small>` : `<b aria-hidden="true">${id === "campRest" ? "⌂" : id === "frontierBag" ? "▦" : "▣"}</b><small>${id === "campRest" ? "휴식" : id === "frontierBag" ? "가방" : "저장"}</small>`;
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
    const { model: s, inventory: inv } = this.c;
    s.provisionMachine(inv);
    if (!s.machine) {
      root.innerHTML =
        "<h3>나의 복셀 기계</h3><p>가방에서 동력 연구와 기본 차량 설계를 제작하세요.<br>연구 기록은 장소 발견·유적 탐사·마을 지원으로 얻습니다.</p>";
      root.append(
        this.button("가방 · 제작 열기", () => {
          this.close();
          this.c.openBag();
        }),
      );
      return;
    }
    const f = evaluate(s.machine);
    root.innerHTML = `<h3>설계도와 부품 상태 <small>합금 ${inv.count("iron")}</small></h3><p>질량 ${f.mass} · 동력 ${Math.round(f.power)} · 접지 ${Math.round(f.grip * 100)}% · 포탑 ${f.weapons.toFixed(1)} · 회전익 ${f.lift.toFixed(1)}<br>원점 차체와 면으로 연결 · 0.5m 격자 · 파괴된 부품도 설계도에는 남아 수리 가능</p>
      <div class="frontierButtons"><select id="frontierPart" aria-label="기계 부품">${Object.entries(
        TYPES,
      )
        .map(
          ([id, t]) =>
            `<option value="${id}">${t.label} · 합금 ${t.cost}</option>`,
        )
        .join(
          "",
        )}</select><select id="frontierLayer" aria-label="기계 층"><option value="0">0층</option><option value="1">1층</option><option value="2">2층</option></select><select id="frontierEdit" aria-label="기계 편집"><option value="add">배치</option><option value="repair">수리</option><option value="remove">제거·회수</option></select></div>
      <div id="frontierMachineGrid" role="group" aria-label="원정 기계 조립 격자"></div><p id="partInfo"></p><div id="rideActions" class="frontierButtons"></div>
      <p>포탑: 투사체 연구 필요 · 펄스로 조준 사격 · 돌 1개/발<br>비행: 회전익 연구 + 연결된 회전익 2개 · 탑승 후 F/비행 버튼<br>기계는 야영지에서 보관하며 조립/탑승도 야영지에서 가능합니다.</p>`;
    const drawGrid = () => {
      const grid = $("frontierMachineGrid");
      grid.replaceChildren();
      for (let z = -3; z <= 3; z++)
        for (let x = -3; x <= 3; x++) {
          const y = Number($("frontierLayer").value),
            part = s.machine.blueprint.find(
              (p) => p.x === x && p.y === y && p.z === z,
            );
          const b = this.button(
            part
              ? TYPES[part.type].label.slice(0, 1)
              : x === 0 && z === 0
                ? "◎"
                : "·",
            () => {
              if (distance(this.c.player, { x: 77.5, z: 84.5 }) > 12)
                return "야영지로 돌아와 조립하세요.";
              const result = s.editMachine(
                inv,
                $("frontierEdit").value,
                x,
                y,
                z,
                $("frontierPart").value,
              );
              drawGrid();
              $("partInfo").textContent =
                `${result} · 합금 ${inv.count("iron")}`;
              return result;
            },
          );
          b.setAttribute(
            "aria-label",
            `${x},${y},${z} ${part ? TYPES[part.type].label + " HP " + Math.ceil(s.machine.hp[part.id]) : "빈 칸"}`,
          );
          if (part) {
            b.style.borderColor = "#" + TYPES[part.type].color.toString(16);
            b.classList.toggle("broken", s.machine.hp[part.id] === 0);
          }
          b.disabled = s.riding;
          grid.append(b);
        }
    };
    $("frontierLayer").onchange = drawGrid;
    drawGrid();
    $("rideActions").append(
      this.button(
        s.riding ? "하차" : "차량 탑승",
        () => {
          if (!s.riding && distance(this.c.player, { x: 77.5, z: 84.5 }) > 12)
            return "야영지에서 탑승하세요.";
          const r = s.toggleRide(inv);
          if (s.riding) this.c.pause(false);
          else this.render();
          return r;
        },
        "rideVehicle",
      ),
    );
  }
}
