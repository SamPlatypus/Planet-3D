import {
  fmtAU, fmtLightTime, fmtKmS, fmtRadius, fmtMass, fmtGravity, fmtRotation, fmtPeriod, fmtTemp, fmtNumber,
} from './format.js';

// The compact info card for the focused body. Static facts are rendered once
// per focus; live values (distances, speed, light time) refresh a few times a
// second while the simulation runs.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function staticRows(body) {
  const d = body.def;
  const s = d.stats || {};
  // [label, value, detailOnly]
  const rows = [];
  if (s.radiusKm) rows.push(['Radius', fmtRadius(s.radiusKm)]);
  if (s.massEarth) rows.push(['Mass', fmtMass(s.massEarth)]);
  if (s.gravity) rows.push(['Gravity', fmtGravity(s.gravity)]);
  if (body.kind === 'moon') {
    rows.push(['Orbit', fmtPeriod(s.periodDays)]);
    rows.push(['From ' + body.parent.name, `${fmtNumber(s.distanceKm)} km`]);
    if (s.tempC != null) rows.push(['Mean temp.', fmtTemp(s.tempC)]);
    rows.push(['Rotation', 'Tidally locked', true]);
  } else if (body.kind === 'star') {
    rows.push(['Rotation', fmtRotation(s.dayHours)]);
    rows.push(['Surface', fmtTemp(s.tempC)]);
    rows.push(['Axial tilt', `${s.tilt}°`]);
  } else {
    if (s.dayHours) rows.push(['Day', fmtRotation(s.dayHours)]);
    if (body.periodDays) rows.push(['Year', fmtPeriod(body.periodDays)]);
    if (s.moons != null) rows.push(['Moons', String(s.moons)]);
    if (s.tilt != null) rows.push(['Axial tilt', `${s.tilt}°`, true]);
    if (s.tempC != null) rows.push(['Mean temp.', fmtTemp(s.tempC), true]);
  }
  return rows;
}

export class InfoCard {
  constructor(root, { onCollapse, onExpand, onClose }) {
    this.root = root;
    this.body = null;
    this.expanded = false;
    this.factIndex = 0;
    this.onCollapse = onCollapse;
    this.onExpand = onExpand;
    root.innerHTML = `
      <header class="info-head">
        <span class="swatch"></span>
        <div class="titles"><h2></h2><p class="sub"></p></div>
        <button type="button" class="mini" data-act="more" aria-label="More details" aria-expanded="false">
          <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <button type="button" class="mini" data-act="close" aria-label="Hide panel">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </header>
      <div class="live"></div>
      <dl class="stats"></dl>
      <dl class="stats extra"></dl>
      <p class="fact" role="button" tabindex="0" aria-label="Next fact"></p>`;
    this.el = {
      swatch: root.querySelector('.swatch'),
      title: root.querySelector('h2'),
      sub: root.querySelector('.sub'),
      live: root.querySelector('.live'),
      stats: root.querySelector('.stats'),
      extra: root.querySelector('.extra'),
      fact: root.querySelector('.fact'),
      more: root.querySelector('[data-act=more]'),
    };
    root.querySelector('[data-act=close]').addEventListener('click', () => onClose && onClose());
    this.el.more.addEventListener('click', () => this.setExpanded(!this.expanded));
    root.querySelector('.info-head .titles').addEventListener('click', () => this.setExpanded(!this.expanded));
    const nextFact = () => {
      if (!this.expanded) this._showFact(this.factIndex + 1);
    };
    this.el.fact.addEventListener('click', nextFact);
    this.el.fact.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        nextFact();
      }
    });
    this._factTimer = setInterval(() => {
      if (this.body && !this.expanded && !document.hidden) this._showFact(this.factIndex + 1);
    }, 9000);
  }

  setExpanded(on) {
    this.expanded = on;
    this.root.classList.toggle('expanded', on);
    this.el.more.setAttribute('aria-expanded', String(on));
    this.el.more.setAttribute('aria-label', on ? 'Fewer details' : 'More details');
    this._renderFacts();
    if (on && this.onExpand) this.onExpand();
    if (!on && this.onCollapse) this.onCollapse();
  }

  show(body) {
    this.body = body;
    const d = body.def;
    this.el.swatch.style.setProperty('--c', body.color);
    this.el.title.textContent = body.name;
    this.el.sub.textContent = d.summary || (body.parent ? `Moon of ${body.parent.name}` : '');
    this.el.stats.innerHTML = staticRows(body)
      .map(([k, v, detail]) => `<div${detail ? ' class="x"' : ''}><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
      .join('');
    this.el.extra.innerHTML = (d.extra || []).map(([k, v]) => `<div class="wide"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    this.factIndex = 0;
    this._renderFacts();
    this._liveKey = '';
  }

  _renderFacts() {
    const facts = (this.body && this.body.def.facts) || [];
    if (this.expanded) {
      this.el.fact.innerHTML = facts.map((f) => `<span>${esc(f)}</span>`).join('');
    } else {
      this._showFact(this.factIndex);
    }
  }

  _showFact(i) {
    const facts = (this.body && this.body.def.facts) || [];
    if (!facts.length) {
      this.el.fact.textContent = '';
      return;
    }
    if (this.expanded) return;
    this.factIndex = ((i % facts.length) + facts.length) % facts.length;
    const el = this.el.fact;
    el.classList.remove('swap');
    void el.offsetWidth;
    el.classList.add('swap');
    el.innerHTML = `<span>${esc(facts[this.factIndex])}</span>${facts.length > 1 ? `<em>${this.factIndex + 1}/${facts.length}</em>` : ''}`;
  }

  /** Refresh live values; system = SolarSystem. */
  updateLive(system) {
    const b = this.body;
    if (!b) return;
    // [label, value, detailOnly]
    const rows = [];
    const earth = system.get('earth');
    if (b.kind === 'star') {
      rows.push(['From Earth', fmtAU(system.distanceAU(b, earth))]);
      rows.push(['Light to Earth', fmtLightTime(system.distanceAU(b, earth))]);
    } else {
      const sunD = b.sunDistanceAU;
      rows.push(['From Sun', fmtAU(sunD)]);
      rows.push([b.parent ? `Speed round ${b.parent.name}` : 'Orbital speed', fmtKmS(b.orbitalSpeed)]);
      if (b.id !== 'earth' && b.parent?.id !== 'earth') {
        const ed = system.distanceAU(b, earth);
        rows.push(['From Earth', fmtAU(ed), true]);
        rows.push(['Light time from Earth', fmtLightTime(ed), true]);
      } else if (b.id === 'earth') {
        rows.push(['Sunlight takes', fmtLightTime(sunD), true]);
      }
    }
    const html = rows
      .map(([k, v, detail]) => `<div${detail ? ' class="x"' : ''}><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
      .join('');
    if (html !== this._liveKey) {
      this.el.live.innerHTML = html;
      this._liveKey = html;
    }
  }
}
