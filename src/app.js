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
import { renderPayForm } from './views/pay-form.js';
import { renderSchedules } from './views/schedules.js';
import { renderBanks } from './views/banks.js';
import { renderWishes } from './views/wishes.js';
import { renderWishForm } from './views/wish-form.js';
import { renderImport } from './views/import.js';
import { renderProducts } from './views/products.js';
import { renderProduct } from './views/product.js';
import { renderProductReports } from './views/product-reports.js';
import { renderForecast } from './views/forecast.js';
import { renderBackup } from './views/backup.js';
import { renderDebts } from './views/debts.js';
import { renderIncomeSource } from './views/income-source.js';
import { renderDebt } from './views/debt.js';
import { renderSettings } from './views/settings.js';
import { renderSyncSettings } from './views/sync-settings.js';
import { generateDue } from './repo/recurring.js';
import { todayISO } from './repo/operations.js';
import { toast } from './ui.js';

register('/', { title: 'Главная', render: renderHome });
register('/operations', { title: 'Операции', render: renderOperations });
register('/add', { title: 'Новая операция', back: '/operations', tab: '/operations', render: renderOperationForm });
register('/operations/new', { title: 'Новая операция', back: '/operations', tab: '/operations', render: renderOperationForm });
register('/operations/:id', { title: 'Операция', back: '/operations', tab: '/operations', render: renderOperationForm });
register('/budget', { title: 'Бюджет', render: renderBudget });
register('/budget/:month/:categoryId', { title: 'Категория', back: '/budget', tab: '/budget', render: renderBudgetLine });
register('/rates', { title: 'Курсы', back: '/more', tab: '/more', render: renderRates });
register('/payments', { title: 'Платежи', render: renderPayments });
register('/schedules', { title: 'Расписания', back: '/payments', tab: '/payments', render: renderSchedules });
register('/payments/new', { title: 'Новый платёж', back: '/payments', tab: '/payments', render: (root, p) => renderPayForm(root, p) });
register('/payments/:id', { title: 'Платёж', back: '/payments', tab: '/payments', render: (root, p) => renderPayForm(root, { ...p, store: 'schedule' }) });
register('/planned/new', { title: 'Новый платёж', back: '/payments', tab: '/payments', render: (root, p) => renderPayForm(root, { ...p, kind: 'once' }) });
register('/planned/:id', { title: 'Платёж', back: '/payments', tab: '/payments', render: (root, p) => renderPayForm(root, { ...p, store: 'planned' }) });
// Старый адрес календаря — тот же раздел «Платежи» в виде календаря
register('/calendar', { title: 'Платежи', tab: '/payments', render: (root) => renderPayments(root, { view: 'calendar' }) });
register('/loans/new', { title: 'Новый кредит', back: '/budget', tab: '/budget', render: (root, p) => renderPayForm(root, { ...p, loan: '1' }) });
register('/loans/:id', { title: 'Кредит', back: '/budget', tab: '/budget', render: (root, p) => renderPayForm(root, { ...p, store: 'schedule' }) });
register('/banks', { title: 'Банки', back: '/more', tab: '/more', render: renderBanks });
register('/wishes', { title: 'Желаемые покупки', back: '/more', tab: '/more', render: renderWishes });
register('/import', { title: 'Импорт из чата', back: '/operations', tab: '/operations', render: renderImport });
register('/products', { title: 'Продукты', back: '/more', tab: '/more', render: renderProducts });
register('/products/:id', { title: 'Продукт', back: '/products', tab: '/more', render: renderProduct });
register('/product-reports', { title: 'Отчёт по продуктам', back: '/reports', tab: '/more', render: renderProductReports });
register('/forecast', { title: 'Прогноз закупок', back: '/product-reports', tab: '/more', render: renderForecast });
register('/income/new', { title: 'Источник дохода', back: '/budget', tab: '/budget', render: renderIncomeSource });
register('/debts', { title: 'Долги людям', back: '/payments', tab: '/payments', render: renderDebts });
register('/debts/new', { title: 'Новый долг', back: '/debts', tab: '/payments', render: renderDebt });
register('/debts/:id', { title: 'Долг', back: '/debts', tab: '/payments', render: renderDebt });
register('/backup', { title: 'Резервная копия', back: '/more', tab: '/more', render: renderBackup });
register('/settings', { title: 'Настройки', back: '/more', tab: '/more', render: renderSettings });
register('/sync', { title: 'Общие данные', back: '/settings', tab: '/more', render: renderSyncSettings });
register('/wishes/new', { title: 'Новая запись', back: '/wishes', tab: '/more', render: renderWishForm });
register('/wishes/:id', { title: 'Желаемая покупка', back: '/wishes', tab: '/more', render: renderWishForm });
register('/reports', { title: 'Отчёты', back: '/more', tab: '/more', render: renderReports });
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
  // Новая версия приложения применяется сразу: когда новый сервис-воркер берёт
  // управление, страница один раз перезагружается (только если до этого уже была версия).
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    // Проверяем обновление при каждом открытии и возвращении в приложение
    reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
    navigator.serviceWorker.ready.then(() => {
      const el = document.getElementById('sw-status');
      if (el) el.textContent = 'готово';
    });
  });
}
