import { asset, mat, part, paint as box, anchor, rng } from './shared.mjs';

// The editable source uses proportions of the authored content dimensions.
// Boxes are transformed to each articulated part's local, snapped coordinates.
// No renderer, filesystem, game mechanics, or external package is required.
function workshop(entry) {
  const a = asset(entry, 'boss', 1 / 32);
  const s = entry.stats.sizeM;
  const scale = [s.width, s.height, s.length];
  const origins = new Map([['root', [0, 0, 0]]]);
  const snap = (x) => Math.round(x / a.visualGridM) * a.visualGridM;
  const world = (v) => v.map((x, i) => x * scale[i]);
  function p(id, pivot, parent = 'root', role = 'visual') {
    const target = world(pivot).map(snap);
    const parentOrigin = origins.get(parent);
    part(a, id, target.map((v, i) => v - parentOrigin[i]), parent, role);
    origins.set(id, target);
    return id;
  }
  function b(id, center, size, material) {
    const origin = origins.get(id);
    box(a, id, world(center).map((v, i) => v - origin[i]), world(size), material);
  }
  function at(id, partId, position, purpose) {
    const origin = origins.get(partId);
    anchor(a, id, partId, world(position).map((v, i) => snap(v - origin[i])), purpose);
  }
  function palette(colors) {
    for (const [id, color, extra] of colors) mat(a, id, color, extra || {});
  }
  function steppedBody(id, center, half, material, slices = 9) {
    // Stepped longitudinal profile. Species-specific overlays supply silhouette.
    for (let j = 0; j < slices; j++) {
      const t = (j + .5) / slices * 2 - 1;
      const round = Math.sqrt(Math.max(.06, 1 - t * t));
      b(id, [center[0], center[1], center[2] + t * half[2]],
        [half[0] * 2 * round, half[1] * 2 * round, half[2] * 2 / slices], material);
    }
  }
  a.notes.push(
    '편집 가능한 정축 복셀 큐보이드 원본. +Y 위, +Z 정면, y=0 지면; 표시 격자는 1/32m.',
    '수치 콘텐츠의 크기에 맞춘 시각 시제품. 격자 정렬과 실루엣에 따른 실측 크기 오차는 각 축 10% 이내이며 빈 경계 표시로 치수를 부풀리지 않는다.',
    '부위 피벗과 앵커는 의미 표식이며 충돌체·HP·기능 구현을 대신하지 않는다.',
    '페이즈 애니메이션과 피해·분리 애니메이션은 미구현. 아래 부위 구분은 후속 리깅과 상태별 표현을 위한 준비다.',
    '발광 재질은 낮은 강도의 장식이다. 에너지 생산·저장·피해·예고 기능을 구현하거나 변경하지 않는다.',
  );
  return { a, p, b, at, palette, steppedBody, random: rng(entry.id) };
}

