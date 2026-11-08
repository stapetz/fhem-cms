import { migrationPositions, planEffectiveLegacyLayout, suggestEffectiveLegacyLayout } from './layout-migration.js';
import { createPreviewServices } from './preview-services.js';
import { FhemClient, isValidName } from '../www/fhem-cms/js/fhem-client.js';
import { createMigrationTransport } from '../www/fhem-cms/js/fcui-migration-transport.js';
import { MigrationController } from '../www/fhem-cms/js/fcui-migration-controller.js';

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
const showTarget = document.getElementById('show-target');
const showWidgets = document.getElementById('show-widgets');
const target = document.getElementById('target');
const targetGrid = document.getElementById('target-grid');
const targetStatus = document.getElementById('target-status');
const widgetTarget = document.getElementById('widget-target');
const widgetGrid = document.getElementById('widget-grid');
const widgetStatus = document.getElementById('widget-status');
const loadBackups = document.getElementById('load-backups');
const backupControls = document.getElementById('backup-controls');
const backupSelect = document.getElementById('backup');
const previewBackup = document.getElementById('preview-backup');
const backupStatus = document.getElementById('backup-status');
const backupResult = document.getElementById('backup-result');
const backupLive = document.getElementById('backup-live');
const backupData = document.getElementById('backup-data');
const migrateButton = document.getElementById('commit-migration');
const migrationReady = document.getElementById('migration-ready');
const restoreButton = document.getElementById('commit-restore');
const externalBackup = document.getElementById('external-backup');
const initialDevice = new URL(window.location.href).searchParams.get('device');
if (isValidName(initialDevice)) device.value = initialDevice;
let config;
let client;
let changes = new Map();
let suggestions = new Map();
let sequence = 0;
let backupSequence = 0;
let backupClient;
let migrationController;
let restoreController;
let writing = false;
let targetConfig;
let targetInstance;
let targetGeneration = 0;
let targetVisible = false;
let widgetView;
let widgetBase;
let widgetGeneration = 0;
let widgetVisible = false;
let migrationValidated = false;

function updateMigrationControls() {
  validate.disabled = writing || !client;
  migrateButton.disabled = writing || !migrationValidated || !externalBackup.checked;
  migrationReady.textContent = !client
    ? 'Bitte zuerst die Live-Daten eines CMS-Devices laden.'
    : !migrationValidated
      ? 'Bitte den Layoutvorschlag serverseitig prüfen.'
      : !externalBackup.checked
        ? 'Bitte die vollständige externe Sicherung bestätigen.'
        : 'Das geprüfte Layout kann nach Bestätigung migriert werden.';
}

const keyOf = (item) => item.type === 'navigation' ? 'navigation' : `${item.page}/${item.id}`;
const describe = (grid) => `Spalte ${grid.col}, Zeile ${grid.row}, Breite ${grid.w}, Höhe ${grid.h}`;
const labelOf = (item) => item.type === 'navigation' ? 'Navigation' : `Widget ${item.id}`;
const make = (tag, text) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
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
    if (writing) return;
    sequence += 1;
    clearTarget();
    changes.set(keyOf(item), structuredClone(suggestions.get(keyOf(item))));
    render();
    status.textContent = 'Automatischer Vorschlag wiederhergestellt.';
  });
  fieldset.append(reset);
  form.append(fieldset);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (writing) return;
    const grid = Object.fromEntries(Object.entries(fields).map(([name, input]) => [name, input.valueAsNumber]));
    const next = new Map(changes);
    next.set(keyOf(item), { ...item, grid });
    try {
      planEffectiveLegacyLayout(config, [...next.values()]);
      sequence += 1;
      clearTarget();
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
  clearTarget();
  if (migrationController) migrationController.stop();
  migrationController = undefined;
  config = undefined;
  client = undefined;
  changes = new Map();
  suggestions = new Map();
  preview.hidden = true;
  updateMigrationControls();
  pageSelect.replaceChildren();
  canvas.replaceChildren();
  forms.replaceChildren();
}

function clearTarget() {
  if (migrationController) migrationController.invalidate();
  migrationValidated = false;
  updateMigrationControls();
  targetGeneration += 1;
  clearWidgetTarget();
  targetConfig = undefined;
  targetVisible = false;
  showTarget.hidden = true;
  showWidgets.hidden = true;
  target.hidden = true;
  if (targetInstance) targetInstance.destroy(false);
  targetInstance = undefined;
  targetGrid.replaceChildren();
  targetStatus.textContent = '';
}

