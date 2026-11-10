const STYLES = ['digital', 'date', 'analog'];

class FHEMCMSClock extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.widgetConfig = null;
    this.isNew = false;
    this.timer = null;
  }

  connectedCallback() {
    if (this.shadowRoot.childElementCount) {
      return;
    }
    this.shadowRoot.innerHTML = `
      <style>
        [data-title] { text-align: var(--cms-widget-title-align, left); width: 100%; min-width: 0; flex: 1; }
        :host { display: block; min-width: 0; min-height: 0; }
        * { box-sizing: border-box; }
        .tile { position: relative; display: flex; height: 100%; align-items: center; justify-content: center;
          overflow: hidden; container-type: size; border: 1px solid var(--cms-frame, #7f8c84); border-radius: 1.4rem;
          background: var(--cms-surface, #202e27); padding: 0.8rem; text-align: center; }
        .content { display: grid; width: 100%; height: 100%; align-content: center; justify-items: center; gap: 0.3em; min-width: 0; }
        h3 { margin: 0; color: var(--cms-muted, #a5c9b2); font-size: 1.05rem; font-weight: 400; overflow-wrap: anywhere; }
        h3[data-title] { font-size: max(5px, min(11cqh, 5cqw)); }
        .time { font-size: max(4px, min(38cqh, 16cqw)); font-variant-numeric: tabular-nums; line-height: 1; }
        /* Ohne Datum/Wochentag füllt die Uhr das Widget aus. */
        .content[data-time-only] .time { font-size: max(4px, min(72cqh, 22cqw)); }
        .date { color: var(--cms-muted-strong, #c4d0c8); font-size: max(5px, min(11cqh, 5cqw)); }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
        .face { position: relative; width: min(78cqh, 62cqw); aspect-ratio: 1; border: 2px solid var(--cms-accent, #8fd0a8);
          border-radius: 50%; }
        .content[data-time-only] .face { width: min(92cqh, 80cqw); }
        .face[hidden], .date[hidden], h3[hidden] { display: none; }
        .mark-rotor { position: absolute; inset: 0; transform: rotate(var(--angle)); }
        .mark { position: absolute; top: 2%; left: 50%; transform: translateX(-50%); background: var(--cms-accent, #8fd0a8); }
        .mark.minute { top: 2.5%; width: 1.3%; aspect-ratio: 1; border-radius: 50%; }
        .mark.five-minute { top: 2%; width: 1%; height: 5%; }
        .mark.quarter-hour { top: 2%; width: 1.5%; height: 9%; }
        .hand { position: absolute; left: 50%; bottom: 50%; width: 1%; border-radius: 2px; background: var(--cms-text, #edf4ef);
          transform: translateX(-50%) rotate(var(--angle)); transform-origin: center bottom; }
        .hand.hour { height: 25%; width: 1.8%; }
        .hand.minute { height: 36%; }
        .hand.second { height: 40%; width: 0.6%; background: var(--cms-danger, #ffb4a8); }
        .center { position: absolute; top: 50%; left: 50%; width: 4%; aspect-ratio: 1; border-radius: 50%;
          background: var(--cms-accent, #8fd0a8); transform: translate(-50%, -50%); }
        .gear, button { font: inherit; color: inherit; cursor: pointer; border: 1px solid var(--cms-border, #43564a);
          border-radius: 0.5rem; background: var(--cms-surface-raised, #2a3b32); padding: 0.3rem 0.55rem; }
        .gear { position: absolute; top: 0.2rem; right: 0.3rem; padding: 0 0.35em; }
        button:focus-visible, input:focus-visible { outline: 2px solid var(--cms-accent, #8fd0a8); outline-offset: 2px; }
        :host([view-only]) [data-open-config] { display: none; }
        dialog { width: min(92vw, 30rem); max-height: 94vh; overflow: auto; padding: 1.25rem;
          border: 1px solid var(--cms-border, #43564a); border-radius: 1rem; background: var(--cms-surface, #202e27);
          color: var(--cms-text, #edf4ef); }
        dialog::backdrop { background: var(--cms-backdrop, rgb(0 0 0 / 0.6)); }
        form { display: grid; gap: 0.75rem; }
        label { display: grid; gap: 0.25rem; }
        input[type="text"] { font: inherit; color: inherit; background: var(--cms-bg, #17211d); border: 1px solid var(--cms-border, #43564a);
          border-radius: 0.5rem; padding: 0.4rem 0.5rem; }
        .presets { display: grid; grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr)); gap: 0.5rem; }
        .preset { display: grid; gap: 0.35rem; padding: 0.6rem; border: 1px solid var(--cms-border, #43564a); border-radius: 0.5rem; }
        .preview { display: grid; min-height: 3rem; place-items: center; border-radius: 0.35rem; background: var(--cms-bg, #17211d);
          font-variant-numeric: tabular-nums; }
        .checks { display: flex; flex-wrap: wrap; gap: 0.75rem; }
        .checks label { display: flex; align-items: center; gap: 0.3rem; }
        .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; }
        .danger { margin-right: auto; border-color: var(--cms-danger-border, #7f3b33); }
        .error { min-height: 1.2em; margin: 0; color: var(--cms-danger, #ffb4a8); }
      </style>
      <article class="tile">
        <button type="button" class="gear" data-open-config title="Widget konfigurieren" aria-label="Uhr konfigurieren">⚙</button>
        <div class="content">
          <h3 data-title hidden></h3>
          <div class="time" data-time></div>
          <div class="face" data-face hidden aria-hidden="true">
            ${Array.from({ length: 60 }, (_, minute) => {
    const type = minute % 15 === 0 ? 'quarter-hour' : minute % 5 === 0 ? 'five-minute' : 'minute';
    return `<span class="mark-rotor" style="--angle:${minute * 6}deg"><span class="mark ${type}"></span></span>`;
  }).join('')}
            <span class="hand hour" data-hour></span><span class="hand minute" data-minute></span>
            <span class="hand second" data-second></span><span class="center"></span>
          </div>
          <div class="date" data-date hidden></div>
          <span class="sr-only" data-clock-label></span>
        </div>
      </article>
      <dialog data-dialog aria-labelledby="clock-dialog-title">
        <form method="dialog" data-form novalidate>
          <h3 id="clock-dialog-title">Uhr / Datum konfigurieren</h3>
          <label>Titel (optional)<input name="title" type="text" maxlength="64" autocomplete="off"></label>
          <label style="display:flex;align-items:center;gap:0.35em"><input name="showTitle" type="checkbox" checked> Titel anzeigen</label>
          <fieldset>
            <legend>Darstellung wählen</legend>
            <div class="presets">
              <label class="preset"><span><input type="radio" name="style" value="digital" checked> Digital</span>
                <span class="preview">12:34</span></label>
              <label class="preset"><span><input type="radio" name="style" value="date"> Digital mit Datum</span>
                <span class="preview">12:34<br>Montag, 01.01.2026</span></label>
              <label class="preset"><span><input type="radio" name="style" value="analog"> Analog</span>
                <span class="preview">◷</span></label>
            </div>
          </fieldset>
          <fieldset class="checks">
            <legend>Zusatzangaben</legend>
            <label><input type="checkbox" name="showSeconds"> Sekunden</label>
            <label><input type="checkbox" name="showDate"> Datum</label>
            <label><input type="checkbox" name="showWeekday"> Wochentag</label>
          </fieldset>
          <p class="error" data-error role="alert"></p>
          <div class="actions">
            <button type="button" class="danger" data-delete>Widget löschen</button>
            <button type="button" data-cancel>Abbrechen</button>
            <button type="submit">Speichern</button>
          </div>
        </form>
      </dialog>`;
    this.shadowRoot.querySelector('[data-open-config]').addEventListener('click', () => this.openConfig());
    this.shadowRoot.querySelector('[data-cancel]').addEventListener('click', () => this.closeConfig(false));
    this.shadowRoot.querySelector('[data-delete]').addEventListener('click', () => this.deleteWidget());
    this.shadowRoot.querySelector('[data-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      this.saveConfig();
    });
    this.shadowRoot.querySelector('[data-dialog]').addEventListener('cancel', (event) => {
      event.preventDefault();
      this.closeConfig(false);
    });
    this.render();
  }

  disconnectedCallback() {
    window.clearInterval(this.timer);
  }

  set config(value) {
    this.widgetConfig = value;
    if (this.shadowRoot.childElementCount) {
      this.render();
    }
  }

  get config() {
    return this.widgetConfig;
  }

  openConfig({ isNew = false } = {}) {
    this.isNew = isNew;
    const form = this.shadowRoot.querySelector('[data-form]');
    form.elements.title.value = this.widgetConfig.title || '';
    form.elements.showTitle.checked = this.widgetConfig.showTitle !== false;
    form.elements.style.value = this.widgetConfig.style || 'digital';
    form.elements.showSeconds.checked = this.widgetConfig.showSeconds === true;
    form.elements.showDate.checked = this.widgetConfig.showDate === true || form.elements.style.value === 'date';
    form.elements.showWeekday.checked = this.widgetConfig.showWeekday === true;
    this.shadowRoot.querySelector('[data-delete]').hidden = isNew;
    this.shadowRoot.querySelector('[data-error]').textContent = '';
    this.shadowRoot.querySelector('[data-dialog]').showModal();
  }

  async saveConfig() {
    const form = this.shadowRoot.querySelector('[data-form]');
    const title = form.elements.title.value.trim();
    if (title.length > 64 || /[\u0000-\u001f\u007f]/.test(title)) {
      this.shadowRoot.querySelector('[data-error]').textContent = 'Ungültiger Titel';
      return;
    }
    const style = form.elements.style.value;
    if (!STYLES.includes(style)) {
      this.shadowRoot.querySelector('[data-error]').textContent = 'Ungültige Darstellung';
      return;
    }
    const next = {
      id: this.widgetConfig.id,
      type: 'fhem-clock',
      style,
      showSeconds: form.elements.showSeconds.checked,
      showDate: form.elements.showDate.checked || style === 'date',
      showWeekday: form.elements.showWeekday.checked,
      grid: { ...this.widgetConfig.grid }
    };
    if (title) {
      next.title = title;
    }
    if (!form.elements.showTitle.checked) {
      next.showTitle = false;
    }
    try {
      await this.services.saveWidget(next);
      this.closeConfig(true);
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Speichern fehlgeschlagen: ${error.message}`;
    }
  }

  async deleteWidget() {
    if (!window.confirm('Diese Uhr-Kachel entfernen?')) {
      return;
    }
    try {
      await this.services.deleteWidget(this.widgetConfig.id);
      this.closeConfig(true);
    } catch (error) {
      this.shadowRoot.querySelector('[data-error]').textContent = `Entfernen fehlgeschlagen: ${error.message}`;
    }
  }

  closeConfig(saved) {
    const dialog = this.shadowRoot.querySelector('[data-dialog]');
    if (dialog.open) {
      dialog.close();
    }
    if (!saved && this.isNew) {
      this.dispatchEvent(new CustomEvent('cms-widget-cancel', { bubbles: true }));
    }
  }

  render() {
    if (!this.widgetConfig || !this.shadowRoot.querySelector('[data-time]')) {
      return;
    }
    const title = this.shadowRoot.querySelector('[data-title]');
    title.textContent = this.widgetConfig.title || '';
    title.hidden = !this.widgetConfig.title || this.widgetConfig.showTitle === false;
    const time = this.shadowRoot.querySelector('[data-time]');
    const face = this.shadowRoot.querySelector('[data-face]');
    const date = this.shadowRoot.querySelector('[data-date]');
    const analog = this.widgetConfig.style === 'analog';
    time.hidden = analog;
    face.hidden = !analog;
    date.hidden = !(this.widgetConfig.showDate || this.widgetConfig.showWeekday || this.widgetConfig.style === 'date');
    this.shadowRoot.querySelector('.content').toggleAttribute('data-time-only', date.hidden);
    window.clearInterval(this.timer);
    this.updateTime();
    this.timer = window.setInterval(() => this.updateTime(), 1000);
  }

  updateTime() {
    const now = new Date();
    const config = this.widgetConfig;
    if (!config || !this.isConnected) {
      return;
    }
    const timeText = new Intl.DateTimeFormat('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      ...(config.showSeconds === true ? { second: '2-digit' } : {}),
      hourCycle: 'h23'
    }).format(now);
    if (config.style !== 'analog') {
      this.shadowRoot.querySelector('[data-time]').textContent = timeText;
    }
    const parts = [];
    if (config.showWeekday) {
      parts.push(new Intl.DateTimeFormat('de-DE', { weekday: 'long' }).format(now));
    }
    if (config.showDate || config.style === 'date') {
      parts.push(new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(now));
    }
    this.shadowRoot.querySelector('[data-date]').textContent = parts.join(', ');
    this.shadowRoot.querySelector('[data-clock-label]').textContent = `Uhrzeit ${timeText}${parts.length ? `, ${parts.join(', ')}` : ''}`;
    const seconds = now.getSeconds() + now.getMilliseconds() / 1000;
    const minute = now.getMinutes() + seconds / 60;
    const hour = (now.getHours() % 12) + minute / 60;
    this.shadowRoot.querySelector('[data-hour]').style.setProperty('--angle', `${hour * 30}deg`);
    this.shadowRoot.querySelector('[data-minute]').style.setProperty('--angle', `${minute * 6}deg`);
    this.shadowRoot.querySelector('[data-second]').style.setProperty('--angle', `${seconds * 6}deg`);
    this.shadowRoot.querySelector('[data-second]').hidden = config.showSeconds !== true;
  }
}

if (!customElements.get('cms-clock')) {
  customElements.define('cms-clock', FHEMCMSClock);
}
