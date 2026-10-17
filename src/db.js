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
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
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
