import { getDb, getAll, getOne, put, remove, promisify, done } from '../db.js';
import { effectiveLine } from '../income.js';

/**
 * Строка бюджета: план и лимит категории на месяц. Суммы — в центах евро.
 * Для категорий доходов лимит не используется (null).
 * @typedef {Object} BudgetLine
 * @property {string} id — 'ГГГГ-ММ:categoryId'
 * @property {string} month — ГГГГ-ММ
 * @property {string} categoryId
 * @property {number | null} planned
 * @property {number | null} limit
 * @property {import('../money.js').Currency} [plannedCurrency] — валюта, в которой план вводился
 * @property {number | null} [plannedOriginal] — план в этой валюте (минимальные единицы)
 * @property {boolean} [repeat] — план действует и в следующих месяцах, пока не задан другой
 * @property {string} updatedAt
 */

/**
 * @param {string} month
 * @param {string} categoryId
 */
export function lineId(month, categoryId) {
  return `${month}:${categoryId}`;
}

/**
 * Все строки бюджета месяца.
 * @param {string} month
 * @param {IDBDatabase} [db]
 * @returns {Promise<BudgetLine[]>}
 */
export async function getBudget(month, db) {
  const d = db ?? (await getDb());
  return getAll(d, 'budgets', { index: 'month', query: month });
}

/**
 * @param {string} month
 * @param {string} categoryId
 * @param {IDBDatabase} [db]
 * @returns {Promise<BudgetLine | undefined>}
 */
export async function getBudgetLine(month, categoryId, db) {
  const d = db ?? (await getDb());
  return getOne(d, 'budgets', lineId(month, categoryId));
}

/**
 * Записывает план и лимит категории на месяц. Если оба пустые — строка удаляется.
 * @param {string} month
 * @param {string} categoryId
 * @param {{ planned?: number | null, limit?: number | null, plannedCurrency?: 'EUR' | 'KZT', plannedOriginal?: number | null, repeat?: boolean }} values
 * @param {IDBDatabase} [db]
 */
export async function setBudgetLine(month, categoryId, values, db) {
  const d = db ?? (await getDb());
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Не указан месяц');
  for (const v of [values.planned, values.limit, values.plannedOriginal]) {
    if (v != null && (!Number.isSafeInteger(v) || v < 0)) throw new Error('Сумма должна быть целым числом не меньше нуля');
  }
  const planned = values.planned ?? null;
  const limit = values.limit ?? null;
  const id = lineId(month, categoryId);
  if (planned == null && limit == null) {
    await remove(d, 'budgets', id);
    return;
  }
  /** @type {BudgetLine} */
  const plannedCurrency = values.plannedCurrency === 'KZT' ? 'KZT' : 'EUR';
  const line = {
    id,
    month,
    categoryId,
    planned,
    limit,
    plannedCurrency,
    plannedOriginal: planned == null ? null : values.plannedOriginal ?? (plannedCurrency === 'EUR' ? planned : null),
    repeat: Boolean(values.repeat) && planned != null,
    updatedAt: new Date().toISOString(),
  };
  await put(d, 'budgets', line);
}

/**
 * Убирает категорию из бюджета одного месяца; другие месяцы не меняются.
 * Если план этого месяца пришёл из «каждый месяц» более раннего месяца,
 * месяц помечается нулевым планом, а следующий месяц получает свою копию плана,
 * чтобы повтор продолжился.
 * @param {string} month
 * @param {string} categoryId
 * @param {IDBDatabase} [db]
 */
export async function removeFromMonth(month, categoryId, db) {
  const d = db ?? (await getDb());
  const lines = await listCategoryLines(categoryId, d);
  const next = nextMonth(month);
  const nextEff = effectiveLine(lines, next);
  const rest = lines.filter((l) => l.month !== month);
  const prevEff = effectiveLine(rest, month);
  const now = new Date().toISOString();
  if (prevEff) {
    await put(d, 'budgets', { ...prevEff.line, id: lineId(month, categoryId), month, planned: 0, plannedOriginal: 0, limit: null, repeat: false, updatedAt: now });
  } else {
    await remove(d, 'budgets', lineId(month, categoryId));
  }
  if (nextEff?.inherited) {
    await put(d, 'budgets', { ...nextEff.line, id: lineId(next, categoryId), month: next, updatedAt: now });
  }
}

/** @param {string} month */
function nextMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/**
 * Месяцы, для которых есть бюджет, новые сверху.
 * @param {IDBDatabase} [db]
 * @returns {Promise<string[]>}
 */
export async function listBudgetMonths(db) {
  const d = db ?? (await getDb());
  /** @type {BudgetLine[]} */
  const all = await getAll(d, 'budgets');
  return [...new Set(all.map((l) => l.month))].sort().reverse();
}

/**
 * Копирует бюджет месяца `from` в месяц `to` (категории, планы, лимиты).
 * Существующие строки месяца `to` заменяются.
 * @param {string} from
 * @param {string} to
 * @param {IDBDatabase} [db]
 * @returns {Promise<number>} — число скопированных строк
 */
export async function copyBudget(from, to, db) {
  const d = db ?? (await getDb());
  if (from === to) throw new Error('Нельзя скопировать месяц сам в себя');
  const source = await getBudget(from, d);
  if (!source.length) throw new Error('В исходном месяце нет бюджета');

  const tx = d.transaction('budgets', 'readwrite');
  const store = tx.objectStore('budgets');
  /** @type {BudgetLine[]} */
  const existing = await promisify(store.index('month').getAll(to));
  for (const line of existing) store.delete(line.id);
  const now = new Date().toISOString();
  for (const line of source) {
    store.put({ ...line, id: lineId(to, line.categoryId), month: to, updatedAt: now });
  }
  await done(tx);
  return source.length;
}

/**
 * Все строки бюджета категории за все месяцы, по возрастанию месяца.
 * @param {string} categoryId
 * @param {IDBDatabase} [db]
 * @returns {Promise<BudgetLine[]>}
 */
export async function listCategoryLines(categoryId, db) {
  const d = db ?? (await getDb());
  /** @type {BudgetLine[]} */
  const all = await getAll(d, 'budgets');
  return all.filter((l) => l.categoryId === categoryId).sort((a, b) => (a.month < b.month ? -1 : 1));
}

/**
 * Все строки бюджета.
 * @param {IDBDatabase} [db]
 * @returns {Promise<BudgetLine[]>}
 */
export async function listAllLines(db) {
  const d = db ?? (await getDb());
  return getAll(d, 'budgets');
}
