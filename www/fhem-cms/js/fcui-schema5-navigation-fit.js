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
  const responsiveWrapper = nav.closest?.('.cms-responsive-navigation');
  const responsiveGrid = nav.closest?.('.cms-schema5-grid');
  let stopped = false;
  const originalScale = nav.style.getPropertyValue('--cms-nav-fit-scale');
  const originalPriority = nav.style.getPropertyPriority('--cms-nav-fit-scale');
  const otherStyles = () => [...nav.style].filter((name) => name !== '--cms-nav-fit-scale')
    .map((name) => [name, nav.style.getPropertyValue(name), nav.style.getPropertyPriority(name)]);
  let observedStyles = JSON.stringify(otherStyles());
  const setScale = (scale) => {
    if (scale === 1 && !originalScale) nav.style.removeProperty('--cms-nav-fit-scale');
    else nav.style.setProperty('--cms-nav-fit-scale', String(scale));
  };
  nav.setAttribute('data-adaptive', '');
  const measure = () => {
    if (stopped || nav.clientWidth <= 0) return;
    const fixedHeight = typeof constrainHeight === 'function' ? constrainHeight() : constrainHeight;
    setScale(1);
    let required = measureSchema5Navigation(nav);
    if (fixedHeight && !nav.classList.contains('is-vertical')
      && required.height > nav.clientHeight + 0.5) {
      let lower = 0.8;
      let upper = 1;
      setScale(lower);
      let reduced = measureSchema5Navigation(nav);
      if (reduced.height <= nav.clientHeight - 0.5) {
        for (let i = 0; i < 10; i++) {
          const middle = (lower + upper) / 2;
          setScale(middle);
          const candidate = measureSchema5Navigation(nav);
          if (candidate.height <= nav.clientHeight - 0.5) {
            lower = middle;
            reduced = candidate;
          } else upper = middle;
        }
        setScale(lower);
        required = reduced;
      } else {
        setScale(1);
      }
    }
    const responsiveFlow = responsiveGrid && browser.getComputedStyle(responsiveGrid).display === 'flex';
    const availableWidth = responsiveFlow ? responsiveGrid.clientWidth : nav.clientWidth;
    const compact = required.width > availableWidth + 0.5
      || (fixedHeight && required.height > nav.clientHeight + 0.5);
    if (compact) setScale(1);
    nav.toggleAttribute('data-compact', compact);
    const editableGrid = responsiveGrid?.classList.contains('cms-grid-editable');
    responsiveWrapper?.toggleAttribute('data-nav-overlay', Boolean(compact && (responsiveFlow || editableGrid)));
    if (!compact) {
      const focused = nav.ownerDocument.activeElement === burger;
      nav.removeAttribute('data-open');
      burger.setAttribute('aria-expanded', 'false');
      if (focused) nav.querySelector('.cms-nav-link')?.focus();
    }
    observedStyles = JSON.stringify(otherStyles());
  };
  const resize = new browser.ResizeObserver(measure);
  const changes = new browser.MutationObserver((records) => {
    if (!records || records.some((record) => record.target !== nav || record.attributeName !== 'style'
      || JSON.stringify(otherStyles()) !== observedStyles)) measure();
  });
  resize.observe(nav);
  if (responsiveGrid && responsiveGrid !== nav) resize.observe(responsiveGrid);
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
    responsiveWrapper?.removeAttribute('data-nav-overlay');
    if (originalScale) nav.style.setProperty('--cms-nav-fit-scale', originalScale, originalPriority);
    else nav.style.removeProperty('--cms-nav-fit-scale');
  };
}
