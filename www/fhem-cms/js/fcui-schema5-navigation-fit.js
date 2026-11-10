export function measureSchema5Navigation(nav) {
  const browser = nav.ownerDocument.defaultView;
  const measuring = nav.hasAttribute('data-measuring');
  nav.setAttribute('data-measuring', '');
  try {
    const style = browser.getComputedStyle(nav);
    const links = [...nav.querySelectorAll('.cms-nav-link')].filter((link) => !link.hidden);
    const sizes = links.map((link) => link.getBoundingClientRect());
    const gap = Math.max(0, links.length - 1);
    const vertical = nav.classList.contains('is-vertical');
    return {
      width: (vertical ? Math.max(0, ...sizes.map((size) => size.width))
        : sizes.reduce((sum, size) => sum + size.width, 0) + gap * (Number.parseFloat(style.columnGap) || 0))
        + (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0),
      height: (vertical ? sizes.reduce((sum, size) => sum + size.height, 0)
        + gap * (Number.parseFloat(style.rowGap) || 0) : Math.max(0, ...sizes.map((size) => size.height)))
        + (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0),
    };
  } finally {
    if (!measuring) nav.removeAttribute('data-measuring');
  }
}

export function observeSchema5Navigation(nav, constrainHeight = false) {
  const browser = nav.ownerDocument.defaultView;
  const burger = nav.querySelector('.cms-nav-burger');
  if (!burger) throw new Error('Navigationsschalter fehlt');
  let stopped = false;
  nav.setAttribute('data-adaptive', '');
  const measure = () => {
    if (stopped || nav.clientWidth <= 0) return;
    const required = measureSchema5Navigation(nav);
    const compact = required.width > nav.clientWidth + 0.5
      || (constrainHeight && required.height > nav.clientHeight + 0.5);
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
