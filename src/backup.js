// Резервная копия: один файл JSON со всеми данными (фотографии — отдельно, в ZIP).
// Формат имеет номер версии; загрузка проверяет структуру и версию до изменения данных.

import { getDb, getAll, promisify, done, SCHEMA_VERSION } from './db.js';
import { zipWrite, zipRead } from './zip.js';

export const BACKUP_FORMAT = 'finance-backup';
export const BACKUP_VERSION = 1;

/** Таблицы в порядке восстановления. Фотографии — отдельно. */
export const DATA_STORES = ['settings', 'categories', 'operations', 'rates', 'budgets', 'recurring', 'planned', 'wishes', 'products', 'debts'];

/** Настройки, которые не переносятся между устройствами. */
const LOCAL_SETTINGS = new Set(['installedAt', 'lastBackupAt', 'shoppingList']);

/**
 * @typedef {Object} Backup
 * @property {string} format
 * @property {number} version
 * @property {number} schemaVersion
 * @property {string} createdAt
 * @property {Record<string, any[]>} data
 * @property {{ count: number, included: boolean }} photos
 */

/**
 * Собирает копию всех данных.
 * @param {IDBDatabase} [db]
 * @returns {Promise<Backup>}
 */
export async function buildBackup(db) {
  const d = db ?? (await getDb());
  /** @type {Record<string, any[]>} */
  const data = {};
  for (const store of DATA_STORES) {
    const rows = await getAll(d, store);
    data[store] = store === 'settings' ? rows.filter((r) => !LOCAL_SETTINGS.has(r.key)) : rows;
  }
  const photoCount = await promisify(d.transaction('photos').objectStore('photos').count());
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString(), data, photos: { count: photoCount, included: false } };
}

/** @param {string} [date] — ГГГГ-ММ-ДД */
export function backupFilename(date = new Date().toISOString().slice(0, 10), ext = 'json') {
  return `finance-backup-${date}.${ext}`;
}

/**
 * Копия с фотографиями: ZIP с backup.json и photos/<id>.jpg.
 * @param {IDBDatabase} [db]
 */
export async function buildBackupZip(db) {
  const d = db ?? (await getDb());
  const backup = await buildBackup(d);
  backup.photos.included = true;
  const photos = await getAll(d, 'photos');
  const entries = [{ name: 'backup.json', data: new TextEncoder().encode(JSON.stringify(backup)) }];
  for (const p of photos) {
    const ext = p.type === 'image/png' ? 'png' : 'jpg';
    entries.push({ name: `photos/${p.id}.${ext}`, data: new Uint8Array(await p.blob.arrayBuffer()) });
  }
  return zipWrite(entries);
}

/**
 * Проверяет структуру и версию файла. Ничего не меняет.
 * @param {unknown} obj
 * @returns {{ ok: boolean, errors: string[], summary: { createdAt: string, counts: Record<string, number>, photos: number, version: number } | null }}
 */
export function validateBackup(obj) {
  /** @type {string[]} */
  const errors = [];
  if (!obj || typeof obj !== 'object') return { ok: false, errors: ['Файл не содержит данных приложения'], summary: null };
  const b = /** @type {any} */ (obj);
  if (b.format !== BACKUP_FORMAT) errors.push('Это не файл резервной копии приложения «Финансы»');
  if (!Number.isInteger(b.version)) errors.push('Не указана версия формата');
  else if (b.version > BACKUP_VERSION) errors.push(`Файл создан более новой версией приложения (формат ${b.version}, поддерживается ${BACKUP_VERSION}). Обновите приложение.`);
  if (!b.data || typeof b.data !== 'object') errors.push('В файле нет раздела data');
  if (errors.length) return { ok: false, errors, summary: null };

  /** @type {Record<string, number>} */
  const counts = {};
  for (const store of DATA_STORES) {
    const rows = b.data[store];
    if (rows == null) {
      counts[store] = 0;
      continue;
    }
    if (!Array.isArray(rows)) {
      errors.push(`Раздел ${store} должен быть списком`);
      continue;
    }
    const keyField = store === 'settings' ? 'key' : store === 'rates' ? 'date' : 'id';
    const bad = rows.findIndex((r) => !r || typeof r !== 'object' || typeof r[keyField] !== 'string');
    if (bad >= 0) errors.push(`Раздел ${store}: запись ${bad + 1} без ключа «${keyField}»`);
    if (store === 'operations') {
      const badOp = rows.findIndex((r) => r && (!Number.isSafeInteger(r.amount) || typeof r.date !== 'string' || (r.type !== 'expense' && r.type !== 'income')));
      if (badOp >= 0) errors.push(`Операция ${badOp + 1} повреждена (сумма, дата или тип)`);
    }
    counts[store] = rows.length;
  }
  const photos = Number(b.photos?.count ?? 0);
  return { ok: !errors.length, errors, summary: errors.length ? null : { createdAt: String(b.createdAt ?? ''), counts, photos, version: b.version } };
}

