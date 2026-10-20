import { test, assert } from './runner.js';
import { effectiveLine, incomeDebt, effectivePlanEur, convert } from '../src/income.js';
import { parseRate } from '../src/money.js';
import { openDatabase, deleteDatabase, MIGRATIONS, put } from '../src/db.js';
import { setBudgetLine, getBudgetLine, listCategoryLines } from '../src/repo/budgets.js';

const T = 100; // 1 ₸ = 100 тиынов
/** @param {string} month @param {number} tenge @param {boolean} [repeat] */
const line = (month, tenge, repeat = true) => ({ id: `${month}:sal`, month, categoryId: 'sal', planned: 1, limit: null, plannedCurrency: 'KZT', plannedOriginal: tenge * T, repeat, updatedAt: '' });
/** @param {string} date @param {number} tenge */
const paid = (date, tenge) => ({ id: date, type: 'income', date, currency: 'KZT', amount: tenge * T, rate: parseRate('500'), amountEur: null, categoryId: 'sal' });

test('доход: план «каждый месяц» переходит в следующие месяцы', () => {
  const lines = [line('2026-11', 600000)];
  assert.equal(effectiveLine(lines, '2026-10'), null, 'до первого плана — нет');
  assert.equal(effectiveLine(lines, '2026-11')?.inherited, false);
  assert.equal(effectiveLine(lines, '2027-01')?.inherited, true);
  assert.equal(effectiveLine(lines, '2027-01')?.line.month, '2026-11');
  const once = [line('2026-11', 600000, false)];
  assert.equal(effectiveLine(once, '2026-12'), null, 'без «каждый месяц» не переходит');
  const changed = [line('2026-11', 600000), line('2027-02', 700000)];
  assert.equal(effectiveLine(changed, '2027-03')?.line.plannedOriginal, 700000 * T, 'новый план действует дальше');
});

test('доход: долг копится, пока не платят (пример пользователя)', () => {
  const lines = [line('2026-11', 600000)];
  assert.equal(incomeDebt({ lines, ops: [], upTo: '2026-11', rateNow: null })?.debt, 600000 * T, 'ноябрь — 600 000');
  assert.equal(incomeDebt({ lines, ops: [], upTo: '2026-12', rateNow: null })?.debt, 1_200_000 * T, 'декабрь — 1 200 000');
  const jan = incomeDebt({ lines, ops: [], upTo: '2027-01', rateNow: null });
  assert.equal(jan?.debt, 1_800_000 * T, 'начало января — 1 800 000');
  assert.equal(jan?.currency, 'KZT');
  assert.deepEqual(jan?.months.map((m) => m.month), ['2026-11', '2026-12', '2027-01']);
  assert.ok(jan?.months[2].inherited, 'январь — план перешёл');
});

test('доход: выплаты уменьшают долг, переплата видна', () => {
  const lines = [line('2026-11', 600000)];
  const part = incomeDebt({ lines, ops: [paid('2026-12-20', 500000)], upTo: '2027-01', rateNow: null });
  assert.equal(part?.debt, 1_300_000 * T);
  assert.equal(part?.received, 500000 * T);
  assert.equal(part?.months[1].received, 500000 * T, 'выплата учтена в месяце, когда пришла');
  const over = incomeDebt({ lines, ops: [paid('2026-11-30', 700000)], upTo: '2026-11', rateNow: null });
  assert.equal(over?.debt, -100000 * T, 'переплата — отрицательный долг');
  const before = incomeDebt({ lines, ops: [paid('2026-10-15', 100000)], upTo: '2026-11', rateNow: null });
  assert.equal(before?.debt, 600000 * T, 'поступления до первого плана не учитываются');
  assert.equal(incomeDebt({ lines: [], ops: [], upTo: '2026-11', rateNow: null }), null, 'без плана долга нет');
});

test('доход: выплата в другой валюте пересчитывается по курсу операции', () => {
  const lines = [line('2026-11', 600000)];
  const eurPay = { id: 'e', type: 'income', date: '2026-11-25', currency: 'EUR', amount: 1000_00, rate: parseRate('500'), amountEur: 1000_00, categoryId: 'sal' };
  const d = incomeDebt({ lines, ops: [eurPay], upTo: '2026-11', rateNow: parseRate('520') });
  assert.equal(d?.received, 500000 * T, '1 000 € × 500 = 500 000 ₸');
  assert.equal(d?.debt, 100000 * T);
  assert.equal(convert(500000 * T, 'KZT', 'EUR', parseRate('500')), 1000_00);
  assert.equal(convert(100, 'KZT', 'EUR', null), null);
  assert.equal(effectivePlanEur(lines, '2027-01', parseRate('500')), 1200_00, 'план в евро для итогов бюджета');
});

const TEST_DB = 'finance-test-income';
test('доход (база): план в тенге с «каждый месяц» сохраняется; миграция 8', async () => {
  await deleteDatabase(TEST_DB);
  let db = await openDatabase(TEST_DB, MIGRATIONS.filter((m) => m.version <= 7));
  await put(db, 'budgets', { id: '2026-09:old', month: '2026-09', categoryId: 'old', planned: 5000, limit: 7000, updatedAt: '' });
  db.close();
  db = await openDatabase(TEST_DB);
  const old = await getBudgetLine('2026-09', 'old', db);
  assert.equal(old?.plannedCurrency, 'EUR', 'старая строка — евро');
  assert.equal(old?.plannedOriginal, 5000);
  assert.equal(old?.repeat, false);
  assert.equal(old?.limit, 7000, 'лимит сохранён');

  await setBudgetLine('2026-11', 'sal', { planned: 1178_91, limit: null, plannedCurrency: 'KZT', plannedOriginal: 600000 * T, repeat: true }, db);
  const [saved] = await listCategoryLines('sal', db);
  assert.equal(saved.plannedCurrency, 'KZT');
  assert.equal(saved.plannedOriginal, 600000 * T);
  assert.equal(saved.repeat, true);
  db.close();
});
