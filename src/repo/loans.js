import { getDb, put } from '../db.js';
import { listPlanned, markReceived } from './planned.js';
import { listOperations } from './operations.js';
import { occurrences, isExhausted, remaining } from '../recurring.js';
import { listCategories, createCategory, setCategoryArchived } from './categories.js';
import { listSchedules } from './recurring.js';
import { isLoanCategory, LOAN_CATEGORY } from '../loans.js';

/**
 * Категория «Кредиты»: находит (и возвращает из архива) или создаёт.
 * @param {IDBDatabase} [db]
 * @returns {Promise<string>}
 */
export async function ensureLoanCategory(db) {
  const d = db ?? (await getDb());
  const found = (await listCategories({ kind: 'expense', includeArchived: true }, d)).find(isLoanCategory);
  if (found) {
    if (found.archived) await setCategoryArchived(found.id, false, d);
    return found.id;
  }
  return (await createCategory(LOAN_CATEGORY, 'expense', d)).id;
}

/**
 * Кредиты — повторяющиеся платежи с банком.
 * @param {IDBDatabase} [db]
 */
export async function listLoans(db) {
  return (await listSchedules(db)).filter((s) => s.bank);
}

/**
 * Ближайший неоплаченный платёж по кредиту: созданный «к оплате» (в т. ч. просроченный)
 * или следующий по графику — его можно оплатить заранее.
 * @param {import('../recurring.js').Schedule} s
 * @param {IDBDatabase} [db]
 * @returns {Promise<{ date: string, planned: import('./planned.js').PlannedPayment | null, n: number | null } | null>}
 */
export async function loanDue(s, db) {
  const d = db ?? (await getDb());
  const open = (await listPlanned({}, d)).filter((p) => p.recurringId === s.id && !p.done).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (open.length) return { date: open[0].date, planned: open[0], n: null };
  if (s.status === 'finished') return null;
  const [next] = occurrences(s, s.generatedCount, s.lastGeneratedDate, '9999-12-31', 1);
  return next ? { date: next.date, planned: null, n: next.n } : null;
}

/**
 * Отмечает платёж по кредиту оплаченным (операция уже создана).
 * Созданный «к оплате» закрывается; платёж заранее — засчитывается в графике,
 * чтобы в срок он не появился снова.
 * @param {import('../recurring.js').Schedule} s
 * @param {{ date: string, planned: import('./planned.js').PlannedPayment | null, n: number | null }} due
 * @param {{ operationId: string, date: string, amount: number }} paid
 * @param {IDBDatabase} [db]
 */
export async function settleLoanPayment(s, due, paid, db) {
  const d = db ?? (await getDb());
  if (due.planned) {
    await markReceived(due.planned.id, paid, d);
    return;
  }
  if (due.n == null) return;
  const next = { ...s, generatedCount: due.n + 1, lastGeneratedDate: due.date, updatedAt: new Date().toISOString() };
  if (isExhausted(next)) next.status = 'finished';
  await put(d, 'recurring', next);
}

/**
 * Оплаты по кредиту (операции, связанные с ним), новые сверху.
 * @param {string} id
 * @param {IDBDatabase} [db]
 */
export async function loanPayments(id, db) {
  return (await listOperations({ type: 'expense' }, db)).filter((o) => o.recurringId === id).sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * Сколько платежей и какая сумма ещё впереди, включая созданные, но не оплаченные
 * («к оплате», в том числе просроченные). Для кредита без срока — null.
 * @param {import('../recurring.js').Schedule} s
 * @param {IDBDatabase} [db]
 * @returns {Promise<{ count: number, amount: number } | null>}
 */
export async function loanLeft(s, db) {
  const ahead = remaining(s);
  if (!ahead) return null;
  const unpaid = (await listPlanned({}, db)).filter((p) => p.recurringId === s.id && !p.done);
  return { count: ahead.count + unpaid.length, amount: ahead.amount + unpaid.reduce((sum, p) => sum + p.amount, 0) };
}
