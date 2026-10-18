import { getDb, getAll, getOne, put, promisify, done } from '../db.js';

/**
 * @typedef {Object} Product
 * @property {string} id
 * @property {string} name
 * @property {string} nameLower
 * @property {string} unit
 * @property {string} categoryId
 * @property {string} createdAt
 */

/** @param {string} s */
export function normalizeName(s) {
  return s.trim().replace(/\s+/g, ' ');
}

/**
 * @param {IDBDatabase} [db]
 * @returns {Promise<Product[]>}
 */
export async function listProducts(db) {
  const d = db ?? (await getDb());
  /** @type {Product[]} */
  const all = await getAll(d, 'products');
  return all.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/**
 * @param {string} name
 * @param {IDBDatabase} [db]
 * @returns {Promise<Product | undefined>}
 */
export async function findProductByName(name, db) {
  const d = db ?? (await getDb());
  return promisify(d.transaction('products').objectStore('products').index('nameLower').get(normalizeName(name).toLowerCase()));
}

/**
 * @param {string} id
 * @param {IDBDatabase} [db]
 * @returns {Promise<Product | undefined>}
 */
export async function getProduct(id, db) {
  const d = db ?? (await getDb());
  return getOne(d, 'products', id);
}

/**
 * Создаёт продукты, которых ещё нет (по названию без учёта регистра).
 * @param {{ name: string, unit: string, categoryId: string }[]} wanted
 * @param {IDBDatabase} [db]
 * @returns {Promise<Map<string, Product>>} — название в нижнем регистре → продукт (включая существующие)
 */
export async function ensureProducts(wanted, db) {
  const d = db ?? (await getDb());
  /** @type {Map<string, Product>} */
  const result = new Map();
  const existing = await listProducts(d);
  for (const p of existing) result.set(p.nameLower, p);

  const tx = d.transaction('products', 'readwrite');
  const store = tx.objectStore('products');
  const now = new Date().toISOString();
  for (const w of wanted) {
    const name = normalizeName(w.name);
    const key = name.toLowerCase();
    if (!name || result.has(key)) continue;
    /** @type {Product} */
    const p = { id: crypto.randomUUID(), name, nameLower: key, unit: w.unit, categoryId: w.categoryId, createdAt: now };
    store.add(p);
    result.set(key, p);
  }
  await done(tx);
  return result;
}

/**
 * @param {Product} product
 * @param {IDBDatabase} [db]
 */
export async function saveProduct(product, db) {
  const d = db ?? (await getDb());
  await put(d, 'products', { ...product, name: normalizeName(product.name), nameLower: normalizeName(product.name).toLowerCase() });
}
