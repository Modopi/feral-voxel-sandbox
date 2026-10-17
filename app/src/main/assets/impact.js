// Gameplay units are SI, with generous safe speeds and finite interaction forces.
export function impactEnergy(massA, massB, normalSpeed, safeSpeed = 4) {
  if (
    !(massA > 0) ||
    !(massB > 0) ||
    !Number.isFinite(normalSpeed) ||
    normalSpeed <= safeSpeed
  )
    return 0;
  const mass = 1 / (1 / massA + 1 / massB);
  return Number.isFinite(mass)
    ? 0.5 * mass * (normalSpeed ** 2 - safeSpeed ** 2)
    : 0;
}
export const IMPACT_TOUGHNESS = [
  Infinity,
  1800,
  1800,
  11000,
  1800,
  2800,
  300,
  14000,
  18000,
  Infinity,
  1000,
  2200,
];
export const impactHealth = (energy) =>
  Math.min(100, Math.max(0, energy / 140));
export function gripLimits(mass, powered = false) {
  return {
    force: powered ? 22000 : 3500,
    speedScale: Math.max(0.45, 1 / (1 + mass / (powered ? 12000 : 1600))),
    throwSpeed: Math.min(
      powered ? 8 : 5,
      (powered ? 4200 : 1100) / Math.max(1, mass),
    ),
  };
}
