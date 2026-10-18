// Сводки по продуктам и прогноз закупок. Чистые функции над операциями с позициями.
// Количество — × 1000, суммы — в центах евро. Продукт определяется по productId,
// а для позиций без привязки — по названию без учёта регистра.

import { toEurCents, divRound } from './money.js';
import { QTY_SCALE } from './items.js';
import { lastMonths } from './reports.js';

/** @typedef {import('./repo/operations.js').Operation} Operation */
/** @typedef {import('./items.js').Item} Item */

/** Ключ продукта для позиции. @param {Item} it */
export function productKey(it) {
  return it.productId ?? `name:${it.name.trim().toLowerCase()}`;
}

/**
 * Все позиции расходов с датой, магазином и суммой в евро.
 * @param {Operation[]} ops
 * @returns {{ op: Operation, item: Item, index: number, key: string, eur: number | null }[]}
 */
export function flattenItems(ops) {
  const out = [];
  for (const op of ops) {
    if (op.type !== 'expense' || !op.items?.length) continue;
    op.items.forEach((item, index) => {
      out.push({ op, item, index, key: productKey(item), eur: toEurCents(item.sum, op.currency, op.rate) });
    });
  }
  return out;
}

/**
 * Средняя цена за единицу в центах евро: сумма / количество.
 * @param {number} eur
 * @param {number} qty — × QTY_SCALE
 */
export function unitPrice(eur, qty) {
  return qty > 0 ? divRound(eur * QTY_SCALE, qty) : 0;
}

/**
 * @typedef {Object} ProductRow
 * @property {string} key
 * @property {string} name
 * @property {string} unit
 * @property {string} categoryId
 * @property {number} qty
 * @property {number} eur
 * @property {number} purchases — число позиций
 * @property {number} avgPrice — центы евро за единицу
 * @property {number} wasted
 * @property {number | null} prevQty — количество за предыдущий месяц (null — не покупали)
 * @property {boolean} overbuy — куплено заметно больше среднего за прошлые месяцы
 */

/**
 * Сводка по продуктам за месяц.
 * @param {Operation[]} ops — все операции (для сравнения с прошлыми месяцами)
 * @param {string} month — ГГГГ-ММ
 * @param {{ compareMonths?: number, overbuyPercent?: number, sort?: 'eur' | 'qty' }} [opts]
 * @returns {ProductRow[]}
 */
export function productReport(ops, month, opts = {}) {
  const compareMonths = opts.compareMonths ?? 3;
  const threshold = opts.overbuyPercent ?? 30;
  const prevMonths = lastMonths(compareMonths, month).filter((m) => m !== month);
  const prevMonth = prevMonths[prevMonths.length - 1];

  /** @type {Map<string, ProductRow & { prevTotals: Map<string, number> }>} */
  const rows = new Map();
  for (const f of flattenItems(ops)) {
    const m = f.op.date.slice(0, 7);
    if (m !== month && !prevMonths.includes(m)) continue;
    let r = rows.get(f.key);
    if (!r) {
      r = { key: f.key, name: f.item.name, unit: f.item.unit, categoryId: f.item.categoryId, qty: 0, eur: 0, purchases: 0, avgPrice: 0, wasted: 0, prevQty: null, overbuy: false, prevTotals: new Map() };
      rows.set(f.key, r);
    }
    if (m === month) {
      r.qty += f.item.qty;
      r.eur += f.eur ?? 0;
      r.purchases++;
      r.wasted += f.item.wasted ?? 0;
      r.name = f.item.name;
      r.unit = f.item.unit;
      r.categoryId = f.item.categoryId;
    } else {
      r.prevTotals.set(m, (r.prevTotals.get(m) ?? 0) + f.item.qty);
    }
  }

  const out = [];
  for (const r of rows.values()) {
    if (!r.purchases) continue;
    r.avgPrice = unitPrice(r.eur, r.qty);
    r.prevQty = r.prevTotals.get(prevMonth) ?? null;
    const prevValues = [...r.prevTotals.values()];
    if (prevValues.length) {
      const avgPrev = divRound(prevValues.reduce((a, b) => a + b, 0), prevValues.length);
      r.overbuy = r.qty * 100 > avgPrev * (100 + threshold);
    }
    const { prevTotals, ...row } = r;
    out.push(row);
  }
  const sort = opts.sort ?? 'eur';
  return out.sort((a, b) => (sort === 'qty' ? b.qty - a.qty : b.eur - a.eur) || a.name.localeCompare(b.name, 'ru'));
}

