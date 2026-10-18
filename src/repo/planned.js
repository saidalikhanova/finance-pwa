import { getDb, getAll, getOne, put, remove } from '../db.js';
import { shiftMonth } from '../ui.js';

/**
 * Разовый запланированный платёж или ожидаемое поступление.
 * Операция создаётся по кнопке «Оплачено» / «Получено» (тогда done = true,
 * operationId, receivedDate и receivedAmount заполнены).
 * @typedef {Object} PlannedPayment
 * @property {string} id
 * @property {string} name
 * @property {'expense' | 'income'} type
 * @property {number} amount — ожидаемая сумма в минимальных единицах
 * @property {import('../money.js').Currency} currency
 * @property {string} categoryId
 * @property {string} date — ГГГГ-ММ-ДД; для dateKind = 'month' — первое число месяца
 * @property {'day' | 'month'} dateKind — точная дата или «в течение месяца»
 * @property {string | null} movedFrom — ГГГГ-ММ, откуда перенесено впервые
 * @property {string | null} recurringId — создано повторяющимся платежом «с подтверждением»
 * @property {boolean} done
 * @property {string | null} operationId
 * @property {string | null} receivedDate
 * @property {number | null} receivedAmount — в валюте операции
 * @property {string} createdAt
 */

/** @param {Partial<PlannedPayment>} input */
export function normalizePlanned(input) {
  const name = (input.name ?? '').trim();
  if (!name) throw new Error('Укажите название');
  if (input.type !== 'expense' && input.type !== 'income') throw new Error('Не указан тип');
  if (input.currency !== 'EUR' && input.currency !== 'KZT') throw new Error('Не указана валюта');
  if (!Number.isSafeInteger(input.amount) || /** @type {number} */ (input.amount) <= 0) throw new Error('Сумма должна быть больше нуля');
  if (!input.categoryId) throw new Error('Не выбрана категория');
  const dateKind = input.dateKind === 'month' ? 'month' : 'day';
  let date = input.date ?? '';
  if (dateKind === 'month' && /^\d{4}-\d{2}$/.test(date)) date = `${date}-01`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(dateKind === 'month' ? 'Не указан месяц' : 'Не указана дата');
  if (dateKind === 'month') date = `${date.slice(0, 7)}-01`;
  return { name, type: input.type, amount: /** @type {number} */ (input.amount), currency: input.currency, categoryId: input.categoryId, date, dateKind };
}

/**
 * @param {Partial<PlannedPayment>} input
 * @param {IDBDatabase} [db]
 * @returns {Promise<PlannedPayment>}
 */
export async function createPlanned(input, db) {
  const d = db ?? (await getDb());
  /** @type {PlannedPayment} */
  const p = {
    id: crypto.randomUUID(),
    ...normalizePlanned(input),
    movedFrom: null,
    recurringId: input.recurringId ?? null,
    done: false,
    operationId: null,
    receivedDate: null,
    receivedAmount: null,
    createdAt: new Date().toISOString(),
  };
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
  if (!p) throw new Error('Запись не найдена');
  /** @type {PlannedPayment} */
  const next = { ...p, ...normalizePlanned({ ...p, ...input }) };
  for (const k of /** @type {const} */ (['done', 'operationId', 'receivedDate', 'receivedAmount', 'movedFrom'])) {
    if (input[k] !== undefined) /** @type {any} */ (next)[k] = input[k];
  }
  await put(d, 'planned', next);
  return next;
}

/**
 * Отмечает поступление (или оплату): связывает с созданной операцией.
 * @param {string} id
 * @param {{ operationId: string, date: string, amount: number }} r
 * @param {IDBDatabase} [db]
 */
export async function markReceived(id, r, db) {
  return updatePlanned(id, { done: true, operationId: r.operationId, receivedDate: r.date, receivedAmount: r.amount }, db);
}

/**
 * Переносит неполученное на следующий месяц: дата становится «в течение месяца»,
 * запоминается исходный месяц.
 * @param {string} id
 * @param {IDBDatabase} [db]
 */
export async function moveToNextMonth(id, db) {
  const d = db ?? (await getDb());
  const p = await getPlanned(id, d);
  if (!p) throw new Error('Запись не найдена');
  if (p.done) throw new Error('Уже получено');
  const from = p.date.slice(0, 7);
  return updatePlanned(id, { date: `${shiftMonth(from, 1)}-01`, dateKind: 'month', movedFrom: p.movedFrom ?? from }, d);
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
  const p = await getOne(d, 'planned', id);
  return p ? withDefaults(p) : undefined;
}

/**
 * Записи в диапазоне дат (включительно). По умолчанию — только неоплаченные.
 * @param {{ from?: string, to?: string, includeDone?: boolean, type?: 'expense' | 'income' }} [f]
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
  let rows = (await getAll(d, 'planned', { index: 'date', query })).map(withDefaults);
  if (!f.includeDone) rows = rows.filter((p) => !p.done);
  if (f.type) rows = rows.filter((p) => p.type === f.type);
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name, 'ru')));
}

/** @param {any} p @returns {PlannedPayment} */
function withDefaults(p) {
  return { dateKind: 'day', movedFrom: null, recurringId: null, receivedDate: null, receivedAmount: null, ...p };
}
