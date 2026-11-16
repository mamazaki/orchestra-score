const CACHE_NAME = 'maestroscroll-v1.3.4';
const CORE_ASSETS = [
  './',
  './index.html',
  './css/styles.css?v=1.3.4',
  './js/sample-scores.js?v=1.3.4',
  './js/audio-engine.js?v=1.3.4',
  './js/xml-processor.js?v=1.3.4',
  './js/app.js?v=1.3.4',
  './manifest.json?v=1.3.4'
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
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING' || event.data.action === 'skipWaiting') {
    self.skipWaiting();
  } else if (event.data.type === 'CLEAR_ALL_CACHES') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    );
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const isHtml = event.request.mode === 'navigate' ||
                 (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'));

  // For HTML page navigation: strictly network-first with cache: 'no-cache'
  // so mobile browsers never get stuck on an old HTML bundle.
  if (isHtml) {
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' })
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html') || caches.match('./')))
    );
    return;
  }

  // For JS / CSS / Assets: Network-first falling back to cache
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