/**
 * Разбирает файл копии (.json или .zip). Возвращает данные и фотографии из архива.
 * @param {File | Blob} file
 * @returns {Promise<{ backup: unknown, photos: Map<string, { blob: Blob, type: string }> }>}
 */
export async function readBackupFile(file) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  /** @type {Map<string, { blob: Blob, type: string }>} */
  const photos = new Map();
  if (!isZip) {
    const text = await file.text();
    try {
      return { backup: JSON.parse(text.replace(/^﻿/, '')), photos };
    } catch {
      throw new Error('Файл не является корректным JSON');
    }
  }
  const entries = await zipRead(await file.arrayBuffer());
  const json = entries.get('backup.json');
  if (!json) throw new Error('В архиве нет файла backup.json');
  for (const [name, data] of entries) {
    const m = name.match(/^photos\/([^/]+)\.(jpg|jpeg|png)$/i);
    if (!m) continue;
    const type = m[2].toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';
    photos.set(m[1], { blob: new Blob([data], { type }), type });
  }
  return { backup: JSON.parse(new TextDecoder().decode(json)), photos };
}

/**
 * Заменяет все данные содержимым копии. Фотографии: из архива — записываются;
 * без архива — остаются те, на которые ссылаются загруженные записи, остальные удаляются.
 * @param {Backup} backup — уже проверенный validateBackup
 * @param {Map<string, { blob: Blob, type: string }>} photos
 * @param {IDBDatabase} [db]
 * @returns {Promise<Record<string, number>>}
 */
export async function restoreBackup(backup, photos, db) {
  const d = db ?? (await getDb());
  const keep = /** @type {Record<string, any>[]} */ (await getAll(d, 'settings')).filter((r) => LOCAL_SETTINGS.has(r.key) && r.key !== 'shoppingList');

  const tx = d.transaction([...DATA_STORES, 'photos'], 'readwrite');
  /** @type {Record<string, number>} */
  const counts = {};
  for (const store of DATA_STORES) {
    const s = tx.objectStore(store);
    s.clear();
    const rows = backup.data[store] ?? [];
    for (const r of rows) s.put(r);
    counts[store] = rows.length;
  }
  for (const r of keep) tx.objectStore('settings').put(r);

  const ps = tx.objectStore('photos');
  if (photos.size) {
    ps.clear();
    const now = new Date().toISOString();
    for (const [id, p] of photos) ps.put({ id, blob: p.blob, type: p.type, size: p.blob.size, createdAt: now });
    counts.photos = photos.size;
  } else {
    const referenced = new Set();
    for (const r of [...(backup.data.operations ?? []), ...(backup.data.wishes ?? [])]) if (r.photoId) referenced.add(r.photoId);
    const existing = await promisify(ps.getAllKeys());
    let kept = 0;
    for (const key of existing) {
      if (referenced.has(key)) kept++;
      else ps.delete(key);
    }
    counts.photos = kept;
  }
  await done(tx);
  return counts;
}
