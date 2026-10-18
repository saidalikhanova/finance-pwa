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
import { renderPayments } from './views/payments.js';
import { renderPaymentForm } from './views/payment-form.js';
import { renderPlannedForm } from './views/planned-form.js';
import { renderCalendar } from './views/calendar.js';
import { renderWishes } from './views/wishes.js';
import { renderWishForm } from './views/wish-form.js';
import { renderImport } from './views/import.js';
import { generateDue } from './repo/recurring.js';
import { todayISO } from './repo/operations.js';
import { toast } from './ui.js';

register('/', { title: 'Главная', render: renderHome });
register('/operations', { title: 'Операции', render: renderOperations });
register('/operations/new', { title: 'Новая операция', back: '/operations', tab: '/operations', render: renderOperationForm });
register('/operations/:id', { title: 'Операция', back: '/operations', tab: '/operations', render: renderOperationForm });
register('/budget', { title: 'Бюджет', render: renderBudget });
register('/budget/:month/:categoryId', { title: 'План и лимит', back: '/budget', tab: '/budget', render: renderBudgetLine });
register('/rates', { title: 'Курсы', back: '/more', tab: '/more', render: renderRates });
register('/payments', { title: 'Платежи', back: '/more', tab: '/more', render: renderPayments });
register('/payments/new', { title: 'Повторяющийся платёж', back: '/payments', tab: '/more', render: renderPaymentForm });
register('/payments/:id', { title: 'Повторяющийся платёж', back: '/payments', tab: '/more', render: renderPaymentForm });
register('/planned/new', { title: 'Разовый платёж', back: '/payments', tab: '/more', render: renderPlannedForm });
register('/planned/:id', { title: 'Разовый платёж', back: '/payments', tab: '/more', render: renderPlannedForm });
register('/calendar', { title: 'Календарь платежей', back: '/more', tab: '/more', render: renderCalendar });
register('/wishes', { title: 'Желаемые покупки', back: '/more', tab: '/more', render: renderWishes });
register('/import', { title: 'Импорт из чата', back: '/operations', tab: '/operations', render: renderImport });
register('/wishes/new', { title: 'Новая запись', back: '/wishes', tab: '/more', render: renderWishForm });
register('/wishes/:id', { title: 'Желаемая покупка', back: '/wishes', tab: '/more', render: renderWishForm });
register('/reports', { title: 'Отчёты', render: renderReports });
register('/more', { title: 'Ещё', render: renderMore });
register('/categories', { title: 'Категории', back: '/more', tab: '/more', render: renderCategories });

const root = /** @type {HTMLElement} */ (document.getElementById('view'));
const titleEl = /** @type {HTMLElement} */ (document.getElementById('page-title'));
const backEl = /** @type {HTMLAnchorElement} */ (document.getElementById('back-link'));

// При запуске: категории по умолчанию, затем операции по расписаниям
// (в том числе пропущенные за дни, когда приложение не открывалось).
seedDefaultCategories()
  .then(() => generateDue(todayISO()))
  .then((n) => {
    if (n) toast(`Создано операций по расписанию: ${n}`);
  })
  .finally(() => start(root, titleEl, backEl));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(() => {
    // Когда сервис-воркер взял страницу под контроль — обновляем статус на главной.
    navigator.serviceWorker.ready.then(() => {
      const el = document.getElementById('sw-status');
      if (el) el.textContent = 'готово';
    });
  });
}
