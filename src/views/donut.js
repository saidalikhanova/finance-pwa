import { el, categoryColor, avatar } from '../ui.js';
import { formatMoney } from '../money.js';

const MAX_SEGMENTS = 6;

/**
 * Круг расходов по категориям с легендой. Сегмент и строка легенды ведут
 * к операциям категории за месяц.
 * @param {{ categoryId: string, name: string, amount: number, share: number }[]} rows — по убыванию
 * @param {string} month — ГГГГ-ММ
 */
export function donut(rows, month) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  if (!total) return null;
  const top = rows.slice(0, MAX_SEGMENTS);
  const rest = rows.slice(MAX_SEGMENTS);
  const segments = rest.length
    ? [...top, { categoryId: '', name: 'Остальное', amount: rest.reduce((s, r) => s + r.amount, 0), share: rest.reduce((s, r) => s + r.share, 0) }]
    : top;

  const ns = 'http://www.w3.org/2000/svg';
  const size = 140;
  const r = 54;
  const stroke = 18;
  const c = 2 * Math.PI * r;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'donut');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Расходы по категориям');
  let offset = 0;
  for (const s of segments) {
    const frac = s.amount / total;
    const seg = document.createElementNS(ns, 'circle');
    seg.setAttribute('cx', String(size / 2));
    seg.setAttribute('cy', String(size / 2));
    seg.setAttribute('r', String(r));
    seg.setAttribute('fill', 'none');
    seg.setAttribute('stroke', s.categoryId ? categoryColor(s.name) : 'var(--text-muted)');
    seg.setAttribute('stroke-width', String(stroke));
    // Зазор 2 px между сегментами, чтобы они читались по отдельности
    seg.setAttribute('stroke-dasharray', `${Math.max(0, frac * c - 2)} ${c}`);
    seg.setAttribute('stroke-dashoffset', String(-offset * c));
    seg.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
    seg.setAttribute('class', 'donut-seg');
    const title = document.createElementNS(ns, 'title');
    title.textContent = `${s.name}: ${formatMoney(s.amount, 'EUR')} (${s.share} %)`;
    seg.append(title);
    if (s.categoryId) seg.addEventListener('click', () => (location.hash = `#/operations?month=${month}&category=${s.categoryId}`));
    svg.append(seg);
    offset += frac;
  }
  const label = document.createElementNS(ns, 'text');
  label.setAttribute('x', String(size / 2));
  label.setAttribute('y', String(size / 2 + 5));
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('class', 'donut-label');
  label.textContent = formatMoney(total, 'EUR').replace(' €', '');
  svg.append(label);

  const legend = el('div', { class: 'donut-legend' });
  for (const s of segments) {
    const row = el(
      s.categoryId ? 'a' : 'div',
      { class: 'donut-row', href: s.categoryId ? `#/operations?month=${month}&category=${s.categoryId}` : null },
      s.categoryId ? avatar(s.name, { small: true }) : el('div', { class: 'avatar avatar-sm', style: 'background:var(--text-muted)' }, '…'),
      el('span', { class: 'donut-name' }, s.name),
      el('span', { class: 'muted small' }, `${s.share} %`),
      el('span', { class: 'donut-sum' }, formatMoney(s.amount, 'EUR')),
    );
    legend.append(row);
  }
  return el('div', { class: 'donut-wrap' }, svg, legend);
}
