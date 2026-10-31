// Расчёт состояния лимита категории. Чистые функции без обращения к базе.
// Все суммы — в центах евро.

import { formatMoney, divRound } from './money.js';

/** Порог предупреждения, % от лимита (лимит категории — её план на месяц). */
export const WARN_PERCENT = 80;

/**
 * Число дней месяца.
 * @param {string} month — ГГГГ-ММ
 */
export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/**
 * Сколько дней осталось в месяце, включая сегодняшний.
 * Прошедший месяц — 0, будущий — все дни месяца.
 * @param {string} month — ГГГГ-ММ
 * @param {string} today — ГГГГ-ММ-ДД
 */
export function daysLeft(month, today) {
  const todayMonth = today.slice(0, 7);
  if (todayMonth > month) return 0;
  const total = daysInMonth(month);
  if (todayMonth < month) return total;
  return total - Number(today.slice(8, 10)) + 1;
}

/**
 * @typedef {Object} LimitStatus
 * @property {number} limit
 * @property {number} spent
 * @property {number} remaining — может быть отрицательным при превышении
 * @property {number} percent — использовано, целое число процентов
 * @property {'ok' | 'warn' | 'over'} level
 * @property {number} daysLeft
 * @property {number | null} perDay — «можно тратить в день»; null, если дней не осталось или лимит исчерпан
 */

/**
 * @param {number} limit
 * @param {number} spent
 * @param {string} month
 * @param {string} today
 * @returns {LimitStatus}
 */
export function limitStatus(limit, spent, month, today) {
  const remaining = limit - spent;
  const percent = limit > 0 ? divRound(spent * 100, limit) : 100;
  // Уровень считается по точным суммам, а не по округлённому проценту.
  const level = spent > limit ? 'over' : spent * 100 >= limit * WARN_PERCENT ? 'warn' : 'ok';
  const left = daysLeft(month, today);
  const perDay = left > 0 && remaining > 0 ? divRound(remaining, left) : null;
  return { limit, spent, remaining, percent, level, daysLeft: left, perDay };
}

/**
 * Сообщение после сохранения расхода, например:
 * «Продукты: осталось 143,00 € из 200,00 €, до конца месяца 12 дней, около 11,92 € в день».
 * @param {string} categoryName
 * @param {LimitStatus} s
 */
export function limitMessage(categoryName, s) {
  if (s.remaining < 0) {
    return `${categoryName}: план ${formatMoney(s.limit, 'EUR')} превышен на ${formatMoney(-s.remaining, 'EUR')}`;
  }
  let msg = `${categoryName}: осталось ${formatMoney(s.remaining, 'EUR')} из ${formatMoney(s.limit, 'EUR')}`;
  if (s.daysLeft > 0) {
    msg += `, до конца месяца ${s.daysLeft} ${pluralDays(s.daysLeft)}`;
    if (s.perDay != null) msg += `, около ${formatMoney(s.perDay, 'EUR')} в день`;
  }
  return msg;
}

/** @param {number} n */
export function pluralDays(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'день';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня';
  return 'дней';
}