function clearWidgetTarget() {
  widgetGeneration += 1;
  widgetVisible = false;
  widgetTarget.hidden = true;
  if (widgetView) widgetView.destroy();
  widgetView = undefined;
  if (widgetBase) widgetBase.remove();
  widgetBase = undefined;
  widgetGrid.replaceChildren();
  widgetStatus.textContent = '';
}

async function renderWidgetTarget() {
  clearWidgetTarget();
  widgetVisible = true;
  widgetTarget.hidden = false;
  const generation = widgetGeneration;
  const currentConfig = targetConfig;
  const currentClient = client;
  const currentPage = pageSelect.value;
  widgetStatus.textContent = 'Widgets und aktuelle Werte werden geladen …';
  try {
    if (!document.getElementById('grid-css').sheet) throw new Error('Gridstack-CSS konnte nicht geladen werden');
    const url = (path) => new URL(path, window.location.href).href;
    const [runtime, adapter, factory] = await Promise.all([
      import(url('../js/fcui-runtime.js')), import(url('../js/fcui-schema5-widgets.js')),
      import(url('../js/widget-factory.js')),
    ]);
    if (generation !== widgetGeneration) return;
    const page = currentConfig.pages.find((entry) => entry.id === currentPage);
    if (!page) throw new Error('Unbekannte Seite');
    const devices = [...new Set(page.widgets.flatMap(factory.devicesOf).filter(isValidName))];
    const specs = devices.flatMap((name) => [name, `device=${name}`]);
    const data = devices.length ? await currentClient.jsonlist(specs.join(',')) : [];
    if (generation !== widgetGeneration) return;
    const nav = make('nav');
    nav.className = `widget-nav${currentConfig.navigation.orientation === 'vertical' ? ' vertical' : ''}`;
    nav.setAttribute('aria-label', 'Seiten');
    for (const entry of currentConfig.pages) {
      const item = (currentConfig.navigation.items || []).find((candidate) => candidate.page === entry.id) || {};
      const label = make('span', item.label || entry.title);
      if (item.width) label.style.width = `${item.width}px`;
      if (item.height) label.style.height = `${item.height}px`;
      nav.append(label);
    }
    widgetBase = document.createElement('base');
    widgetBase.href = new URL(`../${currentClient.cmsDevice}/`, window.location.href).href;
    document.head.prepend(widgetBase);
    const services = createPreviewServices(currentClient);
    widgetView = adapter.mountSchema5Widgets(runtime.GridStack, widgetGrid, currentConfig, currentPage,
      nav, services, factory.groupSnapshots(devices, data));
    widgetStatus.textContent = 'Widgets geladen. Die angezeigten Werte werden nicht automatisch aktualisiert.';
  } catch (error) {
    if (generation !== widgetGeneration) return;
    if (widgetBase) widgetBase.remove();
    widgetBase = undefined;
    widgetStatus.textContent = `Widgets konnten nicht angezeigt werden: ${error.message}`;
  }
}

async function renderTarget() {
  const generation = ++targetGeneration;
  const currentConfig = targetConfig;
  const currentPage = pageSelect.value;
  if (targetInstance) targetInstance.destroy(false);
  targetInstance = undefined;
  targetGrid.replaceChildren();
  targetStatus.textContent = 'Gridstack-Zielraster wird geladen …';
  try {
    if (!document.getElementById('grid-css').sheet) throw new Error('Gridstack-CSS konnte nicht geladen werden');
    const url = (path) => new URL(path, window.location.href).href;
    const [runtime, layout] = await Promise.all([
      import(url('../js/fcui-runtime.js')), import(url('../js/fcui-schema5-layout.js')),
    ]);
    if (generation !== targetGeneration) return;
    const current = currentConfig.pages.find((page) => page.id === currentPage);
    if (!current) throw new Error('Unbekannte Seite');
    targetInstance = layout.createSchema5Grid(runtime.GridStack, targetGrid, currentConfig, currentPage, (id) => {
      const widget = current.widgets.find((entry) => entry.id === id);
      return make('span', id === '__nav' ? 'Navigation' : `${id} (${widget.type})`);
    });
    targetStatus.textContent = 'Gridstack hat die geprüften Positionen unverändert übernommen.';
  } catch (error) {
    if (generation !== targetGeneration) return;
    targetStatus.textContent = `Gridstack-Zielraster konnte nicht angezeigt werden: ${error.message}`;
  }
}

