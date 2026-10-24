import { test, assert } from './runner.js';
import { monthEvents } from '../src/calendar-events.js';

const T = 100;
/** @param {string} month @param {number} tenge */
const line = (month, tenge) => ({ id: `${month}:sal`, month, categoryId: 'sal', planned: 1, limit: null, plannedCurrency: /** @type {'KZT'} */ ('KZT'), plannedOriginal: tenge * T, repeat: true, updatedAt: '' });
/** @param {object} extra */
const cat = (extra) => /** @type {any} */ ({ id: 'sal', name: 'Зарплата', kind: 'income', archived: false, order: 0, createdAt: '', employer: 'Freedom', payDay: null, payNextMonth: false, ...extra });

test('календарь: выплата зарплаты — в день по сроку источника', () => {
  const lines = [line('2026-10', 615000)];
  // Платят 10-го числа следующего месяца: в ноябре — за октябрь
  const next = monthEvents({ month: '2026-11', upcoming: [], planned: [], debts: [], sources: [{ category: cat({ payDay: 10, payNextMonth: true }), lines }] });
  assert.equal(next.dated.length, 1);
  assert.equal(next.dated[0].date, '2026-11-10');
  assert.equal(next.dated[0].sub, 'за октябрь');
  assert.equal(next.dated[0].amount, 615000 * T);
  assert.equal(next.dated[0].name, 'Зарплата · Freedom');
  // Платят 25-го в том же месяце
  const same = monthEvents({ month: '2026-11', upcoming: [], planned: [], debts: [], sources: [{ category: cat({ payDay: 25 }), lines }] });
  assert.deepEqual(same.dated.map((e) => e.date), ['2026-11-25'], 'только за ноябрь, за октябрь срок был в октябре');
  // Без дня выплаты — «в течение месяца»
  const noDay = monthEvents({ month: '2026-11', upcoming: [], planned: [], debts: [], sources: [{ category: cat({}), lines }] });
  assert.equal(noDay.dated.length, 0);
  assert.equal(noDay.undated[0].sub, 'день выплаты не указан');
  // До первого плана — ничего
  const before = monthEvents({ month: '2026-09', upcoming: [], planned: [], debts: [], sources: [{ category: cat({ payDay: 10 }), lines }] });
  assert.equal(before.dated.length + before.undated.length, 0);
});

test('календарь: разовые без даты, долги, платежи — по датам', () => {
  const planned = /** @type {any[]} */ ([
    { id: 'p1', name: 'Тренинг', type: 'income', amount: 1_800_000 * T, currency: 'KZT', date: '2026-11-01', dateKind: 'month', done: false },
    { id: 'p2', name: 'Получено уже', type: 'income', amount: 1, currency: 'KZT', date: '2026-11-01', dateKind: 'month', done: true },
  ]);
  const upcoming = /** @type {any[]} */ ([
    { date: '2026-11-15', name: 'Интернет', type: 'expense', amount: 9000 * T, currency: 'KZT', categoryId: 'x', source: 'recurring', refId: 'r1' },
  ]);
  const debts = /** @type {any[]} */ ([
    { debt: { id: 'd1', person: 'Айгерим', currency: 'KZT', dueDate: '2026-11-05' }, remaining: 50000 * T },
    { debt: { id: 'd2', person: 'Закрыт', currency: 'KZT', dueDate: '2026-11-06' }, remaining: 0 },
    { debt: { id: 'd3', person: 'Декабрь', currency: 'KZT', dueDate: '2026-12-01' }, remaining: 10 },
  ]);
  const r = monthEvents({ month: '2026-11', upcoming, planned, debts, sources: [] });
  assert.deepEqual(r.dated.map((e) => e.name), ['Вернуть: Айгерим', 'Интернет'], 'по датам; закрытый и чужой месяц не попадают');
  assert.equal(r.dated[0].type, 'expense');
  assert.equal(r.dated[0].href, '#/debts/d1');
  assert.deepEqual(r.undated.map((e) => e.name), ['Тренинг'], 'полученные не показываются');
});
