import { el } from '../ui.js';
import { parseAmount, parseRate, formatRate, formatMoney, toEurCents } from '../money.js';
import { suggestRate } from '../repo/rates.js';
import { segmented } from './form-parts.js';

/**
 * Общий блок «сумма + валюта + курс»: переключатель € / ₸ и пересчёт в евро.
 * Курс для тенге подставляется из запомненных и показан строкой
 * «по курсу 508,95 · изменить»; поле ввода появляется только по нажатию
 * или если курс ещё ни разу не вводился.
 * @param {{ date: () => string, amountInput: HTMLInputElement, currency?: 'EUR' | 'KZT', rate?: number | null, onChange?: () => void }} opts
 */
export function currencyControls(opts) {
  let currency = opts.currency ?? 'EUR';
  let rateTouched = Boolean(opts.rate);
  let editing = false;

  const rateInput = el('input', { class: 'input', inputmode: 'decimal', autocomplete: 'off', placeholder: 'например 508,95', value: opts.rate ? formatRate(opts.rate) : '', 'aria-label': 'Курс, ₸ за 1 €' });
  rateInput.addEventListener('input', () => {
    rateTouched = true;
    update();
  });
  const rateEdit = el('label', { class: 'field', hidden: true }, el('span', { class: 'field-label' }, 'Курс, ₸ за 1 €'), rateInput, el('p', { class: 'muted small' }, 'Запомнится на эту дату и будет подставляться дальше.'));
  const rateText = el('span');
  const rateLine = el('p', { class: 'muted small rate-line', hidden: true }, rateText, ' · ', el('button', { type: 'button', class: 'link-btn', onclick: () => { editing = true; render(); rateInput.focus(); } }, 'изменить'));
  const rateField = el('div', null, rateLine, rateEdit);
  const preview = el('p', { class: 'muted small', style: 'margin:4px 0 0' });

  const toggle = segmented([['EUR', '€'], ['KZT', '₸']], currency, (v) => {
    currency = /** @type {'EUR' | 'KZT'} */ (v);
    if (currency === 'KZT' && !rateTouched) suggest();
    render();
    update();
  });
  opts.amountInput.addEventListener('input', update);

  async function suggest() {
    const r = await suggestRate(opts.date());
    if (r && !rateTouched) rateInput.value = formatRate(r.rate);
    render();
    update();
  }

  function render() {
    const isKzt = currency === 'KZT';
    const hasRate = parseRate(rateInput.value) != null;
    rateLine.hidden = !isKzt || editing || !hasRate;
    rateEdit.hidden = !isKzt || (!editing && hasRate);
    if (hasRate) rateText.textContent = `по курсу ${formatRate(/** @type {number} */ (parseRate(rateInput.value)))} ₸ за 1 €`;
  }

  function update() {
    if (currency === 'EUR') {
      preview.textContent = '';
    } else {
      const eur = api.eurCents();
      preview.textContent = eur != null ? `≈ ${formatMoney(eur, 'EUR')}` : api.amount() == null ? '' : rateInput.value.trim() ? 'Проверьте курс' : 'Укажите курс, чтобы пересчитать в евро';
    }
    opts.onChange?.();
  }

  const api = {
    toggle,
    rateField,
    preview,
    get currency() {
      return currency;
    },
    /** Курс × RATE_SCALE или null (для евро — null). */
    rate() {
      return currency === 'KZT' ? parseRate(rateInput.value) : null;
    },
    /** Сумма из поля в минимальных единицах выбранной валюты. */
    amount() {
      return parseAmount(opts.amountInput.value);
    },
    /** Сумма в центах евро; null — не введена или нет курса. */
    eurCents() {
      const a = api.amount();
      if (a == null) return null;
      return toEurCents(a, currency, api.rate());
    },
    refreshSuggestion() {
      if (currency === 'KZT' && !rateTouched) suggest();
    },
  };
  render();
  // Тенге выбраны сразу — подставляем запомненный курс, поле курса не показываем
  if (currency === 'KZT' && !rateTouched) suggest();
  return api;
}
