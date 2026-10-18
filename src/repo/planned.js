import { getDb, getAll, getOne, put, remove } from '../db.js';

/**
 * Разовый запланированный платёж — напоминание в календаре. Операция создаётся
 * по кнопке «Оплачено» (тогда done = true и operationId заполнен).
 * @typedef {Object} PlannedPayment
 * @property {string} id
 * @property {string} name
 * @property {'expense' | 'income'} type
 * @property {number} amount
 * @property {import('../money.js').Currency} currency
 * @property {string} categoryId
 * @property {string} date — ГГГГ-ММ-ДД
 * @property {boolean} done
 * @property {string | null} operationId
 * @property {string} createdAt
 */

/** @param {Partial<PlannedPayment>} input */
export function normalizePlanned(input) {
  const name = (input.name ?? '').trim();
  if (!name) throw new Error('Укажите название платежа');
  if (input.type !== 'expense' && input.type !== 'income') throw new Error('Не указан тип');
  if (input.currency !== 'EUR' && input.currency !== 'KZT') throw new Error('Не указана валюта');
  if (!Number.isSafeInteger(input.amount) || /** @type {number} */ (input.amount) <= 0) throw new Error('Сумма должна быть больше нуля');
  if (!input.categoryId) throw new Error('Не выбрана категория');
  if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Не указана дата');
  return { name, type: input.type, amount: /** @type {number} */ (input.amount), currency: input.currency, categoryId: input.categoryId, date: input.date };
}

/**
 * @param {Partial<PlannedPayment>} input
 * @param {IDBDatabase} [db]
 * @returns {Promise<PlannedPayment>}
 */
export async function createPlanned(input, db) {
  const d = db ?? (await getDb());
  /** @type {PlannedPayment} */
  const p = { id: crypto.randomUUID(), ...normalizePlanned(input), done: false, operationId: null, createdAt: new Date().toISOString() };
  await put(d, 'planned', p);
  return p;
}

/**
 * @param {string} id
 * @param {Partial<PlannedPayment>} input
 * @param {IDBDatabase} [db]
 */
export async function updatePlanned(id, input, db) {
  const d = db ?? (await getDb());
  const p = await getPlanned(id, d);
  if (!p) throw new Error('Платёж не найден');
  /** @type {PlannedPayment} */
  const next = { ...p, ...normalizePlanned({ ...p, ...input }) };
  if (input.done != null) next.done = input.done;
  if (input.operationId !== undefined) next.operationId = input.operationId;
  await put(d, 'planned', next);
  return next;
}

/** @param {string} id @param {IDBDatabase} [db] */
export async function deletePlanned(id, db) {
  const d = db ?? (await getDb());
  await remove(d, 'planned', id);
}

/**
 * @param {string} id
 * @param {IDBDatabase} [db]
 * @returns {Promise<PlannedPayment | undefined>}
 */
export async function getPlanned(id, db) {
  const d = db ?? (await getDb());
  return getOne(d, 'planned', id);
}

/**
 * Разовые платежи в диапазоне дат (включительно). По умолчанию — только неоплаченные.
 * @param {{ from?: string, to?: string, includeDone?: boolean }} [f]
 * @param {IDBDatabase} [db]
 * @returns {Promise<PlannedPayment[]>}
 */
export async function listPlanned(f = {}, db) {
  const d = db ?? (await getDb());
  let query;
  if (f.from && f.to) query = IDBKeyRange.bound(f.from, f.to);
  else if (f.from) query = IDBKeyRange.lowerBound(f.from);
  else if (f.to) query = IDBKeyRange.upperBound(f.to);
  /** @type {PlannedPayment[]} */
  let rows = await getAll(d, 'planned', { index: 'date', query });
  if (!f.includeDone) rows = rows.filter((p) => !p.done);
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name, 'ru')));
}
