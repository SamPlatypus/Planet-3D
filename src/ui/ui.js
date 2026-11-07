import { Slider } from './slider.js';
import { InfoCard } from './info.js';
import { fmtSpeed, fmtDate } from './format.js';

// All the on-screen chrome: thumb buttons along the bottom, the speed slider,
// edge sliders for zoom and trail length, body chips, the info card, toasts
// and the loader. It never opens menus over the scene; it only reflects state
// and forwards intents to the app through `actions`.

const $ = (sel) => document.querySelector(sel);

export class UI {
  constructor({ bodies, actions, speedDetents }) {
    this.actions = actions;
    this.hud = $('#hud');
    this.loader = $('#loader');
    this.toastEl = $('#toast');
    this.dateEl = $('#date');
    this.pausedTag = $('#paused-tag');
    this.speedOut = $('#speed-out');
    this.playBtn = $('#btn-play');
    this.reverseBtn = $('#btn-reverse');
    this.infoEl = $('#info');
    this.infoPill = $('#info-pill');
    this.trailRail = $('#trail-len');
    this.installBtn = document.querySelector('[data-act=install]');
    this.scaleBtn = document.querySelector('[data-act=scale]');
    this.toggleBtns = new Map([...document.querySelectorAll('[data-toggle]')].map((b) => [b.dataset.toggle, b]));

    this.speed = new Slider($('#speed-slider'), {
      detents: speedDetents,
      onInput: (v) => actions.setSpeed(v),
    });
    this.zoom = new Slider($('#zoom-slider'), {
      vertical: true,
      onInput: (v) => actions.setZoom(1 - v),
      format: (v) => `${Math.round(v * 100)} %`,
    });
    this.trail = new Slider($('#trail-slider'), {
      vertical: true,
      onInput: (v) => actions.setTrailLength(v),
      format: (v) => `${Math.round(v * 100)} %`,
    });

    this.playBtn.addEventListener('click', () => actions.togglePause());
    this.reverseBtn.addEventListener('click', () => actions.toggleReverse());
    for (const [name, btn] of this.toggleBtns) btn.addEventListener('click', () => actions.toggle(name));
    this.scaleBtn.addEventListener('click', () => actions.toggleScale());
    document.querySelector('[data-act=now]').addEventListener('click', () => actions.now());
    document.querySelector('[data-act=home]').addEventListener('click', () => actions.home());
    this.installBtn.addEventListener('click', () => actions.install());
    this.infoPill.addEventListener('click', () => actions.setInfoOpen(true));

    this.info = new InfoCard(this.infoEl, {
      onClose: () => actions.setInfoOpen(false),
      onExpand: () => actions.layoutChanged(),
      onCollapse: () => actions.layoutChanged(),
    });

    this._buildChips(bodies);
    this._toastTimer = 0;
  }

  _buildChips(bodies) {
    const nav = $('#chips');
    this.chips = new Map();
    const order = [];
    for (const b of bodies) {
      if (b.kind === 'moon') continue;
      order.push(b);
      for (const m of b.children) order.push(m);
    }
    for (const b of order) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `chip ${b.kind}`;
      el.style.setProperty('--c', b.color);
      el.innerHTML = `<i></i>${b.name}`;
      el.setAttribute('aria-label', `Go to ${b.name}`);
      el.addEventListener('click', () => this.actions.focus(b.id));
      nav.appendChild(el);
      this.chips.set(b.id, { el, body: b });
    }
    this.chipNav = nav;
  }

  setChipFocus(id) {
    let parentId = null;
    for (const { body } of this.chips.values()) if (body.id === id) parentId = body.parent ? body.parent.id : body.id;
    for (const { el, body } of this.chips.values()) {
      el.classList.toggle('active', body.id === id);
      if (body.kind === 'moon') el.classList.toggle('show', !!id && body.parent.id === parentId);
    }
    const active = id && this.chips.get(id);
    if (active) {
      requestAnimationFrame(() => {
        const el = active.el;
        const nav = this.chipNav;
        const target = el.offsetLeft - nav.clientWidth / 2 + el.offsetWidth / 2;
        nav.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
      });
    }
  }

  reflect(state) {
    this.playBtn.classList.toggle('paused', state.paused);
    this.playBtn.setAttribute('aria-label', state.paused ? 'Play' : 'Pause');
    this.pausedTag.hidden = !state.paused;
    this.reverseBtn.classList.toggle('on', state.reverse);
    this.reverseBtn.setAttribute('aria-pressed', String(state.reverse));
    for (const [name, btn] of this.toggleBtns) {
      btn.classList.toggle('on', !!state[name]);
      btn.setAttribute('aria-pressed', String(!!state[name]));
    }
    this.scaleBtn.classList.toggle('on', state.trueScale);
    this.scaleBtn.setAttribute('aria-pressed', String(state.trueScale));
    this.scaleBtn.querySelector('span').textContent = state.trueScale ? 'True' : 'Compact';
    this.scaleBtn.setAttribute('aria-label', state.trueScale ? 'Distances: true scale' : 'Distances: compact');
    this.trailRail.classList.toggle('off', !state.trails);
    this.speed.value = state.speedT;
    this.trail.value = state.trailT;
    this.speedOut.textContent = (state.reverse ? '−' : '') + fmtSpeed(state.speedDays);
    this.speed.el.setAttribute('aria-valuetext', this.speedOut.textContent);
  }

  setDate(ms, withTime) {
    const s = fmtDate(ms, withTime);
    if (s !== this._date) {
      this.dateEl.textContent = s;
      this._date = s;
    }
  }

  setZoom(fraction) {
    if (!this.zoom.el.classList.contains('active')) this.zoom.value = 1 - fraction;
  }

  showInfo(body, open) {
    if (body) this.info.show(body);
    this._infoBody = body;
    this.infoEl.hidden = !(body && open);
    this.infoPill.hidden = !(body && !open);
    if (body) {
      this.infoPill.querySelector('span').textContent = body.name;
      this.infoPill.style.setProperty('--c', body.color);
    }
  }

  /** Free screen area not covered by chrome, in CSS px (for framing). */
  freeArea(width, height) {
    let top = 0;
    let left = 0;
    for (const el of [document.getElementById('clock'), this.infoEl, this.infoPill]) {
      if (el.hidden || this.hud.classList.contains('hidden')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      const landscapeCard = el === this.infoEl && r.width < width * 0.5;
      if (landscapeCard) left = Math.max(left, r.right);
      else top = Math.max(top, r.bottom);
    }
    let bottom = height;
    if (!this.hud.classList.contains('hidden')) {
      const r = document.getElementById('bottom').getBoundingClientRect();
      bottom = Math.min(bottom, r.top);
    }
    return { top, bottom, left, right: width };
  }

  toast(msg, ms = 2000) {
    const t = this.toastEl;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  setLoading(progress, msg) {
    const bar = this.loader.querySelector('.bar div');
    bar.style.width = `${Math.round(progress * 100)}%`;
    this.loader.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    if (msg) document.getElementById('loader-msg').textContent = msg;
  }

  hideLoader() {
    this.loader.classList.add('done');
  }

  showLoader(msg) {
    this.loader.classList.remove('done');
    this.setLoading(0, msg);
  }

  setInstallable(on) {
    this.installBtn.hidden = !on;
  }

  setHudVisible(on) {
    this.hud.classList.toggle('hidden', !on);
  }

  get hudVisible() {
    return !this.hud.classList.contains('hidden');
  }
}
