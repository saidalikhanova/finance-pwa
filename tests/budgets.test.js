import { test, assert } from './runner.js';
import { openDatabase, deleteDatabase } from '../src/db.js';
import { getBudget, getBudgetLine, setBudgetLine, copyBudget, listBudgetMonths } from '../src/repo/budgets.js';
import { createOperation, sumByCategory } from '../src/repo/operations.js';
import { parseRate } from '../src/money.js';

const TEST_DB = 'finance-test-budgets';

async function fresh() {
  await deleteDatabase(TEST_DB);
  return openDatabase(TEST_DB);
}

test('бюджет: запись, чтение и удаление строки', async () => {
  const db = await fresh();
  await setBudgetLine('2026-10', 'food', { planned: 30000, limit: 20000 }, db);
  const line = await getBudgetLine('2026-10', 'food', db);
  assert.equal(line?.planned, 30000);
  assert.equal(line?.limit, 20000);

  await setBudgetLine('2026-10', 'food', { planned: null, limit: 25000 }, db);
  assert.equal((await getBudgetLine('2026-10', 'food', db))?.planned, null);

  await setBudgetLine('2026-10', 'food', { planned: null, limit: null }, db);
  assert.equal(await getBudgetLine('2026-10', 'food', db), undefined, 'пустая строка удаляется');

  await assert.rejects(() => setBudgetLine('2026-10', 'food', { limit: -1 }, db), 'отрицательная сумма');
  await assert.rejects(() => setBudgetLine('октябрь', 'food', { limit: 1 }, db), 'неверный месяц');
  db.close();
});

test('бюджет: копирование месяца одним действием', async () => {
  const db = await fresh();
  await setBudgetLine('2026-09', 'food', { planned: 30000, limit: 20000 }, db);
  await setBudgetLine('2026-09', 'rent', { planned: 90000, limit: null }, db);
  await setBudgetLine('2026-09', 'salary', { planned: 250000 }, db);
  // В октябре уже есть строка, которой нет в сентябре — она будет заменена.
  await setBudgetLine('2026-10', 'gifts', { planned: 5000 }, db);

  const n = await copyBudget('2026-09', '2026-10', db);
  assert.equal(n, 3);

  const oct = await getBudget('2026-10', db);
  assert.equal(oct.length, 3, 'старые строки месяца заменены');
  const food = oct.find((l) => l.categoryId === 'food');
  assert.equal(food?.planned, 30000);
  assert.equal(food?.limit, 20000);
  assert.equal(food?.id, '2026-10:food');
  assert.equal(await getBudgetLine('2026-10', 'gifts', db), undefined);

  const sep = await getBudget('2026-09', db);
  assert.equal(sep.length, 3, 'исходный месяц не изменился');

  await assert.rejects(() => copyBudget('2026-08', '2026-10', db), 'пустой источник');
  await assert.rejects(() => copyBudget('2026-09', '2026-09', db), 'тот же месяц');

  assert.deepEqual(await listBudgetMonths(db), ['2026-10', '2026-09']);
  db.close();
});

test('бюджет: факт по категориям за месяц', async () => {
  const db = await fresh();
  const base = { type: 'expense', currency: 'EUR', categoryId: 'food', date: '2026-10-05' };
  await createOperation({ ...base, amount: 1000 }, db);
  await createOperation({ ...base, amount: 2500, date: '2026-10-20' }, db);
  await createOperation({ ...base, amount: 700, categoryId: 'cafe' }, db);
  await createOperation({ ...base, amount: 9999, date: '2026-09-30' }, db);
  await createOperation({ ...base, currency: 'KZT', amount: 10_000_000, rate: parseRate('500'), rateSource: 'manual' }, db);
  await createOperation({ ...base, currency: 'KZT', amount: 500 }, db); // без курса

  const fact = await sumByCategory('2026-10', db);
  assert.equal(fact.get('food'), 1000 + 2500 + 20000, 'евро + тенге по курсу, без курса не учтено');
  assert.equal(fact.get('cafe'), 700);
  assert.equal(fact.get('other'), undefined);
  db.close();
});
