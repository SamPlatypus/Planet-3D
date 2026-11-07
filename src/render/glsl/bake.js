import { NOISE } from './noise.js';

// Procedural surface textures, rendered once on the GPU into equirectangular
// render targets that match three.js SphereGeometry UVs. Each texel is turned
// into a unit direction p on the sphere and the surface is painted from 3D
// noise at p, so there are no seams or pinched poles. Output: rgb = sRGB
// colour, a = height (rocky bodies) or ocean mask (Earth) or coverage (clouds).

export const BAKE_KINDS = {
  rock: 0, moon: 1, venus: 3, earth: 4, earthClouds: 5, earthNight: 6, mars: 7,
  jupiter: 8, saturn: 9, uranus: 10, neptune: 11, pluto: 12, io: 13, europa: 14,
  ganymede: 15, titan: 16, enceladus: 17, triton: 18, charon: 19, sky: 20,
};

export const BAKE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const BAKE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform int uKind;
uniform vec3 uSeed;
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec4 uParams;
uniform vec4 uRegion;
uniform vec3 uGalPole;
uniform vec3 uGalCenter;

${NOISE}

const float PI = 3.14159265359;

vec3 dirFromUv(vec2 uv) {
  float phi = uv.x * 2.0 * PI;
  float theta = (1.0 - uv.y) * PI;
  return vec3(-cos(phi) * sin(theta), cos(theta), sin(phi) * sin(theta));
}

vec3 dirLL(float latDeg, float lonDeg) {
  float la = radians(latDeg), lo = radians(lonDeg);
  return vec3(-cos(lo) * cos(la), sin(la), sin(lo) * cos(la));
}

vec3 hex(float r, float g, float b) { return vec3(r, g, b) / 255.0; }

// Swirl the domain around an axis inside an elliptical storm.
vec3 storm(vec3 p, vec3 c, float size, float twist, out float inside) {
  float d = acos(clamp(dot(p, c), -1.0, 1.0)) / size;
  // Squash north-south: storms are wider than tall.
  vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), c));
  float dy = dot(p - c, vec3(0.0, 1.0, 0.0));
  float dx = dot(p - c, east);
  float e = length(vec2(dx / size, dy / (size * 0.55)));
  inside = 1.0 - smoothstep(0.75, 1.05, e);
  float amt = twist * exp(-e * e * 1.6);
  return rotateAround(p, c, amt);
}

// ---------------------------------------------------------------- rocky ---
vec4 kRock(vec3 p) {
  vec3 s = uSeed;
  float n = fbm(p * 2.6 + s, 5);
  float m = fbm(p * 11.0 + s * 1.7, 4);
  float c = craters(p * 5.0 + s, 0.55) * 0.55
          + craters(p * 11.0 + s * 2.0, 0.6) * 0.35
          + craters(p * 26.0 + s * 3.0, 0.7) * 0.2;
  c *= uParams.x;
  float t = 0.5 + 0.38 * n + 0.12 * m + 0.16 * c;
  if (uParams.z > 0.0) {
    // Patchwork terrain (Miranda).
    float patchN = fbm(p * 1.4 + s * 0.3, 3);
    t += 0.22 * smoothstep(-0.05, 0.05, patchN) - 0.1;
    t += 0.08 * sin(dot(p, vec3(18.0, 5.0, 9.0)) + patchN * 12.0) * step(0.0, patchN);
  }
  vec3 col = mix(uColA, uColB, clamp(t, 0.0, 1.0));
  if (uParams.y > 0.0) {
    // Bright fresh-ice crater specks (Callisto).
    float sp = max(0.0, craters(p * 34.0 + s * 5.0, 0.35));
    col = mix(col, vec3(0.92, 0.9, 0.86), clamp(sp * 0.9, 0.0, 0.85));
  }
  return vec4(col, clamp(0.5 + 0.22 * n + 0.28 * c, 0.0, 1.0));
}

