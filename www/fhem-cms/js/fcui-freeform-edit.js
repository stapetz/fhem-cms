import { fitFreeformRect, validateFreeformWidget } from './fcui-freeform-layout.js';
import { setFreeformBox } from './fcui-freeform-view.js';

export function freeformGesture(rect, direction, dx, dy, canvas, widgets, noSnap) {
  const result = {...rect};
  const guides = [];
  for (const [axis, size, delta, limit, start, end] of [
    ['x', 'w', dx, canvas.width, 'w', 'e'], ['y', 'h', dy, canvas.height, 'n', 's'],
  ]) {
    const leading = direction.includes(start);
    if (direction !== 'move' && !leading && !direction.includes(end)) continue;
    const trailing = rect[axis] + rect[size];
    const moving = direction === 'move';
    const origin = moving || leading ? rect[axis] : trailing;
    const low = moving || leading ? 0 : rect[axis] + 10;
    const high = moving ? limit - rect[size] : leading ? trailing - 10 : limit;
    const raw = origin + delta;
    const grid = noSnap ? 1 : canvas.snapGrid ?? 5;
    let value = Math.min(high, Math.max(low, Math.round(raw / grid) * grid));
    if (!noSnap) {
      const targets = [limit / 2, ...widgets.flatMap(({rect: r}) => [r[axis], r[axis] + r[size] / 2, r[axis] + r[size]])];
      let best = Infinity;
      let line;
      for (const target of targets) {
        for (const offset of moving ? [0, rect[size] / 2, rect[size]] : [0]) {
          const next = Math.round(target - offset);
          const distance = Math.abs(raw + offset - target);
          if (distance <= 5 && distance < best && next >= low && next <= high) {
            best = distance;
            value = next;
            line = target;
          }
        }
      }
      if (line !== undefined) guides.push([axis, line]);
    }
    if (moving) result[axis] = value;
    else if (leading) { result[axis] = value; result[size] = trailing - value; }
    else result[size] = value - rect[axis];
  }
  return {rect: result, guides};
}

