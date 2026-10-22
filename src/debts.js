// Мои долги: сколько заняла, сколько вернула, остаток и статус. Чистые функции.

import { convert } from './income.js';
import { diffDays } from './dates.js';

/**
 * @typedef {Object} Borrow
 * @property {string} id
 * @property {string} date — ГГГГ-ММ-ДД
 * @property {number} amount — в валюте долга, минимальные единицы
 *
 * @typedef {Object} Debt
 * @property {string} id
 * @property {string} person — кому должна
 * @property {'EUR' | 'KZT'} currency
 * @property {Borrow[]} borrows — сколько и когда занимала (можно несколько раз)
 * @property {string | null} dueDate — к какому сроку вернуть
 * @property {string} comment
 * @property {string} createdAt
 */

/**
 * Возвраты по долгу — операции-расходы с debtId.
 * @param {Debt} debt
 * @param {import('./repo/operations.js').Operation[]} repayments
 * @param {string} today
 * @param {number | null} rateNow
 * @returns {{ borrowed: number, repaid: number, remaining: number, status: 'open' | 'overdue' | 'closed', daysLate: number }}
 */
export function debtStatus(debt, repayments, today, rateNow) {
  const borrowed = debt.borrows.reduce((s, b) => s + b.amount, 0);
  const repaid = repayments
    .filter((o) => o.debtId === debt.id)
    .reduce((s, o) => s + (o.currency === debt.currency ? o.amount : convert(o.amount, o.currency, debt.currency, o.rate ?? rateNow) ?? 0), 0);
  const remaining = borrowed - repaid;
  if (remaining <= 0) return { borrowed, repaid, remaining, status: 'closed', daysLate: 0 };
  if (debt.dueDate && debt.dueDate < today) return { borrowed, repaid, remaining, status: 'overdue', daysLate: diffDays(debt.dueDate, today) };
  return { borrowed, repaid, remaining, status: 'open', daysLate: 0 };
}

/**
 * Итог по всем открытым долгам в разрезе валют.
 * @param {{ debt: Debt, st: ReturnType<typeof debtStatus> }[]} rows
 * @returns {Map<'EUR' | 'KZT', number>}
 */
export function totalsByCurrency(rows) {
  /** @type {Map<'EUR' | 'KZT', number>} */
  const out = new Map();
  for (const { debt, st } of rows) {
    if (st.remaining > 0) out.set(debt.currency, (out.get(debt.currency) ?? 0) + st.remaining);
  }
  return out;
}
