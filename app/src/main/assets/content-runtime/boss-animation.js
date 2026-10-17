import * as T from '../vendor/three.module.js';

const rigs = new WeakMap(), clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (x) => { const n = clamp(x); return n * n * (3 - 2 * n); };
const pair = (prefix, x, y = 0, z = 0) => [-1, 1].map((s) => [`${prefix}_${s}`, x, y * s, z * s]);
// Authored local joint poses, radians, relative to immutable original pivots.
// Every skill has its own wind-up and impulse pose; simulation owns hit timing.
const ATTACKS = {
 root_slam: [[['torso', -.12, 0, 0], ['locomotion_fore_-1', -.6, 0, 0], ['locomotion_fore_1', -.6, 0, 0]], [['head', .35, 0, 0], ['torso', .13, 0, 0]]],
 root_charge: [[['head', .34, 0, 0], ['torso', .06, 0, 0]], [['head', .2, 0, 0], ['tail', -.2, .2, 0]]],
 root_seed: [[...pair('fungal_shelf', -.25, .08, .12), ['head', -.1, 0, 0]], [...pair('fungal_shelf', .23, -.1, -.09)]],
 root_sweep: [[['core', 0, -.24, 0], ['tail', 0, -.5, 0]], [['core', 0, .4, 0], ['tail', 0, .8, 0]]],
 mine_claw: [[...pair('claw_arm', -.6, -.18, .12)], [...pair('claw_arm', .65, .2, -.1), ...pair('claw', .25)]],
 mine_charge: [[['head', .3, 0, 0], ...pair('claw_arm', -.12, .3)], [['abdomen', .08, 0, 0], ...pair('claw_arm', .3, -.2)]],
 mine_shard: [[['dorsal_carapace', -.2, 0, 0], ['head', -.2, 0, 0]], [['dorsal_carapace', .24, 0, 0], ['head', .24, 0, 0]]],
 mine_ring: [[['abdomen', -.08, -.16, 0], ...pair('claw_arm', -.1, .4)], [['abdomen', .1, .35, 0], ...pair('claw_arm', .2, -.3)]],
 acid_spit: [[['head', -.32, 0, 0], ['core', -.12, 0, 0]], [['head', .4, 0, 0], ['core', .17, 0, 0]]],
 acid_pool: [[['head', .15, -.25, 0], ['tail_foam', -.18, 0, 0]], [['head', .35, .3, 0], ['tail_foam', .25, 0, 0]]],
 acid_tail: [[['segment_0', 0, -.22, 0], ['tail_foam', 0, -.55, 0]], [['segment_0', 0, .3, 0], ['tail_foam', 0, .7, 0]]],
 acid_glob: [[['head', -.5, 0, 0], ['core', -.18, 0, .1]], [['head', .23, 0, 0], ['core', .3, 0, -.1]]],
 furnace_breath: [[['head', -.25, 0, 0], ['dorsal_exhaust', -.15, 0, 0]], [['head', .28, 0, 0], ['dorsal_exhaust', .22, 0, 0]]],
 furnace_impact: [[['torso', -.14, 0, 0], ['locomotion_-1_front', -.45, 0, 0], ['locomotion_1_front', -.45, 0, 0]], [['torso', .16, 0, 0], ['head', .25, 0, 0]]],
 furnace_cinder: [[['shell', -.18, 0, -.05], ['dorsal_exhaust', -.3, 0, 0]], [['shell', .15, 0, .05], ['dorsal_exhaust', .4, 0, 0]]],
 furnace_ring: [[['core', -.18, 0, 0], ['shell', -.12, -.2, 0]], [['core', .2, 0, 0], ['shell', .12, .25, 0]]],
 glider_dive: [[...pair('wing_shoulder', .1, .2, -.24), ['head', .2, 0, 0]], [...pair('wing_shoulder', .25, .18, .55), ['head', .4, 0, 0], ['tail_fan', -.3, 0, 0]]],
 glider_wind: [[...pair('wing_shoulder', -.2, 0, -.45), ...pair('wing_elbow', 0, 0, -.15)], [...pair('wing_shoulder', .3, 0, .55), ...pair('wing_tip', 0, 0, .25)]],
 glider_feather: [[...pair('wing_tip', 0, -.3, -.2), ['tail_fan', -.2, 0, 0]], [...pair('wing_tip', 0, .45, .25), ['tail_fan', .25, 0, 0]]],
 glider_landing: [[...pair('wing_shoulder', -.2, 0, -.3), ...pair('locomotion', -.35)], [...pair('wing_shoulder', .25, 0, .4), ...pair('locomotion', .3), ['torso', .12, 0, 0]]],
 symbiote_root: [[['trunk', -.08, 0, 0], ...pair('host_branch', -.25, -.12, .1)], [['trunk', .1, 0, 0], ...pair('host_branch', .35, .15, -.1)]],
 symbiote_bloom: [[...pair('crown', -.18, 0, -.18), ...pair('bloom', -.3)], [...pair('crown', .2, 0, .2), ...pair('bloom', .35)]],
 symbiote_ring: [[['trunk', 0, -.17, 0], ...pair('host_branch', 0, -.25, .25)], [['trunk', 0, .24, 0], ...pair('host_branch', 0, .25, -.15)]],
 symbiote_fall: [[['upper_crook', -.3, 0, 0], ['symbiont', -.2, 0, 0], ...pair('host_branch', -.3)], [['upper_crook', .4, 0, 0], ['symbiont', .3, 0, 0], ...pair('host_branch', .4)]],
 warden_hammer: [[['hammer_arm', -1.1, -.15, -.1], ['torso', 0, -.15, 0]], [['hammer_arm', .8, .1, .1], ['hammer', .5, 0, 0], ['torso', .1, .15, 0]]],
 warden_ray: [[['shield_arm', -.4, -.2, 0], ['head', -.15, 0, 0]], [['shield_arm', .12, .2, 0], ['head', .1, 0, 0]]],
 warden_seal: [[['hammer_arm', -.65, .25, -.3], ['shield_arm', -.3, -.25, .2]], [['hammer_arm', .3, -.2, .2], ['shield_arm', .2, .15, -.1]]],
 warden_sweep: [[['torso', 0, -.35, 0], ['hammer_arm', -.2, -.5, -.25]], [['torso', 0, .5, 0], ['hammer_arm', .25, .7, .2]]],
 sentinel_rail: [[['projector', -.14, 0, 0], ['ring_side', .2, 0, 0]], [['projector', .28, 0, 0], ['ring_side', -.18, 0, 0]]],
 sentinel_arc: [[['ring_front', 0, 0, -.4], ['ring_equator', 0, -.3, 0]], [['ring_front', 0, 0, .5], ['ring_equator', 0, .4, 0]]],
 sentinel_ring: [[['ring_side', -.35, 0, 0], ['ring_equator', 0, -.4, 0]], [['ring_side', .45, 0, 0], ['ring_equator', 0, .5, 0]]],
 sentinel_collapse: [[['projector', -.3, 0, 0], ['ring_front', 0, 0, -.3], ['ring_side', -.3, 0, 0]], [['projector', .4, 0, 0], ['ring_front', 0, 0, .45], ['ring_side', .45, 0, 0]]],
};