function clearBackups() {
  backupSequence += 1;
  if (restoreController) restoreController.stop();
  restoreController = undefined;
  restoreButton.hidden = true;
  backupClient = undefined;
  backupControls.hidden = true;
  backupResult.hidden = true;
  backupSelect.replaceChildren();
  backupLive.textContent = '';
  backupData.textContent = '';
}

function showConfig(candidate, fhemClient) {
  const automatic = suggestEffectiveLegacyLayout(candidate);
  const plan = planEffectiveLegacyLayout(candidate, automatic);
  config = candidate;
  client = fhemClient;
  suggestions = new Map(automatic.map((item) => [keyOf(item), item]));
  changes = new Map(automatic.map((item) => [keyOf(item), structuredClone(item)]));
  migrationController = client ? new MigrationController(createMigrationTransport(client)) : undefined;
  for (const page of plan.pages) {
    const option = make('option', page.id);
    option.value = page.id;
    pageSelect.append(option);
  }
  preview.hidden = false;
  updateMigrationControls();
  render();
}

file.addEventListener('change', async () => {
  if (writing) return;
  const current = ++sequence;
  clearPreview();
  clearBackups();
  backupStatus.textContent = 'Für die Backup-Prüfung ein CMS-Device angeben.';
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
    status.textContent = 'Automatischer Layoutvorschlag geladen. Es werden keine Daten gespeichert.';
  } catch (error) {
    if (current !== sequence) return;
    config = undefined;
    preview.hidden = true;
    status.textContent = `Datei konnte nicht analysiert werden: ${error.message}`;
  }
});

deviceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (writing) return;
  const current = ++sequence;
  clearPreview();
  file.value = '';
  try {
    const candidateClient = new FhemClient(device.value.trim());
    const candidate = await candidateClient.getMigrationSource();
    if (current !== sequence) return;
    showConfig(candidate, candidateClient);
    status.textContent = 'Automatischer Layoutvorschlag aus Live-Daten geladen. Es werden keine Daten gespeichert.';
  } catch (error) {
    if (current !== sequence) return;
    clearPreview();
    status.textContent = `Live-Daten konnten nicht geladen werden: ${error.message}`;
  }
});

device.addEventListener('input', () => {
  if (writing) return;
  externalBackup.checked = false;
  sequence += 1;
  clearPreview();
  status.textContent = 'CMS-Device geändert. Bitte Live-Daten erneut laden.';
  clearBackups();
  backupStatus.textContent = 'CMS-Device geändert. Bitte Backups erneut laden.';
});

loadBackups.addEventListener('click', async () => {
  if (writing) return;
  const current = ++backupSequence;
  if (restoreController) restoreController.stop();
  restoreController = undefined;
  restoreButton.hidden = true;
  backupClient = undefined;
  backupControls.hidden = true;
  backupResult.hidden = true;
  backupSelect.replaceChildren();
  try {
    const candidateClient = new FhemClient(device.value.trim());
    const backups = await candidateClient.getMigrationBackups();
    if (current !== backupSequence) return;
    if (!backups.length) {
      backupStatus.textContent = 'Keine Backups vorhanden.';
      return;
    }
    for (const name of backups) {
      const option = make('option', name);
      option.value = name;
      backupSelect.append(option);
    }
    backupClient = candidateClient;
    restoreController = new MigrationController(createMigrationTransport(candidateClient));
    backupControls.hidden = false;
    backupStatus.textContent = 'Backup auswählen und prüfen. Es werden keine Daten gespeichert.';
  } catch (error) {
    if (current !== backupSequence) return;
    backupStatus.textContent = `Backups konnten nicht geladen werden: ${error.message}`;
  }
});

backupSelect.addEventListener('change', () => {
  if (writing) return;
  backupSequence += 1;
  if (restoreController) restoreController.invalidate();
  restoreButton.hidden = true;
  backupResult.hidden = true;
  backupStatus.textContent = 'Backup geändert. Bitte erneut prüfen.';
});

