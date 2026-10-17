// Serializable transforms are deliberately independent of Three.js and Rapier.
export function validPose(p) {
  const xyz = (v) => v && ["x", "y", "z"].every((k) => Number.isFinite(v[k]));
  if (
    !p ||
    ![p.position, p.rotation, p.velocity, p.spin].every(xyz) ||
    !Number.isFinite(p.rotation.w)
  )
    throw Error("손상된 조립체 위치");
  const norm = Math.hypot(
    p.rotation.x,
    p.rotation.y,
    p.rotation.z,
    p.rotation.w,
  );
  if (
    Math.abs(norm - 1) > 0.01 ||
    Object.values(p.position).some((v) => Math.abs(v) > 500) ||
    Object.values(p.velocity).some((v) => Math.abs(v) > 300) ||
    Object.values(p.spin).some((v) => Math.abs(v) > 300) ||
    typeof p.anchored !== "boolean" ||
    !/^-?\d+,-?\d+$/.test(p.region)
  )
    throw Error("조립체 위치 범위 오류");
  const vec = (v) => ({ x: v.x, y: v.y, z: v.z });
  return {
    position: vec(p.position),
    rotation: { ...vec(p.rotation), w: p.rotation.w },
    velocity: vec(p.velocity),
    spin: vec(p.spin),
    anchored: p.anchored,
    region: p.region,
  };
}
export function initialPose(x, y, z, region = "0,0") {
  return {
    position: { x, y, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 0, y: 0, z: 0 },
    spin: { x: 0, y: 0, z: 0 },
    anchored: true,
    region,
  };
}
export function rotate(q, v) {
  const tx = 2 * (q.y * v.z - q.z * v.y),
    ty = 2 * (q.z * v.x - q.x * v.z),
    tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx,
  };
}
export function worldPoint(pose, p) {
  const v = rotate(pose.rotation, p);
  return {
    x: v.x + pose.position.x,
    y: v.y + pose.position.y,
    z: v.z + pose.position.z,
  };
}
