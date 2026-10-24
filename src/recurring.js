// Расчёт дат повторяющихся платежей. Чистые функции без обращения к базе.

import { addDays, addMonthsKeepDay } from './dates.js';

/**
 * @typedef {'weekly' | 'monthly' | 'yearly' | 'custom'} Period
 * @typedef {'none' | 'date' | 'count'} EndType
 */

/**
 * @typedef {Object} Schedule
 * @property {string} id
 * @property {string} name
 * @property {'expense' | 'income'} type
 * @property {number} amount — в минимальных единицах
 * @property {import('./money.js').Currency} currency
 * @property {string} categoryId
 * @property {Period} period
 * @property {number} intervalDays — для period = 'custom'
 * @property {string} startDate — дата первого платежа, ГГГГ-ММ-ДД; задаёт день платежа
 * @property {EndType} endType
 * @property {string | null} endDate — для endType = 'date'
 * @property {number | null} count — число платежей, для endType = 'count'
 * @property {boolean} [confirm] — «ждать подтверждения»: вместо операции создаётся ожидаемое поступление / платёж к оплате
 * @property {string | null} [bank] — банк из справочника, если это платёж по кредиту
 * @property {number | null} [principal] — сумма кредита (основной долг), в валюте платежа
 * @property {'active' | 'paused' | 'finished'} status
 * @property {number} generatedCount — сколько операций уже создано
 * @property {string | null} lastGeneratedDate — дата последней созданной операции
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/** @type {Record<Period, string>} */
export const PERIOD_LABEL = { weekly: 'Еженедельно', monthly: 'Ежемесячно', yearly: 'Ежегодно', custom: 'Свой интервал' };

/**
 * Дата n-го платежа (n = 0 — первый).
 * @param {Pick<Schedule, 'period' | 'intervalDays' | 'startDate'>} s
 * @param {number} n
 */
export function nthDate(s, n) {
  const day = Number(s.startDate.slice(8, 10));
  switch (s.period) {
    case 'weekly':
      return addDays(s.startDate, 7 * n);
    case 'custom':
      return addDays(s.startDate, Math.max(1, s.intervalDays) * n);
    case 'monthly':
      return addMonthsKeepDay(s.startDate, n, day);
    case 'yearly':
      return addMonthsKeepDay(s.startDate, 12 * n, day);
    default:
      throw new Error('Неизвестная периодичность');
  }
}

/**
 * Платежи с номерами от `fromN` (включительно), дата которых > afterDate и ≤ toDate,
 * с учётом срока действия.
 * @param {Schedule} s
 * @param {number} fromN — номер первого ещё не созданного платежа (обычно generatedCount)
 * @param {string | null} afterDate — исключительно; null — без нижней границы
 * @param {string} toDate — включительно
 * @param {number} [limit]
 * @returns {{ n: number, date: string }[]}
 */
export function occurrences(s, fromN, afterDate, toDate, limit = 1000) {
  const out = [];
  for (let n = Math.max(0, fromN); out.length < limit; n++) {
    if (s.endType === 'count' && s.count != null && n >= s.count) break;
    const date = nthDate(s, n);
    if (s.endType === 'date' && s.endDate && date > s.endDate) break;
    if (date > toDate) break;
    if (afterDate != null && date <= afterDate) continue;
    out.push({ n, date });
  }
  return out;
}

/**
 * Платежи, которые пора создать на дату `today` (пропущенные — тоже).
 * @param {Schedule} s
 * @param {string} today
 */
export function dueOccurrences(s, today) {
  if (s.status !== 'active') return [];
  return occurrences(s, s.generatedCount, s.lastGeneratedDate, today);
}

/**
 * Ближайший будущий платёж (дата > afterDate), или null, если расписание завершено.
 * @param {Schedule} s
 * @param {string} afterDate
 */
export function nextOccurrence(s, afterDate) {
  if (s.status === 'finished') return null;
  const [first] = occurrences(s, s.generatedCount, afterDate, '9999-12-31', 1);
  return first ?? null;
}

/**
 * Для платежей с окончанием: сколько платежей и какая сумма ещё впереди
 * (не считая уже созданных операций). Для бессрочных — null.
 * @param {Schedule} s
 * @returns {{ count: number, amount: number } | null}
 */
export function remaining(s) {
  if (s.endType === 'none') return null;
  if (s.status === 'finished') return { count: 0, amount: 0 };
  const list = occurrences(s, s.generatedCount, null, '9999-12-31');
  return { count: list.length, amount: list.length * s.amount };
}

/**
 * Завершено ли расписание после создания операций до `generatedCount`.
 * @param {Schedule} s
 */
export function isExhausted(s) {
  if (s.endType === 'count') return s.count != null && s.generatedCount >= s.count;
  if (s.endType === 'date') return s.endDate != null && nthDate(s, s.generatedCount) > s.endDate;
  return false;
}
