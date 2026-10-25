import { test, assert } from './runner.js';
import { openDatabase, deleteDatabase, MIGRATIONS, put, getAll } from '../src/db.js';
import { listBanks, addBank, renameBank, removeBank } from '../src/repo/banks.js';
import { createSchedule, getSchedule, generateDue } from '../src/repo/recurring.js';
import { listPlanned } from '../src/repo/planned.js';
import { listOperations } from '../src/repo/operations.js';
import { ensureLoanCategory, loanDue, settleLoanPayment, loanPayments } from '../src/repo/loans.js';
import { createOperation } from '../src/repo/operations.js';
import { listUpcoming } from '../src/repo/upcoming.js';
import { loanName, loanPurpose, scheduledInMonth, isLoanCategory } from '../src/loans.js';
import { monthEvents } from '../src/calendar-events.js';

const DB = 'finance-test-loans';
const T = 100;

async function fresh() {
  await deleteDatabase(DB);
  return openDatabase(DB);
}

test('банки: справочник — добавить, без дублей, переименовать вместе с кредитами, убрать', async () => {
  const db = await fresh();
  await addBank(' Kaspi ', db);
  await addBank('Halyk', db);
  await assert.rejects(() => addBank('kaspi', db), 'дубль без учёта регистра');
  await assert.rejects(() => addBank('  ', db), 'пустое название');
  assert.deepEqual(await listBanks(db), ['Halyk', 'Kaspi']);
  const s = await createSchedule({ name: loanName('Kaspi', 'авто'), bank: 'Kaspi', type: 'expense', amount: 45000 * T, currency: 'KZT', categoryId: 'loans', period: 'monthly', startDate: '2026-11-15', endType: 'count', count: 10, confirm: true }, db);
  await renameBank('Kaspi', 'Kaspi Bank', db);
  const r = await getSchedule(s.id, db);
  assert.equal(r?.bank, 'Kaspi Bank', 'у кредита банк переименован');
  assert.equal(r?.name, 'Kaspi Bank · авто');
  await removeBank('Halyk', db);
  assert.deepEqual(await listBanks(db), ['Kaspi Bank']);
  db.close();
});

test('кредит: «Оплачено» вместо автозаписи; у обычных расходов подтверждения нет', async () => {
  const db = await fresh();
  const loan = await createSchedule({ name: 'Кредит Kaspi', bank: 'Kaspi', type: 'expense', amount: 45000 * T, currency: 'KZT', categoryId: 'loans', period: 'monthly', startDate: '2026-10-15', endType: 'count', count: 3, confirm: true }, db);
  const rent = await createSchedule({ name: 'Аренда', type: 'expense', amount: 900_00, currency: 'EUR', categoryId: 'rent', period: 'monthly', startDate: '2026-10-01', confirm: true }, db);
  assert.equal(loan.confirm, true);
  assert.equal(loan.bank, 'Kaspi');
  assert.equal(rent.confirm, false, 'без банка подтверждение у расхода не действует');
  assert.equal(rent.bank, null);
  await generateDue('2026-11-20', db);
  const ops = await listOperations({}, db);
  assert.deepEqual(ops.map((o) => o.comment), ['Аренда', 'Аренда'], 'кредит сам в расходы не попадает');
  const toPay = await listPlanned({ type: 'expense' }, db);
  assert.deepEqual(toPay.map((p) => p.date), ['2026-10-15', '2026-11-15'], 'платежи по кредиту ждут «Оплачено»');
  db.close();
});

