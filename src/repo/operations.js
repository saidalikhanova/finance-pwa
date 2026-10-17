import { getDb, getAll, getOne, put, remove } from '../db.js';
import { toEurCents } from '../money.js';

/**
 * @typedef {import('../money.js').Currency} Currency
 * @typedef {'expense' | 'income'} OperationType
 */

/**
 * @typedef {Object} Operation
 * @property {string} id
 * @property {OperationType} type
 * @property {string} date — ГГГГ-ММ-ДД
 * @property {Currency} currency
 * @property {number} amount — в минимальных единицах исходной валюты
 * @property {number | null} rate — тенге за евро × RATE_SCALE; null — курс не определён
 * @property {'nbk' | 'manual' | null} rateSource
 * @property {number | null} amountEur — в центах; null, пока курс не определён
 * @property {string} categoryId
 * @property {string} comment
 * @property {Array<object>} items — позиции покупки (появятся на этапах 7–8)
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/** @type {Record<OperationType, string>} */
export const TYPE_LABEL = { expense: 'Расход', income: 'Доход' };

/** Сегодняшняя дата в формате ГГГГ-ММ-ДД по местному времени. */
export function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Проверяет поля и вычисляет сумму в евро.
 * @param {Partial<Operation>} input
 * @returns {Omit<Operation, 'id' | 'createdAt' | 'updatedAt'>}
 */
export function normalizeOperation(input) {
  if (input.type !== 'expense' && input.type !== 'income') throw new Error('Не указан тип операции');
  if (input.currency !== 'EUR' && input.currency !== 'KZT') throw new Error('Не указана валюта');
  if (!Number.isSafeInteger(input.amount) || /** @type {number} */ (input.amount) <= 0) {
    throw new Error('Сумма должна быть больше нуля');
  }
  if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Не указана дата');
  if (!input.categoryId) throw new Error('Не выбрана категория');

  const amount = /** @type {number} */ (input.amount);
  const rate = input.currency === 'EUR' ? null : (input.rate ?? null);
  const rateSource = input.currency === 'EUR' ? null : rate ? (input.rateSource ?? 'manual') : null;

  return {
    type: input.type,
    date: input.date,
    currency: input.currency,
    amount,
    rate,
    rateSource,
    amountEur: toEurCents(amount, input.currency, rate),
    categoryId: input.categoryId,
    comment: (input.comment ?? '').trim(),
    items: input.items ?? [],
  };
}

/**
 * @param {Partial<Operation>} input
 * @param {IDBDatabase} [db]
 * @returns {Promise<Operation>}
 */
export async function createOperation(input, db) {
  const d = db ?? (await getDb());
  const now = new Date().toISOString();
  /** @type {Operation} */
  const op = { id: crypto.randomUUID(), ...normalizeOperation(input), createdAt: now, updatedAt: now };
  await put(d, 'operations', op);
  return op;
}

/**
 * @param {string} id
 * @param {Partial<Operation>} input
 * @param {IDBDatabase} [db]
 * @returns {Promise<Operation>}
 */
export async function updateOperation(id, input, db) {
  const d = db ?? (await getDb());
  const existing = await getOperation(id, d);
  if (!existing) throw new Error('Операция не найдена');
  /** @type {Operation} */
  const op = {
    ...existing,
    ...normalizeOperation({ ...existing, ...input }),
    updatedAt: new Date().toISOString(),
  };
  await put(d, 'operations', op);
  return op;
}

/**
 * @param {string} id
 * @param {IDBDatabase} [db]
 */
export async function deleteOperation(id, db) {
  const d = db ?? (await getDb());
  await remove(d, 'operations', id);
}

/**
 * @param {string} id
 * @param {IDBDatabase} [db]
 * @returns {Promise<Operation | undefined>}
 */
export async function getOperation(id, db) {
  const d = db ?? (await getDb());
  return getOne(d, 'operations', id);
}

/**
 * @typedef {Object} OperationFilter
 * @property {string} [from] — ГГГГ-ММ-ДД включительно
 * @property {string} [to] — ГГГГ-ММ-ДД включительно
 * @property {OperationType} [type]
 * @property {string} [categoryId]
 */

/**
 * Операции по фильтру, новые сверху.
 * @param {OperationFilter} [filter]
 * @param {IDBDatabase} [db]
 * @returns {Promise<Operation[]>}
 */
export async function listOperations(filter = {}, db) {
  const d = db ?? (await getDb());
  let query;
  if (filter.from && filter.to) query = IDBKeyRange.bound(filter.from, filter.to);
  else if (filter.from) query = IDBKeyRange.lowerBound(filter.from);
  else if (filter.to) query = IDBKeyRange.upperBound(filter.to);

  /** @type {Operation[]} */
  let rows = await getAll(d, 'operations', { index: 'date', query });
  if (filter.type) rows = rows.filter((o) => o.type === filter.type);
  if (filter.categoryId) rows = rows.filter((o) => o.categoryId === filter.categoryId);
  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt)));
}

/**
 * Границы месяца: «2026-10» → { from: '2026-10-01', to: '2026-10-31' }.
 * @param {string} month — ГГГГ-ММ
 */
export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}