/** Logical hit region follows the real articulated ancestry, not an ID regex alone. */
export function bossLogicalPart(asset, partId) {
  let part = asset.parts.find((p) => p.id === partId);
  while (part) {
    if (part.id.startsWith('locomotion')) return 'locomotion';
    if (part.id === 'core') return 'core';
    part = asset.parts.find((p) => p.id === part.parent);
  }
  return 'body';
}
function rigFor(record) {
  let rig = rigs.get(record); if (rig) return rig;
  const poses = new Map(), feet = [];
  for (const part of record.asset.parts) {
    const node = record.parts.get(part.id); if (!node) continue;
    poses.set(part.id, { node, translation: new T.Vector3(...part.translation), logicalPart: bossLogicalPart(record.asset, part.id) });
  }
  for (const anchor of record.asset.anchors ?? []) if (anchor.purpose === 'movement_contact') feet.push(anchor);
  rig = { poses, feet, position: null, deathAt: null }; rigs.set(record, rig); return rig;
}

/** Mutates only instance nodes. Original asset, combat state, damage volumes and
 * world root are never modified. Physics reads these same part matrixWorlds. */
export function animateBossModel(record, entity, system, time = 0, dt = 0) {
  if (!record?.parts || !entity || !Number.isFinite(time) || !Number.isFinite(dt)) return null;
  const rig = rigFor(record), wallTime = time;
  if (entity.defeated) { rig.deathAt ??= time; time = rig.deathAt; } else rig.deathAt = null;
  const def = system.definitionFor(entity), phase = system.phase(entity), state = phase.state;
  const p = entity.position, previous = rig.position;
  const speed = previous && dt > 0 ? Math.hypot(p.x - previous.x, p.y - previous.y, p.z - previous.z) / dt : 0;
  rig.position = { ...p };
  const moving = clamp(speed / Math.max(.1, def.stats.moveSpeedMps ?? 3)), brokenCore = !!entity.parts.core.broken, brokenLegs = !!entity.parts.locomotion.broken;
  const gait = Math.sin(time * (4 + moving * 3)), pulse = Math.sin(time * 1.8), phaseIndex = entity.phaseIndex;
  for (const [id, pose] of rig.poses) {
    pose.node.position.copy(pose.translation); pose.node.rotation.set(0, 0, 0); pose.node.scale.set(1, 1, 1);
    pose.node.visible = !(record.desc?.removedParts ?? []).includes(id);
    pose.node.userData.logicalBossPart = pose.logicalPart;
    pose.node.userData.bossBroken = pose.logicalPart === 'core' ? brokenCore : pose.logicalPart === 'locomotion' ? brokenLegs : false;
  }
  const rotate = (id, x = 0, y = 0, z = 0) => { const n = record.parts.get(id); if (n) { n.rotation.x += x; n.rotation.y += y; n.rotation.z += z; } };
  const paired = (id, x = 0, y = 0, z = 0) => { for (const s of [-1, 1]) rotate(`${id}_${s}`, x, y * s, z * s); };
  const exposed = system.coreExposed(entity);
  for (const [id, pose] of rig.poses) if (id.startsWith('locomotion')) {
    const side = /(?:^|_)\-1(?:_|$)/.test(id) ? -1 : 1;
    const alternate = /hind|back|_1$|shin/.test(id) ? -1 : 1;
    rotate(id, gait * moving * .2 * side * alternate * (brokenLegs ? .2 : 1), 0, brokenLegs ? side * .12 : 0);
  }
  switch (entity.bossId) {
    case 'rootback_beast':
      rotate('head', pulse * .025); rotate('tail', 0, Math.sin(time * 1.3) * .12);
      rotate('back_sapling', .03 * pulse, 0, phaseIndex === 2 ? .25 : -.03 * phaseIndex);
      rotate('torso', phaseIndex === 2 ? .045 : pulse * .008); paired('fungal_shelf', phaseIndex * .04, 0, exposed ? .1 : 0); break;
    case 'mine_carapace':
      paired('claw_arm', pulse * .035, phaseIndex === 1 ? .15 : .02, phaseIndex === 2 ? .2 : 0);
      rotate('dorsal_carapace', exposed ? -.18 : -.02 * phaseIndex); rotate('head', .018 * pulse); break;
    case 'sluice_acidworm':
      for (let i = 0; i < 9; i++) rotate(`segment_${i}`, Math.sin(time * 1.8 - i * .7) * .008,
        Math.sin(time * (1 + moving * 2) - i * .7) * (.007 + moving * .025), phaseIndex === 2 ? .008 * Math.sin(i) : 0);
      rotate('head', -.04 * phaseIndex + pulse * .02); rotate('tail_foam', phaseIndex === 1 ? -.12 : .03 * pulse); break;
    case 'furnace_carapace':
      rotate('shell', exposed ? -.15 : -.025 * phaseIndex); rotate('dorsal_exhaust', -.06 * phaseIndex + pulse * .03);
      rotate('tail', 0, .08 * Math.sin(time)); rotate('head', phaseIndex === 2 ? .1 : .025 * pulse); break;
    case 'spire_glider': {
      const flying = entity.flightState !== 'grounded', flap = Math.sin(time * (phaseIndex === 1 ? 5 : 3.5));
      paired('wing_shoulder', flying ? .04 : .1, 0, flying ? flap * .2 : .35 - phaseIndex * .06);
      paired('wing_elbow', 0, 0, flying ? flap * .1 : .25); paired('wing_tip', 0, .02 * pulse, flying ? -flap * .06 : .15);
      paired('locomotion', flying ? -.4 : 0); rotate('tail_fan', flying ? .07 * pulse : .1);
      if (phaseIndex === 2) rotate('wing_shoulder_1', .12, 0, .16); break;
    }
    case 'arboretum_symbiote':
      paired('host_branch', .025 * pulse, 0, phaseIndex === 1 ? -.22 : phaseIndex === 2 ? .18 : -.04);
      paired('crown', .02 * pulse, .02 * pulse, phaseIndex === 2 ? .15 : 0); paired('bloom', .06 * pulse);
      rotate('symbiont', .03 * Math.sin(time * 2), .03 * pulse); rotate('upper_crook', phaseIndex * .05); break;
    case 'sanctuary_warden':
      rotate('shield_arm', -.12, (120 - (state.shieldFrontCoverageDeg ?? 0)) / 120 * -.6, -.03);
      rotate('hammer_arm', .025 * pulse, 0, phaseIndex === 2 ? -.15 : 0); rotate('mantle', .035 * pulse);
      if (entity.action?.kind === 'repair') { rotate('torso', .12); rotate('head', .25); rotate('hammer_arm', .25, -.3); } break;
    case 'observatory_sentinel': {
      const spin = brokenCore ? 0 : time * [ .3, .65, .18 ][phaseIndex];
      rotate('ring_side', spin); rotate('ring_equator', 0, -spin * .8); rotate('ring_front', 0, 0, spin * .6);
      rotate('projector', exposed ? .12 : .02 * pulse); break;
    }
  }
  const cast = entity.cast, skill = cast && def.skills.find((s) => s.id === cast.skillId), attack = cast && ATTACKS[cast.skillId];
  let stageProgress = 0;
  if (attack && skill && !entity.defeated) {
    const duration = cast.stage === 'windup' ? cast.windupS : cast.stage === 'active' ? skill.activeS : skill.recoveryS;
    stageProgress = clamp(1 - cast.remaining / Math.max(.001, duration));
    const warning = cast.stage === 'windup' ? smooth(stageProgress) : cast.stage === 'active' ? 1 - smooth(stageProgress) : 0;
    const impact = cast.stage === 'active' ? Math.sin(Math.PI * stageProgress) : cast.stage === 'flight' ? .3 : cast.stage === 'recovery' ? -.15 * (1 - smooth(stageProgress)) : 0;
    for (const [id, x, y, z] of attack[0]) rotate(id, x * warning, y * warning, z * warning);
    for (const [id, x, y, z] of attack[1]) rotate(id, x * impact, y * impact, z * impact);
  }
  if (brokenCore) { rotate('core', .12, 0, .16); if (entity.bossId === 'spire_glider') paired('wing_elbow', .1, 0, .35); }
  if (entity.staggerS > 0) rotate('root', .045, 0, Math.sin(time * 12) * .035);
  if (entity.defeated) {
    rig.deathAt ??= time;
    const elapsed = Number.isFinite(entity.defeatedAt) ? Math.max(0, system.time - entity.defeatedAt) : wallTime - rig.deathAt;
    const fall = smooth(elapsed / 1.5);
    // Keep attached anatomy on its authored pivots; the full visible fallen body
    // remains a physical obstacle while the runtime retains the corpse instance.
    rotate('root', .15 * fall, 0, .9 * fall);
    for (const [id, pose] of rig.poses) if (id.startsWith('locomotion')) rotate(id, .3 * fall);
  } else rig.deathAt = null;
  record.group.updateMatrixWorld(true);
  // Movement contact anchors prevent gait/lean from driving feet below the
  // simulation origin. No inverse-kinematics or game position is fabricated.
  const root = record.parts.get('root'), inverse = record.group.matrixWorld.clone().invert(); let lowest = 0;
  for (const anchor of rig.feet) {
    const node = record.parts.get(anchor.partId); if (!node?.visible) continue;
    const point = new T.Vector3(...anchor.position).applyMatrix4(node.matrixWorld).applyMatrix4(inverse); lowest = Math.min(lowest, point.y);
  }
  if (entity.defeated) for (const part of record.asset.parts) {
    const node = record.parts.get(part.id); if (!node?.visible) continue;
    const m = new T.Matrix4().multiplyMatrices(inverse, node.matrixWorld).elements;
    for (const box of part.boxes) {
      const centerY = m[1] * box.center[0] + m[5] * box.center[1] + m[9] * box.center[2] + m[13];
      const halfY = (Math.abs(m[1]) * box.size[0] + Math.abs(m[5]) * box.size[1] + Math.abs(m[9]) * box.size[2]) / 2;
      lowest = Math.min(lowest, centerY - halfY);
    }
  }
  if (root && lowest < 0) { root.position.y -= lowest; record.group.updateMatrixWorld(true); }
  const result = { bossId: entity.bossId, phaseId: phase.id, stage: entity.defeated ? 'dead' : cast?.stage ?? (moving > .03 ? 'moving' : 'idle'),
    skillId: cast?.skillId ?? null, stageProgress, speed, brokenCore, brokenLocomotion: brokenLegs };
  record.group.userData.bossAnimation = result;
  return result;
}
