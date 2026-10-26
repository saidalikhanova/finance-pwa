import { test, assert } from './runner.js';
import { dueDate, expectedStatus, incomeExpectations, whenLabel } from '../src/expected.js';
import { openDatabase, deleteDatabase, MIGRATIONS, put } from '../src/db.js';
import { createPlanned, getPlanned, listPlanned, markReceived, moveToNextMonth, updatePlanned } from '../src/repo/planned.js';
import { createSchedule, generateDue } from '../src/repo/recurring.js';
import { listOperations } from '../src/repo/operations.js';
import { listUpcoming } from '../src/repo/upcoming.js';

/** @param {Partial<any>} o */
const p = (o) => ({ id: 'x', name: 'Тренинг', type: 'income', amount: 50000, currency: 'EUR', categoryId: 'inc', date: '2026-11-01', dateKind: 'month', done: false, ...o });

test('ожидаемый доход: срок и статус', () => {
  assert.equal(dueDate(p({})), '2026-11-30', '«в ноябре» — до конца месяца');
  assert.equal(dueDate(p({ dateKind: 'day', date: '2026-11-10' })), '2026-11-10');
  assert.deepEqual(expectedStatus(p({}), '2026-11-30'), { status: 'expected', daysLate: 0 }, 'последний день месяца ещё ожидается');
  assert.deepEqual(expectedStatus(p({}), '2026-12-03'), { status: 'overdue', daysLate: 3 });
  assert.deepEqual(expectedStatus(p({ dateKind: 'day', date: '2026-11-10' }), '2026-11-15'), { status: 'overdue', daysLate: 5 });
  assert.equal(expectedStatus(p({ done: true }), '2027-01-01').status, 'received', 'полученное не задерживается');
  assert.equal(whenLabel(p({ date: `${new Date().getFullYear()}-11-01` }), (d) => d), 'в ноябре');
  assert.equal(whenLabel(p({ date: `${new Date().getFullYear()}-05-01` }), (d) => d), 'в мае');
  assert.equal(whenLabel(p({ date: `${new Date().getFullYear()}-03-01` }), (d) => d), 'в марте');
});

test('ожидаемый доход: план, ожидается и неизвестный курс', () => {
  const items = [
    p({ id: 'a', amount: 50000, categoryId: 'train' }),
    p({ id: 'b', amount: 30000, categoryId: 'train', done: true }),
    p({ id: 'c', amount: 180000, categoryId: 'salary', dateKind: 'day', date: '2026-11-05' }),
    p({ id: 'd', currency: 'KZT', amount: 10_000_000, categoryId: 'salary' }),
    p({ id: 'e', date: '2026-12-01' }),
    p({ id: 'f', type: 'expense', amount: 999 }),
  ];
  const withRate = incomeExpectations(items, '2026-11', (x) => (x.currency === 'EUR' ? x.amount : 20000));
  assert.equal(withRate.planned, 50000 + 30000 + 180000 + 20000);
  assert.equal(withRate.pending, 50000 + 180000 + 20000, 'полученное не входит в «ожидается»');
  assert.deepEqual(withRate.byCategory.get('train'), { planned: 80000, pending: 50000 });
  const noRate = incomeExpectations(items, '2026-11', (x) => (x.currency === 'EUR' ? x.amount : null));
  assert.equal(noRate.unknown, 1);
  assert.equal(noRate.planned, 260000);
});

const TEST_DB = 'finance-test-expected';
async function fresh() {
  await deleteDatabase(TEST_DB);
  return openDatabase(TEST_DB);
}