vec4 kMoon(vec3 p) {
  vec3 s = uSeed;
  // Maria concentrate on the near side (local -X faces the parent).
  float mare = fbm(p * 1.5 + s, 5) + 0.32 * dot(p, vec3(-1.0, 0.1, 0.0)) - 0.02;
  float maria = smoothstep(0.02, 0.12, mare);
  float n = fbm(p * 6.0 + s * 2.0, 4);
  float c = craters(p * 5.0 + s, 0.5) * 0.6 + craters(p * 12.0 + s * 2.0, 0.6) * 0.35
          + craters(p * 28.0 + s * 3.0, 0.7) * 0.18;
  c *= mix(1.0, 0.35, maria);
  vec3 high = hex(196.0, 190.0, 180.0);
  vec3 low = hex(88.0, 86.0, 84.0);
  vec3 col = mix(high, low, maria * 0.85);
  col *= 0.86 + 0.14 * n + 0.15 * c;
  // A young rayed crater in the south (Tycho).
  vec3 ty = dirLL(-43.0, 349.0);
  float dt = acos(clamp(dot(p, ty), -1.0, 1.0));
  vec3 ref = normalize(cross(ty, vec3(0.0, 1.0, 0.0)));
  float ang = atan(dot(p, cross(ty, ref)), dot(p, ref));
  float rays = pow(max(0.0, snoise(vec3(ang * 6.0, 0.0, 2.0))), 2.0) * exp(-dt * 2.6);
  col += vec3(0.5) * (rays * 0.6 + exp(-dt * dt * 900.0) * 0.6);
  return vec4(col, clamp(0.5 + 0.3 * c + 0.15 * n - 0.1 * maria, 0.0, 1.0));
}

// ---------------------------------------------------------------- Venus ---
vec4 kVenus(vec3 p) {
  vec3 s = uSeed;
  vec3 w = vec3(fbm(p * 1.8 + s, 4), fbm(p * 1.8 + s + 5.2, 4), fbm(p * 1.8 + s + 9.1, 4));
  float lon = atan(p.z, -p.x);
  // The "Y" feature: chevrons pointing west from the equator.
  float chevron = sin(lon * 1.0 + abs(p.y) * 5.0 + w.x * 2.0);
  float bands = fbm(vec3(p.x * 1.6, p.y * 7.0, p.z * 1.6) + w * 0.9 + s, 5);
  float t = 0.55 + 0.55 * bands + 0.12 * chevron;
  vec3 col = mix(hex(186.0, 142.0, 82.0), hex(246.0, 230.0, 190.0), clamp(t, 0.0, 1.0));
  col = mix(col, hex(252.0, 244.0, 222.0), smoothstep(0.7, 1.0, abs(p.y)) * 0.5);
  return vec4(col, 1.0);
}

// ---------------------------------------------------------------- Earth ---
float earthHeight(vec3 p) {
  vec3 s = uSeed;
  vec3 w = vec3(fbm(p * 1.2 + s, 4), fbm(p * 1.2 + s + 3.1, 4), fbm(p * 1.2 + s + 7.7, 4));
  return fbm(p * 1.5 + w * 0.75 + s, 6) + 0.1 * fbm(p * 8.0 + s, 4) - 0.02;
}