function rootback(entry) {
  const { a, p, b, at, palette, steppedBody, random } = workshop(entry);
  palette([
    ['hide', '#514A3C'], ['hide_light', '#71634A'], ['bark', '#65503C'],
    ['bark_dark', '#392F26'], ['root_cut', '#BA9570'], ['moss', '#53664A'],
    ['moss_light', '#7B8754'], ['fungus', '#C0AF83'], ['hoof', '#302E29'],
    ['eye', '#D2B879', { roughness: .5, emission: .06 }],
  ]);
  p('torso', [0, .46, -.03], 'root', 'organic_body');
  steppedBody('torso', [0, .48, -.04], [.34, .24, .33], 'hide', 11);
  for (const side of [-1, 1]) {
    for (const [name, z] of [['fore', .22], ['hind', -.25]]) {
      const id = p(`locomotion_${name}_${side}`, [side * .27, .46, z], 'torso', 'locomotion');
      b(id, [side * .32, .32, z], [.19, .35, .17], 'hide_light');
      b(id, [side * .37, .145, z + .015], [.16, .23, .15], 'hide');
      b(id, [side * .38, .045, z + .055], [.19, .09, .21], 'hoof');
      for (let toe = 0; toe < 3; toe++) {
        b(id, [side * .38 + (toe - 1) * .05, .035, z + .16], [.035, .055, .045], 'root_cut');
      }
      at(`foot_${name}_${side}`, id, [side * .38, .015, z + .05], 'movement_contact');
    }
  }
  p('head', [0, .45, .26], 'torso', 'head');
  b('head', [0, .43, .32], [.43, .28, .22], 'hide');
  b('head', [0, .34, .43], [.34, .19, .13], 'hide_light');
  b('head', [0, .31, .492], [.25, .09, .016], 'hoof');
  for (const side of [-1, 1]) {
    b('head', [side * .16, .49, .421], [.07, .035, .035], 'bark_dark');
    b('head', [side * .16, .49, .443], [.038, .02, .012], 'eye');
    b('head', [side * .225, .62, .29], [.09, .16, .08], 'hide_light');
    b('head', [side * .25, .35, .43], [.06, .18, .05], 'root_cut');
    b('head', [side * .23, .43, .455], [.06, .045, .08], 'root_cut');
  }
  p('core', [0, .73, -.06], 'torso', 'weak_point_root_junction');
  // The back is a deliberately crooked bundle of roots, not a smooth dome.
  for (let i = 0; i < 9; i++) {
    const z = -.32 + i * .065;
    const y = .69 + Math.sin(i / 8 * Math.PI) * .17;
    b('core', [0, y, z], [.66 - Math.abs(i - 4) * .055, .13, .09], 'bark');
    b('core', [0, y + .073, z], [.095, .035, .075], 'root_cut');
    for (const side of [-1, 1]) {
      b('core', [side * (.26 - Math.abs(i - 4) * .02), y + .035, z], [.065, .12, .08], 'bark_dark');
    }
  }
  for (const side of [-1, 1]) {
    for (let step = 0; step < 5; step++) {
      b('core', [side * (.19 + step * .045), .86 - step * .055, -.12 + step * .04], [.10, .095, .14], 'bark');
    }
  }
  for (let i = 0; i < 18; i++) {
    const x = (random() - .5) * .48;
    const z = -.27 + random() * .41;
    b('core', [x, .87 + random() * .035, z], [.07 + random() * .055, .055, .07], i % 3 ? 'moss' : 'moss_light');
  }
  p('back_sapling', [-.16, .84, -.14], 'core', 'phase_silhouette');
  b('back_sapling', [-.16, .925, -.14], [.06, .15, .045], 'bark_dark');
  b('back_sapling', [-.115, .965, -.14], [.12, .045, .05], 'bark');
  for (const side of [-1, 1]) {
    p(`fungal_shelf_${side}`, [side * .31, .64, -.17], 'core', 'seed_launcher_marker');
    for (let j = 0; j < 3; j++) {
      b(`fungal_shelf_${side}`, [side * (.35 + j * .025), .68 + j * .055, -.19 + j * .06], [.16, .035, .13], 'fungus');
    }
  }
  p('tail', [0, .48, -.34], 'torso', 'tail');
  b('tail', [.03, .43, -.405], [.1, .12, .14], 'hide');
  b('tail', [.075, .36, -.477], [.12, .13, .045], 'moss');
  at('root_junction', 'core', [0, .91, -.03], 'weak_point');
  at('seed_muzzle_left', 'fungal_shelf_-1', [-.43, .78, -.07], 'attack_origin_hint');
  at('mouth', 'head', [0, .34, .5], 'feeding_or_attack_origin');
  a.notes.push('먹이터 방어의 낮은 사족 실루엣, 등의 뒤틀린 뿌리 접합부, 씨앗을 품는 버섯 선반을 분리했다. 3페이즈 뿌리 박리는 core 부위의 상태별 교체 작업이 필요하다.');
  return a;
}

function mine(entry) {
  const { a, p, b, at, palette } = workshop(entry);
  palette([
    ['chitin', '#49413B'], ['chitin_light', '#79664C'], ['stone', '#77736B'],
    ['stone_dark', '#4C4B48'], ['iron', '#665F56', { metallic: .32 }],
    ['joint', '#302F2B'], ['flesh', '#9B7953'], ['eye', '#D2AD68', { emission: .04 }],
  ]);
  p('abdomen', [0, .45, -.09], 'root', 'armored_body');
  b('abdomen', [0, .46, -.06], [.62, .38, .61], 'chitin');
  b('abdomen', [0, .39, -.13], [.71, .20, .45], 'chitin_light');
  p('dorsal_carapace', [0, .63, -.11], 'abdomen', 'breakable_shell');
  for (let row = 0; row < 6; row++) {
    for (let col = -2; col <= 2; col++) {
      const y = .75 + (.12 - Math.abs(col) * .045) + Math.sin(row / 5 * Math.PI) * .055;
      b('dorsal_carapace', [col * .126, y, -.32 + row * .105], [.12, .16, .10], (row + col) % 3 ? 'stone' : 'iron');
      b('dorsal_carapace', [col * .126, y + .085, -.32 + row * .105], [.095, .025, .075], 'stone_dark');
    }
  }
  for (let i = 0; i < 5; i++) {
    b('dorsal_carapace', [0, .955, -.25 + i * .10], [.075, .09, .06], 'stone');
  }
  p('core', [0, .47, .03], 'abdomen', 'weak_point_flank_seams');
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      b('core', [side * .365, .51, -.25 + i * .1], [.035, .10, .045], 'flesh');
    }
    for (let leg = 0; leg < 3; leg++) {
      const z = -.26 + leg * .21;
      const id = p(`locomotion_${side}_${leg}`, [side * .30, .43, z], 'abdomen', 'locomotion');
      b(id, [side * .37, .36, z], [.20, .12, .10], 'chitin_light');
      b(id, [side * .445, .22, z - .04], [.10, .24, .09], 'chitin');
      b(id, [side * .45, .055, z + .015], [.10, .11, .19], 'stone_dark');
      at(`foot_${side}_${leg}`, id, [side * .45, 0, z + .015], 'movement_contact');
    }
    const arm = p(`claw_arm_${side}`, [side * .25, .49, .19], 'abdomen', 'attack_joint');
    b(arm, [side * .29, .42, .26], [.19, .20, .20], 'chitin');
    const claw = p(`claw_${side}`, [side * .31, .41, .32], arm, 'digging_claw');
    b(claw, [side * .31, .40, .37], [.24, .18, .18], 'iron');
    b(claw, [side * .40, .41, .46], [.07, .17, .08], 'stone');
    b(claw, [side * .23, .41, .46], [.07, .17, .08], 'stone');
    b(claw, [side * .31, .32, .42], [.11, .035, .10], 'joint');
    for (let tooth = 0; tooth < 3; tooth++) {
      b(claw, [side * .31, .41, .365 + tooth * .04], [.08, .04, .018], 'flesh');
    }
    at(`claw_tip_${side}`, claw, [side * .31, .41, .5], 'attack_origin_hint');
    at(`flank_seam_${side}`, 'core', [side * .385, .51, -.05], 'weak_point');
  }
  p('head', [0, .43, .25], 'abdomen', 'head');
  b('head', [0, .43, .29], [.23, .19, .16], 'stone_dark');
  b('head', [0, .48, .375], [.19, .032, .018], 'joint');
  for (const side of [-1, 1]) b('head', [side * .065, .48, .39], [.05, .022, .015], 'eye');
  b('abdomen', [0, .40, -.455], [.27, .14, .09], 'stone');
  a.notes.push('여섯 굴다리와 독립된 앞 집게 두 개를 가진 갱도 갑각수. 기둥 충돌 때 벌어질 등갑과 양 측복부 이음새를 별도 부위로 만들었다.');
  return a;
}

