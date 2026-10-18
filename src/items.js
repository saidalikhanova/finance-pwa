// Позиции покупки (чек). Количество хранится целым числом в тысячных долях
// (1,5 кг → 1500), суммы — в минимальных единицах валюты операции.

import { toEurCents, divRound } from './money.js';

export const UNITS = /** @type {const} */ (['кг', 'г', 'л', 'мл', 'шт', 'уп']);
export const QTY_SCALE = 1000;

/**
 * @typedef {Object} Item
 * @property {string | null} productId
 * @property {string} name
 * @property {number} qty — × QTY_SCALE
 * @property {string} unit
 * @property {number} price — за единицу, в минимальных единицах; 0, если неизвестна
 * @property {number} sum — в минимальных единицах
 * @property {string} categoryId
 * @property {number} wasted — выброшено / не съедено, × QTY_SCALE (этап 8)
 */

/**
 * Разбор количества: «1,5» → 1500, «2» → 2000. null — ошибка.
 * @param {string | number} input
 */
export function parseQty(input) {
  const s = String(input).replace(/\s+/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,3})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const q = Number(whole) * QTY_SCALE + Number(frac.padEnd(3, '0'));
  return Number.isSafeInteger(q) && q > 0 ? q : null;
}

/** @param {number} qty */
export function formatQty(qty) {
  const whole = Math.floor(qty / QTY_SCALE);
  const frac = String(qty % QTY_SCALE).padStart(3, '0').replace(/0+$/, '');
  return frac ? `${whole},${frac}` : String(whole);
}

/**
 * Сумма позиции из цены и количества: цена × qty / 1000, с округлением.
 * @param {number} price
 * @param {number} qty
 */
export function lineSum(price, qty) {
  return divRound(price * qty, QTY_SCALE);
}

/** @param {Item[]} items */
export function itemsTotal(items) {
  return items.reduce((s, it) => s + it.sum, 0);
}

/**
 * Проверяет позиции; возвращает нормализованный список или бросает ошибку.
 * @param {Partial<Item>[]} items
 * @returns {Item[]}
 */
export function normalizeItems(items) {
  return items.map((it, i) => {
    const name = (it.name ?? '').trim();
    if (!name) throw new Error(`Позиция ${i + 1}: не указано название`);
    if (!Number.isSafeInteger(it.qty) || /** @type {number} */ (it.qty) <= 0) throw new Error(`Позиция «${name}»: количество должно быть больше нуля`);
    if (!UNITS.includes(/** @type {any} */ (it.unit))) throw new Error(`Позиция «${name}»: неизвестная единица «${it.unit}»`);
    if (!Number.isSafeInteger(it.sum) || /** @type {number} */ (it.sum) < 0) throw new Error(`Позиция «${name}»: сумма указана неверно`);
    if (!it.categoryId) throw new Error(`Позиция «${name}»: не выбрана категория`);
    const wasted = it.wasted ?? 0;
    if (!Number.isSafeInteger(wasted) || wasted < 0) throw new Error(`Позиция «${name}»: выброшенное количество указано неверно`);
    return {
      productId: it.productId ?? null,
      name,
      qty: /** @type {number} */ (it.qty),
      unit: /** @type {string} */ (it.unit),
      price: Number.isSafeInteger(it.price) && /** @type {number} */ (it.price) >= 0 ? /** @type {number} */ (it.price) : 0,
      sum: /** @type {number} */ (it.sum),
      categoryId: /** @type {string} */ (it.categoryId),
      wasted,
    };
  });
}

/**
 * Распределение суммы операции в евро по категориям.
 * Без позиций — вся сумма на категорию операции. С позициями — по категориям позиций;
 * копеечная разница округления относится на последнюю позицию, чтобы итог
 * совпадал с amountEur операции.
 * @param {{ amountEur: number | null, categoryId: string, currency: 'EUR' | 'KZT', rate: number | null, items?: Item[] }} op
 * @returns {Map<string, number>}
 */
export function categoryAmountsEur(op) {
  /** @type {Map<string, number>} */
  const out = new Map();
  if (op.amountEur == null) return out;
  const items = op.items ?? [];
  if (!items.length) {
    out.set(op.categoryId, op.amountEur);
    return out;
  }
  let allocated = 0;
  items.forEach((it, i) => {
    let eur = toEurCents(it.sum, op.currency, op.rate) ?? 0;
    if (i === items.length - 1) eur = /** @type {number} */ (op.amountEur) - allocated;
    allocated += eur;
    out.set(it.categoryId, (out.get(it.categoryId) ?? 0) + eur);
  });
  return out;
}
