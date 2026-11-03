import { el, promptDialog, toast } from '../ui.js';
import { listSources, addSource } from '../repo/sources.js';

const LAST_KEY = 'lastPaymentSource';

/** Последний выбранный источник — хранится только на этом телефоне (у каждого свой). */
export function lastSource() {
  try {
    return localStorage.getItem(LAST_KEY) ?? '';
  } catch {
    return '';
  }
}

/** @param {string} name */
export function rememberSource(name) {
  try {
    if (name) localStorage.setItem(LAST_KEY, name);
  } catch {
    /* не страшно: просто не запомним */
  }
}

/**
 * Кнопки выбора источника оплаты. Повторное нажатие снимает выбор.
 * @param {{ value: string, onChange?: (v: string) => void }} opts
 * @returns {Promise<{ el: HTMLElement, get: () => string }>}
 */
export async function sourceChips(opts) {
  let value = opts.value ?? '';
  const box = el('div', { class: 'chips' });

  async function draw() {
    const names = await listSources();
    // Источник, которого уже нет в списке, но он записан в операции, всё равно показываем
    if (value && !names.includes(value)) names.unshift(value);
    box.replaceChildren(
      ...names.map((n) =>
        el('button', { type: 'button', class: `chip${n === value ? ' active' : ''}`, onclick: () => {
          value = value === n ? '' : n;
          opts.onChange?.(value);
          draw();
        } }, n),
      ),
      el('button', { type: 'button', class: 'chip', onclick: async () => {
        const name = await promptDialog('Как назвать? Например: Наличные, Kaspi, Revolut', '');
        if (name == null || !name.trim()) return;
        try {
          value = await addSource(name);
          opts.onChange?.(value);
          draw();
        } catch (err) {
          toast(err instanceof Error ? err.message : 'Ошибка', { error: true });
        }
      } }, '＋ Добавить'),
    );
  }
  await draw();
  return { el: box, get: () => value };
}
