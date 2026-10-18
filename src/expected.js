// Ожидаемые поступления: статус и сводка плана по доходам. Чистые функции.

import { daysInMonth, diffDays } from './dates.js';

/** @typedef {import('./repo/planned.js').PlannedPayment} PlannedPayment */

/**
 * Крайний срок: точная дата или последний день месяца.
 * @param {Pick<PlannedPayment, 'date' | 'dateKind'>} p
 */
export function dueDate(p) {
  if (p.dateKind !== 'month') return p.date;
  const [y, m] = p.date.split('-').map(Number);
  return `${p.date.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
}

/**
 * Статус ожидаемого поступления на дату `today`.
 * @param {Pick<PlannedPayment, 'date' | 'dateKind' | 'done'>} p
 * @param {string} today
 * @returns {{ status: 'received' | 'overdue' | 'expected', daysLate: number }}
 */
export function expectedStatus(p, today) {
  if (p.done) return { status: 'received', daysLate: 0 };
  const due = dueDate(p);
  if (due < today) return { status: 'overdue', daysLate: diffDays(due, today) };
  return { status: 'expected', daysLate: 0 };
}

/**
 * Сводка по ожидаемым доходам месяца в разрезе категорий (в центах евро).
 * planned — все ожидаемые за месяц (и полученные, и нет): это план;
 * pending — ещё не полученные; unknown — суммы в тенге без курса.
 * @param {PlannedPayment[]} items — записи типа income
 * @param {string} month — ГГГГ-ММ
 * @param {(p: PlannedPayment) => number | null} toEur
 * @returns {{ byCategory: Map<string, { planned: number, pending: number }>, planned: number, pending: number, unknown: number }}
 */
export function incomeExpectations(items, month, toEur) {
  /** @type {Map<string, { planned: number, pending: number }>} */
  const byCategory = new Map();
  let planned = 0;
  let pending = 0;
  let unknown = 0;
  for (const p of items) {
    if (p.type !== 'income' || p.date.slice(0, 7) !== month) continue;
    const eur = toEur(p);
    if (eur == null) {
      unknown++;
      continue;
    }
    const c = byCategory.get(p.categoryId) ?? { planned: 0, pending: 0 };
    c.planned += eur;
    planned += eur;
    if (!p.done) {
      c.pending += eur;
      pending += eur;
    }
    byCategory.set(p.categoryId, c);
  }
  return { byCategory, planned, pending, unknown };
}

/**
 * Подпись срока: «18 нояб.», «в ноябре».
 * @param {Pick<PlannedPayment, 'date' | 'dateKind'>} p
 * @param {(iso: string) => string} formatDate
 */
export function whenLabel(p, formatDate) {
  if (p.dateKind !== 'month') return formatDate(p.date);
  const [y, m] = p.date.split('-').map(Number);
  const name = new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long' });
  // «ноябрь» → «в ноябре»
  const prep = name.replace(/ь$/, 'е').replace(/й$/, 'е').replace(/т$/, 'те');
  return `в ${prep}${y !== new Date().getFullYear() ? ` ${y}` : ''}`;
}
