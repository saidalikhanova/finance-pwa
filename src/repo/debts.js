import { getDb, getAll, getOne, put, promisify, done, writeTx, txPut, txDelete } from '../db.js';
import { createOperation, listOperations } from './operations.js';
import { listCategories, createCategory } from './categories.js';

/** @typedef {import('../debts.js').Debt} Debt */

export const REPAY_CATEGORY = 'Возврат долгов';

/** @param {string} date */
function checkDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Не указана дата');
}

/**
 * Новый долг: кому, сколько, когда занимала.
 * @param {{ person: string, amount: number, currency: 'EUR' | 'KZT', date: string, dueDate?: string | null, comment?: string }} input
 * @param {IDBDatabase} [db]
 * @returns {Promise<Debt>}
 */
export async function createDebt(input, db) {
  const d = db ?? (await getDb());
  const person = (input.person ?? '').trim();
  if (!person) throw new Error('Укажите, у кого заняли');
  if (input.currency !== 'EUR' && input.currency !== 'KZT') throw new Error('Не указана валюта');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('Сумма должна быть больше нуля');
  checkDate(input.date);
  if (input.dueDate) checkDate(input.dueDate);
  /** @type {Debt} */
  const debt = {
    id: crypto.randomUUID(),
    person,
    currency: input.currency,
    borrows: [{ id: crypto.randomUUID(), date: input.date, amount: input.amount }],
    dueDate: input.dueDate || null,
    comment: (input.comment ?? '').trim(),
    createdAt: new Date().toISOString(),
  };
  await put(d, 'debts', debt);
  return debt;
}

/**
 * Заняла ещё у того же человека.
 * @param {string} id
 * @param {{ amount: number, date: string }} b
 * @param {IDBDatabase} [db]
 */
export async function addBorrow(id, b, db) {
  const d = db ?? (await getDb());
  const debt = await getDebt(id, d);
  if (!debt) throw new Error('Долг не найден');
  if (!Number.isSafeInteger(b.amount) || b.amount <= 0) throw new Error('Сумма должна быть больше нуля');
  checkDate(b.date);
  const next = { ...debt, borrows: [...debt.borrows, { id: crypto.randomUUID(), date: b.date, amount: b.amount }] };
  await put(d, 'debts', next);
  return next;
}

/**
 * Правка: кому, срок, комментарий.
 * @param {string} id
 * @param {{ person?: string, dueDate?: string | null, comment?: string }} input
 * @param {IDBDatabase} [db]
 */
export async function updateDebt(id, input, db) {
  const d = db ?? (await getDb());
  const debt = await getDebt(id, d);
  if (!debt) throw new Error('Долг не найден');
  const person = (input.person ?? debt.person).trim();
  if (!person) throw new Error('Укажите, у кого заняли');
  if (input.dueDate) checkDate(input.dueDate);
  const next = { ...debt, person, dueDate: input.dueDate === undefined ? debt.dueDate : input.dueDate || null, comment: (input.comment ?? debt.comment).trim() };
  await put(d, 'debts', next);
  return next;
}

/**
 * Возврат долга: записывается расходом в категорию «Возврат долгов».
 * @param {string} id
 * @param {{ amount: number, currency: 'EUR' | 'KZT', date: string, rate?: number | null }} r
 * @param {IDBDatabase} [db]
 */
export async function repay(id, r, db) {
  const d = db ?? (await getDb());
  const debt = await getDebt(id, d);
  if (!debt) throw new Error('Долг не найден');
  const categoryId = await ensureRepayCategory(d);
  return createOperation(
    { type: 'expense', amount: r.amount, currency: r.currency, date: r.date, categoryId, comment: `Возврат долга: ${debt.person}`, rate: r.rate ?? null, rateSource: r.rate ? 'manual' : null, debtId: debt.id },
    d,
  );
}

/**
 * Категория расходов «Возврат долгов» — создаётся при первом возврате.
 * @param {IDBDatabase} d
 */
export async function ensureRepayCategory(d) {
  const all = await listCategories({ kind: 'expense', includeArchived: true }, d);
  const found = all.find((c) => c.name.toLowerCase() === REPAY_CATEGORY.toLowerCase());
  if (found) return found.id;
  return (await createCategory(REPAY_CATEGORY, 'expense', d)).id;
}

/**
 * Возвраты по всем долгам (операции с debtId).
 * @param {IDBDatabase} [db]
 */
export async function listRepayments(db) {
  const d = db ?? (await getDb());
  return (await listOperations({ type: 'expense' }, d)).filter((o) => o.debtId);
}

/**
 * Удаляет долг. Записанные возвраты остаются расходами, но отвязываются.
 * @param {string} id
 * @param {IDBDatabase} [db]
 */
export async function deleteDebt(id, db) {
  const d = db ?? (await getDb());
  const tx = writeTx(d, ['debts', 'operations']);
  txDelete(tx, 'debts', id);
  const ops = tx.objectStore('operations');
  /** @type {any[]} */
  const all = await promisify(ops.getAll());
  for (const o of all) if (o.debtId === id) txPut(tx, 'operations', { ...o, debtId: null });
  await done(tx);
}

/**
 * @param {string} id
 * @param {IDBDatabase} [db]
 * @returns {Promise<Debt | undefined>}
 */
export async function getDebt(id, db) {
  const d = db ?? (await getDb());
  return getOne(d, 'debts', id);
}

/**
 * @param {IDBDatabase} [db]
 * @returns {Promise<Debt[]>}
 */
export async function listDebts(db) {
  const d = db ?? (await getDb());
  /** @type {Debt[]} */
  const all = await getAll(d, 'debts');
  return all.sort((a, b) => a.person.localeCompare(b.person, 'ru'));
}
