import { el } from '../ui.js';

/** @param {HTMLElement} root */
export function renderMore(root) {
  root.append(
    el(
      'div',
      { class: 'card list-card' },
      el('a', { class: 'menu-row', href: '#/categories' }, 'Категории', el('span', { class: 'muted' }, '›')),
    ),
    el('p', { class: 'muted small' }, 'Резервная копия и настройки появятся на этапе 9.'),
  );
}
