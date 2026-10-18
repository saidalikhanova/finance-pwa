import { test, assert } from './runner.js';
import { zipWrite, zipRead, crc32 } from '../src/zip.js';
import { buildBackup, buildBackupZip, validateBackup, readBackupFile, restoreBackup, backupFilename, BACKUP_VERSION } from '../src/backup.js';
import { backupReminder } from '../src/backup-reminder.js';
import { openDatabase, deleteDatabase, getAll, setSetting, getSetting } from '../src/db.js';
import { seedDefaultCategories, listCategories } from '../src/repo/categories.js';
import { createOperation, listOperations } from '../src/repo/operations.js';
import { saveRate } from '../src/repo/rates.js';
import { setBudgetLine } from '../src/repo/budgets.js';
import { createSchedule } from '../src/repo/recurring.js';
import { createWish } from '../src/repo/wishes.js';
import { savePhoto, getPhoto } from '../src/photos.js';
import { parseRate } from '../src/money.js';

test('zip: запись и чтение, контрольная сумма', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'эталонное значение CRC-32');
  const a = new TextEncoder().encode('{"x":1}');
  const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);
  const blob = zipWrite([{ name: 'backup.json', data: a }, { name: 'photos/фото.jpg', data: b }]);
  assert.ok(blob.size > 0);
  const entries = await zipRead(await blob.arrayBuffer());
  assert.equal(entries.size, 2);
  assert.equal(new TextDecoder().decode(entries.get('backup.json')), '{"x":1}');
  assert.deepEqual([...(entries.get('photos/фото.jpg') ?? [])], [...b], 'имя в UTF-8 и байты без изменений');

  const broken = new Uint8Array(await blob.arrayBuffer());
  broken[30 + 'backup.json'.length + 2] ^= 0xff; // портим данные первой записи
  await assert.rejects(() => zipRead(broken.buffer), 'повреждённый архив отклоняется');
  await assert.rejects(() => zipRead(new Uint8Array(10).buffer), 'не ZIP');
});

test('резервная копия: проверка структуры и версии до изменения данных', () => {
  assert.equal(validateBackup(null).ok, false);
  assert.equal(validateBackup({ format: 'other', version: 1, data: {} }).ok, false);
  assert.ok(validateBackup({ format: 'finance-backup', version: BACKUP_VERSION + 1, data: {} }).errors[0].includes('более новой версией'));
  assert.equal(validateBackup({ format: 'finance-backup', version: 1 }).ok, false, 'нет data');
  assert.equal(validateBackup({ format: 'finance-backup', version: 1, data: { operations: 'x' } }).ok, false, 'раздел не список');
  assert.equal(validateBackup({ format: 'finance-backup', version: 1, data: { operations: [{ id: 'a', amount: 1.5, date: '2026-01-01', type: 'expense' }] } }).ok, false, 'дробная сумма');
  assert.equal(validateBackup({ format: 'finance-backup', version: 1, data: { categories: [{ name: 'без id' }] } }).ok, false);

  const ok = validateBackup({ format: 'finance-backup', version: 1, createdAt: '2026-10-18T10:00:00Z', data: { operations: [{ id: 'a', amount: 100, date: '2026-01-01', type: 'expense' }], rates: [{ date: '2026-01-01', rate: 1 }] }, photos: { count: 2 } });
  assert.equal(ok.ok, true, ok.errors.join('; '));
  assert.equal(ok.summary?.counts.operations, 1);
  assert.equal(ok.summary?.counts.categories, 0, 'отсутствующие разделы считаются пустыми');
  assert.equal(ok.summary?.photos, 2);
  assert.equal(backupFilename('2026-10-11'), 'finance-backup-2026-10-11.json');
});

const TEST_DB = 'finance-test-backup';
async function fresh() {
  await deleteDatabase(TEST_DB);
  return openDatabase(TEST_DB);
}

