import { el, avatar, emptyState, formatDate, formatMonth, shiftMonth, currentMonth } from '../ui.js';
import { formatMoney, formatRate } from '../money.js';
import { listOperations, monthRange } from '../repo/operations.js';
import { listCategories } from '../repo/categories.js';
import { withChildren, fullName } from '../category-tree.js';
import { categoryOptions } from './form-parts.js';

// Фильтры сохраняются между переходами, чтобы после редактирования
// операции список открылся в том же месяце.
const state = {
  month: currentMonth(),
  /** @type {'' | 'expense' | 'income'} */
  type: '',
  categoryId: '',
};

/** @param {HTMLElement} root */
export async function renderOperations(root, params = {}) {
  // Переход из круга категорий / отчёта: #/operations?month=ГГГГ-ММ&category=ID
  if (params.month && /^\d{4}-\d{2}$/.test(params.month)) state.month = params.month;
  if (params.category !== undefined) state.categoryId = params.category;
  const categories = await listCategories({ includeArchived: true });
  const byId = new Map(categories.map((c) => [c.id, c]));

  const list = el('div');

  const monthLabel = el('span', { class: 'month-label' }, formatMonth(state.month));
  const typeSelect = el(
    'select',
    { class: 'select', value: state.type, 'aria-label': 'Тип', onchange: onFilterChange },
    el('option', { value: '' }, 'Все'),
    el('option', { value: 'expense' }, 'Расходы'),
    el('option', { value: 'income' }, 'Доходы'),
  );
  const catSelect = el(
    'select',
    { class: 'select', 'aria-label': 'Категория', onchange: onFilterChange },
    el('option', { value: '' }, 'Все категории'),
    ...categoryOptions(categories, 'expense', state.categoryId),
    ...categoryOptions(categories, 'income', state.categoryId),
  );
  typeSelect.value = state.type;
  catSelect.value = state.categoryId;

  function onFilterChange() {
    state.type = /** @type {any} */ (typeSelect.value);
    state.categoryId = catSelect.value;
    refresh();
  }

  root.append(
    el(
      'div',
      { class: 'filters' },
      el(
        'div',
        { class: 'month-nav' },
        el('button', { class: 'icon-btn', 'aria-label': 'Предыдущий месяц', onclick: () => go(-1) }, '‹'),
        monthLabel,
        el('button', { class: 'icon-btn', 'aria-label': 'Следующий месяц', onclick: () => go(1) }, '›'),
      ),
      el('div', { class: 'filter-row' }, typeSelect, catSelect),
    ),
    el('div', { class: 'btn-row' }, el('a', { class: 'btn btn-secondary btn-small', href: '#/import' }, 'Импорт из чата')),
    list,
    el('a', { class: 'fab', href: '#/add', 'aria-label': 'Добавить расход' }, '+'),
  );

  /** @param {number} delta */
  function go(delta) {
    state.month = shiftMonth(state.month, delta);
    monthLabel.textContent = formatMonth(state.month);
    refresh();
  }

  async function refresh() {
    const ops = await listOperations({
      ...monthRange(state.month),
      type: state.type || undefined,
      categoryIds: state.categoryId ? withChildren(categories, state.categoryId) : undefined,
    });
    list.innerHTML = '';

    if (!ops.length) {
      list.append(emptyState('basket', state.categoryId || state.type ? 'По этому фильтру операций нет' : 'За этот месяц операций ещё нет', 'Добавить расход', '#/add'));
      return;
    }

    let expenseEur = 0;
    let incomeEur = 0;
    let unknownRate = 0;
    for (const o of ops) {
      if (o.amountEur == null) unknownRate++;
      else if (o.type === 'expense') expenseEur += o.amountEur;
      else incomeEur += o.amountEur;
    }
    list.append(
      el(
        'div',
        { class: 'card totals' },
        el('div', null, el('span', { class: 'muted' }, 'Доходы'), el('span', { class: 'income' }, formatMoney(incomeEur, 'EUR'))),
        el('div', null, el('span', { class: 'muted' }, 'Расходы'), el('span', { class: 'expense' }, formatMoney(expenseEur, 'EUR'))),
        el('div', null, el('span', { class: 'muted' }, 'Баланс'), el('span', null, formatMoney(incomeEur - expenseEur, 'EUR', { sign: true }))),
        unknownRate ? el('p', { class: 'muted small' }, `Без курса: ${unknownRate} — в итоги не входят.`) : null,
      ),
    );

    let lastDate = '';
    let group = el('div', { class: 'list' });
    for (const o of ops) {
      if (o.date !== lastDate) {
        lastDate = o.date;
        // Итог дня: расходы в евро за эту дату
        const daySpent = ops.filter((x) => x.date === o.date && x.type === 'expense' && x.amountEur != null).reduce((s, x) => s + /** @type {number} */ (x.amountEur), 0);
        list.append(el('h3', { class: 'date-head date-head-total' }, el('span', null, formatDate(o.date)), daySpent ? el('span', null, formatMoney(-daySpent, 'EUR')) : null));
        group = el('div', { class: 'list' });
        list.append(group);
      }
      const cat = byId.get(o.categoryId);
      const n = o.items?.length ?? 0;
      const catName = fullName(cat, byId);
      const title = n ? `${o.store || catName} · ${n} поз.` : o.store ? `${catName} · ${o.store}` : catName;
      const subParts = [n ? [...new Set(o.items.map((it) => (byId.get(it.categoryId) ? fullName(byId.get(it.categoryId), byId) : '')))].filter(Boolean).join(', ') : '', o.comment !== o.store ? o.comment : '', o.photoId ? '📷' : ''].filter(Boolean);
      const amount = formatMoney(o.type === 'expense' ? -o.amount : o.amount, o.currency, { sign: true });
      const eur =
        o.currency === 'KZT'
          ? o.amountEur == null
            ? 'курс не определён'
            : `≈ ${formatMoney(o.amountEur, 'EUR')} · курс ${formatRate(o.rate ?? 0)}`
          : '';
      group.append(
        el(
          'a',
          { class: 'row', href: `#/operations/${o.id}` },
          avatar(catName, { income: o.type === 'income' }),
          el('div', { class: 'row-main' }, el('div', null, title), subParts.length ? el('div', { class: 'muted small' }, subParts.join(' · ')) : null),
          el(
            'div',
            { class: 'row-amount' },
            el('div', { class: o.type }, amount),
            eur ? el('div', { class: `muted small${o.amountEur == null ? ' warn' : ''}` }, eur) : null,
          ),
        ),
      );
    }
  }

  await refresh();
}
