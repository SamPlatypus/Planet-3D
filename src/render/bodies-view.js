import * as THREE from 'three';
import {
  createPlanetMaterial, createCloudMaterial, createAtmosphereMaterial, createRingMaterial, createSunMaterial,
} from './materials.js';
import { createRingTexture } from './rings.js';

const BUMPY = new Set(['rock', 'mercury', 'moon', 'mars', 'pluto', 'charon', 'ganymede', 'io', 'europa', 'triton', 'enceladus']);

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

function orientFromAxes(obj, xAxis, yAxis) {
  _x.copy(xAxis).normalize();
  _y.copy(yAxis);
  _y.addScaledVector(_x, -_y.dot(_x)).normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  obj.quaternion.setFromRotationMatrix(_m);
}

/** A lumpy, elongated sphere for the small irregular moons. */
function irregularGeometry(shape, seed) {
  const geo = new THREE.SphereGeometry(1, 48, 32);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 +
      0.07 * Math.sin(v.x * 3.1 + seed) * Math.sin(v.y * 2.7 + seed * 1.3) +
      0.05 * Math.sin(v.z * 5.3 + seed * 0.7) * Math.cos(v.x * 4.1) +
      0.025 * Math.sin(v.y * 9.7 + v.z * 7.3 + seed);
    v.multiplyScalar(n);
    p.setXYZ(i, v.x * shape[0], v.y * shape[2], v.z * shape[1]);
  }
  geo.computeVertexNormals();
  return geo;
}

