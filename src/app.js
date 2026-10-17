import { register, start } from './router.js';
import { seedDefaultCategories } from './repo/categories.js';
import { renderHome } from './views/home.js';
import { renderOperations } from './views/operations.js';
import { renderOperationForm } from './views/operation-form.js';
import { renderCategories } from './views/categories.js';
import { renderMore } from './views/more.js';
import { placeholder } from './views/placeholder.js';

register('/', { title: 'Главная', render: renderHome });
register('/operations', { title: 'Операции', render: renderOperations });
register('/operations/new', { title: 'Новая операция', back: '/operations', tab: '/operations', render: renderOperationForm });
register('/operations/:id', { title: 'Операция', back: '/operations', tab: '/operations', render: renderOperationForm });
register('/budget', { title: 'Бюджет', ...placeholder('Лимиты по категориям и месячный бюджет.', 4) });
register('/reports', { title: 'Отчёты', ...placeholder('Итоги за месяц и расходы по категориям.', 5) });
register('/more', { title: 'Ещё', render: renderMore });
register('/categories', { title: 'Категории', back: '/more', tab: '/more', render: renderCategories });

const root = /** @type {HTMLElement} */ (document.getElementById('view'));
const titleEl = /** @type {HTMLElement} */ (document.getElementById('page-title'));
const backEl = /** @type {HTMLAnchorElement} */ (document.getElementById('back-link'));

seedDefaultCategories().then(() => start(root, titleEl, backEl));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(() => {
    // Когда сервис-воркер взял страницу под контроль — обновляем статус на главной.
    navigator.serviceWorker.ready.then(() => {
      const el = document.getElementById('sw-status');
      if (el) el.textContent = 'готово';
    });
  });
}
