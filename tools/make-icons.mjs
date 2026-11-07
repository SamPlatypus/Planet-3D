// Renders every app icon from one SVG design with headless Chromium:
// PWA icons (any + maskable), the Apple touch icon, the favicon, and the
// Android launcher icons (legacy, round and adaptive foreground) plus the
// launch splash images. Run with: npm run icons
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// scale: how much of the canvas the artwork occupies (maskable/adaptive need a safe zone).
function art({ scale = 1, background = true, round = false } = {}) {
  const s = scale;
  const t = (512 * (1 - s)) / 2;
  const bg = background
    ? `<rect width="512" height="512" ${round ? 'rx="256"' : ''} fill="url(#bg)"/>
       <g fill="#fff" opacity=".75">
         <circle cx="84" cy="96" r="2.2"/><circle cx="430" cy="70" r="1.6"/><circle cx="452" cy="300" r="2"/>
         <circle cx="60" cy="380" r="1.5"/><circle cx="140" cy="452" r="1.8"/><circle cx="398" cy="448" r="1.4"/>
         <circle cx="300" cy="44" r="1.3"/><circle cx="36" cy="236" r="1.2"/>
       </g>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="46%" r="70%">
      <stop offset="0" stop-color="#1a2558"/><stop offset=".55" stop-color="#0a1030"/><stop offset="1" stop-color="#03040c"/>
    </radialGradient>
    <radialGradient id="sun" cx="42%" cy="40%" r="60%">
      <stop offset="0" stop-color="#fffbe8"/><stop offset=".45" stop-color="#ffd27a"/><stop offset="1" stop-color="#ff8a24"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#ffc56a" stop-opacity=".75"/><stop offset=".45" stop-color="#ff9a3c" stop-opacity=".22"/><stop offset="1" stop-color="#ff7a20" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="earth" cx="35%" cy="32%" r="75%">
      <stop offset="0" stop-color="#bfe3ff"/><stop offset=".35" stop-color="#4e9cff"/><stop offset="1" stop-color="#0b2a6a"/>
    </radialGradient>
    <radialGradient id="ringed" cx="35%" cy="32%" r="75%">
      <stop offset="0" stop-color="#fff3d2"/><stop offset=".45" stop-color="#e7c27e"/><stop offset="1" stop-color="#7a5524"/>
    </radialGradient>
    <linearGradient id="orbit" x1="0" x2="1">
      <stop offset="0" stop-color="#9fb6ff" stop-opacity=".25"/><stop offset=".5" stop-color="#cbd8ff" stop-opacity=".85"/><stop offset="1" stop-color="#9fb6ff" stop-opacity=".25"/>
    </linearGradient>
  </defs>
  ${bg}
  <g transform="translate(${t} ${t}) scale(${s})">
    <g transform="rotate(-18 256 262)">
      <ellipse cx="256" cy="262" rx="214" ry="78" fill="none" stroke="url(#orbit)" stroke-width="7"/>
      <ellipse cx="256" cy="262" rx="140" ry="50" fill="none" stroke="url(#orbit)" stroke-width="5" opacity=".7"/>
    </g>
    <circle cx="256" cy="262" r="150" fill="url(#glow)"/>
    <circle cx="256" cy="262" r="62" fill="url(#sun)"/>
    <g transform="translate(398 168)">
      <ellipse rx="62" ry="15" fill="none" stroke="#c9b07a" stroke-width="7" transform="rotate(-20)" opacity=".8"/>
      <circle r="34" fill="url(#ringed)"/>
      <path d="M -62 0 A 62 15 0 0 0 62 0" fill="none" stroke="#f3dca6" stroke-width="7" transform="rotate(-20)"/>
    </g>
    <circle cx="140" cy="336" r="24" fill="url(#earth)"/>
    <path d="M 128 330 q 6 -8 14 -2 q 6 6 -2 10 z" fill="#4b8a3c" opacity=".8"/>
  </g>
</svg>`;
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  async function render(svg, size, file, { transparent = false, circle = false } = {}) {
    await page.setViewportSize({ width: size, height: size });
    const clip = circle ? `clip-path:circle(50%);` : '';
    await page.setContent(`<html><body style="margin:0;background:${transparent ? 'transparent' : '#03040c'}">
      <div style="width:${size}px;height:${size}px;${clip}">${svg.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</div></body></html>`);
    mkdirSync(dirname(file), { recursive: true });
    await page.screenshot({ path: file, omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
  }

  const pub = join(root, 'public', 'icons');
  mkdirSync(pub, { recursive: true });
  writeFileSync(join(pub, 'favicon.svg'), art({ round: true }));
  await render(art(), 192, join(pub, 'icon-192.png'));
  await render(art(), 512, join(pub, 'icon-512.png'));
  await render(art({ scale: 0.78 }), 512, join(pub, 'icon-maskable-512.png'));
  await render(art({ scale: 0.92 }), 180, join(pub, 'apple-touch-icon.png'));

  // Android launcher icons, if the native project exists.
  const res = join(root, 'android', 'app', 'src', 'main', 'res');
  if (existsSync(res)) {
    const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
    for (const [d, k] of Object.entries(dens)) {
      const dir = join(res, `mipmap-${d}`);
      await render(art({ scale: 0.9 }), Math.round(48 * k), join(dir, 'ic_launcher.png'));
      await render(art({ scale: 0.9, round: true }), Math.round(48 * k), join(dir, 'ic_launcher_round.png'), { transparent: true, circle: true });
      // Adaptive foreground: 108dp canvas, artwork inside the 66dp safe zone.
      await render(art({ scale: 0.6, background: false }), Math.round(108 * k), join(dir, 'ic_launcher_foreground.png'), { transparent: true });
    }
    // Launch splash (shown briefly before the web view paints): dark sky + emblem.
    const splash = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <rect width="${w}" height="${h}" fill="#04050c"/>
      <g transform="translate(${w / 2 - 128} ${h / 2 - 128}) scale(.5)">${art({ background: false }).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g></svg>`;
    const sizes = {
      'drawable': [480, 320], 'drawable-port-mdpi': [320, 480], 'drawable-port-hdpi': [480, 800], 'drawable-port-xhdpi': [720, 1280],
      'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920], 'drawable-land-mdpi': [480, 320],
      'drawable-land-hdpi': [800, 480], 'drawable-land-xhdpi': [1280, 720], 'drawable-land-xxhdpi': [1600, 960], 'drawable-land-xxxhdpi': [1920, 1280],
    };
    for (const [dir, [w, h]] of Object.entries(sizes)) {
      const file = join(res, dir, 'splash.png');
      if (!existsSync(dirname(file))) continue;
      await page.setViewportSize({ width: w, height: h });
      await page.setContent(`<html><body style="margin:0">${splash(w, h)}</body></html>`);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: w, height: h } });
    }
  }
  await browser.close();
  console.log('icons written');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
