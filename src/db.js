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
  {
    version: 4,
    upgrade(db) {
      // Бюджет: строка на месяц и категорию — плановая сумма и лимит (в центах евро).
      // id = 'ГГГГ-ММ:categoryId'.
      const budgets = db.createObjectStore('budgets', { keyPath: 'id' });
      budgets.createIndex('month', 'month');
    },
  },
  {
    version: 5,
    upgrade(db) {
      // Повторяющиеся платежи (расписания).
      const recurring = db.createObjectStore('recurring', { keyPath: 'id' });
      recurring.createIndex('status', 'status');

      // Разовые запланированные платежи.
      const planned = db.createObjectStore('planned', { keyPath: 'id' });
      planned.createIndex('date', 'date');

      // Список желаемых покупок.
      const wishes = db.createObjectStore('wishes', { keyPath: 'id' });
      wishes.createIndex('status', 'status');

      // Фотографии (сжатые изображения, Blob) — для желаемых покупок и чеков.
      db.createObjectStore('photos', { keyPath: 'id' });
    },
  },
  {
    version: 6,
    upgrade(db) {
      // Справочник продуктов: единое название, основная единица, категория по умолчанию.
      const products = db.createObjectStore('products', { keyPath: 'id' });
      products.createIndex('nameLower', 'nameLower', { unique: true });
    },
  },
  {
    version: 7,
    upgrade(_db, tx) {
      // Ожидаемые поступления: у разовых платежей появился вид даты
      // ('day' — точная дата, 'month' — «где-то в ноябре»). Старые записи — точная дата.
      const req = tx.objectStore('planned').openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        const v = cur.value;
        if (!v.dateKind) cur.update({ ...v, dateKind: 'day', movedFrom: v.movedFrom ?? null });
        cur.continue();
      };
    },
  },
  {
    version: 8,
    upgrade(_db, tx) {
      // План в исходной валюте и «каждый месяц». Старые строки — план в евро, без повтора.
      const req = tx.objectStore('budgets').openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        const v = cur.value;
        if (!v.plannedCurrency) cur.update({ ...v, plannedCurrency: 'EUR', plannedOriginal: v.planned ?? null, repeat: false });
        cur.continue();
      };
    },
  },
  {
    version: 9,
    upgrade(db) {
      // Мои долги: кому и сколько должна. Возвраты — операции-расходы с debtId.
      db.createObjectStore('debts', { keyPath: 'id' });
    },
  },
  {
    version: 10,
    upgrade(_db, tx) {
      // У источников дохода: работодатель и срок выплаты. Старым категориям — пусто.
      const req = tx.objectStore('categories').openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        const v = cur.value;
        if (v.employer === undefined) cur.update({ ...v, employer: '', payDay: null, payNextMonth: false });
        cur.continue();
      };
    },
  },
  {
    version: 11,
    upgrade(_db, tx) {
      // Кредиты: у повторяющихся платежей — банк (из справочника банков);
      // у уже заведённых категорий расходов появляется «Кредиты».
      const rec = tx.objectStore('recurring').openCursor();
      rec.onsuccess = () => {
        const cur = rec.result;
        if (!cur) return;
        if (cur.value.bank === undefined) cur.update({ ...cur.value, bank: null });
        cur.continue();
      };
      const cats = tx.objectStore('categories');
      const all = cats.getAll();
      all.onsuccess = () => {
        const rows = all.result;
        if (!rows.length) return; // новая база — «Кредиты» придут с категориями по умолчанию
        const expense = rows.filter((c) => c.kind === 'expense');
        if (expense.some((c) => c.name.toLowerCase() === 'кредиты')) return;
        const order = expense.reduce((m, c) => Math.max(m, c.order), -1) + 1;
        cats.add({ id: crypto.randomUUID(), name: 'Кредиты', kind: 'expense', archived: false, order, createdAt: new Date().toISOString(), employer: '', payDay: null, payNextMonth: false, parentId: null });
      };
    },
  },
  {
    version: 12,
    upgrade(_db, tx) {
      // У кредитов — сумма кредита (основной долг); у старых платежей — пусто
      const rec = tx.objectStore('recurring').openCursor();
      rec.onsuccess = () => {
        const cur = rec.result;
        if (!cur) return;
        // Миграции одного обновления идут одной транзакцией: курсор может прочитать
        // запись до изменений миграции 11 — поэтому поле «банк» тоже заполняется здесь
        const v = cur.value;
        if (v.principal === undefined || v.bank === undefined) cur.update({ ...v, bank: v.bank ?? null, principal: v.principal ?? null });
        cur.continue();
      };
    },
  },
  {
    version: 13,
    upgrade(_db, tx) {
      // Статьи внутри категорий: у категории — ссылка на родителя (у всех существующих — нет).
      // Поля прежних шагов заполняются здесь же: курсор одного обновления может прочитать
      // запись до их изменений.
      const req = tx.objectStore('categories').openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        const v = cur.value;
        if (v.parentId === undefined) cur.update({ ...v, parentId: null, employer: v.employer ?? '', payDay: v.payDay ?? null, payNextMonth: v.payNextMonth ?? false });
        cur.continue();
      };
    },
  },
  {
    version: 14,
    upgrade(db, tx) {
      // Общие данные для семьи: журнал изменений (что отправить в облако)
      // и отметка времени updatedAt у каждой записи — чтобы при слиянии побеждала последняя правка.
      db.createObjectStore('changes', { keyPath: 'id' });
      const now = new Date().toISOString();
      for (const store of ['categories', 'operations', 'rates', 'budgets', 'recurring', 'planned', 'wishes', 'products', 'debts']) {
        const req = tx.objectStore(store).openCursor();
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur) return;
          const v = cur.value;
          if (!v.updatedAt) cur.update({ ...v, updatedAt: v.createdAt ?? now });
          cur.continue();
        };
      }
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

