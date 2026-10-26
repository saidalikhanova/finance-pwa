// Импорт покупок из чата: разбор JSON, подготовленного Claude по фотографии чека,
// и текст инструкции, которую пользователь вставляет в чат вместе с фото.

import { parseAmount } from './money.js';
import { parseQty, lineSum, UNITS } from './items.js';

/**
 * Разобранная покупка (до создания операции).
 * @typedef {Object} ParsedItem
 * @property {string} name
 * @property {number} qty — × 1000
 * @property {string} unit
 * @property {number} price — минимальные единицы
 * @property {number} sum — минимальные единицы
 * @property {string} categoryName — как в чате
 * @property {string} categoryId — '' если категория не найдена
 *
 * @typedef {Object} ParsedPurchase
 * @property {string} date
 * @property {string} store
 * @property {'EUR' | 'KZT'} currency
 * @property {ParsedItem[]} items
 * @property {string} comment
 */

const UNIT_ALIASES = /** @type {Record<string, string>} */ ({
  кг: 'кг', kg: 'кг', г: 'г', гр: 'г', g: 'г', л: 'л', l: 'л', мл: 'мл', ml: 'мл',
  шт: 'шт', штук: 'шт', штука: 'шт', ud: 'шт', uds: 'шт', pcs: 'шт', уп: 'уп', упак: 'уп', упаковка: 'уп', pack: 'уп',
});

/**
 * Сумма из JSON: число (12.5) или строка («12,50») → минимальные единицы. null — ошибка.
 * @param {unknown} v
 */
function money(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
  return parseAmount(String(v)) ?? (String(v).trim() === '0' ? 0 : null);
}

/** @param {unknown} v */
function qty(v) {
  if (v == null || v === '') return 1000;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v * 1000) : null;
  return parseQty(String(v));
}

/**
 * Разбирает текст из чата. Принимает объект { purchases: [...] }, массив покупок
 * или одну покупку. Категории сопоставляются по названию без учёта регистра.
 * @param {string} text
 * @param {{ id: string, name: string, kind: string, parentId?: string | null, archived?: boolean }[]} categories
 * @returns {{ purchases: ParsedPurchase[], errors: string[] }}
 */
