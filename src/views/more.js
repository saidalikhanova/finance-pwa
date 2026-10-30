import { el } from '../ui.js';

/** «Ещё»: шесть главных пунктов и свёрнутое «Дополнительно». */
export function renderMore(root) {
  // Главное — шесть пунктов; остальное свёрнуто в «Дополнительно»
  root.append(
    el('div', { class: 'card list-card' },
      menu('#/reports', 'Отчёты', 'итоги месяца, по категориям, динамика'),
      menu('#/categories', 'Категории и статьи', 'расходы; источники дохода — в «Бюджете»'),
      menu('#/banks', 'Банки', 'для кредитов'),
      menu('#/rates', 'Курсы тенге к евро', 'вводятся вручную'),
      menu('#/backup', 'Резервная копия', 'выгрузить или восстановить данные'),
      menu('#/settings', 'Настройки', 'напоминания, прогноз, версия приложения'),
    ),
    el('details', { class: 'card list-card', style: 'margin-top:12px' },
      el('summary', { class: 'muted' }, 'Дополнительно'),
      menu('#/import', 'Импорт чека из Claude', 'есть и вверху «Операций»'),
      menu('#/products', 'Продукты', 'справочник: названия, единицы, категории'),
      menu('#/product-reports', 'Отчёт по продуктам', 'что и сколько покупаете'),
      menu('#/forecast', 'Прогноз закупок', 'сколько уйдёт на продукты'),
      menu('#/wishes', 'Желаемые покупки', 'список и перенос в план месяца'),
      menu('#/debts', 'Долги людям', 'есть и в «Платежах»'),
      menu('#/schedules', 'Расписания платежей', 'пауза, завершение, выгрузка в календарь телефона'),
    ),
  );
}

/** @param {string} href @param {string} text @param {string} [hint] */
function menu(href, text, hint) {
  return el('a', { class: 'menu-row', href }, el('span', null, text, hint ? el('div', { class: 'muted small' }, hint) : null), el('span', { class: 'muted' }, '›'));
}
