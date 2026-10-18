import { el, formatDate } from '../ui.js';
import { getDb, getSetting, setSetting, SCHEMA_VERSION } from '../db.js';
import { formatMoney } from '../money.js';
import { listUpcoming } from '../repo/upcoming.js';
import { todayISO } from '../repo/operations.js';
import { addDays } from '../dates.js';
import { suggestRate } from '../repo/rates.js';
import { toEurCents } from '../money.js';
import { upcomingRow } from './calendar.js';
import { quickEntry } from './quick-entry.js';

const INSTALLED_AT = 'installedAt';

/** @param {HTMLElement} root */
export async function renderHome(root) {
  const db = await getDb();
  const today = todayISO();

  let installedAt = await getSetting(INSTALLED_AT, db);
  if (!installedAt) {
    installedAt = new Date().toISOString();
    await setSetting(INSTALLED_AT, installedAt, db);
  }

  // Баннер о платежах сегодня и завтра
  const tomorrow = addDays(today, 1);
  const soon = await listUpcoming(today, tomorrow);
  if (soon.length) {
    const todayItems = soon.filter((u) => u.date === today);
    const tomorrowItems = soon.filter((u) => u.date === tomorrow);
    const parts = [];
    if (todayItems.length) parts.push(`сегодня: ${todayItems.map((u) => `${u.name} ${formatMoney(u.amount, u.currency)}`).join(', ')}`);
    if (tomorrowItems.length) parts.push(`завтра: ${tomorrowItems.map((u) => `${u.name} ${formatMoney(u.amount, u.currency)}`).join(', ')}`);
    root.append(el('a', { class: 'banner', href: '#/calendar' }, el('strong', null, 'Платежи'), el('div', { class: 'small' }, parts.join('; '))));
  }

  // Быстрый ввод расхода (п. 4.11 ТЗ)
  root.append(await quickEntry());

  // Ближайшие 7 дней
  const week = await listUpcoming(today, addDays(today, 6));
  root.append(el('h2', { class: 'section-title' }, 'Платежи на 7 дней'));
  if (!week.length) {
    root.append(el('p', { class: 'muted' }, 'Платежей не запланировано.'));
  } else {
    let totalEur = 0;
    let unknown = 0;
    const rate = (await suggestRate(today, db))?.rate ?? null;
    for (const u of week) {
      const eur = toEurCents(u.amount, u.currency, rate);
      if (eur == null) unknown++;
      else totalEur += u.type === 'expense' ? eur : -eur;
    }
    let lastDate = '';
    for (const u of week) {
      if (u.date !== lastDate) {
        lastDate = u.date;
        root.append(el('h3', { class: 'date-head' }, u.date === today ? 'Сегодня' : u.date === tomorrow ? 'Завтра' : formatDate(u.date)));
      }
      root.append(upcomingRow(u));
    }
    root.append(el('p', { class: 'muted small' }, `Итого к оплате: ${formatMoney(Math.max(0, totalEur), 'EUR')}${unknown ? ` (без курса: ${unknown})` : ''}`));
  }
  root.append(el('div', { class: 'btn-row' }, el('a', { class: 'btn btn-secondary', href: '#/calendar' }, 'Календарь'), el('a', { class: 'btn btn-secondary', href: '#/payments' }, 'Платежи')));

  // Состояние приложения
  const online = navigator.onLine;
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    // @ts-ignore — свойство Safari на iOS
    window.navigator.standalone === true;
  const swReady = Boolean(navigator.serviceWorker?.controller);
  root.append(
    el('details', { class: 'card list-card' },
      el('summary', { class: 'muted' }, 'Состояние приложения'),
      el('ul', { class: 'status-list' },
        el('li', null, el('span', null, 'Локальная база'), el('span', null, `схема v${SCHEMA_VERSION}`)),
        el('li', null, el('span', null, 'Первый запуск'), el('span', null, new Date(installedAt).toLocaleDateString('ru-RU'))),
        el('li', null, el('span', null, 'Работа без интернета'), el('span', { id: 'sw-status' }, swReady ? 'готово' : 'подготовка…')),
        el('li', null, el('span', null, 'Сеть'), el('span', null, online ? 'есть' : 'нет')),
        el('li', null, el('span', null, 'Установлено на экран'), el('span', null, standalone ? 'да' : 'нет')),
      ),
    ),
  );
}
