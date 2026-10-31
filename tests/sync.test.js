import { test, assert } from './runner.js';
import { openDatabase, deleteDatabase, put, remove, setSetting, getAll, enqueueAll, clearChanges, SCHEMA_VERSION } from '../src/db.js';
import { copyBudget, setBudgetLine } from '../src/repo/budgets.js';
import { createOperation, deleteOperation } from '../src/repo/operations.js';
import { makeFamilyCode, encodeInvite, decodeInvite, validateConfig, normalizeUrl, FAMILY_CODE_LENGTH } from '../src/sync-config.js';
import { ping, enableSync, disableSync, getSyncConfig, pendingCount } from '../src/sync.js';

const DB = 'finance-test-sync';
async function fresh() {
  await deleteDatabase(DB);
  return openDatabase(DB);
}

test('общие данные: схема 14 — журнал изменений, updatedAt у записей', async () => {
  const db = await fresh();
  assert.equal(SCHEMA_VERSION, 14);
  assert.ok(db.objectStoreNames.contains('changes'), 'нет хранилища changes');
  await put(db, 'categories', { id: 'c1', name: 'Продукты', kind: 'expense', archived: false, order: 0, createdAt: '2026-01-01T00:00:00.000Z', parentId: null });
  const [c] = await getAll(db, 'categories');
  assert.ok(c.updatedAt, 'updatedAt проставлен при записи');
  let changes = await getAll(db, 'changes');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].id, 'categories:c1');
  assert.equal(changes[0].deleted, false);
  assert.equal(changes[0].updatedAt, c.updatedAt, 'в журнале та же отметка времени');

  await remove(db, 'categories', 'c1');
  changes = await getAll(db, 'changes');
  assert.equal(changes.length, 1, 'одна запись на ключ');
  assert.equal(changes[0].deleted, true, 'удаление — пометка');

  // Запись из облака (raw) журнал не трогает
  await put(db, 'categories', { id: 'c2', name: 'Х', kind: 'expense', archived: false, order: 1, createdAt: '', updatedAt: '2026-02-02T00:00:00.000Z' }, { raw: true });
  assert.equal((await getAll(db, 'changes')).length, 1);
  const [c2] = await getAll(db, 'categories');
  assert.equal(c2.updatedAt, '2026-02-02T00:00:00.000Z', 'updatedAt из облака сохранён');
});

test('общие данные: настройки — общие только для семьи; фото не журналируются', async () => {
  const db = await fresh();
  await setSetting('banks', ['Kaspi'], db);
  await setSetting('displayCurrency', 'KZT', db);
  await setSetting('sync', { url: 'x' }, db);
  await put(db, 'photos', { id: 'p1', blob: null });
  const ids = (await getAll(db, 'changes')).map((c) => c.id);
  assert.deepEqual(ids, ['settings:banks']);
});

test('общие данные: записи через репозитории попадают в журнал (операции, бюджет, копирование месяца)', async () => {
  const db = await fresh();
  const op = await createOperation({ type: 'expense', amount: 100, currency: 'EUR', categoryId: 'c', date: '2026-10-01' }, db);
  await setBudgetLine('2026-10', 'c', { planned: 1000 }, db);
  await copyBudget('2026-10', '2026-11', db);
  await deleteOperation(op.id, db);
  const changes = await getAll(db, 'changes');
  const byId = new Map(changes.map((c) => [c.id, c]));
  assert.equal(byId.get(`operations:${op.id}`)?.deleted, true);
  assert.equal(byId.get('budgets:2026-10:c')?.deleted, false);
  assert.equal(byId.get('budgets:2026-11:c')?.deleted, false, 'скопированная строка в журнале');
});

test('общие данные: включение ставит в очередь всё, отключение очищает', async () => {
  const db = await fresh();
  await put(db, 'categories', { id: 'c1', name: 'А', kind: 'expense', archived: false, order: 0, createdAt: '', parentId: null });
  await put(db, 'rates', { date: '2026-10-01', rate: 5000000, source: 'manual' });
  await setSetting('displayCurrency', 'KZT', db);
  await clearChanges(db);
  assert.equal(await pendingCount(db), 0);
  const cfg = { url: 'https://abc.supabase.co/', key: 'k'.repeat(30), family: makeFamilyCode() };
  const n = await enableSync(cfg, db);
  assert.equal(n, 2, 'категория и курс; локальная настройка — нет');
  assert.equal(await pendingCount(db), 2);
  const saved = await getSyncConfig(db);
  assert.equal(saved?.url, 'https://abc.supabase.co', 'адрес без косой черты');
  assert.equal(saved?.cursor, null);
  await disableSync(db);
  assert.equal(await getSyncConfig(db), null);
  assert.equal(await pendingCount(db), 0);
  await assert.rejects(() => enableSync({ url: 'http://x', key: 'k'.repeat(30), family: makeFamilyCode() }, db), 'адрес без https');
});

test('общие данные: семейный код и код подключения', async () => {
  const f = makeFamilyCode();
  assert.equal(f.length, FAMILY_CODE_LENGTH);
  assert.ok(/^[a-z2-9]+$/.test(f), 'только простые символы');
  assert.ok(makeFamilyCode() !== f, 'коды случайные');
  assert.equal(normalizeUrl(' https://abc.supabase.co// '), 'https://abc.supabase.co');
  assert.equal(normalizeUrl('abc.supabase.co'), '');
  const c = { url: 'https://abc.supabase.co', key: 'eyJ' + 'x'.repeat(40), family: f };
  assert.equal(validateConfig(c), '');
  const invite = encodeInvite(c);
  assert.ok(invite.startsWith('fin1.'));
  assert.deepEqual(decodeInvite(` ${invite}\n`), c, 'разбор с пробелами');
  await assert.rejects(async () => decodeInvite('abc'), 'не код');
  await assert.rejects(async () => decodeInvite('fin1.%%%'), 'повреждён');
  await assert.rejects(async () => decodeInvite(encodeInvite({ ...c, family: 'short' })), 'короткий код');
});

test('общие данные: проверка связи понятными словами', async () => {
  const c = { url: 'https://abc.supabase.co', key: 'k'.repeat(30), family: makeFamilyCode() };
  /** @param {number} status */
  const fake = (status) => async () => ({ ok: status < 400, status });
  assert.equal(await ping(c, fake(200)), true);
  await assert.rejects(() => ping(c, fake(401)), 'ключ');
  await assert.rejects(() => ping(c, fake(404)), 'нет таблицы');
  await assert.rejects(() => ping(c, async () => { throw new Error('x'); }), 'нет связи');
  await assert.rejects(() => ping({ ...c, url: 'nope' }, fake(200)), 'адрес');
});
