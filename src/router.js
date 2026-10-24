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

// Стек экранов внутри приложения: «Назад» возвращает туда, откуда пришли.
/** @type {string[]} */
const stack = [];

/**
 * Переход после действия (сохранить, удалить): заменяет текущий экран,
 * чтобы «Назад» не возвращал в уже заполненную форму.
 * @param {string} path
 */
export function navigate(path) {
  // Возврат на предыдущий экран — шагом назад по истории, без дубля в истории
  if (stack[stack.length - 2] === path) {
    history.back();
    return;
  }
  stack.pop();
  location.replace(`#${path}`);
}

/** @type {string} */
let fallbackBack = '/';

/** Назад: по истории, если есть куда, иначе на родительский экран. */
export function goBack() {
  if (stack.length > 1) history.back();
  else location.replace(`#${fallbackBack}`);
}

// Переход по нижней вкладке начинает путь заново: «Назад» на разделе не нужен
let fromTab = false;

/** @param {string} path */
function track(path) {
  if (fromTab) {
    fromTab = false;
    stack.length = 0;
    stack.push(path);
    return;
  }
  if (stack[stack.length - 1] === path) return;
  if (stack[stack.length - 2] === path) stack.pop();
  else stack.push(path);
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
  fallbackBack = route.back ?? '/';
  track(path);
  // «Назад» — у вложенных экранов всегда, у разделов — если пришли с другого экрана
  // (например, с главной в «Бюджет»), а не нажатием на нижнюю вкладку
  backEl.hidden = !route.back && stack.length < 2;
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
  document.querySelectorAll('[data-route]').forEach((tab) => tab.addEventListener('click', () => {
    // Нажатие на вкладку текущего экрана перехода не вызывает
    if (tab.getAttribute('href') !== location.hash) fromTab = true;
  }));
  backEl.addEventListener('click', (e) => {
    e.preventDefault();
    goBack();
  });
  // Жест «смахнуть от левого края вправо» — назад (в установленном приложении
  // на iPhone системного жеста нет)
  /** @type {{ x: number, y: number } | null} */
  let touch = null;
  window.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    touch = t && t.clientX < 28 && !backEl.hidden ? { x: t.clientX, y: t.clientY } : null;
  }, { passive: true });
  window.addEventListener('touchend', (e) => {
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x;
    const dy = Math.abs(t.clientY - touch.y);
    touch = null;
    if (dx > 70 && dy < 60) goBack();
  }, { passive: true });
  return renderCurrent(root, titleEl, backEl);
}
