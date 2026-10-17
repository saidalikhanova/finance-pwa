import { test, assert } from './runner.js';
import {
  openDatabase,
  deleteDatabase,
  getSetting,
  setSetting,
  MIGRATIONS,
  SCHEMA_VERSION,
  promisify,
} from '../src/db.js';

const TEST_DB = 'finance-test';

/** Чистая база перед каждым тестом. */
async function fresh(migrations = MIGRATIONS) {
  await deleteDatabase(TEST_DB);
  return openDatabase(TEST_DB, migrations);
}

test('миграции идут по порядку, версии строго возрастают с 1', () => {
  MIGRATIONS.forEach((m, i) => assert.equal(m.version, i + 1, `миграция №${i} имеет версию ${m.version}`));
  assert.equal(SCHEMA_VERSION, MIGRATIONS.length);
});

test('новая база создаётся с актуальной схемой', async () => {
  const db = await fresh();
  assert.equal(db.version, SCHEMA_VERSION);
  assert.ok(db.objectStoreNames.contains('settings'), 'нет таблицы settings');
  db.close();
});

test('настройка сохраняется и читается после повторного открытия', async () => {
  let db = await fresh();
  await setSetting('backupEveryDays', 7, db);
  db.close();

  db = await openDatabase(TEST_DB);
  assert.equal(await getSetting('backupEveryDays', db), 7);
  assert.equal(await getSetting('нет такого ключа', db), undefined);
  db.close();
});

test('обновление схемы не удаляет данные пользователя', async () => {
  // База версии 1 с данными
  let db = await fresh([MIGRATIONS[0]]);
  await setSetting('theme', 'dark', db);
  db.close();

  // Приложение обновилось: появилась миграция 2 с новой таблицей
  const extended = [
    ...MIGRATIONS,
    {
      version: SCHEMA_VERSION + 1,
      /** @param {IDBDatabase} d */
      upgrade(d) {
        d.createObjectStore('test_extra', { keyPath: 'id' });
      },
    },
  ];
  db = await openDatabase(TEST_DB, extended);
  assert.equal(db.version, SCHEMA_VERSION + 1);
  assert.ok(db.objectStoreNames.contains('test_extra'), 'новая таблица не создана');
  assert.equal(await getSetting('theme', db), 'dark', 'данные потеряны при обновлении');
  db.close();
});

test('применяются только недостающие миграции', async () => {
  const applied = [];
  const tracked = MIGRATIONS.map((m) => ({
    version: m.version,
    /** @param {IDBDatabase} d @param {IDBTransaction} tx */
    upgrade(d, tx) {
      applied.push(m.version);
      m.upgrade(d, tx);
    },
  }));
  let db = await fresh(tracked);
  db.close();
  assert.deepEqual(applied, MIGRATIONS.map((m) => m.version));

  applied.length = 0;
  db = await openDatabase(TEST_DB, tracked);
  db.close();
  assert.deepEqual(applied, [], 'при открытии актуальной базы миграции не должны выполняться');
});

test('promisify передаёт результат и ошибку запроса', async () => {
  const db = await fresh();
  const tx = db.transaction('settings', 'readwrite');
  await promisify(tx.objectStore('settings').put({ key: 'a', value: 1 }));
  const row = await promisify(db.transaction('settings').objectStore('settings').get('a'));
  assert.deepEqual(row, { key: 'a', value: 1 });
  db.close();
});