// ---- Общие данные: какие хранилища уходят в облако и журнал изменений ----

/** Хранилища, записи которых синхронизируются между телефонами (фото — нет). */
export const SYNCED_STORES = ['categories', 'operations', 'rates', 'budgets', 'recurring', 'planned', 'wishes', 'products', 'debts', 'settings'];
/** Настройки, общие для семьи; остальные (напоминания, валюта показа, подключение) — свои на каждом телефоне. */
export const SYNCED_SETTINGS = new Set(['banks', 'categoriesSeeded', 'forecastMonths', 'overbuyPercent']);
/** @type {Record<string, string>} */
const KEY_PATH = { settings: 'key', rates: 'date' };

/** Ключ записи хранилища. @param {string} store @param {any} value */
export function keyOf(store, value) {
  return value[KEY_PATH[store] ?? 'id'];
}

/** Нужно ли записывать изменение в журнал. @param {string} store @param {IDBValidKey} key */
export function isSynced(store, key) {
  if (!SYNCED_STORES.includes(store)) return false;
  return store === 'settings' ? SYNCED_SETTINGS.has(String(key)) : true;
}

/**
 * Транзакция на запись: к хранилищам добавляется журнал изменений, если он есть в базе.
 * @param {IDBDatabase} db
 * @param {string | string[]} stores
 */
export function writeTx(db, stores) {
  const list = Array.isArray(stores) ? [...stores] : [stores];
  if (db.objectStoreNames.contains('changes') && !list.includes('changes')) list.push('changes');
  return db.transaction(list, 'readwrite');
}

/**
 * Запись в журнал изменений (внутри транзакции с хранилищем 'changes').
 * @param {IDBTransaction} tx
 * @param {string} store
 * @param {IDBValidKey} key
 * @param {boolean} deleted
 * @param {string} updatedAt
 */
function logChange(tx, store, key, deleted, updatedAt) {
  if (!isSynced(store, key) || !tx.objectStoreNames.contains('changes')) return;
  tx.objectStore('changes').put({ id: `${store}:${String(key)}`, store, key, deleted, updatedAt });
}

/**
 * Кладёт запись и отмечает её в журнале; у синхронизируемых записей обновляет updatedAt.
 * @template {object} T
 * @param {IDBTransaction} tx
 * @param {string} store
 * @param {T} value
 * @returns {T}
 */
export function txPut(tx, store, value) {
  const key = keyOf(store, value);
  const now = new Date().toISOString();
  const v = isSynced(store, key) ? { ...value, updatedAt: now } : value;
  tx.objectStore(store).put(v);
  logChange(tx, store, key, false, now);
  return v;
}

/**
 * Удаляет запись и отмечает удаление в журнале.
 * @param {IDBTransaction} tx
 * @param {string} store
 * @param {IDBValidKey} key
 */
export function txDelete(tx, store, key) {
  tx.objectStore(store).delete(key);
  logChange(tx, store, key, true, new Date().toISOString());
}

/**
 * Помечает все записи синхронизируемых хранилищ как изменённые — при включении общих данных,
 * чтобы отправить в облако всё, что уже есть на телефоне.
 * @param {IDBDatabase} db
 * @returns {Promise<number>} — сколько записей отмечено
 */
export async function enqueueAll(db) {
  const tx = writeTx(db, SYNCED_STORES);
  let n = 0;
  for (const store of SYNCED_STORES) {
    /** @type {any[]} */
    const rows = await promisify(tx.objectStore(store).getAll());
    for (const v of rows) {
      const key = keyOf(store, v);
      if (!isSynced(store, key)) continue;
      logChange(tx, store, key, false, v.updatedAt ?? new Date().toISOString());
      n++;
    }
  }
  await done(tx);
  return n;
}

/** Очищает журнал изменений (при отключении общих данных). @param {IDBDatabase} db */
export async function clearChanges(db) {
  const tx = db.transaction('changes', 'readwrite');
  tx.objectStore('changes').clear();
  await done(tx);
}

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
 * @param {{ raw?: boolean }} [opts]
 */
export async function put(db, store, value, opts = {}) {
  // raw — запись пришла из облака: журнал и updatedAt не трогаем
  if (opts.raw) {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    await done(tx);
    return;
  }
  const tx = writeTx(db, store);
  txPut(tx, store, value);
  await done(tx);
}

/**
 * @param {IDBDatabase} db
 * @param {string} store
 * @param {IDBValidKey} key
 * @param {{ raw?: boolean }} [opts]
 */
export async function remove(db, store, key, opts = {}) {
  if (opts.raw) {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await done(tx);
    return;
  }
  const tx = writeTx(db, store);
  txDelete(tx, store, key);
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
  const tx = writeTx(d, 'settings');
  txPut(tx, 'settings', { key, value });
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
    // «blocked» — временное состояние: удаление завершится, когда закроются
    // остальные соединения (у них сработает onversionchange). Ждём success.
  });
}
