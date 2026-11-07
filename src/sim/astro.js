// Time, orbital mechanics and reference-frame helpers.
//
// Planet positions use the JPL "Keplerian Elements for Approximate Positions of
// the Major Planets" (E. M. Standish), table 1 (valid 1800-2050, good to a few
// arc-minutes; usable but less accurate outside that range). Coordinates are
// heliocentric, ecliptic and equinox of J2000, in AU.

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;
export const J2000 = 2451545.0;
export const AU_KM = 149597870.7;
export const C_KM_S = 299792.458;
export const GM_SUN = 1.32712440018e11; // km^3 / s^2
export const OBLIQUITY = 23.4392911 * DEG;

const MS_PER_DAY = 86400000;
const UNIX_EPOCH_JD = 2440587.5;

export const msToJD = (ms) => ms / MS_PER_DAY + UNIX_EPOCH_JD;
export const jdToMs = (jd) => (jd - UNIX_EPOCH_JD) * MS_PER_DAY;
export const nowJD = () => msToJD(Date.now());

/** Wrap an angle to (-PI, PI]. */
export function wrapPi(a) {
  a %= TAU;
  if (a <= -Math.PI) a += TAU;
  else if (a > Math.PI) a -= TAU;
  return a;
}

/** Solve Kepler's equation M = E - e sin E for E (radians). */
export function solveKepler(M, e) {
  M = wrapPi(M);
  let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
  for (let i = 0; i < 40; i++) {
    const f = E - e * Math.sin(E) - M;
    const d = f / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return E;
}

/**
 * A heliocentric Keplerian orbit whose elements drift linearly with time.
 * `el.base` = [a, e, I, L, longPeri, longNode] at J2000 (AU, deg),
 * `el.rate` = the same per Julian century.
 */
export class KeplerOrbit {
  constructor(el) {
    this.base = el.base;
    this.rate = el.rate;
    this.a = 0; this.e = 0; this.M = 0; this.n = 0; // n: mean motion (rad/day)
    this.P = [0, 0, 0];
    this.Q = [0, 0, 0];
    this.periodDays = 0;
    this._jd = NaN;
    this.setEpoch(J2000);
  }

  /** Recompute the orbital frame for a date. Cheap; call when the date moves. */
  setEpoch(jd) {
    if (jd === this._jd) return this;
    this._jd = jd;
    const T = (jd - J2000) / 36525;
    const b = this.base, r = this.rate;
    const a = b[0] + r[0] * T;
    const e = Math.min(0.97, Math.max(0, b[1] + r[1] * T));
    const I = (b[2] + r[2] * T) * DEG;
    const L = (b[3] + r[3] * T) * DEG;
    const wbar = (b[4] + r[4] * T) * DEG;
    const node = (b[5] + r[5] * T) * DEG;
    const w = wbar - node;
    const cw = Math.cos(w), sw = Math.sin(w);
    const cO = Math.cos(node), sO = Math.sin(node);
    const cI = Math.cos(I), sI = Math.sin(I);
    this.P[0] = cw * cO - sw * sO * cI;
    this.P[1] = cw * sO + sw * cO * cI;
    this.P[2] = sw * sI;
    this.Q[0] = -sw * cO - cw * sO * cI;
    this.Q[1] = -sw * sO + cw * cO * cI;
    this.Q[2] = cw * sI;
    this.a = a;
    this.e = e;
    this.M = wrapPi(L - wbar);
    // Mean motion from the L rate (deg/century -> rad/day).
    this.n = (r[3] * DEG) / 36525;
    this.periodDays = TAU / this.n;
    this.I = I;
    this.node = node;
    this.wbar = wbar;
    return this;
  }

  /** Ecliptic position (AU) at eccentric anomaly E, written to out[0..2]. */
  positionAtE(E, out, o = 0) {
    const a = this.a, e = this.e;
    const x = a * (Math.cos(E) - e);
    const y = a * Math.sqrt(1 - e * e) * Math.sin(E);
    out[o] = this.P[0] * x + this.Q[0] * y;
    out[o + 1] = this.P[1] * x + this.Q[1] * y;
    out[o + 2] = this.P[2] * x + this.Q[2] * y;
    return out;
  }

  /** Ecliptic position (AU) at mean anomaly M. */
  positionAtM(M, out, o = 0) {
    return this.positionAtE(solveKepler(M, this.e), out, o);
  }

  /** Ecliptic position (AU) on a date (updates the epoch). */
  position(jd, out, o = 0) {
    this.setEpoch(jd);
    return this.positionAtM(this.M, out, o);
  }

  /** Orbital speed (km/s) at a heliocentric distance r (AU). */
  speedAt(rAU) {
    return Math.sqrt(GM_SUN * (2 / (rAU * AU_KM) - 1 / (this.a * AU_KM)));
  }
}

/** Unit vector from equatorial J2000 RA/Dec (deg) to ecliptic J2000. */
export function raDecToEcliptic(raDeg, decDeg, out = [0, 0, 0]) {
  const ra = raDeg * DEG, dec = decDeg * DEG;
  const x = Math.cos(dec) * Math.cos(ra);
  const y = Math.cos(dec) * Math.sin(ra);
  const z = Math.sin(dec);
  const ce = Math.cos(OBLIQUITY), se = Math.sin(OBLIQUITY);
  out[0] = x;
  out[1] = ce * y + se * z;
  out[2] = -se * y + ce * z;
  return out;
}

/**
 * Ecliptic (x toward the March equinox, z toward the north ecliptic pole) to
 * scene coordinates (three.js, y up): scene = (x, z, -y).
 */
export function eclToScene(v, out = [0, 0, 0], o = 0) {
  const x = v[0], y = v[1], z = v[2];
  out[o] = x;
  out[o + 1] = z;
  out[o + 2] = -y;
  return out;
}