previewBackup.addEventListener('click', async () => {
  if (writing) return;
  const current = ++backupSequence;
  backupResult.hidden = true;
  restoreButton.hidden = true;
  try {
    const result = await restoreController.previewRestore(backupSelect.value);
    if (current !== backupSequence) return;
    backupLive.textContent = JSON.stringify(result.live, null, 2);
    backupData.textContent = JSON.stringify(result.backup, null, 2);
    backupResult.hidden = false;
    restoreButton.hidden = false;
    backupStatus.textContent = 'Live und Backup serverseitig geprüft. Es wurde nichts wiederhergestellt.';
  } catch (error) {
    if (current !== backupSequence) return;
    backupStatus.textContent = `Backup konnte nicht geprüft werden: ${error.message}`;
  }
});

validate.addEventListener('click', async () => {
  if (writing) return;
  const current = ++sequence;
  clearTarget();
  try {
    const positions = migrationPositions(config, [...changes.values()]);
    const result = await migrationController.previewMigration(config, positions);
    if (current !== sequence) return;
    targetConfig = result.config;
    showTarget.hidden = false;
    showWidgets.hidden = false;
    migrationValidated = true;
    updateMigrationControls();
    status.textContent = 'Positionen und Konfiguration serverseitig geprüft. Es wurde nichts gespeichert.';
  } catch (error) {
    if (current !== sequence) return;
    status.textContent = `Prüfung fehlgeschlagen: ${error.message}`;
  }
});

async function commit(controller, action) {
  if (writing) return;
  if (!externalBackup.checked) {
    throw new Error('Vorher eine vollständige externe Sicherung erstellen und prüfen.');
  }
  writing = true;
  const controls = [file, device, pageSelect, backupSelect, validate, loadBackups, previewBackup,
    migrateButton, restoreButton, externalBackup];
  for (const control of controls) control.disabled = true;
  try {
    return await controller.commit(() => window.confirm(action === 'migrate'
      ? 'CMS jetzt auf Schema 5 umstellen? Die Live-Konfiguration wird ersetzt. Eine geprüfte externe Sicherung muss vorliegen.'
      : 'Backup jetzt wiederherstellen? Die Live-Konfiguration wird ersetzt. Eine geprüfte externe Sicherung muss vorliegen.'));
  } finally {
    writing = false;
    for (const control of controls) control.disabled = false;
    updateMigrationControls();
  }
}

migrateButton.addEventListener('click', async () => {
  if (!migrationValidated || !client) return;
  try {
    const backup = await commit(migrationController, 'migrate');
    if (backup === null) return;
    externalBackup.checked = false;
    clearPreview();
    clearBackups();
    status.textContent = `Umstellung abgeschlossen. Sicherung: ${backup}. CMS-Seite neu laden.`;
  } catch (error) {
    clearTarget();
    status.textContent = `Umstellung nicht bestätigt: ${error.message}. Zustand und Sicherungen erneut prüfen.`;
  }
});

externalBackup.addEventListener('change', updateMigrationControls);
updateMigrationControls();

restoreButton.addEventListener('click', async () => {
  try {
    const backup = await commit(restoreController, 'restore');
    if (backup === null) return;
    externalBackup.checked = false;
    clearPreview();
    clearBackups();
    backupStatus.textContent = `Wiederherstellung abgeschlossen. Vorheriger Live-Stand: ${backup}. CMS-Seite neu laden.`;
  } catch (error) {
    if (restoreController) restoreController.invalidate();
    restoreButton.hidden = true;
    backupStatus.textContent = `Wiederherstellung nicht bestätigt: ${error.message}. Zustand und Sicherungen erneut prüfen.`;
  }
});

showTarget.addEventListener('click', () => {
  targetVisible = true;
  target.hidden = false;
  renderTarget();
});

showWidgets.addEventListener('click', renderWidgetTarget);
let suspended = false;
window.addEventListener('pagehide', () => {
  suspended = true;
  sequence += 1;
  clearPreview();
  clearBackups();
});
window.addEventListener('pageshow', (event) => {
  if (suspended && event.persisted) window.location.reload();
});

pageSelect.addEventListener('change', () => {
  if (writing) return;
  render();
  if (targetVisible) renderTarget();
  if (widgetVisible) renderWidgetTarget();
});
