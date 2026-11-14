import { widgetDesignCss } from './widget-design.js';

export const widgetHierarchyCss = `
  ${widgetDesignCss}
`;

export const fittedContentCss = `
  ${widgetHierarchyCss}
  .main { position: relative; flex: 1 0 var(--cms-widget-main-basis, 48px); display: flex; align-items: safe center;
    justify-content: safe center; min-width: 0; min-height: var(--cms-widget-main-height, 48px); padding: 0; }
  [data-fit-content] { flex: none; width: max-content; max-width: var(--cms-widget-fit-width, none); }
  .fit-row { display: inline-flex; align-items: center; gap: 0.14em; }
  .tile [data-fit-content] :is(.fit-row, .value, .label, .state) {
    min-width: 0; white-space: var(--cms-widget-fit-white-space, nowrap); overflow-wrap: anywhere;
  }
  .tile .main { overflow: var(--cms-widget-overflow, auto); }
`;

export function fitWidgetContent(host) {
  const tile = host.shadowRoot.querySelector('.tile');
  const area = tile.querySelector('.main');
  const content = area.querySelector('[data-fit-content]');
  const header = tile.querySelector('[data-header]');
  const message = tile.querySelector('[data-msg]');
  let frame = 0;
  let disposed = false;
  const fit = () => {
    frame = 0;
    const bounds = tile.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const available = area.getBoundingClientRect();
    if (!available.width || !available.height) return;
    // Measure the unwrapped group rather than a flex-shrunk value or label.
    area.style.fontSize = '16px';
    content.style.minWidth = '0';
    content.style.minHeight = '0';
    const natural = content.getBoundingClientRect();
    content.style.removeProperty('min-width');
    content.style.removeProperty('min-height');
    if (!natural.width || !natural.height) return;
    let size = Math.max(12, 16 * Math.min(available.width / natural.width, available.height / natural.height) * 0.98);
    area.style.fontSize = `${size}px`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const actual = content.getBoundingClientRect();
      const correction = Math.min(1,
        available.width / Math.max(actual.width, area.scrollWidth),
        available.height / Math.max(actual.height, area.scrollHeight));
      if (correction >= 1 || size <= 12) break;
      size = Math.max(12, size * correction * 0.98);
      area.style.fontSize = `${size}px`;
    }
  };
  const schedule = () => {
    if (!disposed && !frame) frame = requestAnimationFrame(fit);
  };
  const resize = new ResizeObserver(schedule);
  for (const element of [tile, header, message]) {
    if (element) resize.observe(element);
  }
  const mutations = new MutationObserver(schedule);
  mutations.observe(tile, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['hidden'] });
  document.fonts.addEventListener('loadingdone', schedule);
  document.fonts.ready.then(schedule);
  schedule();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resize.disconnect();
    mutations.disconnect();
    document.fonts.removeEventListener('loadingdone', schedule);
  };
}
