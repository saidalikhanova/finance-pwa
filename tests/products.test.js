import { test, assert } from './runner.js';
import { catalogStats, productReport, priceHistory, groupByCategory, unitPrice } from '../src/products-stats.js';
import { buildItemsCsv, buildAnalysisPrompt, CSV_COLUMNS } from '../src/csv.js';
import { openDatabase, deleteDatabase } from '../src/db.js';
import { createOperation, getOperation, deleteOperation } from '../src/repo/operations.js';
import { ensureProducts, mergeProducts, saveProduct, listProducts, setItemWasted, deleteProduct } from '../src/repo/products.js';
import { parseRate } from '../src/money.js';

/** @param {string} date @param {Array<[string, number, string, number, string?]>} items — [название, qty, unit, sum, categoryId] */
const buy = (date, items, extra = {}) => ({
  id: `op-${date}-${Math.random()}`,
  type: 'expense',
  date,
  currency: 'EUR',
  rate: null,
  amountEur: items.reduce((s, i) => s + i[3], 0),
  amount: items.reduce((s, i) => s + i[3], 0),
  categoryId: 'food',
  store: 'Mercadona',
  items: items.map(([name, qty, unit, sum, cat]) => ({ productId: `p:${name.toLowerCase()}`, name, qty, unit, price: 0, sum, categoryId: cat ?? 'food', wasted: 0 })),
  ...extra,
});

const ops = [
  buy('2026-08-05', [['Лук', 1000, 'кг', 120], ['Молоко', 2000, 'л', 200]]),
  buy('2026-09-05', [['Лук', 2000, 'кг', 240], ['Молоко', 2000, 'л', 220], ['Мыло', 1000, 'шт', 350, 'home']]),
  buy('2026-10-03', [['Лук', 1000, 'кг', 130], ['Молоко', 1000, 'л', 110]]),
  buy('2026-10-20', [['Лук', 3000, 'кг', 360], ['Хлеб', 1000, 'шт', 110]]),
];

test('продукты: сводка за месяц, средняя цена, сравнение, избыточная покупка', () => {
  const rows = productReport(ops, '2026-10', { compareMonths: 3, overbuyPercent: 30 });
  assert.deepEqual(rows.map((r) => r.name), ['Лук', 'Молоко', 'Хлеб'], 'по сумме, при равенстве — по названию');
  const onion = rows[0];
  assert.equal(onion.qty, 4000, '1 + 3 кг');
  assert.equal(onion.eur, 490);
  assert.equal(onion.avgPrice, 123, '4,90 € / 4 кг = 1,225 → 1,23 €/кг');
  assert.equal(onion.purchases, 2);
  assert.equal(onion.prevQty, 2000, 'в сентябре 2 кг');
  assert.equal(onion.overbuy, true, '4 кг против среднего 1,5 кг');
  const milk = rows[1];
  assert.equal(milk.overbuy, false, '1 л против среднего 2 л');
  const bread = rows[2];
  assert.equal(bread.prevQty, null, 'раньше не покупали');
  assert.equal(bread.overbuy, false, 'нет базы для сравнения');

  const byQty = productReport(ops, '2026-10', { sort: 'qty' });
  assert.equal(byQty[0].name, 'Лук');
  assert.deepEqual(productReport(ops, '2026-07'), []);
});

test('продукты: отчёт по категориям и история цен', () => {
  const groups = groupByCategory(productReport(ops, '2026-09'));
  assert.deepEqual([...groups.keys()], ['food', 'home']);
  assert.equal(groups.get('food')?.eur, 460);
  assert.equal(groups.get('food')?.products.length, 2);

  const h = priceHistory(ops, 'p:лук');
  assert.equal(h.length, 4);
  assert.equal(h[0].date, '2026-10-20', 'новые сверху');
  assert.equal(h[0].price, 120, 'цена за единицу из суммы: 3,60 / 3 кг');
  assert.equal(h[0].store, 'Mercadona');
  assert.equal(unitPrice(100, 333), 300, '1 € за 0,333 → 3,00 €/ед.');
});

