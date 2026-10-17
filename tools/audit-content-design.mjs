import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MATERIALS } from "../design/content/catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["blocks", "environments", "creatures", "structures", "bosses", "progression"];

// This checks proposed content data, not runtime implementation or play balance.
export function auditDesign(directory = path.join(root, "design/content")) {
  const errors = [], counts = {}, data = {};
  const check = (condition, message) => { if (!condition) errors.push(message); };
  for (const name of files) {
    try { data[name] = JSON.parse(fs.readFileSync(path.join(directory, `${name}.json`), "utf8")); }
    catch (error) { errors.push(`${name}: cannot read JSON (${error.code || error.name})`); continue; }
    const document = data[name];
    check(document.schemaVersion === 1 && document.status === "proposed", `${name}: wrong schema or proposal status`);
    if (!Array.isArray(document.entries)) { errors.push(`${name}: entries must be an array`); continue; }
    counts[name] = document.entries.length;
    const seen = new Set();
    for (const entry of document.entries) {
      check(typeof entry?.id === "string" && entry.id.length > 0 && !seen.has(entry.id), `${name}: missing or duplicate ID ${entry?.id}`);
      check(typeof entry?.name === "string" && entry.name.length > 0, `${name}:${entry?.id}: missing name`);
      seen.add(entry?.id);
    }
  }
  if (errors.length) return { scope: "proposed_data", valid: false, counts, errors };
  const entries = (name) => data[name].entries;
  const ids = (name) => new Set(entries(name).map((e) => e.id));
  const blockIds = ids("blocks"), speciesIds = ids("creatures"), structureIds = ids("structures");
  const environmentIds = ids("environments"), bossIds = ids("bosses");
  const energyIds = new Set(["mechanical", "electrical", "thermal", "chemical", "magic", "divine"]);
  const progression = new Map(entries("progression").map((e) => [e.id, e]));
  const creature = new Map(entries("creatures").map((e) => [e.id, e]));
  const structures = new Map(entries("structures").map((e) => [e.id, e]));
  const itemKinds = new Set(["item", "material", "station", "tool", "component", "gear_baseline"]);
  const isItem = (id) => itemKinds.has(progression.get(id)?.kind);
  const positiveMap = (values, label, isKnown = isItem) => {
    for (const [id, amount] of Object.entries(values || {})) {
      check(isKnown(id), `${label}: unknown reference ${id}`);
      check(Number.isFinite(amount) && amount > 0, `${label}: invalid quantity for ${id}`);
    }
  };
  const range = (value, min, max, label) => check(Number.isFinite(value) && value >= min && value <= max, label);
  const ordered = (values, label) => check(Array.isArray(values) && values.length === 2 && values.every(Number.isFinite) && values[0] <= values[1], label);
  for (const material of Object.values(MATERIALS)) {
    const proposed = progression.get(material.id);
    check(proposed?.kind === "material" && proposed.name === material.name && proposed.tier === material.tier && proposed.field === material.field, `${material.id}: confirmed material identity/tier/field changed`);
  }
  for (const b of entries("blocks")) {
    range(b.cellSizeM, 0.001, 100, `${b.id}: invalid cell size`);
    range(b.densityKgM3, 0, 1e9, `${b.id}: invalid density`);
    check(Math.abs(b.massPerCellKg - b.densityKgM3 * b.cellSizeM ** 3) <= 1e-6, `${b.id}: mass does not match density and cell volume`);
    for (const key of ["acidResistance", "friction", "opacity", "cohesionIndex", "thermalConductivityIndex"]) range(b[key], 0, 1, `${b.id}: invalid ${key}`);
    check(Array.isArray(b.functionsGranted) && b.functionsGranted.length === 0, `${b.id}: raw geometry cannot grant component functionality`);
    if (b.materialId) check(progression.get(b.materialId)?.kind === "material", `${b.id}: unknown material ${b.materialId}`);
    if (b.rawResourceId) check(isItem(b.rawResourceId), `${b.id}: unknown raw resource ${b.rawResourceId}`);
  }
  for (const e of entries("environments")) {
    for (const key of ["surfaceBlockId", "subsoilBlockId", "bedrockBlockId"]) {
      const id = e.terrain?.[key];
      if (id !== null && id !== undefined) check(blockIds.has(id), `${e.id}: unknown terrain block ${id}`);
    }
    for (const id of e.decoration?.blockIds || []) check(blockIds.has(id), `${e.id}: unknown decoration block ${id}`);
    for (const vein of e.oreVeins || []) {
      check(blockIds.has(vein.blockId), `${e.id}: unknown ore ${vein.blockId}`);
      ordered(vein.depthBelowSurfaceM, `${e.id}: invalid ore depth`);
      ordered(vein.veinCellCount, `${e.id}: invalid vein size`);
    }
    check(structureIds.has(e.building?.dungeonId), `${e.id}: unknown dungeon ${e.building?.dungeonId}`);
    for (const rule of e.spawning?.rules || []) {
      check(speciesIds.has(rule.speciesId), `${e.id}: unknown species ${rule.speciesId}`);
      ordered(rule.groupSize, `${e.id}:${rule.speciesId}: invalid group size`);
      check(rule.capPerEcologyCell >= rule.groupSize?.[1], `${e.id}:${rule.speciesId}: group exceeds species cap`);
    }
  }
  for (const node of data.environments.world.harvestNodes || []) {
    const source = progression.get(node.sourceId);
    check(source?.kind === "source" && source.outputs?.[node.resourceId] > 0, `${node.id}: harvest source does not supply declared resource`);
  }
  const ecologyResources = new Set((data.creatures.contracts.ecologyResources || []).map((e) => e.id));
  for (const c of entries("creatures")) {
    check(["organic", "inorganic"].includes(c.entityType), `${c.id}: invalid living entity type`);
    check(c.origin === "world_life", `${c.id}: player assembly cannot create life`);
    range(c.stats?.maxHp, 1, 1e9, `${c.id}: invalid HP`);
    range(c.body?.massKg, 0.001, 1e12, `${c.id}: invalid mass`);
    if (c.entityType === "organic") {
      check(c.calories !== null && c.calories?.maxCp > 0, `${c.id}: organic life needs calories`);
      range(c.calories?.regenCpPerHp, 0.001, 1e9, `${c.id}: recovery must consume calories`);
    } else {
      check(c.calories === null && c.repair?.naturalRecovery === false, `${c.id}: inorganic life cannot have calorie recovery`);
      check(isItem(c.repair?.materialId), `${c.id}: unknown repair material`);
    }
    check(Object.hasOwn(data.creatures.bodyProfiles, c.body?.profile), `${c.id}: unknown body profile`);
    for (const id of c.ecology?.environmentIds || []) check(environmentIds.has(id), `${c.id}: unknown habitat ${id}`);
    for (const id of c.ecology?.dungeonIds || []) check(structureIds.has(id), `${c.id}: unknown dungeon ${id}`);
    for (const food of c.ecology?.diet || []) {
      if (food.kind === "producer") check(blockIds.has(food.id), `${c.id}: unknown producer ${food.id}`);
      if (food.kind === "species") check(speciesIds.has(food.id), `${c.id}: unknown prey ${food.id}`);
      if (food.kind === "item") check(isItem(food.id), `${c.id}: unknown diet item ${food.id}`);
      if (food.kind === "resource") check(ecologyResources.has(food.id), `${c.id}: unknown ecology resource ${food.id}`);
    }
    for (const override of c.ecology?.dungeonDietOverrides || []) {
      const producers = structures.get(override.dungeonId)?.ecology?.producers || [];
      for (const food of override.diet) if (food.kind === "dungeon_producer") check(producers.some((p) => p.id === food.id), `${c.id}: unknown dungeon producer ${food.id}`);
    }
    for (const drop of c.drops || []) {
      check(isItem(drop.itemId), `${c.id}: unknown drop ${drop.itemId}`);
      check(Number.isInteger(drop.min) && Number.isInteger(drop.max) && drop.min >= 0 && drop.min <= drop.max, `${c.id}: invalid drop range`);
    }
    for (const attack of c.attacks || []) {
      check(energyIds.has(attack.energyType), `${attack.id}: unknown energy`);
      for (const key of ["damageHp", "rangeM", "windupS", "recoveryS", "cooldownS"]) range(attack[key], 0, 1e6, `${attack.id}: invalid ${key}`);
    }
  }
  const inside = (point, room) => Array.isArray(point) && point.length === 3 && point.every((n, axis) => n >= room.minM[axis] - 1e-6 && n <= room.maxM[axis] + 1e-6);
  for (const s of entries("structures")) {
    check(environmentIds.has(s.environmentId), `${s.id}: unknown environment`);
    for (const id of s.palette) check(blockIds.has(id), `${s.id}: unknown palette block ${id}`);
    const rooms = new Map(s.rooms.map((room) => [room.id, room]));
    check(rooms.size === s.rooms.length, `${s.id}: duplicate room IDs`);
    let initialPopulation = 0;
    for (const r of s.rooms) {
      check(r.minM.every((value, axis) => r.maxM[axis] - value === r.clearSizeM[axis]), `${s.id}:${r.id}: inconsistent room bounds`);
      for (const [axis, footprintAxis] of [[0, 0], [2, 1]]) check(r.minM[axis] >= s.footprintM.min[footprintAxis] && r.maxM[axis] <= s.footprintM.max[footprintAxis], `${s.id}:${r.id}: room outside footprint`);
      let localInitial = 0, localMax = 0;
      for (const spawn of r.spawnGroups || []) {
        check(speciesIds.has(spawn.speciesId), `${s.id}:${r.id}: unknown spawn species ${spawn.speciesId}`);
        check(inside(spawn.anchorM, r), `${s.id}:${r.id}: spawn anchor outside room`);
        check(spawn.initialCount >= 0 && spawn.initialCount <= spawn.maxCount, `${s.id}:${r.id}: spawn exceeds cap`);
        localInitial += spawn.initialCount;
        localMax += spawn.maxCount;
      }
      initialPopulation += localInitial;
      check(localMax <= r.maxPopulation, `${s.id}:${r.id}: group caps exceed room population cap`);
    }
    const graph = new Map(s.rooms.map((room) => [room.id, []]));
    for (const edge of s.connections) {
      check(rooms.has(edge.from) && rooms.has(edge.to), `${s.id}:${edge.id}: unknown endpoint`);
      if (!rooms.has(edge.from) || !rooms.has(edge.to)) continue;
      graph.get(edge.from).push(edge.to);
      if (edge.bidirectional) graph.get(edge.to).push(edge.from);
      check(inside(edge.centerlineM[0], rooms.get(edge.from)), `${s.id}:${edge.id}: corridor does not start at source room`);
      check(inside(edge.centerlineM.at(-1), rooms.get(edge.to)), `${s.id}:${edge.id}: corridor does not end at target room`);
      range(edge.clearWidthM, 0.5, 100, `${s.id}:${edge.id}: invalid corridor width`);
    }
    const reached = new Set(), queue = s.entrances.map((entry) => entry.roomId);
    for (const entrance of s.entrances) {
      check(rooms.has(entrance.roomId), `${s.id}: entrance to unknown room`);
      if (rooms.has(entrance.roomId)) check(inside(entrance.positionM, rooms.get(entrance.roomId)), `${s.id}:${entrance.id}: entrance outside room`);
    }
    while (queue.length) {
      const id = queue.pop();
      if (reached.has(id)) continue;
      reached.add(id);
      queue.push(...(graph.get(id) || []));
    }
    for (const id of rooms.keys()) check(reached.has(id), `${s.id}:${id}: room disconnected from entrances`);
    if (s.exteriorBypass) {
      const half = s.exteriorBypass.widthM / 2;
      for (const point of s.exteriorBypass.pathM) for (const [axis, a] of [[0, 0], [2, 1]]) check(point[axis] - half >= s.footprintM.min[a] && point[axis] + half <= s.footprintM.max[a], `${s.id}: exterior bypass exceeds reserved footprint`);
    }
    for (const reward of s.rewardAnchors || []) {
      const pool = progression.get(reward.rewardPoolId);
      check(pool?.kind === "reward_pool" && pool.dungeon === s.id && Object.hasOwn(pool.channels, reward.channel), `${s.id}:${reward.id}: invalid reward pool/channel`);
      check(rooms.has(reward.roomId) && inside(reward.positionM, rooms.get(reward.roomId)), `${s.id}:${reward.id}: reward outside room`);
    }
    if (s.kind === "dungeon") {
      check(bossIds.has(s.bossArena?.bossId), `${s.id}: unknown boss`);
      check(initialPopulation <= s.ecology.populationMaxExcludingBoss, `${s.id}: initial population exceeds dungeon cap`);
      if (s.ecology.water) {
        const water = s.ecology.water;
        check(Math.abs(water.volumeL - water.basinSizeM.reduce((a, b) => a * b, 1000)) < 1e-6, `${s.id}: water volume mismatch`);
      }
      const basal = s.rooms.flatMap((r) => r.spawnGroups || []).reduce((sum, spawn) => sum + (creature.get(spawn.speciesId)?.calories?.basalCpPerS || 0) * 3600 * spawn.initialCount, 0);
      check(Math.abs(basal - s.ecology.basalDemandCpPerHour) < 0.01, `${s.id}: basal calorie budget mismatch`);
      const supply = s.ecology.producers.reduce((sum, producer) => sum + producer.foodUnitsPerHour, 0) * s.ecology.foodUnitCp;
      check(supply >= basal * s.ecology.producerBudgetMultiplier, `${s.id}: primary food supply below proposed baseline demand`);
    }
  }
  for (const b of entries("bosses")) {
    const s = structures.get(b.dungeonId), gear = progression.get(b.baselineRef);
    check(s?.bossArena?.bossId === b.id, `${b.id}: dungeon boss reference mismatch`);
    check(s?.environmentId === b.environmentId, `${b.id}: environment mismatch`);
    check(s?.prototypeTier === b.baselineTier, `${b.id}: dungeon and boss tiers differ`);
    check(gear?.kind === "gear_baseline" && gear.tier === b.baselineTier, `${b.id}: invalid combat baseline`);
    if (!gear || !s) continue;
    check(b.balanceTarget.effectiveSoloDps === gear.sustainedDps, `${b.id}: baseline DPS mismatch`);
    check(Math.abs(b.stats.maxHp / gear.sustainedDps - b.balanceTarget.soloTtkS) < 0.01, `${b.id}: TTK calculation mismatch`);
    const arena = s.rooms.find((r) => r.id === s.bossArena.roomId);
    check(arena && arena.clearSizeM[0] === b.arena.widthM && arena.clearSizeM[2] === b.arena.depthM && arena.clearSizeM[1] === b.arena.heightM, `${b.id}: boss arena dimensions mismatch`);
    const skills = new Set(b.skills.map((skill) => skill.id));
    let upper = 1;
    for (const phase of b.phases) {
      check(phase.hpFractionUpperInclusive === upper && phase.hpFractionLowerExclusive < upper, `${phase.id}: phase interval gap or overlap`);
      upper = phase.hpFractionLowerExclusive;
      for (const id of phase.schedule) check(skills.has(id), `${phase.id}: unknown skill ${id}`);
      const exposure = phase.state?.coreExposure;
      if (exposure?.mode === "after_skill") check(exposure.skillIds.length > 0 && exposure.skillIds.every((id) => phase.schedule.includes(id)), `${phase.id}: weakness trigger absent from phase schedule`);
      const movementMultiplier = phase.state?.northWaterPlayerSpeedMultiplier ?? 1;
      for (const id of phase.schedule) {
        const skill = b.skills.find((entry) => entry.id === id);
        if (!skill) continue;
        const escape = skill.escapeCheck;
        check(skill.windupS >= escape.reactionAllowanceS + escape.worstSafeDistanceM / (3.2 * movementMultiplier), `${phase.id}:${id}: environment slowdown prevents declared escape`);
      }
    }
    check(upper === 0, `${b.id}: phases do not cover all living HP`);
    for (const skill of b.skills) {
      check(energyIds.has(skill.energyType), `${skill.id}: invalid energy`);
      check(b.energyReserves.some((reserve) => reserve.energyType === skill.energyType), `${skill.id}: no energy reserve`);
      for (const key of ["windupS", "activeS", "recoveryS", "cooldownS", "rangeM"]) range(skill[key], 0, 1e6, `${skill.id}: invalid ${key}`);
      const escape = skill.escapeCheck;
      check(Math.abs(escape.walkRequiredS - (escape.reactionAllowanceS + escape.worstSafeDistanceM / 3.2)) < 0.001, `${skill.id}: walking escape calculation mismatch`);
      check(skill.windupS >= escape.walkRequiredS, `${skill.id}: insufficient telegraph for declared escape`);
      check(Math.abs(skill.damage.baselinePlayerHpLost - skill.damage.neutralTargetHp * gear.incomingDamageMultiplier) < 0.01, `${skill.id}: target mitigation mismatch`);
    }
    check(progression.get(b.persistence.rewardRef)?.kind === "reward_pool", `${b.id}: missing reward pool`);
  }
  for (const p of entries("progression")) {
    for (const key of ["inputs", "outputs", "samples"]) positiveMap(p[key], `${p.id}:${key}`);
    if (p.kind === "recipe") {
      check(p.station === "hand" || progression.get(p.station)?.kind === "station", `${p.id}: unknown station`);
      check(p.research === null || progression.get(p.research)?.kind === "research", `${p.id}: unknown research`);
      positiveMap(p.energy, `${p.id}:energy`, (id) => energyIds.has(id));
      if (p.massBalance?.mode === "assembly_preserves_inputs") {
        check(typeof p.massBalance.rule === "string" && Object.keys(p.outputs).length === 1, `${p.id}: assembly mass needs an unambiguous output ledger`);
      } else if (p.massBalance) {
        const mass = (values) => Object.entries(values).reduce((sum, [id, count]) => {
          const item = progression.get(id);
          const perUnit = item?.kind === "material" ? item.properties.densityKgM3 / 1000 : item?.massKgPerUnit;
          return sum + count * perUnit;
        }, 0);
        const input = mass(p.inputs), output = mass(p.outputs), budget = p.massBalance;
        check(Number.isFinite(input) && Number.isFinite(output), `${p.id}: missing mass metadata`);
        check(Math.abs(input - budget.inputKg) < 0.001 && Math.abs(output - budget.productKg) < 0.001, `${p.id}: stale input/product mass budget`);
        check(budget.processWasteKg >= 0 && Math.abs(input - output - budget.processWasteKg) < 0.001, `${p.id}: mass is created or lost outside declared waste`);
      }
    }
    if (p.kind === "research") {
      check(p.station === "hand" || progression.get(p.station)?.kind === "station", `${p.id}: unknown research station`);
      for (const id of p.prerequisites) check(progression.get(id)?.kind === "research", `${p.id}: unknown prerequisite ${id}`);
      check(isItem(p.blueprint), `${p.id}: unknown blueprint`);
      range(p.work, 0.001, 1e12, `${p.id}: invalid research work`);
    }
    if (p.kind === "reward_pool") {
      check(structureIds.has(p.dungeon), `${p.id}: unknown reward dungeon`);
      for (const channel of Object.values(p.channels)) positiveMap(channel.guaranteed, `${p.id}:reward`);
    }
  }
  // Availability closure includes tools, stations and energies, excludes all discovery rewards.
  // It proves bootstrap reachability, not quantitative conservation or completion time.
  const available = new Set(), known = new Set(), energies = new Set(), activities = new Set();
  const allItems = (values) => Object.keys(values || {}).every((id) => available.has(id));
  const stationReady = (id) => id === "hand" || available.has(id);
  const add = (set, id) => { if (set.has(id)) return false; set.add(id); return true; };
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of entries("progression")) {
      if (p.kind === "source" && !p.discoveryRequired && (!p.requiredTool || available.has(p.requiredTool))) {
        for (const id of Object.keys(p.outputs)) changed = add(available, id) || changed;
      } else if (p.kind === "research" && allItems(p.samples) && stationReady(p.station) && p.prerequisites.every((id) => known.has(id))) {
        changed = add(known, p.id) || changed;
      } else if (p.kind === "recipe" && allItems(p.inputs) && stationReady(p.station) && (!p.research || known.has(p.research)) && Object.keys(p.energy).every((id) => energies.has(id))) {
        for (const id of Object.keys(p.outputs)) changed = add(available, id) || changed;
      } else if (p.kind === "activity" && allItems(p.inputs) && p.origin?.uniqueDiscoveryRequired === false) {
        changed = add(activities, p.id) || changed;
      } else if (p.kind === "energy_source" && allItems(p.inputs) && (!p.requiredComponent || available.has(p.requiredComponent)) && (!p.activity || activities.has(p.activity))) {
        changed = add(energies, p.energy) || changed;
      } else if (p.kind === "conversion" && available.has(p.component) && energies.has(p.input)) {
        range(p.efficiency, 0.0001, 1, `${p.id}: invalid conversion efficiency`);
        changed = add(energies, p.output) || changed;
      }
    }
  }
  for (const p of entries("progression")) {
    if (itemKinds.has(p.kind)) check(available.has(p.id), `${p.id}: unavailable without discovery`);
    if (p.kind === "research") check(known.has(p.id), `${p.id}: self-research cannot bootstrap`);
    if (p.kind === "recipe") check(allItems(p.inputs) && stationReady(p.station) && (!p.research || known.has(p.research)) && Object.keys(p.energy).every((id) => energies.has(id)), `${p.id}: recipe cannot execute without discovery`);
  }
  for (const id of energyIds) check(energies.has(id), `${id}: energy cannot bootstrap`);
  return { scope: "proposed_data", valid: errors.length === 0, counts,
    reachability: { items: available.size, research: known.size, energies: energies.size, excludesDiscoveryRewards: true },
    errors: [...new Set(errors)] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = auditDesign(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.valid ? 0 : 1;
}
