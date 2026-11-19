import { DEFAULT_CANVAS, freeformReadingOrder, freeformScale } from './fcui-freeform-layout.js';

export function mountFreeform(root, page, navigation, render, {background, editing, phone} = {}) {
  const doc = root.ownerDocument;
  const browser = doc.defaultView;
  const box = className => Object.assign(doc.createElement('div'), {className});
  const viewport = box('cms-freeform-viewport');
  const footprint = box('cms-freeform-footprint');
  const canvas = box('cms-freeform-canvas');
  const settings = {...DEFAULT_CANVAS, ...page.canvas};
  const wrappers = new Map();
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
  viewport.append(footprint);
  root.classList.add('cms-freeform-root');
  root.append(navigation, viewport);
  let stacked = null;
  let scale = 1;
  function resize() {
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (!width) return;
    const stack = !editing && settings.mobileBehavior === 'stack' && (phone || width < 640);
    if (stack !== stacked) {
      stacked = stack;
      viewport.classList.toggle('cms-freeform-stack', stack);
      for (const widget of stack ? freeformReadingOrder(page.widgets) : page.widgets) {
        const node = wrappers.get(widget.id);
        node.hidden = stack && widget.hideOnMobile === true;
        canvas.append(node);
      }
    }
    if (!stack && !height) {
      viewport.classList.remove('cms-freeform-stack');
      return;
    }
    scale = stack ? 1 : freeformScale(settings, width, height);
    canvas.style.setProperty('--cms-freeform-scale', scale);
    viewport.classList.toggle('cms-freeform-fit', !stack && settings.scaling === 'fit');
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
  resize();
  return {
    canvas, wrappers, getScale: () => scale,
    destroy() {
      observer.disconnect();
      if (frame !== null) browser.cancelAnimationFrame(frame);
      root.classList.remove('cms-freeform-root');
    },
  };
}

export function setFreeformBox(node, {x, y, w, h, z = 1}) {
  Object.assign(node.style, {left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, zIndex: z});
}
