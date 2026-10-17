// Attack shapes are shared by hit detection and the visible ground telegraph.
export const PATTERNS = {
  stomp: { name: "내려찍기", hint: "붉은 원 밖으로 이동", warning: 1.15 },
  charge: { name: "돌진", hint: "긴 예고선의 옆으로 이동", warning: 1.4 },
  ring: {
    name: "공명 고리",
    hint: "고리 안쪽 빈 공간 또는 바깥으로 이동",
    warning: 1.4,
  },
  cross: {
    name: "십자 분쇄",
    hint: "십자 선 사이 대각선으로 이동",
    warning: 1.3,
  },
  burst: { name: "삼중 낙하", hint: "세 개의 원 사이로 이동", warning: 1.25 },
};
export function prepareAttack(b, biome, player) {
  const sequence = [
    ["stomp", "ring", "stomp"],
    ["charge", "cross", "charge"],
    ["ring", "burst", "ring"],
  ][biome];
  b.pattern = sequence[b.phase % sequence.length];
  b.warning = PATTERNS[b.pattern].warning;
  b.aimX = player.x;
  b.aimZ = player.z;
  b.originX = b.x;
  b.originZ = b.z;
}
export function attackZones(b) {
  const circle = (x, z, outer, inner = 0) => ({
    type: "circle",
    x,
    z,
    outer,
    inner,
  });
  if (b.pattern === "ring")
    return [circle(b.originX ?? b.x, b.originZ ?? b.z, 8, 3.2)];
  if (b.pattern === "charge") {
    const dx = b.aimX - (b.originX ?? b.x),
      dz = b.aimZ - (b.originZ ?? b.z),
      length = Math.max(6, Math.hypot(dx, dz) + 3);
    const angle = Math.atan2(dx, dz);
    return [
      {
        type: "line",
        x: (b.originX ?? b.x) + (Math.sin(angle) * length) / 2,
        z: (b.originZ ?? b.z) + (Math.cos(angle) * length) / 2,
        width: 2.8,
        length,
        angle,
      },
    ];
  }
  if (b.pattern === "cross")
    return [0, Math.PI / 2].map((angle) => ({
      type: "line",
      x: b.aimX,
      z: b.aimZ,
      width: 2.6,
      length: 16,
      angle,
    }));
  if (b.pattern === "burst")
    return [
      circle(b.aimX, b.aimZ, 2.5),
      circle(b.aimX - 5, b.aimZ + 2, 2.5),
      circle(b.aimX + 5, b.aimZ - 2, 2.5),
    ];
  return [circle(b.aimX, b.aimZ, 4)];
}
export function attackHits(b, player) {
  if (player.flying && b.pattern !== "burst") return false;
  return attackZones(b).some((a) => {
    const x = player.x - a.x,
      z = player.z - a.z;
    if (a.type === "circle") {
      const d = Math.hypot(x, z);
      return d < a.outer && d >= a.inner;
    }
    return (
      Math.abs(Math.cos(a.angle) * x - Math.sin(a.angle) * z) < a.width / 2 &&
      Math.abs(Math.sin(a.angle) * x + Math.cos(a.angle) * z) < a.length / 2
    );
  });
}