function acidworm(entry) {
  const { a, p, b, at, palette } = workshop(entry);
  palette([
    ['skin', '#66735B'], ['skin_dark', '#394B42'], ['belly', '#9C9F70'],
    ['plate', '#496257'], ['plate_edge', '#81977B'], ['acid', '#A6B45A', { roughness: .42, emission: .06 }],
    ['jaw', '#D1C5A1'], ['eye', '#DBC57A', { emission: .04 }], ['mouth', '#262E2A'],
  ]);
  // Nine independent overlapping segments read as an elongated organism.
  for (let i = 0; i < 9; i++) {
    const z = -.43 + i * .087;
    const width = .13 + Math.sin((i + 1) / 11 * Math.PI) * .25;
    const y = .24 + i * .035;
    const id = p(`segment_${i}`, [0, y, z], i ? `segment_${i - 1}` : 'root', 'body_segment');
    b(id, [0, y, z], [width * 2, .30, .105], 'skin');
    b(id, [0, y - .115, z], [width * 1.65, .12, .09], 'belly');
    b(id, [0, y + .14, z], [width * 1.8, .08, .09], 'plate');
    for (const side of [-1, 1]) {
      b(id, [side * width * .86, y + .06, z], [.07, .18, .082], 'plate_edge');
      const foot = p(`locomotion_${i}_${side}`, [side * width, y - .05, z], id, 'locomotion');
      b(foot, [side * (width + .045), y - .12, z + .015], [.12, .12, .045], 'skin_dark');
      b(foot, [side * (width + .08), .04, z + .025], [.055, .08, .07], 'plate');
      at(`foot_${i}_${side}`, foot, [side * (width + .08), 0, z + .025], 'movement_contact');
    }
    b(id, [0, y + .22, z], [.055, .12, .05], 'plate_edge');
  }
  p('head', [0, .63, .30], 'segment_8', 'raised_head');
  b('head', [0, .66, .34], [.51, .34, .17], 'skin_dark');
  b('head', [0, .80, .32], [.43, .12, .14], 'plate');
  b('head', [0, .95, .32], [.11, .10, .08], 'plate_edge');
  for (const side of [-1, 1]) {
    b('head', [side * .20, .78, .41], [.09, .06, .035], 'eye');
    b('head', [side * .235, .67, .43], [.065, .23, .07], 'jaw');
    b('head', [side * .18, .57, .475], [.15, .065, .045], 'jaw');
  }
  b('head', [0, .60, .43], [.27, .12, .065], 'mouth');
  p('core', [0, .43, .30], 'head', 'weak_point_acid_sac');
  b('core', [0, .43, .33], [.35, .26, .15], 'acid');
  b('core', [0, .40, .415], [.22, .16, .025], 'belly');
  for (const side of [-1, 1]) {
    b('core', [side * .13, .43, .419], [.03, .22, .035], 'skin_dark');
  }
  p('tail_foam', [0, .29, -.44], 'segment_0', 'secondary_launcher');
  for (let i = -1; i <= 1; i++) {
    b('tail_foam', [i * .055, .34, -.476], [.045, .11, .045], 'acid');
  }
  at('acid_sac', 'core', [0, .45, .43], 'weak_point');
  at('mouth_nozzle', 'head', [0, .62, .49], 'attack_origin_hint');
  at('foam_nozzle', 'tail_foam', [0, .38, -.50], 'attack_origin_hint');
  a.notes.push('아홉 분절은 몸통 길이를 따르며 각 마디와 다리를 독립 조정할 수 있다. 목 아래 산성낭과 꼬리 포말기관은 분리했다. 수위 상승·배수·낭 팽창은 미구현이다.');
  return a;
}

