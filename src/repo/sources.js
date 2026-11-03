// Справочник источников оплаты: наличные, карты, кошельки.
// Хранится в настройках списком названий (как банки): отдельная таблица не нужна,
// а резервная копия и общие данные включают настройки.

import { getDb, getSetting, setSetting, getAll, put } from '../db.js';

const KEY = 'paymentSources';

/**
 * @param {IDBDatabase} [db]
 * @returns {Promise<string[]>}
 */
export async function listSources(db) {
  const d = db ?? (await getDb());
  /** @type {string[]} */
  const list = (await getSetting(KEY, d)) ?? [];
  return [...list];
}

/**
 * @param {string} name
 * @param {IDBDatabase} [db]
 * @returns {Promise<string>}
 */
export async function addSource(name, db) {
  const d = db ?? (await getDb());
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw new Error('Укажите название');
  const list = await listSources(d);
  if (list.some((s) => s.toLowerCase() === trimmed.toLowerCase())) throw new Error('Такой источник уже есть');
  await setSetting(KEY, [...list, trimmed], d);
  return trimmed;
}

/**
 * Переименование; у уже записанных операций название тоже меняется.
 * @param {string} from
 * @param {string} to
 * @param {IDBDatabase} [db]
 */
export async function renameSource(from, to, db) {
  const d = db ?? (await getDb());
  const trimmed = to.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw new Error('Укажите название');
  const list = await listSources(d);
  if (list.some((s) => s !== from && s.toLowerCase() === trimmed.toLowerCase())) throw new Error('Такой источник уже есть');
  await setSetting(KEY, list.map((s) => (s === from ? trimmed : s)), d);
  /** @type {import('./operations.js').Operation[]} */
  const ops = await getAll(d, 'operations');
  for (const o of ops) {
    if (o.source !== from) continue;
    await put(d, 'operations', { ...o, source: trimmed, updatedAt: new Date().toISOString() });
  }
}

/**
 * Удаление из списка; у уже записанных операций название остаётся.
 * @param {string} name
 * @param {IDBDatabase} [db]
 */
export async function removeSource(name, db) {
  const d = db ?? (await getDb());
  await setSetting(KEY, (await listSources(d)).filter((s) => s !== name), d);
}

/**
 * Сколько операций у каждого источника.
 * @param {IDBDatabase} [db]
 * @returns {Promise<Map<string, number>>}
 */
export async function sourceUsage(db) {
  const d = db ?? (await getDb());
  /** @type {import('./operations.js').Operation[]} */
  const ops = await getAll(d, 'operations');
  const m = new Map();
  for (const o of ops) if (o.source) m.set(o.source, (m.get(o.source) ?? 0) + 1);
  return m;
}
