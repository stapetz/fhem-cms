export const fittedContentCss = `
  .main { position: absolute; inset: 3%; display: flex; align-items: center;
    justify-content: center; min-width: 0; min-height: 0; padding: 0; }
  [data-fit-content] { flex: none; width: max-content; max-width: none; }
  .fit-row { display: inline-flex; align-items: center; gap: 0.14em; }
  :host([view-only]) header { left: 0; right: 0; padding-inline: 3%; }
  @container (max-height: 3rem) { header { display: none; } }
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
    const gap = Math.min(bounds.width, bounds.height) * 0.03;
    const title = header.getBoundingClientRect();
    const status = message?.getBoundingClientRect();
    area.style.top = `${Math.max(gap, title.height ? title.bottom - bounds.top + gap : 0)}px`;
    area.style.bottom = `${Math.max(gap, status?.height ? bounds.bottom - status.top + gap : 0)}px`;
    const available = area.getBoundingClientRect();
    if (!available.width || !available.height) return;
    // Measure the unwrapped group rather than a flex-shrunk value or label.
    area.style.fontSize = '16px';
    const natural = content.getBoundingClientRect();
    if (!natural.width || !natural.height) return;
    let size = 16 * Math.min(available.width / natural.width, available.height / natural.height) * 0.98;
    area.style.fontSize = `${size}px`;
    const actual = content.getBoundingClientRect();
    const correction = Math.min(1, available.width / actual.width, available.height / actual.height);
    if (correction < 1) {
      size *= correction;
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
