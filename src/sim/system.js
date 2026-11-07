// The simulation model: where every body is (in AU and in scene units) for a
// given Julian date and distance-scale blend. Pure maths, no three.js, so it
// can be unit tested in Node.

import { KeplerOrbit, raDecToEcliptic, eclToScene, DEG, TAU, J2000, AU_KM } from './astro.js';
import { SUN, PLANETS, MOONS, MOON_SPREAD } from '../data/bodies.js';
import { mapDistance, bodyRadius, moonDistance, SUN_RADIUS } from './scale.js';

const MAX_SPIN_RATE = 2.4; // rad per real second; faster spins strobe, so clamp.

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= l; v[1] /= l; v[2] /= l;
  return v;
}

function cross(a, b, out = [0, 0, 0]) {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}

export class Body {
  constructor(def, parent = null) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.kind = def.kind || (parent ? 'moon' : 'planet');
    this.parent = parent;
    this.children = [];
    this.color = def.color;
    this.radius = def.kind === 'star' ? SUN_RADIUS : bodyRadius(def.radiusKm);
    this.pos = [0, 0, 0]; // scene units
    this.helio = [0, 0, 0]; // AU, ecliptic J2000 (moons: parent's + real offset)
    this.orbit = def.orbit ? new KeplerOrbit(def.orbit) : null;
    this.spin = 0;
    this.spinRate = def.rotationHours ? TAU / (def.rotationHours / 24) : 0; // rad/day
    this.tidallyLocked = !!parent;

    // Rotation pole and equatorial frame, in scene coordinates.
    const poleSrc = def.pole || (parent && parent.def.pole) || [270, 66.56];
    const pEcl = raDecToEcliptic(poleSrc[0], poleSrc[1]);
    let nEcl = normalize(cross([0, 0, 1], pEcl));
    if (!isFinite(nEcl[0]) || Math.hypot(...nEcl) < 0.5) nEcl = [1, 0, 0];
    const mEcl = cross(pEcl, nEcl);
    this.pole = eclToScene(pEcl);
    this.eqNode = eclToScene(nEcl);
    this.eqNinety = eclToScene(mEcl);
    this.poleEcl = pEcl;
    this.nodeEcl = nEcl;
    this.ninetyEcl = mEcl;

    if (parent) {
      const spread = MOON_SPREAD[parent.id] ?? 0.9;
      this.orbitRadius = moonDistance(parent.radius, parent.def.radiusKm, def.a, spread);
      this.meanMotion = TAU / def.period; // rad/day (negative = retrograde)
      this.L0 = (def.L0 || 0) * DEG;
      this.inc = (def.inc || 0) * DEG;
      this.node0 = (def.node || 0) * DEG;
      this.nodeRate = (def.nodeRate || 0) * DEG;
      this.periodDays = Math.abs(def.period);
      this.local = [0, 0, 0]; // scene offset from the parent
    } else if (this.orbit) {
      this.periodDays = this.orbit.periodDays;
    }
  }

  /** Orbit-plane unit offset of a moon at a date, in scene coordinates. */
  moonDirection(jd, out = [0, 0, 0], extraAngle = 0) {
    const d = jd - J2000;
    const lambda = this.L0 + this.meanMotion * d + extraAngle;
    const node = this.node0 + this.nodeRate * d;
    const u = lambda - node;
    const ci = Math.cos(this.inc), si = Math.sin(this.inc);
    const cO = Math.cos(node), sO = Math.sin(node);
    const cu = Math.cos(u), su = Math.sin(u);
    const x = cO * cu - sO * su * ci;
    const y = sO * cu + cO * su * ci;
    const z = su * si;
    if (this.def.ref === 'ecliptic') {
      out[0] = x; out[1] = z; out[2] = -y; // ecliptic -> scene
    } else {
      const p = this.parent;
      const n = p.eqNode, m = p.eqNinety, k = p.pole;
      out[0] = n[0] * x + m[0] * y + k[0] * z;
      out[1] = n[1] * x + m[1] * y + k[1] * z;
      out[2] = n[2] * x + m[2] * y + k[2] * z;
    }
    return out;
  }

  /** Real distance from the Sun in AU. */
  get sunDistanceAU() {
    return Math.hypot(this.helio[0], this.helio[1], this.helio[2]);
  }

  /** Real orbital speed in km/s (around the Sun for planets, the parent for moons). */
  get orbitalSpeed() {
    if (this.parent) return (TAU * this.def.a) / (this.periodDays * 86400);
    if (this.orbit) return this.orbit.speedAt(this.sunDistanceAU);
    return 0;
  }
}

