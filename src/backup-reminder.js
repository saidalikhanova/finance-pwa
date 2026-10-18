// Напоминание о резервной копии (п. 4.8 ТЗ). Чистая логика.

export const DEFAULT_REMINDER_DAYS = 7;

/**
 * Нужно ли показать баннер.
 * Если копия ни разу не делалась — после первой недели использования.
 * @param {{ enabled: boolean, days: number, lastBackupAt: string | null, installedAt: string | null, now: Date }} p
 * @returns {{ show: boolean, daysSince: number | null }}
 */
export function backupReminder(p) {
  if (!p.enabled) return { show: false, daysSince: null };
  const days = Math.max(1, p.days || DEFAULT_REMINDER_DAYS);
  const ref = p.lastBackupAt ?? p.installedAt;
  if (!ref) return { show: false, daysSince: null };
  const since = Math.floor((p.now.getTime() - new Date(ref).getTime()) / 86_400_000);
  const threshold = p.lastBackupAt ? days : DEFAULT_REMINDER_DAYS;
  return { show: since >= threshold, daysSince: p.lastBackupAt ? since : null };
}
