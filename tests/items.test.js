import { test, assert } from './runner.js';
import { parseQty, formatQty, lineSum, itemsTotal, normalizeItems, categoryAmountsEur } from '../src/items.js';
import { openDatabase, deleteDatabase } from '../src/db.js';
import { createOperation, updateOperation, sumByCategory, listOperations } from '../src/repo/operations.js';
import { parseRate } from '../src/money.js';

test('позиции: количество и сумма строки', () => {
  assert.equal(parseQty('1,5'), 1500);
  assert.equal(parseQty('2'), 2000);
  assert.equal(parseQty('0,25'), 250);
  assert.equal(parseQty('0'), null);
  assert.equal(parseQty('1,2345'), null, 'больше трёх знаков');
  assert.equal(formatQty(1500), '1,5');
  assert.equal(formatQty(2000), '2');
  assert.equal(lineSum(120, 1500), 180, '1,20 € × 1,5 кг = 1,80 €');
  assert.equal(lineSum(333, 3000), 999);
  assert.equal(lineSum(100, 333), 33, '1,00 × 0,333 = 0,333 → 0,33');
});

test('позиции: проверка полей', () => {
  const ok = normalizeItems([{ name: ' Лук ', qty: 2000, unit: 'кг', price: 120, sum: 240, categoryId: 'food' }]);
  assert.equal(ok[0].name, 'Лук');
  assert.equal(ok[0].wasted, 0);
  assert.equal(ok[0].productId, null);
  assert.equal(itemsTotal(ok), 240);
  for (const bad of [
    { name: '', qty: 1000, unit: 'шт', sum: 1, categoryId: 'c' },
    { name: 'x', qty: 0, unit: 'шт', sum: 1, categoryId: 'c' },
    { name: 'x', qty: 1000, unit: 'фунт', sum: 1, categoryId: 'c' },
    { name: 'x', qty: 1000, unit: 'шт', sum: -1, categoryId: 'c' },
    { name: 'x', qty: 1000, unit: 'шт', sum: 1, categoryId: '' },
  ]) {
    let threw = false;
    try {
      normalizeItems([bad]);
    } catch {
      threw = true;
    }
    assert.ok(threw, `должно отклонить ${JSON.stringify(bad)}`);
  }
});

test('позиции: распределение суммы по категориям позиций', () => {
  const simple = categoryAmountsEur({ amountEur: 500, categoryId: 'a', currency: 'EUR', rate: null, items: [] });
  assert.deepEqual([...simple], [['a', 500]]);

  const multi = categoryAmountsEur({
    amountEur: 1000,
    categoryId: 'food',
    currency: 'EUR',
    rate: null,
    items: [
      { name: 'a', qty: 1000, unit: 'шт', price: 0, sum: 600, categoryId: 'food', productId: null, wasted: 0 },
      { name: 'b', qty: 1000, unit: 'шт', price: 0, sum: 300, categoryId: 'home', productId: null, wasted: 0 },
      { name: 'c', qty: 1000, unit: 'шт', price: 0, sum: 100, categoryId: 'food', productId: null, wasted: 0 },
    ],
  });
  assert.deepEqual([...multi].sort(), [['food', 700], ['home', 300]]);

  // Тенге: 3 позиции по 1 ₸ при курсе 3 ₸/€ → 1,00 € в сумме; поштучно 0,33+0,33+0,34
  const kzt = categoryAmountsEur({
    amountEur: 100,
    categoryId: 'a',
    currency: 'KZT',
    rate: parseRate('3'),
    items: ['a', 'b', 'c'].map((c) => ({ name: c, qty: 1000, unit: 'шт', price: 0, sum: 100, categoryId: c, productId: null, wasted: 0 })),
  });
  assert.deepEqual([...kzt], [['a', 33], ['b', 33], ['c', 34]], 'разница округления — на последнюю позицию');
  assert.equal([...kzt.values()].reduce((s, v) => s + v, 0), 100);

  assert.equal(categoryAmountsEur({ amountEur: null, categoryId: 'a', currency: 'KZT', rate: null, items: [] }).size, 0, 'без курса — ничего');
});

const TEST_DB = 'finance-test-items';
test('позиции (база): покупка из позиций с разными категориями — одна операция', async () => {
  await deleteDatabase(TEST_DB);
  const db = await openDatabase(TEST_DB);
  const items = [
    { name: 'Лук', qty: 2000, unit: 'кг', price: 120, sum: 240, categoryId: 'food' },
    { name: 'Мыло', qty: 1000, unit: 'шт', price: 350, sum: 350, categoryId: 'home' },
    { name: 'Хлеб', qty: 1000, unit: 'шт', price: 110, sum: 110, categoryId: 'food' },
  ];
  const op = await createOperation({ type: 'expense', date: '2026-10-18', currency: 'EUR', items, store: 'Mercadona' }, db);
  assert.equal(op.amount, 700, 'сумма операции = сумма позиций');
  assert.equal(op.categoryId, 'food', 'категория операции — первой позиции');
  assert.equal(op.store, 'Mercadona');
  assert.equal(op.items.length, 3);

  await createOperation({ type: 'expense', date: '2026-10-18', currency: 'EUR', amount: 1000, categoryId: 'home' }, db);
  const by = await sumByCategory('2026-10', db);
  assert.equal(by.get('food'), 350, 'лимиты считаются по категориям позиций');
  assert.equal(by.get('home'), 1350);

  const updated = await updateOperation(op.id, { items: items.slice(0, 1) }, db);
  assert.equal(updated.amount, 240, 'при изменении позиций сумма пересчитана');
  assert.equal((await listOperations({}, db)).length, 2);
  db.close();
});