export class SolarSystem {
  constructor() {
    this.sun = new Body(SUN);
    this.planets = PLANETS.map((d) => new Body(d));
    this.byId = new Map();
    this.byId.set('sun', this.sun);
    for (const p of this.planets) this.byId.set(p.id, p);
    this.moons = MOONS.map((d) => {
      const parent = this.byId.get(d.parent);
      const m = new Body(d, parent);
      parent.children.push(m);
      this.byId.set(m.id, m);
      return m;
    });
    this.bodies = [this.sun, ...this.planets, ...this.moons];
    this.blend = 0;
    this.jd = J2000;
    this._tmp = [0, 0, 0];
  }

  get(id) {
    return this.byId.get(id);
  }

  /** Scene distance for a heliocentric distance under the current blend. */
  sceneDistance(rAU) {
    return mapDistance(rAU, this.blend);
  }

  /** Map an ecliptic AU vector to scene units (current blend). */
  helioToScene(v, out, o = 0) {
    const r = Math.hypot(v[0], v[1], v[2]);
    const s = r > 0 ? mapDistance(r, this.blend) / r : 0;
    out[o] = v[0] * s;
    out[o + 1] = v[2] * s;
    out[o + 2] = -v[1] * s;
    return out;
  }

  /** Recompute all positions for a date and scale blend. */
  update(jd, blend = this.blend) {
    this.jd = jd;
    this.blend = blend;
    for (const p of this.planets) {
      p.orbit.position(jd, p.helio);
      this.helioToScene(p.helio, p.pos);
    }
    const t = this._tmp;
    for (const m of this.moons) {
      const parent = m.parent;
      m.moonDirection(jd, t);
      const r = m.orbitRadius;
      m.local[0] = t[0] * r; m.local[1] = t[1] * r; m.local[2] = t[2] * r;
      m.pos[0] = parent.pos[0] + m.local[0];
      m.pos[1] = parent.pos[1] + m.local[1];
      m.pos[2] = parent.pos[2] + m.local[2];
      // Real heliocentric position (direction from scene, scale from km).
      const k = m.def.a / AU_KM;
      m.helio[0] = parent.helio[0] + t[0] * k;
      m.helio[1] = parent.helio[1] - t[2] * k;
      m.helio[2] = parent.helio[2] + t[1] * k;
    }
  }

  /** Advance self-rotation. dDays = simulated days, dt = real seconds. */
  advanceSpin(dDays, dt) {
    const maxStep = MAX_SPIN_RATE * dt;
    for (const b of this.bodies) {
      if (!b.spinRate || b.tidallyLocked) continue;
      let step = b.spinRate * dDays;
      if (step > maxStep) step = maxStep;
      else if (step < -maxStep) step = -maxStep;
      b.spin = (b.spin + step) % TAU;
    }
  }

  /** Set rotation phases from the date (used at start-up). */
  initSpin(jd) {
    for (const b of this.bodies) {
      if (!b.spinRate || b.tidallyLocked) continue;
      b.spin = (b.spinRate * (jd - J2000)) % TAU;
    }
  }

  /**
   * Scene points along a planet's orbit, ending at its current position and
   * reaching back `frac` of an orbit. Writes `count` xyz triples into out.
   */
  trailPoints(body, frac, count, out) {
    const o = body.orbit;
    o.setEpoch(this.jd);
    const span = frac * TAU;
    const tmp = this._tmp;
    for (let i = 0; i < count; i++) {
      const s = i / (count - 1); // 0 = tail, 1 = head
      const M = o.M - span * (1 - s);
      o.positionAtM(M, tmp);
      this.helioToScene(tmp, out, i * 3);
    }
    return out;
  }

  /** Closed loop of `count` scene points around a planet's orbit (the last repeats the first). */
  orbitPoints(body, count, out) {
    const o = body.orbit;
    o.setEpoch(this.jd);
    const tmp = this._tmp;
    for (let i = 0; i < count; i++) {
      const E = (i / (count - 1)) * TAU;
      o.positionAtE(E, tmp);
      this.helioToScene(tmp, out, i * 3);
    }
    return out;
  }

  /** Closed loop of a moon's orbit relative to its parent, scene units. */
  moonOrbitPoints(moon, count, out) {
    const tmp = this._tmp;
    const r = moon.orbitRadius;
    for (let i = 0; i < count; i++) {
      const a = (i / (count - 1)) * TAU;
      moon.moonDirection(this.jd, tmp, a - (moon.L0 + moon.meanMotion * (this.jd - J2000)));
      out[i * 3] = tmp[0] * r;
      out[i * 3 + 1] = tmp[1] * r;
      out[i * 3 + 2] = tmp[2] * r;
    }
    return out;
  }

  /** Real distance between two bodies in AU. */
  distanceAU(a, b) {
    return Math.hypot(a.helio[0] - b.helio[0], a.helio[1] - b.helio[1], a.helio[2] - b.helio[2]);
  }
}
