import { el, formatDate } from '../ui.js';
import { formatMoney, toEurCents } from '../money.js';
import { listWishes, WISH_STATUS_LABEL, PRIORITY_LABEL, PRIORITY_ORDER } from '../repo/wishes.js';
import { listCategories } from '../repo/categories.js';
import { suggestRate } from '../repo/rates.js';
import { todayISO } from '../repo/operations.js';
import { getPhoto } from '../photos.js';

const state = {
  /** @type {import('../repo/wishes.js').WishStatus} */
  status: 'want',
  sort: 'priority',
  categoryId: '',
};

/** @param {HTMLElement} root */
export async function renderWishes(root) {
  const [wishes, categories] = await Promise.all([listWishes(), listCategories({ includeArchived: true })]);
  const catName = (/** @type {string} */ id) => categories.find((c) => c.id === id)?.name ?? 'Без категории';
  const rate = (await suggestRate(todayISO()))?.rate ?? null;

  const statusToggle = el('div', { class: 'segmented' });
  for (const [v, label] of Object.entries(WISH_STATUS_LABEL)) {
    const b = el('button', { type: 'button', class: v === state.status ? 'active' : '' }, v === 'planned' ? 'В плане' : label);
    b.addEventListener('click', () => {
      state.status = /** @type {any} */ (v);
      statusToggle.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      refresh();
    });
    statusToggle.append(b);
  }
  const sortSelect = el(
    'select',
    { class: 'select', 'aria-label': 'Сортировка', onchange: () => ((state.sort = sortSelect.value), refresh()) },
    el('option', { value: 'priority' }, 'По приоритету'),
    el('option', { value: 'price' }, 'По цене'),
    el('option', { value: 'date' }, 'По дате добавления'),
    el('option', { value: 'category' }, 'По категории'),
  );
  sortSelect.value = state.sort;
  const usedCats = [...new Set(wishes.map((w) => w.categoryId))];
  const catSelect = el(
    'select',
    { class: 'select', 'aria-label': 'Категория', onchange: () => ((state.categoryId = catSelect.value), refresh()) },
    el('option', { value: '' }, 'Все категории'),
    ...categories.filter((c) => usedCats.includes(c.id)).map((c) => el('option', { value: c.id }, c.name)),
  );
  catSelect.value = state.categoryId;

  const total = el('div', { class: 'card tile' });
  const list = el('div');
  root.append(
    el('div', { class: 'filters' }, statusToggle, el('div', { class: 'filter-row', style: 'margin-top:8px' }, sortSelect, catSelect)),
    total,
    list,
    el('a', { class: 'fab', href: '#/wishes/new', 'aria-label': 'Добавить запись' }, '+'),
  );

  async function refresh() {
    let rows = wishes.filter((w) => w.status === state.status && (!state.categoryId || w.categoryId === state.categoryId));
    const eur = (/** @type {import('../repo/wishes.js').Wish} */ w) => (w.price == null ? null : toEurCents(w.price, w.currency, rate));
    rows.sort((a, b) => {
      switch (state.sort) {
        case 'price':
          return (eur(b) ?? -1) - (eur(a) ?? -1);
        case 'date':
          return b.createdAt.localeCompare(a.createdAt);
        case 'category':
          return catName(a.categoryId).localeCompare(catName(b.categoryId), 'ru') || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        default:
          return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.createdAt.localeCompare(a.createdAt);
      }
    });

    let sum = 0;
    let unknown = 0;
    for (const w of rows) {
      const e = eur(w);
      if (e == null) unknown++;
      else sum += e;
    }
    total.replaceChildren(
      el('div', { class: 'muted small' }, `${WISH_STATUS_LABEL[state.status]} · ${rows.length} зап.`),
      el('div', { class: 'tile-value' }, `≈ ${formatMoney(sum, 'EUR')}${unknown ? ` + ${unknown} без цены/курса` : ''}`),
    );

    list.innerHTML = '';
    if (!rows.length) {
      list.append(el('p', { class: 'muted empty' }, 'Записей нет.'));
      return;
    }
    const group = el('div', { class: 'list' });
    list.append(group);
    for (const w of rows) {
      const thumb = el('div', { class: 'thumb' });
      if (w.photoId) {
        getPhoto(w.photoId).then((blob) => {
          if (!blob) return;
          const img = el('img', { src: URL.createObjectURL(blob), alt: '' });
          img.addEventListener('load', () => URL.revokeObjectURL(img.src));
          thumb.replaceChildren(img);
        });
      }
      const sub = [PRIORITY_LABEL[w.priority], catName(w.categoryId)];
      if (w.status === 'bought' && w.boughtAt) sub.push(`куплено ${formatDate(w.boughtAt)}`);
      const price = w.status === 'bought' && w.actualPrice != null ? w.actualPrice : w.price;
      group.append(
        el(
          'a',
          { class: 'row wish-row', href: `#/wishes/${w.id}` },
          thumb,
          el('div', { class: 'row-main' }, el('div', null, w.name), el('div', { class: 'muted small' }, sub.join(' · '))),
          el('div', { class: 'row-amount' }, price != null ? formatMoney(price, w.currency) : el('span', { class: 'muted small' }, 'без цены')),
        ),
      );
    }
  }

  await refresh();
}
