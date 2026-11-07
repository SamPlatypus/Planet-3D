import * as THREE from 'three';
import { STARS_B64, STAR_COUNT } from '../data/stars.js';
import { raDecToEcliptic, eclToScene } from '../sim/astro.js';
import { createSkyMaterial, createStarMaterial } from './materials.js';

// The celestial background: real stars from the Yale Bright Star Catalogue at
// their true J2000 positions, a sprinkling of fainter random stars concentrated
// towards the galactic plane, and a baked Milky Way, all oriented so the
// constellations sit in the right directions relative to the planets.

export const GALACTIC_POLE = eclToScene(raDecToEcliptic(192.85948, 27.12825));
export const GALACTIC_CENTER = eclToScene(raDecToEcliptic(266.4051, -28.93617));

function decodeStars() {
  const bin = atob(STARS_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

/** Approximate RGB (0..1) of a star from its B-V colour index. */
export function bvToRgb(bv) {
  bv = Math.max(-0.4, Math.min(2.0, bv));
  const T = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  const t = T / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = [r, g, b].map((v) => Math.max(0, Math.min(255, v)) / 255);
  // Soften towards white: real star colours are subtle to the eye.
  return c.map((v) => v * 0.7 + 0.3);
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function createStarfield(radius) {
  const data = decodeStars();
  const extra = 9000;
  const total = STAR_COUNT + extra;
  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const size = new Float32Array(total);
  const phase = new Float32Array(total);
  const v = [0, 0, 0];
  const s = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < STAR_COUNT; i++) {
    const ra = data[i * 4] / 90;
    const dec = data[i * 4 + 1] / 300;
    const mag = data[i * 4 + 2] / 1000;
    const bv = data[i * 4 + 3] / 1000;
    raDecToEcliptic(ra, dec, v);
    eclToScene(v, s);
    pos.set([s[0] * radius, s[1] * radius, s[2] * radius], n * 3);
    col.set(bvToRgb(bv), n * 3);
    size[n] = Math.max(0.45, Math.min(5.5, 0.55 + 0.62 * (6.5 - mag)));
    phase[n] = (i * 0.618034) % 1;
    n++;
  }
  // Faint background stars, denser along the Milky Way.
  const rand = rng(1234567);
  const gp = new THREE.Vector3(...GALACTIC_POLE);
  const gc = new THREE.Vector3(...GALACTIC_CENTER);
  const gq = new THREE.Vector3().crossVectors(gp, gc);
  const dir = new THREE.Vector3();
  for (let i = 0; i < extra; i++) {
    if (rand() < 0.55) {
      const l = rand() * Math.PI * 2;
      const g = (rand() + rand() + rand() - 1.5) * 0.28;
      dir.copy(gc).multiplyScalar(Math.cos(l) * Math.cos(g))
        .addScaledVector(gq, Math.sin(l) * Math.cos(g))
        .addScaledVector(gp, Math.sin(g));
    } else {
      const z = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      dir.set(r * Math.cos(a), z, r * Math.sin(a));
    }
    dir.normalize().multiplyScalar(radius);
    pos.set([dir.x, dir.y, dir.z], n * 3);
    col.set(bvToRgb(rand() * 1.6 - 0.1), n * 3);
    size[n] = 0.18 + rand() * 0.42;
    phase[n] = rand();
    n++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const points = new THREE.Points(geo, createStarMaterial());
  points.frustumCulled = false;
  points.renderOrder = -9;
  return points;
}

export function createSky(baker, radius, size) {
  const tex = baker.bake({ kind: 'sky', size, seed: 4, galPole: GALACTIC_POLE, galCenter: GALACTIC_CENTER });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), createSkyMaterial(tex));
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