export function parseChatImport(text, categories) {
  /** @type {string[]} */
  const errors = [];
  /** @type {ParsedPurchase[]} */
  const purchases = [];

  // Вырезаем JSON из текста с пояснениями или из блока ```json … ```
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = cleaned.search(/[[{]/);
  if (start < 0) return { purchases, errors: ['В тексте не найден JSON'] };
  let data;
  try {
    data = JSON.parse(cleaned.slice(start, Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}')) + 1));
  } catch {
    return { purchases, errors: ['Не удалось разобрать JSON: проверьте, что текст скопирован целиком'] };
  }

  const list = Array.isArray(data) ? data : Array.isArray(data?.purchases) ? data.purchases : data?.items ? [data] : null;
  if (!list) return { purchases, errors: ['Ожидался список покупок (purchases) с позициями (items)'] };

  const byName = categoryLookup(categories);

  list.forEach((p, pi) => {
    const label = `Покупка ${pi + 1}`;
    const date = String(p?.date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`${label}: дата должна быть в формате ГГГГ-ММ-ДД`);
      return;
    }
    const currency = String(p?.currency ?? 'EUR').toUpperCase();
    if (currency !== 'EUR' && currency !== 'KZT') {
      errors.push(`${label}: валюта должна быть EUR или KZT`);
      return;
    }
    if (!Array.isArray(p?.items) || !p.items.length) {
      errors.push(`${label}: нет позиций`);
      return;
    }
    /** @type {ParsedItem[]} */
    const items = [];
    p.items.forEach((/** @type {any} */ it, /** @type {number} */ ii) => {
      const name = String(it?.name ?? '').trim();
      if (!name) {
        errors.push(`${label}, позиция ${ii + 1}: нет названия`);
        return;
      }
      const q = qty(it.qty ?? it.quantity);
      if (q == null) {
        errors.push(`${label}, «${name}»: количество указано неверно`);
        return;
      }
      const rawUnit = String(it.unit ?? 'шт').trim().toLowerCase().replace(/\.$/, '');
      const unit = UNIT_ALIASES[rawUnit] ?? (UNITS.includes(/** @type {any} */ (rawUnit)) ? rawUnit : null);
      if (!unit) {
        errors.push(`${label}, «${name}»: единица «${it.unit}» не поддерживается (${UNITS.join(', ')})`);
        return;
      }
      let price = money(it.price);
      let sum = money(it.sum ?? it.total);
      if (sum == null && price != null) sum = lineSum(price, q);
      if (sum == null) {
        errors.push(`${label}, «${name}»: не указана сумма`);
        return;
      }
      if (price == null) price = 0;
      const categoryName = String(it.category ?? '').trim();
      items.push({ name, qty: q, unit, price, sum, categoryName, categoryId: byName.get(normalizeCategoryName(categoryName)) ?? '' });
    });
    if (!items.length) return;
    purchases.push({ date, store: String(p.store ?? '').trim(), currency, items, comment: String(p.comment ?? '').trim() });
  });

  return { purchases, errors };
}

/**
 * Текст инструкции для Claude: формат ответа, список категорий, справочник продуктов.
 * @param {{ name: string, kind: string, archived?: boolean }[]} categories
 * @param {{ name: string, unit: string, categoryId: string }[]} products
 * @param {Map<string, string>} [categoryNameById]
 */
export function buildClaudePrompt(categories, products, categoryNameById = new Map()) {
  const cats = expenseCategoryNames(categories);
  const prodLines = products.map((p) => `- ${p.name} (${p.unit}${categoryNameById.get(p.categoryId) ? `, ${categoryNameById.get(p.categoryId)}` : ''})`);
  return [
    'Разбери чек на фотографии и верни данные для моего приложения учёта расходов.',
    '',
    'Правила:',
    '1. Названия продуктов — на русском, в единственном числе, как в моём справочнике ниже. Сокращения и испанские названия с чека приводи к названиям из справочника; если продукта нет в справочнике — предложи новое название в том же стиле.',
    `2. Категория каждой позиции — строго одна из моих категорий (статья внутри категории пишется через «›», например «Здоровье › Аптека»): ${cats.join(', ')}.`,
    `3. Единицы измерения: ${UNITS.join(', ')}. Количество — число (1,5 кг → 1.5).`,
    '4. Цена за единицу и сумма позиции — числа в валюте чека. Сумма всех позиций должна совпадать с итогом чека; скидки учитывай в суммах позиций.',
    '5. Если позиция неясна (что это за продукт, какая категория) — сначала спроси меня, потом выдай результат.',
    '6. Ответ — только JSON в таком формате, без пояснений:',
    '',
    '```json',
    '{',
    '  "purchases": [',
    '    {',
    '      "date": "2026-10-18",',
    '      "store": "Mercadona",',
    '      "currency": "EUR",',
    '      "items": [',
    '        { "name": "Лук репчатый", "qty": 1.5, "unit": "кг", "price": 1.20, "sum": 1.80, "category": "Продукты" }',
    '      ]',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    `Мои категории расходов: ${cats.join(', ')}.`,
    '',
    products.length ? 'Мой справочник продуктов:' : 'Мой справочник продуктов пока пуст — предлагай названия сам.',
    ...prodLines,
  ].join('\n');
}

/**
 * «Здоровье > аптека», «Здоровье/Аптека» → «здоровье › аптека».
 * @param {string} name
 */
export function normalizeCategoryName(name) {
  return name.trim().toLowerCase().replace(/\s*(›|»|>|\/)\s*/g, ' › ').replace(/\s+/g, ' ');
}

/**
 * Названия категорий расходов для инструкции: категория, затем её статьи («Здоровье › Аптека»).
 * @param {{ id?: string, name: string, kind: string, archived?: boolean, parentId?: string | null, order?: number }[]} categories
 */
export function expenseCategoryNames(categories) {
  const active = categories.filter((c) => c.kind === 'expense' && !c.archived);
  const out = [];
  for (const top of active.filter((c) => !c.parentId)) {
    out.push(top.name);
    for (const ch of active.filter((c) => c.parentId && c.parentId === top.id)) out.push(`${top.name} › ${ch.name}`);
  }
  return out;
}

/**
 * Поиск категории расходов по названию: «Здоровье», «Здоровье › Аптека»,
 * а также просто «Аптека», если такая статья одна.
 * @param {{ id: string, name: string, kind: string, parentId?: string | null }[]} categories
 * @returns {Map<string, string>}
 */
function categoryLookup(categories) {
  const expense = categories.filter((c) => c.kind === 'expense');
  const byId = new Map(expense.map((c) => [c.id, c]));
  /** @type {Map<string, string>} */
  const map = new Map();
  /** @type {Map<string, number>} */
  const articleNames = new Map();
  for (const c of expense) if (c.parentId) articleNames.set(c.name.toLowerCase(), (articleNames.get(c.name.toLowerCase()) ?? 0) + 1);
  for (const c of expense) {
    if (!c.parentId) {
      map.set(normalizeCategoryName(c.name), c.id);
      continue;
    }
    const parent = byId.get(c.parentId);
    if (parent) map.set(normalizeCategoryName(`${parent.name} › ${c.name}`), c.id);
  }
  for (const c of expense) {
    const key = normalizeCategoryName(c.name);
    if (c.parentId && articleNames.get(c.name.toLowerCase()) === 1 && !map.has(key)) map.set(key, c.id);
  }
  return map;
}
