import { showCmsModal } from '../js/modal-dialog.js';
import { MAX_FREE_DEVICES, checkSource, elementText, extractDevices, lookupValue, placeholderText, renderTemplate, sanitize } from '../js/freehtml.js';
import { diagnoseFreeHtml } from '../js/freehtml-diagnostics.js';
import { openPlaceholderPicker } from '../js/placeholder-picker.js';
import { titleVisibilityField, titleVisibilityStyles } from '../js/dialog-groups.js';
import { renderVehicleMaps } from '../js/vehicle-map.js';
import { widgetDesignCss } from '../js/widget-design.js';
import { updateWidgetDom } from '../js/widget-dom.js';
import { FRONTEND_VERSION } from '../js/frontend-version.js';
import { decodeCondition, encodeCondition } from '../js/condition-markup.js';
import { openConditionWizard } from '../js/condition-wizard.js';

const HELP_URL = 'https://github.com/stapetz/fhem-cms/blob/dev/docs/PLATZHALTER.md';
const EXAMPLE = `<div class="box">
  <b>Wohnzimmer</b><br>
  {{Wohnzimmer:temperature|round(1)|suffix( °C)}}
</div>`;
const VOID_TAGS = new Set(['br', 'hr', 'img']);
const BLOCK_TAGS = new Set(['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article',
  'header', 'footer', 'main', 'aside', 'nav', 'figure', 'figcaption', 'details', 'summary',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'pre', 'blockquote']);

function conditionSelection(source, start, end) {
  let inside = false, quote = '', comment = false;
  for (let i = 0; i < start; i++) {
    if (comment) {
      if (source.startsWith('-->', i)) { comment = false; i += 2; }
    } else if (inside) {
      if (quote && source[i] === quote) quote = '';
      else if (!quote && (source[i] === '"' || source[i] === "'")) quote = source[i];
      else if (!quote && source[i] === '>') inside = false;
    } else if (source.startsWith('<!--', i)) { comment = true; i += 3; }
    else if (source[i] === '<') inside = true;
  }
  if (inside || comment) throw new Error('Die Auswahl darf nicht innerhalb eines HTML-Tags beginnen.');
  const text = source.slice(start, end);
  const stack = [];
  let block = false;
  const tokens = /<!--(?:(?!-->).)*-->|<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z][A-Za-z0-9-]*\s*=\s*"[^"]*")*)\s*(\/?)>/gs;
  let cursor = 0;
  for (const match of text.matchAll(tokens)) {
    if (text.slice(cursor, match.index).includes('<')) throw new Error('Die Auswahl enthält ein unvollständiges HTML-Element.');
    cursor = match.index + match[0].length;
    if (!match[2]) continue;
    const tag = match[2].toLowerCase();
    if (BLOCK_TAGS.has(tag)) block = true;
    if (match[1]) {
      if (stack.pop() !== tag) throw new Error('Die Auswahl muss vollständige HTML-Elemente enthalten.');
    } else if (!match[4] && !VOID_TAGS.has(tag)) stack.push(tag);
  }
  if (stack.length || text.slice(cursor).includes('<')) {
    throw new Error('Die Auswahl muss vollständige HTML-Elemente enthalten.');
  }
  return block ? 'div' : 'span';
}

