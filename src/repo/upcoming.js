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
 * @property {boolean} confirm — ждёт отметки («Оплатил(а)» / «Получил(а)»), а не записывается сам
 */

/**
 * Платежи в диапазоне дат (включительно), по дате. Ожидаемые поступления
 * «в течение месяца» сюда не входят — у них нет конкретного дня.
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
    // У доходов «с подтверждением» созданные периоды уже лежат в ожидаемых поступлениях.
    const fromN = s.confirm ? s.generatedCount : 0;
    for (const o of occurrences(s, fromN, addDays(from, -1), to)) {
      out.push({ date: o.date, name: s.name, type: s.type, amount: s.amount, currency: s.currency, categoryId: s.categoryId, source: 'recurring', refId: s.id, confirm: Boolean(s.confirm) });
    }
  }
  for (const p of await listPlanned({ from, to }, d)) {
    if (p.dateKind === 'month') continue;
    out.push({ date: p.date, name: p.name, type: p.type, amount: p.amount, currency: p.currency, categoryId: p.categoryId, source: 'planned', refId: p.id, confirm: true });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name, 'ru')));
}
