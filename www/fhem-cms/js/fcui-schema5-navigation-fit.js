export function observeSchema5Navigation(nav) {
  const browser = nav.ownerDocument.defaultView;
  const burger = nav.querySelector('.cms-nav-burger');
  if (!burger) throw new Error('Navigationsschalter fehlt');
  let stopped = false;
  nav.setAttribute('data-adaptive', '');
  const measure = () => {
    if (stopped || nav.clientWidth <= 0) return;
    nav.setAttribute('data-measuring', '');
    let required;
    let available;
    try {
      const style = browser.getComputedStyle(nav);
      const links = [...nav.querySelectorAll('.cms-nav-link')].filter((link) => !link.hidden);
      const gap = Number.parseFloat(style.columnGap) || 0;
      required = links.reduce((width, link) => width + link.getBoundingClientRect().width, 0)
        + Math.max(0, links.length - 1) * gap;
      available = nav.clientWidth - (Number.parseFloat(style.paddingLeft) || 0)
        - (Number.parseFloat(style.paddingRight) || 0);
    } finally {
      nav.removeAttribute('data-measuring');
    }
    const compact = required > available + 0.5;
    nav.toggleAttribute('data-compact', compact);
    if (!compact) {
      const focused = nav.ownerDocument.activeElement === burger;
      nav.removeAttribute('data-open');
      burger.setAttribute('aria-expanded', 'false');
      if (focused) nav.querySelector('.cms-nav-link')?.focus();
    }
  };
  const resize = new browser.ResizeObserver(measure);
  const changes = new browser.MutationObserver(measure);
  resize.observe(nav);
  changes.observe(nav, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-current'] });
  const fonts = nav.ownerDocument.fonts;
  fonts?.addEventListener('loadingdone', measure);
  fonts?.ready.then(measure);
  measure();
  return () => {
    stopped = true;
    resize.disconnect();
    changes.disconnect();
    fonts?.removeEventListener('loadingdone', measure);
    nav.removeAttribute('data-adaptive');
    nav.removeAttribute('data-compact');
  };
}
