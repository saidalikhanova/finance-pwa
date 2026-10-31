import { test, assert } from './runner.js';
import { openDatabase, deleteDatabase, put, remove, getAll, getOne, setSetting, getSetting } from '../src/db.js';
import { createOperation, updateOperation, deleteOperation, listOperations } from '../src/repo/operations.js';
import { createSchedule, generateDue } from '../src/repo/recurring.js';
import { listPlanned } from '../src/repo/planned.js';
import { enableSync, syncNow, push, pull, applyRemote, getSyncConfig } from '../src/sync.js';
import { makeFamilyCode } from '../src/sync-config.js';

/**
 * Поддельное облако: таблица записей в памяти, как у PostgREST —
 * upsert с «новая правка побеждает», выборка по updated_at с постраничностью.
 */
function fakeCloud() {
  /** @type {Map<string, any>} */
  const rows = new Map();
  let clock = 0;
  const calls = { get: 0, post: 0 };
  let failNext = false;
  /** @type {typeof fetch} */
  const fetchFn = async (url, init = {}) => {
    const u = new URL(String(url));
    const family = /** @type {any} */ (init.headers)?.['x-family'];
    if (failNext) {
      failNext = false;
      return /** @type {any} */ ({ ok: false, status: 500, json: async () => [] });
    }
    if (!family || family.length < 24) return /** @type {any} */ ({ ok: false, status: 401, json: async () => [] });
    if (init.method === 'POST') {
      calls.post++;
      for (const r of JSON.parse(String(init.body))) {
        if (r.family !== family) continue;
        const id = `${r.store}:${r.id}`;
        const old = rows.get(id);
        if (old && Date.parse(old.updated_at) > Date.parse(r.updated_at)) continue;
        rows.set(id, { ...r, seq: ++clock });
      }
      return /** @type {any} */ ({ ok: true, status: 201, json: async () => [] });
    }
    calls.get++;
    const gt = u.searchParams.get('updated_at');
    const limit = Number(u.searchParams.get('limit') ?? 1000);
    const after = gt ? Date.parse(gt.replace(/^gt\./, '')) : -Infinity;
    const list = [...rows.values()].filter((r) => r.family === family && Date.parse(r.updated_at) > after)
      .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at) || a.store.localeCompare(b.store) || a.id.localeCompare(b.id))
      .slice(0, limit);
    return /** @type {any} */ ({ ok: true, status: 200, json: async () => list.map(({ store, id, data, updated_at, deleted }) => ({ store, id, data, updated_at, deleted })) });
  };
  return { rows, fetchFn, calls, fail: () => { failNext = true; } };
}

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** @param {string} name */
async function fresh(name) {
  await deleteDatabase(name);
  return openDatabase(name);
}

test('обмен: два телефона сходятся — записи, правки и удаления', async () => {
  const cloud = fakeCloud();
  const A = await fresh('finance-test-sync-a');
  const B = await fresh('finance-test-sync-b');
  const cfg = { url: 'https://abc.supabase.co', key: 'k'.repeat(30), family: makeFamilyCode() };

  // Телефон A: записи есть, создаёт код → всё уходит в облако
  const op = await createOperation({ type: 'expense', amount: 100, currency: 'EUR', categoryId: 'c', date: '2026-10-01', comment: 'кофе' }, A);
  await put(A, 'categories', { id: 'c', name: 'Кафе', kind: 'expense', archived: false, order: 0, createdAt: '', parentId: null });
  await setSetting('banks', ['Kaspi'], A);
  await setSetting('displayCurrency', 'KZT', A);
  await enableSync(cfg, { mode: 'create' }, A);
  let r = await syncNow({ db: A, fetchFn: cloud.fetchFn });
  assert.equal(r?.sent, 3, 'операция, категория, банки; личная настройка — нет');
  assert.equal((await getAll(A, 'changes')).length, 0, 'очередь пуста');

  // Телефон B: подключается по коду — местные записи заменяются
  await put(B, 'categories', { id: 'local', name: 'Своя', kind: 'expense', archived: false, order: 0, createdAt: '', parentId: null });
  await enableSync(cfg, { mode: 'join' }, B);
  assert.equal((await getAll(B, 'categories')).length, 0, 'местные общие записи стёрты');
  r = await syncNow({ db: B, fetchFn: cloud.fetchFn });
  assert.equal(r?.applied, 3);
  const opB = await getOne(B, 'operations', op.id);
  assert.equal(opB?.comment, 'кофе', 'операция пришла на B');
  assert.deepEqual(await getSetting('banks', B), ['Kaspi'], 'банки общие');
  assert.equal(await getSetting('displayCurrency', B), undefined, 'личная настройка не пришла');
  assert.equal((await getAll(B, 'changes')).length, 0, 'полученное не ставится в очередь');

  // B правит операцию, A удаляет категорию — после обмена оба видят одно и то же
  await sleep(5);
  await updateOperation(op.id, { comment: 'кофе и круассан' }, B);
  await remove(A, 'categories', 'c');
  await syncNow({ db: B, fetchFn: cloud.fetchFn });
  await syncNow({ db: A, fetchFn: cloud.fetchFn });
  await syncNow({ db: B, fetchFn: cloud.fetchFn });
  assert.equal((await getOne(A, 'operations', op.id))?.comment, 'кофе и круассан', 'правка B дошла до A');
  assert.equal(await getOne(B, 'categories', 'c'), undefined, 'удаление A дошло до B');

  // Повторный обмен без изменений ничего не делает
  r = await syncNow({ db: A, fetchFn: cloud.fetchFn });
  assert.deepEqual(r, { applied: 0, sent: 0 });
  const saved = await getSyncConfig(A);
  assert.ok(saved?.cursor, 'отметка сохранена');
  assert.equal(saved?.lastError, null);
});

