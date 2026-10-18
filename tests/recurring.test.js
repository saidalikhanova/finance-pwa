import { test, assert } from './runner.js';
import { nthDate, occurrences, dueOccurrences, nextOccurrence, remaining, isExhausted } from '../src/recurring.js';
import { addMonthsKeepDay, addDays, diffDays, weekdayMon0 } from '../src/dates.js';
import { openDatabase, deleteDatabase } from '../src/db.js';
import { createSchedule, updateSchedule, setScheduleStatus, generateDue, getSchedule, listSchedules } from '../src/repo/recurring.js';
import { listOperations } from '../src/repo/operations.js';
import { saveRate } from '../src/repo/rates.js';
import { parseRate } from '../src/money.js';

/** @param {Partial<any>} o */
const sched = (o = {}) => ({
  id: 's',
  name: 'Аренда',
  type: 'expense',
  amount: 90000,
  currency: 'EUR',
  categoryId: 'rent',
  period: 'monthly',
  intervalDays: 0,
  startDate: '2026-01-31',
  endType: 'none',
  endDate: null,
  count: null,
  status: 'active',
  generatedCount: 0,
  lastGeneratedDate: null,
  createdAt: '',
  updatedAt: '',
  ...o,
});

test('даты: сдвиг месяцев с сохранением дня, конец месяца', () => {
  assert.equal(addMonthsKeepDay('2026-01-31', 1, 31), '2026-02-28');
  assert.equal(addMonthsKeepDay('2026-01-31', 2, 31), '2026-03-31');
  assert.equal(addMonthsKeepDay('2026-11-15', 2, 15), '2027-01-15');
  assert.equal(addMonthsKeepDay('2028-02-29', 12, 29), '2029-02-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(diffDays('2026-10-01', '2026-10-18'), 17);
  assert.equal(weekdayMon0('2026-10-18'), 6, '18 октября 2026 — воскресенье');
});

test('платежи: дата n-го платежа по периодичности', () => {
  assert.equal(nthDate(sched(), 0), '2026-01-31');
  assert.equal(nthDate(sched(), 1), '2026-02-28', 'ежемесячно, в феврале — последний день');
  assert.equal(nthDate(sched(), 3), '2026-04-30');
  assert.equal(nthDate(sched({ period: 'weekly', startDate: '2026-10-05' }), 2), '2026-10-19');
  assert.equal(nthDate(sched({ period: 'yearly', startDate: '2026-03-01' }), 1), '2027-03-01');
  assert.equal(nthDate(sched({ period: 'custom', intervalDays: 10, startDate: '2026-10-01' }), 3), '2026-10-31');
});

test('платежи: список дат с учётом окончания', () => {
  const byCount = sched({ startDate: '2026-01-10', endType: 'count', count: 3 });
  assert.deepEqual(occurrences(byCount, 0, null, '2026-12-31').map((o) => o.date), ['2026-01-10', '2026-02-10', '2026-03-10']);

  const byDate = sched({ startDate: '2026-01-10', endType: 'date', endDate: '2026-03-01' });
  assert.deepEqual(occurrences(byDate, 0, null, '2026-12-31').map((o) => o.date), ['2026-01-10', '2026-02-10']);

  const endless = sched({ startDate: '2026-01-10' });
  assert.equal(occurrences(endless, 0, null, '2026-06-30').length, 6);
  assert.deepEqual(occurrences(endless, 2, '2026-03-10', '2026-05-31').map((o) => o.n), [3, 4], 'с номера и после даты');
  assert.deepEqual(occurrences(endless, 0, null, '2025-12-31'), [], 'до начала — пусто');
});

test('платежи: пропущенные периоды создаются все сразу', () => {
  // Приложение не открывали с 10 января; сегодня 18 октября
  const s = sched({ startDate: '2026-01-10', generatedCount: 1, lastGeneratedDate: '2026-01-10' });
  const due = dueOccurrences(s, '2026-10-18');
  assert.equal(due.length, 9, 'февраль — октябрь');
  assert.equal(due[0].date, '2026-02-10');
  assert.equal(due[8].date, '2026-10-10');
  assert.deepEqual(dueOccurrences({ ...s, status: 'paused' }, '2026-10-18'), [], 'приостановленный не создаёт');
  assert.deepEqual(dueOccurrences(sched({ startDate: '2026-11-01' }), '2026-10-18'), [], 'ещё не начался');
});

test('платежи: следующий платёж, остаток и завершение', () => {
  const credit = sched({ startDate: '2026-01-05', endType: 'count', count: 12, amount: 25000, generatedCount: 10, lastGeneratedDate: '2026-10-05' });
  assert.equal(nextOccurrence(credit, '2026-10-18')?.date, '2026-11-05');
  assert.deepEqual(remaining(credit), { count: 2, amount: 50000 });
  assert.equal(isExhausted(credit), false);
  assert.equal(isExhausted({ ...credit, generatedCount: 12 }), true);
  assert.deepEqual(remaining({ ...credit, generatedCount: 12, status: 'finished' }), { count: 0, amount: 0 });
  assert.equal(nextOccurrence({ ...credit, status: 'finished' }, '2026-10-18'), null);

  assert.equal(remaining(sched()), null, 'бессрочный — остатка нет');
  const untilDate = sched({ startDate: '2026-01-05', endType: 'date', endDate: '2026-12-31', generatedCount: 10 });
  assert.deepEqual(remaining(untilDate), { count: 2, amount: 180000 });
  assert.equal(isExhausted({ ...untilDate, generatedCount: 12 }), true);
});

const TEST_DB = 'finance-test-recurring';
async function fresh() {
  await deleteDatabase(TEST_DB);
  return openDatabase(TEST_DB);
}

test('платежи (база): операции создаются по расписанию, включая пропущенные', async () => {
  const db = await fresh();
  const s = await createSchedule({ name: 'Аренда', type: 'expense', amount: 90000, currency: 'EUR', categoryId: 'rent', period: 'monthly', startDate: '2026-08-01' }, db);
  assert.equal(await generateDue('2026-07-31', db), 0, 'до начала — ничего');
  assert.equal(await generateDue('2026-10-18', db), 3, 'август, сентябрь, октябрь');
  assert.equal(await generateDue('2026-10-18', db), 0, 'повторный запуск не дублирует');

  const ops = await listOperations({}, db);
  assert.equal(ops.length, 3);
  assert.deepEqual(ops.map((o) => o.date), ['2026-10-01', '2026-09-01', '2026-08-01']);
  assert.equal(ops[0].comment, 'Аренда');
  assert.equal(ops[0].recurringId, s.id);
  assert.equal(ops[0].amountEur, 90000);

  const updated = await getSchedule(s.id, db);
  assert.equal(updated?.generatedCount, 3);
  assert.equal(updated?.lastGeneratedDate, '2026-10-01');
  db.close();
});

test('платежи (база): кредит на N платежей завершается, доход в тенге получает курс', async () => {
  const db = await fresh();
  await saveRate('2026-09-01', parseRate('500'), db);
  const credit = await createSchedule({ name: 'Кредит', type: 'expense', amount: 10000, currency: 'EUR', categoryId: 'loan', period: 'monthly', startDate: '2026-09-01', endType: 'count', count: 2 }, db);
  const salary = await createSchedule({ name: 'Зарплата', type: 'income', amount: 10_000_000, currency: 'KZT', categoryId: 'salary', period: 'monthly', startDate: '2026-09-05' }, db);

  assert.equal(await generateDue('2026-12-31', db), 6, '2 платежа кредита + 4 зарплаты');
  assert.equal((await getSchedule(credit.id, db))?.status, 'finished');
  assert.equal((await getSchedule(salary.id, db))?.status, 'active');

  const sal = (await listOperations({ type: 'income' }, db)).find((o) => o.date === '2026-09-05');
  assert.equal(sal?.rate, parseRate('500'), 'курс подставлен из ближайшего известного');
  assert.equal(sal?.amountEur, 20000);
  db.close();
});

test('платежи (база): пауза пропускает периоды, изменение не трогает созданные операции', async () => {
  const db = await fresh();
  const s = await createSchedule({ name: 'Подписка', type: 'expense', amount: 1000, currency: 'EUR', categoryId: 'sub', period: 'monthly', startDate: '2026-01-01' }, db);
  await generateDue('2026-03-15', db); // январь, февраль, март
  await setScheduleStatus(s.id, 'paused', '2026-03-15', db);
  assert.equal(await generateDue('2026-06-15', db), 0, 'на паузе не создаётся');
  await setScheduleStatus(s.id, 'active', '2026-06-15', db);
  assert.equal(await generateDue('2026-06-15', db), 0, 'пропущенные за паузу не создаются');
  assert.equal(await generateDue('2026-07-01', db), 1, 'следующий после возобновления');

  await updateSchedule(s.id, { amount: 1500 }, db);
  const ops = await listOperations({}, db);
  assert.ok(ops.every((o) => o.amount === 1000), 'ранее созданные операции не изменились');
  assert.equal(await generateDue('2026-08-01', db), 1);
  assert.equal((await listOperations({ from: '2026-08-01' }, db))[0].amount, 1500, 'новая сумма — со следующего платежа');

  await setScheduleStatus(s.id, 'finished', '2026-08-01', db);
  assert.equal(await generateDue('2027-01-01', db), 0, 'завершённый не создаёт');
  assert.equal((await listSchedules(db)).length, 1);
  db.close();
});

test('платежи (база): проверка полей', async () => {
  const db = await fresh();
  const base = { name: 'x', type: 'expense', amount: 100, currency: 'EUR', categoryId: 'c', period: 'monthly', startDate: '2026-01-01' };
  await assert.rejects(() => createSchedule({ ...base, name: ' ' }, db), 'пустое название');
  await assert.rejects(() => createSchedule({ ...base, period: 'custom', intervalDays: 0 }, db), 'интервал 0');
  await assert.rejects(() => createSchedule({ ...base, endType: 'date', endDate: '2025-12-31' }, db), 'окончание раньше начала');
  await assert.rejects(() => createSchedule({ ...base, endType: 'count', count: 0 }, db), 'число платежей 0');
  await createSchedule({ ...base, period: 'custom', intervalDays: 14 }, db);
  db.close();
});
