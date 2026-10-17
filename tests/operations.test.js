import { test, assert } from './runner.js';
import { openDatabase, deleteDatabase } from '../src/db.js';
import {
  createOperation,
  updateOperation,
  deleteOperation,
  getOperation,
  listOperations,
  normalizeOperation,
  monthRange,
} from '../src/repo/operations.js';
import { parseRate } from '../src/money.js';

const TEST_DB = 'finance-test-operations';

async function fresh() {
  await deleteDatabase(TEST_DB);
  return openDatabase(TEST_DB);
}

const base = { type: 'expense', amount: 1250, currency: 'EUR', date: '2026-10-05', categoryId: 'cat-1' };

test('операции: проверка полей', () => {
  const ok = normalizeOperation(base);
  assert.equal(ok.amountEur, 1250, 'для евро сумма в евро равна сумме');
  assert.equal(ok.rate, null);
  assert.equal(ok.comment, '');
  assert.deepEqual(ok.items, []);

  assert.ok(throws(() => normalizeOperation({ ...base, amount: 0 })), 'нулевая сумма');
  assert.ok(throws(() => normalizeOperation({ ...base, amount: 12.5 })), 'дробная сумма');
  assert.ok(throws(() => normalizeOperation({ ...base, date: '05.10.2026' })), 'неверная дата');
  assert.ok(throws(() => normalizeOperation({ ...base, categoryId: '' })), 'нет категории');
  assert.ok(throws(() => normalizeOperation({ ...base, currency: 'USD' })), 'неизвестная валюта');
});

test('операции: тенге с курсом и без', () => {
  const noRate = normalizeOperation({ ...base, currency: 'KZT', amount: 10_000_000 });
  assert.equal(noRate.amountEur, null, 'без курса сумма в евро не определена');
  assert.equal(noRate.rateSource, null);

  const withRate = normalizeOperation({ ...base, currency: 'KZT', amount: 10_000_000, rate: parseRate('500'), rateSource: 'nbk' });
  assert.equal(withRate.amountEur, 20000);
  assert.equal(withRate.rateSource, 'nbk');

  const eurIgnoresRate = normalizeOperation({ ...base, rate: parseRate('500'), rateSource: 'manual' });
  assert.equal(eurIgnoresRate.rate, null, 'для евро курс не хранится');
});

test('операции: создание, изменение, удаление', async () => {
  const db = await fresh();
  const op = await createOperation({ ...base, comment: '  хлеб ' }, db);
  assert.equal(op.comment, 'хлеб');
  assert.ok(op.id && op.createdAt && op.updatedAt);

  const updated = await updateOperation(op.id, { amount: 2000, comment: 'хлеб и молоко' }, db);
  assert.equal(updated.amount, 2000);
  assert.equal(updated.amountEur, 2000);
  assert.equal(updated.comment, 'хлеб и молоко');
  assert.equal(updated.type, 'expense', 'незатронутые поля сохраняются');

  await deleteOperation(op.id, db);
  assert.equal(await getOperation(op.id, db), undefined);
  await assert.rejects(() => updateOperation(op.id, { amount: 1 }, db), 'изменение удалённой операции');
  db.close();
});

test('операции: список с фильтрами по периоду, типу и категории', async () => {
  const db = await fresh();
  await createOperation({ ...base, date: '2026-09-30' }, db);
  await createOperation({ ...base, date: '2026-10-01' }, db);
  await createOperation({ ...base, date: '2026-10-31', categoryId: 'cat-2' }, db);
  await createOperation({ ...base, date: '2026-10-15', type: 'income', categoryId: 'inc-1', amount: 100000 }, db);
  await createOperation({ ...base, date: '2026-11-01' }, db);

  const oct = await listOperations(monthRange('2026-10'), db);
  assert.equal(oct.length, 3);
  assert.deepEqual(
    oct.map((o) => o.date),
    ['2026-10-31', '2026-10-15', '2026-10-01'],
    'новые сверху',
  );

  assert.equal((await listOperations({ ...monthRange('2026-10'), type: 'income' }, db)).length, 1);
  assert.equal((await listOperations({ ...monthRange('2026-10'), categoryId: 'cat-2' }, db)).length, 1);
  assert.equal((await listOperations({ categoryId: 'cat-1' }, db)).length, 3, 'без периода — за всё время');
  assert.equal((await listOperations({}, db)).length, 5);
  db.close();
});

test('операции: границы месяца', () => {
  assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(monthRange('2026-12'), { from: '2026-12-01', to: '2026-12-31' });
});

/** @param {() => unknown} fn */
function throws(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}