vec4 kEarth(vec3 p) {
  vec3 s = uSeed;
  float h = earthHeight(p);
  float lat = abs(p.y);
  float land = smoothstep(0.035, 0.05, h);
  vec3 deep = hex(8.0, 30.0, 74.0);
  vec3 shallow = hex(24.0, 104.0, 160.0);
  vec3 ocean = mix(deep, shallow, smoothstep(-0.18, 0.04, h));
  float moist = fbm(p * 2.2 + s + 11.0, 4) * 0.9 + 0.55
              - 0.75 * exp(-pow((lat - 0.42) / 0.13, 2.0))
              + 0.25 * exp(-pow(lat / 0.15, 2.0));
  vec3 desert = hex(200.0, 168.0, 108.0);
  vec3 grass = hex(84.0, 120.0, 52.0);
  vec3 forest = hex(36.0, 74.0, 34.0);
  vec3 tundra = hex(122.0, 118.0, 96.0);
  vec3 rockC = hex(110.0, 94.0, 76.0);
  vec3 landC = mix(desert, grass, smoothstep(0.25, 0.55, moist));
  landC = mix(landC, forest, smoothstep(0.6, 0.95, moist));
  landC = mix(landC, tundra, smoothstep(0.62, 0.8, lat));
  landC = mix(landC, rockC, smoothstep(0.32, 0.55, h) * 0.8);
  landC *= 0.9 + 0.2 * fbm(p * 18.0 + s, 3);
  vec3 col = mix(ocean, landC, land);
  float ice = smoothstep(0.88, 0.93, lat + 0.04 * fbm(p * 6.0 + s, 3));
  ice = max(ice, smoothstep(0.8, 0.86, -p.y + 0.05 * fbm(p * 5.0, 3)));
  ice = max(ice, land * smoothstep(0.42, 0.6, h) * smoothstep(0.55, 0.75, lat));
  col = mix(col, hex(236.0, 242.0, 248.0), ice);
  float spec = (1.0 - land) * (1.0 - ice);
  return vec4(col, spec);
}

vec4 kEarthClouds(vec3 p) {
  vec3 s = uSeed + 20.0;
  float lat = abs(p.y);
  vec3 w = vec3(fbm(p * 2.0 + s, 3), fbm(p * 2.0 + s + 4.0, 3), fbm(p * 2.0 + s + 8.0, 3));
  vec3 q = vec3(p.x * 1.0, p.y * 1.8, p.z * 1.0);
  float c = fbm(q * 2.6 + w * 1.1 + s, 6);
  float cover = c + 0.22 * exp(-pow(lat / 0.12, 2.0))
                  + 0.2 * exp(-pow((lat - 0.78) / 0.14, 2.0))
                  - 0.16 * exp(-pow((lat - 0.42) / 0.12, 2.0)) + 0.02;
  float a = smoothstep(0.02, 0.42, cover);
  a *= 0.75 + 0.25 * fbm(p * 22.0 + s, 3);
  return vec4(vec3(1.0), clamp(a, 0.0, 1.0));
}

vec4 kEarthNight(vec3 p) {
  vec3 s = uSeed;
  float h = earthHeight(p);
  float land = smoothstep(0.04, 0.06, h);
  float coast = exp(-pow((h - 0.05) / 0.08, 2.0));
  float lat = abs(p.y);
  float regions = smoothstep(-0.05, 0.25, fbm(p * 3.0 + s + 40.0, 3));
  float city = pow(max(0.0, fbm(p * 46.0 + s, 3) + 0.15), 2.2) * 3.0;
  float lights = land * city * (0.35 + 0.65 * regions + 0.6 * coast) * (1.0 - smoothstep(0.7, 0.82, lat));
  lights *= 1.0 - smoothstep(0.42, 0.6, h);
  vec3 col = hex(255.0, 190.0, 110.0) * clamp(lights, 0.0, 1.0);
  return vec4(col, 1.0);
}

