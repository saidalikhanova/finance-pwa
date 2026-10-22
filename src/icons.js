// Иконки категорий: линейные SVG 24×24, подбираются по названию категории.
// Для незнакомых названий остаётся первая буква.

/** @type {Record<string, string>} — имя → содержимое <svg> */
export const ICONS = {
  basket: '<path d="M5 10h14l-1.5 9h-11z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/><path d="M10 13v3M14 13v3"/>',
  cup: '<path d="M5 8h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z"/><path d="M16 10h2a2 2 0 0 1 0 4h-2"/><path d="M6 21h10"/>',
  bus: '<path d="M5 4h14a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1z"/><path d="M4 10h16M7 18v2M17 18v2"/><circle cx="8" cy="14" r=".8"/><circle cx="16" cy="14" r=".8"/>',
  car: '<path d="M5 11l1.5-4h11L19 11"/><path d="M3 11h18v5h-2a2 2 0 0 1-4 0H9a2 2 0 0 1-4 0H3z"/>',
  house: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M10 20v-6h4v6"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0"/><path d="M5.5 12.5a10 10 0 0 1 13 0"/><path d="M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r=".9"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  pill: '<path d="M8.5 3.5a5 5 0 0 1 7 7l-5 5a5 5 0 0 1-7-7z"/><path d="M7 10l7 7"/>',
  shirt: '<path d="M8 4 4 7l2 3 2-1v11h8V9l2 1 2-3-4-3a4 4 0 0 1-8 0z"/>',
  child: '<circle cx="12" cy="7" r="3"/><path d="M6 21v-4a6 6 0 0 1 12 0v4"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h6"/>',
  couch: '<path d="M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><path d="M3 13a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4H3z"/><path d="M5 17v2M19 17v2"/>',
  film: '<path d="M4 5h16v14H4z"/><path d="M4 9h16M4 15h16M8 5v14M16 5v14"/>',
  gift: '<path d="M4 10h16v10H4z"/><path d="M2 7h20v3H2z"/><path d="M12 7v13"/><path d="M12 7c-1-3-5-3-5-1s3 1 5 1"/><path d="M12 7c1-3 5-3 5-1s-3 1-5 1"/>',
  suitcase: '<path d="M4 8h16v12H4z"/><path d="M9 8V5h6v3"/><path d="M9 12v4M15 12v4"/>',
  dumbbell: '<path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12"/>',
  scissors: '<circle cx="6" cy="8" r="2"/><circle cx="6" cy="16" r="2"/><path d="M20 4 8.5 15.5M20 20 8.5 8.5"/>',
  bank: '<path d="M3 10l9-6 9 6"/><path d="M5 10v8M9 10v8M15 10v8M19 10v8"/><path d="M3 20h18"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  document: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V8a2 2 0 0 1 2-2h16"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v3a2 2 0 0 1-2 2H3"/>',
  paw: '<path d="M12 13c-2.5 0-4.5 1.8-4.5 4 0 1.5 1.2 2.5 2.5 2.5h4c1.3 0 2.5-1 2.5-2.5 0-2.2-2-4-4.5-4z"/><circle cx="7" cy="9" r="1.4"/><circle cx="17" cy="9" r="1.4"/><circle cx="9.5" cy="5.5" r="1.4"/><circle cx="14.5" cy="5.5" r="1.4"/>',
  banknote: '<path d="M2 7h20v10H2z"/><circle cx="12" cy="12" r="2.5"/><path d="M5 10h.01M19 14h.01"/>',
  coins: '<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v4c0 1.7 3.1 3 7 3s7-1.3 7-3V7"/><path d="M5 11v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4"/>',
  phone: '<path d="M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M11 18h2"/>',
  dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
};

/** Ключевые слова (в нижнем регистре, подстрока) → иконка. Порядок важен: сначала частные случаи. */
const RULES = /** @type {[string[], string][]} */ ([
  [['такси', 'авто', 'машин', 'бензин', 'парков', 'топлив'], 'car'],
  [['аптек', 'лекарств', 'витамин'], 'pill'],
  [['кредит', 'банк', 'комисс', 'ипотек', 'долг', 'возврат долг'], 'bank'],
  [['страхов'], 'shield'],
  [['налог', 'штраф', 'документ', 'госпошл', 'нотариус'], 'document'],
  [['подпис', 'сервис'], 'repeat'],
  [['питом', 'кошк', 'собак', ' кот', 'животн'], 'paw'],
  [[' спорт', 'фитнес', 'трениров', 'йога', 'бассейн'], 'dumbbell'],
  [['красот', 'парикмах', 'салон', 'космет', 'маникюр'], 'scissors'],
  [['зарплат', 'оклад', 'аванс', 'премия'], 'banknote'],
  [['доход', 'подработ', 'процент', 'дивиден', 'возврат', 'кешб', 'кэшб'], 'coins'],
  [['продукт', 'еда', 'супермарк', 'бакале', 'рынок'], 'basket'],
  [['кафе', 'ресторан', 'кофе', 'обед', 'бар', 'доставк', 'фастфуд'], 'cup'],
  [['транспорт', 'метро', 'автобус', 'проезд', 'электричк'], 'bus'],
  [['жиль', 'аренд', 'квартир'], 'house'],
  [['коммунал', 'свет', 'электр', 'вода', ' газ', 'отоплен'], 'bolt'],
  [['интернет', 'связь', 'мобил', 'телефон', 'тариф'], 'wifi'],
  [['здоров', 'врач', 'медиц', 'клиник', 'стоматолог'], 'heart'],
  [['одежд', 'обув', 'гардероб'], 'shirt'],
  [['дет', 'ребён', 'ребен', 'школ', 'садик', 'кружок', 'кружк'], 'child'],
  [['образован', 'курс', 'учеб', 'книг', 'обучен'], 'book'],
  [['быт', 'мебел', 'хозяй', 'ремонт', 'дом'], 'couch'],
  [['развлеч', 'кино', 'игр', 'театр', 'концерт', 'отдых'], 'film'],
  [['подар', 'праздник', 'цвет'], 'gift'],
  [['путеш', 'отпуск', 'поездк', 'билет', 'отел', 'перелёт', 'перелет'], 'suitcase'],
  [['прочее', 'другое', 'разное', 'остальн'], 'dots'],
]);

/**
 * Имя иконки для названия категории или null, если подходящей нет.
 * @param {string} name
 */
export function iconFor(name) {
  const n = ` ${name.toLowerCase().trim()} `;
  for (const [keys, icon] of RULES) {
    if (keys.some((k) => n.includes(k))) return icon;
  }
  return null;
}

/**
 * SVG-элемент иконки.
 * @param {string} icon — ключ из ICONS
 * @param {number} [size]
 */
export function iconSvg(icon, size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  svg.innerHTML = ICONS[icon] ?? ICONS.dots;
  return svg;
}
