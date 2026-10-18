// Фотографии: сжатие (длинная сторона около 1280 пикселей) и хранение в IndexedDB.

import { getDb, getOne, put, remove } from './db.js';

export const MAX_SIDE = 1280;

/**
 * Сжимает изображение в JPEG с длинной стороной не больше MAX_SIDE.
 * @param {Blob} file
 * @returns {Promise<Blob>}
 */
export async function compressImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Не удалось обработать изображение'))), 'image/jpeg', 0.85);
  });
}

/**
 * Сохраняет фотографию, возвращает её ключ.
 * @param {Blob} blob
 * @param {IDBDatabase} [db]
 */
export async function savePhoto(blob, db) {
  const d = db ?? (await getDb());
  const id = crypto.randomUUID();
  await put(d, 'photos', { id, blob, type: blob.type, size: blob.size, createdAt: new Date().toISOString() });
  return id;
}

/**
 * @param {string} id
 * @param {IDBDatabase} [db]
 * @returns {Promise<Blob | undefined>}
 */
export async function getPhoto(id, db) {
  const d = db ?? (await getDb());
  const row = await getOne(d, 'photos', id);
  return row?.blob;
}

/** @param {string} id @param {IDBDatabase} [db] */
export async function deletePhoto(id, db) {
  const d = db ?? (await getDb());
  await remove(d, 'photos', id);
}