test('обмен: последняя правка побеждает, старое из облака не затирает новое', async () => {
  const db = await fresh('finance-test-sync-c');
  const op = await createOperation({ type: 'expense', amount: 100, currency: 'EUR', categoryId: 'c', date: '2026-10-01', comment: 'новое' }, db);
  const old = { ...op, comment: 'старое', updatedAt: '2020-01-01T00:00:00.000Z' };
  assert.equal(await applyRemote(db, { store: 'operations', id: op.id, data: old, updated_at: '2020-01-01T00:00:00+00:00', deleted: false }), false);
  assert.equal((await getOne(db, 'operations', op.id))?.comment, 'новое');
  // Старое удаление тоже не действует; новое — действует
  assert.equal(await applyRemote(db, { store: 'operations', id: op.id, data: null, updated_at: '2020-01-01T00:00:00+00:00', deleted: true }), false);
  assert.equal(await applyRemote(db, { store: 'operations', id: op.id, data: null, updated_at: '2999-01-01T00:00:00+00:00', deleted: true }), true);
  assert.equal(await getOne(db, 'operations', op.id), undefined);
  // Неотправленное местное удаление новее записи из облака — запись не воскресает
  const op2 = await createOperation({ type: 'expense', amount: 1, currency: 'EUR', categoryId: 'c', date: '2026-10-02' }, db);
  await deleteOperation(op2.id, db);
  assert.equal(await applyRemote(db, { store: 'operations', id: op2.id, data: { ...op2, updatedAt: '2020-01-01T00:00:00.000Z' }, updated_at: '2020-01-01T00:00:00+00:00', deleted: false }), false);
  assert.equal(await getOne(db, 'operations', op2.id), undefined);
});

test('обмен: при ошибке облака очередь сохраняется, ошибка видна, следующий обмен досылает', async () => {
  const cloud = fakeCloud();
  const db = await fresh('finance-test-sync-d');
  const cfg = { url: 'https://abc.supabase.co', key: 'k'.repeat(30), family: makeFamilyCode() };
  await enableSync(cfg, { mode: 'create' }, db);
  await createOperation({ type: 'expense', amount: 5, currency: 'EUR', categoryId: 'c', date: '2026-10-01' }, db);
  cloud.fail();
  await assert.rejects(() => syncNow({ db, fetchFn: cloud.fetchFn }), 'ошибка облака');
  assert.equal((await getAll(db, 'changes')).length, 1, 'очередь на месте');
  assert.ok((await getSyncConfig(db))?.lastError, 'ошибка записана');
  const r = await syncNow({ db, fetchFn: cloud.fetchFn });
  assert.equal(r?.sent, 1);
  assert.equal((await getSyncConfig(db))?.lastError, null);
  assert.equal(cloud.rows.size, 1);
});

test('обмен: записи по расписанию получают одинаковые id на обоих телефонах', async () => {
  const A = await fresh('finance-test-sync-e');
  const B = await fresh('finance-test-sync-f');
  const s = { name: 'Подписка', type: /** @type {const} */ ('expense'), amount: 999, currency: /** @type {const} */ ('EUR'), categoryId: 'c', period: /** @type {const} */ ('monthly'), startDate: '2026-10-05' };
  const sa = await createSchedule(s, A);
  await put(B, 'recurring', { ...sa }, { raw: true });
  await generateDue('2026-10-20', A);
  await generateDue('2026-10-20', B);
  const opsA = await listOperations({}, A);
  const opsB = await listOperations({}, B);
  assert.equal(opsA.length, 1);
  assert.equal(opsA[0].id, opsB[0].id, 'одна и та же запись, а не две');
  assert.equal(opsA[0].id, `${sa.id}:2026-10-05`);
  // С подтверждением — ожидаемый платёж тоже с предсказуемым id
  const sc = await createSchedule({ ...s, name: 'Кредит', confirm: true, startDate: '2026-10-10' }, A);
  await generateDue('2026-10-20', A);
  const planned = (await listPlanned({ includeDone: true }, A)).filter((p) => p.recurringId === sc.id);
  assert.equal(planned[0]?.id, `${sc.id}:2026-10-10`);
});
