// План категорий расходов на месяц — один расчёт для бюджета, экрана категории,
// Главной и предупреждений после траты. План категории служит и её лимитом:
// полоса и предупреждения (80 % и превышение) считаются от плана.
// Все суммы — в центах евро.

import { getBudget } from './repo/budgets.js';
import { listPlanned } from './repo/planned.js';
import { listSchedules } from './repo/recurring.js';
import { suggestRate } from './repo/rates.js';
import { monthRange, todayISO } from './repo/operations.js';
import { scheduledInMonth, isLoanCategory } from './loans.js';
import { childrenOf } from './category-tree.js';
import { toEurCents } from './money.js';

/**
 * @typedef {Object} MonthPlans
 * @property {(c: import('./repo/categories.js').Category) => number | null} own — свой план категории или статьи (без статей внутри):
 *   введённый вручную, иначе платежи по графику и разовые; null — плана нет
 * @property {(c: import('./repo/categories.js').Category) => number | null} total — план категории вместе со статьями
 * @property {(c: import('./repo/categories.js').Category) => number | null} limit — лимит: у статьи — её план, у категории — план со статьями;
 *   у кредитов лимита нет
 * @property {(id: string) => number} scheduledEur — платежи по графику в месяце
 * @property {(id: string) => import('./repo/categories.js').Category[]} articlesOf — статьи, которые стоит показать в месяце
 * @property {Map<string, import('./repo/budgets.js').BudgetLine>} lines
 * @property {number | null} rate
 */

/**
 * @param {string} month — ГГГГ-ММ
 * @param {import('./repo/categories.js').Category[]} categories — все категории, включая архив
 * @param {{ fact?: Map<string, number>, db?: IDBDatabase }} [opts] — fact: расходы по категориям (чтобы показать архивные статьи с тратами)
 * @returns {Promise<MonthPlans>}
 */
export async function monthPlans(month, categories, opts = {}) {
  const db = opts.db;
  const [lines, schedules, planned, rateRec] = await Promise.all([
    getBudget(month, db),
    listSchedules(db),
    listPlanned({ ...monthRange(month), includeDone: true, type: 'expense' }, db),
    suggestRate(todayISO(), db),
  ]);
  const rate = rateRec?.rate ?? null;
  const byCat = new Map(lines.map((l) => [l.categoryId, l]));
  const oneOff = planned.filter((p) => !p.recurringId);
  const fact = opts.fact ?? new Map();
  /** @param {string} id */
  const scheduledEur = (id) => scheduledInMonth(schedules, id, month).reduce((sum, { s }) => sum + (toEurCents(s.amount, s.currency, rate) ?? 0), 0);
  /** @param {string} id */
  const oneOffEur = (id) => oneOff.filter((p) => p.categoryId === id).reduce((sum, p) => sum + (toEurCents(p.amount, p.currency, rate) ?? 0), 0);
  /** @type {MonthPlans['own']} */
  const own = (c) => {
    if (isLoanCategory(c)) return scheduledEur(c.id) || null;
    const line = byCat.get(c.id);
    if (line?.hidden) return null;
    if (line?.planned != null) return line.planned;
    return scheduledEur(c.id) + oneOffEur(c.id) || null;
  };
  /** @type {MonthPlans['articlesOf']} */
  const articlesOf = (id) => childrenOf(categories, id, { includeArchived: true }).filter((k) => !k.archived || byCat.get(k.id) || fact.get(k.id));
  /** @type {MonthPlans['total']} */
  const total = (c) => {
    const parts = [own(c), ...(c.parentId ? [] : articlesOf(c.id).map(own))].filter((v) => v != null);
    return parts.length ? parts.reduce((a, b) => /** @type {number} */ (a) + /** @type {number} */ (b), 0) : null;
  };
  /** @type {MonthPlans['limit']} */
  const limit = (c) => (c.kind !== 'expense' || isLoanCategory(c) ? null : total(c));
  return { own, total, limit, scheduledEur, articlesOf, lines: byCat, rate };
}
