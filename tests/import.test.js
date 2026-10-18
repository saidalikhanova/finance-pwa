import { test, assert } from './runner.js';
import { parseChatImport, buildClaudePrompt } from '../src/chat-import.js';
import { openDatabase, deleteDatabase } from '../src/db.js';
import { applyImport } from '../src/repo/import.js';
import { ensureProducts, listProducts, findProductByName } from '../src/repo/products.js';
import { listOperations, sumByCategory } from '../src/repo/operations.js';

const cats = [
  { id: 'food', name: 'Продукты', kind: 'expense' },
  { id: 'home', name: 'Дом и быт', kind: 'expense' },
  { id: 'salary', name: 'Зарплата', kind: 'income' },
];

const sample = JSON.stringify({
  purchases: [
    {
      date: '2026-10-18',
      store: 'Mercadona',
      currency: 'EUR',
      items: [
        { name: 'Лук репчатый', qty: 1.5, unit: 'кг', price: 1.2, sum: 1.8, category: 'Продукты' },
        { name: 'Мыло', qty: 2, unit: 'шт', price: 1.75, category: 'дом и быт' },
        { name: 'Что-то', qty: '1', unit: 'uds', sum: '3,10', category: 'Неизвестная' },
      ],
    },
  ],
});

test('импорт из чата: разбор JSON с позициями', () => {
  const { purchases, errors } = parseChatImport(sample, cats);
  assert.deepEqual(errors, []);
  assert.equal(purchases.length, 1);
  const p = purchases[0];
  assert.equal(p.store, 'Mercadona');
  assert.equal(p.currency, 'EUR');
  assert.equal(p.items.length, 3);
  assert.deepEqual([p.items[0].qty, p.items[0].unit, p.items[0].price, p.items[0].sum, p.items[0].categoryId], [1500, 'кг', 120, 180, 'food']);
  assert.equal(p.items[1].sum, 350, 'сумма из цены × количество');
  assert.equal(p.items[1].categoryId, 'home', 'категория без учёта регистра');
  assert.equal(p.items[2].unit, 'шт', 'uds → шт');
  assert.equal(p.items[2].sum, 310, 'сумма строкой с запятой');
  assert.equal(p.items[2].categoryId, '', 'неизвестная категория помечена пустой');
  assert.equal(p.items[2].categoryName, 'Неизвестная');
});

test('импорт из чата: JSON в блоке с пояснениями, массив и одна покупка', () => {
  const wrapped = 'Вот результат:\n```json\n[{"date":"2026-10-01","items":[{"name":"Хлеб","sum":1.1,"category":"Продукты"}]}]\n```\nГотово.';
  const r1 = parseChatImport(wrapped, cats);
  assert.deepEqual(r1.errors, []);
  assert.equal(r1.purchases[0].items[0].sum, 110);
  assert.equal(r1.purchases[0].items[0].qty, 1000, 'количество по умолчанию 1');
  assert.equal(r1.purchases[0].items[0].unit, 'шт', 'единица по умолчанию');

  const single = parseChatImport('{"date":"2026-10-02","currency":"kzt","items":[{"name":"Чай","sum":1500,"category":"Продукты"}]}', cats);
  assert.equal(single.purchases[0].currency, 'KZT');
  assert.equal(single.purchases[0].items[0].sum, 150000);
});

test('импорт из чата: ошибки формата', () => {
  assert.deepEqual(parseChatImport('просто текст', cats).errors, ['В тексте не найден JSON']);
  assert.ok(parseChatImport('{"purchases": [', cats).errors[0].startsWith('Не удалось разобрать JSON'));
  const r = parseChatImport(JSON.stringify({ purchases: [{ date: '18.10.2026', items: [{ name: 'x', sum: 1 }] }, { date: '2026-10-18', currency: 'USD', items: [] }, { date: '2026-10-18', items: [{ name: '', sum: 1 }, { name: 'y', qty: -1 }, { name: 'z', unit: 'фунт', sum: 1 }, { name: 'w' }] }] }), cats);
  assert.equal(r.purchases.length, 0);
  assert.equal(r.errors.length, 6, r.errors.join(' | '));
});

test('импорт из чата: инструкция для Claude содержит категории и продукты', () => {
  const text = buildClaudePrompt(
    [...cats, { id: 'arch', name: 'Старая', kind: 'expense', archived: true }],
    [{ name: 'Лук репчатый', unit: 'кг', categoryId: 'food' }],
    new Map([['food', 'Продукты']]),
  );
  assert.ok(text.includes('Продукты, Дом и быт'), 'категории расходов');
  assert.ok(!text.includes('Старая'), 'архивные не включаются');
  assert.ok(!text.includes('Зарплата'), 'доходы не включаются');
  assert.ok(text.includes('- Лук репчатый (кг, Продукты)'), 'справочник продуктов');
  assert.ok(text.includes('"purchases"'), 'пример формата');
});

const TEST_DB = 'finance-test-import';
test('импорт из чата (база): создание операций и продуктов', async () => {
  await deleteDatabase(TEST_DB);
  const db = await openDatabase(TEST_DB);
  await ensureProducts([{ name: 'Лук репчатый', unit: 'кг', categoryId: 'food' }], db);

  const { purchases } = parseChatImport(sample, cats);
  purchases[0].items[2].categoryId = 'home'; // пользователь выбрал категорию в предпросмотре
  const r = await applyImport(purchases, { addProducts: true }, db);
  assert.deepEqual(r, { operations: 1, newProducts: 2 }, 'лук уже был, мыло и «что-то» новые');

  const ops = await listOperations({}, db);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].amount, 180 + 350 + 310);
  assert.equal(ops[0].store, 'Mercadona');
  assert.equal(ops[0].items.length, 3);
  const onion = await findProductByName('лук репчатый', db);
  assert.equal(ops[0].items[0].productId, onion?.id, 'позиция привязана к продукту');
  assert.equal((await listProducts(db)).length, 3);

  const by = await sumByCategory('2026-10', db);
  assert.equal(by.get('food'), 180);
  assert.equal(by.get('home'), 660);

  await assert.rejects(() => applyImport([{ ...purchases[0], items: [{ ...purchases[0].items[0], categoryId: '' }] }], { addProducts: false }, db), 'без категории нельзя');
  assert.equal((await ensureProducts([{ name: '  лук   РЕПЧАТЫЙ ', unit: 'кг', categoryId: 'food' }], db)).size, 3, 'дубликат по названию не создаётся');
  db.close();
});
