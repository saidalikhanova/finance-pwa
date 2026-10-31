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

  const sync = await getSetting('sync');
  root.append(
    el('h2', { class: 'section-title' }, 'Общие данные'),
    el('div', { class: 'card list-card' },
      el('a', { class: 'menu-row', href: '#/sync' }, el('span', null, 'Общие данные для семьи', el('div', { class: 'muted small' }, sync?.url ? 'включены' : 'не подключены — вести записи вдвоём')), el('span', { class: 'muted' }, '›')),
    ),
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
        el('li', null, el('span', null, 'Версия приложения'), el('span', { id: 'app-version' }, '…')),
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

  root.append(el('button', { class: 'btn btn-secondary', type: 'button', style: 'width:100%;margin-top:4px', onclick: checkUpdate }, 'Проверить обновление'));
  runningVersion().then((v) => {
    const node = document.getElementById('app-version');
    if (node) node.textContent = v ?? '—';
  });

  async function checkUpdate() {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return toast('Обновления недоступны в этом режиме', { error: true });
    toast('Проверяю…');
    const latest = await siteVersion();
    if (!latest) return toast('Нет связи с сайтом — проверьте интернет', { error: true });
    const current = await runningVersion();
    if (current === latest) return toast(`У вас последняя версия: ${latest}`);
    toast(`Загружаю версию ${latest} — приложение перезапустится`, { ms: 8000 });
    await reg.update().catch(() => {});
    // Если за 15 секунд новая версия не применилась сама — обновляем принудительно.
    // Данные хранятся отдельно (IndexedDB) и не затрагиваются.
    setTimeout(async () => {
      if ((await runningVersion()) === latest) return;
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      for (const k of await caches.keys()) await caches.delete(k);
      location.reload();
    }, 15000);
  }
}

/** Версия, которая сейчас работает (спрашиваем у сервис-воркера). */
async function runningVersion() {
  const sw = navigator.serviceWorker?.controller;
  if (sw) {
    const v = await new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => resolve(e.data);
      sw.postMessage('version', [ch.port2]);
      setTimeout(() => resolve(null), 1000);
    });
    if (v) return /** @type {string} */ (v);
  }
  // Старый сервис-воркер не отвечает — берём самую новую версию из кэша
  const keys = (await caches.keys().catch(() => [])).filter((k) => k.startsWith('finance-v'));
  const nums = keys.map((k) => Number(k.slice('finance-v'.length))).filter(Number.isFinite);
  return nums.length ? `v${Math.max(...nums)}` : null;
}

/** Последняя версия на сайте. */
async function siteVersion() {
  try {
    const text = await (await fetch(`./sw.js?check=${Date.now()}`, { cache: 'no-store' })).text();
    return text.match(/CACHE_VERSION = '([^']+)'/)?.[1] ?? null;
  } catch {
    return null;
  }
}
