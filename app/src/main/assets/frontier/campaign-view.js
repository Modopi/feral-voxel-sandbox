import { mountJourney, setJourney } from "../shell.js";
import { T } from "../render.js";
import { ITEMS } from "../inventory.js";
import { sourceHints } from "../acquisition.js";
import {
  CAMP,
  BIOMES,
  PROJECTS,
  CROPS,
  SIGNAL_ROUTES,
  SORTIES,
  milestones,
  channels,
  nextObjective,
  objectiveDestination,
  signalEligible,
  surveySites,
} from "./campaign.js";

const costs = (items, inv) =>
  Object.entries(items)
    .map(([id, n]) => `${ITEMS[id].name} ${inv.count(id)}/${n}`)
    .join(" · ");
const rewards = (items) =>
  Object.entries(items)
    .map(([id, n]) => `${ITEMS[id].name} ${n}`)
    .join(" · ");
export class CampaignView {
  constructor(parent) {
    this.v = parent;
    this.c = parent.c;
    this.track = true;
    this.page = "journey";
    this.button = mountJourney(() => {
      this.page = "journey";
      parent.open("journey");
    });
  }
  reset() {
    const v = this.v,
      { world, model: s } = this.c;
    this.root = new T.Group();
    v.group.add(this.root);
    this.root.position.set(77, world.surface(77, 84), 84);
    const box = (...args) => v.box(this.root, ...args);
    // Signal mast is a persistent landmark, not a fullscreen completion popup.
    for (const side of [-1, 1])
      box(side * 1.4, 2.4, -3, 0.24, 4.8, 0.24, 0x566461);
    for (const y of [1, 2.5, 4]) box(0, y, -3, 3, 0.18, 0.2, 0x70817a);
    this.lamps = BIOMES.map((bio, i) => {
      const lamp = box((i - 1) * 0.85, 4.65, -3, 0.5, 0.5, 0.5, bio.color);
      lamp.material = new T.MeshBasicMaterial({ color: bio.color });
      return lamp;
    });
    this.beam = box(0, 8, -3, 0.15, 7, 0.15, 0xb9f2d6);
    this.beam.material = new T.MeshBasicMaterial({ color: 0xb9f2d6 });
    v.registerTarget(this.root, {
      kind: "outpost",
      name: "신호 야영지 · 시설과 원정",
    });
    this.facilities = {};
    for (const project of PROJECTS) {
      const group = new T.Group();
      this.root.add(group);
      this.facilities[project.id] = group;
      if (project.id === "garden") {
        group.position.set(-2.5, 0, 1);
        for (const z of [0, 1.5]) {
          v.box(group, 0, 0.12, z, 2, 0.24, 1.2, 0x76553b);
          for (const x of [-1, 1])
            v.box(group, x, 0.25, z, 0.12, 0.5, 1.4, 0xbfa16d);
        }
      } else if (project.id === "workshop") {
        group.position.set(2.8, 0, -2);
        v.box(group, 0, 0.8, 0, 1.8, 0.2, 1.1, 0xa88b64);
        for (const x of [-0.7, 0.7])
          v.box(group, x, 0.4, 0, 0.16, 0.8, 0.8, 0x665540);
        v.box(group, 0, 1.08, 0, 0.6, 0.4, 0.5, 0x788c90);
      } else {
        group.position.set(2.7, 0, 2.7);
        v.box(group, 0, 0.2, 0, 1.5, 0.4, 1.2, 0x758077);
        v.box(group, 0, 0.6, 0, 0.7, 0.4, 0.7, 0x494b40);
        v.box(group, 0, 0.88, 0, 0.6, 0.15, 0.6, 0xd1aa67);
      }
    }
    this.plants = [0, 1].map((index) => {
      const group = new T.Group();
      this.facilities.garden.add(group);
      group.position.set(0, 0.25, index * 1.5);
      for (const x of [-0.6, 0, 0.6]) {
        v.box(group, x, 0.35, 0, 0.1, 0.7, 0.1, 0x719955);
        v.box(group, x, 0.55, 0, 0.35, 0.2, 0.35, 0xb88979);
      }
      v.registerTarget(group, {
        kind: "crop",
        index,
        name: `재생 텃밭 ${index + 1}`,
      });
      return group;
    });
    this.markers = surveySites(s.info).map((site) => {
      const root = new T.Group();
      root.position.set(site.x, world.surface(site.x, site.z), site.z);
      v.group.add(root);
      v.box(root, 0, 0.5, 0, 0.25, 1, 0.25, 0x9caa9e);
      v.box(root, 0, 1.05, 0, 0.65, 0.2, 0.65, 0xe3cb8c);
      v.registerTarget(root, { kind: "survey", ...site });
      return root;
    });
    this.update();
  }
  update() {
    if (!this.root) return;
    const s = this.c.model,
      o = s.region.outpost,
      j = s.journey,
      known = channels(s);
    for (const [id, group] of Object.entries(this.facilities))
      group.visible = o.projects.includes(id);
    this.lamps.forEach((lamp, i) => {
      lamp.material.color.setHex(
        known.includes(i) ? BIOMES[i].color : 0x3d4847,
      );
      lamp.rotation.y = s.time * 0.3;
    });
    this.beam.visible = j.completedAt !== null;
    this.plants.forEach((group, i) => {
      const plot = o.plots[i];
      group.visible = !!plot;
      if (plot)
        group.scale.y = Math.min(
          1,
          Math.max(0.15, 1 - (plot.ready - s.time) / CROPS[plot.crop].seconds),
        );
    });
    this.markers.forEach((m, i) => {
      m.visible = o.sortie?.kind === "survey";
      m.scale.y = o.sortie?.visited.includes(i) ? 0.65 : 1;
    });
  }
  hud() {
    const s = this.c.model,
      m = nextObjective(s),
      run = s.region.outpost.sortie;
    const title = run ? SORTIES[run.kind].name : m.title;
    const detail = run
      ? run.done
        ? "완료 · 야영지로 귀환"
        : run.kind === "survey"
          ? `표석 ${run.visited.length}/3 · 여정에서 추적`
          : run.kind === "hunt"
            ? "수호자 둥지로 이동"
            : "첫 마을에 보급품 전달"
      : m.done
        ? "달성 · 눌러서 보상 수령"
        : "눌러서 목표와 준비물 확인";
    setJourney(this.button, title, detail, m.done || !!run?.done);
    if (this.track) {
      let target = objectiveDestination(s);
      if (run)
        target = run.done
          ? CAMP
          : run.kind === "hunt"
            ? { ...s.info.boss, name: "수호자 잔향" }
            : run.kind === "supply"
              ? s.region.villages[0]
              : surveySites(s.info).find(
                  (p) => !run.visited.includes(p.index),
                ) || CAMP;
      this.v.waypoint = target;
    }
  }
  action(action, arg) {
    const message = this.c.model.campaign(
      action,
      arg,
      this.c.player,
      this.c.inventory,
    );
    this.c.toast(message);
    this.update();
    this.hud();
    return message;
  }
  render(root) {
    const s = this.c.model,
      inv = this.c.inventory,
      o = s.region.outpost,
      j = s.journey;
    const atCamp =
      Math.hypot(this.c.player.x - CAMP.x, this.c.player.z - CAMP.z) <= 12;
    root.classList.add("journeyContent");
    const pages = document.createElement("div");
    pages.className = "journeyPages";
    pages.setAttribute("aria-label", "여정 세부 화면");
    for (const [id, label] of [
      ["journey", "목표"],
      ["camp", "야영지"],
      ["network", "신호망"],
      ["sorties", "원정"],
    ]) {
      const b = this.v.button(label, () => {
        this.page = id;
        this.v.render();
        root.scrollTop = 0;
      });
      b.dataset.campaignPage = id;
      b.setAttribute("aria-pressed", String(this.page === id));
      pages.append(b);
    }
    root.append(pages);
    const section = (title, text, page = "journey") => {
      const el = document.createElement("section");
      el.className = "journeySection";
      el.hidden = this.page !== page;
      el.innerHTML = `<h3>${title}</h3><p>${text}</p>`;
      root.append(el);
      return el;
    };
    const button = (host, label, action, arg, disabled = false) => {
      const b = this.v.button(label, () => {
        const scroll = root.scrollTop,
          result = this.action(action, arg);
        this.v.render();
        root.scrollTop = scroll;
        return result;
      });
      b.dataset.campaign = action;
      b.dataset.arg = Array.isArray(arg) ? arg.join(":") : (arg ?? "");
      b.disabled = disabled;
      host.append(b);
      return b;
    };
    const head = section(
      j.completedAt === null ? "첫 신호" : "첫 신호 · 전송 완료",
      j.completedAt === null
        ? "세 공동체가 남긴 신호를 다시 연결하세요. 탐사·전투·협력 중 자신에게 맞는 방법으로 준비하고 돌아옵니다."
        : `흩어진 공동체가 응답했습니다. 자유 탐험과 세 종류의 원정을 계속할 수 있습니다. 원정 완료 ${j.sorties}회`,
    );
    const diagram = document.createElement("div");
    diagram.className = "signalNetwork";
    BIOMES.forEach((bio, i) => {
      const n = document.createElement("span");
      n.className = channels(s).includes(i) ? "lit" : "";
      n.textContent = `${channels(s).includes(i) ? "◆" : "◇"} ${bio.signal}\n${["출발지 [0,0]", "동쪽 [1,0]", "북쪽 [0,-1]"][i]}`;
      diagram.append(n);
    });
    head.append(diagram);
    head.append(
      this.v.button("현재 목표 추적 · 월드로", () => {
        this.track = true;
        this.hud();
        this.c.pause(false);
      }),
    );
    const steps = section(
      "여정",
      "완료한 목표의 보상은 한 번만 받습니다. 활동 순서는 자유입니다.",
    );
    for (const m of milestones(s)) {
      const done = j.claimed.includes(m.id),
        row = document.createElement("div");
      row.className = "journeyStep" + (done ? " completed" : "");
      row.innerHTML = `<strong>${done ? "✓ " : ""}${m.title}</strong><p>${m.text}</p><small>보상 · ${rewards(m.reward)}</small>`;
      if (!done)
        button(row, m.done ? "보상 받기" : "진행 중", "claim", m.id, !m.done);
      steps.append(row);
    }
    const camp = section(
      "야영지 시설",
      `${s.info.name} · ${atCamp ? "건설·정비 가능" : "야영지 12m 안에서 이용"}. 시설은 지역마다 남습니다. 출발지의 세 시설을 완성해야 송신탑을 점화할 수 있습니다.`,
      "camp",
    );
    for (const def of PROJECTS) {
      const row = document.createElement("div");
      row.className = "projectRow";
      const built = o.projects.includes(def.id);
      row.innerHTML = `<strong>${built ? "✓ " : ""}${def.name}</strong><p>${def.text}</p>${built ? "" : `<small>${costs(def.cost, inv)}</small>`}`;
      if (!built) button(row, "시설 건설", "build", def.id, !atCamp);
      if (built && def.id === "kitchen")
        button(row, "식량 1 · 휴식과 든든함", "rest", null, !atCamp);
      if (built && def.id === "workshop")
        button(row, "합금 1·원목 1 · 장비 정비", "repair", null, !atCamp);
      if (built && def.id === "garden")
        o.plots.forEach((plot, index) => {
          const bed = document.createElement("div");
          bed.className = "cropRow";
          if (plot) {
            const remaining = Math.max(0, Math.ceil(plot.ready - s.time));
            bed.innerHTML = `<span>밭 ${index + 1} · ${CROPS[plot.crop].name} · ${remaining ? `${remaining}초 후 수확` : "수확 가능"}</span>`;
            button(bed, "수확", "harvest", index, !atCamp || remaining > 0);
          } else {
            bed.innerHTML = `<span>밭 ${index + 1} · 빈 밭 · 씨앗 ${inv.count("seed")}</span>`;
            for (const [id, crop] of Object.entries(CROPS))
              button(
                bed,
                `${crop.name} 심기 · 씨앗 1`,
                "plant",
                [index, id],
                !atCamp,
              );
          }
          row.append(bed);
        });
      camp.append(row);
    }
    const signal = section(
      `${BIOMES[s.info.biome].signal} 신호 복원`,
      o.signal
        ? `복원 완료 · ${SIGNAL_ROUTES[o.signal.route].name}`
        : "세 경로 중 하나를 선택하세요. 보스 처치는 필수 조건이 아닙니다.",
      "network",
    );
    if (!o.signal)
      for (const [id, route] of Object.entries(SIGNAL_ROUTES)) {
        const row = document.createElement("div");
        row.className = "signalRoute";
        row.innerHTML = `<strong>${route.name} · ${signalEligible(s, id) ? "조건 달성" : "준비 중"}</strong><p>${route.text}<br>${costs(route.cost, inv)}</p>`;
        button(
          row,
          "이 경로로 복원",
          "signal",
          id,
          !atCamp || !signalEligible(s, id),
        );
        signal.append(row);
      }
    if (j.completedAt === null) {
      const final = section(
        "송신탑 점화",
        `출발지 [0,0]에서 세 신호와 세 시설을 연결합니다. ${costs({ iron: 8, knowledge: 6 }, inv)}`,
        "network",
      );
      button(
        final,
        "첫 신호 전송",
        "ignite",
        null,
        !atCamp || s.key !== "0,0" || channels(s).length < 3,
      );
    }
    const sorties = section(
      "신호 너머 · 반복 원정",
      j.completedAt === null
        ? "첫 신호를 전송하면 열립니다. 측량·보급·수호자 잔향을 번갈아 즐기며 유적 핵과 연구·정비 물자를 얻습니다."
        : `이 지역 원정 완료 ${o.rounds}회 · ${o.nextSortie > s.time ? `재출발까지 ${Math.ceil(o.nextSortie - s.time)}초` : "출발 가능"}`,
      "sorties",
    );
    if (o.sortie) {
      const run = o.sortie;
      sorties.append(
        Object.assign(document.createElement("p"), {
          textContent: `${SORTIES[run.kind].name} · ${run.done ? "목표 달성" : SORTIES[run.kind].text}`,
        }),
      );
      button(
        sorties,
        "원정 보상 수령",
        "claimSortie",
        null,
        !atCamp || !run.done,
      );
      button(
        sorties,
        "원정 포기 · 투입 물자 반환 없음",
        "abandonSortie",
        null,
        !atCamp,
      );
    } else
      for (const [id, def] of Object.entries(SORTIES)) {
        const row = document.createElement("div");
        row.className = "sortieRow";
        row.innerHTML = `<strong>${def.name}</strong><p>${def.text}<br>보상 · ${rewards(def.reward)}</p>`;
        button(
          row,
          "원정 출발",
          "startSortie",
          id,
          !atCamp ||
            j.completedAt === null ||
            !o.signal ||
            o.nextSortie > s.time,
        );
        sorties.append(row);
      }
    const guide = document.createElement("details");
    guide.className = "journeySources";
    guide.hidden = !["camp", "network"].includes(this.page);
    guide.innerHTML = "<summary>시설·신호 복원 재료를 얻는 곳</summary>";
    for (const id of [
      "wood",
      "dirt",
      "plank",
      "stone",
      "iron",
      "crystal",
      "relic",
      "knowledge",
      "seed",
      "food",
      "medicine",
    ]) {
      const p = document.createElement("p");
      p.textContent = `${ITEMS[id].name}: ${sourceHints(id, true).join(" / ")}`;
      guide.append(p);
    }
    root.append(guide);
  }
}
