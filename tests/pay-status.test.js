import { test, assert } from './runner.js';
import { payStatus, markLabel } from '../src/pay-status.js';
import { monthEvents } from '../src/calendar-events.js';

test('статусы платежей: ожидается, срок сегодня, просрочено, оплачено / получено', () => {
  const t = '2026-11-10';
  assert.equal(payStatus({ date: '2026-11-15', type: 'expense' }, t).kind, 'upcoming');
  assert.equal(payStatus({ date: '2026-11-10', type: 'expense' }, t).text, 'срок сегодня');
  const late = payStatus({ date: '2026-11-05', type: 'expense' }, t);
  assert.equal(late.kind, 'overdue');
  assert.equal(late.daysLate, 5);
  assert.ok(late.text.startsWith('просрочено 5 дн.'));
  assert.equal(payStatus({ date: null, type: 'income' }, t).text, 'в течение месяца');
  assert.ok(payStatus({ date: '2026-11-01', type: 'income', done: true, doneDate: '2026-11-03' }, t).text.startsWith('получено'));
  assert.ok(payStatus({ date: '2026-11-01', type: 'expense', done: true, doneDate: '2026-11-03' }, t).text.startsWith('оплачено'));
  assert.equal(markLabel('expense'), 'Оплатила');
  assert.equal(markLabel('income'), 'Получила');
});

test('платежи: у каждого события — куда ведёт отметка', () => {
  const upcoming = /** @type {any[]} */ ([
    { date: '2026-11-15', name: 'Кредит', type: 'expense', amount: 1, currency: 'KZT', categoryId: 'l', source: 'recurring', refId: 'r1', confirm: true },
    { date: '2026-11-01', name: 'Интернет', type: 'expense', amount: 1, currency: 'KZT', categoryId: 'n', source: 'recurring', refId: 'r2', confirm: false },
    { date: '2026-11-20', name: 'Налог', type: 'expense', amount: 1, currency: 'EUR', categoryId: 'x', source: 'planned', refId: 'p1', confirm: true },
  ]);
  const r = monthEvents({ month: '2026-11', upcoming, planned: [], sources: [], debts: [{ debt: /** @type {any} */ ({ id: 'd', person: 'А', currency: 'KZT', dueDate: '2026-11-05' }), remaining: 5 }] });
  const by = Object.fromEntries(r.dated.map((e) => [e.name, e.pay]));
  assert.equal(by['Кредит'], '#/operations/new?loan=r1', 'с подтверждением — отметить оплату');
  assert.equal(by['Интернет'], null, 'без подтверждения запишется сам');
  assert.equal(by['Налог'], '#/operations/new?planned=p1');
  assert.equal(by['Вернуть: А'], '#/debts/d');
});

test('платежи: полученная зарплата месяца в список не попадает', () => {
  const T = 100;
  const line = { id: '2026-10:sal', month: '2026-10', categoryId: 'sal', planned: 1, limit: null, plannedCurrency: 'KZT', plannedOriginal: 615000 * T, repeat: true, updatedAt: '' };
  const cat = /** @type {any} */ ({ id: 'sal', name: 'Зарплата', kind: 'income', employer: 'Freedom', payDay: 10, payNextMonth: true });
  const open = monthEvents({ month: '2026-11', upcoming: [], planned: [], debts: [], sources: [{ category: cat, lines: [line] }] });
  assert.equal(open.dated.length, 1, 'не получена — в списке');
  const done = monthEvents({ month: '2026-11', upcoming: [], planned: [], debts: [], sources: [{ category: cat, lines: [line], settled: true }] });
  assert.equal(done.dated.length + done.undated.length, 0, 'получена — скрыта');
});