function furnace(entry) {
  const { a, p, b, at, palette } = workshop(entry);
  palette([
    ['hide', '#4B4942'], ['ash', '#A49B89'], ['basalt', '#373C3B'],
    ['plate', '#555B54', { metallic: .18 }], ['plate_edge', '#73776A'],
    ['vent_dark', '#292C2B'], ['vent_inner', '#B87540', { emission: .12 }],
    ['ember', '#D29A59', { emission: .16 }], ['claw', '#CCC4A7'],
  ]);
  p('torso', [0, .43, -.04], 'root', 'organic_body');
  b('torso', [0, .43, -.03], [.65, .37, .65], 'hide');
  b('torso', [0, .31, .04], [.56, .13, .61], 'ash');
  for (const side of [-1, 1]) {
    for (const [name, z] of [['front', .26], ['back', -.27]]) {
      const leg = p(`locomotion_${side}_${name}`, [side * .28, .42, z], 'torso', 'locomotion');
      b(leg, [side * .34, .25, z], [.22, .34, .20], 'hide');
      b(leg, [side * .37, .075, z + .015], [.23, .15, .22], 'basalt');
      for (let j = 0; j < 3; j++) b(leg, [side * .37 + (j - 1) * .06, .045, z + .14], [.045, .055, .07], 'claw');
      at(`foot_${side}_${name}`, leg, [side * .37, 0, z], 'movement_contact');
    }
  }
  p('shell', [0, .60, -.07], 'torso', 'segmented_heat_shell');
  for (let i = -3; i <= 3; i++) {
    const x = i * .11;
    const y = .81 - Math.abs(i) * .055;
    for (let j = 0; j < 5; j++) {
      const z = -.29 + j * .115;
      b('shell', [x, y - Math.abs(j - 2) * .018, z], [.103, .23, .106], 'plate');
      b('shell', [x, y + .125 - Math.abs(j - 2) * .018, z], [.07, .025, .075], 'plate_edge');
    }
  }
  p('core', [0, .60, -.04], 'torso', 'weak_point_exhaust_organs');
  for (const side of [-1, 1]) {
    for (let j = 0; j < 4; j++) {
      const z = -.24 + j * .13;
      b('core', [side * .405, .62, z], [.10, .23, .10], 'vent_dark');
      b('core', [side * .46, .62, z], [.025, .15, .065], 'vent_inner');
      b('core', [side * .46, .71, z], [.065, .045, .11], 'ash');
      b('core', [side * .46, .53, z], [.065, .035, .11], 'ash');
      at(`vent_${side}_${j}`, 'core', [side * .49, .62, z], 'weak_point_and_attack_origin_hint');
    }
  }
  p('dorsal_exhaust', [0, .89, -.08], 'shell', 'heat_display');
  for (let j = 0; j < 3; j++) {
    b('dorsal_exhaust', [0, .95, -.20 + j * .15], [.11, .10, .09], 'basalt');
    b('dorsal_exhaust', [0, .999 - .015, -.20 + j * .15], [.06, .025, .045], 'ember');
  }
  p('head', [0, .43, .30], 'torso', 'head');
  b('head', [0, .45, .36], [.39, .25, .17], 'basalt');
  b('head', [0, .35, .448], [.31, .10, .10], 'ash');
  b('head', [0, .49, .454], [.25, .025, .018], 'vent_dark');
  for (const side of [-1, 1]) b('head', [side * .09, .49, .467], [.05, .02, .012], 'ember');
  p('tail', [0, .35, -.34], 'torso', 'counterweight_tail');
  b('tail', [0, .30, -.40], [.17, .17, .15], 'plate');
  b('tail', [0, .23, -.48], [.23, .11, .04], 'basalt');
  at('shell_apex', 'shell', [0, .95, 0], 'phase_heat_display');
  a.notes.push('전기로 로봇처럼 보이지 않도록 네 유기 다리와 머리·배를 유지하고, 등에는 일곱 줄의 겹친 내열판을 얹었다. 배열기관 여덟 개는 낮은 발광의 노출 기관으로 따로 만든다. 과열·냉각 상태 변경은 미구현이다.');
  return a;
}

