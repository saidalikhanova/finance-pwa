import { test, assert } from './runner.js';
import {
  parseAmount,
  formatMoney,
  amountToInput,
  parseRate,
  formatRate,
  divRound,
  toEurCents,
  fromEurCents,
  RATE_SCALE,
} from '../src/money.js';

test('деньги: разбор ввода суммы', () => {
  assert.equal(parseAmount('12,50'), 1250);
  assert.equal(parseAmount('12.5'), 1250);
  assert.equal(parseAmount('12'), 1200);
  assert.equal(parseAmount('1 234,56'), 123456);
  assert.equal(parseAmount('0,01'), 1);
  assert.equal(parseAmount('0'), null, 'ноль не допускается');
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('-5'), null);
  assert.equal(parseAmount('1,234'), null, 'больше двух знаков после запятой');
});

test('деньги: вывод суммы', () => {
  assert.equal(formatMoney(1250, 'EUR'), '12,50 €');
  assert.equal(formatMoney(500000, 'KZT'), '5 000,00 ₸');
  assert.equal(formatMoney(-1250, 'EUR'), '−12,50 €');
  assert.equal(formatMoney(1250, 'EUR', { sign: true }), '+12,50 €');
  assert.equal(formatMoney(5, 'EUR'), '0,05 €');
  assert.equal(amountToInput(1205), '12,05');
});

test('деньги: разбор и вывод курса', () => {
  assert.equal(parseRate('512,34'), 5123400);
  assert.equal(parseRate('500'), 500 * RATE_SCALE);
  assert.equal(parseRate('512,3456'), 5123456);
  assert.equal(parseRate('512,34567'), null, 'больше четырёх знаков');
  assert.equal(parseRate('0'), null);
  assert.equal(formatRate(5123400), '512,34');
  assert.equal(formatRate(500 * RATE_SCALE), '500');
});

test('деньги: целочисленное деление с округлением', () => {
  assert.equal(divRound(10, 4), 3, '2,5 → 3');
  assert.equal(divRound(9, 4), 2, '2,25 → 2');
  assert.equal(divRound(11, 4), 3, '2,75 → 3');
  assert.equal(divRound(0, 7), 0);
  assert.equal(divRound(1_000_000_000_000, 3), 333_333_333_333);
});

test('деньги: пересчёт тенге в евро по курсу', () => {
  // 100 000 ₸ по курсу 500 ₸/€ = 200,00 €
  assert.equal(toEurCents(10_000_000, 'KZT', parseRate('500')), 20000);
  // 512,34 ₸ по курсу 512,34 = ровно 1 €
  assert.equal(toEurCents(51234, 'KZT', parseRate('512,34')), 100);
  // 1 000 000 ₸ по курсу 512,34 = 1951,83 € (1951,8319…)
  assert.equal(toEurCents(100_000_000, 'KZT', parseRate('512,34')), 195183);
  // Евро не пересчитываются
  assert.equal(toEurCents(1250, 'EUR', null), 1250);
  // Без курса сумма в евро неизвестна
  assert.equal(toEurCents(1000, 'KZT', null), null);
});

test('деньги: обратный пересчёт евро в тенге', () => {
  assert.equal(fromEurCents(100, parseRate('512,34')), 51234);
  assert.equal(fromEurCents(20000, parseRate('500')), 10_000_000);
});

test('деньги: сложение сумм не накапливает ошибок', () => {
  // Классическая проблема плавающей запятой: 0,1 + 0,2 ≠ 0,3.
  let total = 0;
  for (let i = 0; i < 1000; i++) total += parseAmount('0,10') ?? 0;
  assert.equal(total, 10000);
  assert.equal(formatMoney(total, 'EUR'), '100,00 €');
});
