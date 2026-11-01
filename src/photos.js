// Фотографии: сжатие (длинная сторона около 1280 пикселей) и хранение в IndexedDB.

import { getDb, getOne, put, remove } from './db.js';

export const MAX_SIDE = 1280;

/**
 * Сжимает изображение в JPEG с длинной стороной не больше MAX_SIDE.
 * @param {Blob} file
 * @param {number} [maxSide]
 * @returns {Promise<Blob>}
 */
export async function compressImage(file, maxSide = MAX_SIDE) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
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
 * Снимок для распознавания: крупнее обычного, чтобы мелкий шрифт чека остался читаемым.
 * @param {Blob} file
 * @returns {Promise<Blob>}
 */
export function compressForReading(file) {
  return compressImage(file, 2000);
}

/**
 * Склеивает части длинного чека сверху вниз в один снимок для хранения.
 * @param {Blob[]} files
 * @returns {Promise<Blob>}
 */
export async function stitchImages(files) {
  if (files.length === 1) return compressImage(files[0]);
  const WIDTH = 1000;
  const bitmaps = await Promise.all(files.map((f) => createImageBitmap(f)));
  const heights = bitmaps.map((b) => Math.round(b.height * Math.min(1, WIDTH / b.width)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(WIDTH, Math.max(...bitmaps.map((b) => b.width)));
  canvas.height = heights.reduce((a, b) => a + b, 0);
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  let y = 0;
  bitmaps.forEach((b, i) => {
    ctx.drawImage(b, 0, y, Math.round(b.width * Math.min(1, WIDTH / b.width)), heights[i]);
    y += heights[i];
    b.close?.();
  });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Не удалось обработать изображение'))), 'image/jpeg', 0.8);
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
