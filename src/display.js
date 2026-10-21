// Валюта показа итогов: учёт ведётся в евро (п. 2 ТЗ), но суммы можно показывать
// в тенге — пересчёт по последнему известному курсу. Выбор хранится в настройках.

import { el } from './ui.js';
import { getSetting, setSetting } from './db.js';
import { formatMoney, fromEurCents } from './money.js';
import { suggestRate } from './repo/rates.js';
import { todayISO } from './repo/operations.js';

const state = { currency: /** @type {'EUR' | 'KZT'} */ ('EUR'), rate: /** @type {number | null} */ (null) };

/** Загружает выбор и курс; вызывать перед отрисовкой экрана. */
export async function loadDisplay() {
  state.currency = (await getSetting('displayCurrency')) === 'KZT' ? 'KZT' : 'EUR';
  state.rate = (await suggestRate(todayISO()))?.rate ?? null;
  return state;
}

/** Валюта показа с учётом того, есть ли курс. */
export function displayCurrency() {
  return state.currency === 'KZT' && state.rate ? 'KZT' : 'EUR';
}

/**
 * Сумма в центах евро → строка в валюте показа. Тенге — без копеек.
 * @param {number} eurCents
 * @param {{ sign?: boolean }} [opts]
 */
export function money(eurCents, opts = {}) {
  if (displayCurrency() === 'KZT') {
    const kzt = fromEurCents(eurCents, /** @type {number} */ (state.rate));
    // Пересчёт из евро даёт «хвосты» (600 000 ₸ → 600 001 ₸): крупные суммы — до сотен тенге, мелкие — до десятков
    const step = Math.abs(kzt) >= 10_000_00 ? 100_00 : 10_00;
    return formatMoney(Math.round(kzt / step) * step, 'KZT', opts).replace(/,00(?= )/, '');
  }
  return formatMoney(eurCents, 'EUR', opts);
}

/**
 * Переключатель «€ / ₸» для итогов. После смены экран перерисовывается.
 */
export function displayToggle() {
  const wrap = el('div', { class: 'segmented segmented-mini', role: 'group', 'aria-label': 'Показывать суммы в' });
  for (const [v, label] of [['EUR', '€'], ['KZT', '₸']]) {
    const b = el('button', { type: 'button', class: displayCurrency() === v ? 'active' : '' }, label);
    b.addEventListener('click', async () => {
      if (v === 'KZT' && !state.rate) {
        const { toast } = await import('./ui.js');
        toast('Сначала введите курс тенге: «Ещё» → «Курсы тенге к евро»', { error: true });
        return;
      }
      await setSetting('displayCurrency', v);
      state.currency = /** @type {'EUR' | 'KZT'} */ (v);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    wrap.append(b);
  }
  return wrap;
}
