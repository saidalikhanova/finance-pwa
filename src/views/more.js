import { el } from '../ui.js';

/** @param {HTMLElement} root */
export function renderMore(root) {
  root.append(
    el(
      'div',
      { class: 'card list-card' },
      menu('#/payments', 'Платежи'),
      menu('#/calendar', 'Календарь платежей'),
      menu('#/wishes', 'Желаемые покупки'),
      menu('#/categories', 'Категории'),
      menu('#/rates', 'Курсы тенге к евро'),
    ),
    el('p', { class: 'muted small' }, 'Резервная копия и настройки появятся на этапе 9.'),
  );
}

/** @param {string} href @param {string} text */
function menu(href, text) {
  return el('a', { class: 'menu-row', href }, text, el('span', { class: 'muted' }, '›'));
}
