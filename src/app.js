import { register, start } from './router.js';
import { seedDefaultCategories } from './repo/categories.js';
import { renderHome } from './views/home.js';
import { renderOperations } from './views/operations.js';
import { renderOperationForm } from './views/operation-form.js';
import { renderCategories } from './views/categories.js';
import { renderMore } from './views/more.js';
import { renderBudget } from './views/budget.js';
import { renderBudgetLine } from './views/budget-line.js';
import { renderRates } from './views/rates.js';
import { renderReports } from './views/reports.js';

register('/', { title: 'Главная', render: renderHome });
register('/operations', { title: 'Операции', render: renderOperations });
register('/operations/new', { title: 'Новая операция', back: '/operations', tab: '/operations', render: renderOperationForm });
register('/operations/:id', { title: 'Операция', back: '/operations', tab: '/operations', render: renderOperationForm });
register('/budget', { title: 'Бюджет', render: renderBudget });
register('/budget/:month/:categoryId', { title: 'План и лимит', back: '/budget', tab: '/budget', render: renderBudgetLine });
register('/rates', { title: 'Курсы', back: '/more', tab: '/more', render: renderRates });
register('/reports', { title: 'Отчёты', render: renderReports });
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
