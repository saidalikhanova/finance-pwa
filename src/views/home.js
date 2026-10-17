import { getDb, getSetting, setSetting, SCHEMA_VERSION } from '../db.js';

const INSTALLED_AT = 'installedAt';

/** @param {HTMLElement} root */
export async function renderHome(root) {
  const db = await getDb();

  let installedAt = await getSetting(INSTALLED_AT, db);
  if (!installedAt) {
    installedAt = new Date().toISOString();
    await setSetting(INSTALLED_AT, installedAt, db);
  }

  const online = navigator.onLine;
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    // @ts-ignore — свойство Safari на iOS
    window.navigator.standalone === true;
  const swReady = Boolean(navigator.serviceWorker?.controller);

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h2 style="margin:0 0 8px;font-size:17px">Состояние приложения</h2>
    <ul class="status-list">
      <li><span>Локальная база</span><span>схема v${SCHEMA_VERSION}</span></li>
      <li><span>Первый запуск</span><span>${new Date(installedAt).toLocaleDateString('ru-RU')}</span></li>
      <li><span>Работа без интернета</span><span id="sw-status">${swReady ? 'готово' : 'подготовка…'}</span></li>
      <li><span>Сеть</span><span>${online ? 'есть' : 'нет'}</span></li>
      <li><span>Установлено на экран</span><span>${standalone ? 'да' : 'нет'}</span></li>
    </ul>
  `;
  root.appendChild(card);

  const note = document.createElement('p');
  note.className = 'muted';
  note.textContent = 'Это каркас приложения. Операции, лимиты и бюджет появятся на следующих этапах.';
  root.appendChild(note);
}
