const CACHE_NAME = 'saldo-static-v7.1';
const BASE = self.registration.scope;
const INDEX = new URL('./index.html', BASE).href;
const FILES = new Set([
  './', './index.html', './styles.css?v=7', './vendor/supabase.js?v=7',
  './saldo-theme.js?v=7', './saldo-calendar.js?v=7', './saldo-rules.js?v=7', './saldo-extras.js?v=7',
  './saldo-planning.js?v=7', './saldo-recurrence.js?v=7', './saldo-tools.js?v=7',
  './supabase-config.js?v=7', './saldo-state.js?v=7', './app.js?v=7', './manifest.webmanifest',
  './icons/saldo.svg?v=7', './icons/notification-badge.png?v=7', './icons/icon-192.png?v=7',
  './icons/launcher.svg', './icons/launcher-192.png', './icons/launcher-512.png',
  './icons/launcher-maskable-512.png', './icons/launcher-apple-180.png', './privacy.html',
].map(path => new URL(path, BASE).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(
    [...FILES].map(url => new Request(url, { cache: 'reload' })),
  )).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('saldo-static-') && key !== CACHE_NAME).map(key => caches.delete(key)),
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(BASE)) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      const url = new URL(request.url);
      return await cache.match(url.pathname.endsWith('/privacy.html') ? new URL('./privacy.html', BASE).href : INDEX)
        || Response.error();
    }));
  } else if (FILES.has(request.url)) {
    event.respondWith(caches.open(CACHE_NAME).then(async cache => await cache.match(request) || fetch(request)));
  }
});

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* Use default content. */ }
  event.waitUntil(self.registration.showNotification(payload.title || 'Saldo', {
    body: payload.body || 'Abre Saldo para revisar tus finanzas.',
    icon: new URL('./icons/icon-192.png?v=7', BASE).href,
    badge: new URL('./icons/notification-badge.png?v=7', BASE).href,
    data: { url: BASE },
    tag: payload.tag || 'saldo-notification',
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const existing = clients.find(client => client.url.startsWith(BASE));
    return existing ? existing.focus() : self.clients.openWindow(BASE);
  }));
});
