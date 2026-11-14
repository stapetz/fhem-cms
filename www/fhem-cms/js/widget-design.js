export const widgetDesignCss = `
  .tile {
    position: relative; display: flex; flex-direction: column; gap: 14px;
    height: var(--cms-widget-height, 100%); min-width: 0; min-height: 0;
    padding: 8px; overflow: var(--cms-widget-overflow, auto);
    container-type: var(--cms-widget-containment, size);
    border: 1px solid var(--cms-frame, #7f8c84); border-radius: 1.4rem;
    background: var(--cms-surface, #202e27); color: inherit;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .tile header {
    position: relative; inset: auto; display: flex; flex: none; align-items: center;
    justify-content: space-between; gap: 8px; width: 100%; min-width: 0;
    margin: 0; padding: 0 0 8px; color: inherit; font-size: 1rem;
    border-bottom: 1px solid rgba(128,128,128,.25);
  }
  .tile header[hidden] { display: none; }
  :host([view-only]) .tile header:has(> [data-title][hidden]):not(:has(.controls, .badge:not([hidden]))) { display: none; }
  .tile header h3[data-title] {
    margin: 0; min-width: 0; font: 700 1.4rem/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: inherit; white-space: normal; overflow-wrap: anywhere;
    overflow: visible; text-overflow: clip; text-align: var(--cms-widget-title-align, left);
  }
  .tile [data-open-config] {
    position: absolute; top: 8px; right: 8px; z-index: 2;
    min-width: 48px; min-height: 48px; margin: 0; font-size: 1rem;
  }
  :host(:not([view-only])) .tile header { min-height: 56px; padding-right: 56px; }
  :host(:not([view-only])) .tile:not(:has(header:not([hidden]) > [data-title]:not([hidden]))) { padding-top: 64px; }
  .tile button:active, .tile select:active { transform: scale(.96); }
  .tile button[data-fit-content] { min-width: 48px; min-height: 48px; }
  .tile > .status, .tile > .range, .tile > .msg {
    font-size: .86rem; overflow-wrap: anywhere; white-space: normal;
  }
  .tile > .msg { position: relative; inset: auto; flex: none; }
  .tile > .msg:empty, .tile > .status:empty { display: none; }
`;

export const detailCardCss = `
  background: rgba(128,128,128,.08); border: 1px solid rgba(128,128,128,.18);
  border-radius: 14px; padding: 14px;
`;
