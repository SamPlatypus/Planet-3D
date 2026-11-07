import * as THREE from 'three';
import { SolarSystem } from './sim/system.js';
import { nowJD, jdToMs, J2000, wrapPi } from './sim/astro.js';
import { AU_SCENE } from './sim/scale.js';
import { TextureBaker } from './render/baker.js';
import { BodyView, SunView } from './render/bodies-view.js';
import { createSky, createStarfield } from './render/sky.js';
import { FatLine } from './render/lines.js';
import { createBelts, updateBelts } from './render/belts.js';
import { createBeaconMaterial } from './render/materials.js';
import { CameraRig } from './controls/rig.js';
import { LabelLayer } from './ui/labels.js';
import { UI } from './ui/ui.js';

import { speedFromSlider, sliderFromSpeed, SPEED_DETENTS } from './sim/speed.js';

const JD_MIN = J2000 - 3000 * 365.25;
const JD_MAX = J2000 + 3000 * 365.25;
const TRAIL_POINTS = 140;
const ORBIT_POINTS = 360;
const MOON_ORBIT_POINTS = 128;
const PREFS_KEY = 'planet3d:prefs:v1';

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

export class App {
  constructor({ canvas, stage, labels }) {
    this.canvas = canvas;
    this.stage = stage;
    const prefs = loadPrefs();
    this.state = {
      paused: false,
      reverse: false,
      speedT: prefs.speedT ?? sliderFromSpeed(2),
      speedDays: 2,
      trails: prefs.trails ?? true,
      orbits: prefs.orbits ?? true,
      labels: prefs.labels ?? true,
      belts: prefs.belts ?? true,
      trueScale: prefs.trueScale ?? false,
      trailT: prefs.trailT ?? 0.42,
      focus: null,
      infoOpen: prefs.infoOpen ?? true,
    };
    this.state.speedDays = speedFromSlider(this.state.speedT);

    this.system = new SolarSystem();
    this.jd = nowJD();
    this.blend = this.state.trueScale ? 1 : 0;
    this.system.initSpin(this.jd);
    this.system.update(this.jd, this.blend);

    this._initRenderer();
    this._initScene();
    this.labels = new LabelLayer(labels, this.system.bodies);
    this.labels.enabled = this.state.labels;
    this.rig = new CameraRig(this.camera, stage);
    this.rig.onTap = (x, y, target) => this._onTap(x, y, target);
    this.rig.onDoubleTap = (x, y, target) => this._onDoubleTap(x, y, target);
    this.ui = new UI({ bodies: [this.system.sun, ...this.system.planets], actions: this._actions(), speedDetents: SPEED_DETENTS });
    this.ui.reflect(this.state);

    this.viewOffset = { x: 0, y: 0 };
    this.timeAnim = null;
    this.blendAnim = null;
    this._lastOrbitJd = -Infinity;
    this._lastOrbitBlend = -1;
    this._liveTimer = 0;
    this._frameTimes = [];
    this._goodWindows = 0;
    this._clock = 0;
    this._last = performance.now();
    this.ready = false;

    // Start far out for the opening fly-in.
    this.rig.theta = -0.9;
    this.rig.phi = 0.55;
    this.rig.setRadius(this._homeRadius() * 3.2, true);
    this.rig.minRadius = 3;
    this.rig.maxRadius = this._maxRadius();

    this._bindGlobal();
    this._resize();
  }

  // ------------------------------------------------------------ set-up ---
  _initRenderer() {
    const r = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    r.setClearColor(0x020309, 1);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = r;
    this.maxDpr = Math.min(window.devicePixelRatio || 1, 3);
    this.dpr = Math.min(this.maxDpr, 2);
    const gl = r.getContext();
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
    this.mobile = mobile;
    this.baker = new TextureBaker(r, {
      maxSize: Math.min(maxTex, 2048),
      anisotropy: Math.min(8, r.capabilities.getMaxAnisotropy()),
    });
    this.baker.pixelBudget = mobile ? 1 << 18 : 1 << 20;
    this.skySize = Math.min(maxTex, mobile ? 2048 : 4096);
  }

