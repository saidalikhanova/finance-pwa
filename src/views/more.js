import { el } from '../ui.js';

/** @param {HTMLElement} root */
export function renderMore(root) {
  root.append(
    el('div', { class: 'card list-card' },
      menu('#/reports', 'Отчёты'),
      menu('#/import', 'Импорт из чата'),
      menu('#/wishes', 'Желаемые покупки'),
    ),
    el('div', { class: 'card list-card' },
      menu('#/products', 'Продукты'),
      menu('#/product-reports', 'Отчёт по продуктам'),
      menu('#/forecast', 'Прогноз закупок'),
    ),
    el('div', { class: 'card list-card' },
      menu('#/categories', 'Категории'),
      menu('#/banks', 'Банки'),
      menu('#/rates', 'Курсы тенге к евро'),
      menu('#/backup', 'Резервная копия'),
      menu('#/settings', 'Настройки'),
    ),
  );
}

/** @param {string} href @param {string} text */
function menu(href, text) {
  return el('a', { class: 'menu-row', href }, text, el('span', { class: 'muted' }, '›'));
}
