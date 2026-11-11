function element(tag, text) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  return result;
}

const FILE_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const FILE_NAME_HINT = 'Ungültiger Dateiname: erlaubt sind 1–64 Zeichen aus A–Z, a–z, 0–9, „_“ und „-“.';
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/* Navigation bearbeiten: zentrale, kompakte Seitenverwaltung je Navigationspunkt.
   Reihenfolge (≡), Dateiname, Seitentitel, Beschriftung und Größen; neue Seiten
   und das Löschen leerer Seiten. Gespeichert wird alles in einem Entwurf. */
export class Schema5NavigationPanel {
  #root;
  #controller;
  #browser;
  #token;
  #onClose;
  #status;
  #form;
  #orientation;
  #sharedEnabled;
  #shared = {};
  #rows = [];
  #rowsBox;
  #save;
  #close;
  #baseline;
  #busy = false;
  #closed = false;
  #requiresReload = false;
  #fitNavigation;

  constructor({ root, controller, token, browser = window, onClose, fitNavigation }) {
    if (!root || root.children.length || !controller || typeof controller.snapshot !== 'function'
      || typeof controller.saveDraft !== 'function' || !browser || typeof browser.confirm !== 'function'
      || typeof onClose !== 'function') {
      throw new Error('Dienste und leerer Container für Navigation erforderlich');
    }
    const state = controller.snapshot();
    if (state.token !== token) throw new Error('Zustand ist veraltet; bitte erneut laden');
    const config = state.draft || state.live;
    this.#root = root;
    this.#controller = controller;
    this.#browser = browser;
    this.#token = token;
    this.#onClose = onClose;
    this.#fitNavigation = fitNavigation;
    this.#status = element('p');
    this.#status.setAttribute('role', 'status');
    this.#form = element('form');
    this.#form.addEventListener('submit', (event) => {
      event.preventDefault();
      return this.#saveAll();
    });

    const orientationLabel = element('label', 'Ausrichtung ');
    this.#orientation = element('select');
    for (const [value, text] of [['horizontal', 'Horizontal'], ['vertical', 'Vertikal']]) {
      const option = element('option', text);
      option.value = value;
      this.#orientation.append(option);
    }
    this.#orientation.value = config.navigation.orientation;
    orientationLabel.append(this.#orientation);
    this.#form.append(orientationLabel);

    const shared = element('fieldset');
    shared.className = 'cms-navedit-shared';
    shared.append(element('legend', 'Größe für alle Navigationspunkte'));
    const sharedToggleLabel = element('label', ' Für alle verwenden');
    this.#sharedEnabled = element('input');
    this.#sharedEnabled.type = 'checkbox';
    this.#sharedEnabled.checked = config.navigation.itemWidth !== undefined
      || config.navigation.itemHeight !== undefined;
    sharedToggleLabel.prepend ? sharedToggleLabel.prepend(this.#sharedEnabled)
      : sharedToggleLabel.append(this.#sharedEnabled);
    shared.append(sharedToggleLabel);
    for (const [key, title, min, max] of [
      ['itemWidth', 'Breite in Pixeln', 40, 600], ['itemHeight', 'Höhe in Pixeln', 24, 200],
    ]) {
      const label = element('label', `${title} `);
      const input = element('input');
      input.type = 'number';
      input.min = String(min);
      input.max = String(max);
      input.step = '1';
      input.value = config.navigation[key] === undefined ? '' : String(config.navigation[key]);
      this.#shared[key] = input;
      label.append(input);
      shared.append(label);
    }
    this.#form.append(shared);

    // Je Seite eine kompakte Zeile; Werte lokal, gespeichert erst mit „Speichern“.
    const items = new Map((config.navigation.items || []).map((item) => [item.page, item]));
    this.#rows = config.pages.map((page) => {
      const item = items.get(page.id) || {};
      return {
        page: structuredClone(page),
        file: page.id,
        title: page.title,
        label: item.label === undefined ? '' : String(item.label),
        width: item.width === undefined ? '' : String(item.width),
        height: item.height === undefined ? '' : String(item.height),
        show: item.hidden !== true,
      };
    });
    this.#rowsBox = element('div');
    this.#rowsBox.className = 'cms-navedit-rows';
    this.#form.append(this.#rowsBox);

    const add = element('div');
    add.className = 'cms-navedit-add';
    const addTitleLabel = element('label', 'Seitentitel ');
    const addTitle = element('input');
    addTitle.maxLength = 128;
    addTitleLabel.append(addTitle);
    const addFileLabel = element('label', 'Dateiname (optional) ');
    const addFile = element('input');
    addFile.maxLength = 64;
    addFile.placeholder = 'automatisch';
    addFileLabel.append(addFile);
    const addButton = element('button', 'Neue Seite erstellen');
    addButton.type = 'button';
    addButton.className = 'cms-button';
    addButton.addEventListener('click', () => {
      const title = addTitle.value;
      if (!title.length || title.length > 128 || CONTROL_CHARS.test(title)) {
        this.#message('Ungültiger Seitentitel (1–128 Zeichen).', true);
        return;
      }
      const used = new Set(this.#rows.map((row) => row.file));
      let number = 1;
      while (used.has(`page${number}`)) number += 1;
      const file = addFile.value || `page${number}`;
      if (!FILE_NAME.test(file)) {
        this.#message(FILE_NAME_HINT, true);
        return;
      }
      if (used.has(file)) {
        this.#message(`Dateiname „${file}“ ist bereits vergeben.`, true);
        return;
      }
      this.#rows.push({ page: { id: file, title, widgets: [] }, file, title, label: '', width: '', height: '', show: true });
      addTitle.value = '';
      addFile.value = '';
      this.#renderRows();
      this.#message('Noch nicht gespeicherte Änderungen.');
    });
    add.append(addTitleLabel, addFileLabel, addButton);
    this.#form.append(add);

    this.#save = element('button', 'Speichern');
    this.#save.type = 'submit';
    this.#save.className = 'cms-button cms-panel-save';
    this.#save.addEventListener('click', (event) => {
      event.preventDefault();
      return this.#saveAll();
    });
    this.#close = element('button', 'Abbrechen');
    this.#close.className = 'cms-button cms-panel-close';
    this.#close.type = 'button';
    this.#close.addEventListener('click', () => {
      if (this.#busy || this.#closed) return;
      if (!this.#requiresReload && this.#values() !== this.#baseline
        && !this.#browser.confirm('Nicht gespeicherte Änderungen verwerfen?')) return;
      const result = { requiresReload: this.#requiresReload };
      this.close();
      this.#onClose(result);
    });
    const footer = element('div');
    footer.className = 'cms-panel-footer';
    footer.append(this.#close, this.#save);

    this.#renderRows();
    this.#baseline = this.#values();
    root.append(element('h2', 'Navigation bearbeiten'),
      element('p', 'Reihenfolge am ≡-Griff ziehen (oder Pfeiltasten). Leere Beschriftungen und Größen nutzen Titel und Standard. Gespeichert wird erst mit „Speichern“.'),
      this.#status, this.#form, footer);
  }

  #message(text, error = false) {
    this.#status.textContent = text;
    if (error) this.#status.setAttribute('data-error', '');
    else this.#status.removeAttribute('data-error');
  }

  #values() {
    return JSON.stringify([this.#orientation.value, this.#sharedEnabled.checked,
      this.#shared.itemWidth.value, this.#shared.itemHeight.value,
      this.#rows.map((row) => [row.file, row.title, row.label, row.width, row.height, row.show])]);
  }

  #moveRow(from, to) {
    if (to < 0 || to >= this.#rows.length || from === to) return;
    const [row] = this.#rows.splice(from, 1);
    this.#rows.splice(to, 0, row);
    this.#renderRows();
    this.#message('Noch nicht gespeicherte Änderungen.');
  }

  #renderRows() {
    this.#rowsBox.replaceChildren();
    const head = element('div');
    head.className = 'cms-navedit-row cms-navedit-head';
    const gripSpace = element('span');
    gripSpace.className = 'cms-navedit-gripspace';
    head.append(gripSpace);
    for (const [key, name] of [['file', 'Dateiname'], ['title', 'Seitentitel'], ['label', 'Beschriftung'],
      ['width', 'Breite'], ['height', 'Höhe'], ['show', 'Anzeigen']]) {
      const span = element('span', name);
      span.className = `cms-navedit-${key}`;
      head.append(span);
    }
    const removeSpace = element('span');
    removeSpace.className = 'cms-navedit-removespace';
    const duplicateSpace = element('span');
    duplicateSpace.className = 'cms-navedit-duplicatespace';
    head.append(removeSpace, duplicateSpace);
    this.#rowsBox.append(head);
    this.#rows.forEach((row, index) => {
      const box = element('div');
      box.className = 'cms-navedit-row';
      const grip = element('button', '≡');
      grip.type = 'button';
      grip.className = 'cms-navedit-grip';
      grip.title = `„${row.title}“ verschieben (Pfeiltasten oder ziehen)`;
      grip.setAttribute('aria-label', grip.title);
      grip.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          this.#moveRow(index, index - 1);
          this.#rowsBox.children[Math.max(1, index)]?.querySelector?.('.cms-navedit-grip')?.focus?.();
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          this.#moveRow(index, index + 1);
          this.#rowsBox.children[Math.min(this.#rows.length, index + 2)]?.querySelector?.('.cms-navedit-grip')?.focus?.();
        }
      });
      grip.addEventListener('pointerdown', (event) => this.#drag(event, box));
      const fields = [
        ['file', 'Dateiname', 'text', 64],
        ['title', 'Seitentitel', 'text', 128],
        ['label', 'Beschriftung', 'text', 64],
        ['width', 'Breite', 'number', null],
        ['height', 'Höhe', 'number', null],
      ].map(([key, name, type, max]) => {
        const label = element('label');
        label.className = `cms-navedit-${key}`;
        const input = element('input');
        input.setAttribute('aria-label', `${name} für „${row.title || row.file}“`);
        if (type === 'number') {
          input.type = 'number';
          input.min = key === 'width' ? '40' : '24';
          input.max = key === 'width' ? '600' : '200';
          input.step = '1';
        } else {
          input.maxLength = max;
        }
        input.value = row[key];
        input.addEventListener('input', () => {
          row[key] = input.value;
          if (key === 'file') {
            // Doppelte oder ungültige Dateinamen sofort melden, nicht erst beim Speichern.
            const duplicate = this.#rows.some((other) => other !== row && other.file === input.value);
            const invalid = !FILE_NAME.test(input.value);
            if (duplicate || invalid) {
              input.setAttribute('aria-invalid', 'true');
              this.#message(duplicate ? `Dateiname „${input.value}“ ist bereits vergeben.` : FILE_NAME_HINT, true);
              return;
            }
            input.removeAttribute('aria-invalid');
          }
          this.#message(this.#values() !== this.#baseline ? 'Noch nicht gespeicherte Änderungen.' : '');
        });
        label.append(input);
        return label;
      });
      const showLabel = element('label');
      showLabel.className = 'cms-navedit-show';
      const show = element('input');
      show.type = 'checkbox';
      show.checked = row.show;
      show.setAttribute('aria-label', `„${row.title || row.file}“ in der Navigation anzeigen`);
      show.addEventListener('change', () => {
        row.show = show.checked;
        this.#message(this.#values() !== this.#baseline ? 'Noch nicht gespeicherte Änderungen.' : '');
      });
      showLabel.append(show);
      const remove = element('button', '✕');
      remove.type = 'button';
      remove.className = 'cms-navedit-remove';
      remove.title = 'Leere Seite löschen';
      remove.setAttribute('aria-label', `Leere Seite „${row.title}“ löschen`);
      remove.disabled = this.#rows.length === 1 || row.page.widgets.length > 0;
      remove.addEventListener('click', () => {
        this.#rows.splice(index, 1);
        this.#renderRows();
        this.#message('Noch nicht gespeicherte Änderungen.');
      });
      const duplicate = element('button', '⧉');
      duplicate.type = 'button';
      duplicate.className = 'cms-navedit-duplicate';
      duplicate.title = 'Seite duplizieren';
      duplicate.setAttribute('aria-label', `Seite „${row.title}“ duplizieren`);
      duplicate.disabled = this.#rows.length >= 50;
      duplicate.addEventListener('click', () => {
        const state = this.#controller.snapshot();
        const used = new Set([
          ...this.#rows.flatMap((entry) => [entry.file, entry.page.id]),
          ...(state.draft || state.live).pages.map((page) => page.id),
        ]);
        let number = 1;
        while (used.has(`page${number}`)) number += 1;
        const file = `page${number}`;
        const title = `${row.title.slice(0, 120)} (Kopie)`;
        const page = structuredClone(row.page);
        page.id = file;
        page.title = title;
        this.#rows.splice(index + 1, 0, {
          page, file, title, label: '', width: row.width, height: row.height, show: row.show,
        });
        this.#renderRows();
        this.#message('Noch nicht gespeicherte Änderungen.');
      });
      box.append(grip, ...fields, showLabel, remove, duplicate);
      this.#rowsBox.append(box);
    });
  }

  // Zeilen per Zeiger ziehen: beim Überqueren der Mitte einsortieren; Geschwister gleiten (FLIP).
  #drag(event, box) {
    if (typeof box.getBoundingClientRect !== 'function' || event.pointerId === undefined) return;
    event.preventDefault();
    box.classList.add('is-dragging');
    const dataRows = () => Array.from(this.#rowsBox.children).filter((child) => child !== this.#rowsBox.children[0]);
    const onMove = (move) => {
      const rows = dataRows();
      const from = rows.indexOf(box);
      if (from < 0) return;
      for (const [index, other] of rows.entries()) {
        if (other === box) continue;
        const rect = other.getBoundingClientRect();
        const middle = rect.top + rect.height / 2;
        if ((index < from && move.clientY < middle) || (index > from && move.clientY > middle)) {
          const before = new Map(rows.map((row) => [row, row.getBoundingClientRect().top]));
          const [row] = this.#rows.splice(from, 1);
          this.#rows.splice(index, 0, row);
          if (index < from) this.#rowsBox.insertBefore(box, other);
          else other.after(box);
          for (const sibling of rows) {
            if (sibling === box) continue;
            const delta = before.get(sibling) - sibling.getBoundingClientRect().top;
            if (!delta) continue;
            sibling.style.transition = 'none';
            sibling.style.transform = `translateY(${delta}px)`;
            requestAnimationFrame(() => {
              sibling.style.transition = 'transform .15s ease';
              sibling.style.transform = '';
            });
          }
          this.#message('Noch nicht gespeicherte Änderungen.');
          break;
        }
      }
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      box.classList.remove('is-dragging');
      this.#renderRows();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  #candidate() {
    const state = this.#controller.snapshot();
    const config = structuredClone(state.draft || state.live);
    if (!['horizontal', 'vertical'].includes(this.#orientation.value)) throw new Error('Ungültige Ausrichtung');
    const seen = new Set();
    for (const row of this.#rows) {
      if (!FILE_NAME.test(row.file)) throw new Error(`${FILE_NAME_HINT} („${row.file}“)`);
      if (seen.has(row.file)) throw new Error(`Dateiname „${row.file}“ ist bereits vergeben.`);
      seen.add(row.file);
      if (!row.title.length || row.title.length > 128 || CONTROL_CHARS.test(row.title)) {
        throw new Error(`Ungültiger Seitentitel für „${row.file}“ (1–128 Zeichen)`);
      }
      if (row.label.length > 64 || CONTROL_CHARS.test(row.label)) {
        throw new Error(`Ungültige Beschriftung für „${row.file}“`);
      }
      for (const [key, name, min, max] of [['width', 'Breite', 40, 600], ['height', 'Höhe', 24, 200]]) {
        const value = row[key];
        if (value === '') continue;
        if (!/^[0-9]+$/.test(value) || Number(value) < min || Number(value) > max) {
          throw new Error(`Ungültige ${name} für „${row.file}“ (${min}–${max} Pixel)`);
        }
      }
    }
    const byId = new Map(config.pages.map((page) => [page.id, page]));
    const renamed = new Map(this.#rows.map(row => [row.page.id, row.file]));
    config.pages = this.#rows.map((row) => {
      const page = byId.get(row.page.id) || structuredClone(row.page);
      page.id = row.file;
      page.title = row.title;
      return page;
    });
    for (const page of config.pages) for (const widget of page.widgets) {
      if (widget.type !== 'fhem-link') continue;
      for (const link of widget.links) {
        if (link.kind === 'internal' && renamed.has(link.page)) link.page = renamed.get(link.page);
      }
    }
    const navigation = config.navigation;
    navigation.orientation = this.#orientation.value;
    delete navigation.itemWidth;
    delete navigation.itemHeight;
    if (this.#sharedEnabled.checked) {
      for (const [key, name, min, max] of [
        ['itemWidth', 'gemeinsame Breite', 40, 600], ['itemHeight', 'gemeinsame Höhe', 24, 200],
      ]) {
        const value = this.#shared[key].value;
        if (!value) continue;
        if (!/^[0-9]+$/.test(value) || Number(value) < min || Number(value) > max) {
          throw new Error(`Ungültige ${name} (${min}–${max} Pixel)`);
        }
        navigation[key] = Number(value);
      }
      if (navigation.itemWidth === undefined && navigation.itemHeight === undefined) {
        throw new Error('Für „alle Navigationspunkte“ Breite oder Höhe angeben oder die Option deaktivieren');
      }
    }
    const items = [];
    for (const row of this.#rows) {
      const item = { page: row.file };
      if (row.label) item.label = row.label;
      if (row.width !== '') item.width = Number(row.width);
      if (row.height !== '') item.height = Number(row.height);
      if (!row.show) item.hidden = true;
      if (Object.keys(item).length > 1) items.push(item);
    }
    if (items.length) navigation.items = items;
    else delete navigation.items;
    if (navigation.orientation !== (state.draft || state.live).navigation.orientation && this.#fitNavigation) {
      return this.#fitNavigation(config);
    }
    return config;
  }

  async #saveAll() {
    if (this.#busy || this.#closed || this.#requiresReload) return;
    let pending;
    try {
      pending = this.#controller.saveDraft(this.#candidate(), this.#token);
    } catch (error) {
      this.#message(error.message || String(error), true);
      this.#status.scrollIntoView?.({ block: 'nearest' });
      return;
    }
    this.#busy = true;
    this.#form.inert = true;
    this.#save.disabled = true;
    this.#close.disabled = true;
    this.#message('Entwurf wird gespeichert …');
    try {
      await pending;
      if (this.#closed) return;
      this.#busy = false;
      this.close();
      this.#onClose({ requiresReload: false });
    } catch (error) {
      if (this.#closed) return;
      this.#requiresReload = true;
      this.#message(`Änderung nicht bestätigt: ${error.message || String(error)}. Bitte Zustand erneut laden.`, true);
    } finally {
      this.#busy = false;
      if (!this.#closed) {
        this.#form.inert = this.#requiresReload;
        this.#save.disabled = this.#requiresReload;
        this.#close.disabled = false;
      }
    }
  }

  suspend() {
    this.close();
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#root.replaceChildren();
  }
}
