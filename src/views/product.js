import { el, toast, confirmDialog, formatDate } from '../ui.js';
import { formatMoney } from '../money.js';
import { UNITS, formatQty, parseQty } from '../items.js';
import { navigate } from '../router.js';
import { listProducts, getProduct, saveProduct, mergeProducts, setItemWasted } from '../repo/products.js';
import { listCategories } from '../repo/categories.js';
import { listOperations } from '../repo/operations.js';
import { priceHistory } from '../products-stats.js';
import { field, categorySelectFor } from './form-parts.js';

/**
 * Карточка продукта: правка, объединение, история цен, отметка «выброшено».
 * @param {HTMLElement} root
 * @param {Record<string, string>} params
 */
export async function renderProduct(root, params) {
  const product = await getProduct(params.id);
  if (!product) {
    root.append(el('p', { class: 'muted' }, 'Продукт не найден.'));
    return;
  }
  const [categories, products, ops] = await Promise.all([listCategories({ includeArchived: true }), listProducts(), listOperations({})]);

  const nameInput = el('input', { class: 'input', value: product.name, maxlength: 80 });
  const unitSelect = el('select', { class: 'select' }, ...UNITS.map((u) => el('option', { value: u }, u)));
  unitSelect.value = product.unit;
  const categorySelect = categorySelectFor(categories, product.categoryId);
  categorySelect.fill('expense');

  root.append(
    el(
      'form',
      {
        class: 'form',
        novalidate: true,
        onsubmit: async (/** @type {Event} */ e) => {
          e.preventDefault();
          try {
            await saveProduct({ ...product, name: nameInput.value, unit: unitSelect.value, categoryId: categorySelect.el.value });
            toast('Сохранено');
            navigate('/products');
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Ошибка', { error: true });
          }
        },
      },
      field('Название', nameInput),
      field('Основная единица', unitSelect),
      field('Категория по умолчанию', categorySelect.el),
      el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'submit' }, 'Сохранить')),
    ),
  );

  // Объединение дубликатов
  const others = products.filter((p) => p.id !== product.id);
  if (others.length) {
    const target = el('select', { class: 'select' }, el('option', { value: '' }, 'Выберите продукт'), ...others.map((p) => el('option', { value: p.id }, p.name)));
    root.append(
      el('h2', { class: 'section-title' }, 'Объединить с другим продуктом'),
      el('p', { class: 'muted small' }, `Все покупки «${product.name}» перейдут к выбранному продукту, а эта запись будет удалена.`),
      el('div', { class: 'add-row' }, target, el('button', {
        class: 'btn btn-small btn-danger',
        type: 'button',
        onclick: async () => {
          if (!target.value) return;
          const into = others.find((p) => p.id === target.value);
          if (!(await confirmDialog(`Объединить «${product.name}» с «${into?.name}»?`))) return;
          try {
            const n = await mergeProducts(product.id, target.value);
            toast(`Объединено, изменено позиций: ${n}`);
            navigate(`/products/${target.value}`);
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Ошибка', { error: true });
          }
        },
      }, 'Объединить')),
    );
  }

  // История цены и отметка «выброшено»
  const history = priceHistory(ops, product.id);
  root.append(el('h2', { class: 'section-title' }, 'История покупок и цен'));
  if (!history.length) {
    root.append(el('p', { class: 'muted' }, 'Покупок пока нет.'));
    return;
  }
  const card = el('div', { class: 'card list-card' });
  for (const h of history) {
    const wastedInput = el('input', { class: 'input input-sm', inputmode: 'decimal', value: h.wasted ? formatQty(h.wasted) : '', placeholder: '0', 'aria-label': 'Выброшено' });
    wastedInput.addEventListener('change', async () => {
      const v = wastedInput.value.trim() ? parseQty(wastedInput.value) : 0;
      if (v == null) {
        toast('Введите количество, например 0,5', { error: true });
        return;
      }
      try {
        await setItemWasted(h.operationId, h.index, v);
        toast('Отметка сохранена');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Ошибка', { error: true });
      }
    });
    card.append(
      el(
        'div',
        { class: 'cat-row' },
        el('span', { class: 'cat-name' },
          el('a', { href: `#/operations/${h.operationId}`, style: 'color:inherit;text-decoration:none' }, `${formatDate(h.date)}${h.store ? ` · ${h.store}` : ''}`),
          el('div', { class: 'muted small' }, `${formatQty(h.qty)} ${h.unit} · ${formatMoney(h.price, h.currency)}/${h.unit}${h.eurPrice != null && h.currency !== 'EUR' ? ` (≈ ${formatMoney(h.eurPrice, 'EUR')})` : ''}`),
        ),
        el('label', { class: 'small muted', style: 'display:flex;align-items:center;gap:4px' }, 'выброшено', wastedInput),
      ),
    );
  }
  root.append(card);
}
