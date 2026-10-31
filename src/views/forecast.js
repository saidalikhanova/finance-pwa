import { el, toast, formatMonth, shiftMonth, currentMonth } from '../ui.js';
import { formatMoney, divRound } from '../money.js';
import { formatQty, parseQty, QTY_SCALE } from '../items.js';
import { getSetting, setSetting } from '../db.js';
import { listCategories } from '../repo/categories.js';
import { listOperations } from '../repo/operations.js';
import { monthPlans } from '../plan.js';
import { forecast } from '../products-stats.js';

/**
 * Сохранённый перечень закупок (редактируемый прогноз).
 * @typedef {Object} ShoppingRow
 * @property {string} key
 * @property {string} name
 * @property {string} unit
 * @property {string} categoryId
 * @property {number} qty
 * @property {number} eur — за единицу × qty / 1000 пересчитывается при правке
 * @property {number} unitEur
 * @property {string} note
 * @property {boolean} bought
 */

/** @param {HTMLElement} root */
export async function renderForecast(root) {
  const base = currentMonth();
  const target = shiftMonth(base, 1);
  const months = Number((await getSetting('forecastMonths')) ?? 3);
  const overbuy = Number((await getSetting('overbuyPercent')) ?? 30);
  const categories = await listCategories({ includeArchived: true });
  const catName = (/** @type {string} */ id) => categories.find((c) => c.id === id)?.name ?? 'Без категории';

  // Настройки
  const monthsInput = el('input', { class: 'input input-sm', type: 'number', min: 1, max: 12, value: months });
  const overbuyInput = el('input', { class: 'input input-sm', type: 'number', min: 1, max: 500, value: overbuy });
  root.append(
    el('details', { class: 'card list-card' },
      el('summary', { class: 'muted' }, 'Настройки прогноза'),
      el('div', { class: 'cat-row' }, el('span', { class: 'cat-name' }, 'Учитывать месяцев'), monthsInput),
      el('div', { class: 'cat-row' }, el('span', { class: 'cat-name' }, 'Порог избыточной покупки, %'), overbuyInput),
      el('div', { class: 'add-row' }, el('button', { class: 'btn btn-small', type: 'button', onclick: async () => {
        await setSetting('forecastMonths', Math.max(1, Math.min(12, Number(monthsInput.value) || 3)));
        await setSetting('overbuyPercent', Math.max(1, Number(overbuyInput.value) || 30));
        toast('Сохранено');
        location.reload();
      } }, 'Сохранить настройки')),
    ),
  );

  const body = el('div');
  root.append(body);

  /** @type {{ month: string, rows: ShoppingRow[] } | undefined} */
  let saved = await getSetting('shoppingList');
  if (!saved || saved.month !== target) saved = await rebuild();
  render();

  async function rebuild() {
    const ops = await listOperations({});
    const f = forecast(ops, { months, endMonth: base });
    /** @type {ShoppingRow[]} */
    const rows = f.rows.map((r) => ({ key: r.key, name: r.name, unit: r.unit, categoryId: r.categoryId, qty: r.qty, eur: r.eur, unitEur: r.qty ? divRound(r.eur * QTY_SCALE, r.qty) : 0, note: r.note, bought: false }));
    const list = { month: target, rows, preliminary: f.preliminary, monthsWithData: f.monthsWithData, builtAt: new Date().toISOString() };
    await setSetting('shoppingList', list);
    return list;
  }

  async function persist() {
    await setSetting('shoppingList', saved);
  }

  async function render() {
    const s = /** @type {any} */ (saved);
    body.innerHTML = '';
    body.append(
      el('div', { class: 'row-top', style: 'margin:12px 0 4px' },
        el('h2', { class: 'section-title', style: 'margin:0' }, `Закупки на ${formatMonth(target)}`),
        el('button', { class: 'link-btn', type: 'button', onclick: async () => { saved = await rebuild(); render(); toast('Прогноз пересчитан'); } }, 'Пересчитать'),
      ),
      el('p', { class: 'muted small' }, `По покупкам за ${months} мес. (данные есть за ${s.monthsWithData}).${s.preliminary ? ' Прогноз предварительный: данных меньше двух месяцев.' : ''}`),
    );
    if (!s.rows.length) {
      body.append(el('p', { class: 'muted' }, 'Пока нет покупок с позициями — прогноз появится после импорта чеков.'));
      return;
    }

    // Сравнение с планами категорий целевого месяца
    const plans = await monthPlans(target, cats);
    /** @type {Map<string, number>} */
    const byCat = new Map();
    for (const r of s.rows) byCat.set(r.categoryId, (byCat.get(r.categoryId) ?? 0) + r.eur);
    const total = [...byCat.values()].reduce((a, b) => a + b, 0);
    const cmp = el('div', { class: 'card list-card' });
    for (const [catId, eur] of [...byCat].sort((a, b) => b[1] - a[1])) {
      const cat = cats.find((c) => c.id === catId);
      const limit = cat ? plans.limit(cat) : null;
      const diff = limit == null ? '' : limit - eur >= 0 ? `запас ${formatMoney(limit - eur, 'EUR')}` : `превышение ${formatMoney(eur - limit, 'EUR')}`;
      cmp.append(el('div', { class: 'cat-row' },
        el('span', { class: 'cat-name' }, catName(catId), el('div', { class: `muted small${limit != null && limit < eur ? ' over' : ''}` }, limit == null ? 'план не задан' : `план ${formatMoney(limit, 'EUR')} · ${diff}`)),
        el('span', null, formatMoney(eur, 'EUR')),
      ));
    }
    cmp.append(el('div', { class: 'cat-row' }, el('strong', { class: 'cat-name' }, 'Итого'), el('strong', null, formatMoney(total, 'EUR'))));
    body.append(cmp);

    // Перечень
    const list = el('div', { class: 'card list-card' });
    s.rows.forEach((/** @type {ShoppingRow} */ r, /** @type {number} */ i) => {
      const box = el('input', { type: 'checkbox', checked: r.bought, onchange: async () => { r.bought = box.checked; await persist(); label.classList.toggle('muted', r.bought); } });
      const qtyInput = el('input', { class: 'input input-sm', inputmode: 'decimal', value: formatQty(r.qty), 'aria-label': 'Количество', onchange: async () => {
        const q = parseQty(qtyInput.value);
        if (q == null) return;
        r.qty = q;
        r.eur = divRound(r.unitEur * q, QTY_SCALE);
        await persist();
        render();
      } });
      const label = el('span', { class: `cat-name${r.bought ? ' muted' : ''}` }, r.name, el('div', { class: 'muted small' }, [r.unit, catName(r.categoryId), formatMoney(r.eur, 'EUR'), r.note].filter(Boolean).join(' · ')));
      list.append(el('div', { class: 'cat-row' }, box, label, qtyInput,
        el('button', { class: 'link-btn', type: 'button', 'aria-label': 'Убрать', onclick: async () => { s.rows.splice(i, 1); await persist(); render(); } }, '✕')));
    });
    body.append(list,
      el('button', { class: 'btn btn-secondary', type: 'button', style: 'width:100%', onclick: copyList }, 'Скопировать список'),
    );
  }

  async function copyList() {
    const s = /** @type {any} */ (saved);
    const lines = s.rows.filter((/** @type {ShoppingRow} */ r) => !r.bought).map((/** @type {ShoppingRow} */ r) => `• ${r.name} — ${formatQty(r.qty)} ${r.unit}`);
    const text = `Закупки на ${formatMonth(target).toLowerCase()}:\n${lines.join('\n')}`;
    try {
      await navigator.clipboard.writeText(text);
      toast('Список скопирован');
    } catch {
      const ta = el('textarea', { class: 'input textarea', rows: 8 }, text);
      body.append(ta);
      ta.select();
    }
  }
}
