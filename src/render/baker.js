import * as THREE from 'three';
import { BAKE_VERT, BAKE_FRAG, BAKE_KINDS } from './glsl/bake.js';

// Presets that reuse the generic rocky shader with their own palettes.
const PRESETS = {
  mercury: { kind: 'rock', palette: ['#4a433d', '#b4aa9c'], craters: 1.5, specks: 0.6 },
};

function hexToVec3(hex) {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b); // keep sRGB values: the shader paints in sRGB
}

/**
 * Bakes procedural equirectangular textures on the GPU, a few rows at a time
 * so start-up stays responsive and no single draw call trips a mobile GPU
 * watchdog. Textures can be re-baked after a WebGL context loss.
 */
export class TextureBaker {
  constructor(renderer, { maxSize = 2048, anisotropy = 4 } = {}) {
    this.renderer = renderer;
    this.maxSize = maxSize;
    this.anisotropy = anisotropy;
    this.uniforms = {
      uKind: { value: 0 },
      uSeed: { value: new THREE.Vector3() },
      uColA: { value: new THREE.Vector3(0.3, 0.3, 0.3) },
      uColB: { value: new THREE.Vector3(0.7, 0.7, 0.7) },
      uParams: { value: new THREE.Vector4(1, 0, 0, 0) },
      uRegion: { value: new THREE.Vector4(0, 0, 1, 1) },
      uGalPole: { value: new THREE.Vector3(0, 1, 0) },
      uGalCenter: { value: new THREE.Vector3(1, 0, 0) },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: BAKE_VERT,
      fragmentShader: BAKE_FRAG,
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.scene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this.camera = new THREE.Camera();
    this.jobs = [];
    this.all = [];
    this.pixelBudget = 1 << 18;
    this.donePixels = 0;
    this.totalPixels = 0;
  }

  /** Queue a texture; returns it immediately (it fills in as it bakes). */
  bake(spec, { wrapS = THREE.RepeatWrapping } = {}) {
    const preset = PRESETS[spec.kind];
    const s = preset ? { ...spec, ...preset, kind: preset.kind } : spec;
    const width = Math.min(s.size || 1024, this.maxSize);
    const height = Math.max(4, width / 2);
    const target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS,
      wrapT: THREE.ClampToEdgeWrapping,
      anisotropy: this.anisotropy,
    });
    const job = { spec: s, target, row: 0, width, height };
    this.jobs.push(job);
    this.all.push(job);
    this.totalPixels += width * height;
    return target.texture;
  }

  get pending() {
    return this.jobs.length > 0;
  }

  get progress() {
    return this.totalPixels ? this.donePixels / this.totalPixels : 1;
  }

  _setup(spec) {
    const u = this.uniforms;
    u.uKind.value = BAKE_KINDS[spec.kind] ?? 0;
    const seed = spec.seed ?? 1;
    u.uSeed.value.set((seed * 17.31) % 97, (seed * 41.77) % 89, (seed * 7.13) % 83);
    const pal = spec.palette || ['#555555', '#aaaaaa'];
    u.uColA.value.copy(hexToVec3(pal[0]));
    u.uColB.value.copy(hexToVec3(pal[1]));
    u.uParams.value.set(spec.craters ?? 1, spec.specks ?? 0, spec.patches ?? 0, 0);
    if (spec.galPole) u.uGalPole.value.fromArray(spec.galPole);
    if (spec.galCenter) u.uGalCenter.value.fromArray(spec.galCenter);
  }

  /** Bake up to the pixel budget. Call once per frame; returns true when idle. */
  step() {
    if (!this.jobs.length) return true;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    let budget = this.pixelBudget;
    while (budget > 0 && this.jobs.length) {
      const job = this.jobs[0];
      this._setup(job.spec);
      const rows = Math.max(8, Math.min(job.height - job.row, Math.floor(budget / job.width)));
      job.target.viewport.set(0, job.row, job.width, rows);
      this.uniforms.uRegion.value.set(0, job.row / job.height, 1, rows / job.height);
      r.setRenderTarget(job.target);
      r.render(this.scene, this.camera);
      job.row += rows;
      budget -= rows * job.width;
      this.donePixels += rows * job.width;
      if (job.row >= job.height) {
        job.target.viewport.set(0, 0, job.width, job.height);
        this.jobs.shift();
      }
    }
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAutoClear;
    return !this.jobs.length;
  }

  /** Bake everything immediately (used after a context restore). */
  flush() {
    const budget = this.pixelBudget;
    this.pixelBudget = Infinity;
    while (this.jobs.length) this.step();
    this.pixelBudget = budget;
  }

  /** Re-queue every texture (their contents are lost with the GL context). */
  rebakeAll() {
    this.jobs = [];
    this.donePixels = 0;
    for (const job of this.all) {
      job.row = 0;
      this.jobs.push(job);
    }
  }
}
