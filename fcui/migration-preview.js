import { FhemClient, isValidName } from '../www/fhem-cms/js/fhem-client.js';
import { createMigrationTransport } from '../www/fhem-cms/js/fcui-migration-transport.js';
import { MigrationController } from '../www/fhem-cms/js/fcui-migration-controller.js';

const ids = ['device-form', 'device', 'upgrade', 'status', 'open-cms', 'load-backups',
  'backup', 'preview-backup', 'backup-status', 'backup-result', 'backup-live', 'backup-data',
  'external-backup', 'commit-restore'];
const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
const initialDevice = new URL(window.location.href).searchParams.get('device');
if (isValidName(initialDevice)) elements.device.value = initialDevice;
let writing = false;
let uncertain = false;
let generation = 0;
let restoreController;

function clearRestore() {
  restoreController?.stop();
  restoreController = undefined;
  elements['backup-result'].hidden = true;
  elements['commit-restore'].disabled = true;
  elements['external-backup'].checked = false;
  elements['backup-live'].textContent = '';
  elements['backup-data'].textContent = '';
}

function setWriting(value) {
  writing = value;
  for (const id of ['device', 'upgrade', 'load-backups', 'backup', 'preview-backup', 'external-backup']) {
    elements[id].disabled = value || uncertain;
  }
  elements['commit-restore'].disabled = true;
}

elements['device-form'].addEventListener('submit', async (event) => {
  event.preventDefault();
  if (writing || uncertain) return;
  let client;
  try {
    client = new FhemClient(elements.device.value.trim());
  } catch (error) {
    elements.status.textContent = error.message;
    return;
  }
  generation += 1;
  clearRestore();
  setWriting(true);
  elements.status.textContent = 'Live und Entwurf werden gesichert und umgestellt …';
  try {
    const result = await client.upgradeLayout();
    elements.status.textContent = result.backup
      ? `Umstellung abgeschlossen. Live-Sicherung: ${result.backup}.`
        + (result.draftBackup ? ` Entwurfssicherung: ${result.draftBackup}.` : '')
      : 'Das CMS verwendet bereits Schema 5.';
    const url = new URL(`../${encodeURIComponent(client.cmsDevice)}/index.html`, window.location.href);
    url.searchParams.set('mode', 'edit');
    elements['open-cms'].href = url.href;
    elements['open-cms'].textContent = 'CMS-Editor öffnen';
    elements['open-cms'].hidden = false;
  } catch (error) {
    uncertain = true;
    elements.status.textContent = `Umstellung nicht bestätigt: ${error.message}. `
      + 'Zustand und Sicherungen prüfen; Seite vor weiteren Aktionen neu laden.';
  } finally {
    setWriting(false);
  }
});

elements.device.addEventListener('input', () => {
  if (writing || uncertain) return;
  generation += 1;
  clearRestore();
  elements.backup.replaceChildren();
  elements['open-cms'].hidden = true;
});

elements['load-backups'].addEventListener('click', async () => {
  if (writing || uncertain) return;
  const current = ++generation;
  clearRestore();
  elements.backup.replaceChildren();
  try {
    const client = new FhemClient(elements.device.value.trim());
    const names = await client.getMigrationBackups();
    if (current !== generation) return;
    for (const name of names) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      elements.backup.append(option);
    }
    elements.backup.disabled = names.length === 0;
    elements['preview-backup'].disabled = names.length === 0;
    elements['backup-status'].textContent = `${names.length} Sicherungen gefunden.`;
  } catch (error) {
    if (current === generation) elements['backup-status'].textContent = `Sicherungen nicht geladen: ${error.message}`;
  }
});

elements.backup.addEventListener('change', () => {
  if (writing || uncertain) return;
  generation += 1;
  clearRestore();
});

elements['preview-backup'].addEventListener('click', async () => {
  if (writing || uncertain) return;
  const current = ++generation;
  clearRestore();
  try {
    const controller = new MigrationController(createMigrationTransport(
      new FhemClient(elements.device.value.trim())));
    restoreController = controller;
    const result = await controller.previewRestore(elements.backup.value);
    if (current !== generation || !result) return;
    elements['backup-live'].textContent = JSON.stringify(result.live, null, 2);
    elements['backup-data'].textContent = JSON.stringify(result.backup, null, 2);
    elements['backup-result'].hidden = false;
    elements['backup-status'].textContent = 'Backup geprüft; es wurde nichts wiederhergestellt.';
  } catch (error) {
    if (current === generation) elements['backup-status'].textContent = `Prüfung fehlgeschlagen: ${error.message}`;
  }
});

elements['external-backup'].addEventListener('change', () => {
  elements['commit-restore'].disabled = writing || uncertain || !restoreController
    || !elements['external-backup'].checked || elements['backup-result'].hidden;
});

elements['commit-restore'].addEventListener('click', async () => {
  if (writing || uncertain || !restoreController || !elements['external-backup'].checked) return;
  setWriting(true);
  try {
    const backup = await restoreController.commit(() => window.confirm(
      'Geprüftes Backup wiederherstellen? Der Live-Stand wird ersetzt und zuvor gesichert.'));
    if (backup === null) return;
    elements['backup-status'].textContent = `Wiederherstellung abgeschlossen. Vorheriger Live-Stand: ${backup}.`;
    clearRestore();
  } catch (error) {
    uncertain = true;
    elements['backup-status'].textContent = `Wiederherstellung nicht bestätigt: ${error.message}. `
      + 'Zustand und Sicherungen prüfen; Seite neu laden.';
  } finally {
    setWriting(false);
    elements['commit-restore'].disabled = uncertain || elements['backup-result'].hidden
      || !elements['external-backup'].checked;
  }
});

window.addEventListener('pagehide', () => {
  generation += 1;
  uncertain = true;
  clearRestore();
});
window.addEventListener('pageshow', (event) => {
  if (uncertain && event.persisted) window.location.reload();
});
