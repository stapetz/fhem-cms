import { DEFAULT_CANVAS, fitFreeformRect, freeformReadingOrder } from './fcui-freeform-layout.js';

export function mountFreeform(root, page, navigation, render, {background, editing, phone, tablet, navigationGrid, columns, grid} = {}) {
  const doc = root.ownerDocument;
  const browser = doc.defaultView;
  const box = className => Object.assign(doc.createElement('div'), {className});
  const viewport = box('cms-freeform-viewport');
  const footprint = box('cms-freeform-footprint');
  const compactNavigation = box('cms-freeform-compact-navigation');
  compactNavigation.hidden = true;
  const burger = navigation.querySelector('.cms-nav-burger');
  const canvas = box('cms-freeform-canvas');
  const settings = {...DEFAULT_CANVAS, ...page.canvas};
  canvas.style.setProperty('--cms-freeform-snap', `${settings.snapGrid}px`);
  const wrappers = new Map();
  const navBox = box('cms-freeform-navigation');
  let navigationRect = page.navigationRect ?? {x: 0, y: 0, w: settings.width, h: 48};
  if (navigationGrid && columns) {
    const cell = settings.width / columns;
    const {col, row, w, h} = navigationGrid;
    navigationRect = page.navigationRect ?? fitFreeformRect({x: (col - 1) * cell, y: (row - 1) * cell, w: w * cell, h: h * cell}, settings);
  }
  setFreeformBox(navBox, {...navigationRect, z: 10000});
  navBox.append(navigation);
  canvas.append(navBox);
  if (grid) {
    const pane = box('cms-shared-grid-pane');
    pane.append(grid);
    canvas.prepend(pane);
  }
  if (background) canvas.style.backgroundImage = `url("${new URL(background, browser.location.href).href}")`;
  for (const widget of page.widgets) {
    const wrapper = box('cms-freeform-widget');
    wrapper.dataset.widgetId = widget.id;
    wrapper.append(render(widget.id));
    setFreeformBox(wrapper, widget.rect);
    wrappers.set(widget.id, wrapper);
    canvas.append(wrapper);
  }
  footprint.append(canvas);
  viewport.append(compactNavigation, footprint);
  root.classList.add('cms-freeform-root');
  root.append(viewport);
  let stacked = null;
  let compact = false;
  let scale = 1;
  const landscape = browser.matchMedia('(orientation: landscape)');
  const touchTablet = browser.matchMedia('(pointer: coarse) and (min-width: 600px) and (min-height: 600px) and (max-width: 1400px)');
  function resize() {
    const width = viewport.clientWidth;
    if (!width) return;
    const small = !editing && (phone || tablet || touchTablet.matches || browser.innerWidth <= 1100 || width < 640);
    const stack = small && !landscape.matches && settings.mobileBehavior === 'stack';
    const showBurger = small && Boolean(burger);
    if (showBurger !== compact) {
      compact = showBurger;
      compactNavigation.hidden = !compact;
      navBox.hidden = compact;
      navigation.toggleAttribute('data-adaptive', compact);
      navigation.toggleAttribute('data-compact', compact);
      navigation.removeAttribute('data-open');
      burger.setAttribute('aria-expanded', 'false');
      if (compact) compactNavigation.append(navigation);
      else navBox.append(navigation);
    }
    if (stack !== stacked) {
      stacked = stack;
      viewport.classList.toggle('cms-freeform-stack', stack);
      grid?.toggleAttribute('data-responsive', stack);
      grid?.toggleAttribute('data-mobile-layout', stack);
      for (const widget of stack ? freeformReadingOrder(page.widgets) : page.widgets) {
        const node = wrappers.get(widget.id);
        node.hidden = stack && widget.hideOnMobile === true;
        canvas.append(node);
      }
    }
    const top = footprint.getBoundingClientRect().top + browser.scrollY;
    const padding = Number.parseFloat(browser.getComputedStyle(doc.body).paddingBottom) || 0;
    const height = Math.max(1, browser.innerHeight - Math.max(0, top) - padding);
    const byWidth = width / settings.width;
    scale = stack ? 1 : small ? Math.min(byWidth, height / settings.height, 1)
      : settings.scaling === 'none' ? Math.min(1, editing ? Infinity : byWidth) : byWidth;
    canvas.style.setProperty('--cms-freeform-scale', scale);
    canvas.style.setProperty('--cms-view-width', stack ? `${width}px` : `${settings.width}px`);
    viewport.classList.toggle('cms-freeform-fit', !stack && (small || settings.scaling === 'none'));
    footprint.style.width = stack ? '100%' : `${settings.width * scale}px`;
    footprint.style.height = stack ? 'auto' : `${settings.height * scale}px`;
    canvas.style.width = stack ? '100%' : `${settings.width}px`;
    canvas.style.height = stack ? 'auto' : `${settings.height}px`;
    canvas.style.transform = stack ? '' : `scale(${scale})`;
  }
  let frame = null;
  const observer = new browser.ResizeObserver(() => {
    if (frame === null) frame = browser.requestAnimationFrame(() => { frame = null; resize(); });
  });
  observer.observe(viewport);
  observer.observe(compactNavigation);
  landscape.addEventListener('change', resize);
  touchTablet.addEventListener('change', resize);
  browser.addEventListener('resize', resize);
  resize();
  return {
    canvas, wrappers, navBox, navigationRect, getScale: () => scale,
    destroy() {
      observer.disconnect();
      landscape.removeEventListener('change', resize);
      touchTablet.removeEventListener('change', resize);
      browser.removeEventListener('resize', resize);
      if (frame !== null) browser.cancelAnimationFrame(frame);
      root.classList.remove('cms-freeform-root');
    },
  };
}

export function setFreeformBox(node, {x, y, w, h, z = 1}) {
  Object.assign(node.style, {left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, zIndex: z});
}
