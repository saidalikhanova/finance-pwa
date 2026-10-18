// Простой маршрутизатор по хэшу адреса: #/operations → страница «Операции»,
// #/operations/abc → страница операции с параметром id = «abc».
// Хэш выбран намеренно: приложение раздаётся как статические файлы,
// и при перезагрузке страницы сервер не должен знать о внутренних адресах.

/**
 * @typedef {Object} Route
 * @property {string} title
 * @property {string} [back] — адрес для кнопки «Назад» (у страниц верхнего уровня нет)
 * @property {string} [tab] — какая вкладка подсвечивается
 * @property {(root: HTMLElement, params: Record<string, string>) => void | Promise<void>} render
 */

/** @type {{ pattern: string[], route: Route }[]} */
const routes = [];

/**
 * @param {string} path
 * @param {Route} route
 */
export function register(path, route) {
  routes.push({ pattern: path.split('/').filter(Boolean), route });
}

export function currentPath() {
  const hash = location.hash.replace(/^#/, '').split('?')[0];
  return hash || '/';
}

/** Параметры после «?» в хэше: #/operations/new?wish=abc → { wish: 'abc' }. */
export function currentQuery() {
  const q = location.hash.split('?')[1] ?? '';
  return Object.fromEntries(new URLSearchParams(q));
}

/** @param {string} path */
function match(path) {
  const segs = path.split('/').filter(Boolean);
  for (const { pattern, route } of routes) {
    if (pattern.length !== segs.length) continue;
    /** @type {Record<string, string>} */
    const params = {};
    let ok = true;
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i].startsWith(':')) params[pattern[i].slice(1)] = decodeURIComponent(segs[i]);
      else if (pattern[i] !== segs[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return null;
}

/** @param {string} path */
export function navigate(path) {
  location.hash = `#${path}`;
}

/**
 * @param {HTMLElement} root
 * @param {HTMLElement} titleEl
 * @param {HTMLAnchorElement} backEl
 */
export async function renderCurrent(root, titleEl, backEl) {
  const path = currentPath();
  const found = match(path) ?? match('/');
  if (!found) return;
  const { route } = found;
  const params = { ...currentQuery(), ...found.params };

  titleEl.textContent = route.title;
  document.title = route.title === 'Главная' ? 'Финансы' : `${route.title} — Финансы`;
  backEl.hidden = !route.back;
  backEl.href = route.back ? `#${route.back}` : '#/';

  root.innerHTML = '';
  window.scrollTo(0, 0);
  await route.render(root, params);

  const tab = route.tab ?? `/${path.split('/').filter(Boolean)[0] ?? ''}`;
  document.querySelectorAll('[data-route]').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('data-route') === tab);
  });
}

/**
 * @param {HTMLElement} root
 * @param {HTMLElement} titleEl
 * @param {HTMLAnchorElement} backEl
 */
export function start(root, titleEl, backEl) {
  window.addEventListener('hashchange', () => renderCurrent(root, titleEl, backEl));
  return renderCurrent(root, titleEl, backEl);
}
