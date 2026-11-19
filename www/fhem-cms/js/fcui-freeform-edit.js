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
  root.insertBefore(controls, view.canvas.closest('.cms-freeform-viewport'));
  let selected, active, preview, raf;
  const button = (parent, text, label, action) => {
    const node = doc.createElement('button');
    node.type = 'button';
    node.textContent = text;
    node.setAttribute('aria-label', label);
    node.addEventListener('click', action, options);
    parent.append(node);
    return node;
  };
  button(navigation, 'Navigation einstellen', 'Navigation einstellen', () => editing.onEdit('__nav'));
  const selector = doc.createElement('select');
  selector.setAttribute('aria-label', 'Widget auswählen');
  selector.append(new win.Option('Widget auswählen', ''));
  for (const widget of page.widgets) selector.append(new win.Option(widget.title || widget.id, widget.id));
  controls.append(selector);
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
  for (const [callback, label] of [['onEdit','Widget einstellen'], ['onDuplicate','Duplizieren'], ['onSaveBlueprint','Als Vorlage speichern'], ['onMove','Verschieben auf andere Seite'], ['onDelete','Löschen']]) {
    if (editing[callback]) button(details, label, label, () => editing[callback](selected.id));
  }
  details.append(error);
  let handles;
  function draw(rect, guides = []) {
    overlay.querySelectorAll('.cms-freeform-guide').forEach(node => node.remove());
    if (!selected || !rect) return;
    setFreeformBox(view.wrappers.get(selected.id), rect);
    setFreeformBox(handles, {...rect, z: 1});
    for (const [axis, value] of guides) {
      const line = doc.createElement('div');
      line.className = `cms-freeform-guide cms-freeform-guide-${axis}`;
      line.style[axis === 'x' ? 'left' : 'top'] = `${value}px`;
      line.style[axis === 'x' ? 'width' : 'height'] = `${1 / view.getScale()}px`;
      overlay.append(line);
    }
  }
  function select(id, focus = false) {
    selected = page.widgets.find(widget => widget.id === id);
    selector.value = selected?.id || '';
    details.hidden = !selected;
    overlay.replaceChildren();
    if (!selected) return;
    handles = doc.createElement('div');
    handles.className = 'cms-freeform-handles';
    for (const direction of ['move','n','ne','e','se','s','sw','w','nw']) {
      const handle = button(handles, direction === 'move' ? '⠿' : '', direction === 'move' ? 'Widget verschieben' : `Größe ändern (${direction})`,
        () => {});
      handle.dataset.dir = direction;
    }
    overlay.append(handles);
    draw(selected.rect);
    for (const key of ['x','y','w','h','z']) fields[key].value = selected.rect[key] ?? 1;
    fields.hideOnMobile.checked = selected.hideOnMobile === true;
    if (focus) handles.firstChild.focus();
  }
  selector.addEventListener('change', () => select(selector.value), options);
  view.canvas.addEventListener('click', event => {
    const widget = event.target.closest('.cms-freeform-widget');
    if (widget && !active) select(widget.dataset.widgetId, true);
  }, options);
  overlay.addEventListener('pointerdown', event => {
    const direction = event.target.dataset.dir;
    if (!direction || !selected || active || event.button !== 0) return;
    event.preventDefault();
    event.target.focus();
    active = {id: event.pointerId, direction, x: event.clientX, y: event.clientY, scale: view.getScale(), moved: false};
    overlay.setPointerCapture(event.pointerId);
  }, options);
  function calculate(event) {
    return freeformGesture(selected.rect, active.direction,
      (event.clientX - active.x) / active.scale, (event.clientY - active.y) / active.scale,
      page.canvas, page.widgets.filter(widget => widget !== selected), event.altKey);
  }
  overlay.addEventListener('pointermove', event => {
    if (active?.id !== event.pointerId) return;
    active.moved ||= event.clientX !== active.x || event.clientY !== active.y;
    preview = calculate(event);
    if (raf === undefined) raf = win.requestAnimationFrame(() => { raf = undefined; draw(preview.rect, preview.guides); });
  }, options);
  function end(event, commit) {
    if (!active || (event.pointerId !== undefined && event.pointerId !== active.id)) return;
    const {id} = active;
    const rect = commit && (active.moved || event.clientX !== active.x || event.clientY !== active.y)
      ? calculate(event).rect : selected.rect;
    active = null;
    if (overlay.hasPointerCapture(id)) overlay.releasePointerCapture(id);
    if (raf !== undefined) win.cancelAnimationFrame(raf);
    raf = undefined;
    draw(rect);
    if (commit && ['x','y','w','h'].some(key => rect[key] !== selected.rect[key])) save(rect);
  }
  overlay.addEventListener('pointerup', event => end(event, true), options);
  overlay.addEventListener('pointercancel', event => end(event, false), options);
  overlay.addEventListener('lostpointercapture', event => end(event, false), options);
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Escape' && active) { event.stopPropagation(); end(event, false); return; }
    if (!selected || active || !event.target.matches('[data-dir="move"]')) return;
    const delta = {ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1]}[event.key];
    if (!delta) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    save(fitFreeformRect({...selected.rect, x: selected.rect.x + delta[0] * step,
      y: selected.rect.y + delta[1] * step}, page.canvas));
  }, options);
  select(editing.selectedWidget);
  if (selected) handles.firstChild.focus({preventScroll: true});
  return () => { end({}, false); events.abort(); };
}
