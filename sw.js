// Сервис-воркер: сохраняет файлы приложения в кэш браузера,
// чтобы приложение открывалось без интернета.
//
// При каждом изменении файлов приложения нужно увеличить CACHE_VERSION —
// тогда старый кэш будет удалён и файлы загрузятся заново.

const CACHE_VERSION = 'v3';
const CACHE_NAME = `finance-${CACHE_VERSION}`;

const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/styles.css',
  './src/app.js',
  './src/router.js',
  './src/db.js',
  './src/money.js',
  './src/ui.js',
  './src/repo/categories.js',
  './src/repo/operations.js',
  './src/repo/rates.js',
  './src/views/home.js',
  './src/views/operations.js',
  './src/views/operation-form.js',
  './src/views/categories.js',
  './src/views/more.js',
  './src/views/placeholder.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Кэшируем только собственные файлы приложения. Внешние запросы
  // (например, курс валют) обрабатываются своим кодом и в кэш не попадают.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
