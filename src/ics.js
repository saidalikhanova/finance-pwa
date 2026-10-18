// Выгрузка платежей в файл календаря (.ics) для импорта в календарь телефона.

/**
 * @typedef {Object} IcsEvent
 * @property {string} uid
 * @property {string} date — ГГГГ-ММ-ДД (событие на весь день)
 * @property {string} title
 * @property {string} [description]
 */

/** @param {string} s */
function escapeText(s) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/** @param {string} iso ГГГГ-ММ-ДД → ГГГГММДД */
function compact(iso) {
  return iso.replace(/-/g, '');
}

/** @param {string} iso */
function nextDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + 1);
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Собирает содержимое файла .ics. События на весь день, с напоминанием в 9:00.
 * @param {IcsEvent[]} events
 * @param {string} [stamp] — ISO-время создания (для тестов)
 */
export function buildIcs(events, stamp = new Date().toISOString()) {
  const dtstamp = stamp.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Финансы//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${compact(e.date)}`,
      `DTEND;VALUE=DATE:${nextDay(e.date)}`,
      `SUMMARY:${escapeText(e.title)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(e.title)}`, 'TRIGGER:PT9H', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/**
 * Передаёт файл через системное меню «Поделиться», иначе скачивает.
 * @param {string} content
 * @param {string} filename
 * @param {string} mime
 */
export async function shareOrDownload(content, filename, mime) {
  const file = new File([content], filename, { type: mime });
  const nav = /** @type {any} */ (navigator);
  if (nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