function glider(entry) {
  const { a, p, b, at, palette, steppedBody } = workshop(entry);
  palette([
    ['body', '#5E6870'], ['belly', '#BAB49F'], ['feather', '#8C969A'],
    ['feather_dark', '#404F5A'], ['tip', '#C1C2AE'], ['joint', '#7A705A'],
    ['beak', '#C6AE7E'], ['eye', '#DDC488', { emission: .035 }],
  ]);
  p('torso', [0, .49, .02], 'root', 'aerial_body');
  steppedBody('torso', [0, .48, .015], [.12, .20, .27], 'body', 11);
  b('torso', [0, .385, .10], [.17, .15, .32], 'belly');
  p('core', [0, .63, .04], 'torso', 'weak_point_wing_joints');
  for (const side of [-1, 1]) {
    const shoulder = p(`wing_shoulder_${side}`, [side * .09, .62, .065], 'core', 'wing_root_joint');
    b(shoulder, [side * .14, .64, .045], [.12, .12, .23], 'joint');
    b(shoulder, [side * .18, .68, .025], [.14, .12, .29], 'feather');
    const elbow = p(`wing_elbow_${side}`, [side * .24, .70, .015], shoulder, 'wing_elbow_joint');
    // Independent stairs along the span create swept feather boundaries.
    for (let i = 0; i < 5; i++) {
      const x = side * (.245 + i * .043);
      b(elbow, [x, .72 + i * .027, -.04 - i * .025], [.047, .065, .29 - i * .018], i % 2 ? 'feather_dark' : 'feather');
      b(elbow, [x, .755 + i * .027, .09 - i * .026], [.047, .03, .035], 'tip');
    }
    const tip = p(`wing_tip_${side}`, [side * .43, .84, -.12], elbow, 'primary_feather_fan');
    for (let i = 0; i < 5; i++) {
      b(tip, [side * (.436 + i * .012), .865 + i * .024, -.14 - i * .036], [.042, .045, .22 - i * .018], i % 2 ? 'feather' : 'tip');
    }
    at(`wing_joint_${side}`, shoulder, [side * .145, .70, .045], 'weak_point');
    at(`wing_tip_${side}`, tip, [side * .49, .95, -.27], 'flight_surface_hint');
    const leg = p(`locomotion_${side}`, [side * .065, .37, -.08], 'torso', 'landing_leg');
    b(leg, [side * .07, .23, -.04], [.045, .26, .06], 'joint');
    b(leg, [side * .07, .07, .015], [.05, .14, .06], 'beak');
    for (let toe = 0; toe < 3; toe++) b(leg, [side * .07 + (toe - 1) * .025, .025, .065 + (toe === 1 ? .035 : 0)], [.022, .05, .12], 'beak');
    at(`landing_foot_${side}`, leg, [side * .07, 0, .06], 'movement_contact');
  }
  p('head', [0, .62, .23], 'torso', 'head');
  b('head', [0, .67, .285], [.13, .20, .17], 'body');
  b('head', [0, .64, .385], [.085, .09, .15], 'beak');
  b('head', [0, .59, .474], [.05, .10, .045], 'beak');
  b('head', [0, .80, .28], [.055, .10, .12], 'feather_dark');
  for (const side of [-1, 1]) b('head', [side * .065, .70, .34], [.02, .035, .035], 'eye');
  p('tail_fan', [0, .40, -.24], 'torso', 'steering_tail');
  for (let i = -3; i <= 3; i++) {
    b('tail_fan', [i * .035, .43 + Math.abs(i) * .015, -.36 - (3 - Math.abs(i)) * .025], [.032, .045, .16], i % 2 ? 'feather' : 'feather_dark');
  }
  at('beak', 'head', [0, .63, .5], 'attack_origin_hint');
  at('flight_center', 'torso', [0, .52, .02], 'movement_reference');
  a.notes.push('관절형 양 날개는 shoulder→elbow→tip의 부모관계를 갖는다. 폭넓은 날개와 짧은 몸, 뒤로 쓸린 깃 끝, 착지 다리와 조종 꼬리로 지상형 보스와 구분한다. 정지 시제품의 날개 펼침 상태이며 실제 활공·착지는 미구현이다.');
  return a;
}

