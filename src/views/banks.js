import { el, avatar, toast, confirmDialog, promptDialog } from '../ui.js';
import { listBanks, addBank, renameBank, removeBank } from '../repo/banks.js';
import { listLoans } from '../repo/loans.js';

/**
 * Справочник банков для кредитов.
 * @param {HTMLElement} root
 */
export async function renderBanks(root) {
  const container = el('div');
  root.append(
    el('p', { class: 'muted small', style: 'margin:0 4px 12px' }, 'Банки, в которых у вас кредиты. Кредит добавляется в «Бюджете» → «Расходы» → «Кредиты».'),
    container,
  );

  async function refresh() {
    const banks = await listBanks();
    const loans = await listLoans();
    const input = el('input', { class: 'input', placeholder: 'Новый банк', maxlength: 60 });
    const addForm = el('form', { class: 'add-row', onsubmit: async (/** @type {Event} */ e) => {
      e.preventDefault();
      try {
        await addBank(/** @type {HTMLInputElement} */ (input).value);
        toast('Банк добавлен');
        refresh();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Ошибка', { error: true });
      }
    } }, input, el('button', { class: 'btn btn-small', type: 'submit' }, 'Добавить'));

    const rows = banks.map((b) => {
      const n = loans.filter((s) => s.bank === b).length;
      return el('div', { class: 'cat-row' },
        avatar(b, { small: true }),
        el('span', { class: 'cat-name' }, b),
        el('span', { class: 'muted small' }, n ? `кредитов: ${n}` : ''),
        el('button', { class: 'link-btn', type: 'button', 'aria-label': `Переименовать ${b}`, onclick: async () => {
          const next = await promptDialog('Новое название банка', b);
          if (next == null || next.trim() === b) return;
          try {
            await renameBank(b, next);
            toast('Банк переименован');
            refresh();
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Ошибка', { error: true });
          }
        } }, '✎'),
        el('button', { class: 'link-btn', type: 'button', onclick: async () => {
          const text = n ? `Убрать «${b}» из списка? Кредиты этого банка (${n}) останутся.` : `Убрать «${b}» из списка?`;
          if (!(await confirmDialog(text, 'Убрать'))) return;
          await removeBank(b);
          refresh();
        } }, 'Убрать'),
      );
    });
    container.replaceChildren(el('div', { class: 'card list-card' }, ...rows, addForm));
  }
  await refresh();
}
