import { el } from '../ui.js';
import { categoryOptions } from './form-parts.js';
import { formatMoney, parseAmount, amountToInput } from '../money.js';
import { UNITS, parseQty, formatQty, lineSum, itemsTotal } from '../items.js';

/**
 * Редактор позиций покупки. Работает с массивом в памяти; вызывающий код
 * получает актуальные позиции через read().
 * @param {import('../items.js').Item[]} initial
 * @param {{ categories: import('../repo/categories.js').Category[], currency: () => 'EUR' | 'KZT', onChange?: () => void }} opts
 */
export function itemsEditor(initial, opts) {
  /** @type {import('../items.js').Item[]} */
  const items = initial.map((it) => ({ ...it }));
  const list = el('div', { class: 'items' });
  const totalEl = el('div', { class: 'items-total' });
  const root = el(
    'div',
    { class: 'items-editor' },
    list,
    el('div', { class: 'add-row' }, el('button', { class: 'btn btn-secondary btn-small', type: 'button', onclick: add }, '+ Позиция'), totalEl),
  );

  const expenseCats = opts.categories.filter((c) => c.kind === 'expense');

  let ready = false;
  function render() {
    list.innerHTML = '';
    items.forEach((it, i) => list.append(row(it, i)));
    totalEl.textContent = items.length ? `Итого: ${formatMoney(itemsTotal(items), opts.currency())}` : '';
    // При первом построении вызывающий код ещё не получил объект редактора.
    if (ready) opts.onChange?.();
  }

  /** @param {import('../items.js').Item} it @param {number} i */
  function row(it, i) {
    const name = el('input', { class: 'input', value: it.name, placeholder: 'Продукт', oninput: () => (it.name = name.value) });
    const qty = el('input', { class: 'input input-sm', inputmode: 'decimal', value: formatQty(it.qty), 'aria-label': 'Количество', oninput: () => {
      const q = parseQty(qty.value);
      if (q != null) {
        it.qty = q;
        if (it.price) {
          it.sum = lineSum(it.price, q);
          sum.value = amountToInput(it.sum);
        }
        totalEl.textContent = `Итого: ${formatMoney(itemsTotal(items), opts.currency())}`;
        opts.onChange?.();
      }
    } });
    const unit = el('select', { class: 'select input-sm', 'aria-label': 'Единица', onchange: () => (it.unit = unit.value) }, ...UNITS.map((u) => el('option', { value: u }, u)));
    unit.value = it.unit;
    const sum = el('input', { class: 'input input-sm', inputmode: 'decimal', value: amountToInput(it.sum), 'aria-label': 'Сумма', oninput: () => {
      const s = parseAmount(sum.value) ?? (sum.value.trim() === '0' ? 0 : null);
      if (s != null) {
        it.sum = s;
        totalEl.textContent = `Итого: ${formatMoney(itemsTotal(items), opts.currency())}`;
        opts.onChange?.();
      }
    } });
    const cat = el('select', { class: `select${it.categoryId ? '' : ' select-missing'}`, 'aria-label': 'Категория', onchange: () => {
      it.categoryId = cat.value;
      cat.classList.toggle('select-missing', !cat.value);
    } }, el('option', { value: '' }, 'Категория…'), ...categoryOptions(expenseCats, 'expense', it.categoryId));
    cat.value = it.categoryId;
    const del = el('button', { class: 'link-btn', type: 'button', 'aria-label': 'Удалить позицию', onclick: () => {
      items.splice(i, 1);
      render();
    } }, '✕');
    return el(
      'div',
      { class: 'item-row' },
      el('div', { class: 'item-line' }, name, del),
      el('div', { class: 'item-line' }, qty, unit, sum, cat),
    );
  }

  function add() {
    items.push({ productId: null, name: '', qty: 1000, unit: 'шт', price: 0, sum: 0, categoryId: expenseCats[0]?.id ?? '', wasted: 0 });
    render();
    /** @type {HTMLInputElement | null} */ (list.querySelector('.item-row:last-child input'))?.focus();
  }

  render();
  ready = true;
  return {
    el: root,
    read: () => items.map((it) => ({ ...it })),
    get length() {
      return items.length;
    },
    total: () => itemsTotal(items),
  };
}
