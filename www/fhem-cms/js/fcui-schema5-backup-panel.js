import { createMigrationTransport } from './fcui-migration-transport.js';
import { MigrationController } from './fcui-migration-controller.js';

function element(tag, text) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}

/* Sicherungen / Wiederherstellung als Editor-Dialog: Backups laden, prüfen und
   über den abgesicherten MigrationController wiederherstellen. */
export class Schema5BackupPanel {
  #root;
  #client;
  #browser;
  #onClose;
  #controller = null;
  #status;
  #load;
  #select;
  #preview;
  #result;
  #livePre;
  #backupPre;
  #external;
  #restore;
  #close;
  #busy = false;
  #closed = false;
  #requiresReload = false;
  #uncertain = false;
  #createController;

  constructor({ root, client, browser = window, onClose, createController }) {
    if (!root || root.children.length || !client || typeof client.getMigrationBackups !== 'function'
      || !browser || typeof browser.confirm !== 'function' || typeof onClose !== 'function') {
      throw new Error('Dienste und leerer Container für Sicherungen erforderlich');
    }
    this.#root = root;
    this.#client = client;
    this.#browser = browser;
    this.#onClose = onClose;
    this.#createController = typeof createController === 'function'
      ? createController
      : () => new MigrationController(createMigrationTransport(client));
    const heading = element('h2', 'Sicherungen / Wiederherstellung');
    const hint = element('p', 'Für eine Wiederherstellung vorher eine vollständige externe Sicherung erstellen und prüfen. '
      + 'Ein vorhandener Entwurf muss veröffentlicht oder verworfen werden. Die ausgewählte Sicherung ersetzt den Live-Stand; '
      + 'der bisherige Live-Stand wird zuvor gesichert.');
    this.#status = element('p');
    this.#status.setAttribute('role', 'status');
    this.#load = element('button', 'Backups laden');
    this.#load.type = 'button';
    this.#load.className = 'cms-button';
    const selectLabel = element('label', 'Backup ');
    this.#select = element('select');
    this.#select.disabled = true;
    selectLabel.append(this.#select);
    this.#preview = element('button', 'Backup prüfen');
    this.#preview.type = 'button';
    this.#preview.className = 'cms-button';
    this.#preview.disabled = true;
    const controls = element('div');
    controls.className = 'cms-backup-controls';
    controls.append(this.#load, selectLabel, this.#preview);
    this.#result = element('div');
    this.#result.hidden = true;
    const liveHeading = element('h3', 'Aktueller Live-Stand');
    this.#livePre = element('pre');
    const backupHeading = element('h3', 'Ausgewähltes Backup');
    this.#backupPre = element('pre');
    const externalLabel = element('label', ' Ich habe eine vollständige externe Sicherung erstellt und geprüft.');
    this.#external = element('input');
    this.#external.type = 'checkbox';
    externalLabel.prepend ? externalLabel.prepend(this.#external) : externalLabel.append(this.#external);
    this.#restore = element('button', 'Backup wiederherstellen');
    this.#restore.type = 'button';
    this.#restore.className = 'cms-button';
    this.#restore.disabled = true;
    this.#result.append(liveHeading, this.#livePre, backupHeading, this.#backupPre, externalLabel, this.#restore);
    this.#close = element('button', 'Schließen');
    this.#close.type = 'button';
    this.#close.className = 'cms-button cms-panel-close';
    const footer = element('div');
    footer.className = 'cms-panel-footer';
    footer.append(this.#close);
    root.append(heading, hint, this.#status, controls, this.#result, footer);

    this.#load.addEventListener('click', () => this.#loadBackups());
    this.#select.addEventListener('change', () => this.#clearPreview());
    this.#preview.addEventListener('click', () => this.#previewRestore());
    this.#external.addEventListener('change', () => this.#updateRestore());
    this.#restore.addEventListener('click', () => this.#commitRestore());
    this.#close.addEventListener('click', () => {
      if (this.#busy || this.#closed) return;
      const outcome = { requiresReload: this.#requiresReload };
      this.close();
      this.#onClose(outcome);
    });
  }

  #message(text, error = false) {
    this.#status.textContent = text;
    if (error) this.#status.setAttribute('data-error', '');
    else this.#status.removeAttribute('data-error');
  }

  #clearPreview() {
    this.#controller?.stop();
    this.#controller = null;
    this.#result.hidden = true;
    this.#external.checked = false;
    this.#restore.disabled = true;
    this.#livePre.textContent = '';
    this.#backupPre.textContent = '';
  }

  #updateRestore() {
    this.#restore.disabled = this.#busy || this.#uncertain || !this.#controller
      || !this.#external.checked || this.#result.hidden;
  }

  #setBusy(value) {
    this.#busy = value;
    for (const control of [this.#load, this.#select, this.#preview, this.#external]) {
      control.disabled = value || this.#uncertain;
    }
    this.#close.disabled = value;
    this.#updateRestore();
  }

  async #loadBackups() {
    if (this.#busy || this.#closed || this.#uncertain) return;
    this.#clearPreview();
    this.#select.replaceChildren();
    this.#setBusy(true);
    try {
      const names = await this.#client.getMigrationBackups();
      if (this.#closed) return;
      for (const name of names) {
        const option = element('option', name);
        option.value = name;
        this.#select.append(option);
      }
      this.#setBusy(false);
      this.#select.disabled = names.length === 0;
      this.#preview.disabled = names.length === 0;
      if (names.length && !this.#select.value) this.#select.value = names[0];
      this.#message(`${names.length} Sicherungen gefunden.`);
    } catch (error) {
      if (this.#closed) return;
      this.#setBusy(false);
      this.#select.disabled = true;
      this.#preview.disabled = true;
      this.#message(`Sicherungen nicht geladen: ${error.message || String(error)}`, true);
    }
  }

  async #previewRestore() {
    if (this.#busy || this.#closed || this.#uncertain || !this.#select.value) return;
    this.#clearPreview();
    this.#setBusy(true);
    try {
      const controller = this.#createController();
      const result = await controller.previewRestore(this.#select.value);
      if (this.#closed || !result) return;
      this.#controller = controller;
      this.#livePre.textContent = JSON.stringify(result.live, null, 2);
      this.#backupPre.textContent = JSON.stringify(result.backup, null, 2);
      this.#result.hidden = false;
      this.#message('Backup geprüft; es wurde nichts wiederhergestellt.');
    } catch (error) {
      if (this.#closed) return;
      this.#message(`Prüfung fehlgeschlagen: ${error.message || String(error)}`, true);
    } finally {
      if (!this.#closed) this.#setBusy(false);
    }
  }

  async #commitRestore() {
    if (this.#busy || this.#closed || this.#uncertain || !this.#controller || !this.#external.checked) return;
    this.#setBusy(true);
    try {
      const backup = await this.#controller.commit(() => this.#browser.confirm(
        'Geprüftes Backup wiederherstellen? Der Live-Stand wird ersetzt und zuvor gesichert.'));
      if (this.#closed) return;
      if (backup === null) {
        this.#setBusy(false);
        this.#updateRestore();
        return;
      }
      this.#requiresReload = true;
      this.#clearPreview();
      this.#setBusy(false);
      this.#message(`Wiederherstellung abgeschlossen. Vorheriger Live-Stand: ${backup}.`);
    } catch (error) {
      if (this.#closed) return;
      this.#uncertain = true;
      this.#requiresReload = true;
      this.#setBusy(false);
      this.#message(`Wiederherstellung nicht bestätigt: ${error.message || String(error)}. `
        + 'Zustand und Sicherungen prüfen.', true);
    }
  }

  suspend() {
    if (this.#closed) return;
    this.#root.hidden = true;
    if (!this.#busy) this.close();
    else this.#closed = true;
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#controller?.stop();
    this.#controller = null;
    this.#root.replaceChildren();
  }
}
