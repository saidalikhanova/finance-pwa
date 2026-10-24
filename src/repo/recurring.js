import { getDb, getAll, getOne, put, remove, promisify, done } from '../db.js';
import { toEurCents } from '../money.js';
import { dueOccurrences, isExhausted, occurrences } from '../recurring.js';
import { suggestRate } from './rates.js';

/** @typedef {import('../recurring.js').Schedule} Schedule */

/**
 * Проверяет поля расписания.
 * @param {Partial<Schedule>} input
 */
export function normalizeSchedule(input) {
  const name = (input.name ?? '').trim();
  if (!name) throw new Error('Укажите название платежа');
  if (input.type !== 'expense' && input.type !== 'income') throw new Error('Не указан тип');
  if (input.currency !== 'EUR' && input.currency !== 'KZT') throw new Error('Не указана валюта');
  if (!Number.isSafeInteger(input.amount) || /** @type {number} */ (input.amount) <= 0) throw new Error('Сумма должна быть больше нуля');
  if (!input.categoryId) throw new Error('Не выбрана категория');
  if (!['weekly', 'monthly', 'yearly', 'custom'].includes(input.period ?? '')) throw new Error('Не указана периодичность');
  if (!input.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) throw new Error('Не указана дата первого платежа');
  const intervalDays = input.period === 'custom' ? Number(input.intervalDays) : 0;
  if (input.period === 'custom' && (!Number.isInteger(intervalDays) || intervalDays < 1)) throw new Error('Интервал должен быть не меньше 1 дня');
  const endType = input.endType ?? 'none';
  if (endType === 'date' && (!input.endDate || input.endDate < input.startDate)) throw new Error('Дата окончания раньше даты начала');
  if (endType === 'count' && (!Number.isInteger(input.count) || /** @type {number} */ (input.count) < 1)) throw new Error('Число платежей должно быть не меньше 1');
  return {
    name,
    type: input.type,
    amount: /** @type {number} */ (input.amount),
    currency: input.currency,
    categoryId: input.categoryId,
    period: /** @type {Schedule['period']} */ (input.period),
    intervalDays,
    startDate: input.startDate,
    endType,
    endDate: endType === 'date' ? /** @type {string} */ (input.endDate) : null,
    count: endType === 'count' ? /** @type {number} */ (input.count) : null,
    // Не записывать сразу, а ждать подтверждения: для доходов («Получено»)
    // и для платежей по кредиту («Оплачено»); у прочих расходов — нет
    confirm: Boolean(input.confirm) && (input.type === 'income' || Boolean(input.bank?.trim())),
    bank: input.bank?.trim() || null,
  };
}

/**
 * @param {Partial<Schedule>} input
 * @param {IDBDatabase} [db]
 * @returns {Promise<Schedule>}
 */
export async function createSchedule(input, db) {
  const d = db ?? (await getDb());
  const now = new Date().toISOString();
  /** @type {Schedule} */
  const s = {
    id: crypto.randomUUID(),
    ...normalizeSchedule(input),
    status: 'active',
    generatedCount: 0,
    lastGeneratedDate: null,
    createdAt: now,
    updatedAt: now,
  };
  await put(d, 'recurring', s);
  return s;
}

/**
 * Изменяет расписание. Уже созданные операции не трогаются; новые условия
 * действуют со следующего платежа.
 * @param {string} id
 * @param {Partial<Schedule>} input
 * @param {IDBDatabase} [db]
 */
export async function updateSchedule(id, input, db) {
  const d = db ?? (await getDb());
  const s = await getSchedule(id, d);
  if (!s) throw new Error('Платёж не найден');
  /** @type {Schedule} */
  const next = { ...s, ...normalizeSchedule({ ...s, ...input }), updatedAt: new Date().toISOString() };
  if (next.status === 'finished' && !isExhausted(next)) next.status = 'active';
  await put(d, 'recurring', next);
  return next;
}

/**
 * Приостановить / возобновить / завершить досрочно.
 * При возобновлении пропущенные за время паузы платежи не создаются.
 * @param {string} id
 * @param {'active' | 'paused' | 'finished'} status
 * @param {string} today
 * @param {IDBDatabase} [db]
 */
