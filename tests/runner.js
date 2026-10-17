// Минимальный запускатель тестов для браузера.
// Результаты выводятся на страницу и в window.__testResults для автоматической проверки.

/** @type {{ name: string, fn: () => unknown | Promise<unknown> }[]} */
const tests = [];

/**
 * @param {string} name
 * @param {() => unknown | Promise<unknown>} fn
 */
export function test(name, fn) {
  tests.push({ name, fn });
}

export const assert = {
  /** @param {unknown} v @param {string} [msg] */
  ok(v, msg = 'ожидалось истинное значение') {
    if (!v) throw new Error(msg);
  },
  /** @param {unknown} a @param {unknown} b @param {string} [msg] */
  equal(a, b, msg) {
    if (a !== b) throw new Error(msg ?? `ожидалось ${JSON.stringify(b)}, получено ${JSON.stringify(a)}`);
  },
  /** @param {unknown} a @param {unknown} b @param {string} [msg] */
  deepEqual(a, b, msg) {
    const sa = JSON.stringify(a);
    const sb = JSON.stringify(b);
    if (sa !== sb) throw new Error(msg ?? `ожидалось ${sb}, получено ${sa}`);
  },
  /** @param {() => unknown | Promise<unknown>} fn @param {string} [msg] */
  async rejects(fn, msg = 'ожидалась ошибка') {
    try {
      await fn();
    } catch {
      return;
    }
    throw new Error(msg);
  },
};

export async function run() {
  const list = document.getElementById('results');
  const summary = document.getElementById('summary');
  /** @type {{ name: string, ok: boolean, error?: string }[]} */
  const results = [];

  for (const t of tests) {
    const li = document.createElement('li');
    try {
      await t.fn();
      results.push({ name: t.name, ok: true });
      li.innerHTML = `<span>${t.name}</span><span class="t-ok">✓</span>`;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      results.push({ name: t.name, ok: false, error });
      li.innerHTML = `<span>${t.name}<pre class="t-fail">${error}</pre></span><span class="t-fail">✗</span>`;
    }
    list?.appendChild(li);
  }

  const failed = results.filter((r) => !r.ok).length;
  if (summary) {
    summary.textContent = failed
      ? `Провалено: ${failed} из ${results.length}`
      : `Все ${results.length} проверок пройдены`;
    summary.className = failed ? 't-fail' : 't-ok';
  }
  // @ts-ignore
  window.__testResults = { total: results.length, failed, results };
  return results;
}
