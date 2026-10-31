import { el, toast, confirmDialog } from '../ui.js';
import { getSyncConfig, ping, enableSync, disableSync, pendingCount } from '../sync.js';
import { makeFamilyCode, encodeInvite, decodeInvite } from '../sync-config.js';

/** Экран «Общие данные»: подключение к облаку, семейный код, код подключения. */
export async function renderSyncSettings(root) {
  const cfg = await getSyncConfig();
  root.innerHTML = '';
  if (cfg) return renderConnected(root, cfg);

  // --- Не подключено: адрес и ключ проекта, создать код или подключиться по коду
  const urlInput = el('input', { class: 'input', type: 'url', autocomplete: 'off', placeholder: 'https://xxxx.supabase.co' });
  const keyInput = el('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: 'публичный ключ (anon key)' });
  const inviteInput = el('textarea', { class: 'input', rows: 3, placeholder: 'fin1.…' });

  root.append(
    el('div', { class: 'card' },
      el('p', { class: 'small', style: 'margin:0 0 8px' }, 'Общие данные позволяют двоим вести одни и те же записи на разных телефонах. Фото чеков остаются на телефоне.'),
      el('p', { class: 'muted small', style: 'margin:0' }, 'Порядок: первый телефон создаёт семейный код, второй — подключается по коду подключения, который пришлёт первый.'),
    ),
    el('div', { class: 'card' },
      el('div', { class: 'card-title' }, 'Первый телефон'),
      el('p', { class: 'muted small' }, 'Нужен проект в Supabase с выполненным скриптом docs/supabase-setup.sql. Адрес и ключ — в Supabase: Project Settings → API.'),
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Адрес проекта'), urlInput),
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Публичный ключ'), keyInput),
      el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'button', onclick: create }, 'Создать семейный код')),
    ),
    el('div', { class: 'card' },
      el('div', { class: 'card-title' }, 'Второй телефон'),
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Код подключения'), inviteInput),
      el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'button', onclick: join }, 'Подключиться по коду')),
    ),
  );

  async function create() {
    const c = { url: urlInput.value, key: keyInput.value, family: makeFamilyCode() };
    await connect(c, 'Семейный код создан');
  }

  async function join() {
    let c;
    try {
      c = decodeInvite(inviteInput.value);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Неверный код', { error: true });
      return;
    }
    await connect(c, 'Подключено к семье');
  }

  /** @param {{ url: string, key: string, family: string }} c @param {string} okText */
  async function connect(c, okText) {
    try {
      toast('Проверяю связь…');
      await ping(c);
      const n = await enableSync(c);
      toast(`${okText}. Ожидают отправки: ${n}`);
      renderSyncSettings(root);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Не удалось подключиться', { error: true });
    }
  }
}

/**
 * @param {HTMLElement} root
 * @param {import('../sync-config.js').SyncConfig} cfg
 */
async function renderConnected(root, cfg) {
  const pending = await pendingCount();
  const invite = encodeInvite(cfg);
  const status = cfg.lastError
    ? el('span', { class: 'over' }, `ошибка: ${cfg.lastError}`)
    : cfg.lastAt ? `обновлено ${new Date(cfg.lastAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'обмен ещё не выполнялся';
  root.append(
    el('div', { class: 'card list-card' },
      el('ul', { class: 'status-list' },
        el('li', null, el('span', null, 'Общие данные'), el('span', { class: 'income' }, 'включены')),
        el('li', null, el('span', null, 'Проект'), el('span', { class: 'muted small' }, cfg.url.replace(/^https:\/\//, ''))),
        el('li', null, el('span', null, 'Семейный код'), el('span', { class: 'muted small' }, `${cfg.family.slice(0, 4)}…${cfg.family.slice(-4)}`)),
        el('li', null, el('span', null, 'Состояние'), el('span', null, status)),
        el('li', null, el('span', null, 'Ожидают отправки'), el('span', null, String(pending))),
      ),
    ),
    el('div', { class: 'card' },
      el('div', { class: 'card-title' }, 'Подключить второй телефон'),
      el('p', { class: 'muted small' }, 'Скопируйте код подключения и отправьте его мужу любым сообщением. На его телефоне: Ещё → Настройки → Общие данные → «Подключиться по коду».'),
      el('textarea', { class: 'input', rows: 3, readonly: true, value: invite }),
      el('div', { class: 'form-actions' }, el('button', { class: 'btn', type: 'button', onclick: copyInvite }, 'Скопировать код подключения')),
    ),
    el('div', { class: 'btn-row', style: 'margin-top:12px' },
      el('button', { class: 'btn btn-secondary', type: 'button', onclick: check }, 'Проверить связь'),
      el('button', { class: 'btn btn-danger', type: 'button', onclick: disconnect }, 'Отключить'),
    ),
    el('p', { class: 'muted small' }, 'Отключение не удаляет записи ни на телефоне, ни в облаке.'),
  );

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(invite);
      toast('Код подключения скопирован');
    } catch {
      toast('Не удалось скопировать — выделите текст и скопируйте вручную', { error: true });
    }
  }

  async function check() {
    try {
      await ping(cfg);
      toast('Связь с облаком есть');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Нет связи', { error: true });
    }
  }

  async function disconnect() {
    if (!(await confirmDialog('Отключить общие данные на этом телефоне? Записи останутся, но перестанут обмениваться с другим телефоном.', 'Отключить'))) return;
    await disableSync();
    toast('Общие данные отключены');
    renderSyncSettings(root);
  }
}