function symbiote(entry) {
  const { a, p, b, at, palette, random } = workshop(entry);
  palette([
    ['bark', '#514C45'], ['bark_lit', '#7B7362'], ['bark_dark', '#343B36'],
    ['leaf', '#617E6C'], ['leaf_light', '#93A48B'], ['leaf_dark', '#3D5F56'],
    ['sap', '#8CB1A6', { roughness: .42, emission: .08 }],
    ['parasite', '#A38A71'], ['petal', '#B3BBA3'], ['eye', '#CEBD8D', { emission: .04 }],
  ]);
  p('trunk', [0, .45, 0], 'root', 'host_trunk');
  for (let i = 0; i < 8; i++) {
    b('trunk', [Math.sin(i * .7) * .035, .16 + i * .075, -.035], [.29 - i * .012, .10, .30 - i * .014], i % 2 ? 'bark_lit' : 'bark');
  }
  // Six buttress roots are actual articulated locomotion limbs.
  for (let i = 0; i < 6; i++) {
    const angle = i / 6 * Math.PI * 2;
    const x = Math.cos(angle), z = Math.sin(angle);
    const id = p(`locomotion_root_${i}`, [x * .10, .25, z * .10], 'trunk', 'locomotion');
    for (let step = 0; step < 4; step++) {
      const r = .15 + step * .09;
      b(id, [x * r, .26 - step * .065, z * r], [.17 - step * .015, .12, .16 - step * .015], step % 2 ? 'bark' : 'bark_lit');
    }
    at(`root_foot_${i}`, id, [x * .44, 0, z * .44], 'movement_contact');
  }
  p('core', [0, .46, .16], 'trunk', 'weak_point_sap_sac');
  b('core', [0, .46, .18], [.23, .29, .17], 'bark_dark');
  for (let i = 0; i < 5; i++) {
    const width = [.11, .17, .20, .17, .11][i];
    b('core', [0, .35 + i * .05, .28], [width, .045, .055], 'sap');
  }
  for (const side of [-1, 1]) {
    b('core', [side * .13, .46, .27], [.045, .33, .045], 'bark_lit');
    const limb = p(`host_branch_${side}`, [side * .09, .60, 0], 'trunk', 'branch_attack_limb');
    for (let j = 0; j < 5; j++) {
      b(limb, [side * (.14 + j * .07), .63 + j * .047, .02 - j * .025], [.11, .10, .10], 'bark');
    }
    b(limb, [side * .445, .86, -.08], [.075, .16, .08], 'bark_lit');
    const crown = p(`crown_${side}`, [side * .29, .79, -.07], limb, 'leaf_and_bloom_crown');
    for (let j = 0; j < 13; j++) {
      const x = side * (.17 + random() * .22);
      const y = .78 + random() * .13;
      const z = -.23 + random() * .32;
      b(crown, [x, y, z], [.10 + random() * .09, .055, .11 + random() * .09], j % 3 === 0 ? 'leaf_light' : j % 3 === 1 ? 'leaf' : 'leaf_dark');
    }
    const blossom = p(`bloom_${side}`, [side * .30, .90, .08], crown, 'magic_bloom_marker');
    b(blossom, [side * .30, .93, .08], [.08, .07, .08], 'sap');
    for (const off of [[.08, 0], [-.08, 0], [0, .08], [0, -.08]]) {
      b(blossom, [side * .30 + off[0], .94, .08 + off[1]], [.09, .035, .09], 'petal');
    }
    at(`bloom_origin_${side}`, blossom, [side * .30, .98, .08], 'attack_origin_hint');
  }
  p('symbiont', [0, .66, .11], 'trunk', 'visible_symbiotic_creature');
  b('symbiont', [0, .69, .15], [.24, .11, .16], 'parasite');
  for (const side of [-1, 1]) {
    b('symbiont', [side * .11, .65, .19], [.045, .19, .04], 'parasite');
    b('symbiont', [side * .065, .70, .24], [.035, .025, .015], 'eye');
    b('symbiont', [side * .095, .78, .15], [.025, .12, .035], 'bark_lit');
  }
  p('upper_crook', [0, .72, -.05], 'trunk', 'crown_silhouette');
  b('upper_crook', [.025, .86, -.07], [.09, .25, .085], 'bark');
  b('upper_crook', [.10, .975, -.07], [.16, .05, .08], 'bark_lit');
  // Back-reaching root gives the original full depth without an empty bounding marker.
  b('locomotion_root_4', [-.15, .045, -.44], [.15, .09, .12], 'bark_dark');
  b('locomotion_root_1', [.16, .035, .45], [.14, .07, .10], 'bark_lit');
  at('sap_core', 'core', [0, .46, .32], 'weak_point');
  at('host_crown', 'upper_crook', [.08, 1, -.07], 'phase_silhouette_reference');
  a.notes.push('나무 줄기에 붙어 있는 작은 공생 생물의 얼굴을 별도로 표현한다. 여섯 이동뿌리, 열린 수액낭, 비대칭 수관과 꽃 기관이 존재한다. 던전의 성장결절 두 개는 건축 기믹이며 이 생명체에서 새로 소환하지 않는다.');
  return a;
}

