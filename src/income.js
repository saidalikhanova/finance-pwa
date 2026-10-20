// Доходы по источнику: действующий план месяца и долг (план минус получено).
// Чистые функции. Суммы — целые в минимальных единицах.

import { toEurCents, fromEurCents } from './money.js';
import { shiftMonth } from './ui.js';

/** @typedef {import('./repo/budgets.js').BudgetLine} BudgetLine */
/** @typedef {import('./repo/operations.js').Operation} Operation */
/** @typedef {'EUR' | 'KZT'} Currency */

/**
 * План строки в исходной валюте.
 * @param {BudgetLine} l
 * @returns {{ amount: number, currency: Currency } | null}
 */
export function lineOriginal(l) {
  if (l.planned == null) return null;
  const currency = l.plannedCurrency === 'KZT' ? 'KZT' : 'EUR';
  const amount = l.plannedOriginal ?? (currency === 'EUR' ? l.planned : null);
  return amount == null ? null : { amount, currency };
}

/**
 * Действующий план категории на месяц: строка этого месяца, иначе ближайшая
 * более ранняя строка с «каждый месяц».
 * @param {BudgetLine[]} lines — строки одной категории (любой порядок)
 * @param {string} month — ГГГГ-ММ
 * @returns {{ line: BudgetLine, inherited: boolean } | null}
 */
export function effectiveLine(lines, month) {
  const exact = lines.find((l) => l.month === month);
  if (exact) return { line: exact, inherited: false };
  const prev = lines.filter((l) => l.month < month).sort((a, b) => (a.month < b.month ? 1 : -1))[0];
  if (prev && prev.repeat && prev.planned) return { line: prev, inherited: true };
  return null;
}

/**
 * Перевод суммы между валютами по курсу (₸ за 1 € × RATE_SCALE).
 * @param {number} amount
 * @param {Currency} from
 * @param {Currency} to
 * @param {number | null} rate
 * @returns {number | null}
 */
export function convert(amount, from, to, rate) {
  if (from === to) return amount;
  if (!rate) return null;
  if (from === 'KZT') return toEurCents(amount, 'KZT', rate);
  return fromEurCents(amount, rate);
}

/**
 * Полученное по операции в валюте плана: своя сумма, если валюта та же,
 * иначе пересчёт по курсу операции (или текущему).
 * @param {Operation} op
 * @param {Currency} currency
 * @param {number | null} rateNow
 */
function receivedIn(op, currency, rateNow) {
  if (op.currency === currency) return op.amount;
  return convert(op.amount, op.currency, currency, op.rate ?? rateNow) ?? 0;
}

/**
 * @typedef {Object} DebtMonth
 * @property {string} month
 * @property {number} plan — в валюте долга
 * @property {number} received — в валюте долга
 * @property {boolean} inherited — план взят из предыдущего месяца («каждый месяц»)
 */

/**
 * Долг по источнику дохода на месяц `upTo` включительно: сумма планов
 * минус всё полученное с первого месяца с планом. Валюта — последнего плана.
 * @param {{ lines: BudgetLine[], ops: Operation[], upTo: string, rateNow: number | null }} p
 *   lines — строки бюджета категории, ops — доходы категории
 * @returns {{ currency: Currency, months: DebtMonth[], plan: number, received: number, debt: number } | null}
 */
export function incomeDebt(p) {
  const withPlan = p.lines.filter((l) => l.planned != null && l.month <= p.upTo).sort((a, b) => (a.month < b.month ? -1 : 1));
  if (!withPlan.length) return null;
  const latest = effectiveLine(p.lines, p.upTo)?.line ?? withPlan[withPlan.length - 1];
  const currency = lineOriginal(latest)?.currency ?? 'EUR';

  /** @type {DebtMonth[]} */
  const months = [];
  let plan = 0;
  let received = 0;
  for (let m = withPlan[0].month; m <= p.upTo; m = shiftMonth(m, 1)) {
    const eff = effectiveLine(p.lines, m);
    const orig = eff ? lineOriginal(eff.line) : null;
    const planM = orig ? convert(orig.amount, orig.currency, currency, p.rateNow) ?? 0 : 0;
    const recM = p.ops.filter((o) => o.type === 'income' && o.date.slice(0, 7) === m).reduce((s, o) => s + receivedIn(o, currency, p.rateNow), 0);
    if (planM || recM) months.push({ month: m, plan: planM, received: recM, inherited: Boolean(eff?.inherited) });
    plan += planM;
    received += recM;
  }
  return { currency, months, plan, received, debt: plan - received };
}

/**
 * План категории на месяц в центах евро (для итогов бюджета).
 * @param {BudgetLine[]} lines
 * @param {string} month
 * @param {number | null} rateNow
 */
export function effectivePlanEur(lines, month, rateNow) {
  const eff = effectiveLine(lines, month);
  if (!eff) return null;
  const orig = lineOriginal(eff.line);
  if (!orig) return eff.line.planned;
  return orig.currency === 'EUR' ? orig.amount : toEurCents(orig.amount, 'KZT', rateNow) ?? eff.line.planned;
}
