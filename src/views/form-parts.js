// Общие части форм: поле с подписью, переключатель, выбор категории.

import { el } from '../ui.js';

/**
 * @param {string} label
 * @param {...(Node | null)} controls
 */
export function field(label, ...controls) {
  return el('label', { class: 'field' }, el('span', { class: 'field-label' }, label), ...controls.filter(Boolean));
}

/**
 * Подпись поля «категория»: у доходов — «Источник» (источник дохода).
 * @param {string} kind
 */
export function categoryLabel(kind) {
  return kind === 'income' ? 'Источник' : 'Категория';
}

/**
 * Переключатель из нескольких кнопок.
 * @param {[string, string][]} options — [значение, подпись]
 * @param {string} value
 * @param {(v: string) => void} onChange
 */
export function segmented(options, value, onChange) {
  const wrap = el('div', { class: 'segmented', role: 'group' });
  for (const [v, label] of options) {
    const b = el('button', { type: 'button', class: v === value ? 'active' : '', dataset: { value: v } }, label);
    b.addEventListener('click', () => {
      wrap.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      onChange(v);
    });
    wrap.append(b);
  }
  return wrap;
}

/**
 * Выпадающий список категорий заданного вида. Архивные показываются,
 * только если уже выбраны.
 * @param {import('../repo/categories.js').Category[]} categories
 * @param {string | undefined} current
 */
export function categorySelectFor(categories, current) {
  const select = el('select', { class: 'select', required: true });
  return {
    el: select,
    /** @param {string} kind */
    fill(kind) {
      select.innerHTML = '';
      select.append(el('option', { value: '', disabled: true, selected: true }, kind === 'income' ? 'Выберите источник' : 'Выберите категорию'));
      for (const c of categories) {
        if (c.kind !== kind) continue;
        if (c.archived && c.id !== current) continue;
        select.append(el('option', { value: c.id }, c.archived ? `${c.name} (архив)` : c.name));
      }
      if (current && [...select.options].some((o) => o.value === current)) select.value = current;
    },
  };
}

/**
 * Форма слова по числу: plural(3, 'операции', 'операциям', 'операциям').
 * @param {number} n @param {string} one @param {string} few @param {string} many
 */
export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
