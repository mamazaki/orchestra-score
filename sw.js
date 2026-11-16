const CACHE_NAME = 'maestroscroll-v1.3.1';
const CORE_ASSETS = [
  './',
  './index.html',
  './css/styles.css?v=1.3.1',
  './js/sample-scores.js?v=1.3.1',
  './js/audio-engine.js?v=1.3.1',
  './js/xml-processor.js?v=1.3.1',
  './js/app.js?v=1.3.1',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Network-first strategy for all requests so mobile & desktop always get latest UI/scores,
  // falling back to offline cache when disconnected.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