function warden(entry) {
  const { a, p, b, at, palette } = workshop(entry);
  palette([
    ['stone', '#9B9789'], ['stone_light', '#C0B9A5'], ['stone_dark', '#555C59'],
    ['metal', '#69736D', { metallic: .48, roughness: .66 }],
    ['bronze', '#A28C5B', { metallic: .48, roughness: .7 }],
    ['recess', '#303B3A'], ['relic', '#C4B982', { emission: .09 }],
    ['cloth', '#596B65'], ['cloth_edge', '#8C9A82'],
  ]);
  p('pelvis', [0, .32, -.02], 'root', 'structural_body');
  b('pelvis', [0, .33, -.025], [.34, .16, .30], 'metal');
  for (const side of [-1, 1]) {
    const thigh = p(`locomotion_thigh_${side}`, [side * .12, .33, 0], 'pelvis', 'locomotion');
    b(thigh, [side * .13, .25, 0], [.16, .20, .20], 'stone');
    const shin = p(`locomotion_shin_${side}`, [side * .13, .17, 0], thigh, 'locomotion');
    b(shin, [side * .13, .13, .025], [.15, .18, .20], 'metal');
    b(shin, [side * .13, .13, .135], [.12, .12, .035], 'bronze');
    b(shin, [side * .13, .04, .075], [.21, .08, .35], 'stone_dark');
    at(`foot_${side}`, shin, [side * .13, 0, .12], 'movement_contact');
  }
  p('torso', [0, .47, -.025], 'pelvis', 'armored_torso');
  b('torso', [0, .54, -.015], [.40, .30, .31], 'stone');
  b('torso', [0, .68, -.01], [.53, .13, .35], 'stone_light');
  for (const side of [-1, 1]) {
    b('torso', [side * .185, .54, .165], [.055, .29, .055], 'bronze');
    b('torso', [side * .28, .69, -.01], [.13, .15, .33], 'metal');
  }
  p('core', [0, .54, .16], 'torso', 'weak_point_repair_socket');
  b('core', [0, .54, .18], [.24, .22, .055], 'recess');
  // A stepped square seal surrounds a visible six-contact service socket.
  for (const side of [-1, 1]) {
    b('core', [side * .11, .54, .215], [.025, .21, .025], 'bronze');
    b('core', [0, .54 + side * .095, .215], [.22, .025, .025], 'bronze');
  }
  b('core', [0, .54, .22], [.075, .11, .025], 'relic');
  for (const side of [-1, 1]) for (let j = 0; j < 3; j++) b('core', [side * .07, .50 + j * .04, .23], [.025, .018, .018], 'stone_light');
  p('head', [0, .77, -.01], 'torso', 'head');
  b('head', [0, .83, 0], [.23, .22, .22], 'stone');
  b('head', [0, .85, .12], [.18, .035, .025], 'recess');
  b('head', [0, .85, .138], [.12, .018, .012], 'relic');
  b('head', [0, .76, .10], [.15, .07, .09], 'stone_light');
  for (let i = -1; i <= 1; i++) {
    b('head', [i * .085, .96 - Math.abs(i) * .025, 0], [.05, .08, .10], 'bronze');
  }
  p('shield_arm', [-.27, .66, 0], 'torso', 'shield_joint');
  b('shield_arm', [-.31, .53, .08], [.13, .25, .13], 'metal');
  p('shield', [-.33, .47, .22], 'shield_arm', 'phase_shield');
  for (let j = 0; j < 7; j++) {
    const width = .25 - Math.abs(j - 3) * .025;
    b('shield', [-.36, .25 + j * .07, .37], [width, .068, .20], 'stone');
    b('shield', [-.36, .25 + j * .07, .478], [width * .9, .02, .035], 'bronze');
  }
  b('shield', [-.36, .47, .493], [.055, .20, .015], 'relic');
  p('hammer_arm', [.28, .65, 0], 'torso', 'hammer_joint');
  b('hammer_arm', [.31, .51, .05], [.14, .29, .15], 'metal');
  p('hammer', [.35, .37, .12], 'hammer_arm', 'attack_hammer');
  b('hammer', [.35, .43, .12], [.055, .53, .055], 'bronze');
  b('hammer', [.35, .69, .12], [.30, .18, .27], 'stone_dark');
  b('hammer', [.35, .69, .26], [.23, .13, .035], 'stone_light');
  b('hammer', [.35, .69, -.025], [.23, .13, .035], 'bronze');
  p('mantle', [0, .69, -.18], 'torso', 'ceremonial_mantle');
  for (let j = 0; j < 8; j++) {
    const y = .63 - j * .073;
    const z = -.21 - j * .035;
    b('mantle', [0, y, z], [.38 + j * .012, .08, .04], 'cloth');
    for (const side of [-1, 1]) b('mantle', [side * (.18 + j * .006), y, z - .023], [.025, .075, .018], 'cloth_edge');
  }
  at('repair_socket', 'core', [0, .54, .245], 'weak_point_and_repair_connection');
  at('shield_center', 'shield', [-.36, .47, .5], 'shield_orientation_hint');
  at('hammer_face', 'hammer', [.35, .69, .285], 'attack_origin_hint');
  a.notes.push('무기생명의 돌·금속 몸체와 분리된 방패·망치·수리 접속구. 장식 문양은 신성 생산 기능이 아니다. 페이즈의 방패 120°/90°/개방과 성소 수리 연결은 후속 애니메이션·기능 구현 대상이다.');
  return a;
}

