// Общие данные для семьи: подключение, обмен записями с облаком (Supabase),
// «последняя правка побеждает». План — docs/SYNC-PLAN.md.

import { getDb, getSetting, setSetting, enqueueAll, clearChanges, getAll, getOne, put, remove, keyOf, wipeSynced, setChangeListener } from './db.js';
import { normalizeUrl, validateConfig } from './sync-config.js';
import { rerender } from './router.js';

export const SYNC_KEY = 'sync';
const BATCH = 200;
const PAGE = 1000;

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

/** @param {number} status */
function statusError(status) {
  if (status === 401 || status === 403) return new Error('Облако не приняло ключ проекта');
  if (status === 404) return new Error('В проекте нет таблицы записей — выполните скрипт docs/supabase-setup.sql');
  return new Error(`Облако ответило ошибкой ${status}`);
}

/**
 * Запрос к таблице записей; сетевые ошибки и ошибки ответа — понятным текстом.
 * @param {{ url: string, key: string, family: string }} c
 * @param {string} query — часть адреса после /records
 * @param {RequestInit} [init]
 * @param {typeof fetch} [fetchFn]
 */
async function request(c, query, init = {}, fetchFn = fetch) {
  let res;
  try {
    res = await fetchFn(`${normalizeUrl(c.url)}/rest/v1/records${query}`, { ...init, headers: { ...headers(c), ...(init.headers ?? {}) } });
  } catch {
    throw new Error('Нет связи с облаком: проверьте интернет и адрес проекта');
  }
  if (!res.ok) throw statusError(res.status);
  return res;
}

/**
 * Проверка связи: читает одну запись семьи.
 * @param {{ url: string, key: string, family: string }} c
 * @param {typeof fetch} [fetchFn]
 */
export async function ping(c, fetchFn = fetch) {
  const err = validateConfig(c);
  if (err) throw new Error(err);
  await request(c, '?select=id&limit=1', {}, fetchFn);
  return true;
}

/**
 * Включает общие данные на этом телефоне.
 * create — семейный код создан здесь: всё, что есть, ставится в очередь на отправку.
 * join — подключение по коду: местные общие записи заменяются записями семьи.
 * @param {{ url: string, key: string, family: string }} c
 * @param {{ mode?: 'create' | 'join' }} [opts]
 * @param {IDBDatabase} [db]
 * @returns {Promise<number>} — сколько записей ожидают отправки
 */
