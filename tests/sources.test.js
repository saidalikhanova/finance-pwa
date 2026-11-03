import { test, assert } from './runner.js';
import { openDatabase, deleteDatabase } from '../src/db.js';
import { listSources, addSource, renameSource, removeSource, sourceUsage } from '../src/repo/sources.js';
import { createOperation, getOperation, updateOperation } from '../src/repo/operations.js';

const TEST_DB = 'finance-test-sources';
const base = { type: 'expense', amount: 1250, currency: 'EUR', date: '2026-10-05', categoryId: 'cat-1' };

test('источники оплаты: добавление без дублей и пустых названий', async () => {
  await deleteDatabase(TEST_DB);
  const db = await openDatabase(TEST_DB);
  assert.deepEqual(await listSources(db), []);
  await addSource('  Наличные ', db);
  await addSource('Kaspi', db);
  assert.deepEqual(await listSources(db), ['Наличные', 'Kaspi']);
  await assert.rejects(() => addSource('kaspi', db), 'дубль без учёта регистра');
  await assert.rejects(() => addSource('   ', db), 'пустое название');
  db.close();
});

test('источники оплаты: операция хранит источник, по умолчанию пусто', async () => {
  await deleteDatabase(TEST_DB);
  const db = await openDatabase(TEST_DB);
  const a = await createOperation({ ...base, source: ' Kaspi ' }, db);
  const b = await createOperation(base, db);
  assert.equal(a.source, 'Kaspi');
  assert.equal(b.source, '');
  const up = await updateOperation(b.id, { comment: 'x' }, db);
  assert.equal(up.source, '', 'правка другого поля источник не ломает');
  const changed = await updateOperation(a.id, { source: 'Наличные' }, db);
  assert.equal(changed.source, 'Наличные');
  db.close();
});

test('источники оплаты: переименование меняет и операции, удаление их не трогает', async () => {
  await deleteDatabase(TEST_DB);
  const db = await openDatabase(TEST_DB);
  await addSource('Каспи', db);
  await addSource('Наличные', db);
  const op = await createOperation({ ...base, source: 'Каспи' }, db);
  await renameSource('Каспи', 'Kaspi Gold', db);
  assert.deepEqual(await listSources(db), ['Kaspi Gold', 'Наличные']);
  assert.equal((await getOperation(op.id, db)).source, 'Kaspi Gold');
  assert.equal((await sourceUsage(db)).get('Kaspi Gold'), 1);
  await assert.rejects(() => renameSource('Kaspi Gold', 'наличные', db), 'нельзя переименовать в существующее');
  await removeSource('Kaspi Gold', db);
  assert.deepEqual(await listSources(db), ['Наличные']);
  assert.equal((await getOperation(op.id, db)).source, 'Kaspi Gold', 'в прошлых операциях название остаётся');
  db.close();
});
