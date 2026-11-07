import * as THREE from 'three';

// Screen-space "fat" polylines: each point becomes two vertices pushed apart
// perpendicular to the line on screen, so widths are in pixels and stay crisp
// on high-DPI phones. Segments behind the camera are clipped to the near
// plane in view space. Alpha can fade along the line (for trails) and the line
// can taper. Drawn additively so fading to zero simply disappears.

const VERT = /* glsl */ `
attribute vec3 aPrev;
attribute vec3 aNext;
attribute float aSide;
attribute float aT;
uniform vec2 uResolution;
uniform float uWidth;
uniform float uTaper;
uniform float uNear;
varying float vT;
varying float vSide;
varying float vAlpha;
varying float vDepth;

vec4 clipNear(vec4 v, vec4 other) {
  float nz = -uNear;
  if (v.z <= nz) return v;
  if (other.z >= nz) return v;
  float t = (nz - v.z) / (other.z - v.z);
  return mix(v, other, t);
}

void main() {
  vec4 cv = modelViewMatrix * vec4(position, 1.0);
  vec4 pv = modelViewMatrix * vec4(aPrev, 1.0);
  vec4 nv = modelViewMatrix * vec4(aNext, 1.0);
  vAlpha = 1.0;
  float nz = -uNear;
  if (cv.z > nz) {
    vec4 other = pv.z < nz ? pv : nv;
    if (other.z < nz) cv = clipNear(cv, other);
    else vAlpha = 0.0;
  }
  if (pv.z > nz) pv = cv;
  if (nv.z > nz) nv = cv;
  vec4 c = projectionMatrix * cv;
  vec4 p = projectionMatrix * pv;
  vec4 n = projectionMatrix * nv;
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 cs = c.xy / c.w * aspect;
  vec2 ps = p.xy / p.w * aspect;
  vec2 ns = n.xy / n.w * aspect;
  vec2 d1 = cs - ps;
  vec2 d2 = ns - cs;
  float l1 = length(d1), l2 = length(d2);
  vec2 dir;
  if (l1 < 1e-7 && l2 < 1e-7) dir = vec2(1.0, 0.0);
  else if (l1 < 1e-7) dir = d2 / l2;
  else if (l2 < 1e-7) dir = d1 / l1;
  else dir = normalize(d1 / l1 + d2 / l2);
  vec2 normal = vec2(-dir.y, dir.x) / aspect;
  float w = uWidth * mix(uTaper, 1.0, aT);
  c.xy += normal * aSide * w / uResolution.y * c.w;
  gl_Position = c;
  vT = aT;
  vSide = aSide;
  vDepth = -cv.z;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uFade;
uniform float uFadeDepth;
varying float vT;
varying float vSide;
varying float vAlpha;
varying float vDepth;
void main() {
  float a = uOpacity * vAlpha * mix(1.0, pow(vT, 1.7), uFade);
  // Optionally fade the parts of the line close to the camera.
  if (uFadeDepth > 0.0) a *= smoothstep(uFadeDepth * 0.3, uFadeDepth, vDepth);
  float edge = 1.0 - pow(abs(vSide), 3.0);
  a *= edge;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

export class FatLine extends THREE.Mesh {
  constructor(maxPoints, { color = '#ffffff', width = 1.5, opacity = 1, fade = 0, taper = 1 } = {}) {
    const geo = new THREE.BufferGeometry();
    const n = maxPoints;
    const pos = new Float32Array(n * 2 * 3);
    const prev = new Float32Array(n * 2 * 3);
    const next = new Float32Array(n * 2 * 3);
    const side = new Float32Array(n * 2);
    const tAttr = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      side[i * 2] = -1;
      side[i * 2 + 1] = 1;
    }
    const index = new (n * 2 > 65535 ? Uint32Array : Uint16Array)((n - 1) * 6);
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aPrev', new THREE.BufferAttribute(prev, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aNext', new THREE.BufferAttribute(next, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setAttribute('aT', new THREE.BufferAttribute(tAttr, 1).setUsage(THREE.DynamicDrawUsage));
    const c = new THREE.Color(color);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uResolution: { value: new THREE.Vector2(1, 1) },
        uWidth: { value: width },
        uTaper: { value: taper },
        uNear: { value: 0.01 },
        uColor: { value: new THREE.Vector3(c.r, c.g, c.b) },
        uOpacity: { value: opacity },
        uFade: { value: fade },
        uFadeDepth: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide, // quad winding flips with the line's on-screen direction
      blending: THREE.AdditiveBlending,
    });
    super(geo, mat);
    this.maxPoints = n;
    this.cssWidth = width;
    this.frustumCulled = false;
    this.pointCount = 0;
  }

  /** points: flat xyz array; count: number of points used. */
  setPoints(points, count = points.length / 3, closed = false) {
    const geo = this.geometry;
    const pos = geo.attributes.position.array;
    const prev = geo.attributes.aPrev.array;
    const next = geo.attributes.aNext.array;
    const tA = geo.attributes.aT.array;
    const n = Math.min(count, this.maxPoints);
    for (let i = 0; i < n; i++) {
      const pi = i > 0 ? i - 1 : closed ? n - 2 : 0;
      const ni = i < n - 1 ? i + 1 : closed ? 1 : n - 1;
      for (let s = 0; s < 2; s++) {
        const v = (i * 2 + s) * 3;
        pos[v] = points[i * 3]; pos[v + 1] = points[i * 3 + 1]; pos[v + 2] = points[i * 3 + 2];
        prev[v] = points[pi * 3]; prev[v + 1] = points[pi * 3 + 1]; prev[v + 2] = points[pi * 3 + 2];
        next[v] = points[ni * 3]; next[v + 1] = points[ni * 3 + 1]; next[v + 2] = points[ni * 3 + 2];
        tA[i * 2 + s] = n > 1 ? i / (n - 1) : 1;
      }
    }
    geo.setDrawRange(0, Math.max(0, n - 1) * 6);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aPrev.needsUpdate = true;
    geo.attributes.aNext.needsUpdate = true;
    geo.attributes.aT.needsUpdate = true;
    this.pointCount = n;
  }

  setViewport(width, height, pixelRatio, near) {
    const u = this.material.uniforms;
    u.uResolution.value.set(width * pixelRatio, height * pixelRatio);
    u.uWidth.value = this.cssWidth * pixelRatio;
    u.uNear.value = near;
  }

  set fadeDepth(d) {
    this.material.uniforms.uFadeDepth.value = d;
  }

  set color(hex) {
    const c = new THREE.Color(hex);
    this.material.uniforms.uColor.value.set(c.r, c.g, c.b);
  }

  set opacity(v) {
    this.material.uniforms.uOpacity.value = v;
  }

  get opacity() {
    return this.material.uniforms.uOpacity.value;
  }
}