test('экспорт: CSV по позициям и запрос для анализа', () => {
  const csv = buildItemsCsv(ops.slice(0, 1), new Map([['food', 'Продукты']]));
  assert.ok(csv.startsWith('﻿' + CSV_COLUMNS.join(',')), 'BOM и заголовок');
  const lines = csv.trim().split('\n');
  assert.equal(lines.length, 3, 'заголовок + 2 позиции');
  assert.ok(lines[1].startsWith('2026-08-05,Mercadona,Лук,Продукты,1,кг,,1.20,EUR,1.20,,op-'), lines[1]);
  const quoted = buildItemsCsv([buy('2026-08-05', [['Сыр "Гауда", нарезка', 1000, 'уп', 300]])], new Map());
  assert.ok(quoted.includes('"Сыр ""Гауда"", нарезка"'), 'кавычки и запятые экранированы');
  const prompt = buildAnalysisPrompt('Октябрь 2026');
  assert.ok(prompt.includes('Октябрь 2026') && !prompt.includes('Прогноз закупок'));
});

const TEST_DB = 'finance-test-products';
test('продукты (база): переименование, объединение дубликатов, отметка «выброшено»', async () => {
  await deleteDatabase(TEST_DB);
  const db = await openDatabase(TEST_DB);
  const map = await ensureProducts([{ name: 'Лук', unit: 'кг', categoryId: 'food' }, { name: 'Лук репчатый', unit: 'кг', categoryId: 'food' }], db);
  const a = /** @type {any} */ (map.get('лук'));
  const b = /** @type {any} */ (map.get('лук репчатый'));
  const op = await createOperation({ type: 'expense', date: '2026-10-01', currency: 'EUR', items: [
    { productId: a.id, name: 'Лук', qty: 1000, unit: 'кг', price: 0, sum: 100, categoryId: 'food' },
    { productId: b.id, name: 'Лук репчатый', qty: 2000, unit: 'кг', price: 0, sum: 200, categoryId: 'food' },
  ] }, db);

  await saveProduct({ ...b, name: 'Лук жёлтый' }, db);
  assert.equal((await getOperation(op.id, db))?.items[1].name, 'Лук жёлтый', 'название обновлено в позициях');
  await assert.rejects(() => saveProduct({ ...b, name: 'лук' }, db), 'дубликат по названию');

  const n = await mergeProducts(a.id, b.id, db);
  assert.equal(n, 2);
  const merged = await getOperation(op.id, db);
  assert.ok(merged?.items.every((it) => it.productId === b.id && it.name === 'Лук жёлтый'));
  assert.equal((await listProducts(db)).length, 1);
  await assert.rejects(() => mergeProducts(b.id, b.id, db));

  await setItemWasted(op.id, 0, 500, db);
  assert.equal((await getOperation(op.id, db))?.items[0].wasted, 500);
  await assert.rejects(() => setItemWasted(op.id, 0, 5000, db), 'больше, чем куплено');
  db.close();
});

test('справочник: последняя покупка и разброс цены', () => {
  const key = 'p:яйца';
  const stats = catalogStats([
    buy('2026-08-05', [['Яйца', 1000, 'уп', 480]]),
    buy('2026-10-05', [['Яйца', 2000, 'уп', 1050]]),
    buy('2026-09-05', [['Яйца', 1000, 'уп', 500], ['Хлеб', 1000, 'шт', 100]]),
    buy('2026-07-05', [['Яйца', 10000, 'шт', 200]]),
  ]);
  const st = stats.get(key);
  assert.equal(st?.purchases, 4);
  assert.equal(st?.lastDate, '2026-10-05');
  assert.equal(st?.lastQty, 2000);
  assert.equal(st?.lastEur, 1050);
  assert.equal(st?.minPrice, 480, 'покупка в штуках в разброс не входит');
  assert.equal(st?.maxPrice, 525);
  assert.equal(stats.get('p:хлеб')?.minPrice, 100);
});

test('справочник: удалить можно только товар без покупок', async () => {
  await deleteDatabase('finance-test-prod-del');
  const db = await openDatabase('finance-test-prod-del');
  const map = await ensureProducts([{ name: 'Молоко', unit: 'л', categoryId: 'food' }], db);
  const id = /** @type {string} */ (map.get('молоко')?.id);
  const op = await createOperation({ type: 'expense', date: '2026-10-01', currency: 'EUR', items: [{ productId: id, name: 'Молоко', qty: 1000, unit: 'л', price: 100, sum: 100, categoryId: 'food', wasted: 0 }] }, db);
  await assert.rejects(() => deleteProduct(id, db), 'есть покупка');
  await deleteOperation(op.id, db);
  await deleteProduct(id, db);
  assert.deepEqual(await listProducts(db), []);
  db.close();
});
