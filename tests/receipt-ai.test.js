import { test, assert } from './runner.js';
import { openDatabase, deleteDatabase, setSetting, getAll } from '../src/db.js';
import { buildReceiptRequest, recognizeReceipt, apiErrorText, totalMismatch, RECEIPT_MODEL, KEY_SETTING } from '../src/receipt-ai.js';
import { parseChatImport } from '../src/chat-import.js';
import { applyImport } from '../src/repo/import.js';
import { isSynced } from '../src/db.js';
import { buildBackup } from '../src/backup.js';
import { listOperations, sumByCategory } from '../src/repo/operations.js';

const cats = [
  { id: 'food', name: 'Продукты', kind: 'expense', parentId: null },
  { id: 'home', name: 'Дом и быт', kind: 'expense', parentId: null },
  { id: 'sal', name: 'Зарплата', kind: 'income', parentId: null },
];
const ctx = { categories: cats, products: [{ name: 'Молоко', unit: 'л' }], today: '2026-11-01' };
/** @param {any} body @param {number} [status] */
const reply = (body, status = 200) => async () => /** @type {any} */ ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

test('чек: запрос содержит снимки, категории расходов и справочник', () => {
  const r = buildReceiptRequest(ctx, ['AAA', 'BBB']);
  assert.equal(r.model, RECEIPT_MODEL);
  const content = /** @type {any[]} */ (r.messages[0].content);
  assert.equal(content.filter((b) => b.type === 'image').length, 2);
  assert.equal(content[0].source.data, 'AAA', 'снимки идут по порядку');
  const text = content[content.length - 1].text;
  assert.ok(text.includes('Молоко'), 'справочник в запросе');
  assert.ok(text.includes('2026-11-01'), 'дата по умолчанию');
  const catEnum = r.output_config.format.schema.properties.items.items.properties.category.enum;
  assert.deepEqual(catEnum, ['Продукты', 'Дом и быт'], 'только категории расходов');
});

test('чек: ответ раскладывается по категориям и сохраняется с позициями и снимком', async () => {
  const answer = { date: '2026-10-30', store: 'Mercadona', currency: 'EUR', total: 7.5, items: [
    { name: 'Молоко', qty: 2, unit: 'л', price: 1.5, sum: 3, category: 'Продукты' },
    { name: 'Стиральный порошок', qty: 1, unit: 'шт', price: 4.5, sum: 4.5, category: 'Дом и быт' },
  ] };
  // Перед текстом может идти блок размышлений: он не должен попасть в ответ
  const text = await recognizeReceipt('k', buildReceiptRequest(ctx, ['A']), reply({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(answer) }] }));
  const { purchases, errors } = parseChatImport(text, cats);
  assert.deepEqual(errors, []);
  assert.equal(purchases[0].total, 750);
  assert.equal(totalMismatch(purchases[0]), null, 'итог сходится');
  await deleteDatabase('finance-test-receipt');
  const db = await openDatabase('finance-test-receipt');
  await applyImport([{ ...purchases[0], photoId: 'photo1' }], { addProducts: true }, db);
  const [op] = await listOperations({}, db);
  assert.equal(op.photoId, 'photo1', 'снимок у операции');
  assert.equal(op.items.length, 2, 'каждая покупка сохранена');
  const by = await sumByCategory('2026-10', db);
  assert.equal(by.get('food'), 300);
  assert.equal(by.get('home'), 450);
  assert.equal((await getAll(db, 'products')).length, 2, 'товары в справочнике');
  db.close();
});

test('чек: ошибки понятными словами, расхождение итога замечается', async () => {
  const req = buildReceiptRequest(ctx, ['A']);
  await assert.rejects(() => recognizeReceipt('k', req, reply({}, 401)), 'ключ');
  await assert.rejects(() => recognizeReceipt('k', req, reply({ stop_reason: 'refusal', content: [] })), 'отказ');
  await assert.rejects(() => recognizeReceipt('k', req, reply({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{' }] })), 'обрезано');
  await assert.rejects(() => recognizeReceipt('k', req, reply({ stop_reason: 'end_turn', content: [] })), 'пусто');
  await assert.rejects(() => recognizeReceipt('k', req, async () => { throw new Error('x'); }), 'нет сети');
  assert.ok(apiErrorText(400, 'Your credit balance is too low').includes('баланс'));
  assert.equal(totalMismatch({ items: [{ sum: 700 }], total: 750 }), -50);
  assert.equal(totalMismatch({ items: [{ sum: 751 }], total: 750 }), null, 'копейка округления — не ошибка');
  assert.equal(totalMismatch({ items: [{ sum: 700 }], total: 0 }), null, 'итога нет');
});

test('чек: ключ остаётся на телефоне', async () => {
  assert.equal(isSynced('settings', KEY_SETTING), false, 'не уходит в общие данные');
  await deleteDatabase('finance-test-receipt');
  const db = await openDatabase('finance-test-receipt');
  await setSetting(KEY_SETTING, 'sk-ant-secret', db);
  assert.equal((await getAll(db, 'changes')).length, 0);
  const backup = await buildBackup(db);
  assert.ok(!JSON.stringify(backup).includes('sk-ant-secret'), 'ключа нет в резервной копии');
  db.close();
});
