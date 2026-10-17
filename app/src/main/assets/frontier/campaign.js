// First Signal: shared content and authoritative, renderer-independent campaign actions.
import { GEAR } from "../equipment.js";

export const CAMP = { x: 77.5, z: 84.5, name: "원정 야영지" };
export const BIOMES = [
  {
    id: "grove",
    name: "이끼 숲",
    signal: "뿌리",
    color: 0x82bd83,
    boss: "이끼 수호자",
    lesson: "찍기 예고가 보이면 붉은 원 밖으로 이동하세요.",
    bonus: { herb: 3, seed: 4 },
  },
  {
    id: "ridge",
    name: "붉은 구릉",
    signal: "동력",
    color: 0xd69863,
    boss: "구리 돌격수",
    lesson: "길게 뻗은 돌진 예고선의 옆으로 피하세요.",
    bonus: { scrap: 4, iron: 2 },
  },
  {
    id: "coast",
    name: "유리 해안",
    signal: "바람",
    color: 0x79c9d7,
    boss: "유리 파수꾼",
    lesson: "고리 공격은 안쪽 빈 공간 또는 바깥쪽으로 피하세요.",
    bonus: { crystal: 4, resin: 2 },
  },
];
export function biomeIndex(x, z) {
  // Nearby directions always expose all three channels, independently of seed luck.
  return (((x - z * 2) % 3) + 3) % 3;
}
export const PROJECTS = [
  {
    id: "garden",
    name: "재생 텃밭",
    cost: { wood: 6, dirt: 4 },
    text: "두 밭에 씨앗을 심어 열매·약초를 재배합니다. 수확하면 씨앗도 돌아옵니다.",
  },
  {
    id: "kitchen",
    name: "야영 취사장",
    cost: { stone: 8, plank: 4 },
    text: "식량 1개로 완전히 회복하고 3분간 든든함을 얻습니다. 원정 중 받는 피해가 10% 줄어듭니다.",
  },
  {
    id: "workshop",
    name: "공동 정비소",
    cost: { plank: 8, iron: 4 },
    text: "합금 1·원목 1로 소지한 모든 무기와 도구의 내구도를 각각 60 회복합니다.",
  },
];
export const CROPS = {
  berry: {
    name: "들열매",
    seconds: 90,
    reward: { berry: 6, seed: 2, fiber: 2 },
    color: 0xb45765,
  },
  herb: {
    name: "은잎 약초",
    seconds: 120,
    reward: { herb: 4, seed: 2, fiber: 2 },
    color: 0xa5c9ab,
  },
};
export const SIGNAL_ROUTES = {
  explorer: {
    name: "탐사 복원",
    cost: { relic: 1, iron: 4, crystal: 4 },
    text: "이 지역의 유적 핵 회수 후 복원",
  },
  guardian: {
    name: "수호자 동력",
    cost: { relic: 1, iron: 2 },
    text: "이 지역 수호자 격파 후 복원",
  },
  community: {
    name: "공동체 협력",
    cost: { food: 6, plank: 8, knowledge: 4 },
    text: "이 지역 주민 의뢰 2건 + 지역 집단 동맹",
  },
};
export const SORTIES = {
  survey: {
    name: "측량 원정",
    text: "마을·유적·수호자 둥지의 측량 표석 3곳을 조사하고 돌아오세요.",
    reward: { knowledge: 6, crystal: 6, relic: 1 },
  },
  supply: {
    name: "보급 원정",
    text: "첫 마을에 식량 6·회복약 2·목재 8을 전달하고 돌아오세요.",
    cost: { food: 6, medicine: 2, plank: 8 },
    reward: { iron: 10, knowledge: 4, relic: 1 },
  },
  hunt: {
    name: "수호자 잔향",
    text: "둥지에서 강화된 수호자를 물리치고 돌아오세요. 실패 시 다시 도전할 수 있습니다.",
    reward: { iron: 8, knowledge: 8, relic: 2 },
  },
};
export function surveySites(info) {
  return [info.villages[0], info.dungeon, info.boss].map((p, index) => ({
    x: p.x + 6,
    z: p.z + 5,
    index,
    name: ["마을 측량 표석", "유적 측량 표석", "둥지 측량 표석"][index],
  }));
}
export const newJourney = () => ({
  claimed: [],
  completedAt: null,
  harvests: 0,
  sorties: 0,
  fedUntil: 0,
  tonicUntil: 0,
});
export const newOutpost = () => ({
  projects: [],
  plots: [null, null],
  signal: null,
  sortie: null,
  rounds: 0,
  nextSortie: 0,
});
export function ensureOutpost(region) {
  region.outpost ||= newOutpost();
}
const near = (p, q, r = 12) => Math.hypot(p.x - q.x, p.z - q.z) <= r;
const regions = (s) => Object.values(s.regions);
export function channels(s) {
  return [
    ...new Set(
      regions(s)
        .map((r) => r.outpost?.signal?.channel)
        .filter(Number.isInteger),
    ),
  ];
}
export function milestones(s) {
  const home = s.regions["0,0"]?.outpost;
  return [
    {
      id: "gather",
      title: "01 · 첫 보급",
      text: "나무·열매·약초 중 채집 지점 3곳을 사용하세요. 가방에서 들열매 식량을 만들 수 있습니다.",
      done:
        regions(s).reduce((n, r) => n + Object.keys(r.resources).length, 0) >=
        3,
      reward: { food: 3, knowledge: 2 },
      target: "gather",
    },
    {
      id: "roots",
      title: "02 · 돌아올 곳",
      text: "출발 야영지에 재생 텃밭을 짓고 작물을 한 번 수확하세요. 씨앗 1개로 심습니다.",
      done: !!home?.projects.includes("garden") && s.journey.harvests > 0,
      reward: { iron: 4, medicine: 2 },
      target: "camp",
    },
    {
      id: "neighbors",
      title: "03 · 이웃의 이름",
      text: "주민에게 말을 걸고 의뢰를 하나 완료하세요. 마을 지원 2회로도 인정됩니다.",
      done: regions(s).some(
        (r) => r.contracts.length || r.villages.some((v) => v.aid >= 2),
      ),
      reward: { knowledge: 4, plank: 6 },
      target: "village",
    },
    {
      id: "first",
      title: "04 · 꺼진 신호",
      text: "탐사·수호자 전투·공동체 협력 중 한 경로로 야영지의 지역 신호를 복원하세요.",
      done: channels(s).length > 0,
      reward: { food: 6, iron: 6 },
      target: "signal",
    },
    {
      id: "network",
      title: "05 · 세 개의 목소리",
      text: "뿌리·동력·바람 신호를 모두 복원하세요. 출발지, 동쪽, 북쪽에 각각 있습니다. 야영지에서 지도 버튼으로 이동합니다.",
      done: channels(s).length === 3,
      reward: { knowledge: 6, relic: 1 },
      target: "network",
    },
    {
      id: "home",
      title: "06 · 첫 신호",
      text: "출발지의 텃밭·취사장·정비소를 완성하고 송신탑을 점화하세요. 합금 8·연구 6이 필요합니다.",
      done: s.journey.completedAt !== null,
      reward: { relic: 2, iron: 12, knowledge: 12 },
      target: "home",
    },
  ];
}
export function nextObjective(s) {
  return (
    milestones(s).find((m) => !s.journey.claimed.includes(m.id)) || {
      id: "endless",
      title: "신호 너머 · 자유 원정",
      text: "복원한 야영지에서 측량·보급·수호자 잔향 원정을 선택하세요.",
      target: "camp",
      done: false,
    }
  );
}
export function objectiveDestination(s) {
  const m = nextObjective(s);
  if (m.done) return { ...CAMP, name: "목표 달성 · 여정에서 보상 수령" };
  if (m.target === "gather") {
    const sites = [
      { id: "wood:0", x: 73, z: 84, name: "맹아 나무" },
      { id: "berry:0", x: 74, z: 87, name: "들열매 덤불" },
      { id: "herb:0", x: 80, z: 87, name: "은잎 약초" },
    ];
    return (
      sites.find((p) => s.region.resources[p.id] === undefined) ||
      s.region.villages[0]
    );
  }
  if (m.target === "village") return s.region.villages[0];
  if (
    m.target === "signal" &&
    !s.region.cacheClaimed &&
    !s.region.boss.defeated
  )
    return { ...s.info.dungeon, name: "유적 · 세 중계기 해제 또는 마을 협력" };
  return CAMP;
}
export function signalEligible(s, route) {
  if (route === "explorer") return s.region.cacheClaimed;
  if (route === "guardian") return s.region.boss.defeated;
  if (route === "community")
    return (
      s.region.contracts.length >= 2 &&
      s.region.villages.some(
        (v) => s.allies.includes(v.faction) && s.reputation[v.faction] >= 0,
      )
    );
  return false;
}
// One command path for touch, keyboard and simulation tests. Transactions precede state changes.
export function campaignAction(s, action, arg, p, inv) {
  const o = s.region.outpost,
    j = s.journey;
  if (action === "claim") {
    const m = milestones(s).find((m) => m.id === arg);
    if (!m || !m.done || j.claimed.includes(arg))
      return "아직 달성하지 않았거나 이미 보상을 받았습니다.";
    if (!inv.transaction({}, m.reward, true))
      return "보상을 받을 가방 공간이 필요합니다.";
    j.claimed.push(arg);
    s.xp += 12;
    s.note(`${m.title} · 여정 보상 수령`);
    return "여정 보상 수령 · 다음 목표가 갱신되었습니다.";
  }
  if (action === "survey") {
    const site = surveySites(s.info)[arg],
      run = o.sortie;
    if (!site || !near(p, site, 4)) return "측량 표석 4m 안에서 사용하세요.";
    if (!run || run.kind !== "survey")
      return "야영지에서 측량 원정을 시작하면 이 지점을 기록할 수 있습니다.";
    if (run.visited.includes(arg)) return "이미 기록한 측량 지점입니다.";
    run.visited.push(arg);
    run.done = run.visited.length === 3;
    return run.done
      ? "측량 완료 · 야영지에서 원정 보상을 받으세요."
      : `측량 ${run.visited.length}/3 · 다음 표석으로 이동하세요.`;
  }
  if (action === "deliverSortie") {
    if (!near(p, s.region.villages[0]))
      return "첫 마을 12m 안에서 보급품을 전달하세요.";
    const run = o.sortie;
    if (!run || run.kind !== "supply" || run.done)
      return "진행 중인 보급 의뢰가 없습니다.";
    if (s.reputation[s.region.villages[0].faction] <= -20)
      return "적대 중입니다. 먼저 화해하세요.";
    if (!inv.transaction(SORTIES.supply.cost, {}, true))
      return "식량 6·회복약 2·목재 8이 필요합니다.";
    run.done = true;
    const v = s.region.villages[0];
    v.food = Math.min(80, v.food + 6);
    s.reputation[v.faction] = Math.min(100, s.reputation[v.faction] + 6);
    return "보급품 전달 · 야영지에서 원정 보상을 받으세요.";
  }
  if (!near(p, CAMP)) return "야영지 12m 안에서 진행하세요.";
  if (action === "build") {
    const def = PROJECTS.find((d) => d.id === arg);
    if (!def || o.projects.includes(arg))
      return "이미 지었거나 알 수 없는 시설입니다.";
    if (!inv.transaction(def.cost, {}, true))
      return "시설 재료가 부족합니다. 여정의 재료 획득처를 확인하세요.";
    o.projects.push(arg);
    s.xp += 10;
    s.note(`${def.name} 건설 · ${s.info.name}`);
    return `${def.name} 완성 · 야영지에 시설이 나타납니다.`;
  }
  if (action === "plant") {
    const [index, crop] = Array.isArray(arg) ? arg : [];
    if (!o.projects.includes("garden")) return "먼저 재생 텃밭을 지으세요.";
    if (![0, 1].includes(index) || !CROPS[crop] || o.plots[index])
      return "빈 밭과 작물을 선택하세요.";
    if (!inv.take("seed", 1))
      return "씨앗 1개가 필요합니다. 섬유 2개로 씨앗 3개를 제작할 수 있습니다.";
    o.plots[index] = { crop, ready: s.time + CROPS[crop].seconds };
    return `${CROPS[crop].name} 파종 · ${CROPS[crop].seconds}초의 활동 시간 후 수확`;
  }
  if (action === "harvest") {
    const plot = o.plots[arg];
    if (!plot)
      return "씨앗을 심을 빈 밭입니다. 야영지 여정에서 작물을 선택하세요.";
    if (s.time < plot.ready)
      return `수확까지 ${Math.ceil(plot.ready - s.time)}초 · 다른 지역을 탐험해도 자랍니다.`;
    if (!inv.transaction({}, CROPS[plot.crop].reward, true))
      return "가방이 가득 찼습니다. 작물은 남아 있습니다.";
    o.plots[arg] = null;
    j.harvests++;
    s.xp += 4;
    return `${CROPS[plot.crop].name} 수확 · 씨앗 2·섬유 2와 작물 획득`;
  }
  if (action === "repair") {
    if (!o.projects.includes("workshop")) return "공동 정비소가 필요합니다.";
    const gear = Object.entries(GEAR).filter(
      ([id, g]) =>
        g.durability && inv.count(id) && (inv.wear[id] || 0) < g.durability,
    );
    if (!gear.length) return "정비할 손상 장비가 없습니다.";
    if (!inv.transaction({ iron: 1, wood: 1 }, {}, true))
      return "정비에는 합금 1·원목 1이 필요합니다.";
    for (const [id, g] of gear)
      inv.wear[id] = Math.min(g.durability, (inv.wear[id] || 0) + 60);
    inv.revision++;
    return "모든 소지 장비 내구도 +60";
  }
  if (action === "rest") {
    if (!o.projects.includes("kitchen")) return "야영 취사장이 필요합니다.";
    if (!inv.take("food", 1)) return "식량 1개가 필요합니다.";
    s.hp = s.maxHP;
    s.hunger = 100;
    j.fedUntil = s.time + 180;
    return "완전 회복 · 든든함 180초: 받는 피해 10% 감소";
  }
  if (action === "signal") {
    const def = SIGNAL_ROUTES[arg];
    if (o.signal) return "이 지역의 신호는 이미 복원했습니다.";
    if (!def || !signalEligible(s, arg))
      return "선택한 복원 경로의 조건을 먼저 달성하세요.";
    if (!inv.transaction(def.cost, {}, true))
      return "신호 복원 재료가 부족합니다.";
    o.signal = { channel: s.info.biome, route: arg };
    s.xp += 35;
    s.note(
      `${BIOMES[s.info.biome].signal} 신호 복원 · ${channels(s).length}/3`,
    );
    return "지역 신호 복원 · 야영지의 신호탑이 켜졌습니다.";
  }
  if (action === "ignite") {
    if (s.key !== "0,0") return "출발 지역 [0, 0]의 야영지로 돌아오세요.";
    if (j.completedAt !== null)
      return "첫 신호가 이미 전송되었습니다. 자유 원정을 계속하세요.";
    if (
      channels(s).length < 3 ||
      PROJECTS.some((d) => !o.projects.includes(d.id))
    )
      return "세 종류 신호와 출발지의 텃밭·취사장·정비소가 필요합니다.";
    if (!inv.transaction({ iron: 8, knowledge: 6 }, {}, true))
      return "송신탑 점화에는 합금 8·연구 6이 필요합니다.";
    j.completedAt = s.time;
    s.xp += 80;
    s.note(
      "첫 신호 전송 · 흩어진 공동체가 응답했다. 이제 신호 너머로 나아갈 시간이다.",
    );
    return "첫 신호 완료 · 측량·보급·수호자 잔향 원정이 열렸습니다. 여정에서 완수 보상을 받으세요.";
  }
  if (action === "startSortie") {
    if (j.completedAt === null || !o.signal)
      return "첫 신호 캠페인을 완료하고 현재 지역 신호를 복원하세요.";
    if (!SORTIES[arg] || o.sortie)
      return "진행 중인 원정을 완료하거나 포기하세요.";
    if (s.time < o.nextSortie)
      return `재출발까지 ${Math.ceil(o.nextSortie - s.time)}초`;
    o.sortie = { kind: arg, done: false, visited: [] };
    if (arg === "hunt") {
      const maxHP = Math.round(
        120 * s.info.tier * (1 + Math.min(5, o.rounds) * 0.15),
      );
      o.sortie.boss = {
        hp: maxHP,
        maxHP,
        defeated: false,
        phase: 0,
        warning: 0,
        cooldown: 2,
        x: s.info.boss.x,
        z: s.info.boss.z,
        aimX: 0,
        aimZ: 0,
      };
    }
    return `${SORTIES[arg].name} 시작 · 목표를 달성하고 야영지로 돌아오세요.`;
  }
  if (action === "abandonSortie") {
    o.sortie = null;
    o.nextSortie = s.time + 30;
    return "원정 포기 · 이미 사용한 물자는 반환되지 않습니다. 30초 후 재출발 가능합니다.";
  }
  if (action === "claimSortie") {
    const run = o.sortie;
    if (!run?.done) return "원정 목표를 먼저 완료하세요.";
    if (!inv.transaction({}, SORTIES[run.kind].reward, true))
      return "원정 보상을 받을 가방 공간이 필요합니다.";
    o.sortie = null;
    o.rounds++;
    o.nextSortie = s.time + 60;
    j.sorties++;
    s.xp += 25;
    return "원정 보상 수령 · 60초 후 다음 원정 출발";
  }
  return "알 수 없는 야영지 행동입니다.";
}
export function validateCampaign(s) {
  const j = s.journey,
    ids = milestones(s).map((m) => m.id);
  if (
    !j ||
    !Array.isArray(j.claimed) ||
    new Set(j.claimed).size !== j.claimed.length ||
    j.claimed.some((id) => !ids.includes(id)) ||
    (j.completedAt !== null &&
      (!Number.isFinite(j.completedAt) || j.completedAt < 0)) ||
    ["harvests", "sorties", "fedUntil", "tonicUntil"].some(
      (k) => !Number.isFinite(j[k]) || j[k] < 0,
    )
  )
    throw Error("여정 기록이 손상되었습니다.");
  for (const r of regions(s)) {
    const o = r.outpost;
    if (
      !o ||
      !Array.isArray(o.projects) ||
      new Set(o.projects).size !== o.projects.length ||
      o.projects.some((id) => !PROJECTS.some((p) => p.id === id)) ||
      !Array.isArray(o.plots) ||
      o.plots.length !== 2 ||
      o.plots.some(
        (p) =>
          p && (!CROPS[p.crop] || !Number.isFinite(p.ready) || p.ready < 0),
      ) ||
      (o.signal &&
        (![0, 1, 2].includes(o.signal.channel) ||
          !SIGNAL_ROUTES[o.signal.route])) ||
      !Number.isInteger(o.rounds) ||
      o.rounds < 0 ||
      !Number.isFinite(o.nextSortie) ||
      o.nextSortie < 0
    )
      throw Error("야영지 기록이 손상되었습니다.");
    const run = o.sortie;
    if (
      run &&
      (!SORTIES[run.kind] ||
        typeof run.done !== "boolean" ||
        !Array.isArray(run.visited) ||
        new Set(run.visited).size !== run.visited.length ||
        run.visited.some((n) => ![0, 1, 2].includes(n)))
    )
      throw Error("원정 기록이 손상되었습니다.");
    if (run?.kind === "hunt") {
      const b = run.boss;
      if (
        !b ||
        [
          "hp",
          "maxHP",
          "phase",
          "warning",
          "cooldown",
          "x",
          "z",
          "aimX",
          "aimZ",
        ].some((k) => !Number.isFinite(b[k])) ||
        b.hp < 0 ||
        b.hp > b.maxHP ||
        b.maxHP <= 0
      )
        throw Error("잔향 수호자 기록이 손상되었습니다.");
    }
  }
}
