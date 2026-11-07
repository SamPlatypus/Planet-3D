import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SolarSystem } from '../src/sim/system.js';
import { mapDistance, bodyRadius, SUN_RADIUS } from '../src/sim/scale.js';
import { J2000, AU_KM } from '../src/sim/astro.js';
import { speedFromSlider, sliderFromSpeed, SPEED_DETENTS } from '../src/sim/speed.js';
import { ALL_BODIES, PLANETS, MOONS } from '../src/data/bodies.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('every body has the data the app needs', () => {
  const ids = new Set();
  for (const b of ALL_BODIES) {
    assert.ok(!ids.has(b.id), `duplicate id ${b.id}`);
    ids.add(b.id);
    assert.match(b.color, /^#[0-9a-f]{6}$/i, b.id);
    assert.ok(b.radiusKm > 0, b.id);
    assert.ok(Array.isArray(b.facts) && b.facts.length > 0, `${b.id} facts`);
    assert.ok(b.stats && b.stats.radiusKm, `${b.id} stats`);
    if (b.kind !== 'star') assert.ok(b.surface && b.surface.kind, `${b.id} surface`);
  }
  for (const m of MOONS) assert.ok(ids.has(m.parent), `${m.id} parent`);
});

test('the Sun fits inside Mercury’s orbit at both scales', () => {
  const sys = new SolarSystem();
  const mercury = sys.get('mercury');
  const peri = mercury.orbit.a * (1 - mercury.orbit.e);
  for (const blend of [0, 0.5, 1]) {
    assert.ok(mapDistance(peri, blend) > SUN_RADIUS * 1.8, `blend ${blend}`);
  }
});

test('distance mapping is monotonic and keeps the planets in order', () => {
  let prev = 0;
  for (let r = 0.1; r < 60; r *= 1.1) {
    for (const blend of [0, 1]) assert.ok(mapDistance(r, blend) > 0);
    const d = mapDistance(r, 0);
    assert.ok(d > prev);
    prev = d;
  }
  const sys = new SolarSystem();
  sys.update(J2000 + 9000);
  const a = PLANETS.map((p) => sys.get(p.id).orbit.a);
  for (let i = 1; i < a.length; i++) assert.ok(a[i] > a[i - 1]);
});

test('moons sit outside their planet (and Saturn’s main rings) in order of distance', () => {
  const sys = new SolarSystem();
  sys.update(J2000 + 1234.5);
  for (const p of sys.planets) {
    let prev = 0;
    const ringOuter = p.def.rings && p.def.rings.opacity > 0.3 ? p.def.rings.outer * p.radius : p.radius;
    for (const m of [...p.children].sort((x, y) => x.def.a - y.def.a)) {
      assert.ok(m.orbitRadius > Math.max(p.radius, ringOuter) + m.radius, `${m.id} clears ${p.id}`);
      assert.ok(m.orbitRadius > prev, `${m.id} order`);
      assert.ok(Math.abs(dist(m.pos, p.pos) - m.orbitRadius) < 1e-9, `${m.id} on its orbit`);
      prev = m.orbitRadius;
    }
  }
});

test('the Moon is 384,400 km from Earth and Earth ≈ 1 AU from the Sun', () => {
  const sys = new SolarSystem();
  sys.update(J2000 + 777);
  const km = sys.distanceAU(sys.get('moon'), sys.get('earth')) * AU_KM;
  assert.ok(Math.abs(km - 384400) < 1, `${km}`);
  const r = sys.get('earth').sunDistanceAU;
  assert.ok(r > 0.98 && r < 1.02, `${r}`);
});

test('the Moon’s phase follows the real one (new moon 2024-04-08, full 2024-04-23)', () => {
  const sys = new SolarSystem();
  const phase = (iso) => {
    sys.update(Date.parse(iso) / 86400000 + 2440587.5);
    const e = sys.get('earth').helio;
    const m = sys.get('moon').helio;
    const toSun = [-e[0], -e[1]];
    const toMoon = [m[0] - e[0], m[1] - e[1]];
    const c = (toSun[0] * toMoon[0] + toSun[1] * toMoon[1]) / (Math.hypot(...toSun) * Math.hypot(...toMoon));
    return (Math.acos(c) * 180) / Math.PI; // elongation from the Sun
  };
  assert.ok(phase('2024-04-08T18:21:00Z') < 15, 'new moon near the Sun');
  assert.ok(phase('2024-04-23T23:49:00Z') > 165, 'full moon opposite the Sun');
});

test('trails end at the planet and orbits close on themselves', () => {
  const sys = new SolarSystem();
  for (const blend of [0, 1]) {
    sys.update(J2000 + 5000.25, blend);
    for (const p of sys.planets) {
      const n = 64;
      const t = new Float32Array(n * 3);
      sys.trailPoints(p, 0.3, n, t);
      assert.ok(dist([t[(n - 1) * 3], t[(n - 1) * 3 + 1], t[(n - 1) * 3 + 2]], p.pos) < 1e-3 * (1 + p.pos[0] ** 2) ** 0.5, `${p.id} head`);
      const o = new Float32Array(n * 3);
      sys.orbitPoints(p, n, o);
      assert.ok(dist([o[0], o[1], o[2]], [o[(n - 1) * 3], o[(n - 1) * 3 + 1], o[(n - 1) * 3 + 2]]) < 1e-3, `${p.id} closed`);
    }
  }
});

test('spin is clamped so fast-forwarding never strobes', () => {
  const sys = new SolarSystem();
  const earth = sys.get('earth');
  const before = earth.spin;
  sys.advanceSpin(365, 1 / 60); // a year in one frame
  assert.ok(Math.abs(earth.spin - before) <= 2.4 / 60 + 1e-9);
  const venus = sys.get('venus');
  const v0 = venus.spin;
  sys.advanceSpin(1, 1 / 60);
  assert.ok(venus.spin < v0, 'Venus spins backwards');
});

test('sizes are exaggerated but ordered', () => {
  assert.equal(bodyRadius(6371), 1);
  assert.ok(bodyRadius(69911) > bodyRadius(58232));
  assert.ok(bodyRadius(11) >= 0.07);
});

test('speed slider maps real time to a year per second and round-trips', () => {
  assert.ok(Math.abs(speedFromSlider(0) * 86400 - 1) < 1e-9);
  assert.ok(Math.abs(speedFromSlider(1) - 365.25) < 1e-9);
  for (const t of [0, 0.25, 0.5, 0.9]) assert.ok(Math.abs(sliderFromSpeed(speedFromSlider(t)) - t) < 1e-12);
  assert.equal(SPEED_DETENTS.length, 7);
  assert.ok(SPEED_DETENTS.every((d, i) => i === 0 || d > SPEED_DETENTS[i - 1]));
});
