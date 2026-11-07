import * as THREE from 'three';
import { createBeltMaterial } from './materials.js';
import { AU_SCENE } from '../sim/scale.js';
import { DEG } from '../sim/astro.js';

// Asteroid belt (with the Kirkwood gaps), Jupiter's Trojans and the Kuiper
// Belt as GPU-animated points. Each point is a circular-ish orbit; the vertex
// shader advances it from the simulation day count and applies the same
// compact/true distance mapping as the planets.

const K_GAUSS = 0.01720209895; // rad/day for a = 1 AU

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let t = s ^ (s >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return (t >>> 0) / 4294967296;
  };
}

const gaussian = (r) => (r() + r() + r() + r() - 2) / 0.577;

function makePoints(n, sample, color, size, opacity) {
  const orbit = new Float32Array(n * 4);
  const extra = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const o = sample(i);
    orbit.set([o.a, K_GAUSS / Math.pow(o.a, 1.5), o.phase, o.inc], i * 4);
    extra.set([o.node, o.size], i * 2);
  }
  const geo = new THREE.BufferGeometry();
  // Positions are computed in the shader; a dummy attribute sets the count.
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aOrbit', new THREE.BufferAttribute(orbit, 4));
  geo.setAttribute('aExtra', new THREE.BufferAttribute(extra, 2));
  const pts = new THREE.Points(geo, createBeltMaterial(color, size, opacity));
  pts.frustumCulled = false;
  pts.material.uniforms.uScaleK.value = AU_SCENE;
  return pts;
}

export function createBelts(jupiterLongitudeJ2000Deg) {
  const r = rng(20260707);
  const KIRKWOOD = [2.502, 2.825, 2.958, 3.279];
  const main = makePoints(3200, () => {
    let a;
    for (;;) {
      a = 2.06 + Math.pow(r(), 0.85) * 1.24;
      const near = KIRKWOOD.some((g) => Math.abs(a - g) < 0.022);
      if (!near || r() < 0.08) break;
    }
    return { a, phase: r() * Math.PI * 2, inc: Math.abs(gaussian(r)) * 7 * DEG, node: r() * Math.PI * 2, size: 0.6 + r() * 0.9 };
  }, '#c4b49c', 1.35, 0.32);

  // Trojans librate around Jupiter's L4/L5 points (60° ahead and behind).
  const jL = jupiterLongitudeJ2000Deg * DEG;
  const trojans = makePoints(900, (i) => {
    const lead = i % 2 === 0 ? 1 : -1;
    return {
      a: 5.2026 + gaussian(r) * 0.05,
      phase: jL + lead * 60 * DEG + gaussian(r) * 11 * DEG,
      inc: Math.abs(gaussian(r)) * 10 * DEG,
      node: r() * Math.PI * 2,
      size: 0.6 + r() * 0.8,
    };
  }, '#d1a77c', 1.3, 0.34);
  // Every Trojan shares Jupiter's mean motion so the swarms stay with it.
  const tOrbit = trojans.geometry.attributes.aOrbit.array;
  for (let i = 0; i < tOrbit.length; i += 4) tOrbit[i + 1] = K_GAUSS / Math.pow(5.2026, 1.5);

  const kuiper = makePoints(2200, () => {
    const pick = r();
    let a;
    if (pick < 0.25) a = 39.4 + gaussian(r) * 0.4; // plutinos (3:2 with Neptune)
    else if (pick < 0.85) a = 42 + r() * 5.5; // classical belt
    else a = 48 + r() * 12; // scattered
    return { a, phase: r() * Math.PI * 2, inc: Math.abs(gaussian(r)) * (pick < 0.85 ? 6 : 14) * DEG, node: r() * Math.PI * 2, size: 0.6 + r() * 0.9 };
  }, '#a9bedf', 1.3, 0.3);

  const group = new THREE.Group();
  group.add(main, trojans, kuiper);
  group.userData.layers = [main, trojans, kuiper];
  return group;
}

export function updateBelts(group, days, blend, pixelRatio) {
  for (const p of group.userData.layers) {
    const u = p.material.uniforms;
    u.uDays.value = days;
    u.uBlend.value = blend;
    u.uPixelRatio.value = pixelRatio;
  }
}
