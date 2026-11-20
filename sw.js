const CACHE_NAME = 'saldo-static-v6';
const BASE = self.registration.scope;
const INDEX = new URL('./index.html', BASE).href;
const FILES = new Set([
  './', './index.html', './styles.css?v=6', './vendor/supabase.js?v=6',
  './saldo-calendar.js?v=6', './saldo-rules.js?v=6', './saldo-extras.js?v=6',
  './saldo-planning.js?v=6', './saldo-recurrence.js?v=6', './saldo-tools.js?v=6',
  './supabase-config.js?v=6', './saldo-state.js?v=6', './app.js?v=6', './manifest.webmanifest',
  './icons/saldo.svg', './icons/icon-192.png', './icons/icon-512.png',
  './icons/apple-touch-icon.png', './privacy.html',
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
    icon: new URL('./icons/icon-192.png', BASE).href,
    badge: new URL('./icons/icon-192.png', BASE).href,
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