export function mountFreeformEditor(root, page, view, editing, navigation) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const events = new AbortController();
  const options = {signal: events.signal};
  const overlay = doc.createElement('div');
  overlay.className = 'cms-freeform-overlay';
  view.canvas.append(overlay);
  const controls = doc.createElement('div');
  controls.className = 'cms-freeform-properties';
  controls.setAttribute('popover', 'auto');
  let selected, active, preview, raf, dragged;
  const button = (parent, text, label, action) => {
    const node = doc.createElement('button');
    node.type = 'button';
    node.textContent = text;
    node.setAttribute('aria-label', label);
    node.addEventListener('click', action, options);
    parent.append(node);
    return node;
  };
  const nav = {id: '__nav', rect: view.navigationRect};
  const entries = new Map([['__nav', view.navBox], ...view.wrappers]);
  const widgets = [nav, ...page.widgets];
  const size = doc.createElement('span');
  size.className = 'cms-widget-dimensions';
  if (!view.navBox.querySelector('.cms-widget-config')) {
    button(navigation, '✎', 'Navigation einstellen', () => editing.onEdit('__nav'));
  }
  const details = doc.createElement('div');
  controls.append(details);
  const fields = {};
  for (const [key, name] of [['x','X'], ['y','Y'], ['w','Breite'], ['h','Höhe'], ['z','Ebene'], ['hideOnMobile','Auf Mobilgeräten ausblenden']]) {
    const label = doc.createElement('label');
    label.textContent = name;
    const field = fields[key] = doc.createElement('input');
    field.type = key === 'hideOnMobile' ? 'checkbox' : 'number';
    label.append(field);
    details.append(label);
  }
  const error = doc.createElement('span');
  error.setAttribute('role', 'status');
  const save = (rect, hide = selected.hideOnMobile) => {
    try {
      validateFreeformWidget({...selected, rect, hideOnMobile: hide}, page.canvas);
      error.textContent = '';
      return editing.onFreeformChange(selected.id, rect, hide);
    } catch (reason) { error.textContent = reason.message; }
  };
  button(details, 'Übernehmen', 'Geometrie übernehmen', () => {
    const rect = Object.fromEntries(['x','y','w','h','z'].map(key => [key, fields[key].valueAsNumber]));
    save(rect, fields.hideOnMobile.checked);
  });
  button(details, 'Nach vorne', 'Widget nach vorne holen', () => {
    save({...selected.rect, z: Math.min(9999, Math.max(0, ...page.widgets.map(widget => widget.rect.z ?? 1)) + 1)});
  });
  button(details, 'Nach hinten', 'Widget nach hinten setzen', () => {
    save({...selected.rect, z: Math.max(0, Math.min(9999, ...page.widgets.map(widget => widget.rect.z ?? 1)) - 1)});
  });
  details.append(error);
  let handles;
  function draw(rect, guides = []) {
    overlay.querySelectorAll('.cms-freeform-guide').forEach(node => node.remove());
    if (!selected || !rect) return;
    setFreeformBox(entries.get(selected.id), selected === nav ? {...rect, z: 10000} : rect);
    setFreeformBox(handles, {...rect, z: 1});
    if (active && active.direction !== 'move') {
      handles.append(size);
      size.textContent = `${rect.w} × ${rect.h} px`;
    } else size.remove();
    for (const [axis, value] of guides) {
      const line = doc.createElement('div');
      line.className = `cms-freeform-guide cms-freeform-guide-${axis}`;
      line.style[axis === 'x' ? 'left' : 'top'] = `${value}px`;
      line.style[axis === 'x' ? 'width' : 'height'] = `${1 / view.getScale()}px`;
      overlay.append(line);
    }
  }
  function select(id, focus = false) {
    if (selected) entries.get(selected.id).classList.remove('cms-widget-selected');
    controls.remove();
    selected = widgets.find(widget => widget.id === id);
    overlay.replaceChildren();
    if (!selected) return;
    const wrapper = entries.get(id);
    wrapper.classList.add('cms-widget-selected');
    handles = doc.createElement('div');
    handles.className = 'cms-freeform-handles';
    for (const direction of ['n','ne','e','se','s','sw','w','nw']) {
      const handle = button(handles, '', `Größe ändern (${direction})`, () => {});
      handle.dataset.dir = direction;
    }
    overlay.append(handles);
    draw(selected.rect);
    for (const key of ['x','y','w','h','z']) fields[key].value = selected.rect[key] ?? 1;
    fields.hideOnMobile.checked = selected.hideOnMobile === true;
    if (focus) wrapper.querySelector('[data-dir="move"]')?.focus({preventScroll: true});
  }
  for (const [id, wrapper] of entries) {
    const tools = wrapper.querySelector('.cms-widget-tools');
    const move = wrapper.querySelector('[data-dir="move"]');
    if (!tools || !move) continue;
    move.addEventListener('click', event => {
      if (!active && (!dragged || event.detail === 0)) select(selected?.id === id ? undefined : id);
    }, options);
    if (id === '__nav') continue;
    const geometry = button(tools, '↔', 'Pixelposition und Größe einstellen', () => {
      const wasOpen = controls.parentNode === wrapper;
      if (selected?.id !== id) select(id);
      if (wasOpen && controls.matches(':popover-open')) controls.hidePopover();
      else {
        wrapper.append(controls);
        const anchor = geometry.getBoundingClientRect();
        controls.style.left = `${Math.max(8, Math.min(anchor.left, doc.documentElement.clientWidth - 456))}px`;
        controls.style.top = `${anchor.bottom + 4}px`;
        controls.showPopover();
        const height = controls.getBoundingClientRect().height;
        if (anchor.bottom + height + 12 > doc.documentElement.clientHeight) {
          controls.style.top = `${Math.max(8, anchor.top - height - 4)}px`;
        }
        fields.x.focus();
      }
    });
    geometry.className = 'cms-widget-geometry';
  }
  view.canvas.addEventListener('click', event => {
    const widget = event.target.closest('.cms-freeform-widget,.cms-freeform-navigation');
    if (widget && !active && !event.target.closest('.cms-widget-tools,.cms-freeform-properties,[data-dir="move"],a:not([aria-current])')) {
      if (event.target.closest('a[aria-current]')) event.preventDefault();
      const id = widget.dataset.widgetId || '__nav';
      select(selected?.id === id ? undefined : id, selected?.id !== id);
    }
    if (event.target === view.canvas && !active) select();
  }, options);
  view.canvas.addEventListener('pointerdown', event => {
    dragged = false;
    const direction = event.target.dataset.dir;
    if (!direction || active || event.button !== 0) return;
    const wrapper = event.target.closest('.cms-freeform-widget,.cms-freeform-navigation');
    const id = wrapper && (wrapper.dataset.widgetId || '__nav');
    if (id && selected?.id !== id) select(id);
    if (!selected) return;
    event.preventDefault();
    event.target.focus();
    active = {id: event.pointerId, target: event.target, direction, x: event.clientX, y: event.clientY, scale: view.getScale(), moved: false};
    event.target.setPointerCapture(event.pointerId);
    draw(selected.rect);
  }, options);
  function calculate(event) {
    return freeformGesture(selected.rect, active.direction,
      (event.clientX - active.x) / active.scale, (event.clientY - active.y) / active.scale,
      page.canvas, widgets.filter(widget => widget !== selected), event.altKey);
  }
  view.canvas.addEventListener('pointermove', event => {
    if (active?.id !== event.pointerId) return;
    active.moved ||= event.clientX !== active.x || event.clientY !== active.y;
    preview = calculate(event);
    if (raf === undefined) raf = win.requestAnimationFrame(() => { raf = undefined; draw(preview.rect, preview.guides); });
  }, options);
  function end(event, commit) {
    if (!active || (event.pointerId !== undefined && event.pointerId !== active.id)) return;
    const {id, target, moved} = active;
    const rect = commit && (active.moved || event.clientX !== active.x || event.clientY !== active.y)
      ? calculate(event).rect : selected.rect;
    active = null;
    dragged = moved;
    if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
    if (raf !== undefined) win.cancelAnimationFrame(raf);
    raf = undefined;
    draw(rect);
    if (commit && ['x','y','w','h'].some(key => rect[key] !== selected.rect[key])) save(rect);
  }
  view.canvas.addEventListener('pointerup', event => end(event, true), options);
  view.canvas.addEventListener('pointercancel', event => end(event, false), options);
  view.canvas.addEventListener('lostpointercapture', event => end(event, false), options);
  view.canvas.addEventListener('keydown', event => {
    if (event.key === 'Escape' && controls.contains(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      event.target.closest('.cms-freeform-widget')?.querySelector('.cms-widget-geometry')?.focus();
      controls.remove();
      return;
    }
    if (event.key === 'Escape' && active) { event.stopPropagation(); end(event, false); return; }
    if (event.key === 'Escape' && selected) { event.stopPropagation(); select(); return; }
    if (!selected || active || !event.target.matches('[data-dir="move"]')) return;
    const delta = {ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1]}[event.key];
    if (!delta) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    save(fitFreeformRect({...selected.rect, x: selected.rect.x + delta[0] * step,
      y: selected.rect.y + delta[1] * step}, page.canvas));
  }, options);
  select(editing.selectedWidget, true);
  return () => { end({}, false); events.abort(); };
}
