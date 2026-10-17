import { test, assert } from './runner.js';
import { openDatabase, deleteDatabase } from '../src/db.js';
import {
  seedDefaultCategories,
  listCategories,
  createCategory,
  renameCategory,
  setCategoryArchived,
  countOperationsInCategory,
  DEFAULT_CATEGORIES,
} from '../src/repo/categories.js';
import { createOperation } from '../src/repo/operations.js';

const TEST_DB = 'finance-test-categories';

async function fresh() {
  await deleteDatabase(TEST_DB);
  return openDatabase(TEST_DB);
}

test('категории: набор по умолчанию создаётся один раз', async () => {
  const db = await fresh();
  assert.equal(await seedDefaultCategories(db), true);
  assert.equal(await seedDefaultCategories(db), false, 'повторный вызов не должен создавать дубликаты');

  const expense = await listCategories({ kind: 'expense' }, db);
  const income = await listCategories({ kind: 'income' }, db);
  assert.equal(expense.length, DEFAULT_CATEGORIES.expense.length);
  assert.equal(income.length, DEFAULT_CATEGORIES.income.length);
  assert.equal(expense[0].name, 'Продукты', 'порядок сохраняется');
  db.close();
});

test('категории: создание, переименование, запрет дубликатов', async () => {
  const db = await fresh();
  const c = await createCategory('  Спорт ', 'expense', db);
  assert.equal(c.name, 'Спорт');
  await assert.rejects(() => createCategory('спорт', 'expense', db), 'дубликат без учёта регистра');
  await assert.rejects(() => createCategory('   ', 'expense', db), 'пустое название');

  // Одинаковые названия в разных видах допустимы
  const c2 = await createCategory('Спорт', 'income', db);
  assert.equal(c2.kind, 'income');

  await renameCategory(c.id, 'Фитнес', db);
  const [renamed] = await listCategories({ kind: 'expense' }, db);
  assert.equal(renamed.name, 'Фитнес');
  db.close();
});

test('категории: архивирование скрывает из списка, но не удаляет', async () => {
  const db = await fresh();
  const c = await createCategory('Такси', 'expense', db);
  await setCategoryArchived(c.id, true, db);
  assert.equal((await listCategories({ kind: 'expense' }, db)).length, 0);
  const all = await listCategories({ kind: 'expense', includeArchived: true }, db);
  assert.equal(all.length, 1);
  assert.equal(all[0].archived, true);

  await setCategoryArchived(c.id, false, db);
  assert.equal((await listCategories({ kind: 'expense' }, db)).length, 1);
  db.close();
});

test('категории: число операций в категории', async () => {
  const db = await fresh();
  const c = await createCategory('Продукты', 'expense', db);
  assert.equal(await countOperationsInCategory(c.id, db), 0);
  await createOperation({ type: 'expense', amount: 100, currency: 'EUR', date: '2026-10-01', categoryId: c.id }, db);
  await createOperation({ type: 'expense', amount: 200, currency: 'EUR', date: '2026-10-02', categoryId: c.id }, db);
  assert.equal(await countOperationsInCategory(c.id, db), 2);
  db.close();
});
