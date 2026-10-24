// Кредиты: ежемесячные платежи банку — повторяющиеся платежи с банком
// из справочника, в категории «Кредиты». Чистые функции.

import { occurrences } from './recurring.js';

export const LOAN_CATEGORY = 'Кредиты';

/** @param {{ name: string, kind: string }} c */
export function isLoanCategory(c) {
  return c.kind === 'expense' && c.name.trim().toLowerCase() === LOAN_CATEGORY.toLowerCase();
}

/**
 * Название платежа: «Кредит Kaspi» или «Kaspi · ипотека».
 * @param {string} bank
 * @param {string} [purpose]
 */
export function loanName(bank, purpose) {
  const p = (purpose ?? '').trim();
  return p ? `${bank} · ${p}` : `Кредит ${bank}`;
}

/**
 * Назначение кредита из названия (обратное к loanName).
 * @param {{ name: string, bank?: string | null }} s
 */
export function loanPurpose(s) {
  if (!s.bank) return '';
  const prefix = `${s.bank} · `;
  return s.name.startsWith(prefix) ? s.name.slice(prefix.length) : '';
}

/**
 * Платежи расписаний категории в месяце — для плана бюджета («по графику»).
 * Приостановленные не учитываются.
 * @param {import('./recurring.js').Schedule[]} schedules
 * @param {string} categoryId
 * @param {string} month — ГГГГ-ММ
 * @returns {{ s: import('./recurring.js').Schedule, date: string }[]}
 */
export function scheduledInMonth(schedules, categoryId, month) {
  const out = [];
  for (const s of schedules) {
    if (s.type !== 'expense' || s.categoryId !== categoryId || s.status === 'paused') continue;
    for (const o of occurrences(s, 0, `${month}-00`, `${month}-31`)) out.push({ s, date: o.date });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}
