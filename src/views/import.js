import { el, toast, formatDate } from '../ui.js';
import { formatMoney } from '../money.js';
import { navigate } from '../router.js';
import { listCategories } from '../repo/categories.js';
import { listProducts } from '../repo/products.js';
import { parseChatImport, buildClaudePrompt } from '../chat-import.js';
import { applyImport } from '../repo/import.js';
import { itemsEditor } from './items-editor.js';
import { field } from './form-parts.js';

/** @param {HTMLElement} root */
export async function renderImport(root) {
  const categories = await listCategories({ includeArchived: true });

  const textarea = el('textarea', { class: 'input textarea', rows: 8, placeholder: 'Вставьте сюда JSON из чата' });
  const preview = el('div');

  root.append(
    el('div', { class: 'card' },
      el('p', { class: 'small', style: 'margin:0 0 8px' }, '1. Скопируйте инструкцию и вставьте её в чат с Claude вместе с фотографией чека. 2. Полученный JSON вставьте ниже.'),
      el('button', { class: 'btn btn-secondary', type: 'button', style: 'width:100%', onclick: copyPrompt }, 'Скопировать инструкцию для Claude'),
    ),
    field('JSON из чата', textarea),
    el('button', { class: 'btn', type: 'button', style: 'width:100%', onclick: parse }, 'Разобрать'),
    preview,
  );

  async function copyPrompt() {
    const products = await listProducts();
    const text = buildClaudePrompt(categories, products, new Map(categories.map((c) => [c.id, c.name])));
    try {
      await navigator.clipboard.writeText(text);
      toast('Инструкция скопирована');
    } catch {
      const ta = el('textarea', { class: 'input textarea', rows: 10 }, text);
      preview.replaceChildren(el('p', { class: 'muted small' }, 'Скопируйте текст вручную:'), ta);
      ta.select();
    }
  }

  function parse() {
    const { purchases, errors } = parseChatImport(textarea.value, categories);
    preview.innerHTML = '';
    if (errors.length) preview.append(el('div', { class: 'card' }, el('div', { class: 'over small' }, 'Замечания:'), ...errors.map((e) => el('div', { class: 'small' }, `• ${e}`))));
    if (!purchases.length) {
      if (!errors.length) preview.append(el('p', { class: 'muted' }, 'Покупок не найдено.'));
      return;
    }

    /** @type {{ p: import('../chat-import.js').ParsedPurchase, editor: ReturnType<typeof itemsEditor>, date: HTMLInputElement, store: HTMLInputElement }[]} */
    const blocks = [];
    for (const p of purchases) {
      const date = /** @type {HTMLInputElement} */ (el('input', { class: 'input input-sm', type: 'date', value: p.date }));
      const store = /** @type {HTMLInputElement} */ (el('input', { class: 'input', value: p.store, placeholder: 'Магазин' }));
      const editor = itemsEditor(
        p.items.map((it) => ({ productId: null, name: it.name, qty: it.qty, unit: it.unit, price: it.price, sum: it.sum, categoryId: it.categoryId, wasted: 0 })),
        { categories, currency: () => p.currency },
      );
      const unknown = p.items.filter((it) => !it.categoryId).map((it) => it.categoryName || '(пусто)');
      preview.append(
        el('div', { class: 'card' },
          el('div', { class: 'row-top' }, el('strong', null, `${formatDate(p.date)} · ${p.currency}`), el('span', null, formatMoney(editor.total(), p.currency))),
          unknown.length ? el('p', { class: 'warn small' }, `Категории не найдены: ${[...new Set(unknown)].join(', ')} — выберите в позициях.`) : null,
          el('div', { class: 'item-line', style: 'margin:8px 0' }, date, store),
          editor.el,
        ),
      );
      blocks.push({ p, editor, date, store });
    }

    const addProducts = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', checked: true }));
    preview.append(
      el('label', { class: 'cat-row' }, addProducts, el('span', null, 'Добавить новые продукты в справочник')),
      el('button', { class: 'btn', type: 'button', style: 'width:100%', onclick: confirm }, `Создать операции (${purchases.length})`),
    );

    async function confirm() {
      const final = blocks.map((b) => ({
        ...b.p,
        date: b.date.value,
        store: b.store.value.trim(),
        items: b.editor.read().map((it) => ({ ...it, categoryName: '' })),
      }));
      try {
        const r = await applyImport(final, { addProducts: addProducts.checked });
        toast(`Создано операций: ${r.operations}${r.newProducts ? `, новых продуктов: ${r.newProducts}` : ''}`);
        navigate('/operations');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Не удалось создать операции', { error: true });
      }
    }
  }
}
