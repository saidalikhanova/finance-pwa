import { test, assert } from './runner.js';
import { openDatabase, deleteDatabase, MIGRATIONS, put, getAll } from '../src/db.js';
import { listBanks, addBank, renameBank, removeBank } from '../src/repo/banks.js';
import { createSchedule, getSchedule, generateDue } from '../src/repo/recurring.js';
import { listPlanned } from '../src/repo/planned.js';
import { listOperations } from '../src/repo/operations.js';
import { ensureLoanCategory } from '../src/repo/loans.js';
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
