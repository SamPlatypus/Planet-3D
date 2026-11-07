import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtSpeed, fmtRotation, fmtPeriod, fmtLightTime, fmtTemp, fmtAU, fmtDate, fmtMass } from '../src/ui/format.js';

test('speed labels', () => {
  assert.equal(fmtSpeed(1 / 86400), 'Real time');
  assert.equal(fmtSpeed(10 / 86400), '10× real time');
  assert.equal(fmtSpeed(1 / 1440), '1 min/s');
  assert.equal(fmtSpeed(1 / 24), '1 h/s');
  assert.equal(fmtSpeed(1), '1 day/s');
  assert.equal(fmtSpeed(2), '2 days/s');
  assert.equal(fmtSpeed(91.3), '3 mo/s');
  assert.equal(fmtSpeed(365.25), '1 yr/s');
});

test('rotation and period', () => {
  assert.equal(fmtRotation(23.9345), '23 h 56 m');
  assert.equal(fmtRotation(-17.24), '17 h 14 m (retrograde)');
  assert.equal(fmtRotation(-5832.5), '243 days (retrograde)');
  assert.equal(fmtPeriod(87.97), '88.0 days');
  assert.equal(fmtPeriod(4332.59), '11.9 years');
  assert.equal(fmtPeriod(0.319), '7.66 hours');
});

test('distances, light time and temperature', () => {
  assert.equal(fmtLightTime(1), '8 min 19 s');
  assert.equal(fmtLightTime(30), '4 h 10 min');
  assert.equal(fmtTemp(-65), '−65 °C');
  assert.equal(fmtAU(1), '1.00 AU · 150 M km');
  assert.equal(fmtAU(30.07), '30.07 AU · 4.50 B km');
  assert.equal(fmtMass(1), '1 Earth');
  assert.equal(fmtMass(333000), '333,000 Earths');
});

test('dates', () => {
  const ms = new Date(2026, 10, 7, 9, 5).getTime();
  assert.equal(fmtDate(ms, false), '7 Nov 2026');
  assert.equal(fmtDate(ms, true), '7 Nov 2026 · 09:05');
});
