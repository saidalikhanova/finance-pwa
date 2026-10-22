// Сервис-воркер: сохраняет файлы приложения в кэш браузера,
// чтобы приложение открывалось без интернета.
//
// При каждом изменении файлов приложения нужно увеличить CACHE_VERSION —
// тогда старый кэш будет удалён и файлы загрузятся заново.

const CACHE_VERSION = 'v24';
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
  './src/icons.js',
  './src/repo/categories.js',
  './src/repo/operations.js',
  './src/repo/rates.js',
  './src/repo/budgets.js',
  './src/limits.js',
  './src/reports.js',
  './src/dates.js',
  './src/recurring.js',
  './src/photos.js',
  './src/ics.js',
  './src/items.js',
  './src/chat-import.js',
  './src/products-stats.js',
  './src/csv.js',
  './src/zip.js',
  './src/backup.js',
  './src/backup-reminder.js',
  './src/expected.js',
  './src/income.js',
  './src/display.js',
  './src/debts.js',
  './src/repo/debts.js',
  './src/repo/products.js',
  './src/repo/import.js',
  './src/repo/recurring.js',
  './src/repo/planned.js',
  './src/repo/wishes.js',
  './src/repo/upcoming.js',
  './src/views/home.js',
  './src/views/operations.js',
  './src/views/operation-form.js',
  './src/views/categories.js',
  './src/views/more.js',
  './src/views/budget.js',
  './src/views/budget-line.js',
  './src/views/income-line.js',
  './src/views/debts.js',
  './src/views/debt.js',
  './src/views/rates.js',
  './src/views/reports.js',
  './src/views/form-parts.js',
  './src/views/payments.js',
  './src/views/payment-form.js',
  './src/views/planned-form.js',
  './src/views/calendar.js',
  './src/views/wishes.js',
  './src/views/wish-form.js',
  './src/views/items-editor.js',
  './src/views/import.js',
  './src/views/quick-entry.js',
  './src/views/quick-add.js',
  './src/views/currency-input.js',
  './src/views/donut.js',
  './src/views/products.js',
  './src/views/product.js',
  './src/views/product-reports.js',
  './src/views/forecast.js',
  './src/views/backup.js',
  './src/views/settings.js',
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