test('ожидаемый доход (база): создание «в ноябре», получение, перенос', async () => {
  const db = await fresh();
  const a = await createPlanned({ name: 'Тренинг', type: 'income', amount: 500_000_00, currency: 'KZT', categoryId: 'inc', dateKind: 'month', date: '2026-11' }, db);
  assert.equal(a.date, '2026-11-01');
  assert.equal(a.dateKind, 'month');

  const moved = await moveToNextMonth(a.id, db);
  assert.equal(moved.date, '2026-12-01');
  assert.equal(moved.movedFrom, '2026-11');
  const moved2 = await moveToNextMonth(a.id, db);
  assert.equal(moved2.movedFrom, '2026-11', 'запоминается первый месяц');

  const got = await markReceived(a.id, { operationId: 'op1', date: '2027-01-08', amount: 450_000_00 }, db);
  assert.equal(got.done, true);
  assert.equal(got.receivedAmount, 450_000_00, 'фактическая сумма может отличаться');
  assert.equal(got.receivedDate, '2027-01-08');
  await assert.rejects(() => moveToNextMonth(a.id, db), 'полученное не переносится');

  assert.equal((await listPlanned({ type: 'income' }, db)).length, 0, 'полученные скрыты по умолчанию');
  assert.equal((await listPlanned({ type: 'income', includeDone: true }, db)).length, 1);
  await assert.rejects(() => createPlanned({ name: 'x', type: 'income', amount: 1, currency: 'EUR', categoryId: 'c', dateKind: 'month', date: '' }, db), 'без месяца');
  const edited = await updatePlanned(a.id, { dateKind: 'day', date: '2027-01-08' }, db);
  assert.equal(edited.done, true, 'правка не сбрасывает «получено»');
  db.close();
});

test('ожидаемый доход (база): месячные не попадают в календарь по дням', async () => {
  const db = await fresh();
  await createPlanned({ name: 'Тренинг', type: 'income', amount: 100, currency: 'EUR', categoryId: 'inc', dateKind: 'month', date: '2026-11' }, db);
  await createPlanned({ name: 'Аванс', type: 'income', amount: 100, currency: 'EUR', categoryId: 'inc', dateKind: 'day', date: '2026-11-05' }, db);
  const up = await listUpcoming('2026-11-01', '2026-11-30', db);
  assert.deepEqual(up.map((u) => u.name), ['Аванс']);
  db.close();
});

test('зарплата «ждать подтверждения»: создаётся ожидаемое поступление, а не операция', async () => {
  const db = await fresh();
  await createSchedule({ name: 'Зарплата', type: 'income', amount: 180000, currency: 'EUR', categoryId: 'salary', period: 'monthly', startDate: '2026-09-05', confirm: true }, db);
  await createSchedule({ name: 'Аренда', type: 'expense', amount: 90000, currency: 'EUR', categoryId: 'rent', period: 'monthly', startDate: '2026-09-01' }, db);
  assert.equal(await generateDue('2026-10-18', db), 4, 'зарплата за сентябрь и октябрь + аренда за 2 месяца');

  const ops = await listOperations({}, db);
  assert.deepEqual(ops.map((o) => o.type), ['expense', 'expense'], 'расход без подтверждения записывается сам');
  const pending = await listPlanned({ type: 'income' }, db);
  assert.deepEqual(pending.map((x) => x.date), ['2026-09-05', '2026-10-05']);
  assert.ok(pending.every((x) => x.recurringId), 'связаны с расписанием');

  const up = await listUpcoming('2026-10-01', '2026-11-30', db);
  assert.deepEqual(up.filter((u) => u.name === 'Зарплата').map((u) => u.date), ['2026-10-05', '2026-11-05'], 'без дублей: октябрь из ожидаемых, ноябрь из расписания');
  assert.equal(await generateDue('2026-10-18', db), 0, 'повторный запуск не дублирует');
  db.close();
});

test('миграция 7: старым разовым платежам проставляется точная дата', async () => {
  await deleteDatabase(TEST_DB);
  let db = await openDatabase(TEST_DB, MIGRATIONS.filter((m) => m.version <= 6));
  await put(db, 'planned', { id: 'old', name: 'Страховка', type: 'expense', amount: 100, currency: 'EUR', categoryId: 'c', date: '2026-11-10', done: false, operationId: null, createdAt: '' });
  db.close();
  db = await openDatabase(TEST_DB);
  const old = await getPlanned('old', db);
  assert.equal(old?.dateKind, 'day');
  assert.equal(old?.movedFrom, null);
  assert.equal(old?.name, 'Страховка', 'данные сохранены');
  db.close();
});
