/* Offline-capable app shell. Live API responses are never cached as truth. */
'use strict';
const CACHE_NAME = 'pysmarthome-shell-v4.0.0';
const BASE_URL = new URL('./', self.location.href);
const SHELL_FILES = ['', 'index.html', 'style.css', 'app.js', 'bg.js', 'analytics-loader.js', 'manifest.webmanifest', 'icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_FILES.map(file => new URL(file, BASE_URL).href));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('pysmarthome-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return; // sensor state must always be real-time

  const isData = url.pathname.includes('/data/');
  if (isData) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch (_) {
        const cached = await cache.match(request);
        return cached || new Response('This data file has not been cached yet. Connect once to load it.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    } catch (_) {
      const cached = await cache.match(request) || await cache.match(new URL('index.html', BASE_URL).href);
      return cached || new Response('App shell unavailable offline. Open the dashboard online at least once.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
