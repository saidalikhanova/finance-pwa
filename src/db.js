// Локальная база данных приложения (IndexedDB).
//
// Схема версионируется. Каждое изменение схемы — новая запись в MIGRATIONS
// с номером на единицу больше предыдущего. При открытии базы браузер
// последовательно применяет только те миграции, которых ещё не было.
// Миграции никогда не редактируются задним числом и никогда не удаляются.

export const DB_NAME = 'finance';

/**
 * @typedef {Object} Migration
 * @property {number} version
 * @property {(db: IDBDatabase, tx: IDBTransaction) => void} upgrade
 */

/** @type {Migration[]} */
export const MIGRATIONS = [
  {
    version: 1,
    upgrade(db) {
      // Настройки приложения: пары «ключ — значение».
      db.createObjectStore('settings', { keyPath: 'key' });
    },
  },
  {
    version: 2,
    upgrade(db) {
      // Справочник категорий доходов и расходов.
      const categories = db.createObjectStore('categories', { keyPath: 'id' });
      categories.createIndex('kind', 'kind');

      // Операции (доходы и расходы). Суммы — целые в минимальных единицах.
      const operations = db.createObjectStore('operations', { keyPath: 'id' });
      operations.createIndex('date', 'date');
      operations.createIndex('categoryId', 'categoryId');
      operations.createIndex('type', 'type');
    },
  },
  {
    version: 3,
    upgrade(db) {
      // Курсы тенге к евро по датам: { date: 'ГГГГ-ММ-ДД', rate: целое × RATE_SCALE, source }.
      db.createObjectStore('rates', { keyPath: 'date' });
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;

/**
 * Открывает базу, применяя недостающие миграции.
 * @param {string} [name]
 * @param {Migration[]} [migrations]
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase(name = DB_NAME, migrations = MIGRATIONS) {
  const targetVersion = migrations[migrations.length - 1].version;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, targetVersion);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = /** @type {IDBTransaction} */ (request.transaction);
      const from = event.oldVersion;
      for (const m of migrations) {
        if (m.version > from) m.upgrade(db, tx);
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // Если другая вкладка обновит схему, закрываем своё соединение,
      // чтобы не блокировать обновление.
      db.onversionchange = () => {
        db.close();
        if (name === DB_NAME) dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('База данных заблокирована другой вкладкой'));
  });
}

/** Единое соединение приложения. */
export function getDb() {
  if (!dbPromise) dbPromise = openDatabase();
  return dbPromise;
}

/**
 * Оборачивает запрос IndexedDB в Promise.
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
export function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Ждёт завершения транзакции.
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
export function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Все записи таблицы или индекса.
 * @template T
 * @param {IDBDatabase} db
 * @param {string} store
 * @param {{ index?: string, query?: IDBValidKey | IDBKeyRange }} [opts]
 * @returns {Promise<T[]>}
 */
export function getAll(db, store, opts = {}) {
  const s = db.transaction(store).objectStore(store);
  const source = opts.index ? s.index(opts.index) : s;
  return promisify(source.getAll(opts.query));
}

/**
 * @template T
 * @param {IDBDatabase} db
 * @param {string} store
 * @param {IDBValidKey} key
 * @returns {Promise<T | undefined>}
 */
export function getOne(db, store, key) {
  return promisify(db.transaction(store).objectStore(store).get(key));
}

/**
 * @param {IDBDatabase} db
 * @param {string} store
 * @param {object} value
 */
export async function put(db, store, value) {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  await done(tx);
}

/**
 * @param {IDBDatabase} db
 * @param {string} store
 * @param {IDBValidKey} key
 */
export async function remove(db, store, key) {
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await done(tx);
}

/**
 * @param {IDBDatabase} db
 * @param {string} store
 * @param {string} index
 * @param {IDBValidKey | IDBKeyRange} query
 */
export function count(db, store, index, query) {
  return promisify(db.transaction(store).objectStore(store).index(index).count(query));
}

/**
 * @param {string} key
 * @param {IDBDatabase} [db]
 */
export async function getSetting(key, db) {
  const d = db ?? (await getDb());
  const row = await promisify(d.transaction('settings').objectStore('settings').get(key));
  return row ? row.value : undefined;
}

/**
 * @param {string} key
 * @param {unknown} value
 * @param {IDBDatabase} [db]
 */
export async function setSetting(key, value, db) {
  const d = db ?? (await getDb());
  const tx = d.transaction('settings', 'readwrite');
  tx.objectStore('settings').put({ key, value });
  await done(tx);
}

/**
 * Полностью удаляет базу. Используется в тестах.
 * @param {string} name
 */
export function deleteDatabase(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve(undefined);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Удаление заблокировано открытым соединением'));
  });
}
