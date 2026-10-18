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
 * Сохраняет продукт; при переименовании обновляет названия в позициях операций.
 * @param {Product} product
 * @param {IDBDatabase} [db]
 */
export async function saveProduct(product, db) {
  const d = db ?? (await getDb());
  const name = normalizeName(product.name);
  if (!name) throw new Error('Укажите название продукта');
  const dup = await findProductByName(name, d);
  if (dup && dup.id !== product.id) throw new Error('Продукт с таким названием уже есть — используйте объединение');
  const tx = d.transaction(['products', 'operations'], 'readwrite');
  tx.objectStore('products').put({ ...product, name, nameLower: name.toLowerCase() });
  await renameInOperations(tx.objectStore('operations'), product.id, product.id, name);
  await done(tx);
}

/**
 * Объединяет дубликаты: все позиции продукта `fromId` переводятся на `intoId`,
 * продукт `fromId` удаляется.
 * @param {string} fromId
 * @param {string} intoId
 * @param {IDBDatabase} [db]
 * @returns {Promise<number>} — число изменённых позиций
 */
export async function mergeProducts(fromId, intoId, db) {
  const d = db ?? (await getDb());
  if (fromId === intoId) throw new Error('Выберите другой продукт');
  const into = await getProduct(intoId, d);
  if (!into || !(await getProduct(fromId, d))) throw new Error('Продукт не найден');
  const tx = d.transaction(['products', 'operations'], 'readwrite');
  const changed = await renameInOperations(tx.objectStore('operations'), fromId, intoId, into.name);
  tx.objectStore('products').delete(fromId);
  await done(tx);
  return changed;
}

/**
 * @param {IDBObjectStore} ops
 * @param {string} fromId
 * @param {string} toId
 * @param {string} name
 */
async function renameInOperations(ops, fromId, toId, name) {
  /** @type {import('./operations.js').Operation[]} */
  const all = await promisify(ops.getAll());
  let changed = 0;
  for (const op of all) {
    if (!op.items?.some((it) => it.productId === fromId)) continue;
    const items = op.items.map((it) => (it.productId === fromId ? { ...it, productId: toId, name } : it));
    ops.put({ ...op, items });
    changed += items.filter((it) => it.productId === toId).length;
  }
  return changed;
}

/**
 * Отметка «выброшено / не съедено» у позиции операции.
 * @param {string} operationId
 * @param {number} index
 * @param {number} wasted — × 1000
 * @param {IDBDatabase} [db]
 */
export async function setItemWasted(operationId, index, wasted, db) {
  const d = db ?? (await getDb());
  if (!Number.isSafeInteger(wasted) || wasted < 0) throw new Error('Количество указано неверно');
  const op = await getOne(d, 'operations', operationId);
  if (!op || !op.items?.[index]) throw new Error('Позиция не найдена');
  if (wasted > op.items[index].qty) throw new Error('Нельзя выбросить больше, чем куплено');
  const items = op.items.map((/** @type {any} */ it, /** @type {number} */ i) => (i === index ? { ...it, wasted } : it));
  await put(d, 'operations', { ...op, items, updatedAt: new Date().toISOString() });
}
