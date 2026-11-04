// Gemeinsamer Dialog zum Suchen eines Devices (Name, Alias, Typ, Raum); liefert den Eintrag aus listAllDevices() oder null.
const MAX_ROWS = 60;

const STYLE = `
  .cms-dp-dialog { border: 1px solid var(--cms-border, #43564a); border-radius: 1rem; background: var(--cms-surface, #202e27); color: var(--cms-text, #edf4ef);
    padding: 1.25rem; width: min(94vw, 32rem); max-height: 94vh; overflow: auto; font: inherit; }
  .cms-dp-dialog::backdrop { background: var(--cms-backdrop, rgb(0 0 0 / 0.6)); }
  .cms-dp-dialog * { box-sizing: border-box; }
  .cms-dp-dialog form { display: grid; gap: 0.75rem; }
  .cms-dp-dialog h3 { margin: 0; font-size: 1.1rem; }
  .cms-dp-dialog input { font: inherit; color: inherit; background: var(--cms-bg, #17211d); border: 1px solid var(--cms-border, #43564a);
    border-radius: 0.5rem; padding: 0.4rem 0.5rem; width: 100%; }
  .cms-dp-dialog .list { max-height: 50vh; overflow: auto; border: 1px solid var(--cms-border, #43564a); border-radius: 0.5rem; background: var(--cms-bg, #17211d); }
  .cms-dp-dialog .list button { display: block; width: 100%; text-align: left; border: 0; border-radius: 0; background: none;
    padding: 0.35rem 0.5rem; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cms-dp-dialog .list button:hover, .cms-dp-dialog .list button:focus-visible { background: var(--cms-surface-active, #3d5a49); outline: none; }
  .cms-dp-dialog button { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--cms-border, #43564a);
    border-radius: 0.5rem; background: var(--cms-surface-raised, #2a3b32); padding: 0.35rem 0.7rem; }
  .cms-dp-dialog input:focus-visible { outline: 2px solid var(--cms-accent, #8fd0a8); outline-offset: 2px; }
  .cms-dp-dialog .hint { margin: 0; color: var(--cms-muted, #a5c9b2); font-size: 0.8rem; }
  .cms-dp-dialog .actions { display: flex; justify-content: flex-end; }
`;

export function openDevicePicker({ services, title = 'Device auswählen', accept = () => true }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'cms-dp-dialog';
    dialog.setAttribute('aria-label', title);
    dialog.innerHTML = `
      <style>${STYLE}</style>
      <form method="dialog" novalidate>
        <h3></h3>
        <input type="search" data-search autocomplete="off" spellcheck="false" placeholder="Name, Alias, Typ oder Raum" aria-label="Devices durchsuchen">
        <div class="list" role="listbox" data-list aria-label="Devices"></div>
        <p class="hint" data-info></p>
        <div class="actions"><button type="button" data-cancel>Abbrechen</button></div>
      </form>`;
    dialog.querySelector('h3').textContent = title;
    const $ = (selector) => dialog.querySelector(selector);
    let devices = [];
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
      const terms = $('[data-search]').value.toLowerCase().split(/\s+/).filter(Boolean);
      const matches = devices.filter((device) => {
        const haystack = [device.name, device.alias, device.type, device.room, device.parent].join(' ').toLowerCase();
        return accept(device) && terms.every((term) => haystack.includes(term));
      });
      const shown = matches.slice(0, MAX_ROWS);
      $('[data-list]').replaceChildren(...shown.map((device) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.setAttribute('role', 'option');
        const alias = device.alias && device.alias !== device.name ? ` (${device.alias})` : '';
        row.textContent = `${device.name}${alias} · ${device.type || '?'}`;
        row.title = row.textContent;
        row.addEventListener('click', () => finish(device));
        return row;
      }));
      $('[data-info]').textContent = matches.length === 0
        ? 'Keine passenden Devices gefunden'
        : matches.length > shown.length
          ? `${shown.length} von ${matches.length} Treffern, Suche weiter einschränken`
          : `${matches.length} Devices`;
    };

    $('[data-search]').addEventListener('input', render);
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
    $('[data-search]').focus();
    $('[data-info]').textContent = 'Geräteliste wird geladen …';
    services.listAllDevices().then((list) => {
      devices = list;
      render();
    }, (error) => {
      $('[data-info]').textContent = `Geräteliste nicht verfügbar: ${error.message || 'Fehler'}`;
    });
  });
}
