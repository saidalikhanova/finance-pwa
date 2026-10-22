import { el, toast, confirmDialog, promptDialog, formatDate } from '../ui.js';
import { parseRate, formatRate } from '../money.js';
import { listRates, saveRate, deleteRate } from '../repo/rates.js';
import { todayISO } from '../repo/operations.js';

// История курсов тенге к евро по датам (дополнение к ТЗ по просьбе пользователя).

/** @param {HTMLElement} root */
export async function renderRates(root) {
  const dateInput = el('input', { class: 'input', type: 'date', value: todayISO(), required: true });
  const rateInput = el('input', { class: 'input', inputmode: 'decimal', autocomplete: 'off', placeholder: 'например 508,95', required: true });
  const form = el(
    'form',
    {
      class: 'card',
      novalidate: true,
      onsubmit: async (/** @type {Event} */ e) => {
        e.preventDefault();
        const rate = parseRate(rateInput.value);
        if (!dateInput.value || rate == null) {
          toast('Укажите дату и курс, например 508,95', { error: true });
          return;
        }
        const n = await saveRate(dateInput.value, rate);
        toast(n ? `Курс сохранён и применён к ${n} опер.` : 'Курс сохранён');
        rateInput.value = '';
        refresh();
      },
    },
    el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Дата'), dateInput),
    el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Курс, ₸ за 1 €'), rateInput),
    el('button', { class: 'btn', type: 'submit', style: 'width:100%' }, 'Сохранить курс'),
  );

  const list = el('div', { class: 'card list-card' });
  root.append(form, list);

  async function refresh() {
    const rates = await listRates();
    list.innerHTML = '';
    if (!rates.length) {
      list.append(el('p', { class: 'muted' }, 'Курсов пока нет. Они появляются при вводе операций в тенге или здесь.'));
      return;
    }
    for (const r of rates) {
      list.append(
        el(
          'div',
          { class: 'cat-row' },
          el('span', { class: 'cat-name' }, formatDate(r.date)),
          el('span', null, formatRate(r.rate)),
          el('button', {
            class: 'link-btn',
            type: 'button',
            'aria-label': `Изменить курс за ${r.date}`,
            onclick: async () => {
              const next = await promptDialog(`Курс на ${formatDate(r.date)}, ₸ за 1 €`, formatRate(r.rate));
              if (next == null) return;
              const rate = parseRate(next);
              if (rate == null) {
                toast('Введите курс, например 508,95', { error: true });
                return;
              }
              await saveRate(r.date, rate);
              toast('Курс изменён');
              refresh();
            },
          }, '✎'),
          el('button', {
            class: 'link-btn',
            type: 'button',
            'aria-label': `Удалить курс за ${r.date}`,
            onclick: async () => {
              if (!(await confirmDialog(`Удалить курс за ${formatDate(r.date)}? Операции с этим курсом не изменятся.`))) return;
              await deleteRate(r.date);
              refresh();
            },
          }, '✕'),
        ),
      );
    }
  }

  await refresh();
}