function sentinel(entry) {
  const { a, p, b, at, palette } = workshop(entry);
  palette([
    ['dark', '#333F46', { metallic: .45 }], ['metal', '#7A8C90', { metallic: .6, roughness: .63 }],
    ['edge', '#B1BBB3', { metallic: .45 }], ['bronze', '#A29469', { metallic: .5 }],
    ['core', '#91B4BC', { roughness: .45, emission: .10 }], ['inset', '#21343C'],
  ]);
  p('support', [0, .12, 0], 'root', 'ground_reference_support');
  for (const [i, x, z] of [[0, -.25, -.22], [1, .25, -.22], [2, 0, .28]]) {
    const leg = p(`locomotion_${i}`, [x * .5, .25, z * .5], 'support', 'locomotion');
    b(leg, [x * .65, .15, z * .65], [.10, .21, .10], 'dark');
    b(leg, [x, .035, z], [.17, .07, .17], 'metal');
    b(leg, [x, .085, z], [.09, .035, .09], 'bronze');
    at(`contact_${i}`, leg, [x, 0, z], 'movement_contact');
  }
  p('core', [0, .53, 0], 'support', 'weak_point_control_core');
  // A bevel-stepped diamond, not a transparent ball; the center stays readable.
  for (let j = -3; j <= 3; j++) {
    const w = .25 - Math.abs(j) * .045;
    b('core', [0, .53 + j * .033, 0], [w, .034, w], Math.abs(j) === 3 ? 'edge' : 'core');
  }
  for (const side of [-1, 1]) {
    b('core', [side * .16, .53, 0], [.035, .18, .10], 'bronze');
    b('core', [0, .53, side * .16], [.10, .18, .035], 'bronze');
  }
  function latticeRing(id, plane, radius, inner, step, material) {
    const q = p(id, [0, .53, 0], 'core', 'articulated_inertia_ring');
    // Occupied lattice cells approximate the actual annulus in the selected
    // orthogonal plane. These are cuboids, never a hidden smooth torus.
    const n = Math.ceil(radius / step);
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      const u = i * step, v = j * step;
      const r = Math.hypot(u, v);
      if (r > radius || r < inner) continue;
      const center = plane === 'xy' ? [u, .53 + v * .93, 0] : plane === 'yz' ? [0, .53 + u * .93, v] : [u, .53, v];
      const size = plane === 'xy' ? [step, step * .93, .045] : plane === 'yz' ? [.045, step * .93, step] : [step, .045, step];
      b(q, center, size, Math.abs(i + j) % 5 === 0 ? 'edge' : material);
    }
    return q;
  }
  latticeRing('ring_front', 'xy', .47, .405, .025, 'metal');
  latticeRing('ring_side', 'yz', .47, .405, .025, 'dark');
  latticeRing('ring_equator', 'xz', .47, .405, .025, 'bronze');
  // Four machine-bearing boxes per ring clarify joints and rotation axes.
  for (const side of [-1, 1]) {
    b('ring_front', [side * .465, .53, 0], [.07, .11, .085], 'dark');
    b('ring_front', [0, .53 + side * .43, 0], [.11, .07, .085], 'metal');
    b('ring_side', [0, .53, side * .465], [.085, .11, .07], 'metal');
    b('ring_equator', [side * .465, .53, 0], [.07, .085, .11], 'bronze');
    b('ring_equator', [0, .53, side * .465], [.11, .085, .07], 'bronze');
  }
  p('projector', [0, .53, .17], 'core', 'inertia_projector');
  b('projector', [0, .53, .25], [.13, .14, .18], 'dark');
  b('projector', [0, .53, .35], [.17, .18, .045], 'metal');
  b('projector', [0, .53, .38], [.08, .08, .025], 'inset');
  b('projector', [0, .53, .397], [.045, .045, .012], 'core');
  for (let j = 0; j < 3; j++) {
    b('projector', [0, .62, .20 + j * .05], [.075, .025, .025], 'bronze');
  }
  at('control_core', 'core', [0, .53, .13], 'weak_point');
  at('rail_origin', 'projector', [0, .53, .41], 'attack_origin_hint');
  at('ring_axis_x', 'ring_side', [0, .53, 0], 'rotation_axis_X');
  at('ring_axis_y', 'ring_equator', [0, .53, 0], 'rotation_axis_Y');
  at('ring_axis_z', 'ring_front', [0, .53, 0], 'rotation_axis_Z');
  a.notes.push('세 정축 계단형 고리는 XY/YZ/XZ 평면의 실제 큐보이드 환으로 생성된다. 중앙 제어핵·앞 투사구·세 접지 지지부와 각 회전축 앵커를 분리했다. 고리 회전·전장 궤도·관성 기능은 미구현이다.');
  return a;
}

const builders = {
  rootback_beast: rootback,
  mine_carapace: mine,
  sluice_acidworm: acidworm,
  furnace_carapace: furnace,
  spire_glider: glider,
  arboretum_symbiote: symbiote,
  sanctuary_warden: warden,
  observatory_sentinel: sentinel,
};

export function generate(content) {
  return content.bosses.entries.map((entry) => {
    const build = builders[entry.id];
    if (!build) throw new Error(`No authored boss visual for ${entry.id}`);
    return build(entry);
  });
}
