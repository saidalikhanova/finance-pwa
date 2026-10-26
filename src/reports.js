// Расчёты для отчётов. Чистые функции над списком операций; суммы — в центах евро.
// Операции без курса (amountEur == null) в суммы не входят, но считаются отдельно.

import { divRound } from './money.js';
import { categoryAmountsEur } from './items.js';
import { shiftMonth } from './ui.js';

/** @typedef {import('./repo/operations.js').Operation} Operation */

/**
 * Итоги: доходы, расходы, баланс и число операций без курса.
 * @param {Operation[]} ops
 */
export function summary(ops) {
  let income = 0;
  let expense = 0;
  let unknownRate = 0;
  for (const o of ops) {
    if (o.amountEur == null) unknownRate++;
    else if (o.type === 'income') income += o.amountEur;
    else expense += o.amountEur;
  }
  return { income, expense, balance: income - expense, unknownRate };
}

/**
 * Расходы по категориям, по убыванию суммы, с долей в процентах.
 * Статьи считаются в своей категории; их разбивка — в articles.
 * @param {Operation[]} ops
 * @param {Map<string, { name: string, parentId?: string | null }>} categoriesById
 * @returns {{ categoryId: string, name: string, amount: number, share: number, articles: { categoryId: string, name: string, amount: number }[] }[]}
 */
export function expensesByCategory(ops, categoriesById) {
  /** @type {Map<string, number>} */
  const totals = new Map();
  /** @type {Map<string, Map<string, number>>} */
  const byArticle = new Map();
  for (const o of ops) {
    if (o.type !== 'expense') continue;
    for (const [categoryId, eur] of categoryAmountsEur(o)) {
      const parentId = categoriesById.get(categoryId)?.parentId;
      const top = parentId && categoriesById.has(parentId) ? parentId : categoryId;
      totals.set(top, (totals.get(top) ?? 0) + eur);
      if (top !== categoryId) {
        const m = byArticle.get(top) ?? new Map();
        m.set(categoryId, (m.get(categoryId) ?? 0) + eur);
        byArticle.set(top, m);
      }
    }
  }
  const total = [...totals.values()].reduce((a, b) => a + b, 0);
  return [...totals.entries()]
    .map(([categoryId, amount]) => ({
      categoryId,
      name: categoriesById.get(categoryId)?.name ?? 'Без категории',
      amount,
      share: total ? divRound(amount * 100, total) : 0,
      articles: [...(byArticle.get(categoryId) ?? new Map())]
        .map(([id, a]) => ({ categoryId: id, name: categoriesById.get(id)?.name ?? '', amount: a }))
        .sort((x, y) => y.amount - x.amount),
    }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'ru'));
}

/**
 * Список из n месяцев, заканчивающийся endMonth: lastMonths(3, '2026-10') → ['2026-08','2026-09','2026-10'].
 * @param {number} n
 * @param {string} endMonth
 */
export function lastMonths(n, endMonth) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(shiftMonth(endMonth, -i));
  return out;
}

/**
 * Доходы и расходы по месяцам из списка. Месяцы без операций дают нули.
 * @param {Operation[]} ops
 * @param {string[]} months — ГГГГ-ММ
 * @returns {{ month: string, income: number, expense: number, balance: number }[]}
 */
export function monthlySeries(ops, months) {
  /** @type {Map<string, { income: number, expense: number }>} */
  const acc = new Map(months.map((m) => [m, { income: 0, expense: 0 }]));
  for (const o of ops) {
    const bucket = acc.get(o.date.slice(0, 7));
    if (!bucket || o.amountEur == null) continue;
    if (o.type === 'income') bucket.income += o.amountEur;
    else bucket.expense += o.amountEur;
  }
  return months.map((month) => {
    const b = /** @type {{ income: number, expense: number }} */ (acc.get(month));
    return { month, income: b.income, expense: b.expense, balance: b.income - b.expense };
  });
}
