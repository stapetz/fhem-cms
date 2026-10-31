class FHEMCMSDeviceCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          margin-top: 1.5rem;
          padding: 1.25rem;
          border: 1px solid #43564a;
          border-radius: 1rem;
          background: #202e27;
        }

        h2 {
          margin-top: 0;
          font-size: 1rem;
        }

        .device {
          overflow-wrap: anywhere;
          font-size: 1.25rem;
          font-weight: 700;
        }

        .status {
          margin-bottom: 0;
          color: #a5c9b2;
          line-height: 1.5;
        }
      </style>
      <section aria-labelledby="device-title">
        <h2 id="device-title">Device</h2>
        <p class="device" data-device-name></p>
        <p class="status" role="status" data-cms-status></p>
      </section>
    `;

    this.shadowRoot.querySelector('[data-device-name]').textContent =
      this.getAttribute('device') || 'unbekannt';
    this.status = this.getAttribute('status') || 'Grundstruktur bereit.';
  }

  set status(value) {
    const status = this.shadowRoot.querySelector('[data-cms-status]');
    if (status) {
      status.textContent = String(value);
    }
  }
}

customElements.define('cms-device-card', FHEMCMSDeviceCard);
