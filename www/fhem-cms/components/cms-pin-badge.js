class CmsPinBadge extends HTMLElement {
  #button;
  #badge;
  #icon;
  #values;

  constructor() {
    super();
    const shadow = this.attachShadow({mode: 'open'});
    shadow.innerHTML = `
      <style>
        :host { display: block; width: max-content; max-width: var(--cms-pin-max-width, 100vw); }
        * { box-sizing: border-box; }
        button { display: flex; align-items: center; justify-content: center; min-width: 48px; min-height: 48px;
          max-width: inherit; width: 100%; padding: 0; border: 0; background: transparent;
          color: var(--cms-text); font: inherit; cursor: pointer; border-radius: 999px; }
        button:focus-visible { outline: 2px solid var(--cms-accent); outline-offset: -2px; }
        button:active .badge { background: var(--cms-surface-active); }
        .badge { display: flex; align-items: center; gap: 6px; height: 32px; min-width: 32px;
          max-width: 100%; padding: 0 10px 0 8px; border: 1px solid var(--cms-frame);
          border-radius: 999px; background: var(--cms-surface); color: var(--cms-text);
          box-shadow: 0 2px 6px var(--cms-backdrop); backdrop-filter: blur(var(--cms-liquid-blur, 0px));
          font-size: 14px; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .circle { justify-content: center; height: 36px; width: 36px; padding: 0; }
        .icon { display: flex; align-items: center; justify-content: center; flex: 0 0 20px;
          width: 20px; height: 20px; font-size: 20px; line-height: 1; }
        .values { display: flex; align-items: center; gap: 6px; overflow: hidden; min-width: 0; }
        .value { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
        .separator { flex: 0 0 1px; height: 12px; background: currentColor; opacity: .25; }
        :host([data-state="active"]) .badge { border-color: var(--cms-accent); }
        :host([data-state="active"]) .icon { color: var(--cms-accent); }
        :host([data-state="alarm"]) .badge { border-color: var(--cms-danger); }
        :host([data-state="alarm"]) .icon { color: var(--cms-danger); }
        :host([data-stale]) .badge { border-style: dashed; }
      </style>
      <button type="button" aria-haspopup="dialog">
        <span class="badge circle"><span class="icon" aria-hidden="true"></span>
          <span class="values" aria-hidden="true"></span></span>
      </button>`;
    this.#button = shadow.querySelector('button');
    this.#badge = shadow.querySelector('.badge');
    this.#icon = shadow.querySelector('.icon');
    this.#values = shadow.querySelector('.values');
    this.#button.addEventListener('click', () =>
      this.dispatchEvent(new CustomEvent('pin-open', {bubbles: true, composed: true})));
  }

  set presentation(value) {
    if (!value || typeof value.label !== 'string' || !value.label.trim()
      || typeof value.icon !== 'string' || !value.icon.trim()
      || !Array.isArray(value.values) || value.values.some(item => !item
        || typeof item.value !== 'string' || typeof item.unit !== 'string')
      || !['normal', 'active', 'alarm'].includes(value.state)) {
      throw new Error('Ungültige Pin-Darstellung');
    }
    this.dataset.state = value.state;
    this.toggleAttribute('data-stale', value.stale === true);
    this.#icon.textContent = value.icon;
    this.#badge.classList.toggle('circle', value.values.length === 0);
    this.#values.replaceChildren();
    const values = value.values.map(item => `${item.value}${item.unit ? ` ${item.unit}` : ''}`);
    for (const [index, text] of values.entries()) {
      if (index) {
        const separator = this.ownerDocument.createElement('span');
        separator.className = 'separator';
        this.#values.append(separator);
      }
      const field = this.ownerDocument.createElement('span');
      field.className = 'value';
      field.textContent = text;
      this.#values.append(field);
    }
    const status = {normal: '', active: 'aktiv', alarm: 'Alarm'}[value.state];
    const label = [value.label, ...values, status, value.stale ? 'Daten veraltet' : ''].filter(Boolean).join(', ');
    this.#button.setAttribute('aria-label', `${label}: Widget öffnen`);
    this.#button.title = `${label}: Widget öffnen`;
  }
}

customElements.define('cms-pin-badge', CmsPinBadge);
