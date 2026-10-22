import { el, toast, confirmDialog } from '../ui.js';
import { getSetting, setSetting } from '../db.js';
import { buildBackup, buildBackupZip, backupFilename, readBackupFile, validateBackup, restoreBackup, DATA_STORES } from '../backup.js';
import { shareOrDownload } from '../ics.js';

const STORE_LABEL = /** @type {Record<string, string>} */ ({
  settings: 'настройки', categories: 'категории', operations: 'операции', rates: 'курсы', budgets: 'строки бюджета',
  recurring: 'повторяющиеся платежи', planned: 'разовые платежи', wishes: 'желаемые покупки', products: 'продукты', debts: 'долги', photos: 'фотографии',
});

/** @param {HTMLElement} root */
export async function renderBackup(root) {
  const last = await getSetting('lastBackupAt');
  const status = el('p', { class: 'muted small' }, last ? `Последняя копия: ${new Date(last).toLocaleString('ru-RU')}` : 'Копия ещё не делалась.');

  root.append(
    el('h2', { class: 'section-title' }, 'Выгрузка'),
    el('div', { class: 'card' },
      status,
      el('p', { class: 'small' }, 'Все данные в одном файле JSON. На телефоне откроется меню «Поделиться» — сохраните файл в «Файлы», облако или отправьте себе.'),
      el('div', { class: 'btn-row' },
        el('button', { class: 'btn', type: 'button', onclick: () => doExport(false) }, 'Сделать копию'),
        el('button', { class: 'btn btn-secondary', type: 'button', onclick: () => doExport(true) }, 'С фотографиями (ZIP)'),
      ),
    ),
    el('h2', { class: 'section-title' }, 'Загрузка'),
    el('div', { class: 'card' },
      el('p', { class: 'small' }, 'Выберите файл копии (.json или .zip). Перед заменой данных приложение проверит файл и покажет, что в нём.'),
      el('button', { class: 'btn btn-secondary', type: 'button', style: 'width:100%', onclick: () => fileInput.click() }, 'Выбрать файл копии'),
    ),
  );
  const fileInput = el('input', { type: 'file', accept: '.json,.zip,application/json,application/zip', hidden: true });
  const preview = el('div');
  root.append(fileInput, preview);
  fileInput.addEventListener('change', () => fileInput.files?.[0] && inspect(fileInput.files[0]));

  /** @param {boolean} withPhotos */
  async function doExport(withPhotos) {
    try {
      const date = new Date().toISOString().slice(0, 10);
      let result;
      if (withPhotos) {
        const blob = await buildBackupZip();
        result = await shareOrDownload(blob, backupFilename(date, 'zip'), 'application/zip');
      } else {
        const backup = await buildBackup();
        result = await shareOrDownload(JSON.stringify(backup, null, 1), backupFilename(date), 'application/json');
      }
      if (result === 'cancelled') return;
      const now = new Date().toISOString();
      await setSetting('lastBackupAt', now);
      status.textContent = `Последняя копия: ${new Date(now).toLocaleString('ru-RU')}`;
      toast(result === 'shared' ? 'Копия передана' : 'Копия сохранена');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось создать копию', { error: true });
    }
  }

  /** @param {File} file */
  async function inspect(file) {
    preview.innerHTML = '';
    fileInput.value = '';
    let parsed;
    try {
      parsed = await readBackupFile(file);
    } catch (err) {
      preview.append(el('div', { class: 'card' }, el('p', { class: 'over' }, err instanceof Error ? err.message : 'Не удалось прочитать файл')));
      return;
    }
    const v = validateBackup(parsed.backup);
    if (!v.ok || !v.summary) {
      preview.append(el('div', { class: 'card' }, el('p', { class: 'over small' }, 'Файл не подходит:'), ...v.errors.map((e) => el('div', { class: 'small' }, `• ${e}`))));
      return;
    }
    const s = v.summary;
    const list = el('ul', { class: 'status-list' });
    for (const store of DATA_STORES) list.append(el('li', null, el('span', null, STORE_LABEL[store]), el('span', null, String(s.counts[store] ?? 0))));
    list.append(el('li', null, el('span', null, STORE_LABEL.photos), el('span', null, parsed.photos.size ? `${parsed.photos.size} в архиве` : s.photos ? `${s.photos} (в файле нет, см. ниже)` : '0')));
    preview.append(
      el('div', { class: 'card' },
        el('div', null, el('strong', null, file.name)),
        el('div', { class: 'muted small' }, `Создана ${s.createdAt ? new Date(s.createdAt).toLocaleString('ru-RU') : '—'} · формат ${s.version}`),
        list,
        parsed.photos.size ? null : el('p', { class: 'muted small' }, 'Фотографии в этой копии не включены: сохранятся только те, на которые ссылаются загружаемые записи.'),
        el('p', { class: 'over small' }, 'Внимание: все текущие данные приложения будут заменены содержимым файла. Отменить это нельзя.'),
        el('button', { class: 'btn btn-danger', type: 'button', onclick: () => doRestore(/** @type {any} */ (parsed.backup), parsed.photos) }, 'Заменить все данные'),
      ),
    );
  }

  /** @param {import('../backup.js').Backup} backup @param {Map<string, { blob: Blob, type: string }>} photos */
  async function doRestore(backup, photos) {
    if (!(await confirmDialog('Заменить все данные приложения данными из файла? Текущие данные будут удалены.'))) return;
    try {
      const counts = await restoreBackup(backup, photos);
      toast(`Данные восстановлены: операций ${counts.operations}, категорий ${counts.categories}`);
      location.hash = '#/';
      location.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось восстановить', { error: true });
    }
  }
}
