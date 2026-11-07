import * as THREE from 'three';

// Touch-first orbit camera with smooth fly-to and follow.
//   one finger / left mouse: orbit (with inertia)
//   two fingers: pinch to zoom, twist to turn
//   wheel: zoom; tap and double-tap are reported to the app
// The camera orbits `target`; when following a body, target tracks the body
// exactly while any leftover offset decays smoothly.

const TAU = Math.PI * 2;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const shortestAngle = (a, b) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

export class CameraRig {
  constructor(camera, element) {
    this.camera = camera;
    this.el = element;
    this.target = new THREE.Vector3();
    this.radius = 200;
    this.radiusGoal = 200;
    this.theta = 0.6; // azimuth around +Y
    this.phi = 1.0; // polar angle from +Y
    this.vTheta = 0;
    this.vPhi = 0;
    this.minRadius = 1;
    this.maxRadius = 4000;
    this.followFn = null; // () => [x, y, z]
    this.followOffset = new THREE.Vector3();
    this.flight = null;
    this.lastInteraction = performance.now();
    this.autoRotate = true;
    this.onTap = null;
    this.onDoubleTap = null;
    this.onInteract = null;
    this.pointers = new Map();
    this._lastTap = null;
    this._tmp = new THREE.Vector3();
    this._bind();
  }

