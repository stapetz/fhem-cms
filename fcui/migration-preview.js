import { migrationPositions, planEffectiveLegacyLayout } from './layout-migration.js';
import { FhemClient } from '../www/fhem-cms/js/fhem-client.js';

const file = document.getElementById('file');
const status = document.getElementById('status');
const preview = document.getElementById('preview');
const pageSelect = document.getElementById('page');
const summary = document.getElementById('summary');
const canvas = document.getElementById('canvas');
const forms = document.getElementById('forms');
const deviceForm = document.getElementById('device-form');
const device = document.getElementById('device');
const validate = document.getElementById('validate');
let config;
let client;
let changes = new Map();
let sequence = 0;

const keyOf = (item) => item.type === 'navigation' ? 'navigation' : `${item.page}/${item.id}`;
const describe = (grid) => `Spalte ${grid.col}, Zeile ${grid.row}, Breite ${grid.w}, Höhe ${grid.h}`;
const labelOf = (item) => item.type === 'navigation' ? 'Navigation' : `Widget ${item.id}`;
const make = (tag, text) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
};
const normalized = (value) => {
  if (Array.isArray(value)) return value.map(normalized);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalized(value[key])]));
};

function drawTile(grid, text) {
  if (!grid) return;
  const tile = make('div', text);
  tile.className = 'tile';
  tile.style.gridColumn = `${grid.col} / span ${grid.w}`;
  tile.style.gridRow = `${grid.row} / span ${grid.h}`;
  canvas.append(tile);
}

function formFor(item, current, source, original) {
  const form = make('form');
  const fieldset = make('fieldset');
  fieldset.append(make('legend', labelOf(item)), make('p', `Bisher: ${describe(source)}`));
  const details = make('details');
  details.append(make('summary', 'Bisherige Konfiguration anzeigen'));
  details.append(make('pre', original === undefined
    ? 'Keine gespeicherte Navigation; die Standardnavigation wird verwendet.'
    : JSON.stringify(original, null, 2)));
  fieldset.append(details);
  const fields = {};
  for (const [name, title, max] of [
    ['col', 'Spalte', 12], ['row', 'Zeile', 1000], ['w', 'Breite', 12], ['h', 'Höhe', 1000],
  ]) {
    const label = make('label', `${title} `);
    const input = make('input');
    input.type = 'number';
    input.min = '1';
    input.max = String(max);
    input.step = '1';
    input.required = true;
    if (current) input.value = String(current[name]);
    label.append(input);
    fieldset.append(label);
    fields[name] = input;
  }
  const button = make('button', 'Anpassung übernehmen');
  button.type = 'submit';
  fieldset.append(button);
  const reset = make('button', 'Anpassung zurücksetzen');
  reset.type = 'button';
  reset.addEventListener('click', () => {
    sequence += 1;
    changes.delete(keyOf(item));
    render();
    status.textContent = 'Anpassung in dieser Vorschau zurückgesetzt.';
  });
  fieldset.append(reset);
  form.append(fieldset);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const grid = Object.fromEntries(Object.entries(fields).map(([name, input]) => [name, input.valueAsNumber]));
    const next = new Map(changes);
    next.set(keyOf(item), { ...item, grid });
    try {
      planEffectiveLegacyLayout(config, [...next.values()]);
      sequence += 1;
      changes = next;
      render();
      status.textContent = 'Anpassung nur in dieser Vorschau übernommen.';
    } catch (error) {
      status.textContent = `Anpassung nicht übernommen: ${error.message}`;
    }
  });
  return form;
}

