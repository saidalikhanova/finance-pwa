import { getDb, getAll, getOne, put, count, getSetting, setSetting } from '../db.js';

/** @typedef {'expense' | 'income'} Kind */

/**
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} name
 * @property {Kind} kind
 * @property {boolean} archived
 * @property {number} order
 * @property {string} createdAt
 */

/** @type {Record<Kind, string>} */
export const KIND_LABEL = { expense: 'Расходы', income: 'Доходы' };

/** Набор категорий по умолчанию, создаётся при первом запуске. */
export const DEFAULT_CATEGORIES = {
  expense: [
    'Продукты',
    'Кафе и рестораны',
    'Транспорт',
    'Жильё',
    'Коммунальные услуги',
    'Связь и интернет',
    'Здоровье',
    'Одежда и обувь',
    'Дети',
    'Образование',
    'Дом и быт',
    'Развлечения',
    'Подарки',
    'Путешествия',
    'Прочее',
  ],
  income: ['Зарплата', 'Прочие доходы'],
};

const SEEDED_KEY = 'categoriesSeeded';

/**
 * Создаёт категории по умолчанию, если это ещё не делалось.
 * @param {IDBDatabase} [db]
 */
export async function seedDefaultCategories(db) {
  const d = db ?? (await getDb());
  if (await getSetting(SEEDED_KEY, d)) return false;

  const tx = d.transaction(['categories', 'settings'], 'readwrite');
  const store = tx.objectStore('categories');
  const now = new Date().toISOString();
  for (const kind of /** @type {Kind[]} */ (['expense', 'income'])) {
    DEFAULT_CATEGORIES[kind].forEach((name, order) => {
      store.add({ id: crypto.randomUUID(), name, kind, archived: false, order, createdAt: now });
    });
  }
  tx.objectStore('settings').put({ key: SEEDED_KEY, value: true });
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
  return true;
}

/**
 * @param {{ kind?: Kind, includeArchived?: boolean }} [opts]
 * @param {IDBDatabase} [db]
 * @returns {Promise<Category[]>}
 */
export async function listCategories(opts = {}, db) {
  const d = db ?? (await getDb());
  /** @type {Category[]} */
  let rows = await getAll(d, 'categories', opts.kind ? { index: 'kind', query: opts.kind } : {});
  if (!opts.includeArchived) rows = rows.filter((c) => !c.archived);
  return rows.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'));
}

/**
 * @param {string} id
 * @param {IDBDatabase} [db]
 * @returns {Promise<Category | undefined>}
 */
export async function getCategory(id, db) {
  const d = db ?? (await getDb());
  return getOne(d, 'categories', id);
}

/**
 * @param {string} name
 * @param {Kind} kind
 * @param {IDBDatabase} [db]
 * @returns {Promise<Category>}
 */
export async function createCategory(name, kind, db) {
  const d = db ?? (await getDb());
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Название категории не может быть пустым');
  const existing = await listCategories({ kind, includeArchived: true }, d);
  if (existing.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error('Категория с таким названием уже есть');
  }
  const order = existing.reduce((m, c) => Math.max(m, c.order), -1) + 1;
  /** @type {Category} */
  const category = {
    id: crypto.randomUUID(),
    name: trimmed,
    kind,
    archived: false,
    order,
    createdAt: new Date().toISOString(),
  };
  await put(d, 'categories', category);
  return category;
}

/**
 * @param {string} id
 * @param {string} name
 * @param {IDBDatabase} [db]
 */
export async function renameCategory(id, name, db) {
  const d = db ?? (await getDb());
  const c = await getCategory(id, d);
  if (!c) throw new Error('Категория не найдена');
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Название категории не может быть пустым');
  const siblings = await listCategories({ kind: c.kind, includeArchived: true }, d);
  if (siblings.some((s) => s.id !== id && s.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error('Категория с таким названием уже есть');
  }
  await put(d, 'categories', { ...c, name: trimmed });
}

/**
 * @param {string} id
 * @param {boolean} archived
 * @param {IDBDatabase} [db]
 */
export async function setCategoryArchived(id, archived, db) {
  const d = db ?? (await getDb());
  const c = await getCategory(id, d);
  if (!c) throw new Error('Категория не найдена');
  await put(d, 'categories', { ...c, archived });
}

/**
 * Число операций в категории. Удаление категории с операциями запрещено
 * техническим заданием — вместо него используется архивирование.
 * @param {string} id
 * @param {IDBDatabase} [db]
 */
export async function countOperationsInCategory(id, db) {
  const d = db ?? (await getDb());
  return count(d, 'operations', 'categoryId', id);
}
