import { DEFAULT_CANVAS, fitFreeformRect, freeformReadingOrder } from './fcui-freeform-layout.js';
import { measureSchema5Navigation } from './fcui-schema5-navigation-fit.js';

export function mountFreeform(root, page, navigation, render, {background, editing, phone, tablet, navigationGrid, columns, grid} = {}) {
  const doc = root.ownerDocument;
  const browser = doc.defaultView;
  const box = className => Object.assign(doc.createElement('div'), {className});
  const viewport = box('cms-freeform-viewport');
  const footprint = box('cms-freeform-footprint');
  const compactNavigation = box('cms-freeform-compact-navigation');
  compactNavigation.hidden = true;
  const burger = navigation.querySelector('.cms-nav-burger');
  if (burger) navigation.setAttribute('data-adaptive', '');
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
  if (background) viewport.style.setProperty('--cms-canvas-image', `url("${new URL(background, browser.location.href).href}")`);
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
  function landscapeNavigationFits(byWidth) {
    const probe = compact ? navigation.cloneNode(true) : navigation;
    if (compact) {
      probe.inert = true;
      probe.style.visibility = 'hidden';
      navBox.append(probe);
      navBox.hidden = false;
    }
    try {
      const required = measureSchema5Navigation(probe, byWidth);
      return required.width <= probe.clientWidth + .5 && required.height <= probe.clientHeight + .5
        && required.minTarget >= 23.99 && required.minFont >= 12;
    } finally {
      if (compact) {
        probe.remove();
        navBox.hidden = true;
      }
    }
  }
  function resize() {
    const mobileDevice = phone || tablet || touchTablet.matches || browser.innerWidth <= 1100;
    const small = !editing && (mobileDevice || viewport.clientWidth < 640);
    const mobilePortrait = small && !landscape.matches;
    const mobileLandscape = small && landscape.matches;
    const fullLandscape = mobileLandscape && mobileDevice && root.closest('body > .cms-shell');
    viewport.classList.toggle('cms-freeform-mobile', small);
    viewport.classList.toggle('cms-freeform-landscape', mobileLandscape);
    viewport.classList.toggle('cms-freeform-landscape-full', Boolean(fullLandscape));
    const width = viewport.clientWidth;
    if (!width) return;
    const stack = mobilePortrait && settings.mobileBehavior === 'stack';
    const byWidth = width / settings.width;
    if (mobileLandscape) {
      canvas.style.width = `${settings.width}px`;
      canvas.style.transform = `scale(${byWidth})`;
      canvas.style.setProperty('--cms-view-width', `${settings.width}px`);
      canvas.style.setProperty('--cms-landscape-nav-target', `${24 / byWidth}px`);
      viewport.classList.remove('cms-freeform-stack');
    }
    const showBurger = Boolean(burger) && (mobilePortrait || (mobileLandscape && !landscapeNavigationFits(byWidth)));
    if (showBurger !== compact) {
      const hadFocus = navigation.contains(doc.activeElement);
      compact = showBurger;
      compactNavigation.hidden = !compact;
      navBox.hidden = compact;
      navigation.toggleAttribute('data-compact', compact);
      navigation.removeAttribute('data-open');
      burger.setAttribute('aria-expanded', 'false');
      if (compact) compactNavigation.append(navigation);
      else navBox.append(navigation);
      if (hadFocus) (compact ? burger : navigation.querySelector('.cms-nav-link'))?.focus({preventScroll:true});
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
    const viewportTop = viewport.getBoundingClientRect().top + browser.scrollY;
    viewport.style.minHeight = fullLandscape ? `${Math.max(0, browser.innerHeight - viewportTop - padding)}px` : '';
    scale = stack ? 1 : mobilePortrait ? Math.min(byWidth, height / settings.height, 1)
      : small ? byWidth
      : settings.scaling === 'none' ? Math.min(1, editing ? Infinity : byWidth) : byWidth;
    canvas.style.setProperty('--cms-freeform-scale', scale);
    canvas.style.setProperty('--cms-view-width', stack ? `${width}px` : `${settings.width}px`);
    viewport.classList.toggle('cms-freeform-fit', !stack && (small || settings.scaling === 'none'));
    footprint.style.width = stack ? '100%' : `${settings.width * scale}px`;
    footprint.style.height = stack ? 'auto' : `${settings.height * scale}px`;
    canvas.style.width = stack ? '100%' : `${settings.width}px`;
    canvas.style.height = stack ? 'auto' : `${settings.height}px`;
    canvas.style.transform = stack ? '' : `scale(${scale})`;
    for (const wrapper of canvas.querySelectorAll('.cms-widget-selected')) {
      fitWidgetTools(wrapper, wrapper.closest('.cms-shared-grid-pane') ?? canvas);
    }
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
  const navChanges = new browser.MutationObserver(resize);
  navChanges.observe(navigation, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['hidden', 'aria-current']});
  doc.fonts?.addEventListener('loadingdone', resize);
  resize();
  return {
    canvas, wrappers, navBox, navigationRect, getScale: () => scale,
    destroy() {
      observer.disconnect();
      navChanges.disconnect();
      doc.fonts?.removeEventListener('loadingdone', resize);
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

export function fitWidgetTools(wrapper, container) {
  const tools = wrapper.querySelector('.cms-widget-tools');
  if (!tools) return;
  const browser = wrapper.ownerDocument.defaultView;
  const style = browser.getComputedStyle(wrapper);
  const scale = Number.parseFloat(style.getPropertyValue('--cms-freeform-scale')) || 1;
  const bounds = container.getBoundingClientRect();
  tools.style.translate = 'none';
  tools.style.maxHeight = `${Math.max(48, Math.min(bounds.height, browser.innerHeight - 16)) / scale}px`;
  const rect = tools.getBoundingClientRect();
  const x = Math.max(bounds.left, Math.min(rect.left, bounds.right - rect.width));
  let y = Math.max(bounds.top, Math.min(rect.top, bounds.bottom - rect.height));
  const widget = wrapper.getBoundingClientRect();
  const clearance = (Number.parseFloat(style.getPropertyValue('--cms-freeform-handle-target')) || 18) + 4;
  // Tall, wrapped tools must not cross the widget's resize handles.
  if (rect.height > widget.height - 2 * clearance) {
    if (widget.top - clearance - rect.height >= bounds.top) y = widget.top - clearance - rect.height;
    else if (widget.bottom + clearance + rect.height <= bounds.bottom) y = widget.bottom + clearance;
  }
  tools.style.translate = `${(x - rect.left) / scale}px ${(y - rect.top) / scale}px`;
}