// ----------------------------------------------------------------- Mars ---
vec4 kMars(vec3 p) {
  vec3 s = uSeed;
  float n = fbm(p * 2.2 + s, 6);
  float dark = smoothstep(0.02, 0.22, fbm(p * 1.3 + s + 5.0, 4) - 0.18 * p.y);
  vec3 col = mix(hex(196.0, 104.0, 58.0), hex(150.0, 72.0, 40.0), 0.5 + 0.6 * n);
  col = mix(col, hex(92.0, 50.0, 34.0), dark * 0.7);
  // Valles Marineris: a dark gash just south of the equator.
  float lon = atan(p.z, -p.x);
  float vm = exp(-pow((p.y + 0.14 + 0.03 * snoise(p * 6.0 + s)) / 0.018, 2.0))
           * smoothstep(0.0, 0.25, lon + 1.2) * (1.0 - smoothstep(0.85, 1.15, lon + 1.2));
  col = mix(col, hex(70.0, 36.0, 26.0), vm * 0.8);
  // Tharsis volcanoes as bright-rimmed spots.
  float om = exp(-pow(acos(clamp(dot(p, dirLL(18.0, 226.0)), -1.0, 1.0)) / 0.05, 2.0));
  col = mix(col, hex(214.0, 150.0, 108.0), om * 0.6);
  float c = craters(p * 7.0 + s, 0.45) * 0.5 + craters(p * 16.0 + s * 2.0, 0.5) * 0.25;
  col *= 0.95 + 0.12 * c;
  float capN = smoothstep(0.962, 0.975, p.y + 0.012 * fbm(p * 8.0 + s, 3));
  float capS = smoothstep(0.975, 0.985, -p.y + 0.01 * fbm(p * 8.0 + s + 2.0, 3));
  col = mix(col, hex(244.0, 238.0, 232.0), max(capN, capS));
  return vec4(col, clamp(0.5 + 0.3 * n + 0.25 * c * (1.0 - max(capN, capS)) + 0.2 * om, 0.0, 1.0));
}

// --------------------------------------------------------- gas giants ---
vec3 jupiterBands(float b, float fine) {
  // Alternating bright zones and darker belts by latitude (sin lat).
  float s1 = sin(b * 23.0 + 0.4);
  float s2 = sin(b * 11.0 + 1.3);
  float belt = smoothstep(-0.2, 0.55, s1 * 0.7 + s2 * 0.45);
  vec3 zone = hex(238.0, 226.0, 204.0);
  vec3 beltC = mix(hex(176.0, 116.0, 74.0), hex(140.0, 92.0, 64.0), smoothstep(0.0, 1.0, s2 * 0.5 + 0.5));
  vec3 col = mix(zone, beltC, belt);
  // Equatorial zone tint.
  col = mix(col, hex(228.0, 200.0, 160.0), exp(-pow(b / 0.06, 2.0)) * 0.6);
  col *= 0.9 + 0.2 * fine;
  return col;
}

vec4 kJupiter(vec3 p) {
  vec3 s = uSeed;
  float inGRS;
  vec3 c = dirLL(-22.0, 60.0);
  vec3 q = storm(p, c, 0.2, 2.6, inGRS);
  float inOval;
  q = storm(q, dirLL(-33.0, 150.0), 0.06, 2.0, inOval);
  float warp = fbm(vec3(q.x * 3.0, q.y * 20.0, q.z * 3.0) + s, 5) * 0.045
             + fbm(q * 7.0 + s, 4) * 0.02;
  float b = q.y + warp;
  float fine = fbm(vec3(q.x * 8.0, q.y * 50.0, q.z * 8.0) + s, 4);
  vec3 col = jupiterBands(b, fine);
  // Festoons and white ovals along belt edges.
  float edge = abs(sin(b * 23.0 + 0.4));
  col = mix(col, hex(250.0, 244.0, 232.0), smoothstep(0.82, 0.98, fbm(q * 14.0 + s, 3) + 0.5) * (1.0 - edge) * 0.5);
  // Great Red Spot.
  vec3 grs = mix(hex(206.0, 108.0, 70.0), hex(226.0, 150.0, 104.0), 0.5 + 0.5 * fine);
  col = mix(col, grs, inGRS * 0.92);
  col = mix(col, hex(250.0, 244.0, 236.0), inOval * 0.85);
  // Mottled bluish-grey poles.
  float pole = smoothstep(0.72, 0.92, abs(p.y));
  col = mix(col, hex(150.0, 140.0, 130.0) * (0.85 + 0.3 * fbm(p * 10.0 + s, 4)), pole * 0.8);
  return vec4(col, 1.0);
}

