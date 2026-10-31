import { getDb, getAll, getOne, put, count, getSetting, setSetting, writeTx, txPut, txDelete } from '../db.js';

/** @typedef {'expense' | 'income'} Kind */

/**
 * @typedef {Object} Category
 * @property {string} id
 * @property {string} name
 * @property {Kind} kind
 * @property {boolean} archived
 * @property {number} order
 * @property {string} createdAt
 * @property {string} [employer] — для доходов: кто платит
 * @property {number | null} [payDay] — для доходов: какого числа платят
 * @property {boolean} [payNextMonth] — для доходов: за месяц платят в следующем месяце
 * @property {string | null} [parentId] — статья: id категории, внутри которой она (только расходы)
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
    'Кредиты',
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

  const tx = writeTx(d, ['categories', 'settings']);
  const now = new Date().toISOString();
  for (const kind of /** @type {Kind[]} */ (['expense', 'income'])) {
    DEFAULT_CATEGORIES[kind].forEach((name, order) => {
      txPut(tx, 'categories', { id: crypto.randomUUID(), name, kind, archived: false, order, createdAt: now, parentId: null });
    });
  }
  txPut(tx, 'settings', { key: SEEDED_KEY, value: true });
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
  const existing = (await listCategories({ kind, includeArchived: true }, d)).filter((c) => !c.parentId);
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
    parentId: null,
  };
  await put(d, 'categories', category);
  return category;
}

/**
 * Статья внутри категории расходов: «Здоровье» → «Страховка Freedom».
 * @param {string} parentId
 * @param {string} name
 * @param {IDBDatabase} [db]
 * @returns {Promise<Category>}
 */
export async function createArticle(parentId, name, db) {
  const d = db ?? (await getDb());
  const parent = await getCategory(parentId, d);
  if (!parent) throw new Error('Категория не найдена');
  if (parent.parentId) throw new Error('Статью можно добавить только в категорию, не в другую статью');
  if (parent.kind !== 'expense') throw new Error('Статьи — только у категорий расходов');
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Укажите название статьи');
  const siblings = (await listCategories({ kind: 'expense', includeArchived: true }, d)).filter((c) => c.parentId === parentId);
  const same = siblings.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  if (same && !same.archived) throw new Error('Такая статья уже есть');
  if (same) {
    // Была в архиве — возвращаем
    const back = { ...same, archived: false };
    await put(d, 'categories', back);
    return back;
  }
  /** @type {Category} */
  const article = {
    id: crypto.randomUUID(),
    name: trimmed,
    kind: 'expense',
    archived: false,
    order: siblings.reduce((m, c) => Math.max(m, c.order), -1) + 1,
    createdAt: new Date().toISOString(),
    parentId,
  };
  await put(d, 'categories', article);
  return article;
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
  const siblings = (await listCategories({ kind: c.kind, includeArchived: true }, d)).filter((s) => (s.parentId ?? null) === (c.parentId ?? null));
  if (siblings.some((s) => s.id !== id && s.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(c.parentId ? 'Такая статья уже есть' : 'Категория с таким названием уже есть');
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
  // Категория в архив — и её статьи; из архива — вместе с ними
  if (!c.parentId) {
    for (const ch of (await listCategories({ kind: c.kind, includeArchived: true }, d)).filter((x) => x.parentId === id)) {
      await put(d, 'categories', { ...ch, archived });
    }
  }
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

/**
 * Работодатель и срок выплаты источника дохода.
 * @param {string} id
 * @param {{ employer?: string, payDay?: number | null, payNextMonth?: boolean }} terms
 * @param {IDBDatabase} [db]
 */
export async function setIncomeTerms(id, terms, db) {
  const d = db ?? (await getDb());
  const c = await getCategory(id, d);
  if (!c) throw new Error('Категория не найдена');
  if (c.kind !== 'income') throw new Error('Срок выплаты задаётся только для доходов');
  const payDay = terms.payDay == null || terms.payDay === 0 ? null : Number(terms.payDay);
  if (payDay != null && (!Number.isInteger(payDay) || payDay < 1 || payDay > 31)) throw new Error('День выплаты — число от 1 до 31');
  const next = { ...c, employer: (terms.employer ?? c.employer ?? '').trim(), payDay, payNextMonth: payDay != null && Boolean(terms.payNextMonth) };
  await put(d, 'categories', next);
  return next;
}
