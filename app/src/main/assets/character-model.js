// Original FERAL characters. Modelling grid: 1/32 metre; silhouettes and surface details are separate.
export const PIXEL = 1 / 32;
export const CHARACTER_ROLES = [
  "explorer",
  "quartermaster",
  "herbalist",
  "mechanic",
];
export const PORTRAIT_ACTIONS = [
  "idle",
  "walk",
  "run",
  "crouch",
  "crawl",
  "wave",
];
export const ACTION_NAMES = {
  idle: "대기",
  walk: "걷기",
  run: "달리기",
  crouch: "웅크리기",
  crawl: "기어가기",
  wave: "인사",
};
const palettes = {
  explorer: {
    coat: 0x437c78,
    trim: 0xd8b878,
    pants: 0x394e5d,
    leather: 0x76523c,
    hair: 0x49392f,
  },
  quartermaster: {
    coat: 0x8e794d,
    trim: 0xe2cf97,
    pants: 0x49564b,
    leather: 0x70513c,
    hair: 0x64513f,
  },
  herbalist: {
    coat: 0x6c8b79,
    trim: 0xd6dec2,
    pants: 0x485c58,
    leather: 0x78604c,
    hair: 0x3f3535,
  },
  mechanic: {
    coat: 0x536979,
    trim: 0xd79b57,
    pants: 0x4a4d52,
    leather: 0x77513a,
    hair: 0x78513a,
  },
};
export function characterModel(
  role = "explorer",
  variant = 0,
  armored = false,
) {
  const p = palettes[role] || palettes.explorer,
    skin = [0xc99975, 0xa97958, 0xd5ae86][Math.abs(variant) % 3];
  const bones = [];
  const bone = (id, parent, pivot) => {
    const b = { id, parent, pivot: pivot.map((v) => v * PIXEL), boxes: [] };
    bones.push(b);
    return b;
  };
  const box = (b, at, size, color, texture = "cloth") =>
    b.boxes.push({
      at: at.map((v) => v * PIXEL),
      size: size.map((v) => v * PIXEL),
      color,
      texture,
    });
  const root = bone("root", null, [0, 0, 0]);
  const torso = bone("torso", "root", [0, 22, 0]);
  box(torso, [0, 7, 0], [14, 15, 8], p.coat);
  box(torso, [0, 1, 0], [15, 2, 9], p.leather, "leather");
  box(torso, [0, 1, 5], [3, 2, 1], p.trim, "metal");
  box(torso, [0, 8, 4.5], [1, 12, 1], p.trim, "seam");
  for (const side of [-1, 1]) {
    box(torso, [side * 4, 13, 4.5], [3, 2, 1], p.trim, "seam");
    box(
      torso,
      [side * 4, 6, 4.5],
      [4, 4, 1],
      side === 1 ? p.leather : p.coat,
      "pocket",
    );
    box(torso, [side * 4, 8.5, 5], [4, 1, 1], p.trim, "seam");
  }
  if (role === "explorer" || role === "quartermaster") {
    box(torso, [0, 6, -6], [11, 11, 5], p.leather, "pocket");
    box(torso, [0, 12, -6], [12, 2, 6], p.trim, "cloth");
    for (const x of [-4, 4])
      box(torso, [x, 8, 5], [1, 13, 1], p.leather, "leather");
    box(torso, [0, 14, 3], [13, 3, 10], 0xa94f42, "cloth");
    box(torso, [-5, 10, 6], [3, 6, 1], 0xb5624c, "seam");
  }
  if (role === "herbalist") {
    box(torso, [0, 4, 5], [10, 13, 1], p.trim, "pocket");
    box(torso, [-7, 3, 0], [3, 7, 7], p.leather, "leather");
    for (let i = 0; i < 3; i++)
      box(torso, [-8 + i, 8, -1 + i], [1, 4, 1], 0x92ae72, "leaf");
  }
  if (role === "mechanic") {
    box(torso, [0, 5, 5], [11, 11, 1], p.leather, "pocket");
    box(torso, [6, 0, 5], [2, 6, 2], 0xb3c6bf, "metal");
    box(torso, [-5, 0, 5], [3, 4, 2], p.trim, "metal");
  }
  if (armored) {
    box(torso, [0, 8, 5], [13, 12, 2], 0xa2b7b5, "plate");
    box(torso, [0, 8, 6.5], [2, 10, 1], p.trim, "metal");
    for (const side of [-1, 1])
      box(torso, [side * 8, 13, 0], [5, 5, 10], 0x7d9496, "plate");
  }
  const head = bone("head", "torso", [0, 15, 0]);
  box(head, [0, 6, 0], [12, 12, 11], skin, "skin");
  box(head, [0, 12, 0], [13, 3, 12], p.hair, "hair");
  box(head, [0, 8, -5.5], [13, 8, 2], p.hair, "hair");
  box(head, [-4, 10, 5.5], [5, 3, 1], p.hair, "hair");
  box(head, [4, 11, 5.5], [3, 2, 1], p.hair, "hair");
  box(head, [0, 4, 6], [2, 3, 2], skin, "skin");
  for (const side of [-1, 1]) {
    box(head, [side * 6.5, 5, 0], [1, 4, 3], skin, "skin");
    box(head, [side * 4, 3, 5.6], [2, 1, 1], 0xb97f64, "plain");
    const eye = bone(side < 0 ? "eyeL" : "eyeR", "head", [side * 3, 6, 5.65]);
    box(eye, [0, 0, 0], [3, 2, 1], 0xf3e6c9, "plain");
    box(eye, [-side * 0.35, 0, 0.6], [1, 2, 1], 0x304b47, "plain");
    const brow = bone(side < 0 ? "browL" : "browR", "head", [side * 3, 8, 6]);
    box(brow, [0, 0, 0], [3, 1, 1], p.hair, "plain");
  }
  const mouth = bone("mouth", "head", [0, 1.5, 5.7]);
  box(mouth, [0, 0, 0], [3, 1, 1], 0x714a3d, "plain");
  if (role === "quartermaster") {
    box(head, [0, 13, 0], [17, 1, 16], p.trim, "cloth");
    box(head, [0, 15, -1], [13, 4, 11], p.coat, "cloth");
    box(head, [0, 14, 5], [13, 1, 1], p.leather, "leather");
    box(head, [0, 3, 6.5], [6, 1, 1], 0x756654, "hair");
    for (const side of [-1, 1])
      box(head, [side * 5.5, 9, 4.5], [1, 4, 2], 0xa89b81, "hair");
  } else if (role === "herbalist") {
    box(head, [0, 12, -1], [14, 4, 12], p.trim, "seam");
    box(head, [5, 10, -6], [4, 5, 3], p.hair, "hair");
    const braid = bone("braid", "head", [5, 7, -6]);
    for (let i = 0; i < 3; i++)
      box(braid, [i % 2, -i * 3, 0], [3, 3, 3], p.hair, "hair");
    box(braid, [0, -8, 0], [3, 1, 3], p.trim, "plain");
  } else if (role === "mechanic") {
    box(head, [0, 12, 4], [13, 2, 2], p.leather, "leather");
    box(head, [0, 0.5, 5.8], [4, 1, 1], p.hair, "hair");
    for (const x of [-3, 3]) {
      box(head, [x, 12, 6], [5, 4, 2], p.trim, "metal");
      box(head, [x, 12, 7.1], [3, 2, 1], 0x70aeb7, "glass");
    }
  }
  for (const side of [-1, 1]) {
    const suffix = side < 0 ? "L" : "R",
      arm = bone("arm" + suffix, "torso", [side * 9, 13, 0]);
    box(arm, [0, -4, 0], [5, 8, 6], p.coat);
    box(arm, [0, -8, 0], [5, 2, 6], p.trim, "seam");
    const fore = bone("forearm" + suffix, "arm" + suffix, [0, -8, 0]);
    box(fore, [0, -3, 0], [4, 6, 5], skin, "skin");
    box(fore, [0, -6.5, 0], [5, 3, 6], p.leather, "leather");
    const hand = bone("hand" + suffix, "forearm" + suffix, [0, -8, 0]);
    box(hand, [0, -1, 0], [4, 3, 5], skin, "skin");
    box(hand, [-side * 2, -1, 1], [1, 2, 2], skin, "skin");
    const leg = bone("leg" + suffix, "root", [side * 3.5, 22, 0]);
    box(leg, [0, -5, 0], [6, 10, 7], p.pants);
    const shin = bone("shin" + suffix, "leg" + suffix, [0, -10, 0]);
    box(shin, [0, -4, 0], [5, 8, 6], p.pants);
    box(shin, [0, -2, 3.5], [4, 3, 1], p.leather, "patch");
    const foot = bone("foot" + suffix, "shin" + suffix, [0, -8, 0]);
    box(foot, [0, -1, 1], [6, 6, 9], p.leather, "boot");
    box(foot, [0, -3.5, 1], [6, 1, 9], 0x303b3c, "plain");
  }
  const prop = bone("prop", "handR", [0, -1, 2]);
  if (role === "herbalist") {
    box(prop, [0, 2, 2], [3, 5, 3], 0x85b9ad, "glass");
    box(prop, [0, 5, 2], [2, 1, 2], p.trim, "plain");
  }
  if (role === "mechanic") {
    box(prop, [0, 1, 2], [2, 9, 2], p.leather, "leather");
    box(prop, [0, 6, 2], [7, 3, 3], 0xa3b3ac, "metal");
  }
  return { role, palette: p, bones, height: 1.625 };
}
// Shared joint poses: walk is driven by travelled distance; elbows/knees remain linked to their parents.
export function characterPose({
  time = 0,
  phase = 0,
  action = "idle",
  speed = 0,
  lookYaw = 0,
  lookPitch = 0,
  seed = 0,
  greeting = 0,
} = {}) {
  const pose = {},
    set = (id, x = 0, y = 0, z = 0) => (pose[id] = { rotation: [x, y, z] });
  const locomotion = action === "walk" || action === "run",
    run = action === "run";
  const swing = locomotion ? Math.sin(phase) * (run ? 0.9 : 0.55) : 0;
  set(
    "root",
    0,
    0,
    locomotion ? Math.sin(phase) * 0.025 : Math.sin(time * 1.4 + seed) * 0.012,
  );
  pose.root.y = locomotion
    ? Math.abs(Math.sin(phase)) * (run ? 0.045 : 0.018)
    : Math.sin(time * 1.7 + seed) * 0.004;
  set("torso", run ? 0.15 : 0, Math.sin(phase) * (locomotion ? 0.06 : 0));
  set(
    "head",
    lookPitch,
    Math.max(-0.65, Math.min(0.65, lookYaw)),
    Math.sin(time * 0.7 + seed) * 0.018,
  );
  for (const [side, sign] of [
    ["L", -1],
    ["R", 1],
  ]) {
    set("arm" + side, swing * sign, 0, sign * -0.05);
    set(
      "forearm" + side,
      run ? -0.8 : -0.12 - Math.max(0, swing * sign) * 0.35,
    );
    set("leg" + side, -swing * sign);
    set("shin" + side, Math.max(0, swing * sign) * (run ? 1.15 : 0.7));
    set("hand" + side, 0, 0, 0);
  }
  if (action === "crouch") {
    pose.root.y = -0.22;
    set("torso", 0.4);
    set("head", -0.25 + lookPitch, lookYaw);
    for (const side of ["L", "R"]) {
      set("leg" + side, -1.05);
      set("shin" + side, 1.9);
      set("arm" + side, -0.4);
      set("forearm" + side, -0.5);
    }
  }
  if (action === "crawl") {
    pose.root.y = -0.2;
    set("torso", 1.25);
    set("head", -1.0 + lookPitch, lookYaw);
    for (const [side, sign] of [
      ["L", -1],
      ["R", 1],
    ]) {
      set("arm" + side, -1.25 + Math.sin(phase) * sign * 0.15);
      set("forearm" + side, -0.15);
      set("leg" + side, 0.3 + Math.sin(phase) * sign * 0.18);
      set("shin" + side, 1.25);
    }
  }
  if (action === "wave" || greeting > 0) {
    set("armR", -0.3, 0, 2.35);
    set("forearmR", -0.3, 0, Math.sin(time * 9) * 0.2 + 0.35);
    set("browL", 0, 0, -0.08);
    set("browR", 0, 0, 0.08);
  }
  const blink = (time + seed * 0.73) % 4.7 > 4.54;
  for (const side of ["L", "R"])
    pose["eye" + side] = { scale: [1, blink ? 0.12 : 1, 1] };
  if (action === "talk") {
    set("head", Math.sin(time * 3) * 0.055 + lookPitch, lookYaw);
    set("armL", -0.25, 0, 0.1);
    set("forearmL", -0.8 + Math.sin(time * 3) * 0.15);
    pose.mouth = { scale: [1, 1 + Math.max(0, Math.sin(time * 8)) * 1.6, 1] };
  }
  if (action === "work") {
    set("armR", -0.65 + Math.sin(time * 3.6) * 0.3);
    set("forearmR", -0.7 - Math.sin(time * 3.6) * 0.45);
    set("head", 0.18);
  }
  set("braid", Math.sin(time * 1.5) * 0.06, 0, Math.sin(time * 2) * 0.08);
  // Ankle counter-rotation keeps soles level while knees bend. The pelvis follows
  // the lower supporting foot, preventing preview poses from sinking underground.
  let support = Infinity;
  for (const side of ["L", "R"]) {
    const hip = pose["leg" + side].rotation[0],
      knee = pose["shin" + side].rotation[0];
    set("foot" + side, -hip - knee);
    support = Math.min(
      support,
      22 * PIXEL -
        10 * PIXEL * Math.cos(hip) -
        8 * PIXEL * Math.cos(hip + knee) -
        4 * PIXEL,
    );
  }
  pose.root.y = -support;
  // Keep the foot plane level; torso motion supplies the body sway.
  pose.torso.y = Math.sin(time * 1.7 + seed) * 0.003;
  pose.torso.rotation[2] = pose.root.rotation[2];
  pose.root.rotation[2] = 0;
  return pose;
}
