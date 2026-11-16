// Единые статусы платежей и поступлений с датой. Чистые функции.
//   не оплачено / не получено · срок · просрочено N дн. · оплачено / получено <дата>

import { diffDays } from './dates.js';
import { formatDate } from './ui.js';

/**
 * @typedef {'upcoming' | 'today' | 'overdue' | 'done'} PayStatusKind
 * @typedef {{ kind: PayStatusKind, text: string, daysLate: number }} PayStatus
 */

/**
 * @param {{ date: string | null, done?: boolean, doneDate?: string | null, type: 'expense' | 'income' }} p
 *   date — срок (null — «в течение месяца», для статуса считается концом месяца не раньше сегодня)
 * @param {string} today
 * @returns {PayStatus}
 */
export function payStatus(p, today) {
  if (p.done) {
    const verb = p.type === 'income' ? 'получено' : 'оплачено';
    return { kind: 'done', text: p.doneDate ? `${verb} ${formatDate(p.doneDate)}` : verb, daysLate: 0 };
  }
  const not = p.type === 'income' ? 'не получено' : 'не оплачено';
  if (!p.date) return { kind: 'upcoming', text: `${not} · в течение месяца`, daysLate: 0 };
  if (p.date === today) return { kind: 'today', text: `${not} · срок сегодня`, daysLate: 0 };
  if (p.date < today) {
    const n = diffDays(p.date, today);
    return { kind: 'overdue', text: `${not} · просрочено ${n} дн., срок ${formatDate(p.date)}`, daysLate: n };
  }
  return { kind: 'upcoming', text: `${not} · срок ${formatDate(p.date)}`, daysLate: 0 };
}

/** Надпись на кнопке: статус показывается отдельно, кнопка — «записать факт». @param {'expense' | 'income'} [_type] */
export function markLabel(_type) {
  return '+ Факт';
}
