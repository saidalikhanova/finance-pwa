import { getDb } from '../db.js';
import { createOperation } from './operations.js';
import { ensureProducts } from './products.js';
import { suggestRate } from './rates.js';

/**
 * Создаёт операции из подтверждённых покупок. Новые продукты добавляются
 * в справочник (если addProducts), позиции получают productId.
 * @param {import('../chat-import.js').ParsedPurchase[]} purchases
 * @param {{ addProducts: boolean }} opts
 * @param {IDBDatabase} [db]
 * @returns {Promise<{ operations: number, newProducts: number }>}
 */
export async function applyImport(purchases, opts, db) {
  const d = db ?? (await getDb());
  for (const p of purchases) {
    for (const it of p.items) {
      if (!it.categoryId) throw new Error(`«${it.name}»: не выбрана категория`);
    }
  }

  const before = opts.addProducts ? (await ensureProducts([], d)).size : 0;
  const products = opts.addProducts
    ? await ensureProducts(purchases.flatMap((p) => p.items.map((it) => ({ name: it.name, unit: it.unit, categoryId: it.categoryId }))), d)
    : await ensureProducts([], d);

  let operations = 0;
  for (const p of purchases) {
    const rate = p.currency === 'KZT' ? (await suggestRate(p.date, d))?.rate ?? null : null;
    await createOperation(
      {
        type: 'expense',
        date: p.date,
        currency: p.currency,
        rate,
        rateSource: rate ? 'manual' : null,
        store: p.store,
        comment: p.comment || p.store,
        items: p.items.map((it) => ({
          productId: products.get(it.name.trim().toLowerCase())?.id ?? null,
          name: it.name,
          qty: it.qty,
          unit: it.unit,
          price: it.price,
          sum: it.sum,
          categoryId: it.categoryId,
          wasted: 0,
        })),
      },
      d,
    );
    operations++;
  }
  return { operations, newProducts: opts.addProducts ? products.size - before : 0 };
}
