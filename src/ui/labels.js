import * as THREE from 'three';

// HTML name labels that track bodies on screen. Each frame they are projected,
// hidden when behind the camera or behind a nearer body, and decluttered by
// priority so they never pile up on top of each other.

const _v = new THREE.Vector3();
const _c = new THREE.Vector3();

export class LabelLayer {
  constructor(container, bodies) {
    this.container = container;
    this.items = bodies.map((b) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `label ${b.kind}`;
      el.dataset.id = b.id;
      el.innerHTML = `<i style="--c:${b.color}"></i><span>${b.name}</span>`;
      el.setAttribute('aria-label', `Focus ${b.name}`);
      container.appendChild(el);
      return { body: b, el, x: 0, y: 0, w: 0, h: 0, shown: false, measured: false, sx: -1e4, sy: -1e4 };
    });
    this.enabled = true;
    this.screen = new Map(); // id -> {x, y, r, depth, visible}
  }

  /** Project every body; also used for tap picking. */
  project(camera, width, height, pixelOffsetY = 0) {
    const proj = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / (camera.zoom || 1);
    _c.copy(camera.position);
    for (const it of this.items) {
      const b = it.body;
      _v.set(b.pos[0], b.pos[1], b.pos[2]);
      const depth = _v.distanceTo(_c);
      _v.project(camera);
      const visible = _v.z < 1 && _v.z > -1;
      const x = (_v.x * 0.5 + 0.5) * width;
      const y = (-_v.y * 0.5 + 0.5) * height + pixelOffsetY;
      const r = (b.radius * proj) / Math.max(depth, 1e-6);
      let s = this.screen.get(b.id);
      if (!s) this.screen.set(b.id, (s = {}));
      s.x = x; s.y = y; s.r = r; s.depth = depth; s.visible = visible; s.body = b;
    }
    return this.screen;
  }

  /** Is `s` hidden behind a bigger body that is nearer to the camera? */
  _occluded(s) {
    for (const o of this.screen.values()) {
      if (o === s || !o.visible || o.depth >= s.depth) continue;
      if (o.r < 3) continue;
      if (Math.hypot(o.x - s.x, o.y - s.y) < o.r * 0.98) return true;
    }
    return false;
  }

  update({ width, height, top = 0, bottom = height, focusId, eligible }) {
    const placed = [];
    const order = [...this.items].sort((a, b) => this._priority(b, focusId) - this._priority(a, focusId));
    for (const it of order) {
      const s = this.screen.get(it.body.id);
      let show = this.enabled && s && s.visible && eligible(it.body, s);
      // Keep labels out from under the chrome (card on top, controls at the bottom).
      if (show && (s.x < -40 || s.x > width + 40 || s.y < top - 4 || s.y > bottom - 14)) show = false;
      if (show && this._occluded(s)) show = false;
      let x = 0, y = 0;
      if (show) {
        if (!it.measured) {
          it.w = it.el.offsetWidth || 60;
          it.h = it.el.offsetHeight || 18;
          it.measured = true;
        }
        x = s.x - it.w / 2;
        y = s.y + Math.max(5, Math.min(s.r, height * 0.4)) + 4;
        const rect = { x0: x - 2, y0: y - 1, x1: x + it.w + 2, y1: y + it.h + 1 };
        for (const p of placed) {
          if (rect.x0 < p.x1 && rect.x1 > p.x0 && rect.y0 < p.y1 && rect.y1 > p.y0) {
            show = false;
            break;
          }
        }
        if (show) placed.push(rect);
      }
      if (show) {
        if (Math.abs(x - it.sx) > 0.3 || Math.abs(y - it.sy) > 0.3) {
          it.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
          it.sx = x;
          it.sy = y;
        }
      }
      if (show !== it.shown) {
        it.el.classList.toggle('on', show);
        it.shown = show;
      }
      it.el.classList.toggle('focus', it.body.id === focusId);
    }
  }

  _priority(it, focusId) {
    const b = it.body;
    if (b.id === focusId) return 1000;
    if (b.kind === 'star') return 900;
    if (b.kind === 'planet') return 500 + b.radius;
    if (b.kind === 'dwarf') return 400;
    if (focusId && (b.parent?.id === focusId || b.parent?.id === this._parentOf(focusId))) return 300 + b.radius;
    return 100 + b.radius;
  }

  _parentOf(id) {
    const it = this.items.find((i) => i.body.id === id);
    return it?.body.parent?.id;
  }
}
