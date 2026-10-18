import { test, assert } from './runner.js';
import { summary, expensesByCategory, lastMonths, monthlySeries } from '../src/reports.js';

/** @param {Partial<any>} o */
const op = (o) => ({ type: 'expense', currency: 'EUR', date: '2026-10-05', categoryId: 'food', amountEur: 1000, ...o });

test('отчёты: итоги месяца', () => {
  const s = summary([
    op({ type: 'income', amountEur: 100000 }),
    op({ amountEur: 1500 }),
    op({ amountEur: 2500, categoryId: 'cafe' }),
    op({ currency: 'KZT', amountEur: null }),
  ]);
  assert.equal(s.income, 100000);
  assert.equal(s.expense, 4000);
  assert.equal(s.balance, 96000);
  assert.equal(s.unknownRate, 1);
  assert.deepEqual(summary([]), { income: 0, expense: 0, balance: 0, unknownRate: 0 });
});

test('отчёты: расходы по категориям с долями', () => {
  const cats = new Map([
    ['food', { name: 'Продукты' }],
    ['cafe', { name: 'Кафе' }],
  ]);
  const rows = expensesByCategory(
    [op({ amountEur: 6000 }), op({ amountEur: 1500 }), op({ amountEur: 2500, categoryId: 'cafe' }), op({ type: 'income', amountEur: 99999 }), op({ categoryId: 'gone', amountEur: 0 })],
    cats,
  );
  assert.deepEqual(
    rows.map((r) => [r.name, r.amount, r.share]),
    [
      ['Продукты', 7500, 75],
      ['Кафе', 2500, 25],
      ['Без категории', 0, 0],
    ],
  );
  assert.deepEqual(expensesByCategory([], cats), []);
});

test('отчёты: список последних месяцев', () => {
  assert.deepEqual(lastMonths(3, '2026-10'), ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(lastMonths(2, '2026-01'), ['2025-12', '2026-01']);
  assert.deepEqual(lastMonths(1, '2026-05'), ['2026-05']);
});

test('отчёты: динамика по месяцам', () => {
  const series = monthlySeries(
    [
      op({ date: '2026-08-15', amountEur: 1000 }),
      op({ date: '2026-09-01', type: 'income', amountEur: 5000 }),
      op({ date: '2026-09-30', amountEur: 2000 }),
      op({ date: '2026-09-30', amountEur: null }),
      op({ date: '2026-11-01', amountEur: 7777 }), // вне диапазона
    ],
    lastMonths(3, '2026-10'),
  );
  assert.deepEqual(series, [
    { month: '2026-08', income: 0, expense: 1000, balance: -1000 },
    { month: '2026-09', income: 5000, expense: 2000, balance: 3000 },
    { month: '2026-10', income: 0, expense: 0, balance: 0 },
  ]);
});
