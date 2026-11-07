// End-to-end smoke test of the built web app in headless Chromium on a phone
// viewport: start-up, tap-to-focus, info card, pause, speed slider, toggles,
// overview, the PWA manifest and icons, no network requests to other origins,
// and a full reload while offline (service worker).
//
//   npm run build && npm run test:e2e
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const PORT = 4179;
const BASE = `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS_DIR || 'test-results';

if (!existsSync('dist/index.html')) {
  console.error('dist/ is missing: run `npm run build` first.');
  process.exit(1);
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
const stop = () => server.kill('SIGTERM');
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('preview server did not start');
}

const steps = [];
const step = async (name, fn) => {
  const t = Date.now();
  await fn();
  steps.push(`  ✓ ${name} (${Date.now() - t} ms)`);
  console.log(steps.at(-1));
};

let browser;
try {
  await waitForServer();
  mkdirSync(SHOTS, { recursive: true });
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  const foreign = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => {
    if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) foreign.push(r.url());
  });
  const app = (fn, arg) => page.evaluate(fn, arg);
  const settle = () => app(() => window.planet3d.settle());

  await step('loads and bakes the planets', async () => {
    await page.goto(BASE);
    await page.waitForFunction(() => window.planet3d && window.planet3d.ready, null, { timeout: 180000 });
    await page.waitForSelector('#loader.done', { state: 'attached' });
    assert.equal(await page.title(), 'Planet 3D');
  });

  await step('renders a non-empty scene', async () => {
    await page.waitForTimeout(800);
    await settle();
    await page.waitForTimeout(800);
    const png = await page.screenshot({ path: `${SHOTS}/overview.png` });
    assert.ok(png.length > 40000, 'screenshot should not be blank');
  });

  await step('labels the planets', async () => {
    const shown = await app(() => window.planet3d.labels.items.filter((i) => i.shown).map((i) => i.body.id));
    assert.ok(shown.includes('sun') && shown.includes('jupiter'), `labels shown: ${shown}`);
  });

  await step('tapping a chip flies to the planet and opens its info card', async () => {
    await page.click('.chip.planet:has-text("Jupiter")');
    await page.waitForTimeout(500);
    await settle();
    await page.waitForTimeout(500);
    assert.equal(await app(() => window.planet3d.state.focus), 'jupiter');
    assert.equal(await page.textContent('#info h2'), 'Jupiter');
    await page.waitForFunction(() => /AU/.test(document.querySelector('#info .live').textContent), null, { timeout: 5000 });
    assert.ok(await page.isVisible('.chip.moon:has-text("Io")'), 'moon chips appear');
    const follow = await app(() => {
      const a = window.planet3d;
      const p = a.system.get('jupiter').pos;
      return Math.hypot(a.rig.target.x - p[0], a.rig.target.y - p[1], a.rig.target.z - p[2]);
    });
    assert.ok(follow < 1e-6, 'camera follows the planet');
    await page.screenshot({ path: `${SHOTS}/jupiter.png` });
  });

  await step('info card expands and hides without leaving the planet', async () => {
    await page.click('#info [data-act=more]');
    assert.ok(await page.isVisible('#info .stats .x'), 'details shown');
    await page.click('#info [data-act=close]');
    assert.ok(await page.isHidden('#info'));
    assert.ok(await page.isVisible('#info-pill'));
    await page.click('#info-pill');
    assert.ok(await page.isVisible('#info'));
  });

  await step('tapping a planet in the 3D view focuses it', async () => {
    await page.click('[data-act=home]');
    await page.waitForTimeout(300);
    await settle();
    await page.waitForTimeout(600);
    const s = await app(() => {
      const v = window.planet3d.labels.screen.get('saturn');
      return { x: v.x, y: v.y, visible: v.visible };
    });
    assert.ok(s.visible);
    await page.touchscreen.tap(s.x, s.y);
    await page.waitForTimeout(400);
    assert.equal(await app(() => window.planet3d.state.focus), 'saturn');
  });

  await step('pause stops time and play resumes it', async () => {
    await page.click('#btn-play');
    const jd1 = await app(() => window.planet3d.jd);
    await page.waitForTimeout(700);
    const jd2 = await app(() => window.planet3d.jd);
    assert.equal(jd1, jd2);
    assert.ok(await page.isVisible('#paused-tag'));
    await page.click('#btn-play');
    await page.waitForTimeout(700);
    assert.ok((await app(() => window.planet3d.jd)) > jd2);
  });

  await step('speed slider changes the simulation rate', async () => {
    const box = await page.locator('#speed-slider').boundingBox();
    await page.mouse.click(box.x + box.width - 12, box.y + box.height / 2);
    assert.match(await page.textContent('#speed-out'), /yr\/s|mo\/s/);
    await page.mouse.click(box.x + 12, box.y + box.height / 2);
    assert.match(await page.textContent('#speed-out'), /Real time|real time/);
  });

  await step('reverse runs time backwards', async () => {
    const box = await page.locator('#speed-slider').boundingBox();
    await page.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2);
    await page.click('#btn-reverse');
    const jd1 = await app(() => window.planet3d.jd);
    await page.waitForTimeout(600);
    assert.ok((await app(() => window.planet3d.jd)) < jd1);
    await page.click('#btn-reverse');
  });

  await step('toggles switch trails, orbits, labels and belts', async () => {
    for (const name of ['trails', 'orbits', 'labels', 'belts']) {
      await page.click(`[data-toggle=${name}]`);
      assert.equal(await app((n) => window.planet3d.state[n], name), false, name);
      await page.click(`[data-toggle=${name}]`);
      assert.equal(await app((n) => window.planet3d.state[n], name), true, name);
    }
    assert.equal(await app(() => window.planet3d.trailLines.get('earth').visible), true);
  });

  await step('true-scale distances morph and come back', async () => {
    await page.click('[data-act=scale]');
    await page.waitForTimeout(300);
    await settle();
    await page.waitForTimeout(300);
    assert.equal(await app(() => window.planet3d.blend), 1);
    await page.click('[data-act=scale]');
    await page.waitForTimeout(300);
    await settle();
    await page.waitForTimeout(300);
    assert.equal(await app(() => window.planet3d.blend), 0);
  });

  await step('"Now" returns to the present date', async () => {
    await app(() => { window.planet3d.jd += 5000; });
    await page.click('[data-act=now]');
    await page.waitForTimeout(300);
    await settle();
    await page.waitForTimeout(300);
    const off = await app(() => Math.abs(window.planet3d.jd - (Date.now() / 86400000 + 2440587.5)));
    assert.ok(off < 1, `${off} days from now`);
  });

  await step('overview clears the focus', async () => {
    await page.click('[data-act=home]');
    assert.equal(await app(() => window.planet3d.state.focus), null);
    assert.ok(await page.isHidden('#info'));
  });

  await step('ships a web app manifest with installable icons', async () => {
    const manifest = await (await fetch(new URL('manifest.webmanifest', BASE))).json();
    assert.equal(manifest.display, 'fullscreen');
    for (const icon of manifest.icons) {
      const r = await fetch(new URL(icon.src, BASE));
      assert.ok(r.ok, icon.src);
    }
    assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
    assert.ok((await fetch(new URL('icons/apple-touch-icon.png', BASE))).ok);
  });

  await step('works with no network after the first visit', async () => {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 30000 });
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => window.planet3d && window.planet3d.ready, null, { timeout: 180000 });
    await context.setOffline(false);
  });

  await step('no errors and no requests to other servers', async () => {
    assert.deepEqual(errors, []);
    assert.deepEqual(foreign, []);
  });

  console.log(`\n${steps.length} checks passed.`);
} catch (e) {
  console.error('\nE2E FAILED:', e);
  process.exitCode = 1;
} finally {
  await browser?.close();
  stop();
}
