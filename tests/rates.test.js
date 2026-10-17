import { test, assert } from './runner.js';
import { openDatabase, deleteDatabase } from '../src/db.js';
import { getRate, suggestRate, saveRate, listOperationsWithoutRate } from '../src/repo/rates.js';
import { createOperation, getOperation } from '../src/repo/operations.js';
import { parseRate } from '../src/money.js';

const TEST_DB = 'finance-test-rates';

async function fresh() {
  await deleteDatabase(TEST_DB);
  return openDatabase(TEST_DB);
}

const kzt = { type: 'income', currency: 'KZT', amount: 10_000_000, categoryId: 'inc', date: '2026-10-10' };

test('курсы: сохранение и чтение по дате', async () => {
  const db = await fresh();
  assert.equal(await getRate('2026-10-10', db), undefined);
  await saveRate('2026-10-10', parseRate('500'), db);
  const r = await getRate('2026-10-10', db);
  assert.equal(r?.rate, 500 * 10000);
  assert.equal(r?.source, 'manual');

  await saveRate('2026-10-10', parseRate('510'), db);
  assert.equal((await getRate('2026-10-10', db))?.rate, 510 * 10000, 'повторное сохранение заменяет курс');

  await assert.rejects(() => saveRate('2026-10-10', 0, db), 'нулевой курс');
  await assert.rejects(() => saveRate('10.10.2026', 1, db), 'неверная дата');
  db.close();
});

test('курсы: подстановка курса для даты', async () => {
  const db = await fresh();
  assert.equal(await suggestRate('2026-10-10', db), undefined, 'курсов нет');

  await saveRate('2026-10-01', parseRate('500'), db);
  await saveRate('2026-10-15', parseRate('520'), db);

  assert.equal((await suggestRate('2026-10-15', db))?.rate, parseRate('520'), 'точное совпадение даты');
  assert.equal((await suggestRate('2026-10-10', db))?.rate, parseRate('500'), 'ближайший предыдущий');
  assert.equal((await suggestRate('2026-12-31', db))?.rate, parseRate('520'), 'последний известный');
  assert.equal((await suggestRate('2026-09-01', db))?.rate, parseRate('500'), 'раньше всех — самый ранний');
  db.close();
});

test('курсы: применение к операциям без курса за дату', async () => {
  const db = await fresh();
  const a = await createOperation(kzt, db);
  const b = await createOperation({ ...kzt, amount: 5_000_000 }, db);
  const other = await createOperation({ ...kzt, date: '2026-10-11' }, db);
  const withRate = await createOperation({ ...kzt, rate: parseRate('480'), rateSource: 'manual' }, db);
  const eur = await createOperation({ ...kzt, currency: 'EUR', amount: 1000 }, db);

  assert.equal((await listOperationsWithoutRate(db)).length, 3);

  const n = await saveRate('2026-10-10', parseRate('500'), db);
  assert.equal(n, 2, 'курс получили две операции за дату');

  assert.equal((await getOperation(a.id, db))?.amountEur, 20000);
  assert.equal((await getOperation(b.id, db))?.amountEur, 10000);
  assert.equal((await getOperation(other.id, db))?.amountEur, null, 'другая дата не затронута');
  assert.equal((await getOperation(withRate.id, db))?.rate, parseRate('480'), 'заданный курс не перезаписан');
  assert.equal((await getOperation(eur.id, db))?.amountEur, 1000, 'евро не затронуты');

  assert.equal((await listOperationsWithoutRate(db)).length, 1);
  db.close();
});