function conditionAtSource(source, position) {
  const tokens = /<!--(?:(?!-->).)*-->|<(\/?)(span|div)((?:\s+[A-Za-z][A-Za-z0-9-]*\s*=\s*"[^"]*")*)\s*>/gis;
  const stack = [], markers = [];
  for (const token of source.matchAll(tokens)) {
    if (!token[2]) continue;
    if (!token[1]) {
      const attr = /\s(data-cms-if|data-cms-unless)\s*=\s*"([0-9a-f]+)"/i.exec(token[3]);
      stack.push({tag:token[2].toLowerCase(), start:token.index, openEnd:token.index + token[0].length,
        attribute:attr?.[1].toLowerCase(), encoded:attr?.[2]});
    } else {
      const item = stack.pop();
      if (!item || item.tag !== token[2].toLowerCase()) return null;
      if (item.attribute) markers.push({...item, closeStart:token.index, end:token.index + token[0].length});
    }
  }
  const selected = markers.filter(item => item.start <= position && position <= item.end)
    .sort((a, b) => b.start - a.start)[0];
  if (!selected) return null;
  const marker = selected.attribute === 'data-cms-if' ? selected : markers.find(item =>
    item.attribute === 'data-cms-if' && item.end === selected.start && item.encoded === selected.encoded);
  if (!marker) return null;
  const alternate = markers.find(item => item.attribute === 'data-cms-unless'
    && item.start === marker.end && item.encoded === marker.encoded);
  return {marker, alternate};
}

function replaceConditionSource(source, existing, result) {
  const {marker, alternate} = existing;
  const encoded = result && encodeCondition(result.condition);
  const branch = (part, attribute) => {
    const body = source.slice(part.openEnd, part.closeStart);
    if (!encoded) return body;
    const opening = source.slice(part.start, part.openEnd)
      .replace(/\bdata-cms-(?:if|unless)\s*=\s*"[0-9a-f]+"/i, `${attribute}="${encoded}"`);
    return opening + body + source.slice(part.closeStart, part.end);
  };
  let replacement = branch(marker, 'data-cms-if');
  if (alternate) replacement += result?.otherwise ? branch(alternate, 'data-cms-unless')
    : source.slice(alternate.openEnd, alternate.closeStart);
  else if (result?.otherwise) replacement += `<${marker.tag} data-cms-unless="${encoded}">Text für Sonst</${marker.tag}>`;
  return {start:marker.start, end:alternate?.end ?? marker.end, replacement};
}

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
    this.fragmentTarget = null;
    this.vehicleMaps = new Map();
    this.mapRuntime = null;
    this.mapLoading = false;
    this.mapError = '';
    this.actionStatusTimer = null;
  }

  async sendSetCommand(action) {
    if (action.getAttribute('aria-busy') === 'true') return;
    const status = this.shadowRoot.querySelector('[data-cms-action-status]');
    window.clearTimeout(this.actionStatusTimer);
    status.hidden = true;
    status.removeAttribute('data-error');
    status.textContent = '';
    if (!this.hasAttribute('view-only')) {
      status.textContent = 'Geräteaktionen sind nur in der Ansicht verfügbar.';
      status.hidden = false;
      return;
    }

    action.classList.add('fhem-cms-sending');
    action.setAttribute('aria-busy', 'true');
    try {
      if (typeof this.services?.setCommand !== 'function') {
        throw new Error('FHEM-Kommunikation ist nicht verfügbar.');
      }
      await this.services.setCommand(action.getAttribute('set-device'), action.getAttribute('set-cmd'));
      status.textContent = 'Befehl gesendet.';
      this.actionStatusTimer = window.setTimeout(() => {
        status.hidden = true;
        status.textContent = '';
      }, 2000);
    } catch (error) {
      status.textContent = `Befehl fehlgeschlagen: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`;
      status.setAttribute('data-error', '');
    } finally {
      status.hidden = false;
      action.removeAttribute('aria-busy');
      window.setTimeout(() => action.classList.remove('fhem-cms-sending'), 450);
    }
  }

  connectedCallback() {
    if (this.shadowRoot.childElementCount > 0) {
      this.render();
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
        .content [set-device][set-cmd] { cursor: pointer; }
        .content [set-device][set-cmd].fhem-cms-sending { opacity: 0.65; }
        [data-cms-action-status] { position: absolute; inset-inline: 0.5rem; bottom: 0.5rem; z-index: 101;
          margin: 0; padding: 0.35rem 0.55rem; border-radius: 0.4rem; background: var(--cms-surface-raised, #2a3b32);
          color: var(--cms-text, #edf4ef); font-size: 0.8rem; }
        [data-cms-action-status][data-error] { color: var(--cms-danger, #ffb4a8); }
        [data-cms-action-status][hidden] { display: none !important; }
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
        .diagnostic { border-left: 3px solid var(--cms-danger, #ffb4a8); padding-left: 0.65rem; }
        .diagnostic p { margin: 0 0 0.35rem; }
        .diagnostic pre { max-width: 100%; max-height: 7em; margin: 0 0 0.4rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
        .diagnostic mark { color: inherit; background: color-mix(in srgb, var(--cms-danger, #ffb4a8) 35%, transparent); }
        ${widgetDesignCss}
        .tile .content { height: auto; min-height: 0; flex: 1; padding: 0;
          overflow: var(--cms-widget-overflow, auto); }
      </style>
      <article class="tile" data-tile>
        <header data-header hidden><h3 data-title></h3></header>
        <button type="button" class="gear" data-open-config title="Widget konfigurieren" aria-label="HTML-Kachel konfigurieren">⚙</button>
        <div class="content" data-content></div>
        <p data-cms-action-status role="status" aria-live="polite" hidden></p>
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
          <div class="diagnostic" data-diagnostic role="alert" hidden>
            <p data-diagnostic-message></p>
            <pre data-diagnostic-context></pre>
            <button type="button" data-diagnostic-jump>Zur Stelle im Code</button>
          </div>
          <div class="row"><button type="button" data-insert-placeholder>Platzhalter suchen und einfügen …</button>
            <button type="button" data-insert-condition>Bedingten Bereich einfügen / bearbeiten …</button>
            <button type="button" data-remove-condition>Bedingung entfernen</button></div>
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
            <p>Erlaubt sind sichere HTML-Struktur, Tabellen, Kommentare, Flex-/Grid-CSS, sichere Links und Bilder sowie SVG (Formen, Pfade, lokale Verläufe, Masken und <code>use</code> mit lokalem Ziel). <code>id</code>, <code>class</code>, <code>style</code>, <code>title</code>, ARIA-/data-Attribute und Reading-Attribute sind möglich. Attribute bitte in doppelten Anführungszeichen schreiben.</p>
            <p>Geräte im Ansichtsmodus kannst du über deklarative Attribute bedienen, ohne JavaScript zu verwenden: <code>&lt;button type="button" set-device="LR_SAT" set-cmd="remoteControl OK"&gt;OK&lt;/button&gt;</code>. <code>set-device</code> und <code>set-cmd</code> gehören zusammen und sind nur auf <code>button</code>, <code>div</code>, <code>span</code> und <code>a</code> erlaubt. Die FHEM-Berechtigungen und der CSRF-Schutz bleiben wirksam.</p>
            <p>CSS verwendet eine Positivliste für Eigenschaften, Funktionen und At-Regeln: moderne Layouts, Animationen, Filter, Variablen, <code>:has()</code> und Attributselektoren sind möglich. Alle Positionierungsarten inklusive <code>fixed</code> bleiben offen, auf die Kachel begrenzt. <code>z-index</code> darf höchstens 100 sein. Unbekannte Regeln und <code>:host</code> werden abgelehnt.</p>
            <p>Bildquellen, Links, Iframes und CSS-Ressourcen (<code>url()</code>, <code>@import</code>) dürfen lokale Pfade oder HTTP-/HTTPS-URLs verwenden. Einzelne URL-Readings werden bei jeder Anzeige geprüft. Iframes haben keine Anbieterbeschränkung, aber eine feste Sandbox ohne Originfreigabe, Popups oder Topnavigation; Anbieter-/Browserregeln können Einbettungen dennoch blockieren. Externe Ressourcen kontaktieren ihre Anbieter; eigene und importierte Styles können die Widget-Hülle beeinflussen und importierte Styles werden nicht rekursiv geprüft. Skripte im eigenen HTML, native Eventhandler, Formulare, <code>srcdoc</code> und aktive SVG-Inhalte bleiben gesperrt.</p>
            <p><code>data-value="{{Device:power|int}}"</code> und <code>data-state="{{Device:state}}"</code> setzen sicheren Attributtext für CSS. <code>data-cms-*</code> ist intern reserviert; <code>data-cms-class</code> und die vom Bedingungsdialog erzeugten Markierungen werden geprüft. Links auf <code>#id</code> und <code>:target</code> funktionieren innerhalb des Widgets ohne CMS-Seitenwechsel.</p>
            <p>Lokale Fahrzeugkarte: <code>&lt;div id="fahrzeugkarte" data-map="vehicle" data-latitude="{{MeinElch:location_latitude}}" data-longitude="{{MeinElch:location_longitude}}" data-zoom="16" style="height:175px;width:100%"&gt;&lt;/div&gt;</code>. Weißer Automarker, Live-Zentrierung bei Standortwechsel, Zoom 2–19. Normale Updates erhalten Zoom und Kartenausschnitt. OpenStreetMap-Kacheln werden extern geladen.</p>
            <p>Numerische Inline-Styles wie <code>width:{{MeinElch:state_batteryChargeLevel|int}}%</code>, CSS-Variablen, SVG-Geometrie und Kartenkoordinaten unterstützen geprüfte Zahlen mit <code>int</code>, <code>round(0)</code> bis <code>round(6)</code> und numerischem <code>default(50)</code> für fehlende Werte. <code>scroll-behavior:smooth</code> ist erlaubt; <code>map(on:An,off:Aus)</code> funktioniert ebenso wie die Schreibweise mit <code>=</code>.</p>
            <p><a href="${HELP_URL}" target="_blank" rel="noopener noreferrer">Ausführliche Beschreibung (PLATZHALTER.md)</a></p>
          </details>
          <p class="hint" data-devices></p>
          <p class="hint" data-frontend-version>Geladene Codeprüfung: ${FRONTEND_VERSION}</p>
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
    $('[data-form]').elements.html.addEventListener('input', () => {
      this.showDevices();
      this.updateDiagnostics();
      this.setDialogError('');
    });
    $('[data-diagnostic-jump]').addEventListener('click', () => {
      const diagnostic = this.diagnostic;
      if (!diagnostic || diagnostic.start === null) return;
      const area = $('[data-form]').elements.html;
      area.focus();
      area.setSelectionRange(diagnostic.start, diagnostic.end);
    });
    $('[data-insert-placeholder]').addEventListener('click', () => this.insertPlaceholder());
    $('[data-insert-condition]').addEventListener('click', () => this.insertCondition());
    $('[data-remove-condition]').addEventListener('click', () => this.removeCondition());
    $('[data-content]').addEventListener('click', (event) => {
      const action = event.target.closest?.('[set-device][set-cmd]');
      if (action) {
        event.preventDefault();
        void this.sendSetCommand(action);
        return;
      }
      const link = event.target.closest('a[href^="#"]');
      if (!link) return;
      const id = link.getAttribute('href').slice(1);
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)) return;
      const target = [...$('[data-content]').querySelectorAll('[id]')].find(element => element.id === id);
      event.preventDefault();
      $('[data-content]').querySelector('[data-cms-fragment-warning]')?.remove();
      if (!target) {
        const warning = document.createElement('span');
        warning.setAttribute('data-cms-fragment-warning', '');
        warning.setAttribute('role', 'status');
        warning.textContent = 'Sprungziel im HTML-Widget nicht gefunden';
        $('[data-content]').append(warning);
        return;
      }
      $('[data-content]').querySelectorAll('[data-cms-fragment-target]').forEach(element => element.removeAttribute('data-cms-fragment-target'));
      target.setAttribute('data-cms-fragment-target', '');
      this.fragmentTarget = id;
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    });
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

  disconnectedCallback() {
    window.clearTimeout(this.actionStatusTimer);
    queueMicrotask(() => {
      if (this.isConnected) return;
      for (const controller of this.vehicleMaps.values()) controller.destroy();
      this.vehicleMaps.clear();
    });
  }

  render() {
    const content = this.shadowRoot.querySelector('[data-content]');
    if (!content || !this.widgetConfig) {
      return;
    }
    const html = this.widgetConfig.html || '';
    const preserveState = this.templateSource === html;
    if (this.templateSource !== html) {
      this.template = sanitize(html);
      this.templateSource = html;
    }
    const rendered = renderTemplate(this.template, (device, reading) => this.lookup(device, reading));
    const mapHosts = rendered.querySelectorAll('div[data-map="vehicle"]');
    if (mapHosts.length && !this.mapRuntime) {
      if (!this.mapLoading && !this.mapError) {
        this.mapLoading = true;
        import('../js/fcui-map-runtime.js').then(runtime => {
          this.mapRuntime = runtime;
          this.mapLoading = false;
          if (this.isConnected) this.render();
        }, error => {
          console.error('Fahrzeugkarte konnte nicht geladen werden', error);
          this.mapLoading = false;
          this.mapError = 'Fahrzeugkarte konnte nicht geladen werden. Bitte Seite neu laden.';
          if (this.isConnected) this.render();
        });
      }
      for (const host of mapHosts) {
        const status = document.createElement('span');
        status.setAttribute('role', 'status');
        status.textContent = this.mapError || 'Fahrzeugkarte wird geladen …';
        host.replaceChildren(status);
      }
      updateWidgetDom(content, rendered, preserveState);
    } else {
      this.vehicleMaps = renderVehicleMaps(content, rendered, this.vehicleMaps, this.mapRuntime, preserveState);
    }
    if (this.fragmentTarget) {
      [...content.querySelectorAll('[id]')].find(element => element.id === this.fragmentTarget)
        ?.setAttribute('data-cms-fragment-target', '');
    }
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

  async insertCondition() {
    if (this.conditionPending) return;
    const area = this.shadowRoot.querySelector('[data-form]').elements.html;
    const start = area.selectionStart ?? area.value.length;
    const end = area.selectionEnd ?? start;
    const original = area.value;
    const existing = start === end ? conditionAtSource(original, start) : null;
    this.conditionPending = true;
    try {
      const initial = existing ? {condition:decodeCondition(existing.marker.encoded), otherwise:Boolean(existing.alternate)} : null;
      const result = await openConditionWizard({services:this.services, initial, allowElse:true, signal:this.conditionAbort.signal});
      if (!result || this.conditionAbort.signal.aborted) return;
      if (area.value !== original) throw new Error('Der HTML-Code wurde zwischenzeitlich geändert.');
      if (existing) {
        const change = replaceConditionSource(original, existing, result);
        area.setRangeText(change.replacement, change.start, change.end, 'end');
        area.dispatchEvent(new Event('input', {bubbles:true}));
        area.focus();
        return;
      }
      const encoded = encodeCondition(result.condition);
      const selected = original.slice(start, end) || 'Text für Wenn';
      const tag = conditionSelection(original, start, end);
      const markup = `<${tag} data-cms-if="${encoded}">${selected}</${tag}>`
        + (result.otherwise ? `<${tag} data-cms-unless="${encoded}">Text für Sonst</${tag}>` : '');
      const next = original.slice(0, start) + markup + original.slice(end);
      const error = checkSource(next);
      if (error) throw new Error(error);
      area.setRangeText(markup, start, end, 'end');
      area.dispatchEvent(new Event('input', {bubbles:true}));
      area.focus();
    } catch (error) {
      this.setDialogError(`Bedingung konnte nicht eingefügt werden: ${error.message || String(error)}`);
    } finally { this.conditionPending = false; }
  }

  removeCondition() {
    const area = this.shadowRoot.querySelector('[data-form]').elements.html;
    const existing = conditionAtSource(area.value, area.selectionStart);
    if (!existing) { this.setDialogError('Bitte den Cursor in einen bedingten Bereich setzen.'); return; }
    const change = replaceConditionSource(area.value, existing, null);
    area.setRangeText(change.replacement, change.start, change.end, 'end');
    area.dispatchEvent(new Event('input', {bubbles:true}));
    area.focus();
  }

  showDevices() {
    const html = this.shadowRoot.querySelector('[data-form]').elements.html.value;
    try {
      const devices = extractDevices(html);
      this.shadowRoot.querySelector('[data-devices]').textContent = devices.length > 0
        ? `Verwendete Devices: ${devices.join(', ')}`
        : 'Noch keine Platzhalter im Code.';
    } catch (error) {
      this.shadowRoot.querySelector('[data-devices]').textContent = `Geräte können nicht ermittelt werden: ${error.message}`;
    }
  }

  openConfig(options = {}) {
    this.conditionAbort?.abort();
    this.conditionAbort = new AbortController();
    this.isNew = Boolean(options.isNew);
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements.title.value = this.widgetConfig.title || '';
    form.elements.showTitle.checked = this.widgetConfig.showTitle !== false;
    form.elements.html.value = this.widgetConfig.html || '';
    this.shadowRoot.querySelector('[data-delete]').hidden = this.isNew;
    this.showDevices();
    this.setDialogError('');
    this.updateDiagnostics();
    showCmsModal(this.shadowRoot.querySelector('[data-dialog]'));
  }

  setDialogError(message) {
    this.shadowRoot.querySelector('[data-dialog-error]').textContent = message;
  }

  updateDiagnostics() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const area = form.elements.html;
    const panel = this.shadowRoot.querySelector('[data-diagnostic]');
    const message = this.shadowRoot.querySelector('[data-diagnostic-message]');
    const context = this.shadowRoot.querySelector('[data-diagnostic-context]');
    const jump = this.shadowRoot.querySelector('[data-diagnostic-jump]');
    const diagnostic = diagnoseFreeHtml(area.value);
    this.diagnostic = diagnostic;
    panel.hidden = !diagnostic;
    context.replaceChildren();
    if (!diagnostic) return null;

    message.textContent = diagnostic.start === null
      ? `Keine verlässliche Quellposition verfügbar: ${diagnostic.message}`
      : `Zeile ${diagnostic.line}, Spalte ${diagnostic.column}: ${diagnostic.message}`;
    jump.hidden = diagnostic.start === null;
    if (diagnostic.start !== null) {
      const beforeEnd = Math.max(diagnostic.contextStart, Math.min(diagnostic.start, diagnostic.contextEnd));
      const markEnd = Math.max(beforeEnd, Math.min(diagnostic.end, diagnostic.contextEnd));
      const before = document.createTextNode(diagnostic.context.slice(0, beforeEnd - diagnostic.contextStart));
      const mark = document.createElement('mark');
      mark.textContent = diagnostic.context.slice(beforeEnd - diagnostic.contextStart, markEnd - diagnostic.contextStart);
      const after = document.createTextNode(diagnostic.context.slice(markEnd - diagnostic.contextStart));
      context.append(before, mark, after);
    } else {
      context.textContent = diagnostic.message;
    }
    return diagnostic;
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
    this.updateDiagnostics();
    try {
      const widget = this.collectWidget();
      save.disabled = true;
      await this.services.saveWidget(widget);
      this.isNew = false;
      this.closeDialog(false);
    } catch (error) {
      const diagnostic = this.diagnostic;
      this.setDialogError(diagnostic
        ? ''
        : `Keine genaue Quellposition verfügbar: ${error.message || 'Speichern fehlgeschlagen'}`);
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
    this.conditionAbort?.abort();
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
