import { AU_KM, C_KM_S } from '../sim/astro.js';

const MINUS = '−';

function sign(str, negative) {
  return negative ? MINUS + str : str;
}

export function fmtNumber(n, digits = 0) {
  const neg = n < 0;
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return sign(s, neg);
}

/** Significant-figure formatting that keeps big numbers readable. */
export function fmtSig(n, sig = 3) {
  if (n === 0) return '0';
  const neg = n < 0;
  const a = Math.abs(n);
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(a)));
  return sign(a.toLocaleString('en-US', { minimumFractionDigits: Math.min(digits, 6), maximumFractionDigits: Math.min(digits, 6) }), neg);
}

// Two significant figures without trailing zeros ("1", "2.5", "14").
const short = (n) => String(Number(n.toPrecision(2)));

/** Simulation speed in simulated days per real second -> short label. */
export function fmtSpeed(daysPerSec) {
  const s = daysPerSec * 86400;
  if (s < 1.5) return 'Real time';
  if (s < 59.5) return `${Math.round(s)}× real time`;
  if (s < 3570) return `${short(s / 60)} min/s`;
  if (s < 85680) return `${short(s / 3600)} h/s`;
  const d = daysPerSec;
  if (d < 1.95) return `${short(d)} day/s`;
  if (d < 61) return `${short(d)} days/s`;
  if (d < 362) return `${short(d / 30.44)} mo/s`;
  return `${short(d / 365.25)} yr/s`;
}

/** Rotation period in hours (negative = retrograde). */
export function fmtRotation(hours) {
  const retro = hours < 0;
  const h = Math.abs(hours);
  let s;
  if (h < 48) {
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    s = mm === 60 ? `${hh + 1} h` : `${hh} h ${mm} m`;
  } else {
    s = `${fmtSig(h / 24, 3)} days`;
  }
  return retro ? `${s} (retrograde)` : s;
}

export function fmtPeriod(days) {
  if (days < 2) return `${fmtSig(days * 24, 3)} hours`;
  if (days < 1000) return `${fmtSig(days, 3)} days`;
  return `${fmtSig(days / 365.25, 3)} years`;
}

export function fmtTemp(c) {
  return `${fmtNumber(c)} °C`;
}

export function fmtMass(earths) {
  if (earths === 1) return '1 Earth';
  if (earths >= 1000) return `${fmtNumber(earths)} Earths`;
  return `${fmtSig(earths, 3)} Earths`;
}

export function fmtRadius(km) {
  if (km < 100) return `${fmtSig(km, 3)} km`;
  return `${fmtNumber(km)} km`;
}

export function fmtGravity(g) {
  return `${fmtSig(g, 3)} m/s²`;
}

export function fmtAU(au) {
  const km = au * AU_KM;
  const kmStr = km >= 1e9 ? `${fmtSig(km / 1e9, 3)} B km` : km >= 1e6 ? `${fmtSig(km / 1e6, 3)} M km` : `${fmtNumber(km)} km`;
  return `${fmtSig(au, au < 10 ? 3 : 4)} AU · ${kmStr}`;
}

export function fmtLightTime(au) {
  const s = (au * AU_KM) / C_KM_S;
  if (s < 60) return `${fmtSig(s, 2)} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    return `${m} min ${Math.round(s - m * 60)} s`;
  }
  const h = Math.floor(s / 3600);
  return `${h} h ${Math.round((s - h * 3600) / 60)} min`;
}

export function fmtKmS(v) {
  return `${fmtSig(v, 3)} km/s`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Local date (and time when the simulation is slow enough to read it). */
export function fmtDate(ms, withTime) {
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '—';
  const y = d.getFullYear();
  const year = y <= 0 ? `${1 - y} BCE` : String(y);
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]} ${year}`;
  if (!withTime) return date;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${date} · ${hh}:${mm}`;
}
