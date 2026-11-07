import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Astronomy from 'astronomy-engine';
import { KeplerOrbit, msToJD, jdToMs, solveKepler, raDecToEcliptic, OBLIQUITY, J2000 } from '../src/sim/astro.js';
import { PLANETS } from '../src/data/bodies.js';

const BODY = {
  mercury: 'Mercury', venus: 'Venus', earth: 'EMB', mars: 'Mars', jupiter: 'Jupiter',
  saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune', pluto: 'Pluto',
};

// astronomy-engine returns equatorial J2000 (EQJ); rotate into the ecliptic.
function referenceEcliptic(name, date) {
  const v = Astronomy.HelioVector(name, date);
  const ce = Math.cos(OBLIQUITY), se = Math.sin(OBLIQUITY);
  return [v.x, ce * v.y + se * v.z, -se * v.y + ce * v.z];
}

const angle = (a, b) => {
  const d = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
  return (Math.acos(Math.min(1, Math.max(-1, d))) * 180) / Math.PI;
};

test('Julian date conversions round-trip', () => {
  assert.equal(msToJD(Date.UTC(2000, 0, 1, 12)), J2000);
  const ms = Date.UTC(2026, 10, 7, 13, 45);
  assert.ok(Math.abs(jdToMs(msToJD(ms)) - ms) < 1);
});

test('Kepler solver converges for all eccentricities', () => {
  for (const e of [0, 0.0167, 0.2056, 0.5, 0.9]) {
    for (let M = -3; M <= 3; M += 0.25) {
      const E = solveKepler(M, e);
      assert.ok(Math.abs(E - e * Math.sin(E) - M) < 1e-10, `e=${e} M=${M}`);
    }
  }
});

test('planet positions match a high-precision ephemeris (1950-2050)', () => {
  const dates = ['1950-06-01', '1987-03-15', '2000-01-01', '2026-11-07', '2049-12-31'];
  for (const p of PLANETS) {
    const orbit = new KeplerOrbit(p.orbit);
    for (const iso of dates) {
      const date = new Date(iso + 'T00:00:00Z');
      const ours = orbit.position(msToJD(date.getTime()), [0, 0, 0]);
      const ref = referenceEcliptic(BODY[p.id], date);
      const dAngle = angle(ours, ref);
      const dR = Math.abs(Math.hypot(...ours) - Math.hypot(...ref)) / Math.hypot(...ref);
      // Standish table 1 is good to arc-minutes for the major planets; the
      // outer planets' mutual perturbations and Pluto's orbit are coarser.
      const tolDeg = p.id === 'pluto' ? 1.0 : ['jupiter', 'saturn', 'uranus', 'neptune'].includes(p.id) ? 0.35 : 0.1;
      assert.ok(dAngle < tolDeg, `${p.name} ${iso}: ${dAngle.toFixed(4)}° off`);
      assert.ok(dR < 0.01, `${p.name} ${iso}: radius ${(dR * 100).toFixed(3)} % off`);
    }
  }
});

test('Earth pole converts to the ecliptic tilted by the obliquity', () => {
  const p = raDecToEcliptic(0, 90);
  assert.ok(Math.abs(Math.acos(p[2]) - OBLIQUITY) < 1e-9);
});
