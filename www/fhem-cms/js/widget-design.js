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
    margin: 0; min-width: 0; font: 700 clamp(1.4rem, 4cqw, 2rem)/1.2 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
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
    font-size: clamp(1rem, 3cqw, 1.5rem); overflow-wrap: anywhere; white-space: normal;
  }
  .tile > .msg { position: relative; inset: auto; flex: none; }
  .tile > .msg:empty, .tile > .status:empty { display: none; }
`;

export const detailCardCss = `
  background: rgba(128,128,128,.08); border: 1px solid rgba(128,128,128,.18);
  border-radius: 14px; padding: 14px;
`;

export const widgetIconButtonCss = `
  button.cms-icon-button {
    display:inline-flex; align-items:center; justify-content:center; flex:none;
    width:48px; height:48px; min-width:48px; min-height:48px; padding:0;
    border:0; border-radius:50%; background:transparent; box-shadow:none;
    color:var(--cms-accent,#3b82f6); cursor:pointer;
  }
  button.cms-icon-button svg { display:block; width:28px; height:28px; pointer-events:none; }
  button.cms-icon-button:hover { color:inherit; }
  button.cms-icon-button:focus-visible { outline:2px solid currentColor; outline-offset:2px; }
  button.cms-icon-button:disabled { cursor:default; opacity:.5; }
`;

export function createWidgetIconButton(kind, label) {
  if (!['info', 'actions'].includes(kind)) throw new Error('Unbekanntes Widgetsymbol');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cms-icon-button';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.setAttribute('aria-haspopup', 'dialog');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const circle = document.createElementNS(svg.namespaceURI, 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '9');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', kind === 'info' ? 'M12 11v6 M12 7.5v.1' : 'M8 16.5l4-9 4 9 M9.5 13.5h5');
  svg.append(circle, path);
  button.append(svg);
  return button;
}
