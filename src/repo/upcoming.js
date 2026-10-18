import { getDb } from '../db.js';
import { occurrences } from '../recurring.js';
import { addDays } from '../dates.js';
import { listSchedules } from './recurring.js';
import { listPlanned } from './planned.js';

/**
 * Предстоящий платёж в календаре: из расписания или разовый.
 * @typedef {Object} Upcoming
 * @property {string} date
 * @property {string} name
 * @property {'expense' | 'income'} type
 * @property {number} amount
 * @property {import('../money.js').Currency} currency
 * @property {string} categoryId
 * @property {'recurring' | 'planned'} source
 * @property {string} refId
 */

/**
 * Платежи в диапазоне дат (включительно), по дате.
 * @param {string} from
 * @param {string} to
 * @param {IDBDatabase} [db]
 * @returns {Promise<Upcoming[]>}
 */
export async function listUpcoming(from, to, db) {
  const d = db ?? (await getDb());
  /** @type {Upcoming[]} */
  const out = [];
  for (const s of await listSchedules(d)) {
    if (s.status !== 'active') continue;
    // Показываем и уже созданные на эти даты платежи: с номера 0, но не раньше from.
    for (const o of occurrences(s, 0, addDays(from, -1), to)) {
      out.push({ date: o.date, name: s.name, type: s.type, amount: s.amount, currency: s.currency, categoryId: s.categoryId, source: 'recurring', refId: s.id });
    }
  }
  for (const p of await listPlanned({ from, to }, d)) {
    out.push({ date: p.date, name: p.name, type: p.type, amount: p.amount, currency: p.currency, categoryId: p.categoryId, source: 'planned', refId: p.id });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name, 'ru')));
}
