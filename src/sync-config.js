// Общие данные для семьи: семейный код и код подключения. Чистые функции.

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // без похожих символов
export const FAMILY_CODE_LENGTH = 32;
const INVITE_PREFIX = 'fin1.';

/**
 * @typedef {Object} SyncConfig
 * @property {string} url — адрес проекта Supabase, например https://abcd.supabase.co
 * @property {string} key — публичный (anon) ключ проекта
 * @property {string} family — семейный код
 * @property {string | null} cursor — отметка времени последней полученной записи
 * @property {string | null} lastAt — когда последний раз обменялись успешно
 * @property {string | null} lastError — текст последней ошибки
 */

/** Случайный семейный код: 32 символа, без похожих букв и цифр. */
export function makeFamilyCode() {
  const bytes = new Uint8Array(FAMILY_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/**
 * Адрес проекта без хвостовых косых черт; пустая строка — если это не адрес https.
 * @param {string} url
 */
export function normalizeUrl(url) {
  const s = url.trim().replace(/\/+$/, '');
  return /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?$/i.test(s) ? s : '';
}

/**
 * Проверяет адрес, ключ и семейный код; возвращает текст ошибки или пустую строку.
 * @param {{ url: string, key: string, family: string }} c
 */
export function validateConfig(c) {
  if (!normalizeUrl(c.url)) return 'Адрес проекта должен начинаться с https://';
  if (!c.key || c.key.trim().length < 20) return 'Ключ проекта слишком короткий';
  if (!c.family || c.family.length < 24) return 'Семейный код слишком короткий';
  return '';
}

/**
 * Код подключения для второго телефона: одна строка, внутри адрес, ключ и семейный код.
 * @param {{ url: string, key: string, family: string }} c
 */
export function encodeInvite(c) {
  const json = JSON.stringify({ u: normalizeUrl(c.url), k: c.key.trim(), f: c.family });
  const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return INVITE_PREFIX + b64;
}

/**
 * Разбирает код подключения; бросает ошибку с понятным текстом.
 * @param {string} text
 * @returns {{ url: string, key: string, family: string }}
 */
export function decodeInvite(text) {
  const s = text.trim();
  if (!s.startsWith(INVITE_PREFIX)) throw new Error('Это не код подключения: он начинается с «fin1.»');
  let obj;
  try {
    const b64 = s.slice(INVITE_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    obj = JSON.parse(decodeURIComponent(escape(atob(b64))));
  } catch {
    throw new Error('Код подключения повреждён — скопируйте его целиком');
  }
  const c = { url: String(obj.u ?? ''), key: String(obj.k ?? ''), family: String(obj.f ?? '') };
  const err = validateConfig(c);
  if (err) throw new Error(`Код подключения неполный: ${err.toLowerCase()}`);
  return c;
}