vec4 kSaturn(vec3 p) {
  vec3 s = uSeed;
  float warp = fbm(vec3(p.x * 2.5, p.y * 18.0, p.z * 2.5) + s, 4) * 0.025;
  float b = p.y + warp;
  float fine = fbm(vec3(p.x * 6.0, p.y * 60.0, p.z * 6.0) + s, 3);
  float s1 = sin(b * 30.0), s2 = sin(b * 13.0 + 0.7);
  float belt = smoothstep(-0.3, 0.8, s1 * 0.5 + s2 * 0.6);
  vec3 col = mix(hex(236.0, 218.0, 170.0), hex(198.0, 164.0, 104.0), belt);
  col *= 0.94 + 0.1 * fine;
  col = mix(col, hex(244.0, 228.0, 186.0), exp(-pow(b / 0.1, 2.0)) * 0.5);
  // Blue-grey north polar region with the hexagon.
  float r = acos(clamp(p.y, -1.0, 1.0));
  float a = atan(p.z, p.x);
  float sector = mod(a + 0.3, PI / 3.0) - PI / 6.0;
  float hexR = r * cos(sector);
  float inHex = 1.0 - smoothstep(0.235, 0.25, hexR);
  col = mix(col, hex(150.0, 160.0, 150.0), smoothstep(0.82, 0.96, p.y) * 0.7);
  col = mix(col, hex(110.0, 120.0, 128.0), inHex * 0.55);
  col = mix(col, hex(90.0, 96.0, 104.0), exp(-pow((hexR - 0.245) / 0.008, 2.0)) * 0.6);
  col = mix(col, hex(172.0, 156.0, 120.0), smoothstep(0.85, 0.97, -p.y) * 0.5);
  return vec4(col, 1.0);
}

vec4 kUranus(vec3 p) {
  vec3 s = uSeed;
  float b = p.y + fbm(vec3(p.x * 2.0, p.y * 12.0, p.z * 2.0) + s, 3) * 0.02;
  vec3 col = mix(hex(150.0, 214.0, 222.0), hex(186.0, 236.0, 240.0), 0.5 + 0.5 * sin(b * 9.0));
  col *= 0.97 + 0.05 * fbm(vec3(p.x * 4.0, p.y * 40.0, p.z * 4.0) + s, 3);
  col = mix(col, hex(210.0, 244.0, 246.0), smoothstep(0.6, 0.95, -p.y) * 0.5);
  col = mix(col, vec3(1.0), smoothstep(0.82, 1.0, fbm(p * 9.0 + s, 3) + 0.4) * exp(-pow((p.y - 0.5) / 0.08, 2.0)) * 0.4);
  return vec4(col, 1.0);
}

vec4 kNeptune(vec3 p) {
  vec3 s = uSeed;
  float inGDS;
  vec3 q = storm(p, dirLL(-22.0, 200.0), 0.13, 1.8, inGDS);
  float b = q.y + fbm(vec3(q.x * 2.5, q.y * 16.0, q.z * 2.5) + s, 4) * 0.035;
  vec3 col = mix(hex(46.0, 84.0, 200.0), hex(70.0, 118.0, 228.0), 0.5 + 0.5 * sin(b * 14.0 + 0.5));
  col *= 0.92 + 0.12 * fbm(vec3(q.x * 5.0, q.y * 40.0, q.z * 5.0) + s, 3);
  col = mix(col, hex(24.0, 40.0, 112.0), inGDS * 0.85);
  // Bright methane-ice cirrus streaks.
  float streak = smoothstep(0.55, 0.8, fbm(vec3(q.x * 3.0, q.y * 34.0, q.z * 3.0) + s + 9.0, 4) + 0.35);
  float lanes = exp(-pow((p.y + 0.48) / 0.07, 2.0)) + exp(-pow((p.y - 0.4) / 0.06, 2.0)) * 0.7;
  float compan = exp(-pow(acos(clamp(dot(p, dirLL(-30.0, 206.0)), -1.0, 1.0)) / 0.05, 2.0));
  col = mix(col, vec3(0.95, 0.97, 1.0), clamp(streak * lanes + compan, 0.0, 0.9));
  col = mix(col, hex(80.0, 120.0, 220.0), smoothstep(0.8, 1.0, abs(p.y)) * 0.3);
  return vec4(col, 1.0);
}

