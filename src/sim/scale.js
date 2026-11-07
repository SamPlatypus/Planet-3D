// Mapping from real distances and sizes to scene units.
//
// Real proportions make the planets invisible specks, so the scene uses two
// distance scales and smoothly blends between them:
//   compact: r = K * sqrt(r_AU)   (default; the outer planets come closer)
//   true:    r = K * r_AU         (true relative distances)
// Sizes are always exaggerated: radius = sqrt(R / R_earth), Earth = 1 unit.

export const AU_SCENE = 30;
export const SUN_RADIUS = 5;
export const MIN_BODY_RADIUS = 0.07;

export function compactDistance(rAU) {
  return AU_SCENE * Math.sqrt(Math.max(0, rAU));
}

export function trueDistance(rAU) {
  return AU_SCENE * rAU;
}

/** Scene distance from the Sun for a heliocentric distance in AU. blend: 0 compact, 1 true. */
export function mapDistance(rAU, blend) {
  const c = compactDistance(rAU);
  return c + (trueDistance(rAU) - c) * blend;
}

/** Scene radius of a body from its real mean radius (km). */
export function bodyRadius(radiusKm) {
  return Math.max(MIN_BODY_RADIUS, Math.sqrt(radiusKm / 6371));
}

/** Scene distance of a moon from its parent's centre. */
export function moonDistance(parentRadiusScene, parentRadiusKm, aKm, spread) {
  return parentRadiusScene * (1.8 + spread * Math.log(aKm / parentRadiusKm));
}
