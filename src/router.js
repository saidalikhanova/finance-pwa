// Простой маршрутизатор по хэшу адреса: #/operations → страница «Операции».
// Хэш выбран намеренно: приложение раздаётся как статические файлы,
// и при перезагрузке страницы сервер не должен знать о внутренних адресах.

/**
 * @typedef {{ title: string, render: (root: HTMLElement) => void | Promise<void> }} Route
 */

/** @type {Map<string, Route>} */
const routes = new Map();

/**
 * @param {string} path
 * @param {Route} route
 */
export function register(path, route) {
  routes.set(path, route);
}

export function currentPath() {
  const hash = location.hash.replace(/^#/, '');
  return hash || '/';
}

/**
 * @param {HTMLElement} root
 * @param {HTMLElement} titleEl
 */
export async function renderCurrent(root, titleEl) {
  const path = currentPath();
  const route = routes.get(path) ?? routes.get('/');
  if (!route) return;

  titleEl.textContent = route.title;
  document.title = route.title === 'Главная' ? 'Финансы' : `${route.title} — Финансы`;
  root.innerHTML = '';
  await route.render(root);

  document.querySelectorAll('[data-route]').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('data-route') === path);
  });
}

/**
 * @param {HTMLElement} root
 * @param {HTMLElement} titleEl
 */
export function start(root, titleEl) {
  window.addEventListener('hashchange', () => renderCurrent(root, titleEl));
  return renderCurrent(root, titleEl);
}