// ---------------------------------------------------------- icy moons ---
vec4 kPluto(vec3 p) {
  vec3 s = uSeed;
  float n = fbm(p * 3.0 + s, 5);
  vec3 col = mix(hex(178.0, 140.0, 104.0), hex(222.0, 196.0, 160.0), 0.5 + 0.6 * n);
  // Dark reddish equatorial belt (Cthulhu Macula).
  float lon = atan(p.z, -p.x);
  float belt = exp(-pow((p.y + 0.05 + 0.08 * fbm(p * 4.0 + s, 3)) / 0.22, 2.0))
             * smoothstep(-0.2, 0.4, sin(lon * 1.0 + 1.2) + 0.4 * fbm(p * 2.0 + s, 3));
  col = mix(col, hex(84.0, 44.0, 32.0), belt * 0.85);
  // The heart (Tombaugh Regio): implicit heart curve in a local tangent frame.
  vec3 c = dirLL(15.0, 180.0);
  vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), c));
  vec3 north = cross(c, east);
  vec2 h = vec2(dot(p, east), dot(p, north) - 0.04) / 0.36;
  h.x *= 1.0 + 0.08 * snoise(p * 6.0 + s);
  float heartF = pow(h.x * h.x + h.y * h.y - 1.0, 3.0) - h.x * h.x * h.y * h.y * h.y;
  float heart = (1.0 - smoothstep(-0.03, 0.03, heartF)) * step(0.0, dot(p, c));
  float sputnik = heart * (1.0 - smoothstep(-0.05, 0.1, h.x));
  col = mix(col, hex(240.0, 226.0, 206.0), heart * 0.85);
  col = mix(col, hex(250.0, 244.0, 232.0), sputnik * 0.7);
  col = mix(col, hex(216.0, 200.0, 186.0), smoothstep(0.75, 0.95, p.y) * 0.5);
  float cr = craters(p * 8.0 + s, 0.4) * (1.0 - heart);
  col *= 0.95 + 0.1 * cr;
  return vec4(col, clamp(0.5 + 0.25 * n + 0.2 * cr - 0.2 * heart, 0.0, 1.0));
}

vec4 kIo(vec3 p) {
  vec3 s = uSeed;
  float n = fbm(p * 3.0 + s, 5);
  vec3 col = mix(hex(232.0, 208.0, 98.0), hex(244.0, 236.0, 180.0), smoothstep(-0.2, 0.4, n));
  col = mix(col, hex(206.0, 140.0, 60.0), smoothstep(0.15, 0.45, fbm(p * 5.0 + s + 3.0, 4)) * 0.6);
  vec2 cl = cells(p * 7.0 + s);
  float spot = step(0.55, fract(cl.y * 13.7));
  float vent = (1.0 - smoothstep(0.06, 0.12, cl.x)) * spot;
  float halo = (1.0 - smoothstep(0.12, 0.32, cl.x)) * spot * step(0.8, fract(cl.y * 7.3));
  col = mix(col, hex(196.0, 80.0, 44.0), halo * 0.55);
  col = mix(col, hex(40.0, 26.0, 18.0), vent);
  col = mix(col, hex(200.0, 190.0, 160.0), smoothstep(0.8, 0.95, abs(p.y)) * 0.5);
  return vec4(col, 0.5 + 0.2 * n);
}

