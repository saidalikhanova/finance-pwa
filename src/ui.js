// Небольшие помощники для построения интерфейса.

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
