// Общие данные для семьи: настройка подключения и проверка связи с облаком.
// Сам обмен записями — этап 2 (см. docs/SYNC-PLAN.md).

import { getDb, getSetting, setSetting, enqueueAll, clearChanges, getAll } from './db.js';
import { normalizeUrl, validateConfig } from './sync-config.js';

export const SYNC_KEY = 'sync';

/** @returns {Promise<import('./sync-config.js').SyncConfig | null>} */
export async function getSyncConfig(db) {
  const c = await getSetting(SYNC_KEY, db);
  return c && c.url && c.key && c.family ? c : null;
}

/**
 * Заголовки запроса к облаку: ключ проекта и семейный код.
 * @param {{ key: string, family: string }} c
 */
export function headers(c) {
  return { apikey: c.key, Authorization: `Bearer ${c.key}`, 'x-family': c.family, 'Content-Type': 'application/json' };
}

/**
 * Проверка связи: читает одну запись семьи. Бросает ошибку с понятным текстом.
 * @param {{ url: string, key: string, family: string }} c
 * @param {typeof fetch} [fetchFn]
 */
export async function ping(c, fetchFn = fetch) {
  const err = validateConfig(c);
  if (err) throw new Error(err);
  let res;
  try {
    res = await fetchFn(`${normalizeUrl(c.url)}/rest/v1/records?select=id&limit=1`, { headers: headers(c) });
  } catch {
    throw new Error('Нет связи с облаком: проверьте интернет и адрес проекта');
  }
  if (res.status === 401 || res.status === 403) throw new Error('Облако не приняло ключ проекта');
  if (res.status === 404) throw new Error('В проекте нет таблицы записей — выполните скрипт docs/supabase-setup.sql');
  if (!res.ok) throw new Error(`Облако ответило ошибкой ${res.status}`);
  return true;
}

/**
 * Включает общие данные на этом телефоне и ставит в очередь всё, что уже есть.
 * @param {{ url: string, key: string, family: string }} c
 * @param {IDBDatabase} [db]
 * @returns {Promise<number>} — сколько записей ожидают отправки
 */
export async function enableSync(c, db) {
  const d = db ?? (await getDb());
  const err = validateConfig(c);
  if (err) throw new Error(err);
  /** @type {import('./sync-config.js').SyncConfig} */
  const cfg = { url: normalizeUrl(c.url), key: c.key.trim(), family: c.family, cursor: null, lastAt: null, lastError: null };
  await setSetting(SYNC_KEY, cfg, d);
  return enqueueAll(d);
}

/** Отключает общие данные: записи на телефоне остаются, очередь очищается. @param {IDBDatabase} [db] */
export async function disableSync(db) {
  const d = db ?? (await getDb());
  await setSetting(SYNC_KEY, null, d);
  await clearChanges(d);
}

/** Сколько изменений ожидают отправки. @param {IDBDatabase} [db] */
export async function pendingCount(db) {
  const d = db ?? (await getDb());
  return (await getAll(d, 'changes')).length;
}
