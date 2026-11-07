import * as THREE from 'three';
import { NOISE } from './glsl/noise.js';

// Custom shaders. Lighting is done in world space with the Sun at the origin.
// Surface textures hold sRGB colours and are linearised here; the output goes
// through three.js tone mapping and colour-space conversion.

const MAX_OCCLUDERS = 4;

const SHADOW_FUNCS = /* glsl */ `
uniform vec4 uOcc[${MAX_OCCLUDERS}];
uniform int uOccCount;
uniform vec3 uShadowTint;

float sphereShadow(vec3 P, vec3 L, float distToSun, vec4 occ) {
  vec3 oc = occ.xyz - P;
  float t = dot(oc, L);
  if (t <= 0.0 || t > distToSun) return 1.0;
  float d = length(oc - L * t);
  float pen = occ.w * 0.1 + t * 0.012;
  return smoothstep(occ.w - pen, occ.w + pen, d);
}

vec3 occlusion(vec3 P, vec3 L, float distToSun) {
  float s = 1.0;
  for (int i = 0; i < ${MAX_OCCLUDERS}; i++) {
    if (i >= uOccCount) break;
    s *= sphereShadow(P, L, distToSun, uOcc[i]);
  }
  return mix(uShadowTint * 0.18, vec3(1.0), s);
}
`;

const PLANET_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  vNormalW = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const PLANET_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uNight;
uniform sampler2D uRingTex;
uniform float uHasNight;
uniform float uBump;
uniform vec2 uTexel;
uniform vec3 uPoleW;
uniform vec3 uCenterW;
uniform float uAmbient;
uniform vec3 uSunColor;
uniform vec3 uAtmoColor;
uniform float uAtmo;
uniform float uSpec;
uniform vec4 uRing; // inner, outer (world), enabled, opacity
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;

${SHADOW_FUNCS}

float ringShadow(vec3 P, vec3 L) {
  if (uRing.z < 0.5) return 1.0;
  float denom = dot(L, uPoleW);
  if (abs(denom) < 1e-4) return 1.0;
  float t = dot(uCenterW - P, uPoleW) / denom;
  if (t <= 0.0) return 1.0;
  float r = length(P + L * t - uCenterW);
  if (r < uRing.x || r > uRing.y) return 1.0;
  float a = texture2D(uRingTex, vec2((r - uRing.x) / (uRing.y - uRing.x), 0.5)).a * uRing.w;
  return 1.0 - a * 0.85;
}

