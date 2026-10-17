// Страницы-заглушки для разделов, которые будут реализованы на следующих этапах.

/**
 * @param {string} text
 * @param {number} stage
 */
export function placeholder(text, stage) {
  return {
    /** @param {HTMLElement} root */
    render(root) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<p>${text}</p><p class="muted">Раздел появится на этапе ${stage}.</p>`;
      root.appendChild(card);
    },
  };
}
