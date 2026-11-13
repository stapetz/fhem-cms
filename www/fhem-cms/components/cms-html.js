import { MAX_FREE_DEVICES, checkSource, elementText, extractDevices, lookupValue, placeholderText, renderTemplate, sanitize } from '../js/freehtml.js';
import { openPlaceholderPicker } from '../js/placeholder-picker.js';
import { titleVisibilityField, titleVisibilityStyles } from '../js/dialog-groups.js';

const HELP_URL = 'https://github.com/stapetz/fhem-cms/blob/dev/docs/PLATZHALTER.md';
const EXAMPLE = `<div class="box">
  <b>Wohnzimmer</b><br>
  {{Wohnzimmer:temperature|round(1)|suffix( °C)}}
</div>`;

class FHEMCMSHtml extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.widgetConfig = null;
    this.services = null;
    this.groups = null;
    this.staleSince = null;
    this.isNew = false;
    this.template = null;
    this.templateSource = null;
  }

  connectedCallback() {
    if (this.shadowRoot.childElementCount > 0) {
      return;
    }
    this.shadowRoot.innerHTML = `
      <style>
        [data-title] { text-align: var(--cms-widget-title-align, left); width: 100%; min-width: 0; flex: 1; }
        :host { display: block; min-width: 0; min-height: 0; }
        * { box-sizing: border-box; }
        .tile { position: relative; height: 100%; overflow: hidden; container-type: size; border: 1px solid var(--cms-frame, #7f8c84); border-radius: 1.4rem;
          background: var(--cms-surface, #202e27); }
        header { position: absolute; top: 0; left: 0; right: 1.6rem; z-index: 1; padding: 0.4em 0 0 1.1em; font-size: max(5px, min(13cqh, 5cqw)); }
        header[hidden] { display: none; }
        h3 { margin: 0; font-size: 1.1em; font-weight: 400; color: var(--cms-muted, #a5c9b2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .content { height: 100%; overflow: auto; scrollbar-width: thin; padding: 0.6rem 0.9rem; font-size: 1rem; line-height: 1.3; }
        .tile[data-has-title] .content { padding-top: 1.9rem; }
        .content p, .content h1, .content h2, .content h3, .content h4 { margin: 0 0 0.4em; }
        /* Feste Größen statt Browser-Vorgabe: Safari und Chromium rendern verschachtelte h1 sonst unterschiedlich. */
        .content h1 { font-size: 1.4em; font-weight: 700; }
        .content h2 { font-size: 1.2em; font-weight: 700; }
        .content h3 { font-size: 1.05em; font-weight: 700; color: inherit; overflow: visible; text-overflow: clip; white-space: normal; }
        .content h4 { font-size: 1em; font-weight: 700; }
        .content table { border-collapse: collapse; }
        .content th, .content td { padding: 0.15em 0.5em; text-align: left; }
        .tile[data-stale] { opacity: 0.65; border-style: dashed; }
        button { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--cms-border, #43564a);
          border-radius: 0.5rem; background: var(--cms-surface-raised, #2a3b32); padding: 0.35rem 0.7rem; }
        button:hover { background: var(--cms-surface-hover, #34493e); }
        button:focus-visible, textarea:focus-visible, input:focus-visible, a:focus-visible { outline: 2px solid var(--cms-accent, #8fd0a8); outline-offset: 2px; }
        .gear { position: absolute; top: 0.2rem; right: 0.3rem; z-index: 2; padding: 0 0.35em; font-size: 0.75rem; line-height: 1.4; }
        :host([view-only]) [data-open-config] { display: none; }
        dialog { border: 1px solid var(--cms-border, #43564a); border-radius: 1rem; background: var(--cms-surface, #202e27); color: var(--cms-text, #edf4ef);
          padding: 1.25rem; width: min(94vw, 46rem); max-height: 94vh; overflow: auto; }
        dialog::backdrop { background: var(--cms-backdrop, rgb(0 0 0 / 0.6)); }
        form { display: grid; gap: 0.75rem; }
        ${titleVisibilityStyles}
        label { display: grid; gap: 0.25rem; font-size: 0.9rem; }
        input, textarea { font: inherit; color: inherit; background: var(--cms-bg, #17211d); border: 1px solid var(--cms-border, #43564a);
          border-radius: 0.5rem; padding: 0.4rem 0.5rem; width: 100%; }
        textarea { min-height: 14rem; resize: vertical; font-family: ui-monospace, monospace; font-size: 0.85rem; }
        details { border: 1px solid var(--cms-border, #43564a); border-radius: 0.75rem; padding: 0.5rem 0.75rem; font-size: 0.85rem; }
        summary { cursor: pointer; color: var(--cms-muted, #a5c9b2); }
        details code, details pre { background: var(--cms-bg, #17211d); border-radius: 0.3rem; padding: 0.05rem 0.3rem; font-size: 0.8rem; }
        details pre { padding: 0.5rem; overflow: auto; }
        details ul { margin: 0.4rem 0; padding-left: 1.2rem; }
        a { color: var(--cms-accent, #8fd0a8); }
        .row { display: flex; }
        .hint { margin: 0; color: var(--cms-muted, #a5c9b2); font-size: 0.8rem; }
        .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: flex-end; }
        .danger { margin-right: auto; border-color: var(--cms-danger-border, #7f3b33); }
        .error { margin: 0; color: var(--cms-danger, #ffb4a8); min-height: 1.2em; }
      </style>
      <article class="tile" data-tile>
        <header data-header hidden><h3 data-title></h3></header>
        <button type="button" class="gear" data-open-config title="Widget konfigurieren" aria-label="HTML-Kachel konfigurieren">⚙</button>
        <div class="content" data-content></div>
      </article>
      <dialog data-dialog aria-labelledby="html-dialog-title">
        <form method="dialog" data-form novalidate>
          <h3 id="html-dialog-title">Freies HTML konfigurieren</h3>
          <label>Titel (optional)
            <input name="title" maxlength="64" autocomplete="off">
          </label>
          ${titleVisibilityField}
          <label>HTML-Code
            <textarea name="html" spellcheck="false" autocomplete="off" placeholder="${EXAMPLE.replace(/"/g, '&quot;')}"></textarea>
          </label>
          <div class="row"><button type="button" data-insert-placeholder>Platzhalter suchen und einfügen …</button></div>
          <details>
            <summary>Platzhalter-Hilfe</summary>
            <p>Werte aus FHEM setzt du mit Platzhaltern ein; sie werden live aktualisiert:</p>
            <ul>
              <li><code>{{Device:reading}}</code> – Wert eines Readings, z. B. <code>{{Wohnzimmer:temperature}}</code></li>
              <li><code>{{Device:@alias}}</code>, <code>{{Device:@name}}</code>, <code>{{Device:@type}}</code> – Alias, Name und Typ des Devices</li>
              <li>Alternativ als Attribute (wie FTUI): <code>&lt;span device="Wohnzimmer" reading="temperature" filter="round(1)|suffix( °C)"&gt;&lt;/span&gt;</code> – der Inhalt des Elements wird durch den Wert ersetzt; <code>device</code> und <code>reading</code> gehören immer zusammen, <code>filter</code> ist optional.</li>
              <li>Filter mit <code>|</code>: <code>round(1)</code>, <code>int</code>, <code>upper</code>, <code>lower</code>, <code>default(Text)</code>, <code>prefix(Text)</code>, <code>suffix(Text)</code>, <code>map(on=An,off=Aus)</code></li>
              <li>Zustandsklassen: <code>data-cms-class="Device:reading=on:aktiv; Device:temperature&gt;25:heiss"</code> setzt die Klasse, wenn die Bedingung stimmt (<code>= != &gt; &lt; &gt;= &lt;=</code>). Die Klassen definierst du in einem <code>&lt;style&gt;</code>-Element.</li>
            </ul>
            <pre>${EXAMPLE.replace(/</g, '&lt;')}</pre>
            <p>Erlaubt sind passive HTML-Struktur, Tabellen, Kommentare, Flex-/Grid-CSS, sichere Links und Bilder sowie statisches SVG (Formen, Pfade, Text und lokale Verläufe). <code>id</code>, <code>class</code>, <code>style</code>, <code>title</code>, ARIA-/data-Attribute und Reading-Attribute sind möglich. Attribute bitte in doppelten Anführungszeichen schreiben.</p>
            <p>Bildquellen, Links und CSS-Ressourcen (<code>url()</code>, <code>@import</code>) dürfen lokale Pfade oder HTTPS-URLs verwenden. Einzelne Bild-/Link-Readings wie <code>&lt;img src="{{MeinElch:vehicle_images_exteriorImageUrl}}"&gt;</code> werden bei jeder Anzeige geprüft. CSS-Animationen mit <code>@keyframes</code> und alle Positionierungsarten sind erlaubt; feste Elemente bleiben innerhalb der Kachel.</p>
            <p>Standortkarten dürfen <code>&lt;iframe src="https://www.openstreetmap.org/export/embed.html?…"&gt;&lt;/iframe&gt;</code> verwenden, mit begrenzter Sandbox. Externe Bilder, Styles und Karten kontaktieren ihren Anbieter. Skripte im eigenen HTML, Ereignis-Attribute, Formulare, andere Iframes und aktive SVG-Inhalte bleiben gesperrt.</p>
            <p>Numerische Inline-Styles wie <code>width:{{MeinElch:state_batteryChargeLevel|int}}%;</code> und Kartenkoordinaten im Querystring unterstützen geprüfte Zahlen mit <code>int</code> oder <code>round(0)</code> bis <code>round(6)</code>. <code>scroll-behavior:smooth</code> ist erlaubt; <code>map(on:An,off:Aus)</code> funktioniert ebenso wie die Schreibweise mit <code>=</code>.</p>
            <p><a href="${HELP_URL}" target="_blank" rel="noopener noreferrer">Ausführliche Beschreibung (PLATZHALTER.md)</a></p>
          </details>
          <p class="hint" data-devices></p>
          <p class="error" role="alert" data-dialog-error></p>
          <div class="actions">
            <button type="button" class="danger" data-delete>Widget löschen</button>
            <button type="button" data-cancel>Abbrechen</button>
            <button type="submit" data-save>Speichern</button>
          </div>
        </form>
      </dialog>
    `;

    const $ = (selector) => this.shadowRoot.querySelector(selector);
    $('[data-tile]').style.setProperty('contain', 'layout paint', 'important');
    $('[data-open-config]').addEventListener('click', () => this.openConfig());
    $('[data-cancel]').addEventListener('click', () => this.closeDialog(true));
    $('[data-delete]').addEventListener('click', () => this.onDelete());
    $('[data-dialog]').addEventListener('cancel', () => this.closeDialog(true));
    $('[data-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      this.onSave();
    });
    $('[data-form]').elements.html.addEventListener('input', () => this.showDevices());
    $('[data-insert-placeholder]').addEventListener('click', () => this.insertPlaceholder());
    this.render();
  }

  set config(value) {
    this.widgetConfig = value;
    this.render();
  }

  get config() {
    return this.widgetConfig;
  }

  // Map Device -> [Hauptdevice, Kanäle …]
  set data(value) {
    this.groups = value instanceof Map ? value : null;
    this.render();
  }

  set stale(value) {
    this.staleSince = value;
    this.shadowRoot.querySelector('[data-tile]')?.toggleAttribute('data-stale', Boolean(value));
  }

  lookup(device, reading) {
    return lookupValue(this.groups, device, reading);
  }

  render() {
    const content = this.shadowRoot.querySelector('[data-content]');
    if (!content || !this.widgetConfig) {
      return;
    }
    const html = this.widgetConfig.html || '';
    if (this.templateSource !== html) {
      this.template = sanitize(html);
      this.templateSource = html;
    }
    content.replaceChildren(renderTemplate(this.template, (device, reading) => this.lookup(device, reading)));
    const title = this.widgetConfig.showTitle === false ? '' : (this.widgetConfig.title || '');
    this.shadowRoot.querySelector('[data-title]').textContent = title;
    this.shadowRoot.querySelector('[data-header]').hidden = !title;
    this.shadowRoot.querySelector('[data-tile]').toggleAttribute('data-has-title', Boolean(title));
  }

  // Fügt den gewählten Platzhalter an der Cursorposition des Codes ein (im Code bleibt er normaler Text).
  async insertPlaceholder() {
    const area = this.shadowRoot.querySelector('[data-form]').elements.html;
    const start = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? start;
    const result = await openPlaceholderPicker({ services: this.services, allowElement: true });
    if (!result) {
      area.focus();
      return;
    }
    const text = result.asElement
      ? elementText(result.device, result.reading, result.filter)
      : placeholderText(result.device, result.reading, result.filter);
    area.setRangeText(text, start, end, 'end');
    area.focus();
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }

  showDevices() {
    const html = this.shadowRoot.querySelector('[data-form]').elements.html.value;
    const devices = extractDevices(html);
    this.shadowRoot.querySelector('[data-devices]').textContent = devices.length > 0
      ? `Verwendete Devices: ${devices.join(', ')}`
      : 'Noch keine Platzhalter im Code.';
  }

  openConfig(options = {}) {
    this.isNew = Boolean(options.isNew);
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements.title.value = this.widgetConfig.title || '';
    form.elements.showTitle.checked = this.widgetConfig.showTitle !== false;
    form.elements.html.value = this.widgetConfig.html || '';
    this.shadowRoot.querySelector('[data-delete]').hidden = this.isNew;
    this.showDevices();
    this.setDialogError('');
    this.shadowRoot.querySelector('[data-dialog]').showModal();
  }

  setDialogError(message) {
    this.shadowRoot.querySelector('[data-dialog-error]').textContent = message;
  }

  collectWidget() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const html = form.elements.html.value;
    const problem = checkSource(html);
    if (problem) {
      throw new Error(problem);
    }
    const devices = extractDevices(html);
    if (devices.length > MAX_FREE_DEVICES) {
      throw new Error(`Höchstens ${MAX_FREE_DEVICES} verschiedene Devices pro Kachel (aktuell ${devices.length})`);
    }
    const title = form.elements.title.value.trim();
    if (/[\u0000-\u001f\u007f]/.test(title)) {
      throw new Error('Der Titel enthält ungültige Zeichen');
    }
    const widget = { id: this.widgetConfig.id, type: 'fhem-html', html, devices, grid: { ...this.widgetConfig.grid } };
    if (title) {
      widget.title = title;
    }
    if (!form.elements.showTitle.checked) {
      widget.showTitle = false;
    }
    return widget;
  }

  async onSave() {
    const save = this.shadowRoot.querySelector('[data-save]');
    try {
      const widget = this.collectWidget();
      save.disabled = true;
      await this.services.saveWidget(widget);
      this.isNew = false;
      this.closeDialog(false);
    } catch (error) {
      this.setDialogError(error.message || 'Speichern fehlgeschlagen');
    } finally {
      save.disabled = false;
    }
  }

  async onDelete() {
    if (!window.confirm('Diese HTML-Kachel wirklich löschen?')) {
      return;
    }
    try {
      await this.services.deleteWidget(this.widgetConfig.id);
      this.closeDialog(false);
    } catch (error) {
      this.setDialogError(error.message || 'Löschen fehlgeschlagen');
    }
  }

  closeDialog(cancelled) {
    const dialog = this.shadowRoot.querySelector('[data-dialog]');
    if (dialog.open) {
      dialog.close();
    }
    if (cancelled && this.isNew) {
      this.dispatchEvent(new CustomEvent('cms-widget-cancel', { bubbles: true, composed: true }));
    }
  }
}

if (!customElements.get('cms-html')) {
  customElements.define('cms-html', FHEMCMSHtml);
}
