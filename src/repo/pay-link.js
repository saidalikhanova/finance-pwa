// Связь обычной операции с платежом, который ждёт отметки («Оплатила» / «Получила»).
// Нужна, чтобы расход, записанный вручную (например, аренда), не оставлял тот же платёж
// в календаре неоплаченным и не требовал второй записи.

import { getDb, getAll } from '../db.js';
import { listPlanned, markReceived } from './planned.js';
import { listSchedules } from './recurring.js';
import { loanDue, settleLoanPayment } from './loans.js';
import { listOperations, updateOperation } from './operations.js';

/**
 * Платёж, ожидающий отметки: разовый или по расписанию.
 * @typedef {Object} PayCandidate
 * @property {string} name
 * @property {number} amount
 * @property {import('../money.js').Currency} currency
 * @property {string} date — срок платежа
 * @property {import('./planned.js').PlannedPayment} [planned]
 * @property {import('../recurring.js').Schedule} [schedule]
 * @property {{ date: string, planned: import('./planned.js').PlannedPayment | null, n: number | null }} [due]
 */

/**
 * Ожидающие платежи той же категории и того же типа в месяце операции.
 * @param {{ type: 'expense' | 'income', categoryId: string, date: string }} op
 * @param {IDBDatabase} [db]
 * @returns {Promise<PayCandidate[]>}
 */
export async function pendingFor(op, db) {
  const d = db ?? (await getDb());
  const month = op.date.slice(0, 7);
  /** @type {PayCandidate[]} */
  const out = [];
  const seen = new Set();
  for (const p of await listPlanned({}, d)) {
    if (p.type !== op.type || p.categoryId !== op.categoryId || p.date.slice(0, 7) !== month) continue;
    out.push({ name: p.name, amount: p.amount, currency: p.currency, date: p.date, planned: p });
    seen.add(p.id);
  }
  for (const s of await listSchedules(d)) {
    if (s.status !== 'active' || !s.confirm || s.type !== op.type || s.categoryId !== op.categoryId) continue;
    const due = await loanDue(s, d);
    if (!due || due.date.slice(0, 7) !== month) continue;
    if (due.planned && seen.has(due.planned.id)) continue;
    out.push({ name: s.name, amount: s.amount, currency: s.currency, date: due.date, schedule: s, due });
  }
  return out;
}

/**
 * Единственный подходящий платёж: один в категории, а если их несколько — один с той же суммой.
 * Иначе null: лучше не связывать, чем закрыть чужой платёж.
 * @param {{ amount: number, currency: string }} op
 * @param {PayCandidate[]} list
 * @returns {PayCandidate | null}
 */
export function pickOne(op, list) {
  if (list.length === 1) return list[0];
  const same = list.filter((c) => c.amount === op.amount && c.currency === op.currency);
  return same.length === 1 ? same[0] : null;
}

/**
 * Отмечает платёж оплаченным уже существующей операцией.
 * @param {import('./operations.js').Operation} op
 * @param {PayCandidate} c
 * @param {IDBDatabase} [db]
 */
export async function linkOperation(op, c, db) {
  const d = db ?? (await getDb());
  const paid = { operationId: op.id, date: op.date, amount: op.amount };
  if (c.planned) {
    await markReceived(c.planned.id, paid, d);
    if (c.planned.recurringId) await updateOperation(op.id, { recurringId: c.planned.recurringId, scheduledDate: c.planned.date }, d);
    return;
  }
  if (c.schedule && c.due) {
    await settleLoanPayment(c.schedule, c.due, paid, d);
    await updateOperation(op.id, { recurringId: c.schedule.id, scheduledDate: c.due.date }, d);
  }
}

/**
 * После записи расхода или дохода вручную: закрывает подходящий ожидающий платёж.
 * @param {import('./operations.js').Operation} op
 * @param {IDBDatabase} [db]
 * @returns {Promise<string | null>} название закрытого платежа
 */
export async function autoLinkPayment(op, db) {
  if (op.recurringId || op.debtId) return null;
  const c = pickOne(op, await pendingFor(op, db));
  if (!c) return null;
  await linkOperation(op, c, db);
  return c.name;
}

/**
 * Уже записанные операции, которые подходят к платежу, но ни к чему не привязаны:
 * категория и тип те же, дата — не раньше чем за месяц до срока и не позже сегодня.
 * @param {PayCandidate & { type: 'expense' | 'income', categoryId: string }} c
 * @param {string} from — ГГГГ-ММ-ДД
 * @param {string} to — ГГГГ-ММ-ДД
 * @param {IDBDatabase} [db]
 * @returns {Promise<import('./operations.js').Operation[]>}
 */
export async function unlinkedOperationsFor(c, from, to, db) {
  const d = db ?? (await getDb());
  const taken = new Set((await getAll(d, 'planned')).map((p) => p.operationId).filter(Boolean));
  return (await listOperations({ from, to, type: c.type, categoryId: c.categoryId }, d))
    .filter((o) => !o.recurringId && !o.debtId && !taken.has(o.id));
}
