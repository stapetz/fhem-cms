// Dialog zum Suchen und Einsetzen eines Platzhalters (Device, Reading, Filter), gemeinsam für Texteditor und freies HTML.
import { formatValue, isValidDeviceName, isValidFilter, isValidReadingName } from './freehtml.js';
import { UNIT_SUGGESTIONS, unitInputCss, unitSuggestions } from './unit-input.js';

const MAX_ROWS = 40;
const validUnit = (value) => value.length <= 16 && !/[()|{}"<>\u0000-\u001f\u007f]/.test(value);
const unitSuffix = (unit) => `suffix( ${unit})`;
const PRESETS = [
  ['round(1)', 'Runden auf 1 Stelle'], ['round(0)', 'Runden ohne Nachkommastellen'], ['int', 'Ganzzahl'],
  ['upper', 'Großbuchstaben'], ['lower', 'Kleinbuchstaben'], ['default(–)', 'Ersatz bei leerem Wert'],
  ['prefix(Text )', 'Text davor'], ['suffix( °C)', 'Einheit °C'], ['suffix( %)', 'Einheit %'],
  ['map(on=An,off=Aus)', 'Werte ersetzen']
];

const STYLE = `
  .cms-ph-dialog { border: 1px solid var(--cms-border, #43564a); border-radius: 1rem; background: var(--cms-surface, #202e27); color: var(--cms-text, #edf4ef);
    padding: 1.25rem; width: min(94vw, 46rem); max-height: 94vh; overflow: auto; font: inherit; }
  .cms-ph-dialog::backdrop { background: var(--cms-backdrop, rgb(0 0 0 / 0.6)); }
  .cms-ph-dialog * { box-sizing: border-box; }
  .cms-ph-dialog form { display: grid; gap: 0.75rem; }
  .cms-ph-dialog h3 { margin: 0; font-size: 1.1rem; }
  .cms-ph-dialog label { display: grid; gap: 0.25rem; font-size: 0.9rem; }
  .cms-ph-dialog input, .cms-ph-dialog select { font: inherit; color: inherit; background: var(--cms-bg, #17211d); border: 1px solid var(--cms-border, #43564a);
    border-radius: 0.5rem; padding: 0.4rem 0.5rem; width: 100%; }
  .cms-ph-dialog .cols { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
  .cms-ph-dialog .cols > div { display: grid; gap: 0.35rem; align-content: start; }
  .cms-ph-dialog .list { max-height: 12rem; overflow: auto; border: 1px solid var(--cms-border, #43564a); border-radius: 0.5rem; background: var(--cms-bg, #17211d); }
  .cms-ph-dialog .list button { display: block; width: 100%; text-align: left; border: 0; border-radius: 0; background: none;
    padding: 0.3rem 0.5rem; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cms-ph-dialog .list button[aria-selected="true"] { background: var(--cms-surface-active, #3d5a49); }
  .cms-ph-dialog button { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--cms-border, #43564a);
    border-radius: 0.5rem; background: var(--cms-surface-raised, #2a3b32); padding: 0.35rem 0.7rem; }
  .cms-ph-dialog button:hover { background: var(--cms-surface-hover, #34493e); }
  .cms-ph-dialog button:disabled { opacity: 0.5; cursor: default; }
  .cms-ph-dialog button:focus-visible, .cms-ph-dialog input:focus-visible, .cms-ph-dialog select:focus-visible {
    outline: 2px solid var(--cms-accent, #8fd0a8); outline-offset: 2px; }
  .cms-ph-dialog .hint { margin: 0; color: var(--cms-muted, #a5c9b2); font-size: 0.8rem; }
  .cms-ph-dialog .result { margin: 0; padding: 0.5rem; border-radius: 0.5rem; background: var(--cms-bg, #17211d); font-family: ui-monospace, monospace;
    font-size: 0.85rem; overflow-wrap: anywhere; }
  .cms-ph-dialog .check { display: flex; align-items: center; gap: 0.5rem; }
  .cms-ph-dialog .check input { width: auto; }
  .cms-ph-dialog .row { display: flex; gap: 0.5rem; }
  .cms-ph-dialog .filter { display: grid; gap: 0.4rem; padding: 0.6rem; border: 1px solid var(--cms-border, #43564a); border-radius: 0.75rem; }
  .cms-ph-dialog .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .cms-ph-dialog .chips button { padding: 0.15rem 0.6rem; font-size: 0.8rem; border-radius: 1rem; font-family: ui-monospace, monospace; }
  .cms-ph-dialog .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: flex-end; }
  ${unitInputCss}
`;

const TEMPLATE = `
  <style>${STYLE}</style>
  <form method="dialog" novalidate>
    <h3 data-title>Platzhalter suchen</h3>
    <div class="cols">
      <div>
        <label>Device suchen (Name, Alias, Typ, Raum)
          <input data-device autocomplete="off" spellcheck="false" aria-label="Device">
        </label>
        <div class="list" role="listbox" data-device-list aria-label="Devices"></div>
        <p class="hint" data-device-info></p>
      </div>
      <div>
        <label>Reading
          <input data-reading autocomplete="off" spellcheck="false" aria-label="Reading">
        </label>
        <div class="list" role="listbox" data-reading-list aria-label="Readings"></div>
        <p class="hint">@alias, @name und @type liefern Alias, Namen und Typ des Devices.</p>
      </div>
    </div>
    <label>Einheit hinter dem Wert (optional, Vorschlag wählen oder frei eintragen)
      <input data-unit aria-label="Einheit" maxlength="16" autocomplete="off">
    </label>
    <div data-unit-choices></div>
    <div class="filter">
      <label>Filter (optional)
        <span class="row">
          <input data-filter autocomplete="off" spellcheck="false" placeholder="z. B. round(1)|suffix( °C)" aria-label="Filter">
          <button type="button" data-filter-clear title="Filter leeren">Leeren</button>
        </span>
      </label>
      <div class="chips" data-presets role="group" aria-label="Filter hinzufügen"></div>
      <p class="hint" data-preset-hint>Ein Klick fügt den Filter an; mehrere werden mit | verkettet. Beschreibung beim Darüberfahren.</p>
    </div>
    <label class="check" data-element-row hidden><input type="checkbox" data-element> Als Element schreiben (&lt;span device=… reading=…&gt;)</label>
    <p class="hint" data-preview></p>
    <p class="result" data-result></p>
    <p class="hint" data-error role="alert"></p>
    <div class="actions">
      <button type="button" data-cancel>Abbrechen</button>
      <button type="submit" data-ok>Einfügen</button>
    </div>
  </form>
`;

// Liefert { device, reading, filter, asElement } oder null, wenn abgebrochen wurde.
export function openPlaceholderPicker({ services, initial = null, allowElement = false }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'cms-ph-dialog';
    dialog.setAttribute('aria-label', 'Platzhalter suchen');
    dialog.innerHTML = TEMPLATE;
    const $ = (selector) => dialog.querySelector(selector);
    const deviceInput = $('[data-device]');
    const readingInput = $('[data-reading]');
    const filterInput = $('[data-filter]');
    const unitInput = $('[data-unit]');
    const elementBox = $('[data-element]');
    let devices = [];
    let loadError = '';
    $('[data-unit-choices]').append(unitSuggestions(unitInput));
    const selectedUnit = () => {
      const last = filterInput.value.trim().split('|').at(-1).trim();
      const match = /^suffix\( (.+)\)$/.exec(last);
      return match && validUnit(match[1]) ? match[1] : '';
    };

    $('[data-element-row]').hidden = !allowElement;
    if (initial) {
      $('[data-title]').textContent = 'Platzhalter bearbeiten';
      $('[data-ok]').textContent = 'Übernehmen';
      deviceInput.value = initial.device || '';
      readingInput.value = initial.reading || '';
      filterInput.value = initial.filter || '';
    }
    const presetBox = $('[data-presets]');
    presetBox.append(...PRESETS.map(([value, label]) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = value;
      chip.title = label;
      chip.addEventListener('click', () => {
        const filters = filterInput.value.trim().split('|').filter((part) => part.trim());
        const unit = selectedUnit();
        if (unit) filters.pop();
        filters.push(value);
        if (unit && !UNIT_SUGGESTIONS.some((entry) => value === unitSuffix(entry))) filters.push(unitSuffix(unit));
        filterInput.value = filters.join('|');
        refresh(true);
        filterInput.focus();
      });
      return chip;
    }));

    const terms = (text) => text.toLowerCase().split(/\s+/).filter(Boolean);
    const selectedDevice = () => devices.find((item) => item.name === deviceInput.value.trim()) || null;

    // Readings des Devices und seiner Kanäle; das Hauptdevice hat Vorrang (wie bei der Anzeige).
    const readingsOf = (device) => {
      const map = new Map([['@alias', device.alias || ''], ['@name', device.name], ['@type', device.type || '']]);
      const group = [device, ...devices.filter((item) => item.parent === device.name)];
      for (const item of group) {
        for (const [name, value] of Object.entries(item.readings || {})) {
          if (!map.has(name)) {
            map.set(name, value);
          }
        }
      }
      return map;
    };

    const rowButton = (text, selected, onClick) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(selected));
      row.textContent = text;
      row.title = text;
      row.addEventListener('click', onClick);
      return row;
    };

    const renderDevices = () => {
      const wanted = terms(deviceInput.value);
      const matches = devices.filter((item) => {
        const haystack = [item.name, item.alias, item.type, item.room].join(' ').toLowerCase();
        return wanted.every((term) => haystack.includes(term));
      });
      const shown = matches.slice(0, MAX_ROWS);
      $('[data-device-list]').replaceChildren(...shown.map((item) => rowButton(
        `${item.name}${item.alias && item.alias !== item.name ? ` (${item.alias})` : ''}${item.type ? ` · ${item.type}` : ''}`,
        item.name === deviceInput.value.trim(),
        () => {
          deviceInput.value = item.name;
          readingInput.value = '';
          refresh();
          readingInput.focus();
        })));
      $('[data-device-info]').textContent = loadError || (devices.length === 0
        ? 'Geräteliste wird geladen …'
        : matches.length === 0
          ? 'Keine passenden Devices (der Name kann trotzdem von Hand eingetragen werden)'
          : matches.length > shown.length
            ? `${shown.length} von ${matches.length} Treffern, Suche weiter einschränken`
            : `${matches.length} Devices`);
    };

    const renderReadings = () => {
      const device = selectedDevice();
      const list = $('[data-reading-list]');
      if (!device) {
        list.replaceChildren();
        return;
      }
      const wanted = terms(readingInput.value);
      const entries = [...readingsOf(device)]
        .filter(([name]) => wanted.every((term) => name.toLowerCase().includes(term)))
        .sort(([a], [b]) => a.localeCompare(b));
      list.replaceChildren(...entries.slice(0, MAX_ROWS * 3).map(([name, value]) => rowButton(
        `${name} = ${value === '' ? '(leer)' : value}`,
        name === readingInput.value.trim(),
        () => {
          readingInput.value = name;
          refresh();
        })));
    };

    const refresh = (syncUnit = false) => {
      if (syncUnit === true) unitInput.value = selectedUnit();
      renderDevices();
      renderReadings();
      const device = deviceInput.value.trim();
      const reading = readingInput.value.trim();
      const filter = filterInput.value.trim();
      let problem = '';
      if (!validUnit(unitInput.value.trim())) {
        problem = 'Ungültige Einheit (max. 16 Zeichen; keine Steuerzeichen oder Filter-/HTML-Syntax)';
      } else if (!isValidDeviceName(device)) {
        problem = device ? 'Ungültiger Device-Name (erlaubt: Buchstaben, Ziffern, _ . -)' : 'Bitte ein Device wählen';
      } else if (!isValidReadingName(reading)) {
        problem = reading ? 'Ungültiger Reading-Name' : 'Bitte ein Reading wählen';
      } else if (!isValidFilter(filter)) {
        problem = 'Ungültiger Filter (Beispiel: round(1)|suffix( °C))';
      }
      $('[data-error]').textContent = problem;
      $('[data-ok]').disabled = problem !== '';
      const found = selectedDevice();
      const value = found ? readingsOf(found).get(reading) : undefined;
      $('[data-preview]').textContent = problem ? '' : (value === undefined
        ? 'Aktueller Wert: unbekannt (Reading nicht gefunden)'
        : `Aktueller Wert: ${formatValue(value, filter)}`);
      $('[data-result]').textContent = problem ? '' : (elementBox.checked
        ? `<span device="${device}" reading="${reading}"${filter ? ` filter="${filter}"` : ''}></span>`
        : `{{${device}:${reading}${filter ? `|${filter}` : ''}}}`);
    };

    const finish = (value) => {
      if (dialog.open) {
        dialog.close();
      }
      dialog.remove();
      resolve(value);
    };

    deviceInput.addEventListener('input', refresh);
    readingInput.addEventListener('input', refresh);
    filterInput.addEventListener('input', () => refresh(true));
    unitInput.addEventListener('input', () => {
      const unit = unitInput.value.trim();
      if (!validUnit(unit)) {
        refresh(false);
        return;
      }
      const filters = filterInput.value.trim().split('|').filter((part) => part.trim());
      if (selectedUnit()) filters.pop();
      if (unit) filters.push(unitSuffix(unit));
      filterInput.value = filters.join('|');
      refresh(false);
    });
    elementBox.addEventListener('change', refresh);
    $('[data-filter-clear]').addEventListener('click', () => {
      filterInput.value = '';
      refresh(true);
      filterInput.focus();
    });
    $('[data-cancel]').addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finish(null);
      }
    });
    $('form').addEventListener('submit', (event) => {
      event.preventDefault();
      if ($('[data-ok]').disabled) {
        return;
      }
      finish({
        device: deviceInput.value.trim(),
        reading: readingInput.value.trim(),
        filter: filterInput.value.trim(),
        asElement: allowElement && elementBox.checked
      });
    });

    document.body.append(dialog);
    dialog.showModal();
    refresh(true);
    deviceInput.focus();
    Promise.resolve(services.listAllDevices()).then((list) => {
      devices = Array.isArray(list) ? list : [];
    }).catch((error) => {
      loadError = `Geräteliste nicht verfügbar: ${error.message || 'unbekannter Fehler'}`;
    }).then(refresh);
  });
}
