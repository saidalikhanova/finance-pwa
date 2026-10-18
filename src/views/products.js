import { el } from '../ui.js';
import { listProducts } from '../repo/products.js';
import { listCategories } from '../repo/categories.js';
import { listOperations } from '../repo/operations.js';
import { flattenItems } from '../products-stats.js';

/** @param {HTMLElement} root */
export async function renderProducts(root) {
  const [products, categories, ops] = await Promise.all([listProducts(), listCategories({ includeArchived: true }), listOperations({})]);
  const catName = (/** @type {string} */ id) => categories.find((c) => c.id === id)?.name ?? '';
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const f of flattenItems(ops)) counts.set(f.key, (counts.get(f.key) ?? 0) + 1);

  const search = el('input', { class: 'input', placeholder: 'Поиск', oninput: refresh });
  const list = el('div', { class: 'card list-card' });
  root.append(
    el('p', { class: 'muted small' }, 'Продукты появляются при импорте из чата и при вводе позиций покупки. Здесь можно переименовать продукт, сменить единицу и категорию или объединить дубликаты.'),
    search,
    el('div', { style: 'height:8px' }),
    list,
  );

  function refresh() {
    const q = search.value.trim().toLowerCase();
    const rows = products.filter((p) => !q || p.nameLower.includes(q));
    list.innerHTML = '';
    if (!rows.length) {
      list.append(el('p', { class: 'muted' }, products.length ? 'Ничего не найдено.' : 'Справочник пока пуст.'));
      return;
    }
    for (const p of rows) {
      list.append(
        el(
          'a',
          { class: 'menu-row', href: `#/products/${p.id}` },
          el('span', null, p.name, el('span', { class: 'muted small' }, ` · ${p.unit} · ${catName(p.categoryId)}`)),
          el('span', { class: 'muted small' }, `${counts.get(p.id) ?? 0} ›`),
        ),
      );
    }
  }
  refresh();
}
