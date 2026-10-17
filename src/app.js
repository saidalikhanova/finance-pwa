import { register, start } from './router.js';
import { renderHome } from './views/home.js';
import { placeholder } from './views/placeholder.js';

register('/', { title: 'Главная', render: renderHome });
register('/operations', { title: 'Операции', ...placeholder('Список доходов и расходов.', 2) });
register('/budget', { title: 'Бюджет', ...placeholder('Лимиты по категориям и месячный бюджет.', 4) });
register('/reports', { title: 'Отчёты', ...placeholder('Итоги за месяц и расходы по категориям.', 5) });
register('/more', { title: 'Ещё', ...placeholder('Категории, резервная копия, настройки.', 2) });

const root = /** @type {HTMLElement} */ (document.getElementById('view'));
const titleEl = /** @type {HTMLElement} */ (document.getElementById('page-title'));

start(root, titleEl);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(() => {
    // Когда сервис-воркер взял страницу под контроль — обновляем статус на главной.
    navigator.serviceWorker.ready.then(() => {
      const el = document.getElementById('sw-status');
      if (el) el.textContent = 'готово';
    });
  });
}