function glowTexture(stops, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function raysTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.translate(size / 2, size / 2);
  g.globalCompositeOperation = 'lighter';
  let s = 7;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const a = rand() * Math.PI * 2;
    const len = size * (0.18 + rand() * 0.32);
    const w = 0.6 + rand() * 2.2;
    const grad = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
    grad.addColorStop(0, `rgba(255,220,170,${0.05 + rand() * 0.08})`);
    grad.addColorStop(1, 'rgba(255,200,140,0)');
    g.strokeStyle = grad;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class SunView {
  constructor(body, sphereGeo) {
    this.body = body;
    this.group = new THREE.Group();
    this.material = createSunMaterial();
    this.mesh = new THREE.Mesh(sphereGeo, this.material);
    this.mesh.scale.setScalar(body.radius);
    this.frame = new THREE.Group();
    orientFromAxes(this.frame, new THREE.Vector3(...body.eqNode), new THREE.Vector3(...body.pole));
    this.frame.add(this.mesh);
    this.group.add(this.frame);

    const corona = new THREE.SpriteMaterial({
      map: glowTexture([[0, 'rgba(255,240,210,1)'], [0.18, 'rgba(255,214,140,0.85)'], [0.4, 'rgba(255,150,60,0.25)'], [1, 'rgba(255,120,40,0)']]),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false,
    });
    this.corona = new THREE.Sprite(corona);
    this.corona.scale.setScalar(body.radius * 4.6);
    const halo = new THREE.SpriteMaterial({
      map: glowTexture([[0, 'rgba(255,200,130,0.55)'], [0.25, 'rgba(255,160,80,0.16)'], [0.6, 'rgba(255,120,60,0.04)'], [1, 'rgba(0,0,0,0)']]),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false,
    });
    this.halo = new THREE.Sprite(halo);
    this.halo.scale.setScalar(body.radius * 18);
    const rays = new THREE.SpriteMaterial({
      map: raysTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, opacity: 0.85,
    });
    this.rays = new THREE.Sprite(rays);
    this.rays.scale.setScalar(body.radius * 9);
    for (const s of [this.halo, this.rays, this.corona]) {
      s.renderOrder = 2;
      this.group.add(s);
    }
    this.light = 1;
  }

  update(t) {
    this.material.uniforms.uTime.value = t;
    this.mesh.rotation.y = this.body.spin;
    this.rays.material.rotation = t * 0.01;
    const pulse = 1 + 0.025 * Math.sin(t * 0.7) + 0.015 * Math.sin(t * 1.9 + 1);
    this.corona.scale.setScalar(this.body.radius * 4.6 * pulse);
  }

  /** Fade the large glow when the camera is very close so it doesn't wash out the view. */
  setCameraDistance(d) {
    const k = THREE.MathUtils.smoothstep(d, this.body.radius * 1.5, this.body.radius * 6);
    this.halo.material.opacity = 0.35 + 0.65 * k;
    this.rays.material.opacity = 0.3 + 0.55 * k;
  }
}

export class BodyView {
  constructor(body, { baker, sphereGeo }) {
    this.body = body;
    const def = body.def;
    this.group = new THREE.Group();
    this.frame = new THREE.Group();
    this.spinner = new THREE.Group();
    this.group.add(this.frame);
    this.frame.add(this.spinner);
    orientFromAxes(this.frame, new THREE.Vector3(...body.eqNode), new THREE.Vector3(...body.pole));

    const surf = def.surface;
    const map = baker.bake(surf);
    const night = def.night ? baker.bake(def.night) : null;
    const isEarth = surf.kind === 'earth';
    const texW = Math.min(surf.size || 1024, baker.maxSize);
    this.material = createPlanetMaterial({
      map,
      night,
      bump: BUMPY.has(surf.kind) ? 2.2 * (texW / 1024) : 0,
      spec: isEarth ? 1.0 : 0,
      atmosphere: def.atmosphere,
      ambient: 0.008,
    });
    this.material.uniforms.uTexel.value.set(1 / texW, 2 / texW);
    const geo = def.shape ? irregularGeometry(def.shape, surf.seed || 1) : sphereGeo;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.scale.setScalar(body.radius);
    this.spinner.add(this.mesh);

    if (def.clouds) {
      this.cloudMaterial = createCloudMaterial(baker.bake(def.clouds));
      this.clouds = new THREE.Mesh(sphereGeo, this.cloudMaterial);
      this.clouds.scale.setScalar(body.radius * 1.012);
      this.clouds.renderOrder = 1;
      this.spinner.add(this.clouds);
    }

    if (def.atmosphere) {
      const thick = def.atmosphere.glow ?? 0.5;
      this.atmoMaterial = createAtmosphereMaterial(def.atmosphere.color, 0.55 + 0.6 * thick);
      this.atmosphere = new THREE.Mesh(sphereGeo, this.atmoMaterial);
      this.atmosphere.scale.setScalar(body.radius * (1.035 + 0.035 * thick));
      this.atmosphere.renderOrder = 1;
      this.group.add(this.atmosphere);
    }

    if (def.rings) {
      const r = def.rings;
      this.ringTex = createRingTexture(r.kind, r.inner, r.outer);
      this.ringMaterial = createRingMaterial(this.ringTex, r.inner / r.outer, 1, r.opacity);
      this.ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.ringMaterial);
      this.ring.rotation.x = -Math.PI / 2;
      this.ring.scale.setScalar(r.outer * body.radius);
      this.ring.renderOrder = 3;
      this.frame.add(this.ring);
      const u = this.material.uniforms;
      u.uRingTex.value = this.ringTex;
      u.uRing.value.set(r.inner * body.radius, r.outer * body.radius, 1, r.opacity);
    }

    this.occluders = [];
    this.shadowTint = [0, 0, 0];
    this._pole = new THREE.Vector3(...body.pole);
    this._out = new THREE.Vector3();
    this._center = new THREE.Vector3();
  }

  /** Bodies that can cast shadows (eclipses) on this one. */
  setOccluders(list, tint = [0, 0, 0]) {
    this.occluders = list.slice(0, 4);
    this.shadowTint = tint;
    for (const m of [this.material, this.cloudMaterial]) {
      if (!m) continue;
      m.uniforms.uOccCount.value = this.occluders.length;
      m.uniforms.uShadowTint.value.set(...tint);
    }
  }

  update(cloudTime) {
    const b = this.body;
    this.group.position.set(b.pos[0], b.pos[1], b.pos[2]);
    if (b.tidallyLocked && b.parent) {
      // Keep the same face towards the parent (texture longitude 0 sits on local -X).
      this._out.set(b.local[0], b.local[1], b.local[2]);
      orientFromAxes(this.frame, this._out, this._pole);
    } else {
      this.spinner.rotation.y = b.spin;
    }
    if (this.clouds) this.clouds.rotation.y = cloudTime * 0.004;
    this._center.copy(this.group.position);
    const u = this.material.uniforms;
    u.uCenterW.value.copy(this._center);
    u.uPoleW.value.copy(this._pole);
    for (const m of [this.material, this.cloudMaterial]) {
      if (!m) continue;
      const occ = m.uniforms.uOcc.value;
      for (let i = 0; i < this.occluders.length; i++) {
        const o = this.occluders[i];
        occ[i].set(o.pos[0], o.pos[1], o.pos[2], o.radius);
      }
    }
    if (this.atmoMaterial) this.atmoMaterial.uniforms.uCenterW.value.copy(this._center);
    if (this.ringMaterial) {
      const ru = this.ringMaterial.uniforms;
      ru.uNormalW.value.copy(this._pole);
      ru.uCenterW.value.copy(this._center);
      ru.uPlanetR.value = b.radius;
    }
  }
}
