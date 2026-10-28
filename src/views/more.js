import { el } from '../ui.js';

/** «Ещё»: по группам — отчёты, справочники, инструменты, настройки. */
export function renderMore(root) {
  root.append(
    group('Отчёты',
      menu('#/reports', 'Отчёты', 'итоги месяца, по категориям, динамика'),
      menu('#/product-reports', 'Отчёт по продуктам', 'что и сколько покупаете'),
      menu('#/forecast', 'Прогноз закупок', 'сколько уйдёт на продукты'),
    ),
    group('Справочники',
      menu('#/categories', 'Категории и статьи', 'расходы; источники дохода — в «Бюджете»'),
      menu('#/banks', 'Банки', 'для кредитов'),
      menu('#/products', 'Продукты', 'названия, единицы, категории'),
      menu('#/rates', 'Курсы тенге к евро', 'вводятся вручную'),
    ),
    group('Инструменты',
      menu('#/import', 'Импорт из чата', 'чек, разобранный в Claude'),
      menu('#/wishes', 'Желаемые покупки', 'список и перенос в план месяца'),
      menu('#/schedules', 'Расписания платежей', 'пауза, завершение, выгрузка в календарь телефона'),
      menu('#/backup', 'Резервная копия', 'выгрузить или восстановить данные'),
    ),
    group('Настройки',
      menu('#/settings', 'Настройки', 'напоминания, прогноз, версия приложения'),
    ),
  );
}

/** @param {string} title @param {...Node} rows */
function group(title, ...rows) {
  return el('div', null, el('h2', { class: 'section-title' }, title), el('div', { class: 'card list-card' }, ...rows));
}

/** @param {string} href @param {string} text @param {string} [hint] */
function menu(href, text, hint) {
  return el('a', { class: 'menu-row', href }, el('span', null, text, hint ? el('div', { class: 'muted small' }, hint) : null), el('span', { class: 'muted' }, '›'));
}
