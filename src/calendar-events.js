// Календарь: все даты денег месяца — что оплатить и что получить. Чистые функции.

import { effectiveLine, lineOriginal, payDueDate } from './income.js';
import { shiftMonth } from './ui.js';

/**
 * @typedef {Object} CalEvent
 * @property {string | null} date — ГГГГ-ММ-ДД; null — «в течение месяца»
 * @property {string} name
 * @property {string} sub — пояснение: «повторяющийся», «зарплата за октябрь»…
 * @property {'expense' | 'income'} type
 * @property {number} amount — в минимальных единицах своей валюты
 * @property {'EUR' | 'KZT'} currency
 * @property {string} href
 * @property {string | null} pay — куда ведёт «Оплатила» / «Получила»; null — запишется сам
 * @property {'recurring' | 'planned' | 'source' | 'debt'} kind
 */

const MONTHS_GEN = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/**
 * События месяца.
 * @param {{
 *   month: string,
 *   upcoming: import('./repo/upcoming.js').Upcoming[],
 *   planned: import('./repo/planned.js').PlannedPayment[],
 *   sources: { category: import('./repo/categories.js').Category, lines: import('./repo/budgets.js').BudgetLine[], settled?: boolean }[],
 *   debts: { debt: import('./repo/debts.js').Debt, remaining: number }[],
 *   loanCategories?: string[],
 * }} p
 *   upcoming — платежи с точной датой (повторяющиеся и разовые);
 *   planned — неполученные разовые записи месяца (берутся только «в течение месяца»);
 *   sources — источники дохода с их строками бюджета (settled — зарплата за месяц уже получена, в список не попадает); debts — открытые долги с остатком;
 *   loanCategories — id категорий «Кредиты» (подпись «кредит»)
 * @returns {{ dated: CalEvent[], undated: CalEvent[] }}
 */
export function monthEvents(p) {
  const from = `${p.month}-01`;
  const to = `${p.month}-31`;
  /** @type {CalEvent[]} */
  const dated = [];
  /** @type {CalEvent[]} */
  const undated = [];

  for (const it of p.upcoming) {
    dated.push({
      date: it.date,
      name: it.name,
      sub: p.loanCategories?.includes(it.categoryId) ? 'кредит' : it.source === 'recurring' ? 'по графику' : 'один раз',
      type: it.type,
      amount: it.amount,
      currency: it.currency,
      href: it.source === 'recurring' ? `#/payments/${it.refId}` : `#/planned/${it.refId}`,
      pay: it.source === 'recurring' ? (it.confirm ? `#/operations/new?loan=${it.refId}` : null) : `#/operations/new?planned=${it.refId}`,
      kind: it.source,
    });
  }

  for (const pl of p.planned) {
    if (pl.done || pl.dateKind !== 'month' || pl.date.slice(0, 7) !== p.month) continue;
    undated.push({ date: null, name: pl.name, sub: 'один раз', type: pl.type, amount: pl.amount, currency: pl.currency, href: `#/planned/${pl.id}`, pay: `#/operations/new?planned=${pl.id}`, kind: 'planned' });
  }

  // Выплаты по источникам дохода: за этот месяц и за прошлый (если платят в следующем месяце)
  for (const { category: c, lines, settled } of p.sources) {
    if (settled) continue;
    for (const m of [shiftMonth(p.month, -1), p.month]) {
      const eff = effectiveLine(lines, m);
      const orig = eff ? lineOriginal(eff.line) : null;
      if (!orig || !orig.amount) continue;
      const name = c.employer ? `${c.name} · ${c.employer}` : c.name;
      const forMonth = `за ${MONTHS_GEN[Number(m.slice(5)) - 1]}`;
      if (!c.payDay) {
        if (m === p.month) undated.push({ date: null, name, sub: 'день выплаты не указан', type: 'income', amount: orig.amount, currency: orig.currency, href: `#/budget/${m}/${c.id}`, pay: `#/add?type=income&category=${c.id}&currency=${orig.currency}`, kind: 'source' });
        continue;
      }
      const due = payDueDate(m, c);
      if (due < from || due > to) continue;
      dated.push({ date: due, name, sub: forMonth, type: 'income', amount: orig.amount, currency: orig.currency, href: `#/budget/${m}/${c.id}`, pay: `#/add?type=income&category=${c.id}&currency=${orig.currency}&date=${due}`, kind: 'source' });
    }
  }

  for (const { debt, remaining } of p.debts) {
    if (remaining <= 0 || !debt.dueDate || debt.dueDate < from || debt.dueDate > to) continue;
    dated.push({ date: debt.dueDate, name: `Вернуть: ${debt.person}`, sub: 'долг', type: 'expense', amount: remaining, currency: debt.currency, href: `#/debts/${debt.id}`, pay: `#/debts/${debt.id}`, kind: 'debt' });
  }

  dated.sort((a, b) => (/** @type {string} */ (a.date) < /** @type {string} */ (b.date) ? -1 : a.date === b.date ? a.name.localeCompare(b.name, 'ru') : 1));
  return { dated, undated };
}
