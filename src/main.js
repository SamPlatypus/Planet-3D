import './styles.css';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { App } from './app.js';

function fatal(msg) {
  const el = document.createElement('div');
  el.className = 'fatal';
  el.textContent = msg;
  document.body.appendChild(el);
  document.getElementById('loader')?.classList.add('done');
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

function boot() {
  if (!webglAvailable()) {
    fatal('Planet 3D needs WebGL 2, which this browser or device does not provide.');
    return;
  }
  let app;
  try {
    app = new App({
      canvas: document.getElementById('scene'),
      stage: document.getElementById('stage'),
      labels: document.getElementById('labels'),
    });
  } catch (err) {
    console.error(err);
    fatal('Sorry — the 3D view could not start on this device.');
    return;
  }
  window.planet3d = app; // handy for debugging and automated tests
  app.start();

  const native = Capacitor.isNativePlatform();

  // Android back button: leave a focused body first, then show hidden controls, then exit.
  if (native) {
    CapApp.addListener('backButton', () => {
      if (app.state.focus) app.goHome();
      else if (!app.ui.hudVisible) app.ui.setHudVisible(true);
      else CapApp.minimizeApp().catch(() => CapApp.exitApp());
    });
    CapApp.addListener('pause', () => {
      app._last = performance.now();
    });
  }

  // Offline support for the web build: a service worker precaches everything.
  if (!native && import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          sw?.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              app.ui.toast('Updated — reopen the app to use the new version', 3500);
            }
          });
        });
      }).catch((e) => console.warn('Service worker registration failed', e));
    });
  }

  // "Add to Home Screen": Chromium offers a prompt we can trigger from a button.
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    app.ui.setInstallable(true);
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    app.ui.setInstallable(false);
    app.ui.toast('Installed — Planet 3D now works offline from your home screen', 3000);
  });
  app.onInstall = async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    app.ui.setInstallable(false);
  };

  // iOS Safari has no install prompt: show a one-time hint instead.
  app.onReady = () => {
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    let shown = false;
    try {
      shown = localStorage.getItem('planet3d:ios-hint') === '1';
    } catch {
      /* ignore */
    }
    if (!native && ios && !standalone && !shown) {
      setTimeout(() => app.ui.toast('To install: tap Share, then “Add to Home Screen”', 5000), 4000);
      try {
        localStorage.setItem('planet3d:ios-hint', '1');
      } catch {
        /* ignore */
      }
    }
  };
}

boot();