test('кредит: название, план месяца по графику, окончание', () => {
  assert.equal(loanName('Kaspi'), 'Кредит Kaspi');
  assert.equal(loanName('Kaspi', ' ипотека '), 'Kaspi · ипотека');
  assert.equal(loanPurpose({ name: 'Kaspi · ипотека', bank: 'Kaspi' }), 'ипотека');
  assert.equal(loanPurpose({ name: 'Кредит Kaspi', bank: 'Kaspi' }), '');
  assert.ok(isLoanCategory({ name: 'Кредиты', kind: 'expense' }));
  const s = /** @type {any} */ ({ id: 'a', type: 'expense', categoryId: 'loans', status: 'active', period: 'monthly', startDate: '2026-10-15', endType: 'count', count: 2, intervalDays: 0, amount: 45000 * T, currency: 'KZT' });
  const paused = { ...s, id: 'b', status: 'paused' };
  assert.equal(scheduledInMonth([s, paused], 'loans', '2026-10').length, 1, 'приостановленный не входит');
  assert.equal(scheduledInMonth([s], 'loans', '2026-11')[0].date, '2026-11-15');
  assert.equal(scheduledInMonth([s], 'loans', '2026-12').length, 0, 'после последнего платежа — нет');
  assert.equal(scheduledInMonth([s], 'other', '2026-10').length, 0);
});

test('кредит в календаре — с подписью «кредит»', () => {
  const upcoming = /** @type {any[]} */ ([{ date: '2026-11-15', name: 'Кредит Kaspi', type: 'expense', amount: 45000 * T, currency: 'KZT', categoryId: 'loans', source: 'recurring', refId: 'a' }]);
  const r = monthEvents({ month: '2026-11', upcoming, planned: [], sources: [], debts: [], loanCategories: ['loans'] });
  assert.equal(r.dated[0].sub, 'кредит');
});

test('миграция 11: «Кредиты» у существующих категорий, банк у платежей', async () => {
  await deleteDatabase(DB);
  let db = await openDatabase(DB, MIGRATIONS.filter((m) => m.version <= 10));
  await put(db, 'categories', { id: 'food', name: 'Продукты', kind: 'expense', archived: false, order: 0, createdAt: '' });
  await put(db, 'recurring', { id: 'r', name: 'Интернет', type: 'expense', amount: 1, currency: 'EUR', categoryId: 'food', period: 'monthly', intervalDays: 0, startDate: '2026-10-01', endType: 'none', endDate: null, count: null, status: 'active', generatedCount: 0, lastGeneratedDate: null, createdAt: '', updatedAt: '' });
  db.close();
  db = await openDatabase(DB);
  const cats = /** @type {any[]} */ (await getAll(db, 'categories'));
  const loans = cats.find((c) => c.name === 'Кредиты');
  assert.ok(loans, 'категория добавлена');
  assert.equal(loans.order, 1, 'в конце списка');
  assert.equal(/** @type {any[]} */ (await getAll(db, 'recurring'))[0].bank, null);
  assert.equal(await ensureLoanCategory(db), loans.id, 'повторно не создаётся');
  db.close();

  await deleteDatabase(DB);
  db = await openDatabase(DB);
  assert.equal((await getAll(db, 'categories')).length, 0, 'новая база: категории придут из списка по умолчанию');
  db.close();
});

test('кредит: сумма кредита (основной долг) сохраняется; миграция 12', async () => {
  const db = await fresh();
  const base = { name: 'Кредит Kaspi', bank: 'Kaspi', type: /** @type {const} */ ('expense'), amount: 45000 * T, currency: /** @type {const} */ ('KZT'), categoryId: 'loans', period: /** @type {const} */ ('monthly'), startDate: '2026-11-15', confirm: true };
  const s = await createSchedule({ ...base, principal: 2_000_000 * T }, db);
  assert.equal(s.principal, 2_000_000 * T);
  assert.equal((await createSchedule({ ...base }, db)).principal, null, 'необязательно');
  await assert.rejects(() => createSchedule({ ...base, principal: -1 }, db), 'не меньше нуля');
  const plain = await createSchedule({ ...base, bank: null, principal: 5 }, db);
  assert.equal(plain.principal, null, 'только у кредитов');
  db.close();

  await deleteDatabase(DB);
  let old = await openDatabase(DB, MIGRATIONS.filter((m) => m.version <= 11));
  await put(old, 'recurring', { id: 'r', name: 'Кредит', bank: 'Kaspi', type: 'expense', amount: 1, currency: 'KZT', categoryId: 'x', period: 'monthly', intervalDays: 0, startDate: '2026-10-01', endType: 'none', endDate: null, count: null, status: 'active', generatedCount: 0, lastGeneratedDate: null, createdAt: '', updatedAt: '' });
  old.close();
  old = await openDatabase(DB);
  assert.equal(/** @type {any[]} */ (await getAll(old, 'recurring'))[0].principal, null);
  old.close();
});