/**
 * История цены продукта: цена за единицу по датам и магазинам, новые сверху.
 * @param {Operation[]} ops
 * @param {string} key
 */
export function priceHistory(ops, key) {
  return flattenItems(ops)
    .filter((f) => f.key === key)
    .map((f) => ({
      date: f.op.date,
      store: f.op.store,
      qty: f.item.qty,
      unit: f.item.unit,
      currency: f.op.currency,
      price: f.item.price || unitPrice(f.item.sum, f.item.qty),
      eurPrice: f.eur == null ? null : unitPrice(f.eur, f.item.qty),
      wasted: f.item.wasted ?? 0,
      operationId: f.op.id,
      index: f.index,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * @typedef {Object} ForecastRow
 * @property {string} key
 * @property {string} name
 * @property {string} unit
 * @property {string} categoryId
 * @property {number} qty — ожидаемое количество на месяц (× QTY_SCALE)
 * @property {number} eur — ориентировочная стоимость
 * @property {number} monthsBought — в скольких месяцах базы покупали
 * @property {string} note — «примерно раз в 2 мес.» для редких продуктов
 */

/**
 * Прогноз закупок на следующий месяц по последним N месяцам.
 * Количество — среднее потребление за месяц (куплено минус выброшено);
 * стоимость — по средней цене за единицу. Для редко покупаемых продуктов
 * указана периодичность.
 * @param {Operation[]} ops
 * @param {{ months: number, endMonth: string }} opts — endMonth — последний месяц базы (обычно текущий)
 * @returns {{ rows: ForecastRow[], months: string[], monthsWithData: number, preliminary: boolean }}
 */
export function forecast(ops, opts) {
  const months = lastMonths(opts.months, opts.endMonth);
  /** @type {Map<string, { name: string, unit: string, categoryId: string, qty: number, wasted: number, eur: number, monthSet: Set<string> }>} */
  const acc = new Map();
  const monthsWithData = new Set();
  for (const f of flattenItems(ops)) {
    const m = f.op.date.slice(0, 7);
    if (!months.includes(m)) continue;
    monthsWithData.add(m);
    let a = acc.get(f.key);
    if (!a) {
      a = { name: f.item.name, unit: f.item.unit, categoryId: f.item.categoryId, qty: 0, wasted: 0, eur: 0, monthSet: new Set() };
      acc.set(f.key, a);
    }
    a.qty += f.item.qty;
    a.wasted += f.item.wasted ?? 0;
    a.eur += f.eur ?? 0;
    a.monthSet.add(m);
    a.name = f.item.name;
    a.unit = f.item.unit;
    a.categoryId = f.item.categoryId;
  }
  const n = months.length;
  /** @type {ForecastRow[]} */
  const rows = [];
  for (const [key, a] of acc) {
    const useful = Math.max(0, a.qty - a.wasted);
    const qty = divRound(useful, n);
    if (qty <= 0) continue;
    const price = unitPrice(a.eur, a.qty);
    const monthsBought = a.monthSet.size;
    let note = '';
    if (monthsBought * 2 < n) {
      const every = Math.round(n / monthsBought);
      note = `примерно раз в ${every} мес.`;
    }
    rows.push({ key, name: a.name, unit: a.unit, categoryId: a.categoryId, qty, eur: divRound(price * qty, QTY_SCALE), monthsBought, note });
  }
  rows.sort((x, y) => y.eur - x.eur || x.name.localeCompare(y.name, 'ru'));
  return { rows, months, monthsWithData: monthsWithData.size, preliminary: monthsWithData.size < 2 };
}

/**
 * Разбивка по категориям с продуктами внутри (для отчёта по категории).
 * @param {ProductRow[]} rows
 * @returns {Map<string, { eur: number, products: ProductRow[] }>}
 */
export function groupByCategory(rows) {
  /** @type {Map<string, { eur: number, products: ProductRow[] }>} */
  const out = new Map();
  for (const r of rows) {
    const g = out.get(r.categoryId) ?? { eur: 0, products: [] };
    g.eur += r.eur;
    g.products.push(r);
    out.set(r.categoryId, g);
  }
  return new Map([...out].sort((a, b) => b[1].eur - a[1].eur));
}