export async function enableSync(c, opts = {}, db) {
  const d = db ?? (await getDb());
  const err = validateConfig(c);
  if (err) throw new Error(err);
  /** @type {import('./sync-config.js').SyncConfig} */
  const cfg = { url: normalizeUrl(c.url), key: c.key.trim(), family: c.family, cursor: null, lastAt: null, lastError: null };
  if (opts.mode === 'join') await wipeSynced(d);
  await setSetting(SYNC_KEY, cfg, d);
  return opts.mode === 'join' ? 0 : enqueueAll(d);
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

/** @param {string | null | undefined} iso */
function ms(iso) {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(n) ? n : -1;
}

/**
 * Отправка: все изменения из журнала — в облако пачками (upsert). После успешной
 * отправки записи журнала снимаются, если за это время не изменились снова.
 * @param {import('./sync-config.js').SyncConfig} cfg
 * @param {IDBDatabase} db
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<number>} — сколько записей отправлено
 */
export async function push(cfg, db, fetchFn = fetch) {
  /** @type {{ id: string, store: string, key: string, deleted: boolean, updatedAt: string }[]} */
  const changes = await getAll(db, 'changes');
  let sent = 0;
  for (let i = 0; i < changes.length; i += BATCH) {
    const part = changes.slice(i, i + BATCH);
    const rows = [];
    for (const ch of part) {
      const rec = ch.deleted ? undefined : await getOne(db, ch.store, ch.key);
      const deleted = ch.deleted || !rec;
      rows.push({
        family: cfg.family,
        store: ch.store,
        id: String(ch.key),
        data: deleted ? null : rec,
        updated_at: deleted ? ch.updatedAt : rec.updatedAt ?? ch.updatedAt,
        deleted,
      });
    }
    await request(cfg, '?on_conflict=family,store,id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    }, fetchFn);
    for (const ch of part) {
      const now = await getOne(db, 'changes', ch.id);
      if (now && now.updatedAt === ch.updatedAt && now.deleted === ch.deleted) await remove(db, 'changes', ch.id, { raw: true });
    }
    sent += part.length;
  }
  return sent;
}

/**
 * Применяет одну запись из облака, если она новее местной (и новее местного
 * неотправленного изменения). Возвращает true, если что-то изменилось.
 * @param {IDBDatabase} db
 * @param {{ store: string, id: string, data: any, updated_at: string, deleted: boolean }} row
 */
export async function applyRemote(db, row) {
  const key = row.id;
  const local = await getOne(db, row.store, key);
  const pending = await getOne(db, 'changes', `${row.store}:${key}`);
  const remoteTs = ms(row.updated_at);
  if (Math.max(ms(local?.updatedAt), ms(pending?.updatedAt)) >= remoteTs) return false;
  if (row.deleted) {
    if (!local) return false;
    await remove(db, row.store, key, { raw: true });
    return true;
  }
  if (!row.data || typeof row.data !== 'object') return false;
  const keyField = row.store === 'settings' ? 'key' : row.store === 'rates' ? 'date' : 'id';
  await put(db, row.store, { ...row.data, [keyField]: row.data[keyField] ?? key, updatedAt: row.data.updatedAt ?? row.updated_at }, { raw: true });
  return true;
}

/**
 * Получение: записи семьи, изменённые после сохранённой отметки, страницами.
 * @param {import('./sync-config.js').SyncConfig} cfg
 * @param {IDBDatabase} db
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<{ applied: number, cursor: string | null }>}
 */
export async function pull(cfg, db, fetchFn = fetch) {
  let cursor = cfg.cursor ?? null;
  let applied = 0;
  for (;;) {
    const q = `?select=store,id,data,updated_at,deleted${cursor ? `&updated_at=gt.${encodeURIComponent(cursor)}` : ''}&order=updated_at.asc,store.asc,id.asc&limit=${PAGE}`;
    const res = await request(cfg, q, {}, fetchFn);
    /** @type {any[]} */
    const rows = await res.json();
    for (const row of rows) {
      if (await applyRemote(db, row)) applied++;
    }
    if (rows.length) cursor = rows[rows.length - 1].updated_at;
    if (rows.length < PAGE) break;
  }
  return { applied, cursor };
}

let running = false;
let again = false;

/**
 * Один обмен: сначала получить, затем отправить. Ошибка сохраняется в настройке
 * и показывается на экране «Общие данные»; очередь при ошибке не теряется.
 * @param {{ db?: IDBDatabase, fetchFn?: typeof fetch }} [opts]
 * @returns {Promise<{ applied: number, sent: number } | null>} — null, если обмен не нужен или уже идёт
 */
export async function syncNow(opts = {}) {
  const db = opts.db ?? (await getDb());
  const cfg = await getSyncConfig(db);
  if (!cfg) return null;
  if (running) {
    again = true;
    return null;
  }
  running = true;
  try {
    const { applied, cursor } = await pull(cfg, db, opts.fetchFn);
    const sent = await push(cfg, db, opts.fetchFn);
    await setSetting(SYNC_KEY, { ...cfg, cursor, lastAt: new Date().toISOString(), lastError: null }, db);
    if (applied && !opts.db) await rerender();
    return { applied, sent };
  } catch (err) {
    await setSetting(SYNC_KEY, { ...cfg, lastError: err instanceof Error ? err.message : String(err) }, db);
    throw err;
  } finally {
    running = false;
    if (again) {
      again = false;
      setTimeout(() => syncNow(opts).catch(() => {}), 500);
    }
  }
}

/** @type {ReturnType<typeof setTimeout> | null} */
let debounce = null;

/**
 * Запуск обмена по событиям: при открытии, через 2 с после любой записи,
 * при появлении сети, при возврате в приложение и раз в 5 минут.
 */
export function startSync() {
  const run = () => syncNow().catch(() => {});
  setChangeListener(() => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(run, 2000);
  });
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') run();
  });
  setInterval(run, 5 * 60 * 1000);
  run();
}
