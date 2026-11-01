import { el } from '../ui.js';
import { listProducts } from '../repo/products.js';
import { listCategories } from '../repo/categories.js';
import { listOperations } from '../repo/operations.js';
import { flattenItems } from '../products-stats.js';

/** @param {HTMLElement} root */
export async function renderProducts(root) {
  const [products, categories, ops] = await Promise.all([listProducts(), listCategories({ includeArchived: true }), listOperations({})]);
  const byId = new Map(categories.map((c) => [c.id, c]));
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const f of flattenItems(ops)) counts.set(f.key, (counts.get(f.key) ?? 0) + 1);

  const search = el('input', { class: 'input', placeholder: 'Поиск', oninput: refresh });
  const list = el('div');
  root.append(
    el('p', { class: 'muted small' }, 'Всё, что вы покупаете. Заполняется само из чеков: один товар — одна запись, какой бы ни была марка. Справа — сколько раз покупали. Нажмите на товар, чтобы переименовать его, сменить категорию или объединить с дублем.'),
    search,
    el('div', { style: 'height:8px' }),
    list,
  );

  function refresh() {
    const q = search.value.trim().toLowerCase();
    const rows = products.filter((p) => !q || p.nameLower.includes(q));
    list.innerHTML = '';
    if (!rows.length) {
      list.append(el('p', { class: 'muted' }, products.length ? 'Ничего не найдено.' : 'Справочник пока пуст. Он заполнится сам, когда вы сфотографируете чек.'));
      return;
    }
    // По категориям верхнего уровня; статья показывается рядом с товаром
    /** @type {Map<string, typeof rows>} */
    const groups = new Map();
    for (const p of rows) {
      const cat = byId.get(p.categoryId);
      const top = cat?.parentId ? byId.get(cat.parentId) : cat;
      const name = top?.name ?? 'Без категории';
      groups.set(name, [...(groups.get(name) ?? []), p]);
    }
    for (const [name, items] of [...groups].sort((a, b) => a[0].localeCompare(b[0], 'ru'))) {
      list.append(el('h2', { class: 'section-title' }, `${name} · ${items.length}`));
      const card = el('div', { class: 'card list-card' });
      for (const p of items.sort((a, b) => a.name.localeCompare(b.name, 'ru'))) {
        const n = counts.get(p.id) ?? 0;
        const article = byId.get(p.categoryId)?.parentId ? ` · ${byId.get(p.categoryId)?.name}` : '';
        card.append(el('a', { class: 'menu-row', href: `#/products/${p.id}` },
          el('span', null, p.name, el('span', { class: 'muted small' }, ` · ${p.unit}${article}`)),
          el('span', { class: 'muted small' }, `${n} ×  ›`)));
      }
      list.append(card);
    }
  }
  refresh();
}
