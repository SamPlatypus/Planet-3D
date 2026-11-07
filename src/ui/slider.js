// A compact touch slider (horizontal or vertical) with a generous hit area,
// optional snap detents and full keyboard / ARIA support.

export class Slider {
  constructor(el, { vertical = false, value = 0.5, detents = [], snap = 0.014, onInput = null, format = null } = {}) {
    this.el = el;
    this.vertical = vertical;
    this.detents = detents;
    this.snap = snap;
    this.onInput = onInput;
    this.format = format;
    el.classList.add('slider', vertical ? 'v' : 'h');
    el.setAttribute('role', 'slider');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal');
    el.setAttribute('aria-valuemin', '0');
    el.setAttribute('aria-valuemax', '100');
    el.innerHTML = '<div class="track"><div class="fill"></div></div><div class="thumb"></div>';
    for (const d of detents) {
      const tick = document.createElement('span');
      tick.className = 'tick';
      tick.style[vertical ? 'bottom' : 'left'] = `${d * 100}%`;
      el.querySelector('.track').appendChild(tick);
    }
    this.fill = el.querySelector('.fill');
    this.thumb = el.querySelector('.thumb');
    this._value = -1;
    this.value = value;
    this._bind();
  }

  _bind() {
    const el = this.el;
    let active = null;
    const fromEvent = (e) => {
      const r = el.getBoundingClientRect();
      const pad = 10;
      const f = this.vertical
        ? 1 - (e.clientY - r.top - pad) / Math.max(1, r.height - 2 * pad)
        : (e.clientX - r.left - pad) / Math.max(1, r.width - 2 * pad);
      return Math.min(1, Math.max(0, f));
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      active = e.pointerId;
      el.setPointerCapture?.(e.pointerId);
      el.classList.add('active');
      this._set(fromEvent(e), true);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== active) return;
      this._set(fromEvent(e), true);
    });
    const end = (e) => {
      if (e.pointerId !== active) return;
      active = null;
      el.classList.remove('active');
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.02;
      const map = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: 0.1, PageDown: -0.1 };
      if (e.key in map) this._set(this._value + map[e.key], true, false);
      else if (e.key === 'Home') this._set(0, true, false);
      else if (e.key === 'End') this._set(1, true, false);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
  }

  _set(v, fire, snap = true) {
    v = Math.min(1, Math.max(0, v));
    if (snap) {
      for (const d of this.detents) {
        if (Math.abs(v - d) < this.snap) {
          v = d;
          break;
        }
      }
    }
    if (v === this._value) return;
    this.value = v;
    if (fire && this.onInput) this.onInput(v);
  }

  get value() {
    return this._value;
  }

  set value(v) {
    v = Math.min(1, Math.max(0, v));
    if (Math.abs(v - this._value) < 1e-5) return;
    this._value = v;
    const pct = `${v * 100}%`;
    if (this.vertical) {
      this.fill.style.height = pct;
      this.thumb.style.bottom = `calc(10px + (100% - 20px) * ${v})`;
    } else {
      this.fill.style.width = pct;
      this.thumb.style.left = `calc(10px + (100% - 20px) * ${v})`;
    }
    this.el.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    if (this.format) this.el.setAttribute('aria-valuetext', this.format(v));
  }
}
