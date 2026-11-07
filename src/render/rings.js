import * as THREE from 'three';

// Radial ring profiles (colour + opacity) generated on the CPU into 1-D
// textures. Radii are in planet radii; features follow the real ring systems.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth 1-D value noise from a few random sines.
function ringletNoise(seed, count = 24) {
  const r = rng(seed);
  const waves = Array.from({ length: count }, () => ({ f: 40 + r() * 900, p: r() * 6.283, a: 0.3 + r() }));
  const total = waves.reduce((s, w) => s + w.a, 0);
  return (x) => waves.reduce((s, w) => s + w.a * Math.sin(x * w.f + w.p), 0) / total;
}

const gauss = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
const band = (x, a, b, soft = 0.004) => {
  const s1 = 1 / (1 + Math.exp(-(x - a) / soft));
  const s2 = 1 / (1 + Math.exp((x - b) / soft));
  return s1 * s2;
};

const PROFILES = {
  saturn(r, n) {
    // C ring, B ring, Cassini Division, A ring with Encke/Keeler gaps, F ring.
    const c = band(r, 1.239, 1.527) * (0.14 + 0.08 * n(r * 3));
    const b = band(r, 1.527, 1.95) * (0.78 + 0.18 * n(r * 2) + 0.08 * Math.sin(r * 140));
    const cassini = band(r, 1.95, 2.025) * 0.05;
    const a = band(r, 2.025, 2.27) * (0.55 + 0.12 * n(r * 4)) * (1 - 0.95 * gauss(r, 2.214, 0.0035)) * (1 - 0.9 * gauss(r, 2.265, 0.0015));
    const f = gauss(r, 2.326, 0.0025) * 0.55;
    const alpha = Math.min(1, c + b + cassini + a + f);
    const col =
      r < 1.527 ? [150, 136, 116] :
      r < 1.95 ? [226, 206, 166] :
      r < 2.025 ? [120, 110, 96] :
      r < 2.3 ? [204, 186, 150] : [210, 200, 186];
    const shade = 0.88 + 0.12 * n(r * 7);
    return [col[0] * shade, col[1] * shade, col[2] * shade, alpha];
  },
  uranus(r) {
    const rings = [
      [1.637, 0.0016, 0.5], [1.652, 0.0016, 0.5], [1.666, 0.0016, 0.5], [1.75, 0.0028, 0.7],
      [1.786, 0.0028, 0.7], [1.847, 0.0018, 0.6], [1.863, 0.0018, 0.6], [1.9, 0.0022, 0.7], [2.004, 0.0055, 0.95],
    ];
    let a = 0;
    for (const [c, w, o] of rings) a += gauss(r, c, w) * o;
    return [120, 122, 128, Math.min(1, a)];
  },
  neptune(r, n) {
    const a = gauss(r, 1.692, 0.03) * 0.25 + gauss(r, 2.148, 0.004) * 0.7 + band(r, 2.15, 2.31, 0.01) * 0.08 +
      gauss(r, 2.31, 0.003) * 0.3 + gauss(r, 2.54, 0.004) * (0.8 + 0.2 * n(r));
    return [150, 128, 118, Math.min(1, a)];
  },
  jupiter(r) {
    const a = band(r, 1.72, 1.806, 0.006) * 0.9 + band(r, 1.4, 1.72, 0.03) * 0.2;
    return [168, 140, 116, Math.min(1, a)];
  },
};

export function createRingTexture(kind, inner, outer, width = 1024) {
  const profile = PROFILES[kind];
  const noise = ringletNoise(kind.length * 7919 + 13);
  const data = new Uint8Array(width * 4);
  for (let i = 0; i < width; i++) {
    const r = inner + ((i + 0.5) / width) * (outer - inner);
    const [cr, cg, cb, a] = profile(r, noise);
    data[i * 4] = Math.max(0, Math.min(255, cr));
    data[i * 4 + 1] = Math.max(0, Math.min(255, cg));
    data[i * 4 + 2] = Math.max(0, Math.min(255, cb));
    data[i * 4 + 3] = Math.max(0, Math.min(255, a * 255));
  }
  const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
