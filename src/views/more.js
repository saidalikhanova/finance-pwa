import { el } from '../ui.js';

/** «Ещё»: главные пункты и свёрнутое «Дополнительно». */
export function renderMore(root) {
  // Главное; остальное свёрнуто в «Дополнительно»
  root.append(
    el('div', { class: 'card list-card' },
      menu('#/reports', 'Отчёты', 'итоги месяца, по категориям, динамика'),
      menu('#/products', 'Справочник покупок', 'всё, что вы покупаете, из чеков, по категориям'),
      menu('#/categories', 'Категории и статьи', 'расходы; источники дохода — в «Бюджете»'),
      menu('#/banks', 'Банки', 'для кредитов'),
      menu('#/rates', 'Курсы тенге к евро', 'вводятся вручную'),
      menu('#/backup', 'Резервная копия', 'выгрузить или восстановить данные'),
      menu('#/settings', 'Настройки', 'ключ для чеков, напоминания, версия приложения'),
    ),
    el('details', { class: 'card list-card', style: 'margin-top:12px' },
      el('summary', { class: 'muted' }, 'Дополнительно'),
      menu('#/import', 'Чеки: фото и импорт из Claude', 'фото чека есть и вверху «Операций»'),
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
