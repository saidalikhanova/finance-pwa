import { test, assert } from './runner.js';
import { debtStatus, totalsByCurrency } from '../src/debts.js';
import { parseRate } from '../src/money.js';
import { openDatabase, deleteDatabase, getAll } from '../src/db.js';
import { createDebt, addBorrow, repay, listRepayments, deleteDebt, getDebt, updateDebt, REPAY_CATEGORY } from '../src/repo/debts.js';
import { listCategories } from '../src/repo/categories.js';
import { listOperations, sumByCategory } from '../src/repo/operations.js';
import { buildBackup, restoreBackup } from '../src/backup.js';

const T = 100;
/** @param {Partial<any>} o */
const debt = (o = {}) => ({ id: 'd1', person: 'Айгуль', currency: 'KZT', borrows: [{ id: 'b', date: '2026-09-01', amount: 300000 * T }], dueDate: null, comment: '', createdAt: '', ...o });
/** @param {number} tenge @param {Partial<any>} [o] */
const back = (tenge, o = {}) => ({ id: Math.random().toString(), type: 'expense', debtId: 'd1', currency: 'KZT', amount: tenge * T, rate: parseRate('500'), date: '2026-10-01', ...o });

test('долги: остаток, частичный возврат, закрытие', () => {
  assert.deepEqual(debtStatus(debt(), [], '2026-10-22', null), { borrowed: 300000 * T, repaid: 0, remaining: 300000 * T, status: 'open', daysLate: 0 });
  const part = debtStatus(debt(), [back(100000), back(50000)], '2026-10-22', null);
  assert.equal(part.remaining, 150000 * T);
  assert.equal(part.repaid, 150000 * T);
  assert.equal(debtStatus(debt(), [back(300000)], '2026-10-22', null).status, 'closed');
  assert.equal(debtStatus(debt(), [back(100000, { debtId: 'other' })], '2026-10-22', null).repaid, 0, 'чужие возвраты не учитываются');
  const two = debtStatus(debt({ borrows: [{ id: 'a', date: '2026-09-01', amount: 300000 * T }, { id: 'b', date: '2026-10-05', amount: 200000 * T }] }), [back(100000)], '2026-10-22', null);
  assert.equal(two.remaining, 400000 * T, 'заняла ещё — долг вырос');
});

test('долги: просрочка и возврат в другой валюте', () => {
  const late = debtStatus(debt({ dueDate: '2026-10-12' }), [], '2026-10-22', null);
  assert.equal(late.status, 'overdue');
  assert.equal(late.daysLate, 10);
  assert.equal(debtStatus(debt({ dueDate: '2026-10-12' }), [back(300000)], '2026-10-22', null).status, 'closed', 'возвращённый не просрочен');
  const eur = debtStatus(debt(), [back(0, { currency: 'EUR', amount: 200_00, rate: parseRate('500') })], '2026-10-22', null);
  assert.equal(eur.repaid, 100000 * T, '200 € по курсу 500 = 100 000 ₸');
  const totals = totalsByCurrency([
    { debt: debt(), st: debtStatus(debt(), [], '2026-10-22', null) },
    { debt: debt({ id: 'd2', currency: 'EUR', borrows: [{ id: 'x', date: '2026-10-01', amount: 500_00 }] }), st: { borrowed: 500_00, repaid: 0, remaining: 500_00, status: 'open', daysLate: 0 } },
  ]);
  assert.equal(totals.get('KZT'), 300000 * T);
  assert.equal(totals.get('EUR'), 500_00);
});

const TEST_DB = 'finance-test-debts';
test('долги (база): возврат записывается расходом «Возврат долгов»', async () => {
  await deleteDatabase(TEST_DB);
  const db = await openDatabase(TEST_DB);
  const d = await createDebt({ person: ' Айгуль ', amount: 300000 * T, currency: 'KZT', date: '2026-09-01', dueDate: '2026-12-01' }, db);
  assert.equal(d.person, 'Айгуль');
  await assert.rejects(() => createDebt({ person: '', amount: 1, currency: 'KZT', date: '2026-09-01' }, db), 'без имени');
  await assert.rejects(() => createDebt({ person: 'x', amount: 0, currency: 'KZT', date: '2026-09-01' }, db), 'нулевая сумма');

  const op = await repay(d.id, { amount: 100000 * T, currency: 'KZT', date: '2026-10-10', rate: parseRate('500') }, db);
  assert.equal(op.type, 'expense');
  assert.equal(op.debtId, d.id);
  assert.equal(op.amountEur, 200_00);
  const cats = await listCategories({ kind: 'expense' }, db);
  const cat = cats.find((c) => c.name === REPAY_CATEGORY);
  assert.ok(cat, 'категория создана');
  assert.equal(op.categoryId, cat?.id);
  await repay(d.id, { amount: 50000 * T, currency: 'KZT', date: '2026-10-15', rate: parseRate('500') }, db);
  assert.equal((await listCategories({ kind: 'expense' }, db)).filter((c) => c.name === REPAY_CATEGORY).length, 1, 'категория не дублируется');
  assert.equal((await sumByCategory('2026-10', db)).get(/** @type {string} */ (cat?.id)), 300_00, 'возвраты — расходы месяца');

  await addBorrow(d.id, { amount: 50000 * T, date: '2026-10-20' }, db);
  const st = debtStatus(/** @type {any} */ (await getDebt(d.id, db)), await listRepayments(db), '2026-10-22', null);
  assert.equal(st.remaining, 200000 * T, '300 + 50 − 150 = 200 тыс.');

  await updateDebt(d.id, { person: 'Айгуль С.', dueDate: null }, db);
  assert.equal((await getDebt(d.id, db))?.dueDate, null);

  // Долги входят в резервную копию
  const backup = await buildBackup(db);
  assert.equal(backup.data.debts.length, 1);
  await deleteDebt(d.id, db);
  assert.equal(await getDebt(d.id, db), undefined);
  assert.ok((await listOperations({}, db)).every((o) => !o.debtId), 'возвраты остались расходами, но отвязаны');
  await restoreBackup(backup, new Map(), db);
  assert.equal((await getAll(db, 'debts')).length, 1, 'восстановлен из копии');
  db.close();
});
