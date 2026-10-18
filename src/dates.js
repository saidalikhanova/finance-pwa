// Работа с датами в формате ГГГГ-ММ-ДД по местному времени, без часовых поясов.

/** @param {string} iso */
export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** @param {Date} date */
export function toISO(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

/**
 * @param {string} iso
 * @param {number} days
 */
export function addDays(iso, days) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

/**
 * @param {number} year
 * @param {number} month — 1..12
 */
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * Сдвигает дату на N месяцев, сохраняя день месяца `day`
 * (если в месяце меньше дней — последний день месяца).
 * @param {string} iso — опорная дата
 * @param {number} months
 * @param {number} day — желаемый день месяца
 */
export function addMonthsKeepDay(iso, months, day) {
  const [y, m] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(day, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

/** Разница в днях b − a. @param {string} a @param {string} b */
export function diffDays(a, b) {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86_400_000);
}

/** День недели 0 = понедельник … 6 = воскресенье. @param {string} iso */
export function weekdayMon0(iso) {
  return (parseISO(iso).getDay() + 6) % 7;
}