  _bind() {
    const el = this.el;
    el.addEventListener('pointerdown', (e) => this._down(e));
    el.addEventListener('pointermove', (e) => this._move(e));
    el.addEventListener('pointerup', (e) => this._up(e));
    el.addEventListener('pointercancel', (e) => this._up(e, true));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._interacted();
      const k = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0022);
      this.zoomBy(k);
    }, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _interacted() {
    this.lastInteraction = performance.now();
    if (this.flight && this.flight.interruptible) this._abortFlight();
    if (this.onInteract) this.onInteract();
  }

  _down(e) {
    this.el.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: 0, el: e.target });
    this.vTheta = 0;
    this.vPhi = 0;
    if (this.pointers.size >= 2) {
      this._wasMulti = true;
      this._startPinch();
    }
    this._lastMoveT = performance.now();
  }

  _startPinch() {
    const [a, b] = [...this.pointers.values()];
    this._pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      angle: Math.atan2(b.y - a.y, b.x - a.x),
      radius: this.radiusGoal,
      theta: this.theta,
    };
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    p.moved = Math.max(p.moved, Math.hypot(p.x - p.x0, p.y - p.y0));
    if (p.moved < 4 && this.pointers.size === 1) return;
    this._interacted();
    const now = performance.now();
    const dt = Math.max(1, now - this._lastMoveT) / 1000;
    this._lastMoveT = now;
    if (this.pointers.size === 1) {
      const k = 5.2 / Math.max(320, Math.min(this.el.clientWidth, this.el.clientHeight) * 1.6);
      const dTheta = -dx * k * 1.6;
      const dPhi = -dy * k * 1.6;
      this.theta += dTheta;
      this.phi = THREE.MathUtils.clamp(this.phi + dPhi, 0.03, Math.PI - 0.03);
      // Smoothed velocity for the release flick.
      this.vTheta = this.vTheta * 0.6 + (dTheta / dt) * 0.4;
      this.vPhi = this.vPhi * 0.6 + (dPhi / dt) * 0.4;
    } else if (this.pointers.size === 2 && this._pinch) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      this.radiusGoal = THREE.MathUtils.clamp(this._pinch.radius * (this._pinch.dist / dist), this.minRadius, this.maxRadius);
      this.theta = this._pinch.theta + shortestAngle(this._pinch.angle, angle);
    }
  }

  _up(e, cancelled = false) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 1) {
      // Lifting one finger of a pinch: keep orbiting smoothly with the other.
      this._pinch = null;
      this.vTheta = this.vPhi = 0;
    }
    if (!p || cancelled) return;
    const now = performance.now();
    if (now - this._lastMoveT > 80) {
      this.vTheta = 0;
      this.vPhi = 0;
    }
    const isTap = p.moved < 10 && now - p.t0 < 400 && this.pointers.size === 0 && !this._wasMulti;
    if (this.pointers.size === 0) this._wasMulti = false;
    if (isTap) {
      const last = this._lastTap;
      if (last && now - last.t < 320 && Math.hypot(last.x - p.x, last.y - p.y) < 36) {
        this._lastTap = null;
        if (this.onDoubleTap) this.onDoubleTap(p.x, p.y, p.el);
      } else {
        this._lastTap = { t: now, x: p.x, y: p.y };
        // Report single taps at once (focusing feels instant); double-tap is extra.
        if (this.onTap) this.onTap(p.x, p.y, p.el);
      }
    }
  }

  get interacting() {
    return this.pointers.size > 0;
  }

  zoomBy(k) {
    this.radiusGoal = THREE.MathUtils.clamp(this.radiusGoal * k, this.minRadius, this.maxRadius);
  }

  setRadius(r, immediate = false) {
    this.radiusGoal = THREE.MathUtils.clamp(r, this.minRadius, this.maxRadius);
    if (immediate) this.radius = this.radiusGoal;
  }

  /** 0..1 position on a logarithmic zoom scale (0 = closest). */
  get zoomFraction() {
    const a = Math.log(this.minRadius), b = Math.log(this.maxRadius);
    return THREE.MathUtils.clamp((Math.log(this.radiusGoal) - a) / (b - a), 0, 1);
  }

  set zoomFraction(f) {
    const a = Math.log(this.minRadius), b = Math.log(this.maxRadius);
    this.setRadius(Math.exp(a + (b - a) * f));
    this._interacted();
  }

  follow(fn) {
    if (fn) {
      const p = fn();
      this.followOffset.set(this.target.x - p[0], this.target.y - p[1], this.target.z - p[2]);
    }
    this.followFn = fn;
  }

  /**
   * Smoothly move the camera. `to` is a function returning [x,y,z] (it may
   * move during the flight, e.g. an orbiting planet) or null for a fixed point.
   */
  flyTo({ to, point = null, radius, theta = this.theta, phi = this.phi, duration = 1.8, follow = true, onDone = null }) {
    const fromTarget = this.target.clone();
    const dest = to ? new THREE.Vector3(...to()) : new THREE.Vector3(...point);
    const travel = fromTarget.distanceTo(dest);
    // Pull back mid-flight on long hops, for a sense of context.
    const arc = THREE.MathUtils.clamp(travel / Math.max(this.radius, radius, 1) - 0.6, 0, 1.6) * 0.35;
    this.flight = {
      t: 0,
      duration,
      to,
      point: dest,
      fromTarget,
      fromRadius: this.radius,
      toRadius: THREE.MathUtils.clamp(radius, this.minRadius, this.maxRadius),
      fromTheta: this.theta,
      dTheta: shortestAngle(this.theta, theta),
      fromPhi: this.phi,
      toPhi: phi,
      arc,
      follow,
      onDone,
      interruptible: true,
    };
    this.followFn = null;
    this.vTheta = this.vPhi = 0;
  }

  _abortFlight() {
    const f = this.flight;
    this.flight = null;
    this.radiusGoal = this.radius;
    if (f.follow && f.to) this.follow(f.to);
    if (f.onDone) f.onDone(true);
  }

  get flying() {
    return !!this.flight;
  }

  update(dt) {
    const f = this.flight;
    if (f) {
      f.t += dt;
      const s = Math.min(1, f.t / f.duration);
      const e = easeInOutCubic(s);
      const dest = f.to ? this._tmp.set(...f.to()) : f.point;
      this.target.lerpVectors(f.fromTarget, dest, e);
      const lr = Math.log(f.fromRadius) + (Math.log(f.toRadius) - Math.log(f.fromRadius)) * e;
      this.radius = Math.exp(lr) * (1 + f.arc * Math.sin(Math.PI * e));
      this.radiusGoal = this.radius;
      this.theta = f.fromTheta + f.dTheta * e;
      this.phi = f.fromPhi + (f.toPhi - f.fromPhi) * e;
      if (s >= 1) {
        this.flight = null;
        this.radius = this.radiusGoal = f.toRadius;
        if (f.follow && f.to) {
          this.followFn = f.to;
          this.followOffset.set(0, 0, 0);
        }
        if (f.onDone) f.onDone(false);
      }
    } else {
      // Inertia.
      if (!this.interacting) {
        const decay = Math.exp(-dt * 3.5);
        this.theta += this.vTheta * dt;
        this.phi = THREE.MathUtils.clamp(this.phi + this.vPhi * dt, 0.03, Math.PI - 0.03);
        this.vTheta *= decay;
        this.vPhi *= decay;
        // Gentle auto-orbit after a while without input.
        const idle = (performance.now() - this.lastInteraction) / 1000;
        if (this.autoRotate && idle > 30) this.theta += dt * 0.02 * Math.min(1, (idle - 30) / 6);
      }
      // Smooth zoom (in log space).
      const lr = Math.log(this.radius);
      const lg = Math.log(this.radiusGoal);
      this.radius = Math.exp(lr + (lg - lr) * (1 - Math.exp(-dt * 10)));
      if (this.followFn) {
        const p = this.followFn();
        this.followOffset.multiplyScalar(Math.exp(-dt * 4));
        this.target.set(p[0], p[1], p[2]).add(this.followOffset);
      }
    }
    const sp = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * sp * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sp * Math.cos(this.theta),
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
  }
}
