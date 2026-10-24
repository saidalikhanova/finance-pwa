import { el, avatar, toast, promptDialog } from '../ui.js';
import {
  listCategories,
  createCategory,
  renameCategory,
  setCategoryArchived,
  countOperationsInCategory,
  KIND_LABEL,
} from '../repo/categories.js';

/** @param {HTMLElement} root */
export async function renderCategories(root) {
  const container = el('div');
  root.append(container);

  async function refresh() {
    const all = await listCategories({ includeArchived: true });
    container.innerHTML = '';

    // Источники дохода настраиваются в «Бюджете» (название, работодатель, срок, план, архив)
    for (const kind of /** @type {const} */ (['expense'])) {
      const active = all.filter((c) => c.kind === kind && !c.archived);
      const archived = all.filter((c) => c.kind === kind && c.archived);

      const addInput = el('input', { class: 'input', placeholder: 'Новая категория', maxlength: 60 });
      const addForm = el(
        'form',
        {
          class: 'add-row',
          onsubmit: async (/** @type {Event} */ e) => {
            e.preventDefault();
            try {
              await createCategory(addInput.value, kind);
              toast('Категория добавлена');
              refresh();
            } catch (err) {
              toast(err instanceof Error ? err.message : 'Ошибка', { error: true });
            }
          },
        },
        addInput,
        el('button', { class: 'btn btn-small', type: 'submit' }, 'Добавить'),
      );

      container.append(
        el('h2', { class: 'section-title' }, KIND_LABEL[kind]),
        el('div', { class: 'card list-card' }, ...(await Promise.all(active.map((c) => row(c)))), addForm),
      );

      if (archived.length) {
        const details = el('details', { class: 'card list-card' });
        details.append(el('summary', { class: 'muted' }, `В архиве: ${archived.length}`));
        for (const c of archived) details.append(await row(c));
        container.append(details);
      }
    }
    container.append(
      el('h2', { class: 'section-title' }, 'Доходы'),
      el('a', { class: 'row card', href: '#/budget', style: 'color:inherit;text-decoration:none' },
        avatar('Доходы', { income: true, small: true }),
        el('div', { class: 'row-main' }, el('div', null, 'Источники дохода'), el('div', { class: 'muted small' }, 'Настраиваются в «Бюджете» → «Доходы»: название, работодатель, срок выплаты, план, архив.')),
        el('span', { class: 'muted' }, '›'),
      ),
    );
  }

  /** @param {import('../repo/categories.js').Category} c */
  async function row(c) {
    const n = await countOperationsInCategory(c.id);
    const name = el('span', { class: 'cat-name' }, c.name);
    const info = el('span', { class: 'muted small' }, n ? `${n} опер.` : '');

    const rename = el('button', {
      class: 'link-btn',
      type: 'button',
      'aria-label': `Переименовать ${c.name}`,
      onclick: async () => {
        const next = await promptDialog('Новое название категории', c.name);
        if (next == null || next.trim() === c.name) return;
        try {
          await renameCategory(c.id, next);
          toast('Категория переименована');
          refresh();
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Ошибка', { error: true });
        }
      },
    }, '✎');

    const archive = el('button', {
      class: 'link-btn',
      type: 'button',
      onclick: async () => {
        await setCategoryArchived(c.id, !c.archived);
        toast(c.archived ? 'Категория возвращена из архива' : 'Категория перенесена в архив');
        refresh();
      },
    }, c.archived ? 'Вернуть' : 'В архив');

    return el('div', { class: 'cat-row' }, avatar(c.name, { income: c.kind === 'income', small: true }), name, info, rename, archive);
  }

  await refresh();
}
