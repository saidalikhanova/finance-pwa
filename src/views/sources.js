import { el, avatar, toast, confirmDialog, promptDialog } from '../ui.js';
import { listSources, addSource, renameSource, removeSource, sourceUsage } from '../repo/sources.js';

/**
 * Справочник источников оплаты.
 * @param {HTMLElement} root
 */
export async function renderSources(root) {
  const container = el('div');
  root.append(
    el('p', { class: 'muted small', style: 'margin:0 4px 12px' }, 'Чем вы платите: наличные, карты, кошельки. Выбирается при записи расхода, чтобы потом видеть, с какой карты что списалось.'),
    container,
  );

  async function refresh() {
    const sources = await listSources();
    const usage = await sourceUsage();
    const input = el('input', { class: 'input', placeholder: 'Например: Наличные, Kaspi', maxlength: 40 });
    const addForm = el('form', { class: 'add-row', onsubmit: async (/** @type {Event} */ e) => {
      e.preventDefault();
      try {
        await addSource(/** @type {HTMLInputElement} */ (input).value);
        toast('Добавлено');
        refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Ошибка', { error: true });
      }
    } }, input, el('button', { class: 'btn btn-small', type: 'submit' }, 'Добавить'));

    const rows = sources.map((s) => {
      const n = usage.get(s) ?? 0;
      return el('div', { class: 'cat-row' },
        avatar(s, { small: true }),
        el('span', { class: 'cat-name' }, s),
        el('span', { class: 'muted small' }, n ? `операций: ${n}` : ''),
        el('button', { class: 'link-btn', type: 'button', 'aria-label': `Переименовать ${s}`, onclick: async () => {
          const next = await promptDialog('Новое название', s);
          if (next == null || next.trim() === s) return;
          try {
            await renameSource(s, next);
            toast('Переименовано');
            refresh();
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Ошибка', { error: true });
          }
        } }, '✎'),
        el('button', { class: 'link-btn', type: 'button', onclick: async () => {
          const text = n ? `Убрать «${s}» из списка? В прошлых операциях (${n}) название останется.` : `Убрать «${s}» из списка?`;
          if (!(await confirmDialog(text, 'Убрать'))) return;
          await removeSource(s);
          refresh();
        } }, 'Убрать'),
      );
    });
    container.replaceChildren(el('div', { class: 'card list-card' }, ...rows, addForm));
  }
  await refresh();
}
