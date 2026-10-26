import { test, assert } from './runner.js';
import { openDatabase, deleteDatabase, MIGRATIONS, put, getAll } from '../src/db.js';
import { createCategory, createArticle, renameCategory, setCategoryArchived, listCategories } from '../src/repo/categories.js';
import { createOperation, listOperations, sumByCategory } from '../src/repo/operations.js';
import { ordered, rollup, idsWithParents, withChildren, fullName, childrenOf } from '../src/category-tree.js';
import { expensesByCategory } from '../src/reports.js';
import { parseChatImport, buildClaudePrompt } from '../src/chat-import.js';

const DB = 'finance-test-articles';
async function fresh() {
  await deleteDatabase(DB);
  return openDatabase(DB);
}

test('статьи: создаются внутри категории расходов, без дублей; архив — вместе с категорией', async () => {
  const db = await fresh();
  const health = await createCategory('Здоровье', 'expense', db);
  const salary = await createCategory('Зарплата', 'income', db);
  const ins = await createArticle(health.id, ' Страховка Freedom ', db);
  assert.equal(ins.parentId, health.id);
  assert.equal(ins.name, 'Страховка Freedom');
  await createArticle(health.id, 'Аптека', db);
  await assert.rejects(() => createArticle(health.id, 'аптека', db), 'дубль в той же категории');
  await assert.rejects(() => createArticle(ins.id, 'Х', db), 'статья в статье');
  await assert.rejects(() => createArticle(salary.id, 'Х', db), 'у доходов статей нет');
  const food = await createCategory('Продукты', 'expense', db);
  await createArticle(food.id, 'Аптека', db); // в другой категории — можно
  await assert.rejects(() => renameCategory(ins.id, 'Аптека', db), 'переименование в имя соседней статьи');
  await renameCategory(ins.id, 'Страховка детей', db);

  await setCategoryArchived(health.id, true, db);
  const all = await listCategories({ includeArchived: true }, db);
  assert.ok(all.filter((c) => c.parentId === health.id).every((c) => c.archived), 'статьи ушли в архив вместе с категорией');
  await setCategoryArchived(health.id, false, db);
  assert.equal(childrenOf(await listCategories({ includeArchived: true }, db), health.id).length, 2, 'и вернулись');
  const again = await createArticle(health.id, 'Врачи', db);
  await setCategoryArchived(again.id, true, db);
  assert.equal((await createArticle(health.id, 'Врачи', db)).id, again.id, 'статья из архива возвращается, а не дублируется');
  db.close();
});

test('статьи: порядок, полное название, суммы с категорией, лимиты категории и статьи', () => {
  const cats = /** @type {any[]} */ ([
    { id: 'h', name: 'Здоровье', kind: 'expense', order: 1, archived: false, parentId: null },
    { id: 'f', name: 'Продукты', kind: 'expense', order: 0, archived: false, parentId: null },
    { id: 'i', name: 'Страховка', kind: 'expense', order: 0, archived: false, parentId: 'h' },
    { id: 'p', name: 'Аптека', kind: 'expense', order: 1, archived: false, parentId: 'h' },
    { id: 'x', name: 'Старое', kind: 'expense', order: 2, archived: true, parentId: 'h' },
  ]);
  const byId = new Map(cats.map((c) => [c.id, c]));
  assert.deepEqual(ordered(cats, { kind: 'expense' }).map((x) => `${x.depth}:${x.c.id}`), ['0:f', '0:h', '1:i', '1:p'], 'категория, затем её статьи; архив скрыт');
  assert.equal(fullName(byId.get('p'), byId), 'Здоровье › Аптека');
  assert.equal(fullName(byId.get('h'), byId), 'Здоровье');
  const sums = rollup(new Map([['h', 10], ['i', 100], ['p', 5], ['f', 7]]), cats);
  assert.equal(sums.get('h'), 115, 'категория = своё + статьи');
  assert.equal(sums.get('i'), 100, 'у статьи — своё');
  assert.equal(sums.get('f'), 7);
  assert.deepEqual(idsWithParents(['i'], cats).sort(), ['h', 'i'], 'трата в статье проверяет лимит статьи и категории');
  assert.deepEqual(withChildren(cats, 'h'), ['h', 'i', 'p', 'x']);
});