vec4 kEuropa(vec3 p) {
  vec3 s = uSeed;
  float n = fbm(p * 2.0 + s, 5);
  vec3 col = mix(hex(232.0, 222.0, 200.0), hex(186.0, 150.0, 112.0), smoothstep(0.0, 0.5, n) * 0.7);
  float lines = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec3 q = p * (3.0 + fi * 2.3) + s + fi * 7.1;
    float r = 1.0 - abs(snoise(q + 0.3 * vec3(snoise(q * 2.0), 0.0, 0.0)));
    lines = max(lines, smoothstep(0.955 - fi * 0.01, 0.99, r));
  }
  col = mix(col, hex(140.0, 82.0, 52.0), lines * 0.75);
  float cr = craters(p * 6.0 + s, 0.12);
  col *= 0.97 + 0.06 * cr;
  return vec4(col, 0.5 + 0.1 * lines);
}

vec4 kGanymede(vec3 p) {
  vec3 s = uSeed;
  float n = fbm(p * 2.2 + s, 5);
  float bright = smoothstep(-0.05, 0.1, n);
  vec3 dark = hex(92.0, 80.0, 66.0);
  vec3 light = hex(184.0, 172.0, 154.0);
  float grooves = 0.5 + 0.5 * sin(dot(p, vec3(40.0, 13.0, 27.0)) + fbm(p * 4.0 + s, 3) * 10.0);
  vec3 col = mix(dark, light * (0.9 + 0.12 * grooves), bright);
  float c = craters(p * 9.0 + s, 0.45) * 0.4 + craters(p * 20.0 + s, 0.5) * 0.25;
  col *= 0.94 + 0.14 * c;
  col = mix(col, hex(220.0, 220.0, 220.0), smoothstep(0.75, 0.92, abs(p.y)) * 0.4);
  return vec4(col, clamp(0.5 + 0.2 * n + 0.3 * c, 0.0, 1.0));
}

vec4 kTitan(vec3 p) {
  vec3 s = uSeed;
  float b = p.y + fbm(p * 2.0 + s, 3) * 0.05;
  vec3 col = mix(hex(212.0, 148.0, 68.0), hex(232.0, 176.0, 96.0), 0.5 + 0.5 * sin(b * 6.0));
  col *= 0.95 + 0.08 * fbm(p * 5.0 + s, 3);
  col = mix(col, hex(170.0, 110.0, 50.0), smoothstep(0.7, 0.95, p.y) * 0.6);
  return vec4(col, 1.0);
}

vec4 kEnceladus(vec3 p) {
  vec3 s = uSeed;
  float n = fbm(p * 4.0 + s, 4);
  vec3 col = mix(hex(226.0, 232.0, 238.0), hex(250.0, 252.0, 255.0), 0.5 + 0.5 * n);
  float c = craters(p * 9.0 + s, 0.5) * step(0.0, p.y);
  col *= 0.96 + 0.06 * c;
  float stripes = exp(-pow(sin(p.x * 26.0 + 0.6 * snoise(p * 5.0 + s)) / 0.12, 2.0))
                * smoothstep(-0.78, -0.86, p.y);
  col = mix(col, hex(120.0, 170.0, 200.0), stripes * 0.8);
  return vec4(col, 0.5 + 0.2 * c);
}

vec4 kTriton(vec3 p) {
  vec3 s = uSeed;
  vec2 cl = cells(p * 14.0 + s);
  float melon = smoothstep(0.2, 0.5, cl.x);
  vec3 col = mix(hex(214.0, 190.0, 178.0), hex(232.0, 214.0, 204.0), melon);
  col *= 0.94 + 0.1 * fbm(p * 6.0 + s, 3);
  float cap = smoothstep(0.1, 0.3, -p.y + 0.1 * fbm(p * 5.0 + s, 3));
  col = mix(col, hex(246.0, 230.0, 222.0), cap);
  float streaks = smoothstep(0.6, 0.8, fbm(vec3(p.x * 20.0, p.y * 4.0, p.z * 20.0) + s, 3) + 0.4) * cap;
  col = mix(col, hex(110.0, 90.0, 84.0), streaks * 0.6);
  return vec4(col, 0.5 + 0.2 * melon);
}

