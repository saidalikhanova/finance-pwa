import { el, avatar } from '../ui.js';
import { childrenOf } from '../category-tree.js';

/**
 * Выбор категории кнопками: сначала категория, затем (если есть) статья внутри неё.
 * @param {{
 *   categories: import('../repo/categories.js').Category[],
 *   kind: 'expense' | 'income',
 *   onSelect: (c: import('../repo/categories.js').Category | null, label: string) => void,
 * }} opts
 */
export function categoryChips(opts) {
  const top = opts.categories.filter((c) => c.kind === opts.kind && !c.archived && !c.parentId);
  const chips = el('div', { class: 'chips' });
  const sub = el('div', { class: 'chips chips-sub', hidden: true });
  const wrap = el('div', null, chips, sub);

  /** @param {import('../repo/categories.js').Category} c */
  function pick(c) {
    chips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x.getAttribute('data-id') === c.id));
    const kids = childrenOf(opts.categories, c.id);
    sub.replaceChildren();
    sub.hidden = !kids.length;
    opts.onSelect(c, c.name);
    if (!kids.length) return;
    // Статья необязательна: «вся категория» — запись в саму категорию
    const all = el('button', { type: 'button', class: 'chip chip-small active', onclick: () => choose(all, c, c.name) }, `Вся «${c.name}»`);
    sub.append(el('span', { class: 'muted small chips-sub-label' }, 'Статья:'), all);
    for (const k of kids) {
      const b = el('button', { type: 'button', class: 'chip chip-small', 'data-id': k.id, onclick: () => choose(b, k, `${c.name} › ${k.name}`) }, k.name);
      sub.append(b);
    }
  }

  /** @param {Element} btn @param {import('../repo/categories.js').Category} c @param {string} label */
  function choose(btn, c, label) {
    sub.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === btn));
    opts.onSelect(c, label);
  }

  for (const c of top) {
    chips.append(el('button', { type: 'button', class: 'chip', 'data-id': c.id, onclick: () => pick(c) }, avatar(c.name, { small: true, income: opts.kind === 'income' }), c.name));
  }

  return {
    el: wrap,
    /** Выбрать по id (категория или статья) — для перехода с готовой категорией. @param {string} id */
    select(id) {
      const c = opts.categories.find((x) => x.id === id);
      if (!c) return;
      const parent = c.parentId ? opts.categories.find((x) => x.id === c.parentId) : c;
      if (!parent) return;
      pick(parent);
      if (c.parentId) /** @type {HTMLElement | null} */ (sub.querySelector(`[data-id="${c.id}"]`))?.click();
    },
    clear() {
      chips.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
      sub.replaceChildren();
      sub.hidden = true;
    },
  };
}