  _initScene() {
    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 30000);

    // Sky and stars ride along with the camera (they are "at infinity").
    this.skyGroup = new THREE.Group();
    this.sky = createSky(this.baker, 9000, this.skySize);
    this.stars = createStarfield(8500);
    this.skyGroup.add(this.sky, this.stars);
    scene.add(this.skyGroup);

    const sphereGeo = new THREE.SphereGeometry(1, 96, 64);
    this.sunView = new SunView(this.system.sun, sphereGeo);
    scene.add(this.sunView.group);

    this.views = new Map();
    for (const b of [...this.system.planets, ...this.system.moons]) {
      const v = new BodyView(b, { baker: this.baker, sphereGeo });
      this.views.set(b.id, v);
      scene.add(v.group);
    }
    // Eclipses: moons shadow their planet, planets shadow their moons.
    for (const p of this.system.planets) {
      const v = this.views.get(p.id);
      const moons = [...p.children].sort((a, b) => b.radius - a.radius);
      v.setOccluders(moons);
      for (const m of p.children) {
        this.views.get(m.id).setOccluders([p], p.id === 'earth' ? [0.9, 0.25, 0.08] : [0, 0, 0]);
      }
    }

    // Orbits and trails.
    this.orbitLines = new Map();
    this.trailLines = new Map();
    this.orbitBuf = new Float32Array(ORBIT_POINTS * 3);
    this.trailBuf = new Float32Array(TRAIL_POINTS * 3);
    this.lineGroup = new THREE.Group();
    scene.add(this.lineGroup);
    for (const p of this.system.planets) {
      const orbit = new FatLine(ORBIT_POINTS, { color: p.color, width: 1.1, opacity: 0.2 });
      orbit.renderOrder = 4;
      const trail = new FatLine(TRAIL_POINTS, { color: p.color, width: 2.6, opacity: 0.95, fade: 1, taper: 0.12 });
      trail.renderOrder = 5;
      this.orbitLines.set(p.id, orbit);
      this.trailLines.set(p.id, trail);
      this.lineGroup.add(orbit, trail);
    }
    this.moonOrbits = new Map();
    const mbuf = new Float32Array(MOON_ORBIT_POINTS * 3);
    for (const m of this.system.moons) {
      const line = new FatLine(MOON_ORBIT_POINTS, { color: m.color, width: 1, opacity: 0 });
      this.system.moonOrbitPoints(m, MOON_ORBIT_POINTS, mbuf);
      line.setPoints(mbuf, MOON_ORBIT_POINTS, true);
      line.renderOrder = 4;
      line.visible = false;
      this.moonOrbits.set(m.id, line);
      this.lineGroup.add(line);
    }

    // Belts.
    this.belts = createBelts(this.system.get('jupiter').def.orbit.base[3]);
    this.belts.renderOrder = 3;
    scene.add(this.belts);

    // Beacons keep distant bodies visible as softly glowing dots.
    const beaconBodies = [...this.system.planets, ...this.system.moons];
    this.beaconBodies = beaconBodies;
    const bg = new THREE.BufferGeometry();
    const bPos = new Float32Array(beaconBodies.length * 3);
    const bCol = new Float32Array(beaconBodies.length * 3);
    const bRad = new Float32Array(beaconBodies.length);
    const bVis = new Float32Array(beaconBodies.length);
    beaconBodies.forEach((b, i) => {
      const c = new THREE.Color(b.color);
      bCol.set([c.r, c.g, c.b], i * 3);
      bRad[i] = b.radius;
      bVis[i] = b.kind === 'moon' ? 0 : 1;
    });
    bg.setAttribute('position', new THREE.BufferAttribute(bPos, 3).setUsage(THREE.DynamicDrawUsage));
    bg.setAttribute('aColor', new THREE.BufferAttribute(bCol, 3));
    bg.setAttribute('aRadius', new THREE.BufferAttribute(bRad, 1));
    bg.setAttribute('aVisible', new THREE.BufferAttribute(bVis, 1).setUsage(THREE.DynamicDrawUsage));
    this.beacons = new THREE.Points(bg, createBeaconMaterial());
    this.beacons.frustumCulled = false;
    this.beacons.renderOrder = 6;
    scene.add(this.beacons);

