import { el, avatar } from '../ui.js';
import { childrenOf } from '../category-tree.js';

/**
 * Выбор категории кнопками: сначала категория, затем (если есть) статья внутри неё.
 * @param {{
 *   categories: import('../repo/categories.js').Category[],
 *   kind: 'expense' | 'income',
 *   onSelect: (c: import('../repo/categories.js').Category | null, label: string) => void,
 *   frequent?: string[] — id самых частых категорий: показываются первыми, остальные — за «ещё»
 * }} opts
 */
export function categoryChips(opts) {
  let top = opts.categories.filter((c) => c.kind === opts.kind && !c.archived && !c.parentId);
  const chips = el('div', { class: 'chips' });
  /** @type {import('../repo/categories.js').Category[]} */
  let rest = [];
  if (opts.frequent?.length && top.length > opts.frequent.length + 1) {
    const order = new Map(opts.frequent.map((id, i) => [id, i]));
    const shown = top.filter((c) => order.has(c.id)).sort((a, b) => /** @type {number} */ (order.get(a.id)) - /** @type {number} */ (order.get(b.id)));
    rest = top.filter((c) => !order.has(c.id));
    top = shown;
  }
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

  const chipOf = (/** @type {import('../repo/categories.js').Category} */ c) => el('button', { type: 'button', class: 'chip', 'data-id': c.id, onclick: () => pick(c) }, avatar(c.name, { small: true, income: opts.kind === 'income' }), c.name);
  for (const c of top) chips.append(chipOf(c));
  if (rest.length) {
    const more = el('button', { type: 'button', class: 'chip chip-more', onclick: () => {
      more.remove();
      for (const c of rest) chips.append(chipOf(c));
      rest = [];
    } }, `ещё ${rest.length}`);
    chips.append(more);
  }

  return {
    el: wrap,
    /** Выбрать по id (категория или статья) — для перехода с готовой категорией. @param {string} id */
    select(id) {
      const c = opts.categories.find((x) => x.id === id);
      if (!c) return;
      const parent = c.parentId ? opts.categories.find((x) => x.id === c.parentId) : c;
      if (!parent) return;
      // Категория спрятана за «ещё» — раскрываем
      if (!chips.querySelector(`[data-id="${parent.id}"]`)) /** @type {HTMLElement | null} */ (chips.querySelector('.chip-more'))?.click();
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
