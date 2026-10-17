import { test, assert } from './runner.js';
import { daysInMonth, daysLeft, limitStatus, limitMessage, pluralDays } from '../src/limits.js';

test('лимиты: дни месяца и оставшиеся дни', () => {
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2028-02'), 29);
  assert.equal(daysInMonth('2026-10'), 31);

  assert.equal(daysLeft('2026-10', '2026-10-01'), 31, 'первое число — весь месяц');
  assert.equal(daysLeft('2026-10', '2026-10-20'), 12, 'включая сегодня');
  assert.equal(daysLeft('2026-10', '2026-10-31'), 1, 'последний день');
  assert.equal(daysLeft('2026-09', '2026-10-05'), 0, 'прошедший месяц');
  assert.equal(daysLeft('2026-11', '2026-10-05'), 30, 'будущий месяц — все дни');
});

test('лимиты: остаток, процент, уровень предупреждения', () => {
  // Пример из ТЗ: лимит 200 €, потрачено 57 €, 20 октября → 12 дней
  const s = limitStatus(20000, 5700, '2026-10', '2026-10-20');
  assert.equal(s.remaining, 14300);
  assert.equal(s.percent, 29);
  assert.equal(s.level, 'ok');
  assert.equal(s.daysLeft, 12);
  assert.equal(s.perDay, 1192, '143 / 12 = 11,916… → 11,92 €');

  assert.equal(limitStatus(20000, 16000, '2026-10', '2026-10-20').level, 'warn', 'ровно 80 %');
  assert.equal(limitStatus(20000, 15999, '2026-10', '2026-10-20').level, 'ok', 'чуть меньше 80 %');
  assert.equal(limitStatus(20000, 20000, '2026-10', '2026-10-20').level, 'warn', 'ровно 100 % — ещё не превышение');
  const over = limitStatus(20000, 20001, '2026-10', '2026-10-20');
  assert.equal(over.level, 'over');
  assert.equal(over.remaining, -1);
  assert.equal(over.perDay, null);

  assert.equal(limitStatus(20000, 5700, '2026-09', '2026-10-20').perDay, null, 'месяц прошёл — в день не считаем');
  assert.equal(limitStatus(0, 100, '2026-10', '2026-10-20').level, 'over', 'нулевой лимит');
});

test('лимиты: текст сообщения после расхода', () => {
  const s = limitStatus(20000, 5700, '2026-10', '2026-10-20');
  assert.equal(
    limitMessage('Продукты', s),
    'Продукты: осталось 143,00 € из 200,00 €, до конца месяца 12 дней, около 11,92 € в день',
  );
  const over = limitStatus(20000, 25000, '2026-10', '2026-10-20');
  assert.equal(limitMessage('Продукты', over), 'Продукты: лимит 200,00 € превышен на 50,00 €');

  const past = limitStatus(20000, 5700, '2026-09', '2026-10-20');
  assert.equal(limitMessage('Продукты', past), 'Продукты: осталось 143,00 € из 200,00 €');
});

test('лимиты: склонение слова «день»', () => {
  assert.equal(pluralDays(1), 'день');
  assert.equal(pluralDays(2), 'дня');
  assert.equal(pluralDays(5), 'дней');
  assert.equal(pluralDays(11), 'дней');
  assert.equal(pluralDays(21), 'день');
  assert.equal(pluralDays(24), 'дня');
});