    this._applyVisibility();
  }

  _bindGlobal() {
    window.addEventListener('resize', () => this._resize());
    window.visualViewport?.addEventListener('resize', () => this._resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this._resize(), 250));
    window.addEventListener('keydown', (e) => this._onKey(e));
    document.addEventListener('visibilitychange', () => {
      this._last = performance.now();
      if (!document.hidden) this._resize();
    });
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.ready = false;
      this.baker.rebakeAll();
      this.ui.showLoader('Restoring the view…');
    });
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    // Keep at least ~38° of view across the narrow side, capped at 70° tall.
    const minFov = 38;
    let vFov = aspect >= 1 ? minFov : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(minFov / 2)) / aspect));
    vFov = Math.min(vFov, 70);
    this.camera.fov = vFov;
    this.camera.aspect = aspect;
    this._applyViewOffset();
    this.camera.updateProjectionMatrix();
    this._layoutDirty = true;
  }

  _applyViewOffset() {
    const { x, y } = this.viewOffset;
    if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) this.camera.clearViewOffset();
    else this.camera.setViewOffset(this.width, this.height, -x, -y, this.width, this.height);
  }

  // ----------------------------------------------------------- actions ---
  _actions() {
    return {
      togglePause: () => this.setPaused(!this.state.paused),
      toggleReverse: () => {
        this.state.reverse = !this.state.reverse;
        this.ui.toast(this.state.reverse ? 'Time runs backwards' : 'Time runs forwards');
        this._changed();
      },
      setSpeed: (t) => {
        this.state.speedT = t;
        this.state.speedDays = speedFromSlider(t);
        this._changed(false);
      },
      setZoom: (f) => {
        this.rig.zoomFraction = f;
      },
      setTrailLength: (t) => {
        this.state.trailT = t;
        this._changed(false);
      },
      toggle: (name) => {
        this.state[name] = !this.state[name];
        const names = { trails: 'Trails', orbits: 'Orbits', labels: 'Labels', belts: 'Asteroid & Kuiper belts' };
        this.ui.toast(`${names[name]} ${this.state[name] ? 'on' : 'off'}`, 1300);
        this._applyVisibility();
        this._changed();
      },
      toggleScale: () => this.setTrueScale(!this.state.trueScale),
      now: () => this.goToNow(),
      home: () => this.goHome(),
      focus: (id) => this.focus(id),
      install: () => this.onInstall && this.onInstall(),
      setInfoOpen: (open) => {
        this.state.infoOpen = open;
        if (this.state.focus) this.ui.showInfo(this.system.get(this.state.focus), open);
        this._layoutDirty = true;
        this._savePrefs();
      },
      layoutChanged: () => {
        this._layoutDirty = true;
      },
    };
  }

  _changed(save = true) {
    this.ui.reflect(this.state);
    if (save) this._savePrefs();
    else {
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this._savePrefs(), 400);
    }
  }

  _savePrefs() {
    const s = this.state;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        speedT: s.speedT, trails: s.trails, orbits: s.orbits, labels: s.labels, belts: s.belts,
        trueScale: s.trueScale, trailT: s.trailT, infoOpen: s.infoOpen,
      }));
    } catch {
      /* storage unavailable (private mode); preferences just won't persist */
    }
  }

  _applyVisibility() {
    const s = this.state;
    for (const l of this.trailLines.values()) l.visible = s.trails;
    for (const l of this.orbitLines.values()) l.visible = s.orbits;
    this.belts.visible = s.belts;
    if (this.labels) this.labels.enabled = s.labels;
  }

  setPaused(p) {
    this.state.paused = p;
    this.timeAnim = null;
    this._changed(false);
  }

  setTrueScale(on) {
    this.state.trueScale = on;
    this.blendAnim = { from: this.blend, to: on ? 1 : 0, t: 0, dur: 1.8 };
    this.ui.toast(on ? 'True distances (sizes still enlarged)' : 'Compact distances', 2200);
    this.rig.maxRadius = this._maxRadius();
    if (!this.state.focus) {
      // Re-frame the overview for the new extent while the orbits morph.
      const target = this._homeRadius(on ? 1 : 0);
      this.rig.flyTo({ point: [0, 0, 0], radius: target, phi: this.rig.phi, duration: 1.8, follow: false });
    }
    this._changed();
  }

  goToNow() {
    const to = nowJD();
    const span = Math.abs(to - this.jd);
    if (span < 1 / 1440) {
      this.ui.toast('Already showing now');
      return;
    }
    const dur = Math.min(2.6, 0.9 + 0.35 * Math.log10(1 + span));
    this.timeAnim = { from: this.jd, to, t: 0, dur };
    this.ui.toast('Back to the present', 1500);
  }

  goHome() {
    this.state.focus = null;
    this.ui.showInfo(null, false);
    this.ui.setChipFocus(null);
    this.rig.minRadius = 3;
    this.rig.flyTo({ point: [0, 0, 0], radius: this._homeRadius(), phi: 0.98, theta: this.rig.theta, duration: 2.0, follow: false });
    this._layoutDirty = true;
  }

  focus(id) {
    const body = this.system.get(id);
    if (!body) return;
    const same = this.state.focus === id;
    this.state.focus = id;
    this.ui.showInfo(body, this.state.infoOpen);
    this.ui.info.updateLive(this.system); // fill live values now, not at the next refresh
    this._liveTimer = 0.25;
    this.ui.setChipFocus(id);
    this._layoutDirty = true;
    if (same && !this.rig.flying) {
      if (!this.state.infoOpen) this._actions().setInfoOpen(true);
    }
    const r = body.radius;
    const ringR = body.def.rings && body.def.rings.opacity > 0.3 ? body.def.rings.outer * r : r;
    // Fit the body into the part of the screen the chrome leaves free.
    const free = this.ui.freeArea(this.width, this.height);
    const fh = Math.max(0.25, (free.bottom - free.top) / this.height);
    const fw = Math.max(0.25, (free.right - free.left - 90) / this.width);
    const vHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * fh);
    const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(this._hFov()) / 2) * fw);
    const half = Math.min(vHalf, hHalf);
    const fill = body.kind === 'star' ? 0.6 : 0.72;
    const dist = Math.max(r * 1.6, ringR / Math.sin(half * fill));
    this.rig.minRadius = r * 1.25;
    // Come in at a lit three-quarter angle: the Sun behind the camera's shoulder.
    let theta = this.rig.theta;
    if (body.kind !== 'star') {
      const sunAz = Math.atan2(-body.pos[0], -body.pos[2]);
      theta = sunAz + 0.75;
      if (Math.abs(wrapPi(theta - this.rig.theta)) > 2.4) theta = sunAz - 0.75;
    }
    let phi = THREE.MathUtils.clamp(this.rig.phi, 1.12, 1.42);
    if (body.def.rings && body.def.rings.opacity > 0.3) phi = this._ringFriendlyPhi(body, theta, phi);
    const travel = Math.hypot(this.rig.target.x - body.pos[0], this.rig.target.y - body.pos[1], this.rig.target.z - body.pos[2]);
    const duration = Math.min(2.8, 1.3 + 0.45 * Math.log10(1 + travel / Math.max(1, dist)));
    this.rig.flyTo({
      to: () => body.pos,
      radius: same ? Math.min(this.rig.radius, dist * 1.4) : dist,
      theta,
      phi,
      duration: same ? 1.0 : duration,
    });
  }

  /**
   * Pick a camera elevation that shows a ring system open (at least ~24°
   * from edge-on), preferring the sunlit face and the smallest change.
   */
  _ringFriendlyPhi(body, theta, phi) {
    const pole = body.pole;
    const minSin = Math.sin(THREE.MathUtils.degToRad(24));
    const sunLen = Math.hypot(...body.pos) || 1;
    const sunDot = -(body.pos[0] * pole[0] + body.pos[1] * pole[1] + body.pos[2] * pole[2]) / sunLen;
    let best = phi;
    let bestScore = Infinity;
    for (let ph = 0.3; ph <= Math.PI - 0.3; ph += 0.02) {
      const sp = Math.sin(ph);
      const d = sp * Math.sin(theta) * pole[0] + Math.cos(ph) * pole[1] + sp * Math.cos(theta) * pole[2];
      if (Math.abs(d) < minSin) continue;
      const sameSide = Math.abs(sunDot) < 0.02 || Math.sign(d) === Math.sign(sunDot);
      const score = Math.abs(ph - phi) + (sameSide ? 0 : 0.6);
      if (score < bestScore) {
        bestScore = score;
        best = ph;
      }
    }
    return best;
  }

  /** Finish any camera flight / time animation at once (used by tests). */
  settle() {
    if (this.rig.flight) {
      this.rig.flight.t = this.rig.flight.duration;
      this.rig.update(0);
    }
    if (this.timeAnim) this.timeAnim.t = this.timeAnim.dur;
    if (this.blendAnim) this.blendAnim.t = this.blendAnim.dur;
    this.viewOffset.x = this.viewOffset.y = 0;
    this._layoutDirty = true;
  }

  _hFov() {
    const v = THREE.MathUtils.degToRad(this.camera.fov);
    return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(v / 2) * this.camera.aspect));
  }

  _homeRadius(blend = this.blend) {
    // Frame Saturn's orbit (compact) or Saturn's orbit at true scale.
    const fitAU = 9.6;
    const r = (AU_SCENE * Math.sqrt(fitAU)) * (1 - blend) + AU_SCENE * fitAU * blend;
    const fov = THREE.MathUtils.degToRad(Math.min(this.camera.fov || 50, this._hFov() || 50));
    return (r * 1.06) / Math.tan(fov / 2);
  }

  _maxRadius() {
    return this.state.trueScale ? 7000 : 2600;
  }

  // ------------------------------------------------------------- input ---
  _onTap(x, y, target) {
    const label = target && target.closest && target.closest('.label');
    if (label) {
      this.focus(label.dataset.id);
      return;
    }
    const hit = this._pick(x, y);
    if (hit) this.focus(hit.id);
  }

  _onDoubleTap(x, y, target) {
    if (target && target.closest && target.closest('.label')) return;
    if (this._pick(x, y)) return;
    const on = !this.ui.hudVisible;
    this.ui.setHudVisible(on);
    if (!on) setTimeout(() => this.ui.toast('Double-tap to show the controls', 1800), 50);
    this._layoutDirty = true;
  }

  _moonEligible(b, s) {
    const f = this.state.focus;
    if (!f) return false;
    const fb = this.system.get(f);
    if (fb.id === b.parent.id || fb.parent === b.parent || fb.id === b.id) return true;
    const ps = this.labels.screen.get(b.parent.id);
    return ps && Math.hypot(ps.x - s.x, ps.y - s.y) > 60 && s.depth < b.parent.radius * 60;
  }

  _pick(x, y) {
    let best = null;
    let bestScore = Infinity;
    for (const s of this.labels.screen.values()) {
      if (!s.visible) continue;
      const b = s.body;
      if (b.kind === 'moon' && !this._moonEligible(b, s)) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      const reach = Math.max(s.r + 10, 24);
      if (d > reach) continue;
      // Prefer what is under the finger, then what is nearer the camera.
      const score = d / reach + (d < s.r ? -1 : 0) + s.depth * 1e-6;
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return best;
  }

  _onKey(e) {
    if (e.target && (e.target.closest('.slider') || e.target.tagName === 'INPUT')) return;
    const a = this._actions();
    const k = e.key;
    if (k === ' ') a.togglePause();
    else if (k === 'r' || k === 'R') a.toggleReverse();
    else if (k === 't' || k === 'T') a.toggle('trails');
    else if (k === 'o' || k === 'O') a.toggle('orbits');
    else if (k === 'l' || k === 'L') a.toggle('labels');
    else if (k === 'b' || k === 'B') a.toggle('belts');
    else if (k === 's' || k === 'S') a.toggleScale();
    else if (k === 'n' || k === 'N') a.now();
    else if (k === 'h' || k === 'H' || k === 'Escape') a.home();
    else if (k === '+' || k === '=') this.rig.zoomBy(0.8);
    else if (k === '-' || k === '_') this.rig.zoomBy(1.25);
    else if (k === 'ArrowRight' || k === 'ArrowLeft') {
      const t = Math.min(1, Math.max(0, this.state.speedT + (k === 'ArrowRight' ? 0.03 : -0.03)));
      a.setSpeed(t);
      this.ui.reflect(this.state);
    } else if (/^[0-9]$/.test(k)) {
      const ids = ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
      a.focus(ids[Number(k)]);
    } else return;
    e.preventDefault();
  }

  // -------------------------------------------------------------- loop ---
  start() {
    const tick = () => {
      requestAnimationFrame(tick);
      this._frame();
    };
    requestAnimationFrame(tick);
  }

  _frame() {
    const now = performance.now();
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (this.contextLost) return;
    dt = Math.min(Math.max(dt, 0), 0.1);
    this._clock += dt;

    if (!this.ready) {
      this.baker.step();
      this.ui.setLoading(this.baker.progress, this.baker.progress < 0.5 ? 'Forming planets…' : 'Lighting the Sun…');
      if (!this.baker.pending) this._onReady();
    }

    this._advanceTime(dt);
    this._advanceBlend(dt);
    const prevJd = this.system.jd;
    this.system.update(this.jd, this.blend);
    this.system.advanceSpin(this.jd - prevJd, dt);

    if (this._layoutDirty) this._updateFraming(dt, true);
    else this._updateFraming(dt, false);

    this.rig.update(dt);
    this._updateCameraPlanes();
    this._updateScene(dt);
    this.camera.updateMatrixWorld();
    this._updateLabels();

    this._liveTimer -= dt;
    if (this._liveTimer <= 0) {
      this._liveTimer = 0.25;
      this.ui.info.updateLive(this.system);
      const slow = this.state.speedDays < 1 / 24 || this.state.paused;
      this.ui.setDate(jdToMs(this.jd), slow);
    }
    this.ui.setZoom(this.rig.zoomFraction);

    this.renderer.render(this.scene, this.camera);
    this._adaptQuality(dt);
  }

  _onReady() {
    this.ready = true;
    this.ui.hideLoader();
    if (!this._introDone) {
      this._introDone = true;
      this.rig.flyTo({ point: [0, 0, 0], radius: this._homeRadius(), phi: 0.98, theta: -0.15, duration: 3.4, follow: false });
      this.rig.flight.interruptible = true;
      if (this.onReady) this.onReady();
    }
  }

  _advanceTime(dt) {
    const s = this.state;
    if (this.timeAnim) {
      const a = this.timeAnim;
      a.t += dt;
      const e = easeInOut(Math.min(1, a.t / a.dur));
      a.to += dt / 86400; // the present keeps moving
      this.jd = a.from + (a.to - a.from) * e;
      if (a.t >= a.dur) this.timeAnim = null;
      return;
    }
    if (s.paused || !this.ready) return;
    this.jd += (s.reverse ? -1 : 1) * s.speedDays * dt;
    if (this.jd < JD_MIN || this.jd > JD_MAX) {
      this.jd = Math.min(JD_MAX, Math.max(JD_MIN, this.jd));
      this.setPaused(true);
      this.ui.toast('Reached the edge of the modelled time range (±3,000 years)', 3000);
    }
  }

  _advanceBlend(dt) {
    const a = this.blendAnim;
    if (!a) return;
    a.t += dt;
    const e = easeInOut(Math.min(1, a.t / a.dur));
    this.blend = a.from + (a.to - a.from) * e;
    if (a.t >= a.dur) this.blendAnim = null;
  }

  _updateFraming(dt, force) {
    // Centre the view in the part of the screen the chrome leaves free.
    if (force || !this._free || (this._freeAge = (this._freeAge || 0) + dt) > 0.5) {
      this._free = this.ui.freeArea(this.width, this.height);
      this._freeAge = 0;
      this._layoutDirty = false;
    }
    const f = this._free;
    const cy = (f.top + f.bottom) / 2;
    const cx = (f.left + f.right) / 2;
    const ty = Math.max(-this.height * 0.3, Math.min(this.height * 0.3, cy - this.height / 2));
    const tx = Math.max(-this.width * 0.3, Math.min(this.width * 0.3, cx - this.width / 2));
    const nx = damp(this.viewOffset.x, tx, 5, dt);
    const ny = damp(this.viewOffset.y, ty, 5, dt);
    if (Math.abs(nx - this.viewOffset.x) > 0.05 || Math.abs(ny - this.viewOffset.y) > 0.05 || force) {
      this.viewOffset.x = nx;
      this.viewOffset.y = ny;
      this._applyViewOffset();
      this.camera.updateProjectionMatrix();
    }
  }

  _updateCameraPlanes() {
    const cam = this.camera.position;
    let nearest = Infinity;
    for (const b of this.system.bodies) {
      const d = Math.hypot(cam.x - b.pos[0], cam.y - b.pos[1], cam.z - b.pos[2]) - b.radius * 1.05;
      if (d < nearest) nearest = d;
    }
    const near = THREE.MathUtils.clamp(nearest * 0.35, 0.002, 2);
    if (Math.abs(near - this.camera.near) / this.camera.near > 0.05) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  _updateScene(dt) {
    const t = this._clock;
    const sys = this.system;
    const cam = this.camera.position;
    this.skyGroup.position.copy(cam);
    this.stars.material.uniforms.uTime.value = t;
    this.stars.material.uniforms.uPixelRatio.value = this.dpr;

    this.sunView.update(t);
    this.sunView.setCameraDistance(cam.length());
    for (const v of this.views.values()) v.update(t);

    const focus = this.state.focus ? sys.get(this.state.focus) : null;
    const focusPlanet = focus ? (focus.parent || focus) : null;
    const w = this.width, h = this.height, dpr = this.dpr, near = this.camera.near;

    // Orbits: refresh when the date has moved far or the scale changed.
    if (this.state.orbits && (Math.abs(this.jd - this._lastOrbitJd) > 20 || this.blend !== this._lastOrbitBlend)) {
      for (const p of sys.planets) {
        sys.orbitPoints(p, ORBIT_POINTS, this.orbitBuf);
        this.orbitLines.get(p.id).setPoints(this.orbitBuf, ORBIT_POINTS, true);
      }
      this._lastOrbitJd = this.jd;
      this._lastOrbitBlend = this.blend;
    }
    const fadeDepth = focus ? this.rig.radius * 2.5 : 0;
    for (const p of sys.planets) {
      const o = this.orbitLines.get(p.id);
      o.setViewport(w, h, dpr, near);
      o.fadeDepth = fadeDepth;
      const target = focusPlanet === p ? 0.55 : focusPlanet ? 0.12 : 0.22;
      o.opacity = damp(o.opacity, target, 4, dt);
    }

    // Trails: an analytic arc behind each planet (smooth at any speed).
    const frac = 0.025 + 0.9 * Math.pow(this.state.trailT, 1.3);
    if (this.state.trails) {
      for (const p of sys.planets) {
        const tr = this.trailLines.get(p.id);
        sys.trailPoints(p, Math.min(0.995, frac), TRAIL_POINTS, this.trailBuf);
        tr.setPoints(this.trailBuf, TRAIL_POINTS, false);
        tr.setViewport(w, h, dpr, near);
        tr.fadeDepth = fadeDepth;
        tr.opacity = damp(tr.opacity, focusPlanet && focusPlanet !== p ? 0.55 : 0.95, 4, dt);
      }
    }

    // Moon orbits appear around the focused planet's system.
    for (const m of sys.moons) {
      const line = this.moonOrbits.get(m.id);
      const parent = m.parent;
      const camD = Math.hypot(cam.x - parent.pos[0], cam.y - parent.pos[1], cam.z - parent.pos[2]);
      const near = camD < parent.radius * 45;
      const want = this.state.orbits && (focusPlanet === parent || near) ? (focus === m ? 0.6 : 0.28) : 0;
      line.opacity = damp(line.opacity, want, 4, dt);
      line.visible = line.opacity > 0.01;
      if (line.visible) {
        line.position.set(parent.pos[0], parent.pos[1], parent.pos[2]);
        line.setViewport(w, h, dpr, this.camera.near);
        if (m.def.nodeRate) {
          // The Moon's orbit plane precesses (18.6-year cycle).
          if (!line._jd || Math.abs(line._jd - this.jd) > 30) {
            const buf = new Float32Array(MOON_ORBIT_POINTS * 3);
            sys.moonOrbitPoints(m, MOON_ORBIT_POINTS, buf);
            line.setPoints(buf, MOON_ORBIT_POINTS, true);
            line._jd = this.jd;
          }
        }
      }
    }

    // Belts.
    if (this.belts.visible) updateBelts(this.belts, this.jd - J2000, this.blend, dpr);

    // Beacons.
    const bp = this.beacons.geometry.attributes.position;
    const bv = this.beacons.geometry.attributes.aVisible;
    this.beaconBodies.forEach((b, i) => {
      bp.setXYZ(i, b.pos[0], b.pos[1], b.pos[2]);
      if (b.kind === 'moon') {
        const vis = focusPlanet === b.parent ? 1 : 0;
        if (bv.getX(i) !== vis) {
          bv.setX(i, vis);
          bv.needsUpdate = true;
        }
      }
    });
    bp.needsUpdate = true;
    const bm = this.beacons.material.uniforms;
    bm.uPixelRatio.value = dpr;
    bm.uProjScale.value = (h * dpr) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / dpr;
  }

  _updateLabels() {
    this.labels.project(this.camera, this.width, this.height);
    const free = this._free || { top: 0, bottom: this.height };
    this.labels.update({
      width: this.width,
      height: this.height,
      top: free.top,
      bottom: free.bottom,
      focusId: this.state.focus,
      eligible: (b, s) => {
        if (b.kind === 'moon') return this._moonEligible(b, s);
        return true;
      },
    });
  }

  _adaptQuality(dt) {
    if (!this.ready || this.rig.flying) return;
    const ft = this._frameTimes;
    ft.push(dt);
    if (ft.length < 90) return;
    const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
    ft.length = 0;
    if (avg > 0.026 && this.dpr > 1) {
      this.dpr = Math.max(1, this.dpr - 0.25);
      this._goodWindows = 0;
      this._resize();
    } else if (avg < 0.0135 && this.dpr < this.maxDpr) {
      if (++this._goodWindows >= 3) {
        this.dpr = Math.min(this.maxDpr, this.dpr + 0.25);
        this._goodWindows = 0;
        this._resize();
      }
    } else {
      this._goodWindows = 0;
    }
  }
}