export async function setScheduleStatus(id, status, today, db) {
  const d = db ?? (await getDb());
  const s = await getSchedule(id, d);
  if (!s) throw new Error('Платёж не найден');
  /** @type {Schedule} */
  const next = { ...s, status, updatedAt: new Date().toISOString() };
  if (status === 'active' && s.status === 'paused') {
    // Пропускаем платежи, выпавшие на паузу: номер следующего — первый после сегодня.
    const skipped = occurrences(s, s.generatedCount, s.lastGeneratedDate, today);
    next.generatedCount = s.generatedCount + skipped.length;
    next.lastGeneratedDate = skipped.length ? skipped[skipped.length - 1].date : s.lastGeneratedDate;
    if (isExhausted(next)) next.status = 'finished';
  }
  await put(d, 'recurring', next);
  return next;
}

/**
 * @param {string} id
 * @param {IDBDatabase} [db]
 */
export async function deleteSchedule(id, db) {
  const d = db ?? (await getDb());
  await remove(d, 'recurring', id);
}

/**
 * @param {string} id
 * @param {IDBDatabase} [db]
 * @returns {Promise<Schedule | undefined>}
 */
export async function getSchedule(id, db) {
  const d = db ?? (await getDb());
  return getOne(d, 'recurring', id);
}

/**
 * @param {IDBDatabase} [db]
 * @returns {Promise<Schedule[]>}
 */
export async function listSchedules(db) {
  const d = db ?? (await getDb());
  /** @type {Schedule[]} */
  const all = await getAll(d, 'recurring');
  const order = { active: 0, paused: 1, finished: 2 };
  return all.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name, 'ru'));
}

/**
 * Создаёт операции по всем активным расписаниям до даты `today` включительно,
 * в том числе пропущенные, если приложение не открывалось.
 * @param {string} today
 * @param {IDBDatabase} [db]
 * @returns {Promise<number>} — число созданных операций
 */
export async function generateDue(today, db) {
  const d = db ?? (await getDb());
  const schedules = await listSchedules(d);
  let created = 0;
  for (const s of schedules) {
    const due = dueOccurrences(s, today);
    if (!due.length) continue;

    // Курсы подбираем заранее — внутри транзакции ждать нельзя.
    const rates = new Map();
    if (s.currency === 'KZT') {
      for (const o of due) rates.set(o.date, (await suggestRate(o.date, d))?.rate ?? null);
    }

    const tx = d.transaction(['operations', 'recurring', 'planned'], 'readwrite');
    const ops = tx.objectStore('operations');
    const now = new Date().toISOString();
    for (const o of due) {
      if (s.confirm) {
        // Доход «с подтверждением»: создаётся ожидаемое поступление, а не операция
        tx.objectStore('planned').put({
          id: crypto.randomUUID(),
          name: s.name,
          type: s.type,
          amount: s.amount,
          currency: s.currency,
          categoryId: s.categoryId,
          date: o.date,
          dateKind: 'day',
          movedFrom: null,
          recurringId: s.id,
          done: false,
          operationId: null,
          receivedDate: null,
          receivedAmount: null,
          createdAt: now,
        });
        continue;
      }
      const rate = s.currency === 'KZT' ? rates.get(o.date) ?? null : null;
      ops.put({
        id: crypto.randomUUID(),
        type: s.type,
        date: o.date,
        currency: s.currency,
        amount: s.amount,
        rate,
        rateSource: rate ? 'manual' : null,
        amountEur: toEurCents(s.amount, s.currency, rate),
        categoryId: s.categoryId,
        comment: s.name,
        items: [],
        recurringId: s.id,
        createdAt: now,
        updatedAt: now,
      });
    }
    /** @type {Schedule} */
    const next = {
      ...s,
      generatedCount: s.generatedCount + due.length,
      lastGeneratedDate: due[due.length - 1].date,
      updatedAt: now,
    };
    if (isExhausted(next)) next.status = 'finished';
    tx.objectStore('recurring').put(next);
    await done(tx);
    created += due.length;
  }
  return created;
}
