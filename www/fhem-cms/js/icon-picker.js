// Gemeinsamer Dialog zur Icon-Auswahl; liefert den Icon-Namen, '' für „kein Icon“ oder null bei Abbruch.
const PAGE = 120;

const STYLE = `
  .cms-ip-dialog { border: 1px solid var(--cms-border, #43564a); border-radius: 1rem; background: var(--cms-surface, #202e27); color: var(--cms-text, #edf4ef);
    padding: 1.25rem; width: min(94vw, 34rem); max-height: 94vh; overflow: auto; font: inherit; }
  .cms-ip-dialog::backdrop { background: var(--cms-backdrop, rgb(0 0 0 / 0.6)); }
  .cms-ip-dialog * { box-sizing: border-box; }
  .cms-ip-dialog form { display: grid; gap: 0.75rem; }
  .cms-ip-dialog h3 { margin: 0; font-size: 1.1rem; }
  .cms-ip-dialog input { font: inherit; color: inherit; background: var(--cms-bg, #17211d); border: 1px solid var(--cms-border, #43564a);
    border-radius: 0.5rem; padding: 0.4rem 0.5rem; width: 100%; }
  .cms-ip-dialog input:focus-visible, .cms-ip-dialog button:focus-visible { outline: 2px solid var(--cms-accent, #8fd0a8); outline-offset: 2px; }
  .cms-ip-dialog .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(3.2rem, 1fr)); gap: 0.35rem;
    max-height: 18rem; overflow: auto; }
  .cms-ip-dialog button { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--cms-border, #43564a);
    border-radius: 0.5rem; background: var(--cms-surface-raised, #2a3b32); padding: 0.35rem 0.7rem; }
  .cms-ip-dialog .grid button { padding: 0.3rem; display: grid; place-items: center; }
  .cms-ip-dialog .glyph { width: 1.8rem; height: 1.8rem; background-color: var(--cms-accent, #8fd0a8); display: block;
    -webkit-mask: var(--icon-url) center / contain no-repeat; mask: var(--icon-url) center / contain no-repeat; }
  .cms-ip-dialog .hint { margin: 0; color: var(--cms-muted, #a5c9b2); font-size: 0.8rem; }
  .cms-ip-dialog .actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
`;

export function openIconPicker({ services, title = 'Icon wählen' }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'cms-ip-dialog';
    dialog.setAttribute('aria-label', title);
    dialog.innerHTML = `
      <style>${STYLE}</style>
      <form method="dialog" novalidate>
        <h3></h3>
        <input type="search" data-filter autocomplete="off" placeholder="Icons filtern (z. B. light, door)" aria-label="Icons filtern">
        <div class="grid" data-grid role="listbox" aria-label="Icons"></div>
        <p class="hint" data-hint></p>
        <div class="actions"><button type="button" data-clear>Kein Icon</button><button type="button" data-cancel>Abbrechen</button></div>
      </form>`;
    dialog.querySelector('h3').textContent = title;
    const $ = (selector) => dialog.querySelector(selector);
    let icons = [];
    let done = false;

    const finish = (value) => {
      if (done) {
        return;
      }
      done = true;
      if (dialog.open) {
        dialog.close();
      }
      dialog.remove();
      resolve(value);
    };

    const render = () => {
      const filter = $('[data-filter]').value.trim().toLowerCase();
      const matches = icons.filter((name) => name.toLowerCase().includes(filter));
      $('[data-grid]').replaceChildren(...matches.slice(0, PAGE).map((name) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.title = name;
        button.setAttribute('aria-label', name);
        const glyph = document.createElement('span');
        glyph.className = 'glyph';
        glyph.setAttribute('aria-hidden', 'true');
        glyph.style.setProperty('--icon-url', `url("${services.iconUrl(name)}")`);
        button.append(glyph);
        button.addEventListener('click', () => finish(name));
        return button;
      }));
      $('[data-hint]').textContent = icons.length === 0
        ? 'Keine Icons gefunden.'
        : `${matches.length} Treffer${matches.length > PAGE ? `, die ersten ${PAGE} werden angezeigt – Filter verfeinern` : ''}`;
    };

    $('[data-filter]').addEventListener('input', render);
    $('[data-clear]').addEventListener('click', () => finish(''));
    $('[data-cancel]').addEventListener('click', () => finish(null));
    $('form').addEventListener('submit', (event) => event.preventDefault());
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(null);
      }
    });
    dialog.addEventListener('cancel', (event) => event.preventDefault());
    document.body.append(dialog);
    dialog.showModal();
    $('[data-filter]').focus();
    $('[data-hint]').textContent = 'Icons werden geladen …';
    services.listIcons().then((list) => {
      icons = list;
      render();
    }, (error) => {
      $('[data-hint]').textContent = `Icons nicht verfügbar: ${error.message || 'Fehler'}`;
    });
  });
}
