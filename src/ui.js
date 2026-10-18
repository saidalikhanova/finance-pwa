// Небольшие помощники для построения интерфейса.

import { iconFor, iconSvg } from './icons.js';

/**
 * Создаёт элемент: el('button', { class: 'btn', onclick: fn }, 'Текст', child...)
 * @param {string} tag
 * @param {Record<string, any>} [attrs]
 * @param {...(Node | string | null | undefined | false)} children
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k in node && k !== 'list') /** @type {any} */ (node)[k] = v;
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/**
 * Устойчивый цвет категории по названию (оттенок HSL из хэша строки).
 * @param {string} name
 */
export function categoryColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 42% 46%)`;
}

/**
 * Кружок категории: иконка по названию, иначе первая буква.
 * @param {string} name
 * @param {{ income?: boolean, small?: boolean }} [opts]
 */
export function avatar(name, opts = {}) {
  const icon = iconFor(name) ?? (opts.income ? 'coins' : null);
  const content = icon ? iconSvg(icon, opts.small ? 16 : 20) : (name.trim()[0] ?? '·').toUpperCase();
  const cls = `avatar${opts.small ? ' avatar-sm' : ''}${opts.income ? ' avatar-income' : ''}`;
  const style = opts.income ? '' : `background:${categoryColor(name)}`;
  return el('div', { class: cls, style, 'aria-hidden': 'true' }, content);
}

/**
 * Пустое состояние: иконка, одна фраза и действие.
 * @param {string} icon — ключ из icons.js
 * @param {string} text
 * @param {string} [actionLabel]
 * @param {string} [href]
 */
export function emptyState(icon, text, actionLabel, href) {
  return el(
    'div',
    { class: 'empty-state' },
    el('div', { class: 'empty-icon' }, iconSvg(icon, 28)),
    el('p', { class: 'muted' }, text),
    actionLabel && href ? el('a', { class: 'btn btn-secondary btn-small', href }, actionLabel) : null,
  );
}

/**
 * Короткое сообщение внизу экрана.
 * @param {string} text
 * @param {{ error?: boolean, ms?: number }} [opts]
 */
export function toast(text, opts = {}) {
  document.querySelector('.toast')?.remove();
  const node = el('div', { class: `toast${opts.error ? ' toast-error' : ''}`, role: 'status' }, text);
  document.body.appendChild(node);
  setTimeout(() => node.remove(), opts.ms ?? 3000);
}

/**
 * Подтверждение действия.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export function confirmDialog(text) {
  return Promise.resolve(window.confirm(text));
}

/**
 * Дата «2026-10-18» → «18 окт.», с годом, если он не текущий.
 * @param {string} iso
 */
export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

/**
 * «2026-10» → «Октябрь 2026».
 * @param {string} month
 */
export function formatMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1).replace(' г.', '');
}

/**
 * Сдвиг месяца: shiftMonth('2026-01', -1) → '2025-12'.
 * @param {string} month
 * @param {number} delta
 */
export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Текущий месяц «ГГГГ-ММ». */
export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