test('резервная копия (база): выгрузка и восстановление на чистой базе', async () => {
  let db = await fresh();
  await seedDefaultCategories(db);
  const cats = await listCategories({}, db);
  await setSetting('backupReminderDays', 14, db);
  await setSetting('installedAt', '2026-01-01T00:00:00Z', db);
  await saveRate('2026-10-10', parseRate('500'), db);
  const photoId = await savePhoto(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), db);
  const orphanPhoto = await savePhoto(new Blob([new Uint8Array([9])], { type: 'image/jpeg' }), db);
  await createOperation({ type: 'expense', date: '2026-10-10', currency: 'KZT', amount: 10000, rate: parseRate('500'), rateSource: 'manual', categoryId: cats[0].id, photoId }, db);
  await createOperation({ type: 'income', date: '2026-10-05', currency: 'EUR', amount: 180000, categoryId: cats[cats.length - 1].id }, db);
  await setBudgetLine('2026-10', cats[0].id, { planned: 20000, limit: 25000 }, db);
  await createSchedule({ name: 'Аренда', type: 'expense', amount: 90000, currency: 'EUR', categoryId: cats[3].id, period: 'monthly', startDate: '2026-11-01' }, db);
  await createWish({ name: 'Куртка', price: 8000, currency: 'EUR', categoryId: cats[7].id, priority: 'high' }, db);

  const backup = await buildBackup(db);
  assert.equal(backup.format, 'finance-backup');
  assert.equal(backup.version, BACKUP_VERSION);
  assert.equal(backup.data.operations.length, 2);
  assert.equal(backup.data.categories.length, cats.length);
  assert.equal(backup.photos.count, 2);
  assert.equal(backup.photos.included, false);
  assert.ok(backup.data.settings.some((s) => s.key === 'backupReminderDays'), 'настройки включены');
  assert.ok(!backup.data.settings.some((s) => s.key === 'installedAt'), 'локальные настройки не включены');
  const v = validateBackup(JSON.parse(JSON.stringify(backup)));
  assert.equal(v.ok, true, v.errors.join('; '));

  // Чистое устройство
  db.close();
  db = await fresh();
  assert.equal((await listOperations({}, db)).length, 0);
  const counts = await restoreBackup(backup, new Map(), db);
  assert.equal(counts.operations, 2);
  assert.equal((await listCategories({}, db)).length, cats.length);
  const ops = await listOperations({}, db);
  assert.equal(ops.find((o) => o.currency === 'KZT')?.amountEur, 20, '100 ₸ по курсу 500 = 0,20 €, пересчёт сохранён как есть');
  assert.equal(await getSetting('backupReminderDays', db), 14);
  assert.equal((await getAll(db, 'budgets')).length, 1);
  assert.equal((await getAll(db, 'recurring')).length, 1);
  assert.equal((await getAll(db, 'wishes')).length, 1);
  assert.equal((await getAll(db, 'rates')).length, 1);
  assert.equal(counts.photos, 0, 'фото в копии не было, на чистом устройстве их нет');
  db.close();
});

test('резервная копия (база): копия с фотографиями (ZIP) и чтение файла', async () => {
  let db = await fresh();
  await seedDefaultCategories(db);
  const [cat] = await listCategories({}, db);
  const photoId = await savePhoto(new Blob([new Uint8Array([0xff, 0xd8, 1, 2])], { type: 'image/jpeg' }), db);
  await createOperation({ type: 'expense', date: '2026-10-10', currency: 'EUR', amount: 100, categoryId: cat.id, photoId }, db);
  const zip = await buildBackupZip(db);
  db.close();

  const parsed = await readBackupFile(zip);
  assert.equal(parsed.photos.size, 1);
  assert.ok(parsed.photos.has(photoId));
  const v = validateBackup(parsed.backup);
  assert.equal(v.ok, true, v.errors.join('; '));

  db = await fresh();
  const counts = await restoreBackup(/** @type {any} */ (parsed.backup), parsed.photos, db);
  assert.equal(counts.photos, 1);
  const blob = await getPhoto(photoId, db);
  assert.deepEqual([...new Uint8Array(await /** @type {Blob} */ (blob).arrayBuffer())], [0xff, 0xd8, 1, 2]);

  // JSON-файл с BOM читается; мусор отклоняется
  const json = await readBackupFile(new Blob(['﻿' + JSON.stringify(parsed.backup)], { type: 'application/json' }));
  assert.equal(validateBackup(json.backup).ok, true);
  await assert.rejects(() => readBackupFile(new Blob(['не json'])), 'не JSON');
  db.close();
});

test('резервная копия (база): восстановление без архива сохраняет только нужные фото', async () => {
  const db = await fresh();
  await seedDefaultCategories(db);
  const [cat] = await listCategories({}, db);
  const keep = await savePhoto(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }), db);
  const drop = await savePhoto(new Blob([new Uint8Array([2])], { type: 'image/jpeg' }), db);
  await createOperation({ type: 'expense', date: '2026-10-10', currency: 'EUR', amount: 100, categoryId: cat.id, photoId: keep }, db);
  const backup = await buildBackup(db);
  await setSetting('lastBackupAt', '2026-10-18T00:00:00Z', db);
  const counts = await restoreBackup(backup, new Map(), db);
  assert.equal(counts.photos, 1);
  assert.ok(await getPhoto(keep, db));
  assert.equal(await getPhoto(drop, db), undefined);
  assert.equal(await getSetting('lastBackupAt', db), '2026-10-18T00:00:00Z', 'дата последней копии устройства сохранена');
  db.close();
});

test('напоминание о копии: правило показа', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  const base = { enabled: true, days: 7, installedAt: '2026-10-01T00:00:00Z', now };
  assert.equal(backupReminder({ ...base, lastBackupAt: '2026-10-15T00:00:00Z' }).show, false, '3 дня — рано');
  assert.deepEqual(backupReminder({ ...base, lastBackupAt: '2026-10-11T00:00:00Z' }), { show: true, daysSince: 7 }, 'ровно 7 дней');
  assert.equal(backupReminder({ ...base, days: 14, lastBackupAt: '2026-10-05T00:00:00Z' }).show, false, 'период 14 дней');
  assert.equal(backupReminder({ ...base, lastBackupAt: null }).show, true, 'ни разу не делалась, прошла неделя с установки');
  assert.equal(backupReminder({ ...base, lastBackupAt: null, installedAt: '2026-10-15T00:00:00Z' }).show, false, 'ни разу, но первая неделя ещё идёт');
  assert.equal(backupReminder({ ...base, lastBackupAt: null, installedAt: null }).show, false);
  assert.equal(backupReminder({ ...base, enabled: false, lastBackupAt: null }).show, false, 'отключено');
});
