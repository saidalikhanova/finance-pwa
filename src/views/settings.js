import { el, toast } from '../ui.js';
import { getSetting, setSetting, SCHEMA_VERSION } from '../db.js';
import { DEFAULT_REMINDER_DAYS } from '../backup-reminder.js';

/** @param {HTMLElement} root */
export async function renderSettings(root) {
  const enabled = (await getSetting('backupReminderEnabled')) ?? true;
  const days = Number((await getSetting('backupReminderDays')) ?? DEFAULT_REMINDER_DAYS);
  const forecastMonths = Number((await getSetting('forecastMonths')) ?? 3);
  const overbuy = Number((await getSetting('overbuyPercent')) ?? 30);

  const enabledBox = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', checked: enabled }));
  const daysInput = el('input', { class: 'input input-sm', type: 'number', min: 1, max: 365, value: days });
  const monthsInput = el('input', { class: 'input input-sm', type: 'number', min: 1, max: 12, value: forecastMonths });
  const overbuyInput = el('input', { class: 'input input-sm', type: 'number', min: 1, max: 500, value: overbuy });

  root.append(
    el('h2', { class: 'section-title' }, 'Напоминание о резервной копии'),
    el('div', { class: 'card list-card' },
      el('label', { class: 'cat-row' }, enabledBox, el('span', { class: 'cat-name' }, 'Показывать напоминание на главной')),
      el('div', { class: 'cat-row' }, el('span', { class: 'cat-name' }, 'Если копии не было дней'), daysInput),
    ),
    el('h2', { class: 'section-title' }, 'Прогноз закупок'),
    el('div', { class: 'card list-card' },
      el('div', { class: 'cat-row' }, el('span', { class: 'cat-name' }, 'Учитывать месяцев'), monthsInput),
      el('div', { class: 'cat-row' }, el('span', { class: 'cat-name' }, 'Порог избыточной покупки, %'), overbuyInput),
    ),
    el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'button', onclick: save }, 'Сохранить')),
  );

  // Состояние приложения (перенесено с главного экрана)
  const installedAt = await getSetting('installedAt');
  const standalone = window.matchMedia('(display-mode: standalone)').matches || /** @type {any} */ (window.navigator).standalone === true;
  root.append(
    el('h2', { class: 'section-title' }, 'Состояние приложения'),
    el('div', { class: 'card list-card' },
      el('ul', { class: 'status-list' },
        el('li', null, el('span', null, 'Локальная база'), el('span', null, `схема v${SCHEMA_VERSION}`)),
        el('li', null, el('span', null, 'Первый запуск'), el('span', null, installedAt ? new Date(installedAt).toLocaleDateString('ru-RU') : '—')),
        el('li', null, el('span', null, 'Работа без интернета'), el('span', { id: 'sw-status' }, navigator.serviceWorker?.controller ? 'готово' : 'подготовка…')),
        el('li', null, el('span', null, 'Сеть'), el('span', null, navigator.onLine ? 'есть' : 'нет')),
        el('li', null, el('span', null, 'Установлено на экран'), el('span', null, standalone ? 'да' : 'нет')),
      ),
    ),
  );

  async function save() {
    await setSetting('backupReminderEnabled', enabledBox.checked);
    await setSetting('backupReminderDays', Math.max(1, Math.min(365, Number(daysInput.value) || DEFAULT_REMINDER_DAYS)));
    await setSetting('forecastMonths', Math.max(1, Math.min(12, Number(monthsInput.value) || 3)));
    await setSetting('overbuyPercent', Math.max(1, Number(overbuyInput.value) || 30));
    toast('Настройки сохранены');
  }
}