vec4 kCharon(vec3 p) {
  vec3 s = uSeed;
  float n = fbm(p * 3.0 + s, 5);
  vec3 col = mix(hex(118.0, 112.0, 108.0), hex(176.0, 170.0, 164.0), 0.5 + 0.6 * n);
  float c = craters(p * 8.0 + s, 0.45) * 0.5 + craters(p * 18.0 + s, 0.5) * 0.25;
  col *= 0.93 + 0.14 * c;
  col = mix(col, hex(112.0, 62.0, 46.0), smoothstep(0.72, 0.9, p.y + 0.06 * fbm(p * 6.0 + s, 3)) * 0.8);
  return vec4(col, clamp(0.5 + 0.2 * n + 0.3 * c, 0.0, 1.0));
}

// ------------------------------------------------------------ Milky Way ---
vec4 kSky(vec3 p) {
  vec3 s = uSeed;
  float sb = dot(p, uGalPole);
  vec3 plane = normalize(p - uGalPole * sb + 1e-6);
  float l = atan(dot(plane, cross(uGalPole, uGalCenter)), dot(plane, uGalCenter));
  float bulge = exp(-l * l / 0.35);
  float width = 0.075 + 0.11 * bulge + 0.02 * fbm(p * 3.0 + s, 3);
  float band = exp(-pow(sb / width, 2.0));
  float halo = exp(-pow(sb / 0.5, 2.0)) * 0.12;
  float n = fbm(p * 5.0 + s, 6) * 0.5 + 0.5;
  float n2 = fbm(p * 13.0 + s * 2.0, 4) * 0.5 + 0.5;
  float dust = smoothstep(0.42, 0.7, fbm(p * 6.0 + s + 3.0, 5) * 0.5 + 0.5 + 0.15 * bulge)
             * exp(-pow((sb + 0.01) / (0.03 + 0.04 * bulge), 2.0));
  float glow = (band * (0.45 + 0.75 * n * n2) * (0.55 + 0.9 * bulge) + halo) * (1.0 - 0.8 * dust);
  vec3 cool = hex(120.0, 140.0, 200.0);
  vec3 warm = hex(236.0, 214.0, 180.0);
  vec3 col = mix(cool, warm, clamp(bulge * 0.9 + 0.2 * n, 0.0, 1.0)) * glow;
  // Faint emission nebulae along the plane.
  float neb = smoothstep(0.62, 0.85, fbm(p * 9.0 + s + 17.0, 4) * 0.5 + 0.5) * band;
  col += hex(220.0, 90.0, 120.0) * neb * 0.35;
  // A whisper of cosmic background so the sky isn't flat black.
  col += hex(10.0, 12.0, 26.0) * (0.6 + 0.4 * fbm(p * 2.0 + s, 3));
  return vec4(col * 0.42, 1.0);
}

void main() {
  vec2 uv = uRegion.xy + vUv * uRegion.zw;
  vec3 p = dirFromUv(uv);
  vec4 o;
  if (uKind == 0) o = kRock(p);
  else if (uKind == 1) o = kMoon(p);
  else if (uKind == 3) o = kVenus(p);
  else if (uKind == 4) o = kEarth(p);
  else if (uKind == 5) o = kEarthClouds(p);
  else if (uKind == 6) o = kEarthNight(p);
  else if (uKind == 7) o = kMars(p);
  else if (uKind == 8) o = kJupiter(p);
  else if (uKind == 9) o = kSaturn(p);
  else if (uKind == 10) o = kUranus(p);
  else if (uKind == 11) o = kNeptune(p);
  else if (uKind == 12) o = kPluto(p);
  else if (uKind == 13) o = kIo(p);
  else if (uKind == 14) o = kEuropa(p);
  else if (uKind == 15) o = kGanymede(p);
  else if (uKind == 16) o = kTitan(p);
  else if (uKind == 17) o = kEnceladus(p);
  else if (uKind == 18) o = kTriton(p);
  else if (uKind == 19) o = kCharon(p);
  else o = kSky(p);
  gl_FragColor = vec4(clamp(o.rgb, 0.0, 1.0), clamp(o.a, 0.0, 1.0));
}
`;