function render() {
  const plan = planEffectiveLegacyLayout(config, [...changes.values()]);
  const page = plan.pages.find((entry) => entry.id === pageSelect.value) || plan.pages[0];
  const sourcePage = config.pages.find((entry) => entry.id === page.id);
  pageSelect.value = page.id;
  const collisions = plan.pages.reduce((total, entry) => total + entry.collisions.length, 0);
  const unresolved = plan.pages.reduce((total, entry) =>
    total + entry.widgets.filter((widget) => !widget.grid).length, plan.navigation ? 0 : 1);
  summary.textContent = `Offene Positionen: ${unresolved}; Überschneidungen über alle Seiten: ${collisions}.`
    + (plan.navigationDiffersBetweenPages ? ' Die bisherige Navigation liegt je Seite unterschiedlich.' : '');
  canvas.replaceChildren();
  forms.replaceChildren();
  drawTile(plan.navigation, 'Navigation');
  forms.append(formFor({ type: 'navigation' }, plan.navigation, page.navigationSource, config.navigation));
  for (const widget of page.widgets) {
    drawTile(widget.grid, widget.id);
    const original = sourcePage.widgets.find((entry) => entry.id === widget.id);
    forms.append(formFor({ type: 'widget', page: page.id, id: widget.id }, widget.grid, widget.source, original));
  }
  for (const pair of page.collisions) {
    summary.append(` Überschneidung: ${pair.map(labelOf).join(' / ')}.`);
  }
}

function clearPreview() {
  config = undefined;
  client = undefined;
  changes = new Map();
  preview.hidden = true;
  validate.hidden = true;
  pageSelect.replaceChildren();
  canvas.replaceChildren();
  forms.replaceChildren();
}

function showConfig(candidate, fhemClient) {
  const plan = planEffectiveLegacyLayout(candidate);
  config = candidate;
  client = fhemClient;
  for (const page of plan.pages) {
    const option = make('option', page.id);
    option.value = page.id;
    pageSelect.append(option);
  }
  preview.hidden = false;
  validate.hidden = !client;
  render();
}

file.addEventListener('change', async () => {
  const current = ++sequence;
  clearPreview();
  device.value = '';
  const selected = file.files[0];
  if (!selected) {
    status.textContent = 'Bitte eine Datei auswählen.';
    return;
  }
  if (selected.size > 1048576) {
    status.textContent = 'Die Datei darf höchstens 1 MiB groß sein.';
    return;
  }
  try {
    const candidate = JSON.parse(await selected.text());
    if (current !== sequence) return;
    showConfig(candidate);
    status.textContent = 'Vorschau geladen. Es werden keine Daten gespeichert.';
  } catch (error) {
    if (current !== sequence) return;
    config = undefined;
    preview.hidden = true;
    status.textContent = `Datei konnte nicht analysiert werden: ${error.message}`;
  }
});

deviceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const current = ++sequence;
  clearPreview();
  file.value = '';
  try {
    const candidateClient = new FhemClient(device.value.trim());
    if (await candidateClient.hasDraft()) {
      throw new Error('Ein Entwurf ist vorhanden. Bitte zuerst ausdrücklich veröffentlichen oder verwerfen.');
    }
    const candidate = await candidateClient.getConfig();
    if (current !== sequence) return;
    showConfig(candidate, candidateClient);
    status.textContent = 'Live-Daten geladen. Es werden keine Daten gespeichert.';
  } catch (error) {
    if (current !== sequence) return;
    clearPreview();
    status.textContent = `Live-Daten konnten nicht geladen werden: ${error.message}`;
  }
});

device.addEventListener('input', () => {
  sequence += 1;
  clearPreview();
  status.textContent = 'CMS-Device geändert. Bitte Live-Daten erneut laden.';
});

validate.addEventListener('click', async () => {
  const current = ++sequence;
  try {
    const positions = migrationPositions(config, [...changes.values()]);
    const result = await client.previewMigration(positions);
    if (current !== sequence) return;
    if (JSON.stringify(normalized(result.source)) !== JSON.stringify(normalized(config))) {
      throw new Error('Die Live-Daten wurden geändert. Bitte erneut laden und prüfen.');
    }
    status.textContent = 'Positionen und Konfiguration serverseitig geprüft. Es wurde nichts gespeichert.';
  } catch (error) {
    if (current !== sequence) return;
    status.textContent = `Prüfung fehlgeschlagen: ${error.message}`;
  }
});

pageSelect.addEventListener('change', render);
