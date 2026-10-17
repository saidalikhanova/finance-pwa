import { getDb, getAll, getOne, put, promisify, done } from '../db.js';
import { toEurCents } from '../money.js';

// Курсы тенге к евро по датам. По решению пользователя (см. PROGRESS.md, этап 3)
// курс вводится вручную; автоматическое получение от Нацбанка не используется.

/**
 * @typedef {Object} Rate
 * @property {string} date — ГГГГ-ММ-ДД
 * @property {number} rate — тенге за 1 евро × RATE_SCALE
 * @property {'manual'} source
 * @property {string} updatedAt
 */

/**
 * Курс на конкретную дату.
 * @param {string} date
 * @param {IDBDatabase} [db]
 * @returns {Promise<Rate | undefined>}
 */
export async function getRate(date, db) {
  const d = db ?? (await getDb());
  return getOne(d, 'rates', date);
}

/**
 * Курс, который стоит подставить для даты: на саму дату, иначе ближайший
 * предыдущий, иначе самый ранний из известных.
 * @param {string} date
 * @param {IDBDatabase} [db]
 * @returns {Promise<Rate | undefined>}
 */
export async function suggestRate(date, db) {
  const d = db ?? (await getDb());
  const exact = await getRate(date, d);
  if (exact) return exact;
  /** @type {Rate[]} */
  const all = await getAll(d, 'rates');
  if (!all.length) return undefined;
  const before = all.filter((r) => r.date < date).sort((a, b) => (a.date < b.date ? 1 : -1));
  return before[0] ?? all.sort((a, b) => (a.date < b.date ? -1 : 1))[0];
}

/**
 * Сохраняет курс на дату и пересчитывает операции в тенге за эту дату,
 * у которых курс ещё не определён.
 * @param {string} date
 * @param {number} rate — × RATE_SCALE
 * @param {IDBDatabase} [db]
 * @returns {Promise<number>} — сколько операций получили курс
 */
export async function saveRate(date, rate, db) {
  const d = db ?? (await getDb());
  if (!Number.isSafeInteger(rate) || rate <= 0) throw new Error('Курс должен быть больше нуля');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Не указана дата курса');

  await put(d, 'rates', { date, rate, source: 'manual', updatedAt: new Date().toISOString() });
  return applyRateToOperations(date, rate, d);
}

/**
 * Проставляет курс операциям в тенге за дату, у которых он не определён.
 * Операции с уже заданным курсом не трогаются.
 * @param {string} date
 * @param {number} rate
 * @param {IDBDatabase} db
 */
async function applyRateToOperations(date, rate, db) {
  const tx = db.transaction('operations', 'readwrite');
  const store = tx.objectStore('operations');
  /** @type {import('./operations.js').Operation[]} */
  const ops = await promisify(store.index('date').getAll(date));
  let updated = 0;
  const now = new Date().toISOString();
  for (const op of ops) {
    if (op.currency !== 'KZT' || op.rate) continue;
    store.put({ ...op, rate, rateSource: 'manual', amountEur: toEurCents(op.amount, 'KZT', rate), updatedAt: now });
    updated++;
  }
  await done(tx);
  return updated;
}

/**
 * Операции в тенге без курса (для показа на главной).
 * @param {IDBDatabase} [db]
 */
export async function listOperationsWithoutRate(db) {
  const d = db ?? (await getDb());
  /** @type {import('./operations.js').Operation[]} */
  const ops = await getAll(d, 'operations', { index: 'type' });
  return ops.filter((o) => o.currency === 'KZT' && o.amountEur == null).sort((a, b) => (a.date < b.date ? 1 : -1));
}
