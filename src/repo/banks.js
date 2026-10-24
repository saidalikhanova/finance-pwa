// Справочник банков (для кредитов). Хранится в настройках списком названий:
// отдельная таблица не нужна, а резервная копия включает настройки.

import { getDb, getSetting, setSetting, getAll, put } from '../db.js';

const KEY = 'banks';

/**
 * @param {IDBDatabase} [db]
 * @returns {Promise<string[]>}
 */
export async function listBanks(db) {
  const d = db ?? (await getDb());
  /** @type {string[]} */
  const list = (await getSetting(KEY, d)) ?? [];
  return [...list].sort((a, b) => a.localeCompare(b, 'ru'));
}

/**
 * @param {string} name
 * @param {IDBDatabase} [db]
 * @returns {Promise<string>}
 */
export async function addBank(name, db) {
  const d = db ?? (await getDb());
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Укажите название банка');
  const list = await listBanks(d);
  if (list.some((b) => b.toLowerCase() === trimmed.toLowerCase())) throw new Error('Такой банк уже есть');
  await setSetting(KEY, [...list, trimmed], d);
  return trimmed;
}

/**
 * Переименование; у кредитов этого банка название банка тоже меняется.
 * @param {string} from
 * @param {string} to
 * @param {IDBDatabase} [db]
 */
export async function renameBank(from, to, db) {
  const d = db ?? (await getDb());
  const trimmed = to.trim();
  if (!trimmed) throw new Error('Укажите название банка');
  const list = await listBanks(d);
  if (list.some((b) => b !== from && b.toLowerCase() === trimmed.toLowerCase())) throw new Error('Такой банк уже есть');
  await setSetting(KEY, list.map((b) => (b === from ? trimmed : b)), d);
  /** @type {import('../recurring.js').Schedule[]} */
  const schedules = await getAll(d, 'recurring');
  for (const s of schedules) {
    if (s.bank !== from) continue;
    await put(d, 'recurring', { ...s, bank: trimmed, name: s.name.replace(from, trimmed), updatedAt: new Date().toISOString() });
  }
}

/**
 * Удаление из справочника; у уже заведённых кредитов название банка остаётся.
 * @param {string} name
 * @param {IDBDatabase} [db]
 */
export async function removeBank(name, db) {
  const d = db ?? (await getDb());
  await setSetting(KEY, (await listBanks(d)).filter((b) => b !== name), d);
}