test('кредит: «Оплачено» — заранее, в срок и просроченный; оплата привязана к кредиту', async () => {
  const db = await fresh();
  const loan = await createSchedule({ name: 'Кредит Kaspi', bank: 'Kaspi', type: 'expense', amount: 45000 * T, currency: 'KZT', categoryId: 'loans', period: 'monthly', startDate: '2026-11-15', endType: 'count', count: 2, confirm: true }, db);
  const other = await createSchedule({ name: 'Кредит Halyk', bank: 'Halyk', type: 'expense', amount: 30000 * T, currency: 'KZT', categoryId: 'loans', period: 'monthly', startDate: '2026-11-05', confirm: true }, db);
  const pay = async (/** @type {any} */ s, /** @type {string} */ date) => {
    const due = await loanDue(s, db);
    const op = await createOperation({ type: 'expense', amount: s.amount, currency: 'KZT', date, categoryId: 'loans', comment: s.name, rate: 5000000, recurringId: s.id, scheduledDate: due?.date }, db);
    await settleLoanPayment(s, /** @type {any} */ (due), { operationId: op.id, date, amount: s.amount }, db);
    return due;
  };

  // Заранее: 12 ноября за платёж 15 ноября
  const d1 = await pay(loan, '2026-11-12');
  assert.equal(d1?.date, '2026-11-15');
  let s = await getSchedule(loan.id, db);
  assert.equal(s?.generatedCount, 1);
  assert.equal(await generateDue('2026-11-20', db) >= 0, true);
  assert.equal((await listPlanned({ type: 'expense' }, db)).filter((p) => p.recurringId === loan.id).length, 0, '15-го «к оплате» не появляется — уже оплачено');
  assert.equal((await loanDue(/** @type {any} */ (await getSchedule(loan.id, db)), db))?.date, '2026-12-15', 'следующий — декабрь');
  const up = await listUpcoming('2026-11-01', '2026-11-30', db);
  assert.ok(!up.some((u) => u.name === 'Кредит Kaspi'), 'в календаре ноябрьский платёж больше не висит');

  // Просроченный «к оплате» по другому кредиту закрывается оплатой
  const due2 = await loanDue(/** @type {any} */ (await getSchedule(other.id, db)), db);
  assert.equal(due2?.planned?.date, '2026-11-05', 'создан «к оплате» за 5 ноября');
  await pay(await getSchedule(other.id, db), '2026-11-20');
  assert.equal((await listPlanned({ type: 'expense' }, db)).filter((p) => p.recurringId === other.id).length, 0);

  // Последний платёж по Kaspi — кредит выплачен
  await pay(await getSchedule(loan.id, db), '2026-12-10');
  s = await getSchedule(loan.id, db);
  assert.equal(s?.status, 'finished');
  assert.equal(await loanDue(/** @type {any} */ (s), db), null);

  const history = await loanPayments(loan.id, db);
  assert.deepEqual(history.map((o) => o.date), ['2026-12-10', '2026-11-12'], 'история — только этого кредита, новые сверху');
  assert.deepEqual(history.map((o) => o.scheduledDate), ['2026-12-15', '2026-11-15'], 'видна и дата по графику, и фактическая');
  db.close();
});