void main() {
  vec3 N = normalize(vNormalW);
  vec4 tex = texture2D(uMap, vUv);
  if (uBump > 0.0) {
    float hx1 = texture2D(uMap, vUv + vec2(uTexel.x, 0.0)).a;
    float hx0 = texture2D(uMap, vUv - vec2(uTexel.x, 0.0)).a;
    float hy1 = texture2D(uMap, vUv + vec2(0.0, uTexel.y)).a;
    float hy0 = texture2D(uMap, vUv - vec2(0.0, uTexel.y)).a;
    vec3 east = cross(uPoleW, N);
    float el = length(east);
    if (el > 1e-3) {
      east /= el;
      vec3 north = cross(N, east);
      N = normalize(N - uBump * ((hx1 - hx0) * east + (hy1 - hy0) * north));
    }
  }
  vec3 Lv = -vPosW;
  float dist = length(Lv);
  vec3 L = Lv / dist;
  vec3 V = normalize(cameraPosition - vPosW);
  float NdotL = dot(N, L);
  vec3 albedo = pow(tex.rgb, vec3(2.2));
  vec3 shade = occlusion(vPosW, L, dist) * ringShadow(vPosW, L);
  float wrap = uAtmo * 0.12;
  float diff = clamp((NdotL + wrap) / (1.0 + wrap), 0.0, 1.0);
  vec3 col = albedo * (uAmbient + uSunColor * diff * shade);
  if (uSpec > 0.0) {
    vec3 H = normalize(L + V);
    float s = pow(max(dot(N, H), 0.0), 70.0) * tex.a * uSpec * diff;
    col += uSunColor * shade * s * vec3(1.0, 0.92, 0.8);
  }
  if (uHasNight > 0.5) {
    float nightMask = smoothstep(0.08, -0.18, NdotL);
    col += pow(texture2D(uNight, vUv).rgb, vec3(2.0)) * nightMask * 1.4;
  }
  if (uAtmo > 0.0) {
    float mu = max(dot(normalize(vNormalW), V), 0.0);
    float fres = pow(1.0 - mu, 2.6);
    float lit = smoothstep(-0.3, 0.45, NdotL);
    vec3 atmo = pow(uAtmoColor, vec3(2.2));
    col = mix(col, atmo * (0.15 + 1.4 * lit), clamp(fres * uAtmo * lit * 0.8, 0.0, 1.0));
    col += atmo * pow(1.0 - mu, 6.0) * lit * 0.25 * uAtmo;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function occluderUniforms() {
  return {
    uOcc: { value: Array.from({ length: MAX_OCCLUDERS }, () => new THREE.Vector4()) },
    uOccCount: { value: 0 },
    uShadowTint: { value: new THREE.Vector3(0, 0, 0) },
  };
}

export function createPlanetMaterial({ map, night = null, bump = 0, spec = 0, atmosphere = null, ambient = 0.012 }) {
  const atmoColor = new THREE.Color(atmosphere ? atmosphere.color : '#000000');
  const w = map.image ? map.image.width : 1024;
  const h = map.image ? map.image.height : 512;
  return new THREE.ShaderMaterial({
    vertexShader: PLANET_VERT,
    fragmentShader: PLANET_FRAG,
    uniforms: {
      uMap: { value: map },
      uNight: { value: night || map },
      uRingTex: { value: map },
      uHasNight: { value: night ? 1 : 0 },
      uBump: { value: bump },
      uTexel: { value: new THREE.Vector2(1 / w, 1 / h) },
      uPoleW: { value: new THREE.Vector3(0, 1, 0) },
      uCenterW: { value: new THREE.Vector3() },
      uAmbient: { value: ambient },
      uSunColor: { value: new THREE.Vector3(1.0, 0.97, 0.92).multiplyScalar(1.15) },
      uAtmoColor: { value: new THREE.Vector3(atmoColor.r, atmoColor.g, atmoColor.b) },
      uAtmo: { value: atmosphere ? atmosphere.strength : 0 },
      uSpec: { value: spec },
      uRing: { value: new THREE.Vector4(0, 0, 0, 1) },
      ...occluderUniforms(),
    },
  });
}

// ------------------------------------------------------------- clouds ---
const CLOUD_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uSunColor;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
${SHADOW_FUNCS}
void main() {
  vec3 N = normalize(vNormalW);
  vec3 Lv = -vPosW;
  float dist = length(Lv);
  vec3 L = Lv / dist;
  float a = texture2D(uMap, vUv).a;
  float NdotL = dot(N, L);
  float lit = smoothstep(-0.12, 0.35, NdotL);
  vec3 shade = occlusion(vPosW, L, dist);
  vec3 col = vec3(0.92, 0.94, 0.97) * (0.01 + uSunColor * lit * shade);
  gl_FragColor = vec4(col, a * (0.25 + 0.75 * lit) * 0.92);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createCloudMaterial(map) {
  return new THREE.ShaderMaterial({
    vertexShader: PLANET_VERT,
    fragmentShader: CLOUD_FRAG,
    uniforms: {
      uMap: { value: map },
      uSunColor: { value: new THREE.Vector3(1.0, 0.97, 0.92).multiplyScalar(1.15) },
      ...occluderUniforms(),
    },
    transparent: true,
    depthWrite: false,
  });
}

// --------------------------------------------------------- atmosphere ---
const ATMO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
uniform vec3 uCenterW;
uniform float uInner;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec3 V = normalize(cameraPosition - vPosW);
  vec3 N = normalize(vNormalW);
  // Thickness of the glow shell along the view ray, peaking just outside the limb.
  float mu = abs(dot(N, V));
  float glow = pow(1.0 - mu, 1.5) * smoothstep(0.0, 0.35, mu + 0.02);
  vec3 L = normalize(-uCenterW);
  float lit = smoothstep(-0.45, 0.35, dot(N, L));
  float a = glow * lit * uStrength;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

export function createAtmosphereMaterial(color, strength) {
  const c = new THREE.Color(color);
  return new THREE.ShaderMaterial({
    vertexShader: PLANET_VERT,
    fragmentShader: ATMO_FRAG,
    uniforms: {
      uColor: { value: new THREE.Vector3(c.r, c.g, c.b) },
      uStrength: { value: strength },
      uCenterW: { value: new THREE.Vector3() },
      uInner: { value: 1 },
    },
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// --------------------------------------------------------------- rings ---
const RING_VERT = /* glsl */ `
varying vec2 vLocal;
varying vec3 vPosW;
void main() {
  vLocal = position.xy;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const RING_FRAG = /* glsl */ `
uniform sampler2D uRingTex;
uniform float uInner;
uniform float uOuter;
uniform float uOpacity;
uniform vec3 uNormalW;
uniform vec3 uCenterW;
uniform float uPlanetR;
uniform vec3 uSunColor;
varying vec2 vLocal;
varying vec3 vPosW;
void main() {
  float r = length(vLocal);
  if (r < uInner || r > uOuter) discard;
  float u = (r - uInner) / (uOuter - uInner);
  vec4 rt = texture2D(uRingTex, vec2(u, 0.5));
  float a = rt.a * uOpacity;
  if (a < 0.003) discard;
  vec3 col = pow(rt.rgb, vec3(2.2));
  vec3 Lv = -vPosW;
  float dist = length(Lv);
  vec3 L = Lv / dist;
  vec3 V = normalize(cameraPosition - vPosW);
  float ln = dot(uNormalW, L);
  float vn = dot(uNormalW, V);
  float lit = 0.25 + 0.75 * pow(abs(ln), 0.3);
  if (ln * vn < 0.0) {
    // Seeing the unlit face: only light diffusing through thin parts.
    lit *= mix(0.55, 0.06, rt.a);
  }
  // The planet's shadow across the rings.
  vec3 oc = uCenterW - vPosW;
  float t = dot(oc, L);
  float sh = 1.0;
  if (t > 0.0) {
    float d = length(oc - L * t);
    sh = smoothstep(uPlanetR * 0.97, uPlanetR * 1.03, d);
  }
  // Forward scattering when looking towards the Sun through the rings.
  float fwd = pow(max(dot(-V, L), 0.0), 12.0) * (1.0 - rt.a) * 0.8;
  vec3 c = col * uSunColor * (lit * (0.04 + 0.96 * sh)) + col * fwd * sh;
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createRingMaterial(ringTex, inner, outer, opacity) {
  return new THREE.ShaderMaterial({
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    uniforms: {
      uRingTex: { value: ringTex },
      uInner: { value: inner },
      uOuter: { value: outer },
      uOpacity: { value: opacity },
      uNormalW: { value: new THREE.Vector3(0, 1, 0) },
      uCenterW: { value: new THREE.Vector3() },
      uPlanetR: { value: 1 },
      uSunColor: { value: new THREE.Vector3(1.0, 0.97, 0.92).multiplyScalar(1.1) },
    },
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
}

// ----------------------------------------------------------------- Sun ---
const SUN_VERT = /* glsl */ `
varying vec3 vLocal;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vLocal = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SUN_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vLocal;
varying vec3 vNormalW;
varying vec3 vPosW;
${NOISE}
void main() {
  vec3 p = vLocal;
  float t = uTime * 0.02;
  vec3 w = vec3(snoise(p * 3.0 + t), snoise(p * 3.0 + 5.2 - t), snoise(p * 3.0 + 9.7 + t));
  float gran = fbm(p * 9.0 + w * 0.6 + vec3(0.0, t * 2.0, 0.0), 4);
  float cellN = 1.0 - cells(p * 26.0 + w * 0.4 + t).x;
  float spots = smoothstep(0.42, 0.58, fbm(p * 2.2 + vec3(t * 0.5), 4)) * smoothstep(0.55, 0.15, abs(p.y));
  vec3 V = normalize(cameraPosition - vPosW);
  float mu = max(dot(normalize(vNormalW), V), 0.0);
  float limb = 0.32 + 0.68 * pow(mu, 0.55);
  vec3 hot = vec3(1.0, 0.84, 0.52);
  vec3 warm = vec3(0.95, 0.42, 0.08);
  float g = clamp(0.5 + 0.75 * gran + 0.45 * cellN - 0.25, 0.0, 1.0);
  vec3 col = mix(warm, hot, g);
  col *= 1.0 - spots * 0.7;
  col *= limb;
  col = mix(vec3(1.0, 0.36, 0.06), col, smoothstep(0.0, 0.3, mu));
  gl_FragColor = vec4(col * 1.75, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSunMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: SUN_VERT,
    fragmentShader: SUN_FRAG,
    uniforms: { uTime: { value: 0 } },
  });
}

// --------------------------------------------------------- sky sphere ---
export function createSkyMaterial(map) {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uBrightness;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(uMap, vUv).rgb * uBrightness;
        gl_FragColor = vec4(c, 1.0);
      }`,
    uniforms: { uMap: { value: map }, uBrightness: { value: 1 } },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
}

// --------------------------------------------------------------- stars ---
export function createStarMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute vec3 aColor;
      attribute float aPhase;
      uniform float uPixelRatio;
      uniform float uTime;
      uniform float uBrightness;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
        float tw = 1.0 + 0.16 * sin(uTime * (0.8 + aPhase * 1.7) + aPhase * 60.0) * smoothstep(2.0, 5.0, aSize);
        float size = aSize * tw;
        gl_PointSize = max(1.0, size) * uPixelRatio * 1.35;
        vColor = aColor;
        vAlpha = clamp(size, 0.0, 1.0) * uBrightness;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d) * 4.0;
        float core = exp(-r2 * 7.0);
        float halo = exp(-r2 * 2.2) * 0.35;
        float a = (core + halo) * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor, a);
      }`,
    uniforms: { uPixelRatio: { value: 1 }, uTime: { value: 0 }, uBrightness: { value: 1 } },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
}

// ------------------------------------------------- beacons (min-size dots) ---
export function createBeaconMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aRadius;
      attribute float aVisible;
      uniform float uPixelRatio;
      uniform float uProjScale;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float rpx = aRadius * uProjScale / max(-mv.z, 1e-3);
        vAlpha = (1.0 - smoothstep(1.5, 4.0, rpx)) * aVisible;
        gl_PointSize = 7.0 * uPixelRatio;
        vColor = aColor;
        if (mv.z > 0.0) vAlpha = 0.0;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d) * 4.0;
        float a = (exp(-r2 * 9.0) + exp(-r2 * 3.0) * 0.35) * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor, a);
      }`,
    uniforms: { uPixelRatio: { value: 1 }, uProjScale: { value: 500 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ------------------------------------------------------ asteroid belts ---
export function createBeltMaterial(color, size, opacity) {
  const c = new THREE.Color(color);
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec4 aOrbit; // a (AU), mean motion (rad/day), phase, inclination
      attribute vec2 aExtra; // node, size jitter
      uniform float uDays;
      uniform float uBlend;
      uniform float uScaleK;
      uniform float uPixelRatio;
      uniform float uSize;
      varying float vAlpha;
      void main() {
        float ang = aOrbit.z + mod(aOrbit.y * uDays, 6.2831853);
        float r = aOrbit.x;
        float rs = mix(uScaleK * sqrt(r), uScaleK * r, uBlend);
        float z = sin(ang - aExtra.x) * sin(aOrbit.w);
        vec3 p = vec3(cos(ang) * rs, z * rs, -sin(ang) * rs);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * aExtra.y * uPixelRatio;
        vAlpha = smoothstep(0.0, 6.0, -mv.z);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = (1.0 - smoothstep(0.15, 0.5, length(d))) * uOpacity * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
    uniforms: {
      uDays: { value: 0 },
      uBlend: { value: 0 },
      uScaleK: { value: 30 },
      uPixelRatio: { value: 1 },
      uSize: { value: size },
      uColor: { value: new THREE.Vector3(c.r, c.g, c.b) },
      uOpacity: { value: opacity },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
