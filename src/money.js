// Денежные суммы хранятся целыми числами в минимальных единицах:
// евро — в центах, тенге — в тиынах. Числа с плавающей запятой
// для денег не используются; деление выполняется через BigInt.

/** @typedef {'EUR' | 'KZT'} Currency */

export const CURRENCIES = /** @type {const} */ (['EUR', 'KZT']);

/** @type {Record<Currency, string>} */
export const CURRENCY_SYMBOL = { EUR: '€', KZT: '₸' };

/** Курс хранится как целое: тенге за 1 евро × RATE_SCALE (4 знака после запятой). */
export const RATE_SCALE = 10000;

/**
 * Разбирает сумму, введённую пользователем: «12,50», «12.5», «1 234,56».
 * Возвращает сумму в минимальных единицах или null, если ввод некорректен.
 * @param {string} input
 * @returns {number | null}
 */
export function parseAmount(input) {
  const s = String(input).replace(/\s+/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor <= 0) return null;
  return minor;
}

/**
 * Выводит сумму для показа: «12,50 €», «5 000,00 ₸».
 * @param {number} minor
 * @param {Currency} currency
 * @param {{ sign?: boolean }} [opts]
 */
export function formatMoney(minor, currency, opts = {}) {
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const wholeStr = whole.toLocaleString('ru-RU');
  const sign = minor < 0 ? '−' : opts.sign && minor > 0 ? '+' : '';
  return `${sign}${wholeStr},${frac} ${CURRENCY_SYMBOL[currency]}`;
}

/**
 * Сумма для поля ввода: «12,50» (без символа валюты и разделителей тысяч).
 * @param {number} minor
 */
export function amountToInput(minor) {
  return `${Math.floor(minor / 100)},${String(minor % 100).padStart(2, '0')}`;
}

/**
 * Разбирает курс «512,34» в целое (× RATE_SCALE).
 * @param {string | number} input
 * @returns {number | null}
 */
export function parseRate(input) {
  const s = String(input).replace(/\s+/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,4})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const scaled = Number(whole) * RATE_SCALE + Number(frac.padEnd(4, '0'));
  if (!Number.isSafeInteger(scaled) || scaled <= 0) return null;
  return scaled;
}

/** @param {number} rateScaled */
export function formatRate(rateScaled) {
  const whole = Math.floor(rateScaled / RATE_SCALE);
  const frac = String(rateScaled % RATE_SCALE).padStart(4, '0').replace(/0+$/, '');
  return frac ? `${whole},${frac}` : String(whole);
}

/**
 * Делит a на b с округлением до ближайшего целого (половина — вверх),
 * без потери точности.
 * @param {number} a
 * @param {number} b
 */
export function divRound(a, b) {
  const A = BigInt(a);
  const B = BigInt(b);
  return Number((2n * A + B) / (2n * B));
}

/**
 * Пересчитывает сумму в центы евро.
 * @param {number} minor — сумма в минимальных единицах исходной валюты
 * @param {Currency} currency
 * @param {number | null} rateScaled — тенге за евро × RATE_SCALE; для EUR не нужен
 * @returns {number | null} — null, если курс не известен
 */
export function toEurCents(minor, currency, rateScaled) {
  if (currency === 'EUR') return minor;
  if (!rateScaled) return null;
  // тиыны × 10000 / (тенге_за_евро × 10000) = евро в центах
  return divRound(minor * RATE_SCALE, rateScaled);
}

/**
 * Обратный пересчёт: из центов евро в тиыны по курсу.
 * @param {number} eurCents
 * @param {number} rateScaled
 */
export function fromEurCents(eurCents, rateScaled) {
  return divRound(eurCents * rateScaled, RATE_SCALE);
}
