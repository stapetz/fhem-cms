import { fitFreeformRect, validateFreeformWidget } from './fcui-freeform-layout.js';
import { fitWidgetTools, setFreeformBox } from './fcui-freeform-view.js';
import { containPopupScroll } from './modal-dialog.js';
import { installCloseStyles, styleCloseButton } from './close-button.js';

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

export function mountFreeformEditor(root, page, view, editing, navigation, editNavigation = true) {
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
  containPopupScroll(controls);
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Pixelposition und Größe');
  let selected, active, preview, raf, dragged;
  const button = (parent, text, label, action) => {
    const node = doc.createElement('button');
    node.type = 'button';
    node.textContent = text;
    node.setAttribute('aria-label', label);
    node.title = label;
    node.addEventListener('click', action, options);
    parent.append(node);
    return node;
  };
  const nav = {id: '__nav', rect: view.navigationRect};
  const cards = page.widgets.filter(widget => !view.isPin(widget.id));
  const entries = new Map([['__nav', view.navBox], ...[...view.wrappers].filter(([id]) => !view.isPin(id))]);
  const widgets = editNavigation ? [nav, ...cards] : cards;
  const size = doc.createElement('span');
  size.className = 'cms-widget-dimensions';
  if (editNavigation && !view.navBox.querySelector('.cms-widget-config')) {
    button(navigation, '✎', 'Navigation einstellen', () => editing.onEdit('__nav'));
  }
  const row = name => {
    const line = doc.createElement('div');
    line.className = 'cms-freeform-property-row';
    line.setAttribute('role', 'group');
    line.setAttribute('aria-label', name);
    const label = doc.createElement('span');
    label.textContent = name;
    line.append(label);
    controls.append(line);
    return line;
  };
  const position = row('Position');
  const dimensions = row('Größe');
  const layer = row('Ebene');
  const fields = {};
  for (const [key, name, parent] of [['x','X',position], ['y','Y',position], ['w','Breite',dimensions],
    ['h','Höhe',dimensions], ['hideOnMobile','Auf Mobilgeräten ausblenden',controls]]) {
    const label = doc.createElement('label');
    label.textContent = name;
    const field = fields[key] = doc.createElement('input');
    field.type = key === 'hideOnMobile' ? 'checkbox' : 'number';
    label.append(field);
    parent.append(label);
  }
  const level = doc.createElement('output');
  layer.append(level);
  const back = button(layer, 'Nach hinten', 'Ebene um eins verringern', () => setLevel(Number(level.value) - 1));
  const front = button(layer, 'Nach vorne', 'Ebene um eins erhöhen', () => setLevel(Number(level.value) + 1));
  function setLevel(value) {
    level.value = String(value);
    back.disabled = value <= 0;
    front.disabled = value >= 9999;
  }
  const error = doc.createElement('span');
  error.setAttribute('role', 'status');
  controls.append(error);
  const actions = doc.createElement('div');
  actions.className = 'cms-freeform-property-actions';
  controls.append(actions);
  const closeProperties = (restoreFocus = false) => {
    if (controls.matches(':popover-open')) controls.hidePopover();
    if (restoreFocus) entries.get(selected?.id)?.querySelector('.cms-widget-geometry')?.focus({preventScroll: true});
  };
  installCloseStyles(controls);
  const close = styleCloseButton(button(controls, '', 'Positionseinstellungen schließen', () => closeProperties(true)),
    'Positionseinstellungen schließen');
  close.classList.add('cms-freeform-properties-close');
  button(actions, 'Abbrechen', 'Abbrechen', () => closeProperties(true));
  const save = (rect, hide = selected.hideOnMobile) => {
    try {
      validateFreeformWidget({...selected, rect, hideOnMobile: hide}, page.canvas);
      error.textContent = '';
      return editing.onFreeformChange(selected.id, rect, hide);
    } catch (reason) { error.textContent = reason.message; }
  };
  button(actions, 'Übernehmen', 'Geometrie übernehmen', () => {
    const rect = Object.fromEntries(['x','y','w','h'].map(key => [key, fields[key].valueAsNumber]));
    rect.z = Number(level.value);
    save(rect, fields.hideOnMobile.checked);
    if (!error.textContent) closeProperties(true);
  });
  let handles;
  function draw(rect, guides = []) {
    overlay.querySelectorAll('.cms-freeform-guide').forEach(node => node.remove());
    if (!selected || !rect) return;
    setFreeformBox(entries.get(selected.id), selected === nav ? {...rect, z: 10000} : rect);
    fitWidgetTools(entries.get(selected.id), view.canvas);
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
    if (selected) {
      const wrapper = entries.get(selected.id);
      if (wrapper.contains(doc.activeElement) || overlay.contains(doc.activeElement)) doc.activeElement.blur();
      wrapper.classList.remove('cms-widget-selected');
    }
    view.canvas.addEventListener('cms-pin-select', () => select(), options);
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
      if (wasOpen && controls.matches(':popover-open')) closeProperties(true);
      else {
        for (const key of ['x','y','w','h']) fields[key].value = selected.rect[key];
        setLevel(selected.rect.z ?? 1);
        fields.hideOnMobile.checked = selected.hideOnMobile === true;
        error.textContent = '';
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
    const widget = event.target.closest(editNavigation ? '.cms-freeform-widget,.cms-freeform-navigation' : '.cms-freeform-widget');
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
  doc.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || root.inert || event.target.closest?.('dialog, .cms-menu-items')) return;
    if (controls.matches(':popover-open')) {
      event.preventDefault();
      event.stopPropagation();
      closeProperties(true);
      return;
    }
    if (active) { end(event, false); return; }
    if (selected) select();
  }, options);
  view.canvas.addEventListener('keydown', event => {
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
