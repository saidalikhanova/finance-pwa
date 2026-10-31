import { getDb, getAll, getOne, put, remove, done, writeTx, txPut, txDelete } from '../db.js';

/**
 * @typedef {'want' | 'planned' | 'bought'} WishStatus
 * @typedef {'high' | 'medium' | 'low'} Priority
 */

/**
 * @typedef {Object} Wish
 * @property {string} id
 * @property {string} name
 * @property {string | null} photoId — ключ в таблице photos
 * @property {string} link
 * @property {number | null} price — в минимальных единицах
 * @property {import('../money.js').Currency} currency
 * @property {string} categoryId
 * @property {Priority} priority
 * @property {string} comment
 * @property {WishStatus} status
 * @property {string | null} plannedMonth — ГГГГ-ММ, если запланировано
 * @property {string | null} boughtAt — дата покупки
 * @property {number | null} actualPrice — фактическая цена в минимальных единицах
 * @property {string | null} operationId
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/** @type {Record<WishStatus, string>} */
export const WISH_STATUS_LABEL = { want: 'Хочу', planned: 'Запланировано на месяц', bought: 'Куплено' };
/** @type {Record<Priority, string>} */
export const PRIORITY_LABEL = { high: 'Высокий', medium: 'Средний', low: 'Низкий' };
/** @type {Record<Priority, number>} */
export const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

/** @param {Partial<Wish>} input */
export function normalizeWish(input) {
  const name = (input.name ?? '').trim();
  if (!name) throw new Error('Укажите название');
  if (input.currency !== 'EUR' && input.currency !== 'KZT') throw new Error('Не указана валюта');
  if (input.price != null && (!Number.isSafeInteger(input.price) || input.price < 0)) throw new Error('Цена указана неверно');
  if (!input.categoryId) throw new Error('Не выбрана категория');
  if (!['high', 'medium', 'low'].includes(input.priority ?? '')) throw new Error('Не указан приоритет');
  const link = (input.link ?? '').trim();
  if (link && !/^https?:\/\//i.test(link)) throw new Error('Ссылка должна начинаться с http:// или https://');
  return {
    name,
    link,
    price: input.price ?? null,
    currency: input.currency,
    categoryId: input.categoryId,
    priority: /** @type {Priority} */ (input.priority),
    comment: (input.comment ?? '').trim(),
  };
}

/**
 * @param {Partial<Wish>} input
 * @param {IDBDatabase} [db]
 * @returns {Promise<Wish>}
 */
export async function createWish(input, db) {
  const d = db ?? (await getDb());
  const now = new Date().toISOString();
  /** @type {Wish} */
  const w = {
    id: crypto.randomUUID(),
    ...normalizeWish(input),
    photoId: input.photoId ?? null,
    status: 'want',
    plannedMonth: null,
    boughtAt: null,
    actualPrice: null,
    operationId: null,
    createdAt: now,
    updatedAt: now,
  };
  await put(d, 'wishes', w);
  return w;
}

/**
 * @param {string} id
 * @param {Partial<Wish>} input
 * @param {IDBDatabase} [db]
 */
export async function updateWish(id, input, db) {
  const d = db ?? (await getDb());
  const w = await getWish(id, d);
  if (!w) throw new Error('Запись не найдена');
  /** @type {Wish} */
  const next = { ...w, ...normalizeWish({ ...w, ...input }), updatedAt: new Date().toISOString() };
  for (const k of /** @type {const} */ (['photoId', 'status', 'plannedMonth', 'boughtAt', 'actualPrice', 'operationId'])) {
    if (input[k] !== undefined) /** @type {any} */ (next)[k] = input[k];
  }
  await put(d, 'wishes', next);
  return next;
}

/**
 * Удаляет запись вместе с фотографией.
 * @param {string} id
 * @param {IDBDatabase} [db]
 */
export async function deleteWish(id, db) {
  const d = db ?? (await getDb());
  const w = await getWish(id, d);
  const tx = writeTx(d, ['wishes', 'photos']);
  txDelete(tx, 'wishes', id);
  if (w?.photoId) tx.objectStore('photos').delete(w.photoId);
  await done(tx);
}

/**
 * @param {string} id
 * @param {IDBDatabase} [db]
 * @returns {Promise<Wish | undefined>}
 */
export async function getWish(id, db) {
  const d = db ?? (await getDb());
  return getOne(d, 'wishes', id);
}

/**
 * @param {IDBDatabase} [db]
 * @returns {Promise<Wish[]>}
 */
export async function listWishes(db) {
  const d = db ?? (await getDb());
  return getAll(d, 'wishes');
}

/**
 * Переносит выбранные записи в плановые расходы бюджета месяца:
 * к плану категории прибавляется цена в евро, статус → «Запланировано на месяц».
 * @param {string[]} ids
 * @param {string} month — ГГГГ-ММ
 * @param {(w: Wish) => number | null} priceEur — цена записи в центах евро (null — не известна)
 * @param {IDBDatabase} [db]
 * @returns {Promise<{ moved: number, skipped: number }>}
 */
export async function planWishes(ids, month, priceEur, db) {
  const d = db ?? (await getDb());
  const wishes = (await listWishes(d)).filter((w) => ids.includes(w.id));
  const tx = writeTx(d, ['wishes', 'budgets']);
  const budgets = tx.objectStore('budgets');
  const now = new Date().toISOString();
  let moved = 0;
  let skipped = 0;
  /** @type {Map<string, number>} */
  const add = new Map();
  for (const w of wishes) {
    const eur = priceEur(w);
    if (eur == null) {
      skipped++;
      continue;
    }
    add.set(w.categoryId, (add.get(w.categoryId) ?? 0) + eur);
    txPut(tx, 'wishes', { ...w, status: 'planned', plannedMonth: month, updatedAt: now });
    moved++;
  }
  for (const [categoryId, eur] of add) {
    const id = `${month}:${categoryId}`;
    const req = budgets.get(id);
    req.onsuccess = () => {
      const line = req.result ?? { id, month, categoryId, planned: null, limit: null };
      txPut(tx, 'budgets', { ...line, planned: (line.planned ?? 0) + eur, updatedAt: now });
    };
  }
  await done(tx);
  return { moved, skipped };
}