test('статьи: отчёт по категориям считает статьи в своей категории, с разбивкой', () => {
  const byId = /** @type {Map<string, any>} */ (new Map([
    ['h', { name: 'Здоровье', parentId: null }],
    ['i', { name: 'Страховка', parentId: 'h' }],
    ['p', { name: 'Аптека', parentId: 'h' }],
    ['f', { name: 'Продукты', parentId: null }],
  ]));
  const op = (/** @type {string} */ c, /** @type {number} */ eur) => /** @type {any} */ ({ type: 'expense', categoryId: c, amountEur: eur, items: [] });
  const rows = expensesByCategory([op('i', 1000), op('p', 200), op('h', 50), op('f', 300)], byId);
  assert.deepEqual(rows.map((r) => [r.categoryId, r.amount]), [['h', 1250], ['f', 300]]);
  assert.deepEqual(rows[0].articles.map((a) => [a.name, a.amount]), [['Страховка', 1000], ['Аптека', 200]]);
  assert.equal(rows[1].articles.length, 0);
});

test('статьи: фильтр операций по категории включает её статьи и позиции', async () => {
  const db = await fresh();
  const health = await createCategory('Здоровье', 'expense', db);
  const ph = await createArticle(health.id, 'Аптека', db);
  const food = await createCategory('Продукты', 'expense', db);
  const base = { type: /** @type {const} */ ('expense'), currency: /** @type {const} */ ('EUR'), date: '2026-10-10' };
  await createOperation({ ...base, amount: 100, categoryId: ph.id }, db);
  await createOperation({ ...base, amount: 200, categoryId: health.id }, db);
  await createOperation({ ...base, amount: 300, categoryId: food.id }, db);
  const all = await listCategories({ includeArchived: true }, db);
  const ops = await listOperations({ categoryIds: withChildren(all, health.id) }, db);
  assert.equal(ops.length, 2, 'категория + статья');
  assert.equal(rollup(await sumByCategory('2026-10', db), all).get(health.id), 300);
  db.close();
});

test('статьи: импорт из чата понимает «Категория › Статья» и статью по имени', () => {
  const cats = [
    { id: 'h', name: 'Здоровье', kind: 'expense', parentId: null },
    { id: 'p', name: 'Аптека', kind: 'expense', parentId: 'h' },
    { id: 'f', name: 'Продукты', kind: 'expense', parentId: null },
    { id: 'm', name: 'Мясо', kind: 'expense', parentId: 'f' },
  ];
  const item = (/** @type {string} */ category) => ({ name: 'X', qty: 1, unit: 'шт', price: 1, sum: 1, category });
  const json = JSON.stringify({ purchases: [{ date: '2026-10-10', store: 'S', currency: 'EUR', items: [item('Здоровье › Аптека'), item('здоровье > аптека'), item('Аптека'), item('Здоровье'), item('Нет такой')] }] });
  const { purchases } = parseChatImport(json, cats);
  assert.deepEqual(purchases[0].items.map((i) => i.categoryId), ['p', 'p', 'p', 'h', '']);
  const prompt = buildClaudePrompt(/** @type {any[]} */ (cats), []);
  assert.ok(prompt.includes('Здоровье, Здоровье › Аптека, Продукты, Продукты › Мясо'), 'в инструкции — категории со статьями');
});

test('миграция 13: у существующих категорий — без родителя', async () => {
  await deleteDatabase(DB);
  let db = await openDatabase(DB, MIGRATIONS.filter((m) => m.version <= 12));
  await put(db, 'categories', { id: 'h', name: 'Здоровье', kind: 'expense', archived: false, order: 0, createdAt: '' });
  db.close();
  db = await openDatabase(DB);
  const [c] = /** @type {any[]} */ (await getAll(db, 'categories'));
  assert.equal(c.parentId, null);
  db.close();
});
