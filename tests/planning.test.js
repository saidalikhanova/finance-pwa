import { test, assert } from './runner.js';
import { openDatabase, deleteDatabase } from '../src/db.js';
import { createPlanned, updatePlanned, listPlanned, getPlanned, markReceived } from '../src/repo/planned.js';
import { createOperation, deleteOperation } from '../src/repo/operations.js';
import { createWish, updateWish, deleteWish, listWishes, planWishes, getWish } from '../src/repo/wishes.js';
import { getBudgetLine, setBudgetLine } from '../src/repo/budgets.js';
import { createSchedule } from '../src/repo/recurring.js';
import { listUpcoming } from '../src/repo/upcoming.js';
import { buildIcs } from '../src/ics.js';
import { savePhoto, getPhoto } from '../src/photos.js';

const TEST_DB = 'finance-test-planning';
async function fresh() {
  await deleteDatabase(TEST_DB);
  return openDatabase(TEST_DB);
}

test('разовые платежи: создание, список по датам, отметка «оплачено»', async () => {
  const db = await fresh();
  const a = await createPlanned({ name: 'Страховка', type: 'expense', amount: 12000, currency: 'EUR', categoryId: 'ins', date: '2026-10-20' }, db);
  await createPlanned({ name: 'Кружок', type: 'expense', amount: 4000, currency: 'EUR', categoryId: 'kids', date: '2026-11-03' }, db);
  assert.equal((await listPlanned({ from: '2026-10-18', to: '2026-10-31' }, db)).length, 1);
  await updatePlanned(a.id, { done: true, operationId: 'op-1' }, db);
  assert.equal((await listPlanned({ from: '2026-10-18', to: '2026-10-31' }, db)).length, 0, 'оплаченные скрыты');
  assert.equal((await listPlanned({ includeDone: true }, db)).length, 2);
  await assert.rejects(() => createPlanned({ name: 'x', type: 'expense', amount: 0, currency: 'EUR', categoryId: 'c', date: '2026-01-01' }, db));
  db.close();
});

test('календарь: ближайшие платежи объединяют расписания и разовые', async () => {
  const db = await fresh();
  await createSchedule({ name: 'Аренда', type: 'expense', amount: 90000, currency: 'EUR', categoryId: 'rent', period: 'monthly', startDate: '2026-09-01' }, db);
  await createSchedule({ name: 'Пауза', type: 'expense', amount: 1, currency: 'EUR', categoryId: 'x', period: 'weekly', startDate: '2026-10-01' }, db).then((s) =>
    import('../src/repo/recurring.js').then((m) => m.setScheduleStatus(s.id, 'paused', '2026-10-18', db)),
  );
  await createPlanned({ name: 'Страховка', type: 'expense', amount: 12000, currency: 'EUR', categoryId: 'ins', date: '2026-11-01' }, db);

  const list = await listUpcoming('2026-10-18', '2026-11-05', db);
  assert.deepEqual(list.map((u) => `${u.date} ${u.name}`), ['2026-11-01 Аренда', '2026-11-01 Страховка'], 'приостановленные не показываются');
  const today = await listUpcoming('2026-11-01', '2026-11-01', db);
  assert.equal(today.length, 2, 'платёж на саму дату from включён');
  db.close();
});

test('календарь: файл .ics', () => {
  const ics = buildIcs([{ uid: 'a@finance', date: '2026-11-01', title: 'Аренда: 900,00 €', description: 'Платёж; важный' }], '2026-10-18T10:00:00.000Z');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261101\r\nDTEND;VALUE=DATE:20261102'));
  assert.ok(ics.includes('SUMMARY:Аренда: 900 €'.slice(0, 14)), 'заголовок события');
  assert.ok(ics.includes('DESCRIPTION:Платёж\\; важный'), 'точка с запятой экранирована');
  assert.ok(ics.includes('DTSTAMP:20261018T100000Z'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});

test('желаемые покупки: запись, перенос в бюджет, покупка, удаление с фото', async () => {
  const db = await fresh();
  const photoId = await savePhoto(new Blob(['x'], { type: 'image/jpeg' }), db);
  const w1 = await createWish({ name: 'Куртка', price: 8000, currency: 'EUR', categoryId: 'clothes', priority: 'high', link: 'https://example.com/a', photoId }, db);
  const w2 = await createWish({ name: 'Лампа', price: 3000, currency: 'EUR', categoryId: 'home', priority: 'low' }, db);
  const w3 = await createWish({ name: 'Без цены', price: null, currency: 'EUR', categoryId: 'home', priority: 'low' }, db);
  await assert.rejects(() => createWish({ name: 'x', currency: 'EUR', categoryId: 'c', priority: 'high', link: 'example.com' }, db), 'ссылка без http');

  await setBudgetLine('2026-11', 'home', { planned: 1000, limit: 5000 }, db);
  const r = await planWishes([w1.id, w2.id, w3.id], '2026-11', (w) => w.price, db);
  assert.deepEqual(r, { moved: 2, skipped: 1 });
  assert.equal((await getBudgetLine('2026-11', 'clothes', db))?.planned, 8000, 'новая строка бюджета');
  assert.equal((await getBudgetLine('2026-11', 'home', db))?.planned, 4000, 'прибавлено к существующему плану');
  assert.equal((await getBudgetLine('2026-11', 'home', db))?.limit, 5000, 'лимит не тронут');
  assert.equal((await getWish(w1.id, db))?.status, 'planned');
  assert.equal((await getWish(w1.id, db))?.plannedMonth, '2026-11');
  assert.equal((await getWish(w3.id, db))?.status, 'want');

  await updateWish(w1.id, { status: 'bought', boughtAt: '2026-11-03', actualPrice: 7500, operationId: 'op' }, db);
  const bought = await getWish(w1.id, db);
  assert.equal(bought?.status, 'bought');
  assert.equal(bought?.actualPrice, 7500);
  assert.equal(bought?.name, 'Куртка', 'остальные поля сохранены');

  await deleteWish(w1.id, db);
  assert.equal(await getPhoto(photoId, db), undefined, 'фото удалено вместе с записью');
  assert.equal((await listWishes(db)).length, 2);
  db.close();
});

test('удаление операции-отметки снимает «получено» с ожидаемого поступления', async () => {
  const db = await fresh();
  const p = await createPlanned({ name: 'Проект', type: 'income', amount: 500_00, currency: 'EUR', categoryId: 'inc', dateKind: 'day', date: '2026-11-10' }, db);
  const op = await createOperation({ type: 'income', amount: 500_00, currency: 'EUR', categoryId: 'inc', date: '2026-11-10' }, db);
  await markReceived(p.id, { operationId: op.id, date: '2026-11-10', amount: 500_00 }, db);
  assert.equal((await getPlanned(p.id, db))?.done, true);
  await deleteOperation(op.id, db);
  const after = await getPlanned(p.id, db);
  assert.equal(after?.done, false, 'снова ждёт отметки');
  assert.equal(after?.operationId, null);
  assert.equal(after?.receivedDate, null);
});
