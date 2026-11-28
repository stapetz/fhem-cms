import { fitFreeformRect, validateFreeformWidget, freeformSelection, freeformBounds, translateFreeformWidgets } from './fcui-freeform-layout.js';
import { fitWidgetTools, setFreeformBox } from './fcui-freeform-view.js';
import { containPopupScroll } from './modal-dialog.js';
import { installCloseStyles, styleCloseButton } from './close-button.js';
import { pinCanvasPoint, translateFloorplanSelection } from './pin-layout.js';

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
  let selection = [];
  let additiveMode = false, pinSelectedOnDown = false;
  const pinTooltip = doc.createElement('output');
  pinTooltip.className = 'cms-pin-position';
  pinTooltip.setAttribute('aria-live', 'polite');
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
  const multi = typeof editing.onFreeformChanges === 'function' && page.layoutMode === 'freeform';
  const cards = page.widgets.filter(widget => multi || !view.isPin(widget.id));
  const entries = new Map([['__nav', view.navBox], ...[...view.wrappers].filter(([id]) => multi || !view.isPin(id))]);
  const widgets = editNavigation ? [nav, ...cards] : cards;
  const toolbar = doc.createElement('div');
  toolbar.className = 'cms-toolbar cms-freeform-selection-tools';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', 'Widget-Auswahl und Gruppen');
  const count = doc.createElement('output');
  count.setAttribute('aria-live', 'polite');
  count.title = 'Cmd/Strg/Alt-Klick: Auswahl erweitern. Ziehen: gemeinsam verschieben. Escape: abbrechen oder Auswahl aufheben.';
  toolbar.append(count);
  const multiple = button(toolbar, 'Mehrfachauswahl', 'Mehrfachauswahl umschalten', () => {
    if (selection.length > 1 || additiveMode) {
      additiveMode = false;
      select();
    } else {
      additiveMode = true;
      updateToolbar();
    }
  });
  multiple.setAttribute('aria-pressed', 'false');
  const isGrouped = () => selection.length > 0 && Boolean(selection[0].groupId)
    && selection.every(widget => widget.groupId === selection[0].groupId);
  const group = button(toolbar, 'Gruppieren', 'Auswahl gruppieren',
    () => editing.onGroupChange(selection.map(widget => widget.id), !isGrouped()));
  const transfer = button(toolbar, 'Auf andere Seite', 'Auswahl auf andere Seite verschieben', () => editing.onMove(selection.map(widget => widget.id)));
  for (const node of toolbar.querySelectorAll('button')) node.classList.add('cms-button');
  if (multi) {
    if (editing.groupToolbarHost) editing.groupToolbarHost.append(toolbar);
    else root.prepend(toolbar);
  }
  const hasPins = () => selection.some(widget => view.isPin(widget.id));
  const layoutWidget = widget => {
    if (!view.isPin(widget.id)) return widget;
    const point = pinCanvasPoint(view.pinPosition(widget), view.getPinFrame());
    return {...widget, rect: {x: point.x, y: point.y, w: 0, h: 0}};
  };
  const selectionRect = () => selection.length > 1 || hasPins()
    ? freeformBounds(selection.map(layoutWidget)) : selected?.rect;
  const changesFor = rect => hasPins()
    ? translateFloorplanSelection(selection, rect.x - selectionRect().x, rect.y - selectionRect().y,
      page.canvas, view.getPinFrame(), view.isPin, view.pinPosition)
    : translateFreeformWidgets(selection, rect.x - selectionRect().x, rect.y - selectionRect().y, page.canvas);
  function updateToolbar() {
    count.textContent = `${selection.filter(widget => widget !== nav).length} Widgets ausgewählt`;
    multiple.textContent = selection.length > 1 || additiveMode ? 'Auswahl aufheben' : 'Mehrfachauswahl';
    multiple.setAttribute('aria-pressed', String(additiveMode));
    const grouped = isGrouped();
    group.textContent = grouped ? 'Gruppe aufheben' : 'Gruppieren';
    group.setAttribute('aria-label', grouped ? 'Gruppierung der Auswahl aufheben' : 'Auswahl gruppieren');
    group.title = group.getAttribute('aria-label');
    group.disabled = (!grouped && selection.length < 2) || selected === nav || typeof editing.onGroupChange !== 'function';
    transfer.disabled = !selection.length || selected === nav || page.renderAsPins === true || typeof editing.onMove !== 'function';
  }
  function saveSelection(rect) {
    if (selection.length < 2 && !hasPins()) return save(rect);
    const changes = changesFor(rect);
    if (!changes.some(change => {
      const original = selection.find(widget => widget.id === change.id);
      return change.position
        ? ['centerX','centerY'].some(key => change.position[key] !== view.pinPosition(original)[key])
        : ['x','y','w','h'].some(key => change.rect[key] !== original.rect[key]);
    })) return;
    return editing.onFreeformChanges(changes, selection.map(widget => widget.id));
  }
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
    const changes = selection.length > 1 || hasPins()
      ? changesFor(rect)
      : [{id: selected.id, rect: selected === nav ? {...rect, z: 10000} : rect}];
    for (const change of changes) {
      if (change.position) {
        view.placePin(selection.find(widget => widget.id === change.id), change.position);
        if (selection.length === 1) {
          pinTooltip.textContent = `X: ${change.position.centerX.toFixed(2)}% | Y: ${change.position.centerY.toFixed(2)}%`;
          entries.get(change.id).append(pinTooltip);
        }
      }
      else setFreeformBox(entries.get(change.id), change.rect);
      fitWidgetTools(entries.get(change.id), view.canvas);
    }
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
  function select(id, focus = false, additive = false) {
    const previous = selection;
    for (const widget of previous) {
      const wrapper = entries.get(widget.id);
      if (wrapper.contains(doc.activeElement) || overlay.contains(doc.activeElement)) doc.activeElement.blur();
      wrapper.classList.remove('cms-widget-selected');
      wrapper.querySelector('.cms-widget-geometry')?.removeAttribute('disabled');
    }
    controls.remove();
    pinTooltip.remove();
    const target = widgets.find(widget => widget.id === id);
    const next = target && multi && target !== nav ? freeformSelection(page, [id]) : target ? [target] : [];
    if (additive && target && target !== nav && !previous.includes(nav)) {
      const remove = next.every(widget => previous.includes(widget));
      selection = remove ? previous.filter(widget => !next.includes(widget))
        : [...previous, ...next.filter(widget => !previous.includes(widget))];
    } else selection = next;
    if (!target) additiveMode = false;
    selected = selection[0];
    overlay.replaceChildren();
    updateToolbar();
    if (!selected) return;
    const wrapper = entries.get(selected.id);
    for (const widget of selection) {
      entries.get(widget.id).classList.add('cms-widget-selected');
      if (selection.length > 1) entries.get(widget.id).querySelector('.cms-widget-geometry')?.setAttribute('disabled', '');
    }
    handles = doc.createElement('div');
    handles.className = 'cms-freeform-handles';
    for (const direction of selection.length > 1 || hasPins() ? [] : ['n','ne','e','se','s','sw','w','nw']) {
      const handle = button(handles, '', `Größe ändern (${direction})`, () => {});
      handle.dataset.dir = direction;
    }
    overlay.append(handles);
    draw(selectionRect());
    if (focus) wrapper.querySelector('[data-dir="move"]')?.focus({preventScroll: true});
  }
  view.canvas.addEventListener('cms-pin-select', () => select(), options);
  const selectClicked = (id, event, focus = false) => {
    if (root.inert) return;
    const additive = multi && (additiveMode || event.metaKey || event.ctrlKey || event.altKey);
    const same = selection.some(widget => widget.id === id);
    select(!additive && same ? undefined : id, focus, additive);
  };
  for (const [id, wrapper] of entries) {
    const tools = wrapper.querySelector('.cms-widget-tools');
    const move = wrapper.querySelector('[data-dir="move"]');
    if (!tools || !move) continue;
    move.addEventListener('click', event => {
      if (!active && (!dragged || event.detail === 0) && !pinSelectedOnDown) selectClicked(id, event);
      pinSelectedOnDown = false;
    }, options);
    if (id === '__nav' || view.isPin(id)) continue;
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
      selectClicked(id, event, !selection.some(widget => widget.id === id));
    }
    if (event.target === view.canvas && !active) select();
  }, options);
  view.canvas.addEventListener('pointerdown', event => {
    dragged = false;
    pinSelectedOnDown = false;
    const direction = event.target.dataset.dir;
    if (!direction || active || event.button !== 0 || root.inert) return;
    if (multi && (event.metaKey || event.ctrlKey || ((event.altKey || additiveMode) && !selection.some(widget =>
      entries.get(widget.id).contains(event.target))))) return;
    const wrapper = event.target.closest('.cms-freeform-widget,.cms-freeform-navigation');
    const id = wrapper && (wrapper.dataset.widgetId || '__nav');
    if (id && !selection.some(widget => widget.id === id)) {
      select(id);
      pinSelectedOnDown = view.isPin(id);
    }
    if (!selected) return;
    event.preventDefault();
    event.target.focus();
    active = {id: event.pointerId, target: event.target, direction, x: event.clientX, y: event.clientY, scale: view.getScale(), moved: false};
    event.target.setPointerCapture(event.pointerId);
    draw(selectionRect());
  }, options);
  function calculate(event) {
    if (hasPins()) {
      const rect = selectionRect();
      const dx = (event.clientX - active.x) / active.scale, dy = (event.clientY - active.y) / active.scale;
      return {rect: {...rect, x: rect.x + dx, y: rect.y + dy}, guides: []};
    }
    return freeformGesture(selectionRect(), active.direction,
      (event.clientX - active.x) / active.scale, (event.clientY - active.y) / active.scale,
      page.canvas, widgets.filter(widget => !selection.includes(widget)), event.altKey);
  }
  view.canvas.addEventListener('pointermove', event => {
    if (active?.id !== event.pointerId || root.inert) return;
    active.moved ||= event.clientX !== active.x || event.clientY !== active.y;
    preview = calculate(event);
    if (raf === undefined) raf = win.requestAnimationFrame(() => { raf = undefined; draw(preview.rect, preview.guides); });
  }, options);
  function end(event, commit) {
    if (!active || (event.pointerId !== undefined && event.pointerId !== active.id)) return;
    const {id, target, moved} = active;
    const rect = commit && (active.moved || event.clientX !== active.x || event.clientY !== active.y)
      ? calculate(event).rect : selectionRect();
    active = null;
    dragged = moved || !commit;
    pinSelectedOnDown = !commit || pinSelectedOnDown;
    if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
    if (raf !== undefined) win.cancelAnimationFrame(raf);
    raf = undefined;
    draw(rect);
    if (commit && ['x','y','w','h'].some(key => rect[key] !== selectionRect()[key])) saveSelection(rect);
  }
  view.canvas.addEventListener('pointerup', event => end(event, !root.inert), options);
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
    const rect = selectionRect();
    const next = {...rect, x: rect.x + delta[0] * step, y: rect.y + delta[1] * step};
    saveSelection(hasPins() ? next : fitFreeformRect(next, page.canvas));
  }, options);
  win.addEventListener('blur', () => end({}, false), options);
  select(editing.selectedWidgets?.[0] ?? editing.selectedWidget, true);
  if (multi && editing.selectedWidgets?.length > 1) {
    for (const id of editing.selectedWidgets.slice(1)) {
      if (!selection.some(widget => widget.id === id)) select(id, false, true);
    }
  }
  return () => { end({}, false); events.abort(); toolbar.remove(); pinTooltip.remove(); };
}
